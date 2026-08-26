# Engine Support Model

> Status: all engine support is `planned`. No engine has been verified by this product.

[한국어](engine-support.ko.md) · [Documentation](README.md)

## Common engine contract

Each first-party adapter is planned to expose the same lifecycle where the engine permits it:

`detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`

Every operation declares whether it is offline, headless, editor-bound, runtime-bound, or build-bound. An unsupported operation returns an explicit degradation reason. The adapter cannot replace actual gameplay input with teleportation, runtime capture with an editor viewport, or a complete test result with process success.

## Current support matrix

| Capability family | Godot | Unity | Unreal Engine |
| --- | --- | --- | --- |
| Project detection | `planned` | `planned` | `planned` |
| Static/headless validation | `planned` | `planned` | `planned` |
| Editor connection and mutation | `planned` | `planned` | `planned` |
| Deterministic runtime input and state | `planned` | `planned` | `planned` |
| Actual runtime capture | `planned` | `planned` | `planned` |
| Windows x64 build/export startup | `planned` | `planned` | `planned` |

Grades are evaluated per environment and capability. Detecting an installed editor does not establish adapter support.

The source-built `agpb engine status --engine godot` command is a control-plane observation, not a support grade. It validates one static Godot project candidate and compares its major/minor hint with the pinned `4.7.2` target. It accepts no executable path, performs no host-tool discovery or version probe, starts no process, and leaves every matrix cell `planned`.

An internal-only follow-up now separates discovery from execution. Project-only preparation binds bounded explicit source counts and a source digest without reading host candidates. A signed single-use `host-tool-inspection` grant is required before discovery reads exact configured files or fixed direct names in selected PATH directories. Discovery is nonrecursive, starts no process, returns no source paths or execution authority, and retains candidates only behind its original same-process report. Version preparation accepts only one selected retained candidate, and a second signed grant bound to its content and filesystem-identity digests is required before the bounded runner invokes only `--version`. The probe rejects drift before dispatch, rechecks identities after execution, settles the authorization, and emits normalized process and output digests without raw paths or output. Filesystem and network isolation remain explicitly `not-enforced`. These components have automated local witnesses but no retained execution from an actual Godot binary, are not exposed through CLI or MCP, and do not change the matrix.

## Godot direction

Godot has the first static adapter boundary and remains the first planned live adapter. Static scene inspection stays separate from engine-backed preflight and runtime play. Script and batch validation, exact project/editor identity, deterministic input through real input mappings, gameplay state assertions, actual runtime frames, logs, and Windows export startup are required for the first alpha.

A project bridge must be authenticated, fail closed, support Windows, preserve schema parity, serialize editor mutation, bound requests and output, recover locks, and prove real runtime frame/input behavior. If no candidate meets every hard gate, a minimal GDScript bridge will be built.

## Unity direction

Unity automation is planned to prefer official command-line and MCP paths, with a community bridge considered only as a verified fallback. The adapter must bind the exact project, package state, Editor version, process, and session; respect `UnityLockfile`; and recover coherently across domain reload.

Test success requires a completed Test Runner XML report with a nonzero test count. EditMode and PlayMode evidence remain separate. Scene View, actual Game View, and Development Build frames have distinct grades. Windows x64 Development Build startup is required before Unity reaches `verified`.

## Unreal direction

Unreal automation is planned around official MCP, Editor Python, the Automation Framework, UAT, and UBT. Editor-bound operations use a serialized lane with exact project, engine build, process, socket, session, world, and transaction identity.

Automation reports must be complete and nonempty. Editor viewport, PIE gameplay, and packaged startup are distinct evidence classes. Actor and asset mutations require lookup, scoped transaction, compare-and-swap state, save/reload/requery, and bounded rollback. Active worktree switching, global Unreal process termination, and unrecoverable deletion are not supported behaviors.

## Verification threshold

An engine reaches `verified` only when the common graybox scenario passes in actual gameplay and the target Windows player starts successfully. Receipts must include engine/version, renderer, scene or world, camera, seed, input trace, state assertions, logs, tests, capture hashes, build artifact hashes, and recovery outcome. Missing environment or budget data leaves performance `unverified`.
