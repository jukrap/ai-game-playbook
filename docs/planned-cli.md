# Command-Line Interface Status

> Status: partial implementation. A source-built `agpb` executable provides plan-only `agpb init` plus read-only `agpb doctor`, `agpb project inspect`, `agpb skill list`, and `agpb skill check`. No package is published.

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

Only `agpb init`, `agpb doctor`, `agpb project inspect`, `agpb skill list`, and `agpb skill check` are marked available in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json). Every other entry remains planned. No slash-command interface is promised.

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
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill list --project <project-path> --json
pnpm run agpb -- skill check --project <project-path>
pnpm run agpb -- skill check --project <project-path> --json
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

`skill list` binds one canonical project and returns the stable registry catalog with relative artifact and target paths, declared capabilities, permissions, invocation mode, version, token bound, and artifact digest. It does not return the skill body or an absolute artifact-source path. `skill check` revalidates the same registry and packaged artifact, then classifies each project target as `missing`, `current`, `conflict`, or `unsafe`. Missing targets are attention-level observations; content conflicts, byte-limit overflow, and unsafe linked or aliased paths are blocking. Neither command installs, copies, replaces, repairs, or removes a skill.

None of the five commands initializes project state, creates profile or policy bytes, repairs files, clears markers, invokes recovery finalization, installs software, accesses the network, or controls an editor.

## Output and exit contract

| Exit | Meaning |
| --- | --- |
| `0` | A plan is `ready`, or diagnostics completed with `healthy` or `attention` |
| `1` | The command failed before producing a validated report |
| `2` | CLI usage is invalid or the command is not implemented |
| `3` | The validated report contains a blocking finding |
| `4` | Reserved for a cancelled command |
| `5` | Reserved for an uncertain command outcome |

Human and JSON modes use the same report status and exit mapping. An `init` target conflict is blocking and leaves the project unchanged. An uninitialized project is an attention-level doctor result and remains write-free. An unsafe root, unsupported runtime, corrupt managed state, or surviving transaction marker is blocking. Static project inspection returns exit `0` for `ready` or `attention` and exit `3` for `blocked`; its dynamic unknowns are never converted to clean, absent, or verified claims. Skill listing returns `0` for a bound catalog and `3` for an unavailable project. Skill checking returns `0` for `ready` or `attention`, including a missing target, and `3` for conflicts, unsafe paths, byte overflow, or an unavailable project.

## Remaining planned groups

- Actual `init` mutation remains planned. It must revalidate the plan, bind exact project-metadata authority, use staged compare-and-swap writes, and still never install engines or system tools.
- `pack` commands and mutating `skill install` will reuse the approved managed lifecycle and never derive authority from installation alone. Current skill listing and checking remain read-only.
- `engine` commands will bind exact project/editor sessions and report explicit capability degradation.
- `run` and `verify` will execute registered bounded workflows and keep process, test, gameplay, capture, performance, and build outcomes separate.
- `evidence export` will remain the only planned route for external evidence movement and will require explicit destination approval.

## Common command contract

Every implemented command must declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, cancellation, retry mode, budgets, evidence requirements, and a handler digest. The handler metadata for all five current commands attests each compiled module, and CI rejects digest drift. The current source-built MCP runtime preserves the same command and schema identities for explicitly enabled read-only tools, but it is not a CLI setup command or installer. The registry also routes one bounded project-inspection skill, and the shared skill runtime lets CLI, MCP, and the Codex adapter list or inspect its deterministic project target without materializing it. Mutating skill and host runtimes must preserve the same identities; generated metadata alone does not mean those capabilities exist.
