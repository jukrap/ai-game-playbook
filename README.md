# AI Game Playbook

> Status: documentation and contract design only. No installable package, `agpb` executable, MCP server, or engine adapter exists yet.

[한국어](README.ko.md)

AI Game Playbook is a planned AI-assisted game-development harness for small teams building with Godot, Unity, or Unreal Engine. It is designed around bounded workflows, explicit permissions, reproducible evidence, and real engine behavior rather than code generation alone.

## What exists today

- A reviewable product and architecture baseline.
- Planned command, pack, adapter, permission, evidence, asset, and verification contracts.
- English documentation with a Korean mirror.
- A machine-readable description of the planned public surface.

The repository does not currently provide an npm package or working game-engine automation. Commands shown in the documentation are interface plans, not commands that can be run today.

## Product direction

The first product target is an offline, single-player 3D vertical slice for Windows x64, built by an individual or a team of up to five people. The intended loop is:

1. Inspect the project and negotiate available engine capabilities.
2. Define a bounded feature contract and permission budget.
3. Change source or editor state through one project-scoped execution lane.
4. Compile or import, test, play, replay deterministic input, and capture actual runtime evidence.
5. Build or export, record a receipt, and roll back safely when needed.

Godot, Unity, and Unreal Engine are the only planned first-party engines. Web-game frameworks, multiplayer, mobile, console, XR, and macOS validation are outside the first alpha.

## Design promises

- One typed registry is planned to generate the CLI, MCP schemas, help, documentation metadata, and host skill routing.
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

The design may change during review. The project license has not been selected, so do not assume redistribution rights until a license file is added. No release or package publication is planned before that decision.
