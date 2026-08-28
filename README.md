# AI Game Playbook

> Status: source-built control-plane foundation. Nine write-free CLI commands, twelve packaged skills, and a Windows x64 containment self-test with an internal synthetic launch exist; no package or live-engine adapter is released.

[한국어](README.ko.md)

AI Game Playbook is a safety-bounded development harness for game projects built with Godot, Unity, or Unreal Engine. It gives coding agents clear project identity, explicit permissions, and reproducible workflows. It also requires evidence stronger than “the command exited successfully.”

The first product target is an offline, single-player 3D vertical slice for Windows x64, built by an individual or a team of up to five people.

## What exists today

This repository contains an early control plane, not a finished game-development product.

| Area | Available from this checkout |
| --- | --- |
| CLI | Nine plan-only, read-only, or static inspection commands |
| Project inspection | Bounded Godot, Unity, and Unreal marker and profile checks |
| Godot | Static project status and a documented operation catalog; no engine launch |
| Skills | Twelve capability-first game-development skills with exact packaged artifacts |
| MCP | An opt-in, project-bound, read-only STDIO runtime for selected tools |
| Windows containment | Disposable AppContainer self-test and one-shot synthetic launch; no user project or engine launch |
| Safety foundation | Typed contracts, registry checks, bounded permissions and workflows, receipts, and managed lifecycle primitives |

No installable package is published. The CLI does not edit a game project, install skills, control an editor, run a game, produce a build, or export evidence. All live-engine capabilities and support grades remain planned.

See [Status and scope](docs/status-and-scope.md) for the exact boundary.

## Try it from source

Requirements:

- Node.js `>=22.22.0 <23`
- pnpm `>=11.4.0 <12`
- A local Godot, Unity, or Unreal project for inspection

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- --help
pnpm run agpb -- project inspect --project <project-path>
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- engine status --engine godot --project <project-path>
```

Add `--json` to an implemented command for canonical machine-readable output. Commands return a nonzero exit code for invalid use, blocking findings, cancellation, uncertainty, or an internal failure. The [CLI guide](docs/cli.md) lists every available and planned command.

The containment verification is an opt-in developer check for Windows x64 and requires .NET SDK `10.0.400`. It first tests the isolation policy, then uses that fresh result to admit one fixed synthetic read-only workload against a new disposable snapshot. The API is private, accepts no arbitrary command or user-project path, and does not establish engine support.

## Engine support

| Engine | Current public capability | Support grade |
| --- | --- | --- |
| Godot | Static project status and operation-gap reporting | `planned` |
| Unity | Static project marker and profile inspection | `planned` |
| Unreal Engine | Static project marker and profile inspection | `planned` |

A detected project is not a verified engine integration. Support advances only when the required headless, editor-preview, gameplay, and target-build evidence exists. Read [Engine support](docs/engine-support.md) for those thresholds.

## Documentation

- [Documentation map](docs/README.md): choose a guide by question.
- [Status and scope](docs/status-and-scope.md): what works now and what does not.
- [CLI guide](docs/cli.md): current commands, output, and exit behavior.
- [Skills](docs/skills.md): selection rules and the twelve packaged skills.
- [Architecture](docs/architecture.md): control-plane and adapter boundaries.
- [Security and permissions](docs/security-and-permissions.md): approval, isolation, and stop rules.
- [Roadmap](docs/roadmap.md): implementation order and release gates.

Every public English document has a Korean mirror. English is the maintained source. Automated checks detect missing pairs, stale translations, broken links, structural drift, and misleading capability claims.

## Scope

Godot, Unity, and Unreal Engine are the only planned first-party engines. The first alpha excludes web-game frameworks, multiplayer, mobile, console, XR, and macOS validation. It also excludes hosted 3D or audio generation and automatic engine installation.

The repository is currently private-package source with an `UNLICENSED` package marker. A project license and release packaging must be completed before public package distribution.
