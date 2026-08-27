# Current Status and Scope

> Status: Stage 2 control-plane implementation in progress, reviewed on 2026-08-27. Nine write-free source-built commands including bounded pack inspection, a closed-world process-containment assessment with strict provider/self-test protocols and an empty compiled catalog, a static Godot status and capability adapter, internal permission-bound Godot executable discovery and version probing, assessment-bound fail-closed headless-preflight admission with blocked receipt retention, and an explicit read-only STDIO MCP runtime exist; Codex setup remains plan-only and live-engine support remains planned.

[한국어](status-and-scope.ko.md) · [Documentation](README.md)

## Current repository state

The repository contains a private pnpm/TypeScript workspace, versioned schemas, semantic validators, typed registry validation and generation, deterministic workflow-plan attestation, a runtime registry for implemented commands, a digest-bound public surface, tests, Windows/Linux CI, an early core package with fail-closed containment assessment and an immutable empty compiled provider catalog, a private evidence package, managed-pack and skill runtimes, a static Godot status and capability adapter with internal permission-bound executable discovery, exact-version process, and assessment-bound fail-closed headless-preflight boundaries, an experimental CLI package, an experimental MCP package, and a plan-only Codex adapter package.

Implemented core boundaries include:

- canonical project-root binding and portable path resolution without writable link traversal;
- bounded deterministic root-entry, directory, and file inspection;
- staged SHA-256 compare-and-swap writes, deletion, and reversible empty-directory removal;
- digest-bound direct process execution with environment, working-directory, time, idle, and output limits;
- a path-free process-containment assessment bound to one exact root and fixed project-write/network/child-process denial policy, with an empty closed provider catalog, immutable `block` reports, and same-process witness checks;
- strict path-free provider descriptor and bounded self-test request/report schemas that bind implementation, catalog, host, challenge, fixture, timing, ordered negative probes, effects, and derived outcomes without granting launch authority;
- one root/project-bound mutation lease with bounded waiting and dead-owner-only recovery;
- schema-bound permission admission, exact scoped signed grants, and effect settlement;
- deterministic workflow-plan resolution and immutable state transitions;
- canonical append-only checkpoint chains with restart classification;
- canonical append-only run-receipt records with compare-and-swap heads, exact authority binding, and redaction checks;
- bounded whole-directory receipt-head queries with canonical filename checks, latest-record presence, same-process load witnesses, and fixed entry/head/byte limits;
- private promotion of complete project-local artifact snapshots into immutable SHA-256 objects with receipt-attested manifests;
- fail-closed normalization of bounded process and structured test-report observations without copying raw process output;
- an internal Godot executable-discovery boundary with project-only preparation, exact bounded source selection, a signed single-use `host-tool-inspection` approval, no recursion or process launch, post-scan identity checks, effect settlement, and no source-path result fields;
- an internal Godot `--version` executor that accepts only an original same-process discovery candidate and requires a second signed single-use approval bound to exact executable digests, with fixed process-tree/time/idle/output limits, post-run identity checks, effect settlement, no raw path/output result fields, and explicit `not-enforced` filesystem/network isolation;
- an internal Godot headless-preflight admission that accepts only the original completed version report, binds exact project/executable/workflow/invocation identities plus the core-produced containment assessment to a third signed approval, rechecks the original witness immediately before admission, and retains a digest-bound canonical blocked receipt while starting zero project processes;
- fail-closed assessment of one retained UTF-8, canonical JSON, or non-interlaced PNG artifact with optional current-registry `AssetProvenance` matching and no raw-content output;
- modern STDIO registration of an explicit generated read-only tool subset with exact project binding, host-disclosure acknowledgement, schema validation, bounded messages, and canonical results; and
- deterministic planning and inspection of one machine-specific local-only Codex project MCP configuration and one registry-derived project-inspection skill target, including eligible static Godot capability routing, without filesystem mutation.

The private pack runtime implements write-free preflight, canonical installed state, exact dependencies and ownership, local add/update/remove transactions, active markers, append-only journals, compare-and-swap promotion, clear-failure rollback, marker-bound direct-parent directory ownership, reversible tombstones, bounded recovery inspection, and separately approved stable-state finalization.

The source-built `agpb` executable currently exposes plan-only `init`; read-only `doctor`, static `project inspect`, `pack list`, `pack doctor`, `skill list`, and `skill check`; and static read-only `engine status --engine godot` and `engine capabilities --engine godot`. `init` classifies a fixed 20-target project-local layout and emits an identity-bound `InitReport`; it cannot apply the plan. `doctor` checks runtime-registry parity, the supported Node.js range, one canonical project root, the fixed runtime layout, installed-pack-state validity, and active transaction markers. `project inspect` reports bounded Godot, Unity, and Unreal marker candidates, canonical profile validity and compatibility, marker-only dirty-state knowledge, and unbound static Editor signals. `pack list` reports bounded installed identity and ownership counts without artifact content, paths, or source locations. `pack doctor` verifies bounded artifact and directory ownership plus active recovery state without repair, marker clearing, or finalization. `skill list` returns a bounded registry catalog without artifact bodies or absolute source paths. `skill check` revalidates packaged skill identity and reports missing, current, conflicting, oversized, or unsafe project targets without materialization. `engine status` requires one complete Godot candidate, compares its version hint with the pinned `4.7.2` target, and preserves missing executable and live-engine evidence as attention gaps. `engine capabilities` reuses that status boundary and, only for a compatible unambiguous Godot identity, returns all 14 common operations as `planned` and `documented` with explicit limitations, permissions, evidence duties, and unavailable containment launch. All nine produce human or canonical JSON output from registered reports and perform no writes.

The source-built MCP runtime exposes only tool names explicitly selected at startup from the generated registry surface. Its current tools are the same nine write-free commands, including bounded pack inspection and project-only Godot status and capabilities; it does not expose mutation, repair, recovery finalization, network, executable/provider input, engine process execution, evidence export, or arbitrary handler execution. The runtime registry routes one bounded `project.inspection` skill to static inspection and, only for an eligible Godot observation, static capability reporting. A shared skill runtime verifies its packaged artifact and supplies the same catalog and target observations to CLI, MCP, and Codex setup. The Codex adapter derives the current Node.js and MCP entry identities, renders a prompt-mode project configuration and deterministic project-skill bytes, and classifies each target as absent, exact, conflicting, oversized, linked, or case-aliased. It does not write either target, merge an existing file, mark a project trusted, or install a skill.

## What is not available

There is no installable or published package, supported MCP/Codex setup command, configuration apply path, materialized project skill, general command dispatcher, approval UI, durable approval store, evidence CLI or export path, public executable discovery, version probe, or headless preflight, containment self-test runner, registered containment provider, launch handle, mutating pack CLI, recovery-finalization command, CPU, memory, filesystem, network, or child-process sandbox, engine bridge, engine pack, live-engine automation, or playable golden project.

Mutating initialization, pack add/update/remove and recovery finalization, `skill install`, MCP/Codex configuration apply, project-skill materialization, live capability negotiation, `engine connect`, engine-backed operations, workflow execution, verification, evidence commands, and documentation command integration remain planned. Private library functions are not public commands. The runtime registry exposes none of those planned operations.

Project-state bootstrap, artifact promotion, receipt persistence and bounded head query, component result normalization, retained-artifact assessment, process-containment assessment, pack mutation, recovery inspection, recovery finalization, permission-bound executable discovery, the permission-bound Godot exact-version process, and the workflow-bound headless-preflight admission remain private APIs. The current `init` can report layout intent and conflicts but cannot create profile, policy, ignore, or runtime-state bytes. The current doctor can identify unsafe state but cannot initialize, repair, clear, classify recovery, or finalize it. Project inspection and both public Godot engine commands do not run Git, discover executables, enumerate processes, establish Editor liveness or session identity, validate stage evidence content, connect to an engine, or raise an engine support grade. Their public requests cannot select a host executable, containment provider, self-test, or launch path. Private discovery checks only approved exact sources, performs no recursive search or process launch, and returns no source paths or execution authority. The private version executor accepts only its original same-process selected report and requires separate process authority; it is not headless project validation, Editor connection, or runtime verification. The current preflight boundary obtains and rechecks an exact same-process containment witness, but the provider catalog is empty and the assessment can only return `block`; it never starts the project process and is not engine evidence. The assessment is not a CPU, memory, filesystem, network, or child-process sandbox. No actual Godot binary has been witnessed. The workflow runtime is not connected to general dispatch. Durable receipt JSON, bounded head summaries, bounded content-addressed artifact bytes, pure process/test outcome normalization, limited Godot version-output parsing, and limited UTF-8/canonical-JSON/non-interlaced-PNG plus provenance assessment exist. A head summary proves only canonical head data and latest-record presence; full-chain validity still requires the original same-process query witness and detailed load. Broader engine process/report parsing, broader format/decode QA, assessment persistence, runtime-frame provenance, retention, historical migration, evidence commands, and export do not.

All Godot, Unity, and Unreal live-engine support grades remain `planned`. Availability of `init`, `doctor`, `project inspect`, `pack list`, `pack doctor`, `skill list`, `skill check`, static `engine status`, and static `engine capabilities` is a control-plane command status, not engine execution evidence.

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
