# CLI Guide

> Status: nine commands are available from a source build. They plan or inspect only; mutating, workflow, evidence, and live-engine commands remain planned.

[한국어](cli.ko.md) · [Documentation](README.md)

## Run from source

Build the workspace before invoking `agpb`:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm run agpb -- --help
```

Use `--project <project-path>` with a command that inspects a project. Add `--json` for canonical JSON output.

## Available commands

| Command | Behavior |
| --- | --- |
| `agpb init` | Plan the fixed project-local layout; write nothing |
| `agpb doctor` | Inspect runtime, registry, project, pack, and transaction health |
| `agpb project inspect` | Inspect static engine candidates and the project profile |
| `agpb pack list` | List bounded installed-pack identities and counts |
| `agpb pack doctor` | Check managed ownership, drift, and recovery state |
| `agpb skill list` | List the twelve packaged skill routes |
| `agpb skill check` | Classify fixed skill targets as missing, current, conflict, or unsafe |
| `agpb engine status` | Inspect static Godot project compatibility |
| `agpb engine capabilities` | Show the planned Godot operation contract and current gaps |

The two engine commands require `--engine godot`. They do not accept an executable path, start Godot, connect to an editor, or raise support above `planned`.

The `init` plan includes the shared `.agents/skills` parent alongside project-local control state. It never creates either location. The private initialization workflow can apply that exact fixed layout only after separate approval; no public apply flag exists.

## Complete command surface

The command surface is split by actual availability. Only the first block can be dispatched by the current CLI.

### Available now

```text available
agpb init
agpb doctor
agpb project inspect
agpb pack list
agpb pack doctor
agpb skill list
agpb skill check
agpb engine status
agpb engine capabilities
```

### Planned

```text planned
agpb pack add
agpb pack update
agpb pack remove
agpb skill install
agpb engine connect
agpb run <workflow>
agpb verify
agpb evidence list
agpb evidence show
agpb evidence export
agpb docs check
```

Availability comes from the validated runtime registry, not from this list. Generated status data and CLI help must agree with that registry.

## Output and exit codes

| Exit | Meaning |
| --- | --- |
| `0` | A validated plan or inspection completed without a blocking finding |
| `1` | The command could not produce a validated report |
| `2` | The CLI syntax is invalid or the command is not implemented |
| `3` | A validated report contains a blocking finding |
| `4` | Reserved for cancellation |
| `5` | Reserved for an uncertain outcome |

Attention-level findings can return `0`. For example, an uninitialized project, a missing optional target, or unavailable dynamic evidence may need follow-up without invalidating the static report. JSON and human output use the same status-to-exit mapping.

## Safety boundary

Current public handlers declare zero changed files and zero changed bytes. They cannot initialize state, install a pack or skill, repair a transaction, launch an engine, control an editor, access the network, or export evidence.

An unknown command is rejected. A generated descriptor without an attested handler is not executable.
