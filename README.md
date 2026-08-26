# AI Game Playbook

> Status: control-plane contracts, registry, core safety boundaries, managed-pack transactions, durable private receipts and artifact bytes, bounded private receipt-head queries, limited private artifact assessment, five experimental source-built write-free commands, a project-bound modern STDIO MCP runtime, one registry-derived project-inspection skill artifact, and a write-free Codex setup planner are in progress. No installable package or engine adapter exists yet.

[한국어](README.ko.md)

AI Game Playbook is an AI-assisted game-development control plane for individuals and small teams using Godot, Unity, or Unreal Engine. It emphasizes bounded workflows, explicit authority, reproducible evidence, and actual engine behavior rather than code generation alone.

## What exists today

- A private pnpm/TypeScript workspace with versioned schemas, semantic validation, and deterministic digests.
- A typed registry that validates command, skill, workflow, role-lens, schema, and pack descriptors and generates matching CLI, MCP, documentation, and skill-routing metadata.
- Safety primitives for canonical project identity, link-safe path resolution, bounded file reads, staged compare-and-swap writes and deletion, bounded direct process execution, project mutation leases, scoped signed approvals, workflow state, durable checkpoints, append-only run receipts, and immutable content-addressed artifact objects with receipt-attested manifests.
- Private evidence boundaries that query canonical receipt heads within fixed limits, normalize bounded process and structured test observations, and assess retained UTF-8 text, canonical JSON, non-interlaced PNG bytes, and registered asset provenance without returning raw content.
- A private managed-pack runtime with write-free preflight, exact ownership, add/update/remove transactions, append-only journals, active-transaction barriers, rollback after clear failures, marker-bound directory ownership, and separately approved recovery finalization.
- An experimental private CLI package and repository-local `agpb` entry point. The implemented commands are plan-only `agpb init`; read-only `agpb doctor` and `agpb project inspect`; and read-only `agpb skill list` and `agpb skill check`.
- An experimental private MCP package that exposes only explicitly enabled, registry-generated read-only tools over modern STDIO. It binds one project identity, validates exact input and output schemas, bounds transport and result bytes, and performs no network or project mutation.
- A private skill runtime and Codex adapter that bind one deterministic project-inspection skill artifact to the generated registry, inspect its project target, and render and inspect one machine-specific local-only MCP configuration. They never write or merge either target and do not materialize project skills.
- A digest-bound public surface that marks `init`, `doctor`, `project inspect`, `skill list`, and `skill check` available while keeping every mutating skill command and all engine capabilities planned.
- English public documentation with Korean mirrors and Windows/Linux conformance checks.

The current CLI slice can plan a fixed 16-target `.ai-game-playbook/` layout; diagnose the supported Node.js range, runtime-registry parity, project state, installed-pack state, and active transaction markers; inspect bounded Godot, Unity, or Unreal project markers plus a canonical committed project profile; list the bounded registry skill catalog; and classify the corresponding project skill target as missing, current, conflicting, oversized, or unsafe. Project inspection reports dirty state as unknown when only `.git` is observed and never treats a static lock as a process or selectable Editor session. All five commands emit concise human output or registered canonical JSON and perform no writes, process launches, network access, or Editor control.

Most runtime components remain private libraries. Pack mutation still requires an exact same-process plan, a broker-issued `install` authorization, and an attested project-write lease. The recovery finalizer can close only a stable state already classified by the bounded inspector; it cannot repair pack artifacts or resolve mixed state. A private promotion API snapshots each complete project-local artifact into an immutable SHA-256 object. The receipt directly attests each canonical manifest digest and original source path, while each manifest binds the retained object and source to the receipt execution context, project, runtime, registry, command, and handler. Receipt persistence and reload require those bytes and manifests to remain exact. A bounded private query validates the fixed receipt-directory inventory, canonical heads, and latest-record presence within caller-selected caps. It returns frozen summaries and requires its original same-process witness before the existing full-chain loader can read a selected run; malformed record content is not treated as validated by the summary. A separate private assessment revalidates the receipt, retained object, and manifest before and after reading one target, then performs bounded UTF-8, canonical JSON, or non-interlaced PNG inspection and optional current-registry `AssetProvenance` matching. Its result is not persisted. Interlaced PNG, other formats, runtime-frame provenance, engine-backed QA, retention and cleanup, CLI or MCP list/show/export operations, and migration-ready historical access do not exist yet. Approval reservations and active leases are memory-only, and no general mutation dispatcher or approval UI exists.

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
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill list --project <project-path> --json
pnpm run agpb -- skill check --project <project-path>
pnpm run agpb -- skill check --project <project-path> --json
```

`init` returns exit code `0` when its write-free layout plan has no path conflict and `3` when the selected root or a planned target is blocked. `doctor` returns `0` when diagnostics complete without a blocking finding, including attention-level warnings such as uninitialized project state, and `3` for a blocking finding. `project inspect` returns `0` for a validated static report with nonblocking unknowns and `3` for an unavailable root, invalid or mismatched profile, or ambiguous engine selection. `skill list` returns `0` for a bound catalog and `3` for an unavailable project. `skill check` returns `0` for missing or current targets and `3` for a conflict, unsafe path, oversized target, or unavailable project. All five return `2` for invalid CLI usage and `1` if no validated report can be produced.

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
