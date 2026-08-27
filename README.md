# AI Game Playbook

> Status: control-plane contracts, registry, core safety boundaries, managed-pack transactions, durable private receipts and artifact bytes, bounded private receipt-head queries, limited private artifact assessment, closed-world process-containment assessment plus provider/self-test protocols, nine experimental source-built write-free commands including bounded pack inspection, a static Godot status and capability adapter, private permission-bound Godot executable discovery and version probing, a fail-closed Godot headless-preflight admission, a project-bound modern STDIO MCP runtime, eleven registry-derived capability-first skill artifacts, and a write-free Codex setup planner are in progress. No installable package or live engine bridge exists yet.

[한국어](README.ko.md)

AI Game Playbook is an AI-assisted game-development control plane for individuals and small teams using Godot, Unity, or Unreal Engine. It emphasizes bounded workflows, explicit authority, reproducible evidence, and actual engine behavior rather than code generation alone.

## What exists today

- A private pnpm/TypeScript workspace with versioned schemas, semantic validation, and deterministic digests.
- A typed registry that validates command, skill, workflow, role-lens, schema, and pack descriptors and generates matching CLI, MCP, documentation, and skill-routing metadata.
- Safety primitives for canonical project identity, link-safe path resolution, bounded file reads, staged compare-and-swap writes and deletion, bounded direct process execution, closed-world fail-closed containment assessment with same-process witnesses, project mutation leases, scoped signed approvals, workflow state, durable checkpoints, append-only run receipts, and immutable content-addressed artifact objects with receipt-attested manifests.
- Strict path-free containment-provider descriptor and bounded self-test request/report protocols with fixed negative probes, canonical digest binding, and verified-outcome consistency. The compiled provider catalog is empty, and no self-test runner or launch authority exists.
- Private evidence boundaries that query canonical receipt heads within fixed limits, normalize bounded process and structured test observations, and assess retained UTF-8 text, canonical JSON, non-interlaced PNG bytes, and registered asset provenance without returning raw content.
- A private managed-pack runtime with write-free preflight, exact ownership, add/update/remove transactions, append-only journals, active-transaction barriers, rollback after clear failures, marker-bound directory ownership, and separately approved recovery finalization.
- An internal-only Godot executable discovery boundary that prepares from project-only evidence, requires a signed single-use `host-tool-inspection` approval before reading exact configured candidates or fixed direct names in selected PATH directories, performs no recursive search or process launch, and returns identity digests without source paths.
- An internal-only Godot version probe that accepts only a candidate from the original same-process discovery report, requires a second exact host-tool approval, runs only `--version` with fixed process-tree, time, idle, environment, and output bounds, settles effects, and returns digest attestations without raw paths or process output.
- An internal-only Godot headless-preflight admission that binds the original version report, exact project and executable identities, one finite registered workflow, fixed startup arguments, a core-produced containment witness, and a third signed approval. The closed provider catalog currently has no validated provider, so the assessment returns only `block`; the adapter binds its digests into authorization, report, and receipt evidence, starts no engine process, settles the lease as a clean failure, and keeps support at `planned`.
- An experimental private CLI package and repository-local `agpb` entry point. The implemented commands are plan-only `agpb init`; read-only `agpb doctor`, `agpb project inspect`, `agpb pack list`, `agpb pack doctor`, `agpb skill list`, and `agpb skill check`; and static read-only `agpb engine status --engine godot` and `agpb engine capabilities --engine godot`.
- An experimental private MCP package that exposes only explicitly enabled, registry-generated read-only tools over modern STDIO. It binds one project identity, validates exact input and output schemas, bounds transport and result bytes, and performs no network or project mutation.
- A private skill runtime and Codex adapter that bind eleven deterministic capability-first skill artifacts to the generated registry: asset lifecycle, build/export readiness, engine change safety, evidence support review, feature-contract planning, gameplay vertical slices, performance budget review, deterministic playtesting, project inspection, save/load integrity, and game UI QA. They inspect the eleven project targets, route eligible static Godot capability reporting only from project inspection, and render and inspect one machine-specific local-only MCP configuration. The skill runtime can also prepare a same-process, two-observation, write-free materialization plan for the fixed 13 directories and 11 files, with create/retain/conflict classifications, freshness digests, and rollback-aware budgets but without source paths or desired file content. No executor or supported install command exists; these paths never create, write, merge, or materialize a project skill.
- A digest-bound public surface that marks bounded pack inspection and both static Godot engine commands available while keeping pack mutation, every mutating skill command, and all live-engine capabilities and support grades planned.
- English public documentation with Korean mirrors and Windows/Linux conformance checks.

The current CLI slice can plan a fixed 20-target `.ai-game-playbook/` layout; diagnose the supported Node.js range, runtime-registry parity, project state, installed-pack state, and active transaction markers; inspect bounded Godot, Unity, or Unreal project markers plus a canonical committed project profile; list installed-pack identities and bounded ownership counts without artifact content or source locations; inspect owned artifact and directory integrity plus active recovery state without repair or finalization; list and check the bounded registry skill catalog; compare one detected Godot project version hint with the pinned `4.7.2` status target; and report the 14 common Godot operation contracts against that same static identity. Project inspection reports dirty state as unknown when only `.git` is observed and never treats a static lock as a process or selectable Editor session. Both engine commands accept only `--engine godot` and no host executable or provider input. Every reported operation remains `planned` and `documented`, the compiled containment-provider catalog is empty, provider self-test is not run, and launch remains unavailable. All nine commands emit concise human output or registered canonical JSON and perform no writes, process launches, network access, or Editor control.

Public pack inspection is read-only; pack add, update, remove, repair, and transaction finalization remain unavailable.

Most runtime components remain private libraries. Pack mutation still requires an exact same-process plan, a broker-issued `install` authorization, and an attested project-write lease. Godot executable discovery, version probing, and headless-preflight admission are not CLI or MCP tools. Discovery accepts only bounded explicit sources, exposes neither source paths nor transferable execution authority, and settles one signed single-use host-tool approval. Version preparation accepts only the original same-process discovery report, and process dispatch requires a separate approval bound to the selected executable digests. Preflight accepts only that original completed report and exact registered workflow authority, obtains a path-free containment assessment for the exact project root, and rechecks the original assessment witness immediately before admission. A copied JSON report grants no authority. The current provider catalog is empty and the process layer does not enforce filesystem, network, or child-process containment, so preflight starts no project process and retains only a permission-bound blocked receipt whose input and diagnostics attest the assessment and provider-catalog digests. These paths have local automated witnesses, but no retained run from an actual Godot executable exists, so they do not raise engine support above `planned`. The recovery finalizer can close only a stable state already classified by the bounded inspector; it cannot repair pack artifacts or resolve mixed state. A private promotion API snapshots each complete project-local artifact into an immutable SHA-256 object. The receipt directly attests each canonical manifest digest and original source path, while each manifest binds the retained object and source to the receipt execution context, project, runtime, registry, command, and handler. Receipt persistence and reload require those bytes and manifests to remain exact. A bounded private query validates the fixed receipt-directory inventory, canonical heads, and latest-record presence within caller-selected caps. It returns frozen summaries and requires its original same-process witness before the existing full-chain loader can read a selected run; malformed record content is not treated as validated by the summary. A separate private assessment revalidates the receipt, retained object, and manifest before and after reading one target, then performs bounded UTF-8, canonical JSON, or non-interlaced PNG inspection and optional current-registry `AssetProvenance` matching. Its result is not persisted. Interlaced PNG, other formats, runtime-frame provenance, engine-backed QA, retention and cleanup, CLI or MCP list/show/export operations, and migration-ready historical access do not exist yet. Approval reservations and active leases are memory-only, and no general mutation dispatcher or approval UI exists.

## Run the current CLI

No package is published. From a source checkout using the pinned Node.js and pnpm versions:

```text
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- init --project <project-path>
pnpm run agpb -- init --project <project-path> --json
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
pnpm run agpb -- project inspect --project <project-path>
pnpm run agpb -- project inspect --project <project-path> --json
pnpm run agpb -- pack list --project <project-path>
pnpm run agpb -- pack list --project <project-path> --json
pnpm run agpb -- pack doctor --project <project-path>
pnpm run agpb -- pack doctor --project <project-path> --json
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill list --project <project-path> --json
pnpm run agpb -- skill check --project <project-path>
pnpm run agpb -- skill check --project <project-path> --json
pnpm run agpb -- engine status --engine godot --project <project-path>
pnpm run agpb -- engine status --engine godot --project <project-path> --json
pnpm run agpb -- engine capabilities --engine godot --project <project-path>
pnpm run agpb -- engine capabilities --engine godot --project <project-path> --json
```

`init` returns exit code `0` when its write-free layout plan has no path conflict and `3` when the selected root or a planned target is blocked. `doctor` returns `0` when diagnostics complete without a blocking finding, including attention-level warnings such as uninitialized project state, and `3` for a blocking finding. `project inspect` returns `0` for a validated static report with nonblocking unknowns and `3` for an unavailable root, invalid or mismatched profile, or ambiguous engine selection. `pack list` returns `0` for a bounded stable listing or an uninitialized project and `3` for unavailable, incomplete, malformed, or transaction-active state. `pack doctor` returns `0` for healthy or attention-level integrity findings and `3` for unsafe state, drift, or recovery-required transactions; it never repairs or finalizes. `skill list` returns `0` for a bound catalog and `3` for an unavailable project. `skill check` returns `0` for missing or current targets and `3` for a conflict, unsafe path, oversized target, or unavailable project. `engine status` returns `0` for a compatible static Godot observation with attention-level gaps and `3` for unavailable, ambiguous, or incompatible project evidence. `engine capabilities` returns `0` for an identity-bound static Godot operation catalog with explicit attention gaps and `3` when a compatible unambiguous project identity cannot be established. All nine return `2` for invalid CLI usage and `1` if no validated report can be produced.

## Product direction

The first complete product target is an offline, single-player 3D vertical slice for Windows x64, built by an individual or a team of up to five people. The intended loop is:

1. Inspect the project and negotiate available engine capabilities.
2. Define a bounded feature contract and permission budget.
3. Change source or editor state through one project-scoped execution lane.
4. Compile or import, test, play, replay deterministic input, and capture actual runtime evidence.
5. Build or export, record a receipt, and roll back safely when needed.

Godot, Unity, and Unreal Engine are the only planned first-party engines. Web-game frameworks, multiplayer, mobile, console, XR, and macOS validation are outside the first alpha.

## Design promises

- One typed registry defines every exposed command. CLI help and dispatch consume the same validated descriptor and schema identity.
- Unsupported capabilities degrade explicitly; lower-grade evidence cannot be labeled `verified`.
- Editor mutations are serialized per project and stop when identity or dirty-file state becomes ambiguous.
- Installation, networking, external transmission, paid calls, destructive actions, and publishing require separate approval.
- Telemetry is not planned. Evidence leaves the local project only through an explicit export action.
- Engines, editors, Blender, and other system tools are detected but never installed automatically.
- Uncertain mutation is never automatically retried.

## Read the design

- [Documentation index](docs/README.md)
- [Current status and scope](docs/status-and-scope.md)
- [Core concepts and public types](docs/concepts.md)
- [Command-line interface status](docs/planned-cli.md)
- [Target architecture](docs/architecture.md)
- [Engine support model](docs/engine-support.md)
- [Security and permissions](docs/security-and-permissions.md)
- [Assets and provenance](docs/assets-and-provenance.md)
- [Evidence and verification](docs/evidence-and-verification.md)
- [Roadmap](docs/roadmap.md)

## Installation and releases

The repository-local executable is not an installable product package. Do not install similarly named packages expecting this project. Package installation documentation will be added only after clean install, same-version reinstall, update, conflict, rollback, and uninstall checks pass without touching non-owned files.

## Project status and licensing

Interfaces may change during implementation. The project license has not been selected, so do not assume redistribution rights until a license file is added. No package publication or release is planned before that decision and the relevant verification gates.
