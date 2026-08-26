# Current Status and Scope

> Status: Stage 2 control-plane safety boundary in progress, reviewed on 2026-08-26.

[한국어](status-and-scope.ko.md) · [Documentation](README.md)

## Current repository state

The repository now contains a private pnpm/TypeScript workspace, versioned contract schemas, semantic validators, typed registry validation and projections, a digest-bound foundation plan, tests, Windows/Linux CI configuration, and an early private core package. The implemented filesystem boundary binds canonical project roots, resolves portable project paths without writable link traversal, bounds directory inspection and file sizes, and stages SHA-256 compare-and-swap writes with precondition, drift, and uncertain-outcome reporting. The process boundary binds a local executable identity and digest, uses direct argument-array spawn, limits environment authority, working directory, time, idle time, and output, and terminates the owned process tree on cancellation or budget exhaustion. Interrupted execution remains mutation-uncertain even when termination is confirmed. The mutating-lane boundary uses a fixed local lock, root/project digests, run and runtime identity, explicit lease renewal, bounded waiting and cancellation, and dead-owner-only stale recovery.

It does not yet contain an installable package, `agpb` executable, MCP server runtime, Codex integration files, permission broker, CPU or memory sandboxing, workflow runtime, engine bridges, engine packs, or a playable golden project. The lane runtime remains a private primitive: automatic heartbeat scheduling, parallel-reader coordination, independent operating-system attestation of a foreign live process start, durable recovery receipts, and actual editor control are not implemented. The command inventory in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json) remains design-only; neither raises any command or engine capability above `planned`.

## Intended users and first outcome

The primary audience is an individual or a team of one to five developers. The first complete outcome is a Windows x64 offline, single-player 3D vertical slice with movement, camera behavior, collision, a collectible, a HUD counter, save/load, restart, and a win state.

The first alpha favors reliable graybox production and verification over broad genre coverage, polished content generation, or autonomous long-running development.

## First-party engine scope

| Engine | Current grade | Initial implementation direction | Planning family |
| --- | --- | --- | --- |
| Godot | `planned` | First adapter and complete graybox loop | 4.7.x |
| Unity | `planned` | Second adapter, official automation paths first | 6.3 LTS |
| Unreal Engine | `planned` | Third adapter, editor and build paths separated | 5.8.x |

The version families are dated planning targets, not tested compatibility claims. Exact patches and required modules will be detected and pinned before implementation begins.

## Included in the first alpha

- Project detection, identity, stage, target, and budget inspection.
- Bounded feature workflows and explicit completion contracts.
- Safe source and editor mutation with compare-and-swap checks and rollback.
- Compile/import, nonzero test execution, runtime play, deterministic input, state assertions, logs, captures, profiling, and build/export receipts.
- Typed placeholders and user-provided or licensed assets with provenance and QA.
- Local evidence storage and explicit evidence export.
- Windows x64 as the first build target, with Linux static and headless CI where supported.

## Deferred or optional

- Local Blender and local image/ML tools are optional and are never auto-installed.
- At most one hosted image-provider pack may be enabled, with separate approval for installation and every external or paid call.
- 3D and audio generation are later packs.
- UI reconstruction and balance simulation follow the core engine loops.
- Dashboard, desktop UI, and macOS verification are later milestones.

## Outside the first alpha

- Browser-first game frameworks and first-party support for additional engines.
- Multiplayer and online service orchestration.
- Mobile, console, XR, and web export targets.
- Cinematic or video generation.
- Automatic installation of engines, editors, Blender, or system-wide tools.
- Automatic publication, release, store submission, or remote evidence upload.

## Readiness rule

All seven documentation gates were approved before Stage 1 implementation began. `0.1.0-alpha` still requires the Godot golden loop to pass end to end. A `1.0` release requires all three engines to reach `verified`, along with stable install lifecycle, recovery, and behavior evaluations.
