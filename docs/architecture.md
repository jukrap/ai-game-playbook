# Target Architecture

> Status: planned architecture. Package and bridge boundaries may change during review.

[한국어](architecture.ko.md) · [Documentation](README.md)

## Overview

The planned system uses a pnpm workspace and a Node.js/TypeScript control plane. Engine-specific bridges remain thin: C# for Unity, Python/C++ for Unreal, and GDScript for Godot. Python is otherwise introduced only for isolated Blender or ML workloads.

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

The typed registry is the only planned authoring source for command, skill, role-lens, and workflow descriptors. CLI parsing, MCP schemas, help, public command metadata, and Codex routing are generated projections. Generated surfaces cannot grant permissions or invent capabilities.

## Planned workspace boundaries

| Boundary | Responsibility |
| --- | --- |
| `contracts` | Versioned schemas and shared identifiers with no engine runtime dependency |
| `registry` | Descriptor validation, generation, digesting, and parity checks |
| `core` | Project identity, permissions, budgets, lanes, checkpoints, and workflow state |
| `cli` | `agpb` argument parsing, local interaction, stable exit behavior, and help |
| `mcp` | Schema-derived tools and resources behind the same permission broker |
| `codex-adapter` | Skills, host routing metadata, and project instruction integration |
| `pack-runtime` | Staged install, owned paths, dependency checks, update, rollback, and uninstall |
| `evidence` | Content-addressed artifacts, receipts, exports, retention, and redaction |
| `engine-common` | Common capability negotiation and engine operation contracts |
| Engine adapters | Godot, Unity, and Unreal orchestration without broad host authority |
| Project bridges | Minimum editor/runtime code needed to expose verified engine operations |

This is a logical boundary plan, not a promise that these exact package names already exist.

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

Writes use owned-path rules and compare-and-swap preimages. Pack lifecycle operations stage changes before promotion and never delete non-owned files. Editor-bound work is serialized per project while read-only inspection may run in parallel.

## Host integration

Codex is the first supported host, but contracts do not depend on one chat surface. Project instructions follow directory scope, skills load progressively, and MCP uses local process or streamable HTTP transports where appropriate. Host annotations remain advisory; the control plane's permission broker is authoritative.

## Failure and recovery

Every mutation records preconditions, changed paths, engine identity, and recovery status. A stale process, changed session, path escape, unexpected dirty file, incomplete result, or exceeded budget stops the workflow. Rollback is a registered operation with its own receipt, not an assumption that a failed command made no changes.
