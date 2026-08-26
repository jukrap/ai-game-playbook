# AI Game Playbook

> Status: control-plane contracts, registry, and early core filesystem, process, and project-lane boundaries are in progress. No installable package, `agpb` executable, MCP server, or engine adapter exists yet.

[한국어](README.ko.md)

AI Game Playbook is a planned AI-assisted game-development harness for small teams building with Godot, Unity, or Unreal Engine. It is designed around bounded workflows, explicit permissions, reproducible evidence, and real engine behavior rather than code generation alone.

## What exists today

- A pnpm/TypeScript workspace with versioned public schemas and semantic validation.
- A typed registry that validates command, skill, workflow, role-lens, schema, and pack descriptors and generates bounded design projections.
- An early private core package for canonical project-root binding, portable path resolution, staged SHA-256 compare-and-swap writes, digest-bound direct process execution, and one root/project-bound mutating lease per initialized project.
- A tracked, digest-bound plan for the intended command and skill surface.
- English documentation with a Korean mirror.
- Cross-platform static checks for contracts, generated-plan drift, and documentation parity.

These foundations are development-time libraries and checks, not a usable product. The lane primitive requires pre-created local project state and explicit renewal; it does not yet coordinate parallel readers or control an editor. The core boundary does not yet include permission brokering, CPU or memory sandboxing, or workflow recovery. The repository does not currently provide an installable npm package or working game-engine automation. Commands shown in the documentation are interface plans, not commands that can be run today.

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
