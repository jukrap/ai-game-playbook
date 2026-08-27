---
name: engine-change-safety
description: Use when changing a Unity, Unreal, or Godot project through source files, command-line automation, an Editor session, or a runtime bridge.
---
# Engine Change Safety

Bind engine work to one project identity, one approved outcome, and the least authority needed.

## Workflow

1. Inspect the project and establish engine, version, project identity, stage, target, and known support grade.
2. Define the player-visible outcome, allowed paths and object kinds, completion oracle, budgets, risks, and rollback before mutation.
3. Negotiate only capabilities that are actually detected. Degrade explicitly when compile, import, Editor, play, capture, profile, build, or rollback support is unavailable.
4. Recheck project, executable, process, and Editor or runtime session identity immediately before an effect.
5. Serialize Editor-bound work through one project lane. Preserve a preimage or transaction boundary, save explicitly, then re-query the changed state.
6. Compile or import, run nonempty tests, play with controlled input when required, collect logs and actual runtime evidence, and verify the declared oracle.
7. Stop after an uncertain effect. Do not replay it automatically; reconcile state and require fresh authority.

## Stop conditions

- Do not launch an engine or bridge when containment, identity, permission, or capability admission is unavailable.
- Do not use a viewport, successful outer response, zero-test run, or generated artifact alone as verified gameplay evidence.
- Do not terminate unrelated engine processes, delete without recoverable preimage, or cross the approved project boundary.

## Evidence

Report exact engine and project identity, commands or tools, effects, changed paths, test counts, logs, captures, artifact digests, rollback outcome, and the achieved evidence grade.
