# Target Architecture

> Status: target architecture. The `contracts` and `registry` foundations, early `core` safety boundaries, and a private managed-pack transaction runtime exist; the remaining runtime and bridge boundaries are planned.

[한국어](architecture.ko.md) · [Documentation](README.md)

## Overview

The repository uses a pnpm workspace for a Node.js/TypeScript control plane. Engine-specific bridges are planned to remain thin: C# for Unity, Python/C++ for Unreal, and GDScript for Godot. Python is otherwise introduced only for isolated Blender or ML workloads.

```mermaid
flowchart TD
    H[Codex or another host] --> S[CLI / MCP / host adapter]
    S --> R[Typed registry]
    R --> P[Permission broker]
    P --> W[Bounded workflow runtime]
    W --> E[Receipt and evidence store]
    W --> A[Engine adapter]
    A --> B[Thin project bridge]
    B --> G[Godot / Unity / Unreal]
    W --> F[Safe filesystem and process layer]
```

The typed registry is the authoring source for command, skill, role-lens, workflow, schema, and pack descriptors. Its current generators produce validated design projections for CLI, MCP, help, documentation metadata, and host routing. It also resolves a supported workflow stage into a finite, domain-separated plan bound to the exact registry, workflow, schemas, commands, handlers, lanes, permissions, budgets, failure transitions, and evidence duties. The private permission and workflow-state primitives consume that validated authority, and the current checkpoint store persists bounded state transitions. Generated CLI/MCP/host execution consumers and durable approval, receipt, and evidence stores remain planned. Generated surfaces cannot grant permissions or invent capabilities.

## Workspace boundaries

| Boundary | Status | Responsibility |
| --- | --- | --- |
| `contracts` | Foundation implemented | Versioned schemas and shared identifiers with no engine runtime dependency |
| `registry` | Foundation implemented | Descriptor validation, generation, digesting, routing, parity checks, and deterministic workflow-plan resolution |
| `core` | Partial | Canonical project identity, portable path resolution, staged filesystem compare-and-swap, digest-bound direct process execution, root/project-bound mutating leases, in-memory signed permission admission/settlement, immutable workflow checkpoint transitions, append-only checkpoint persistence, bounded chain validation, and restart-safe recovery classification exist; dispatcher integration, durable approvals/receipts/evidence, uncertainty reconciliation, CPU/memory enforcement, and parallel-read coordination remain planned |
| `cli` | Planned | `agpb` argument parsing, local interaction, stable exit behavior, and help |
| `mcp` | Planned | Schema-derived tools and resources behind the same permission broker |
| `codex-adapter` | Planned | Skills, host routing metadata, and project instruction integration |
| `pack-runtime` | Partial | Write-free validated-registry preflight plus broker/lane-bound local add, update, installed-state-owned removal, CAS promotion, clear-failure rollback, effect settlement, and append-only transaction verification exist; directory bootstrap, CLI integration, interrupted-transaction reconciliation, and distributed pack acquisition remain planned |
| `evidence` | Planned | Content-addressed artifacts, receipts, exports, retention, and redaction |
| `engine-common` | Contract only | Common capability negotiation and engine operation contracts |
| Engine adapters | Planned | Godot, Unity, and Unreal orchestration without broad host authority |
| Project bridges | Planned | Minimum editor/runtime code needed to expose verified engine operations |

Only `contracts`, `registry`, the partial private `core`, and the private `pack-runtime` currently exist as workspace packages. A listed boundary is not a claim that its complete runtime capability already exists.

## Execution flow

1. Detect a project and build an exact `GameProjectProfile`.
2. Negotiate an `EngineCapabilityReport`; unsupported operations retain a reason and fallback grade.
3. Validate a `FeatureContract`, permission classes, budgets, owned paths, and expected dirty state.
4. Resolve and attest the finite workflow plan against the current registry and project stage.
5. Acquire the project lane and, when needed, bind one editor session.
6. Execute registry commands with bounded output, timeout, cancellation, and no default mutation retry.
7. Save artifacts and state transitions into a hash-linked `RunReceipt`.
8. Reconcile identity and dirty state after reload, restart, failure, or rollback.

## Consumer project state

A consuming game project is planned to contain `.ai-game-playbook/`. Commit-worthy state includes the project profile, feature contracts, and policy. Cache, logs, screenshots, locks, receipts containing local details, local secrets, and machine-specific configuration remain ignored.

Writes use owned-path rules and compare-and-swap preimages. The private core now advances a resolved workflow through pre-dispatch, dispatched, settled, rollback, blocked, terminal, and uncertain checkpoints. Each transition re-resolves the exact plan, accepts only same-process permission authority, binds a domain-separated receipt to command and authorization identity, preserves a receipt chain, and aggregates workflow budgets and complete evidence. Canonical checkpoint records are append-only under a fixed project-local directory, while a compare-and-swap head selects the current chain. Loading bounds record count and bytes, rechecks every parent transition and current registry/project identity, preserves corrupt state for diagnosis, and refuses competing heads. Restart recovery returns an undispatched admission to a reauthorization state and converts a dispatched but unsettled step to `uncertain`. Pack preflight binds a same-process validated registry, target/source root identities, local artifact bytes, installed-state digest, intended file changes, conflicts, and limits into an immutable write-free plan. The private executor then requires an exact broker-issued install authorization and same-process `project-write` lease, writes an append-only started record before final-file effects, stages artifact and installed-state CAS operations, records a terminal outcome, and settles observed effects. A clear later-file failure triggers bounded reverse rollback; an uncertain effect is not retried. Removal can use canonical installed ownership even when the pack is no longer in the current registry. This path still requires pre-created state and transaction directories and has no restart reconciler, CLI, approval UI, or durable approval capability. The general workflow state machine is not yet wired to command dispatch, and full receipts and evidence payloads are not durable. The core also does not yet discover or control an editor. Parallel-read coordination remains planned.

## Host integration

Codex is the first supported host, but contracts do not depend on one chat surface. Project instructions follow directory scope, skills load progressively, and MCP uses local process or streamable HTTP transports where appropriate. Host annotations remain advisory; the control plane's permission broker is authoritative.

## Failure and recovery

Every mutation is intended to record preconditions, changed paths, engine identity, and recovery status. The implemented lease stops on root/project mismatch, changed lock-directory identity, malformed records, or a live or unverifiable owner. An expired lease is quarantined only after its owner PID is no longer running. The workflow boundary durably preserves an uncertain mutation or aggregate budget violation and authorizes a declared rollback as a separate command and receipt. It can classify restart recovery but cannot yet reconcile or clear uncertainty, restore project/editor state, or dispatch the rollback itself; rollback never implies that a failed command made no changes.
