# Current Status and Scope

> Status: Stage 2 control-plane implementation in progress, reviewed on 2026-08-27. Three write-free source-built commands are available; engine support remains planned.

[한국어](status-and-scope.ko.md) · [Documentation](README.md)

## Current repository state

The repository contains a private pnpm/TypeScript workspace, versioned schemas, semantic validators, typed registry validation and generation, deterministic workflow-plan attestation, a runtime registry for implemented commands, a digest-bound public surface, tests, Windows/Linux CI, an early core package, a managed-pack runtime, and an experimental CLI package.

Implemented core boundaries include:

- canonical project-root binding and portable path resolution without writable link traversal;
- bounded deterministic root-entry, directory, and file inspection;
- staged SHA-256 compare-and-swap writes, deletion, and reversible empty-directory removal;
- digest-bound direct process execution with environment, working-directory, time, idle, and output limits;
- one root/project-bound mutation lease with bounded waiting and dead-owner-only recovery;
- schema-bound permission admission, exact scoped signed grants, and effect settlement;
- deterministic workflow-plan resolution and immutable state transitions; and
- canonical append-only checkpoint chains with restart classification; and
- canonical append-only run-receipt records with compare-and-swap heads, exact authority binding, redaction checks, and project-local artifact-locator verification.

The private pack runtime implements write-free preflight, canonical installed state, exact dependencies and ownership, local add/update/remove transactions, active markers, append-only journals, compare-and-swap promotion, clear-failure rollback, marker-bound direct-parent directory ownership, reversible tombstones, bounded recovery inspection, and separately approved stable-state finalization.

The source-built `agpb` executable currently exposes plan-only `init`, read-only `doctor`, and static read-only `project inspect`. `init` classifies a fixed 16-target project-local layout and emits an identity-bound `InitReport`; it cannot apply the plan. `doctor` checks runtime-registry parity, the supported Node.js range, one canonical project root, the fixed runtime layout, installed-pack-state validity, and active transaction markers. `project inspect` reports bounded Godot, Unity, and Unreal marker candidates, canonical profile validity and compatibility, marker-only dirty-state knowledge, and unbound static Editor signals. All three produce human or canonical JSON output from registered reports and perform no writes.

## What is not available

There is no installable or published package, MCP server, Codex integration package, general command dispatcher, approval UI, durable approval store, content-addressed artifact store, evidence CLI or export path, mutating pack CLI, recovery-finalization command, CPU or memory sandbox, engine bridge, engine pack, live-engine automation, or playable golden project.

Mutating initialization, pack and skill commands, engine commands, workflow execution, verification, evidence commands, and documentation command integration remain planned. Private library functions are not public commands. The runtime registry exposes none of those planned operations.

Project-state bootstrap, receipt persistence, pack mutation, recovery inspection, and recovery finalization remain private APIs. The current `init` can report layout intent and conflicts but cannot create profile, policy, ignore, or runtime-state bytes. The current doctor can identify unsafe state but cannot initialize, repair, clear, classify recovery, or finalize it. Project inspection does not run Git, enumerate processes, establish Editor liveness or session identity, validate stage evidence content, connect to an engine, or raise an engine support grade. The workflow runtime is not connected to general dispatch. Durable receipt JSON exists, but artifact payload storage, retention, historical migration, evidence commands, and export do not.

All Godot, Unity, and Unreal capabilities remain `planned`. Availability of `init`, `doctor`, and `project inspect` is a control-plane command status, not engine evidence.

## Intended users and first outcome

The primary audience is an individual or a team of one to five developers. The first complete outcome is a Windows x64 offline, single-player 3D vertical slice with movement, camera behavior, collision, a collectible, a HUD counter, save/load, restart, and a win state.

The first alpha favors reliable graybox production and verification over broad genre coverage, polished content generation, or autonomous long-running development.

## First-party engine scope

| Engine | Current grade | Initial implementation direction | Planning family |
| --- | --- | --- | --- |
| Godot | `planned` | First adapter and complete graybox loop | 4.7.x |
| Unity | `planned` | Second adapter, official automation paths first | 6.3 LTS |
| Unreal Engine | `planned` | Third adapter, editor and build paths separated | 5.8.x |

These version families are dated planning targets, not tested compatibility claims. Exact patches and required modules will be detected and pinned before each adapter stage.

## Included in the first alpha

- Project detection, identity, stage, target, and budget inspection.
- Bounded feature workflows and explicit completion contracts.
- Safe source and editor mutation with compare-and-swap checks and rollback.
- Compile/import, nonzero test execution, runtime play, deterministic input, state assertions, logs, captures, profiling, and build/export receipts.
- Typed placeholders and user-provided or licensed assets with provenance and QA.
- Local evidence storage and explicit evidence export.
- Windows x64 as the first build target, with Linux static and headless CI where supported.

These are alpha scope commitments, not current capability claims.

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

All seven documentation gates were approved before implementation began. `0.1.0-alpha` still requires the complete Godot golden loop, stable executable lifecycle and recovery behavior, clean external installation, a selected license, and explicit release authority. A `1.0` release requires all three engines to reach the required `verified` capabilities and pass the common packaged scenario.
