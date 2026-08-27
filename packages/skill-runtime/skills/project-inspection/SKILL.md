---
name: project-inspection
description: Use when determining a local game project's static identity, readiness, and documented Godot capability gaps before planning engine work.
---

# Project Inspection

Use this skill for bounded, read-only project discovery before choosing an engine workflow or proposing changes.

## Workflow

1. Select one explicit existing project root. Do not infer a project when several candidates are present.
2. Invoke the registered `project.inspect` operation with `agpb project inspect --project <absolute-path> --json` or the host's matching generated read-only tool.
3. When that report identifies exactly one compatible, non-blocked Godot project, invoke the registered `engine.capabilities` operation with `agpb engine capabilities --engine godot --project <absolute-path> --json` or the matching generated read-only tool. Do not invoke it for Unity, Unreal, an incompatible version, or an ambiguous project.
4. Treat the inspection report and, when available, the capability report as the complete evidence boundary for this step. Every engine operation in the capability report remains `planned` and `documented` only.
5. Preserve `unknown`, `attention`, and `blocked` outcomes. Do not select a likely engine, version, project, executable, provider, or Editor instance when evidence is ambiguous.
6. State what the reports prove and what remains unverified before recommending the next command or asking for missing information.

## Completion

- Name the bound project and the observed engine candidate state.
- Report profile validity or absence without inventing metadata.
- For a compatible Godot project, report the operation-level limitations, required permissions, required evidence, and containment launch gap without promoting support.
- Carry forward every attention or blocking issue that affects later authority.
- Confirm that no files were changed, no process was launched, and no engine support grade was raised.

## Boundaries

This skill does not run Git, discover executables, enumerate processes, run provider self-tests, connect to an Editor, inspect a live frame, mutate files, install tools, build, playtest, or verify engine support. A capability report with an empty compiled provider catalog is a documented gap, not authority to launch anything. Use a separately registered and authorized workflow for those operations.
