# Command-Line Interface Status

> Status: partial implementation. A source-built `agpb` executable provides plan-only `agpb init` and read-only `agpb doctor`. No package is published.

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

Only `agpb init` and `agpb doctor` are marked available in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json). Every other entry remains planned. No slash-command interface is promised.

## Available now

Build the workspace before invoking the repository-local executable:

```shell
pnpm build
pnpm run agpb -- init --project <project-path>
pnpm run agpb -- init --project <project-path> --json
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
```

`--project` accepts an absolute path or a path relative to the current working directory. Without it, either command selects the current directory. `--json` emits the command's registered report as canonical JSON; the default output is a concise human report with safe next actions.

`init` is write-plan-only. It classifies a fixed set of 16 project-local targets as `create`, `retain`, or `conflict`:

- commit-worthy profile, policy, feature, pack-lock, and internal ignore-policy targets; and
- local-only cache, evidence, log, screenshot, lock, local-configuration, and runtime-state targets.

The current planner validates target-path safety and filesystem kind only. `retain` does not prove that existing profile, lock, or ignore-policy content is valid; content inspection and mutation remain planned.

The plan digest binds the runtime registry, canonical project identity, ordered target paths, target kinds, policies, content intents, observations, and conflict codes. It is diagnostic metadata, not approval or apply authority. The report always states `mutationPerformed: false` and `applySupported: false`; `--apply` is rejected as invalid usage.

`doctor` performs bounded, read-only checks for:

- runtime-registry and generated-surface parity;
- the supported Node.js range;
- one canonical local project root;
- the six fixed runtime directories;
- canonical installed-pack state; and
- an active or malformed pack transaction marker.

Neither command initializes project state, creates profile or policy bytes, repairs files, clears markers, invokes recovery finalization, installs software, accesses the network, or controls an editor.

## Output and exit contract

| Exit | Meaning |
| --- | --- |
| `0` | A plan is `ready`, or diagnostics completed with `healthy` or `attention` |
| `1` | The command failed before producing a validated report |
| `2` | CLI usage is invalid or the command is not implemented |
| `3` | The validated report contains a blocking finding |
| `4` | Reserved for a cancelled command |
| `5` | Reserved for an uncertain command outcome |

Human and JSON modes use the same report status and exit mapping. An `init` target conflict is blocking and leaves the project unchanged. An uninitialized project is an attention-level doctor result and remains write-free. An unsafe root, unsupported runtime, corrupt managed state, or surviving transaction marker is blocking.

## Remaining planned groups

- Actual `init` mutation remains planned. It must revalidate the plan, bind exact project-metadata authority, use staged compare-and-swap writes, and still never install engines or system tools.
- `project inspect` will report engine markers, project identity, stage, targets, budgets, dirty state, and instance ambiguity.
- `pack` and `skill` mutations will reuse the approved managed lifecycle and never derive authority from installation alone.
- `engine` commands will bind exact project/editor sessions and report explicit capability degradation.
- `run` and `verify` will execute registered bounded workflows and keep process, test, gameplay, capture, performance, and build outcomes separate.
- `evidence export` will remain the only planned route for external evidence movement and will require explicit destination approval.

## Common command contract

Every implemented command must declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, cancellation, retry mode, budgets, evidence requirements, and a handler digest. The handler metadata for `init` and `doctor` attests each compiled module, and CI rejects digest drift. Future CLI, MCP, documentation, and host surfaces must preserve the same command and schema identities.
