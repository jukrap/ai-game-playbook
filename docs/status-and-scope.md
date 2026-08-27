# Status and Scope

> Status: early source-built foundation. Public commands are write-free, every engine support grade is `planned`, and no package is published.

[한국어](status-and-scope.ko.md) · [Documentation](README.md)

## What works now

The repository builds a private pnpm workspace and an `agpb` executable from source. Nine commands are available:

| Command group | Current behavior |
| --- | --- |
| `init` | Plans a fixed project-local layout without writing it |
| `doctor` | Checks runtime, registry, project state, and managed-state health |
| `project inspect` | Reads bounded engine markers and the committed project profile |
| `pack list`, `pack doctor` | Inspect installed pack identity, ownership, drift, and recovery state |
| `skill list`, `skill check` | List twelve packaged skills and inspect their fixed project targets |
| `engine status`, `engine capabilities` | Report static Godot project compatibility and planned operation gaps |

All nine commands avoid project writes, engine launch, editor control, network access, and software installation. Human and JSON output share the same validated result and exit category.

The repository also contains typed contracts, one validated registry, and bounded project, process, permission, and workflow primitives. Receipt, artifact, managed-pack, MCP, and host-setup foundations are present too. The twelve packaged skills are bound to one digest-checked experimental pack, and an internal preflight can evaluate ownership conflicts without writing. These pieces are foundations unless a public command above exposes them.

## What is not available

There is no installable or published package. The following product capabilities do not exist yet:

- public project initialization or skill materialization;
- public pack add, update, remove, repair, or recovery finalization;
- a live Godot, Unity, or Unreal engine bridge;
- editor connection, scene or asset mutation, game input, or runtime capture;
- engine tests, a playable golden project, build or export execution;
- evidence list, show, export, or release publication.

Internal Godot discovery and preflight code does not change this status. The containment-provider catalog is empty, so project process admission fails closed and no live-engine support is established.

## Product scope

The first complete target is an offline, single-player 3D vertical slice for Windows x64. It covers movement, camera, collision, a collectible, HUD count, save and load, a win state, deterministic replay, tests, runtime capture, and a local build.

Godot is the first adapter target, followed by Unity and Unreal Engine. Linux is used for static and headless CI where possible. Live editor checks may require a Windows runner.

The first alpha excludes web-game frameworks, multiplayer, mobile, console, XR, and macOS verification. It also excludes a desktop dashboard, automatic engine installation, and hosted 3D or audio generation.

## Release meaning

The current version is `0.0.0` and should not be presented as an alpha release. `0.1.0-alpha` requires a complete Godot graybox loop with retained evidence. Unity and Unreal stay `planned` until their own loops pass.

Version `1.0.0` requires all three engines to reach `verified` for the declared golden project. Install lifecycle, rollback, permission, evidence, and behavior-evaluation contracts must also be stable.

The package marker remains `UNLICENSED`. A project license is required before package publication or external code distribution.
