---
name: project-inspection
description: Use when determining the static identity and readiness of a local Godot, Unity, or Unreal project before planning game-development work.
---

# Project Inspection

Use this skill for bounded, read-only project discovery before choosing an engine workflow or proposing changes.

## Workflow

1. Select one explicit existing project root. Do not infer a project when several candidates are present.
2. Invoke the registered `project.inspect` operation with `agpb project inspect --project <absolute-path> --json` or the host's matching generated read-only tool.
3. Treat the report status, engine candidates, profile assessment, and static Editor signals as the complete evidence boundary for this step.
4. Preserve `unknown`, `attention`, and `blocked` outcomes. Do not select a likely engine, version, project, or Editor instance when the report is ambiguous.
5. State what the report proves and what remains unverified before recommending the next command or asking for missing information.

## Completion

- Name the bound project and the observed engine candidate state.
- Report profile validity or absence without inventing metadata.
- Carry forward every attention or blocking issue that affects later authority.
- Confirm that no files were changed, no process was launched, and no engine support grade was raised.

## Boundaries

This skill does not run Git, enumerate processes, connect to an Editor, inspect a live frame, mutate files, install tools, build, playtest, or verify engine support. Use a separately registered and authorized workflow for those operations.
