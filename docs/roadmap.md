# Roadmap

> Status: common foundations and Stage 2 safety primitives are in progress. Later stages, dates, and availability are not promises.

[한국어](roadmap.ko.md) · [Documentation](README.md)

## Current checkpoint

Completed foundations include versioned contracts, strict registry validation, generated surfaces, deterministic workflow plans, canonical project/path handling, compare-and-swap filesystem operations, bounded processes, project mutation leases, signed scoped permission admission including explicit host-tool inspection, workflow checkpoints, durable private receipt records, bounded private receipt-head queries, pure process/test result normalization, limited retained-artifact assessment, managed-pack transactions with recovery boundaries, a project-bound read-only STDIO MCP runtime, eleven registry-derived capability-first skill artifacts with a shared read-only runtime, and write-free Codex project-configuration and skill-target planning.

The current Stage 2 product slice adds:

- an executable repository-local CLI with stable help, version, parsing, output, and exit behavior;
- an exact runtime registry that exposes only implemented commands;
- `InitRequest`, `InitReport`, `DoctorRequest`, `DoctorReport`, `ProjectInspectRequest`, `ProjectInspectReport`, pack-list, pack-doctor, skill-list, skill-check, static engine-status, and static engine-capabilities schemas;
- write-free `agpb init` classification for a fixed 20-target project-local layout;
- read-only `agpb doctor` checks for runtime, registry, project-state, installed-pack-state, and active-marker safety;
- static read-only `agpb project inspect` for bounded engine markers, canonical profile compatibility, marker-only dirty state, and unbound Editor signals;
- read-only `agpb pack list` and `agpb pack doctor` for bounded installed identity, ownership counts, artifact and directory integrity, and active recovery summaries without content disclosure, repair, or finalization;
- read-only `agpb skill list` and `agpb skill check` for a bounded registry catalog and missing/current/conflicting/oversized/unsafe project-target observations without materialization;
- static read-only `agpb engine status --engine godot` for one complete Godot project candidate, `4.7.2` major/minor compatibility, explicit evidence gaps, and no host executable path or process launch;
- static read-only `agpb engine capabilities --engine godot` for one compatible identity, all 14 common operations held at `planned`/`documented`, explicit containment gaps, and no executable/provider input or process launch;
- private Godot executable discovery with project-only preparation, bounded exact sources, signed single-use approval, no recursive search or process launch, identity rechecks, settled authority, and no source-path result fields;
- private Godot exact-version probing that accepts only an original same-process discovery candidate, requires a second exact approval, runs one bounded `--version` process, and retains explicit isolation gaps without promoting support;
- canonical append-only run-receipt persistence with exact runtime and registry authority, compare-and-swap heads, redaction checks, and complete project-local artifact-locator verification;
- private whole-directory receipt-head query with fixed entry/head/byte limits, explicit summary validation level, and same-process detailed-load witnesses;
- private promotion of complete artifact snapshots into immutable SHA-256 objects with receipt-attested canonical manifests;
- private fail-closed normalization of bounded process and structured test-report observations into immutable component outcomes;
- private fail-closed assessment of retained UTF-8, canonical JSON, non-interlaced PNG, and optional current-registry asset-provenance evidence;
- private modern STDIO exposure of explicitly enabled generated read-only tools with exact project and schema binding;
- private deterministic Codex project-configuration and eleven capability-first skill-target plans plus create/retain/conflict inspection without apply or skill materialization;
- compiled-handler digest attestation; and
- generated/public availability parity.

This does not make the package installable and does not raise any engine capability above `planned`.

## Stage 2 remaining work

The next control-plane work is:

1. Bind mutation behind the existing write-plan-only `init` to explicit project-metadata authority, fresh plan validation, staged writes, and rollback.
2. Connect approved pack add/update/remove and recovery finalization through a general dispatcher without weakening the existing plan, approval, lane, CAS, journal, or rollback requirements.
3. Add approval interaction and stable error envelopes, then connect command deadlines and settlements to the durable receipt store.
4. Verify clean install, reinstall, update, conflict, interruption, rollback, recovery, and uninstall behavior from the executable surface.

No command may be marked available merely because a private library function exists.

## Stage 3 — evidence, MCP, and Codex integration

The process/test normalization, limited artifact assessment, bounded private receipt-head discovery, explicit read-only STDIO MCP runtime, eleven registry-derived capability-first skill artifacts, public read-only pack list/doctor and skill list/check commands, static Godot status/capability commands, private Godot executable discovery and exact-version probing, and plan-only Codex project-configuration and skill-target foundations are implemented. Broader engine process/report parsers, required-test selection, gameplay/capture/performance/build normalizers, broader artifact formats, runtime-frame provenance, assessment persistence, and runtime-to-receipt integration remain planned. Other planned work includes filtered and persistent evidence indexing, receipt-history migration and forensic access, checkpoint/handoff reconciliation, reachable-head retention cleanup, explicit evidence list/show/export commands, approved Codex configuration and skill materialization, and an approved mutating skill lifecycle.

CLI, MCP, documentation, and skill routing must preserve identical command IDs, schema digests, permissions, and handler identities. MCP annotations remain hints and can never override the permission broker. No background upload or telemetry path is planned.

## Stage 4 — Godot alpha

Godot has the first static status/capability adapter, private executable identity/version boundary, and fail-closed headless-preflight admission, and remains the first planned live engine adapter. The next engine checkpoint is a validated containment provider and an actual permission-bound preflight run with retained receipts; it must not promote support until an actual Godot executable is witnessed. The common 3D graybox must then prove movement, camera behavior, collision, a collectible, HUD count, save/load across process restart, failure/restart handling, win state, actual runtime frames, Windows export, and exported-player startup.

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
