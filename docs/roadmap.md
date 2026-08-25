# Roadmap

> Status: planned sequence. Dates and availability are not promised.

[한국어](roadmap.ko.md) · [Documentation](README.md)

## Gate 0: documentation approval

Before product implementation, maintainers review and approve seven documentation gates covering repository/install lifecycle, command and memory orchestration, each of the three engines, game production and assets, and the integrated public design.

Approval freezes the initial contracts, risks, permission defaults, evidence thresholds, golden tasks, and release scope. Review may send a gate back for revision. Design completion alone does not create a product release.

## Stage 1: common foundation

- Create the pnpm workspace and versioned contract packages.
- Implement the typed registry, generators, core runtime, CLI, MCP surface, and Codex adapter.
- Implement digest-owned pack staging, install, update, conflict handling, rollback, and uninstall.
- Reserve the npm package name `ai-game-playbook` and executable name `agpb` only when publication is authorized.

## Stage 2: execution, evidence, and safety

- Implement the permission broker, compare-and-swap writes, project/editor identity, and serialized mutation lanes.
- Add bounded workflows, checkpoints, resume validation, repair limits, cancellation, and uncertainty handling.
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
