# Target Architecture

> Status: target architecture. The `contracts` and `registry` foundations and early `core` filesystem, process, mutating-lane, and permission-admission boundaries exist; the remaining runtime and bridge boundaries are planned.

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

The typed registry is the authoring source for command, skill, role-lens, workflow, schema, and pack descriptors. Its current generators produce validated design projections for CLI, MCP, help, documentation metadata, and host routing. The private permission primitive consumes validated command and schema authority, while generated CLI/MCP/host execution consumers remain planned. Generated surfaces cannot grant permissions or invent capabilities.

## Workspace boundaries

| Boundary | Status | Responsibility |
| --- | --- | --- |
| `contracts` | Foundation implemented | Versioned schemas and shared identifiers with no engine runtime dependency |
| `registry` | Foundation implemented | Descriptor validation, generation, digesting, routing, and parity checks |
| `core` | Partial | Canonical project identity, portable path resolution, staged filesystem compare-and-swap, digest-bound direct process execution, root/project-bound mutating leases, and in-memory signed permission admission/settlement exist; dispatcher integration, durable approvals, CPU/memory enforcement, parallel-read coordination, checkpoints, and workflow state remain planned |
| `cli` | Planned | `agpb` argument parsing, local interaction, stable exit behavior, and help |
| `mcp` | Planned | Schema-derived tools and resources behind the same permission broker |
| `codex-adapter` | Planned | Skills, host routing metadata, and project instruction integration |
| `pack-runtime` | Planned | Staged install, owned paths, dependency checks, update, rollback, and uninstall |
| `evidence` | Planned | Content-addressed artifacts, receipts, exports, retention, and redaction |
| `engine-common` | Contract only | Common capability negotiation and engine operation contracts |
| Engine adapters | Planned | Godot, Unity, and Unreal orchestration without broad host authority |
| Project bridges | Planned | Minimum editor/runtime code needed to expose verified engine operations |

Only `contracts`, `registry`, and the partial private `core` currently exist as workspace packages. A listed boundary is not a claim that its runtime package or capability already exists.

## Execution flow

1. Detect a project and build an exact `GameProjectProfile`.
2. Negotiate an `EngineCapabilityReport`; unsupported operations retain a reason and fallback grade.
3. Validate a `FeatureContract`, permission classes, budgets, owned paths, and expected dirty state.
4. Acquire the project lane and, when needed, bind one editor session.
5. Execute registry commands with bounded output, timeout, cancellation, and no default mutation retry.
6. Save artifacts and state transitions into a hash-linked `RunReceipt`.
7. Reconcile identity and dirty state after reload, restart, failure, or rollback.

## Consumer project state

A consuming game project is planned to contain `.ai-game-playbook/`. Commit-worthy state includes the project profile, feature contracts, and policy. Cache, logs, screenshots, locks, receipts containing local details, local secrets, and machine-specific configuration remain ignored.

Writes use owned-path rules and compare-and-swap preimages. The current private core serializes `project-write`, `editor-bound`, and `build-bound` admission through one fixed project-local lease, but it does not yet discover or control an editor. Its permission primitive resolves a command from a validated registry, validates the actual input schema, narrows feature/workflow/session scope and budgets, consumes exact signed grants in memory, and rejects reported undeclared effects. It is not yet wired to lane acquisition or command dispatch, and its approval consumption and uncertainty barrier are not durable across process restart. Pack lifecycle operations and parallel-read coordination remain planned.

## Host integration

Codex is the first supported host, but contracts do not depend on one chat surface. Project instructions follow directory scope, skills load progressively, and MCP uses local process or streamable HTTP transports where appropriate. Host annotations remain advisory; the control plane's permission broker is authoritative.

## Failure and recovery

Every mutation is intended to record preconditions, changed paths, engine identity, and recovery status. The implemented lease stops on root/project mismatch, changed lock-directory identity, malformed records, or a live or unverifiable owner. An expired lease is quarantined only after its owner PID is no longer running. Durable recovery receipts and full workflow reconciliation remain planned. Rollback is a registered operation with its own receipt, not an assumption that a failed command made no changes.
