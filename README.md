# AI Game Playbook

> Status: control-plane contracts, registry, early core safety boundaries, and a private managed-pack transaction runtime are in progress. No installable package, `agpb` executable, MCP server, or engine adapter exists yet.

[한국어](README.ko.md)

AI Game Playbook is a planned AI-assisted game-development harness for small teams building with Godot, Unity, or Unreal Engine. It is designed around bounded workflows, explicit permissions, reproducible evidence, and real engine behavior rather than code generation alone.

## What exists today

- A pnpm/TypeScript workspace with versioned public schemas and semantic validation.
- A typed registry that validates command, skill, workflow, role-lens, schema, and pack descriptors, generates bounded design projections, and resolves deterministic workflow plans bound to exact command authority.
- An early private core package for canonical project-root binding, fixed-layout project-state bootstrap, portable path resolution, bounded file snapshots, staged SHA-256 compare-and-swap writes and single-file deletion, digest-bound direct process execution, one root/project-bound mutating lease per initialized project, registry-bound permission admission with signed scoped grants, a resolved-plan state machine, and a durable append-only checkpoint store.
- A private `pack-runtime` that prepares immutable plans for validated, offline, hook-free regular-file packs, applies an explicitly authorized plan through one attested project lane, compare-and-swap operations, canonical installed state, and append-only transaction records, and manages only explicitly declared missing artifact-parent directories with canonical ownership markers.
- A tracked, digest-bound plan for the intended command and skill surface.
- English documentation with a Korean mirror.
- Cross-platform static checks for contracts, generated-plan drift, and documentation parity.

These foundations are development-time libraries and checks, not a usable product. The private state machine creates immutable hash-linked checkpoints, separates authorization from dispatch, settles exact run receipts and reported effects, advances declared failure or rollback transitions, and stops on uncertainty or cumulative budget excess. Checkpoint records now persist as canonical append-only files behind a compare-and-swap head; loading revalidates the complete bounded chain and exact project and workflow authority. Restart recovery discards an unused authorization and requires a new one, while any step that crossed the dispatch boundary becomes `uncertain`. A separate bounded bootstrap creates only the six fixed lock, workflow-state, and pack-state directories required by implemented primitives. It is idempotent, rejects links and case aliases, and removes only directories created by a clearly failed call. Pack preflight remains write-free. A separate private executor accepts only its same-process plan, a broker-issued install authorization, and an attested `project-write` lease; it supports local add, update, and installed-state-owned removal, records started and terminal transactions, settles actual effects, and rolls back already committed files after a clear later failure. Before the started record it writes one canonical active marker containing the expected post-state and fixed observation budgets; a completed non-uncertain terminal clears that marker by exact digest. New pack plans stop while a marker remains. A read-only recovery inspector takes two bounded snapshots and distinguishes a matching preimage, matching postimage, mixed state, terminal drift, and the marker-only crash window. For a stable matching report, a separate private finalizer requires a same-process digest-bound plan, a new broker-issued install approval, and an attested `project-write` lease. It re-inspects before writing, may append a missing journal closure or a separate reconciliation record, checks the exact resulting journal and state before clearing the marker, and restores that marker when post-clear verification fails. It never repairs, retries, or rolls back pack artifacts and refuses stale, mixed, unstable, unreadable, contradictory, or foreign-marker state. For explicitly declared direct artifact parents, the executor creates only an absent directory, writes a pack-digest-bound marker, keeps pre-existing directories shared, and stages exact empty owned-directory removal through a same-parent tombstone. The approved recovery finalizer may finalize only an exact detached empty tombstone before journal closure; it still never repairs pack files or mixed state. Neither path obtains approval or a lane by itself or exposes a CLI. Approval reservations and active leases remain memory-only, and no dispatcher or approval UI invokes these primitives. The lane primitive still requires initialized local project state and explicit renewal, and it does not yet coordinate parallel readers or control an editor. CPU and memory sandboxing also remain absent. The repository does not currently provide an installable npm package or working game-engine automation. Commands shown in the documentation are interface plans, not commands that can be run today.

## Product direction

The first product target is an offline, single-player 3D vertical slice for Windows x64, built by an individual or a team of up to five people. The intended loop is:

1. Inspect the project and negotiate available engine capabilities.
2. Define a bounded feature contract and permission budget.
3. Change source or editor state through one project-scoped execution lane.
4. Compile or import, test, play, replay deterministic input, and capture actual runtime evidence.
5. Build or export, record a receipt, and roll back safely when needed.

Godot, Unity, and Unreal Engine are the only planned first-party engines. Web-game frameworks, multiplayer, mobile, console, XR, and macOS validation are outside the first alpha.

## Design promises

- One typed registry defines command and skill descriptors and generates their current design projections. Future CLI, MCP, help, and host integrations must consume the same validated authority metadata.
- Unsupported capabilities must degrade explicitly; lower-grade evidence cannot be labeled `verified`.
- Editor mutations are serialized per project and stop when identity or dirty-file state becomes ambiguous.
- Installation, networking, external transmission, paid calls, destructive actions, and publishing require separate approval.
- Telemetry is not planned. Evidence leaves the local project only through an explicit export action.
- Engine and content-creation applications are detected but never installed automatically.

## Read the design

- [Documentation index](docs/README.md)
- [Current status and scope](docs/status-and-scope.md)
- [Core concepts and public types](docs/concepts.md)
- [Planned command-line interface](docs/planned-cli.md)
- [Target architecture](docs/architecture.md)
- [Engine support model](docs/engine-support.md)
- [Security and permissions](docs/security-and-permissions.md)
- [Assets and provenance](docs/assets-and-provenance.md)
- [Evidence and verification](docs/evidence-and-verification.md)
- [Roadmap](docs/roadmap.md)

## Installation

Installation is not available. Do not install similarly named packages expecting this project. An installation guide will be added only after the documented gates are approved and a working package passes clean install, update, rollback, conflict, and uninstall tests.

## Project status and licensing

The interfaces may change during implementation. The project license has not been selected, so do not assume redistribution rights until a license file is added. No release or package publication is planned before that decision.
