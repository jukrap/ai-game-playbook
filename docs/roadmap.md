# Roadmap

> Status: common foundations and Stage 2 safety primitives are in progress. Later stages, dates, and availability are not promises.

[한국어](roadmap.ko.md) · [Documentation](README.md)

## Current checkpoint

Completed foundations include versioned contracts, strict registry validation, generated surfaces, deterministic workflow plans, canonical project/path handling, compare-and-swap filesystem operations, bounded processes, project mutation leases, signed scoped permission admission, workflow checkpoints, and managed-pack transactions with recovery boundaries.

The current Stage 2 product slice adds:

- an executable repository-local CLI with stable help, version, parsing, output, and exit behavior;
- an exact runtime registry that exposes only implemented commands;
- `InitRequest`, `InitReport`, `DoctorRequest`, `DoctorReport`, `ProjectInspectRequest`, and `ProjectInspectReport` schemas;
- write-free `agpb init` classification for a fixed 16-target project-local layout;
- read-only `agpb doctor` checks for runtime, registry, project-state, installed-pack-state, and active-marker safety;
- static read-only `agpb project inspect` for bounded engine markers, canonical profile compatibility, marker-only dirty state, and unbound Editor signals;
- compiled-handler digest attestation; and
- generated/public availability parity.

This does not make the package installable and does not raise any engine capability above `planned`.

## Stage 2 remaining work

The next control-plane work is:

1. Bind mutation behind the existing write-plan-only `init` to explicit project-metadata authority, fresh plan validation, staged writes, and rollback.
2. Add pack and skill list/check commands before any mutation command.
3. Connect approved pack add/update/remove and recovery finalization through a general dispatcher without weakening the existing plan, approval, lane, CAS, journal, or rollback requirements.
4. Add approval interaction, stable error envelopes, command deadlines, and durable command receipts.
5. Verify clean install, reinstall, update, conflict, interruption, rollback, recovery, and uninstall behavior from the executable surface.

No command may be marked available merely because a private library function exists.

## Stage 3 — evidence, MCP, and Codex integration

Planned work includes content-addressed artifacts, canonical receipt chains, checkpoint/handoff reconciliation, retention and redaction, explicit evidence export, registry-generated STDIO MCP tools, and project-scoped Codex skills and instructions.

CLI, MCP, documentation, and skill routing must preserve identical command IDs, schema digests, permissions, and handler identities. MCP annotations remain hints and can never override the permission broker. No background upload or telemetry path is planned.

## Stage 4 — Godot alpha

Godot is the first planned engine adapter. The common 3D graybox must prove movement, camera behavior, collision, a collectible, HUD count, save/load across process restart, failure/restart handling, win state, actual runtime frames, Windows export, and exported-player startup.

`0.1.0-alpha` is allowed only after the required Godot capabilities reach `verified`, pack lifecycle and recovery are stable, clean external installation passes, and licensing and release authority are resolved. Unity and Unreal remain planned at that point.

## Stage 5 — Unity

Unity work will prioritize official command-line and automation paths, exact Editor/project identity, EditMode and PlayMode reports, domain-reload reconciliation, actual Game View evidence, Windows x64 Development Build, and packaged startup. Community fallback paths remain optional and must pass the same authentication, schema, identity, timeout, output, recovery, and evidence gates.

## Stage 6 — Unreal

Unreal work will use UBT/UAT and commandlets for headless paths and constrained editor operations for editor-bound work. PIE, editor viewport, Automation, cook/package, and packaged execution evidence remain distinct. Global process termination, active worktree switching, broad asset deletion, and unbounded arbitrary Python are outside the accepted boundary.

## Stage 7 — stabilization and 1.0

`1.0` requires all three engines to reach the required verified capabilities, a common Windows x64 packaged scenario, stable install/update/recovery/uninstall behavior, schema and pack migration, behavior evaluations, current live-engine evidence, release provenance, and no unresolved critical security or licensing blocker.

## Later extensions

UI reconstruction, deterministic balance simulation, optional Blender QA, and at most one optional hosted image-provider pack follow the core loops. Dashboard/desktop UI, 3D and audio generation, and macOS validation are later work. Additional engines remain community packs behind the public adapter contract.

## Release rules

- The repository remains private-package/`UNLICENSED` during this phase and is not published to npm.
- A source-built command is not a release.
- Engine support follows witnessed capability evidence, not roadmap position.
- English and Korean public docs, generated surfaces, handler digests, tests, and Windows/Linux CI must agree before a status claim changes.
