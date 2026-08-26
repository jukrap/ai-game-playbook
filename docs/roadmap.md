# Roadmap

> Status: common foundation and Stage 2 safety primitives are in progress. Later stages, dates, and availability are not promised.

[한국어](roadmap.ko.md) · [Documentation](README.md)

## Gate 0: documentation approval — complete

Maintainers approved seven documentation gates covering repository/install lifecycle, command and memory orchestration, each of the three engines, game production and assets, and the integrated public design before product implementation began.

Approval freezes the initial contracts, risks, permission defaults, evidence thresholds, golden tasks, and release scope. Review may send a gate back for revision. Design completion alone does not create a product release.

## Stage 1: common foundation — in progress

- Completed: pnpm workspace, versioned contract schemas, semantic validation, typed registry validation and projections, pack dependency-graph validation, deterministic resolved workflow-plan attestation, a tracked digest-bound foundation plan, a fixed-layout project-state bootstrap, and a private managed-pack preflight and transaction executor.
- Remaining: core runtime, executable CLI, MCP server, Codex adapter, and runtime parity generation.
- Remaining: executable pack CLI and registry parity, pack-owned artifact-directory lifecycle, interrupted-transaction reconciliation and doctor flow, broader lifecycle evaluation, and pack distribution; fixed runtime-directory bootstrap plus local approval/lane-bound add, update, installed-state-owned removal, journaling, clear-failure rollback, and conflict checks exist as private library primitives.
- Keep the package private and use `ai-game-playbook` and `agpb` as reserved interface names until publication is separately authorized.

## Stage 2: execution, evidence, and safety

- Implemented primitives: compare-and-swap writes and single-file deletion, canonical project-root identity, bounded direct process execution, serialized root/project-bound mutating leases, in-memory registry-bound permission admission with exact signed grants and effect settlement, immutable resolved-plan checkpoint transitions with receipt-chain, rollback, evidence, and cumulative-budget enforcement, append-only checkpoint persistence with bounded chain validation and restart-safe hydration, plus immutable local pack plans and an authorization/lane-bound transaction executor with append-only started/terminal records and bounded reverse rollback.
- Remaining: durable approval/receipt/evidence storage, uncertainty reconciliation, general workflow dispatcher integration, full project/editor identity attestation, automatic lease heartbeat integration, and parallel-read coordination.
- Complete repair/retry and cancellation transitions, dispatcher-owned checkpoint persistence, receipt/evidence storage, and explicit reconciliation around the current bounded state machine.
- Add content-addressed receipts, evidence storage, redacted diagnostics, retention, and explicit export.
- Test traversal, symlink escape, invalid tokens, output growth, timeouts, stale processes, ambiguous editors, and install lifecycle conflicts.

## Stage 3: Godot adapter and first alpha

- Build the common 3D graybox with movement, camera, collision, collectible, HUD, save/load, restart, and win state.
- Verify detect, inspect, change, save, script validation, test, run, deterministic input, gameplay state, runtime capture, logs, recovery, and Windows export startup.
- Publish `0.1.0-alpha` only after the complete Godot loop and package lifecycle pass. Unity and Unreal remain `planned` at this point.

## Stage 4: Unity adapter

- Implement official automation paths first and admit a fallback only after its hard gates pass.
- Reproduce the graybox with EditMode and PlayMode tests, domain-reload recovery, actual Game View evidence, and Windows x64 Development Build startup.
- Raise individual Unity capabilities only to the strongest witnessed grade.

## Stage 5: Unreal adapter

- Implement official MCP, Editor Python, Automation, UAT, and UBT paths with exact session identity and transactions.
- Reproduce the graybox in Blueprint and C++ flows.
- Verify PIE gameplay separately from packaged startup, cook/package, rollback, and asset/actor recovery.

## Stage 6: optional expansion

- Add UI reconstruction, balance simulation, Blender QA, and one optional hosted image-provider pack.
- Evaluate dashboard and desktop UI needs after the CLI workflows are stable.
- Treat 3D and audio generation, macOS validation, and additional distribution targets as later work.

## Release thresholds

`0.1.0-alpha` requires the Godot golden loop, safe installation lifecycle, bounded recovery, and behavior evaluations. Later pre-releases add one verified engine at a time without overstating the others.

`1.0` is allowed only when Godot, Unity, and Unreal all have required capabilities at `verified`; clean install, reinstall, update, user-conflict, rollback, and uninstall are stable; behavior evaluations cover permission and interruption paths; and public documentation matches generated runtime surfaces in both languages.

## Persistent non-goals

The roadmap does not authorize automatic engine installation, telemetry, unapproved network access, autonomous publishing, broad process control, or unbounded repair loops. New engines enter through a public adapter contract as community packs, not by expanding first-party scope silently.
