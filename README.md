# AI Game Playbook

> Status: control-plane contracts, registry, core safety boundaries, managed-pack transactions, and an experimental source-built `agpb doctor` command are in progress. No installable package, MCP server, or engine adapter exists yet.

[한국어](README.ko.md)

AI Game Playbook is an AI-assisted game-development control plane for individuals and small teams using Godot, Unity, or Unreal Engine. It emphasizes bounded workflows, explicit authority, reproducible evidence, and actual engine behavior rather than code generation alone.

## What exists today

- A private pnpm/TypeScript workspace with versioned schemas, semantic validation, and deterministic digests.
- A typed registry that validates command, skill, workflow, role-lens, schema, and pack descriptors and generates matching CLI, MCP, documentation, and skill-routing metadata.
- Safety primitives for canonical project identity, link-safe path resolution, bounded file reads, staged compare-and-swap writes and deletion, bounded direct process execution, project mutation leases, scoped signed approvals, workflow state, and durable checkpoints.
- A private managed-pack runtime with write-free preflight, exact ownership, add/update/remove transactions, append-only journals, active-transaction barriers, rollback after clear failures, marker-bound directory ownership, and separately approved recovery finalization.
- An experimental private CLI package and repository-local `agpb` entry point. The only implemented command is read-only `agpb doctor`.
- A digest-bound public surface that marks `doctor` available and keeps every other command and all engine capabilities planned.
- English public documentation with Korean mirrors and Windows/Linux conformance checks.

The current CLI slice checks the supported Node.js range, runtime-registry parity, one canonical project root, the fixed project-state directory layout, canonical installed-pack state, and any active pack transaction marker. It emits concise human output or the registered canonical JSON report. It never initializes, repairs, clears, installs, controls an editor, or accesses the network.

Most runtime components remain private libraries. Pack mutation still requires an exact same-process plan, a broker-issued `install` authorization, and an attested project-write lease. The recovery finalizer can close only a stable state already classified by the bounded inspector; it cannot repair pack artifacts or resolve mixed state. Approval reservations and active leases are memory-only, and no general mutation dispatcher or approval UI exists.

## Run the current CLI

No package is published. From a source checkout using the pinned Node.js and pnpm versions:

```text
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
```

`doctor` returns exit code `0` when diagnostics complete without a blocking finding, including attention-level warnings such as uninitialized project state. It returns `3` for a blocking finding, `2` for invalid CLI usage, and `1` if no validated report can be produced.

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
