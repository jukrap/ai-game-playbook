# Command-Line Interface Status

> Status: partial implementation. A source-built `agpb` executable provides plan-only `agpb init`; read-only `agpb doctor`, `agpb project inspect`, `agpb pack list`, `agpb pack doctor`, `agpb skill list`, and `agpb skill check`; and static read-only `agpb engine status --engine godot` and `agpb engine capabilities --engine godot`. No package is published.

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

Only `agpb init`, `agpb doctor`, `agpb project inspect`, `agpb pack list`, `agpb pack doctor`, `agpb skill list`, `agpb skill check`, `agpb engine status`, and `agpb engine capabilities` are marked available in [planned-surface.json](planned-surface.json) and the generated [foundation plan](../generated/foundation-plan.json). Every other entry remains planned. No slash-command interface is promised.

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
pnpm run agpb -- pack list --project <project-path>
pnpm run agpb -- pack list --project <project-path> --json
pnpm run agpb -- pack doctor --project <project-path>
pnpm run agpb -- pack doctor --project <project-path> --json
pnpm run agpb -- skill list --project <project-path>
pnpm run agpb -- skill list --project <project-path> --json
pnpm run agpb -- skill check --project <project-path>
pnpm run agpb -- skill check --project <project-path> --json
pnpm run agpb -- engine status --engine godot --project <project-path>
pnpm run agpb -- engine status --engine godot --project <project-path> --json
pnpm run agpb -- engine capabilities --engine godot --project <project-path>
pnpm run agpb -- engine capabilities --engine godot --project <project-path> --json
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

`pack list` binds one canonical project and reports bounded installed-pack identity, version, manifest digest, timestamps, dependency count, artifact count and declared bytes, and owned-directory count. It does not return artifact paths, artifact content, source locations, install authority, or mutation controls. Malformed or unstable state and an active transaction are blocking rather than partial-success listings.

`pack doctor` reobserves canonical installed state, current registry identity, each declared artifact digest, marker-bound directory ownership, and any active recovery transaction within fixed count, byte, time, and finding limits. It distinguishes current, drifted, unsafe, and not-inspected integrity and reports only a bounded recovery summary. It cannot repair bytes, clear a marker, finalize recovery, expose artifact content or source locations, or automatically retry uncertain mutation.

`project inspect` performs bounded, static checks for:

- one canonical project root and deterministic root entries;
- complete or partial Godot, Unity, and Unreal project markers, including multiple-candidate ambiguity;
- a BOM-free, canonical, schema-valid `.ai-game-playbook/profile.json` of at most 1 MiB and its portable identity;
- profile engine and version compatibility with detected marker evidence;
- a case-exact `.git` marker without running Git; and
- static Editor signals such as `Temp/UnityLockfile` without PID, liveness, session, or selection claims.

Missing markers or profile data and unavailable dirty/process observations are attention findings. An unavailable root, invalid or mismatched profile, engine ambiguity, or exceeded bounded candidate report is blocking. The command never reports static detection as engine support, never verifies stage evidence content, and does not run an engine, enumerate operating-system processes, connect to an Editor, write files, or access the network.

`skill list` binds one canonical project and returns the stable registry catalog with relative artifact and target paths, declared capabilities, permissions, invocation mode, version, token bound, and artifact digest. It does not return the skill body or an absolute artifact-source path. `skill check` revalidates the same registry and packaged artifact, then classifies each project target as `missing`, `current`, `conflict`, or `unsafe`. Missing targets are attention-level observations; content conflicts, byte-limit overflow, and unsafe linked or aliased paths are blocking. Neither command installs, copies, replaces, repairs, or removes a skill.

`engine status` currently requires `--engine godot`. It reuses the bounded static project inspection, requires one complete Godot candidate, compares its major/minor feature hint with the pinned `4.7.2` target, and returns an identity-bound `EngineStatusReport`. A missing executable observation is attention-level; an unavailable, ambiguous, conflicting, or major/minor-incompatible project is blocking. The public input has no executable-path field: the command does not search the host, read an engine executable, start a process, connect to an Editor, or raise the support grade above `planned`.

`engine capabilities` also requires `--engine godot` and accepts only the selected project root. It reuses the exact static status boundary, then returns the 14 common operation contracts in fixed order for one compatible, unambiguous Godot project identity. Every operation is `planned` and `documented`; each entry names its execution kind, limitations, degradation reason, permissions, and required evidence. The report also proves that the compiled containment-provider catalog has zero providers, no self-test ran, and launch is unavailable. It does not discover an executable, accept provider or launch input, execute a process, connect to an Editor, create a receipt, or promote any support grade.

None of the nine commands initializes project state, creates profile or policy bytes, repairs files, clears markers, invokes recovery finalization, installs software, accesses the network, or controls an editor.

## Output and exit contract

| Exit | Meaning |
| --- | --- |
| `0` | A plan is `ready`, or diagnostics completed with `healthy` or `attention` |
| `1` | The command failed before producing a validated report |
| `2` | CLI usage is invalid or the command is not implemented |
| `3` | The validated report contains a blocking finding |
| `4` | Reserved for a cancelled command |
| `5` | Reserved for an uncertain command outcome |

Human and JSON modes use the same report status and exit mapping. An `init` target conflict is blocking and leaves the project unchanged. An uninitialized project is an attention-level doctor result and remains write-free. An unsafe root, unsupported runtime, corrupt managed state, or surviving transaction marker is blocking. Static project inspection returns exit `0` for `ready` or `attention` and exit `3` for `blocked`; its dynamic unknowns are never converted to clean, absent, or verified claims. Pack listing returns `0` for a stable bounded listing or uninitialized state and `3` for unavailable, incomplete, malformed, or transaction-active state. Pack doctor returns `0` for `healthy` or `attention` and `3` for unsafe state, drift, exceeded bounds, or recovery-required transaction state. Skill listing returns `0` for a bound catalog and `3` for an unavailable project. Skill checking returns `0` for `ready` or `attention`, including a missing target, and `3` for conflicts, unsafe paths, byte overflow, or an unavailable project. Godot status returns `0` for a compatible project with explicit attention gaps and `3` for a blocked project observation. Godot capabilities returns `0` only with a compatible identity-bound static catalog and `3` when that identity cannot be established. Neither engine command treats availability as engine support.

## Remaining planned groups

- Actual `init` mutation remains planned. It must revalidate the plan, bind exact project-metadata authority, use staged compare-and-swap writes, and still never install engines or system tools.
- Mutating `pack add`, `pack update`, `pack remove`, recovery finalization, and `skill install` will reuse the approved managed lifecycle and never derive authority from installation alone. Current pack and skill inspection commands remain read-only.
- Live capability negotiation and `engine connect` remain planned. The two available static Godot engine commands do not establish a live session or execution authority.
- `run` and `verify` will execute registered bounded workflows and keep process, test, gameplay, capture, performance, and build outcomes separate.
- `evidence export` will remain the only planned route for external evidence movement and will require explicit destination approval.

## Common command contract

Every implemented command must declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, cancellation, retry mode, budgets, evidence requirements, and a handler digest. The handler metadata for all nine current commands attests each compiled module, and CI rejects digest drift. The current source-built MCP runtime preserves the same command and schema identities for explicitly enabled read-only tools, including pack inspection and both project-only Godot tools, but it is not a CLI setup command or installer. The registry routes one bounded project-inspection skill to `project.inspect` and, only for an eligible Godot observation, `engine.capabilities`; the shared skill runtime lets CLI, MCP, and the Codex adapter list or inspect its deterministic project target without materializing it. Mutating skill and host runtimes must preserve the same identities; generated metadata alone does not mean those capabilities exist.
