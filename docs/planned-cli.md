# Command-Line Interface Status

> Status: partial implementation. A source-built `agpb` executable exists, but only read-only `agpb doctor` is currently available. No package is published.

[한국어](planned-cli.ko.md) · [Documentation](README.md)

## Command inventory

```text
agpb init
agpb doctor
agpb project inspect
agpb pack list
agpb pack add
agpb pack update
agpb pack remove
agpb pack doctor
agpb skill list
agpb skill install
agpb skill check
agpb engine status
agpb engine capabilities
agpb engine connect
agpb run <workflow>
agpb verify
agpb evidence list
agpb evidence show
agpb evidence export
agpb docs check
```

Only `agpb doctor` is marked available in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json). Every other entry remains planned. No slash-command interface is promised.

## Available now

Build the workspace before invoking the repository-local executable:

```shell
pnpm build
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
```

`--project` accepts an absolute path or a path relative to the current working directory. Without it, `doctor` checks the current directory. `--json` emits the registered `DoctorReport` as canonical JSON; the default output is a concise human report with safe next actions.

The command performs bounded, read-only checks for:

- runtime-registry and generated-surface parity;
- the supported Node.js range;
- one canonical local project root;
- the six fixed runtime directories;
- canonical installed-pack state; and
- an active or malformed pack transaction marker.

It does not initialize project state, repair files, clear markers, invoke recovery finalization, install software, access the network, or control an editor.

## Output and exit contract

| Exit | Meaning |
| --- | --- |
| `0` | Diagnostics completed with `healthy` or `attention`; no blocking finding exists |
| `1` | The command failed before producing a validated report |
| `2` | CLI usage is invalid or the command is not implemented |
| `3` | The validated report contains a blocking finding |
| `4` | Reserved for a cancelled command |
| `5` | Reserved for an uncertain command outcome |

Human and JSON modes use the same report status and exit mapping. An uninitialized project is an attention-level result and remains write-free. An unsafe root, unsupported runtime, corrupt managed state, or surviving transaction marker is blocking.

## Remaining planned groups

- `init` will stage only project-local policy and runtime state after conflict checks; it will not install engines or system tools.
- `project inspect` will report engine markers, project identity, stage, targets, budgets, dirty state, and instance ambiguity.
- `pack` and `skill` mutations will reuse the approved managed lifecycle and never derive authority from installation alone.
- `engine` commands will bind exact project/editor sessions and report explicit capability degradation.
- `run` and `verify` will execute registered bounded workflows and keep process, test, gameplay, capture, performance, and build outcomes separate.
- `evidence export` will remain the only planned route for external evidence movement and will require explicit destination approval.

## Common command contract

Every implemented command must declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, cancellation, retry mode, budgets, evidence requirements, and a handler digest. The handler metadata for `doctor` attests its compiled module, and CI rejects digest drift. Future CLI, MCP, documentation, and host surfaces must preserve the same command and schema identities.
