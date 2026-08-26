# Target Architecture

> Status: target architecture with a partial control plane. Contracts, the runtime registry, core safety primitives, durable private receipt records and artifact objects, bounded private receipt-head queries, pure process/test result normalization, limited retained-artifact assessment, managed-pack transactions, six write-free `agpb` commands including static Godot status, private permission-bound Godot executable discovery and version probing, a project-bound read-only STDIO MCP runtime, a registry-derived project-inspection skill artifact, and a write-free Codex setup planner exist. General mutation dispatch, evidence export, applied host installation, live engines, and bridges remain planned.

[한국어](architecture.ko.md) · [Documentation](README.md)

## Overview

The repository uses a pnpm workspace for a Node.js/TypeScript control plane. Engine-specific bridges are planned to remain thin: C# for Unity, Python/C++ for Unreal, and GDScript for Godot. Python is otherwise introduced only for isolated Blender or ML workloads.

```mermaid
flowchart TD
    H[Codex or another host] --> S[CLI / MCP / host adapter]
    S --> R[Typed runtime registry]
    R --> P[Permission broker]
    P --> W[Bounded workflow runtime]
    W --> E[Receipt and evidence store]
    W --> A[Engine adapter]
    A --> B[Thin project bridge]
    B --> G[Godot / Unity / Unreal]
    W --> F[Safe filesystem and process layer]
```

The typed registry is the authoring source for command, skill, role-lens, workflow, schema, and pack descriptors. Generation creates CLI, MCP, documentation, and skill-routing metadata from the same validated identity. The public runtime surface currently contains `init`, `doctor`, `project.inspect`, `skill.list`, `skill.check`, and `engine.status`; CLI help, parsing, input/output validation, and dispatch consume those exact descriptors. The registry also owns internal `engine.executable-discovery` and `engine.version-probe` descriptors that are excluded from CLI, MCP, and generated public command inventory. The experimental MCP runtime registers an explicitly selected read-only subset from the generated MCP metadata and exact schemas. The public foundation plan records the runtime-registry digest and keeps unimplemented commands separate.

## Workspace boundaries

| Boundary | Status | Responsibility |
| --- | --- | --- |
| `contracts` | Foundation implemented | Versioned schemas, canonical data, identifiers, approval, workflow, engine, evidence, init-plan, doctor, project-inspection, static engine-status, Godot executable-discovery, and version-probe protocols |
| `registry` | Foundation implemented | Descriptor validation, generation, digesting, routing, workflow-plan resolution, and exact implemented-command inventory |
| `core` | Partial | Canonical project identity, safe paths, compare-and-swap filesystem operations, bounded processes, mutation leases, in-memory permission admission, workflow state, durable checkpoints, append-only run receipts, bounded receipt-head queries, and private artifact promotion |
| `pack-runtime` | Partial | Write-free preflight, exact ownership, local lifecycle transactions, journals, active barriers, rollback, directory ownership, recovery inspection, and approved stable-state finalization |
| `skill-runtime` | Partial private foundation | Registry-bound packaged skill catalog, bounded artifact validation, same-process project plans, and write-free target inspection; materialization is unavailable |
| `cli` | Experimental partial | Registry-derived help/version, fail-closed parsing, stable exit categories, human/JSON output, plan-only `init`, read-only `doctor`, `project inspect`, `skill list`, `skill check`, and static Godot `engine status` |
| `evidence` | Partial private foundation | Pure bounded-process and structured-test normalization plus limited retained-artifact format/provenance assessment exist alongside canonical receipt records, content-addressed bytes, and producer-bound manifests; engine report parsing, assessment persistence, retention, migration, CLI/MCP listing, and explicit export remain planned |
| `mcp` | Experimental private runtime | Modern STDIO transport for an explicit generated read-only tool allowlist, exact project binding, schema parity, bounded messages, and canonical results; mutation and network tools are unavailable |
| `codex-adapter` | Partial private planner | Deterministic local-only project MCP configuration and project-inspection skill target planning plus create/retain/conflict inspection without writes, merge, trust changes, or skill materialization |
| `engine-common` | Contract only | Common capability negotiation and engine-operation contracts |
| `godot-adapter` | Experimental private boundary | Project-only public status plus signed single-use host-tool discovery and exact-version probing; no support promotion or live-engine claim |
| Unity and Unreal adapters | Planned | Engine-specific orchestration without broad host authority |
| Project bridges | Planned | Minimum editor/runtime code needed to expose verified operations |

A partial package is not a claim that its full product surface exists. No current package controls an editor or verifies a live engine frame.

## Current write-free execution flows

The implemented CLI path is deliberately narrow:

1. Parse only global help/version or the exact `init`, `doctor`, `project inspect`, `skill list`, `skill check`, and `engine status --engine godot` commands with their declared flags.
2. Obtain the selected command descriptor from the validated runtime registry.
3. Validate the request against the descriptor-bound input schema.
4. For `init`, bind one canonical root and classify the fixed 16-target layout without writing. For `doctor`, inspect registry parity, Node.js version, project identity, fixed state directories, installed-pack state, and active transaction marker without writing. For `project inspect`, list the root deterministically, resolve selected marker paths through the bound root, read bounded marker/profile files twice through stable identities, and preserve dirty/process gaps without external execution. For `skill list` and `skill check`, bind the generated stable skill route, validate the packaged artifact, and expose only bounded catalog metadata or target observations without materialization. For `engine status`, reuse the exact project inspection, require one complete Godot candidate, compare its major/minor hint with `4.7.2`, and preserve missing executable/runtime evidence without accepting a host path.
5. Derive plan or diagnostic status from bounded target/check outcomes.
6. Validate semantic counts, identity and digest bindings where applicable, then validate the complete report against the descriptor-bound output schema.
7. Render human or canonical JSON output and map it to a stable exit category.

Handler digests attest all eight registered compiled command modules: six public write-free commands and two internal Godot operations. Cross-package tests fail if any executable artifact and registry metadata drift.

The private Godot host-tool flow is separate from public status. Preparation first binds only the project and a digest of bounded explicit sources. The broker then requires a signed single-use `host-tool-inspection` grant before exact candidate files are read. Discovery checks configured paths and fixed direct executable names in selected PATH directories without recursion or process launch, settles the lease, and returns an original same-process report without source paths or execution authority. Version preparation accepts only a selected candidate from that report; a second grant bound to the executable content and identity digests is required before the bounded `--version` process can start. Cloned plans, reports, or authorization decisions cannot carry authority across the runtime boundary.

The current MCP path is also write-free. Startup requires one project root, one or more explicit generated tool names, and acknowledgement that selected project diagnostics may enter the active host context. The runtime binds the canonical project identity, registers only read-only closed-world tools, limits each STDIO message to 1 MiB, validates exact registered input and output schemas, and returns canonical bounded results. It has no HTTP transport, network access, editor control, or mutation route.

The shared skill runtime owns packaged artifact validation and write-free project-target observation. The Codex adapter consumes that same plan, derives the current supported Node.js executable and this installation's MCP entry point rather than accepting caller-selected runtime code, and produces immutable bytes for one project-local `.codex/config.toml` and one `.agents/skills/project-inspection/SKILL.md` target. It classifies each target as create, retain, or conflict while rechecking project and runtime identities. The packaged skill source must be a bounded canonical regular file whose UTF-8, LF-only frontmatter, name, and SHA-256 digest match the generated registry route. Neither runtime creates a parent directory, writes or merges a target, changes project trust, or installs a skill.

## Planned mutating execution flow

The general flow remains a target rather than an executable CLI path:

1. Detect a project and build an exact `GameProjectProfile`.
2. Negotiate an `EngineCapabilityReport`; unsupported operations retain a reason and evidence gap.
3. Validate a `FeatureContract`, permission classes, budgets, owned paths, and expected dirty state.
4. Resolve and attest a finite workflow plan against the current registry and project stage.
5. Acquire one project mutation lane and, when needed, bind one exact editor session.
6. Execute registered commands with bounded output, timeout, cancellation, and no default mutation retry.
7. Persist state transitions, receipts, and evidence.
8. Reconcile identity and dirty state after reload, restart, failure, or rollback.

Unknown mutation state goes to `uncertain` and cannot return directly to execution.

## Consumer project state

A consuming game project is planned to contain `.ai-game-playbook/`. Portable profiles, feature contracts, policies, and pack locks are commit-worthy. Cache, logs, screenshots, local receipts, locks, secrets, and machine-specific configuration remain ignored.

The plan-only `init` command reports 16 fixed targets spanning committed metadata intent and local-only runtime intent. It never supplies profile/policy bytes or calls a mutation primitive. The implemented private bootstrap can create only 11 fixed runtime directories, including receipt, artifact-object, and artifact-manifest directories. It is idempotent, rejects links and case aliases, verifies parent and target identities, and removes only directories created by a clearly failed call. `doctor` reads this layout but never calls the bootstrap. `project inspect` may validate the fixed committed profile path, but it cannot create, repair, or promote profile data.

The private receipt and artifact stores require their fixed local directories to exist. Artifact promotion snapshots each complete project-local source into a digest-addressed immutable object. The promoted receipt directly attests each canonical manifest digest and original source path; each manifest binds the retained object and source to the receipt execution context, project and runtime identity, registry, command descriptor, and handler. Receipt persistence binds the same authority to canonical immutable records behind a compare-and-swap run head. Reload validates the bounded predecessor chain and reopens each complete artifact object and manifest twice within the declared byte budget; the original source may change after promotion without changing the retained evidence. A separate bounded query validates every fixed-directory entry, each canonical head, and its latest-record presence before returning frozen summaries. Detailed load requires the original same-process query witness and reuses the full-chain verifier, so a summary never becomes receipt or artifact proof. Corrupt, relocated, rebound, or competing state is preserved and rejected. The stores themselves do not perform format/decode QA, retention cleanup, evidence CLI operations, export, or historical-registry migration.

The private evidence package also converts already-bounded process observations and already-structured test-report observations into immutable component outcomes. It revalidates process identity, timing, output counters, and termination invariants; preserves cancellation and termination uncertainty; and never copies raw stdout or stderr into the normalized result. Test normalization distinguishes an unavailable or inconsistent report, zero discovered tests, all-skipped execution, assertion failure, missing required test IDs, and a process failure after a passing report. A separate assessor verifies one promoted complete artifact before and after reading its retained object, then performs a maximum-16-MiB UTF-8, exact canonical JSON, or non-interlaced PNG inspection. Optional `AssetProvenance` assessment uses the exact current in-process registry and requires its current-file path, digest, and byte count to match the artifact. Interlaced PNG degrades to `unverified`; no raw content is returned. The assessment is not written to a receipt or sidecar and cannot establish runtime-frame origin, engine import quality, or production readiness. The package does not execute a process, parse an engine report, discover required tests, persist a receipt, or verify an engine.

Pack preflight binds the validated registry, source and target root identities, local artifact bytes, installed-state digest, intended changes, conflicts, and limits into a same-process immutable plan. Execution additionally requires exact `install` authorization and an attested project-write lease. Canonical installed state is committed last. Clear failures roll back already committed files in reverse; uncertain effects stop without retry.

An active marker and append-only journal preserve interruption state. The read-only recovery inspector performs two bounded observations. A separate finalizer requires a fresh exact approval and lane, re-inspects before each closure boundary, may close only an attested stable state, and never repairs artifacts or resolves mixed state. `doctor` only reports malformed installed state or marker presence; it does not invoke that recovery path.

## Identity and execution lanes

Runtime authority is planned to bind project root identity, project profile digest, feature contract digest, process executable and start identity, editor session nonce, scene or world identity, registry digest, handler digest, and pack digest where relevant. PID, port, process name, or window title alone is insufficient.

Execution lanes are:

- `parallel-read` for bounded immutable inspection;
- `project-write` for project source and managed metadata;
- `editor-bound` for one exact editor session inside project serialization; and
- `build-bound` for approved test and build work.

The current `init`, `doctor`, `project inspect`, `skill list`, `skill check`, and static `engine status` descriptors declare `parallel-read`, but general parallel-reader coordination is not yet implemented. Mutating lanes remain one lease per project and require explicit renewal.

## Engine adapter boundary

The common target contract is `detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`.

Each adapter must separate offline inspection, headless execution, editor preview, actual play, and packaged runtime evidence. Thin bridges receive only typed bounded operations. They must authenticate the exact project/session, limit request and output sizes, report both outer transport and inner operation outcomes, and return changed objects, files, save/import state, logs, and evidence locators.

Godot now has the first static adapter boundary and a private permission-bound executable identity/version boundary. Its public command still accepts no executable path, and the private probe does not establish headless project execution, editor control, runtime frames, or retained engine evidence. Live Godot execution and the Unity and Unreal adapters remain planned. The current engine support grade for all three remains `planned`.

## Degradation and support claims

Capability grades are `planned`, `detected`, `headless`, `editor-preview`, and `verified`. A command being available does not raise an engine capability grade. Missing tools, ambiguous instances, unavailable live editors, absent tests, incomplete captures, and unknown performance environments must produce explicit degradation or an unverified outcome.

Windows x64 is the first build target. Linux is initially a static/headless control-plane CI target. macOS, mobile, console, XR, multiplayer, and browser-first games remain outside the first alpha.
