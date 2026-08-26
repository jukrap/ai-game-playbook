# Command-Line Interface Status

> Status: partial implementation. A source-built `agpb` executable provides plan-only `agpb init`, read-only `agpb doctor`, and static read-only `agpb project inspect`. No package is published.

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

Only `agpb init`, `agpb doctor`, and `agpb project inspect` are marked available in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json). Every other entry remains planned. No slash-command interface is promised.

## Available now

Build the workspace before invoking the repository-local executable:

```shell
pnpm build
pnpm run agpb -- init --project <project-path>
pnpm run agpb -- init --project <project-path> --json
pnpm run agpb -- doctor --project <project-path>
pnpm run agpb -- doctor --project <project-path> --json
pnpm run agpb -- project inspect --project <project-path>
pnpm run agpb -- project inspect --project <project-path> --json
```

`--project` accepts an absolute path or a path relative to the current working directory. Without it, each command selects the current directory. `--json` emits the command's registered report as canonical JSON; the default output is a concise human report with safe next actions.

`init` is write-plan-only. It classifies a fixed set of 16 project-local targets as `create`, `retain`, or `conflict`:

- commit-worthy profile, policy, feature, pack-lock, and internal ignore-policy targets; and
- local-only cache, evidence, log, screenshot, lock, local-configuration, and runtime-state targets.

The current planner validates target-path safety and filesystem kind only. `retain` does not prove that existing profile, lock, or ignore-policy content is valid; content inspection and mutation remain planned.

The plan digest binds the runtime registry, canonical project identity, ordered target paths, target kinds, policies, content intents, observations, and conflict codes. It is diagnostic metadata, not approval or apply authority. The report always states `mutationPerformed: false` and `applySupported: false`; `--apply` is rejected as invalid usage.

`doctor` performs bounded, read-only checks for:

- runtime-registry and generated-surface parity;
- the supported Node.js range;
- one canonical local project root;
- the 11 fixed runtime directories, including receipt and artifact storage;
- canonical installed-pack state; and
- an active or malformed pack transaction marker.

`project inspect` performs bounded, static checks for:

- one canonical project root and deterministic root entries;
- complete or partial Godot, Unity, and Unreal project markers, including multiple-candidate ambiguity;
- a BOM-free, canonical, schema-valid `.ai-game-playbook/profile.json` of at most 1 MiB and its portable identity;
- profile engine and version compatibility with detected marker evidence;
- a case-exact `.git` marker without running Git; and
- static Editor signals such as `Temp/UnityLockfile` without PID, liveness, session, or selection claims.

Missing markers or profile data and unavailable dirty/process observations are attention findings. An unavailable root, invalid or mismatched profile, engine ambiguity, or exceeded bounded candidate report is blocking. The command never reports static detection as engine support, never verifies stage evidence content, and does not run an engine, enumerate operating-system processes, connect to an Editor, write files, or access the network.

None of the three commands initializes project state, creates profile or policy bytes, repairs files, clears markers, invokes recovery finalization, installs software, accesses the network, or controls an editor.

## Output and exit contract

| Exit | Meaning |
| --- | --- |
| `0` | A plan is `ready`, or diagnostics completed with `healthy` or `attention` |
| `1` | The command failed before producing a validated report |
| `2` | CLI usage is invalid or the command is not implemented |
| `3` | The validated report contains a blocking finding |
| `4` | Reserved for a cancelled command |
| `5` | Reserved for an uncertain command outcome |

Human and JSON modes use the same report status and exit mapping. An `init` target conflict is blocking and leaves the project unchanged. An uninitialized project is an attention-level doctor result and remains write-free. An unsafe root, unsupported runtime, corrupt managed state, or surviving transaction marker is blocking. Static project inspection returns exit `0` for `ready` or `attention` and exit `3` for `blocked`; its dynamic unknowns are never converted to clean, absent, or verified claims.

## Remaining planned groups

- Actual `init` mutation remains planned. It must revalidate the plan, bind exact project-metadata authority, use staged compare-and-swap writes, and still never install engines or system tools.
- `pack` and `skill` mutations will reuse the approved managed lifecycle and never derive authority from installation alone.
- `engine` commands will bind exact project/editor sessions and report explicit capability degradation.
- `run` and `verify` will execute registered bounded workflows and keep process, test, gameplay, capture, performance, and build outcomes separate.
- `evidence export` will remain the only planned route for external evidence movement and will require explicit destination approval.

## Common command contract

Every implemented command must declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, cancellation, retry mode, budgets, evidence requirements, and a handler digest. The handler metadata for `init`, `doctor`, and `project inspect` attests each compiled module, and CI rejects digest drift. Future MCP, skill, and host runtimes must preserve the same command and schema identities; generated metadata alone does not mean those runtimes exist.
