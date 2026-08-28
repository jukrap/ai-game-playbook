# Skills

> Status: twelve capability-first skills are packaged, registry-bound, and attested by one experimental managed pack. They provide guidance only; public installation and execution authority are unavailable.

[한국어](skills.ko.md) · [Documentation](README.md)

Skills are small, progressively loaded playbooks for recurring game-development work. They help an agent ask the right questions, preserve constraints, and demand suitable evidence. A skill never grants permission and never proves that an engine capability exists.

## How to choose

- Select the smallest set that covers the task: usually one to five skills.
- Start with the player-visible outcome, then add safety or verification skills only when their conditions apply.
- Use no more than three review perspectives at once.
- Inspect the project before choosing an engine-dependent workflow.
- Stop when the required capability, identity, budget, permission, or evidence cannot be established.

## Current catalog

| Skill ID | Use it for |
| --- | --- |
| `project.inspection` | Identify a project and report static engine capability gaps |
| `feature.contract-planning` | Define a bounded player outcome, change scope, budget, and rollback |
| `gameplay.vertical-slice` | Plan and verify one end-to-end gameplay slice |
| `save-load.integrity` | Design versioned, atomic, recoverable save behavior |
| `ui.game-qa` | Review HUD and game UI across state, input, layout, locale, and accessibility |
| `playtest.deterministic` | Define reproducible gameplay input, state, tests, and runtime evidence |
| `evidence.support-review` | Judge whether evidence supports a capability or support grade |
| `performance.budget-review` | Compare runtime performance against explicit budgets and a matching baseline |
| `balance.deterministic-review` | Compare combat, economy, progression, reward, or difficulty models reproducibly |
| `asset.lifecycle` | Move an asset from placeholder or input through provenance, QA, and approval |
| `build.export-readiness` | Review toolchain, tests, artifacts, startup, and local build readiness |
| `engine.change-safety` | Bound engine-facing changes by identity, permission, lane, evidence, and rollback |

The catalog is engine-neutral unless a task truly needs engine-specific behavior. Godot, Unity, and Unreal operation skills remain planned until their adapters can supply the required runtime authority and evidence.

## What a skill can do

A packaged skill can define triggers, exclusions, workflow questions, completion criteria, and evidence duties. The runtime checks its frontmatter, path, digest, size, target name, and registry route before exposing it.

A skill cannot approve a write, choose an editor instance, launch a process, access the network, install a tool, publish a build, or upgrade evidence. Those actions require separate runtime capabilities and permissions.

## Inspect from source

```bash
pnpm build
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill check --project <project-path>
```

`skill list` returns bounded catalog metadata without returning skill bodies or local source locations. `skill check` reports each fixed project target as missing, current, conflict, or unsafe. Both commands are read-only.

## Installation status

The runtime can prepare two deterministic, write-free views of `.agents/skills/*/SKILL.md`. The first classifies candidate directories and files. The second is an internal managed-pack preflight that binds the packaged artifact digests, project identity, project stage, installed state, direct skill-directory ownership, and fixed inspection limits. Neither preparation step creates, replaces, or removes anything.

The managed preflight does not claim the shared `.agents` or `.agents/skills` directories. The private project-initialization workflow now includes both directories as fixed, non-owned targets and can create or retain them under its existing approval, lane, rollback, checkpoint, and receipt boundaries. Public `agpb init` still reports that plan without applying it. If the shared parent is absent when managed preflight runs, preflight stops with a conflict.

An existing skill file without managed ownership is also a conflict even when its bytes match the packaged artifact. Matching bytes are never treated as permission to adopt or overwrite a user-owned file.

A private add path now connects a freshly prepared plan to exact install approval, one project-write lane, durable workflow dispatch, compare-and-swap writes, receipts, content-addressed terminal transaction evidence, rollback, and recovery barriers. It rejects copied or stale plans and does not retry an uncertain mutation automatically. It returns success only after the persisted workflow reloads as succeeded. This path exists to validate the lifecycle; it is not a public product surface.

A private recovery path can now close one stable actionable transaction with a separate approval and recovery-run identity. It retains the journal closure as content-addressed evidence and binds it to a receipt and terminal checkpoint. If evidence persistence is interrupted after the transaction changes, it preserves a started checkpoint and returns no success. It does not expose a public recovery command.

`agpb skill install` is still planned. Public installation requires an explicit user-facing approval flow, generic reconciliation for incomplete workflow evidence, and end-to-end interruption tests through the public command boundary. Until those gates pass, users can inspect skill targets but cannot install them through `agpb`.
