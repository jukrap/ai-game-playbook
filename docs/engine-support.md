# Engine Support

> Status: Godot, Unity, and Unreal Engine are planned first-party adapters. No live-engine capability has advanced beyond `planned`.

[한국어](engine-support.ko.md) · [Documentation](README.md)

## Current matrix

| Engine | Static project inspection | Engine-specific public report | Live editor or runtime | Current grade |
| --- | --- | --- | --- | --- |
| Godot | Markers, profile, version hint, and exact graybox source integrity | Status and fourteen planned operation entries | Unavailable | `planned` |
| Unity | Markers, profile, and lockfile signal | Unavailable | Unavailable | `planned` |
| Unreal Engine | Markers and profile | Unavailable | Unavailable | `planned` |

Static inspection can identify a candidate project and report gaps. It does not establish an installed executable, a running editor, a playable frame, or a target build.

## Common contract

Each adapter is expected to support or explicitly reject these operations:

`detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`

Every operation reports its execution kind, required permissions, possible effects, limitations, missing evidence, and support grade. Unsupported work degrades visibly instead of disappearing from the workflow.

## Evidence thresholds

| Grade | Minimum expectation |
| --- | --- |
| `planned` | Operation contract and known gaps |
| `detected` | Exact project, engine executable, version, and compatible environment identity |
| `headless` | Required non-editor validation and tests run with bounded logs and retained receipts |
| `editor-preview` | One exact editor session performs the operation and produces editor-bound evidence |
| `verified` | Deterministic gameplay and target build or export pass with runtime-frame and artifact provenance |

The grade belongs to a capability and environment. An adapter can be `headless` for script validation while remaining `planned` for input replay or runtime capture.

## Godot

The current public path checks one Godot project candidate and compares its major and minor version hint with the pinned `4.7.2` target. It reports the common operation catalog, but every operation remains planned.

The repository also contains an exact-manifest Godot `4.7.2` graybox project source. Its static verifier binds the fixed files, hashes, project and scene settings, scripts, copied scenario, replay entry points, and `planned` support state. A bounded transcript parser separately checks the fixed invocation, scenario identity, complete oracle set, timing, state fields and hashes, terminal event, and process exit agreement. These produce implementation and static evidence with `liveValidated: false`; they do not prove that Godot can parse, start, play, capture, save, or export the project.

A versioned execution-profile catalog fixes two contained Godot launch tuples. The existing preflight tuple retains its established identity. The deterministic replay tuple additionally binds a 30-second process timeout, a 15-second idle timeout, a 1 MiB output ceiling, a 64 KiB line ceiling, the event ceiling, one process, a disposable project copy, no network or caller-supplied arguments or environment, and no retained raw output. A full contract digest covers those bounds. The replay profile is a contract only: the native provider does not dispatch it, and no registry command, CLI tool, MCP tool, or support claim exposes it.

Private foundations can discover bounded executable candidates and probe an exact version only with narrow host-tool permission. A Windows provider first qualifies its isolation policy with disposable probes and a fixed synthetic launch. One successful witness can then be bound to exact read-only project and executable snapshots.

For an exact `4.7.2` match, a one-use private dispatcher can consume that admission after explicit host-tool approval. It stages the admitted project and executable in disposable roots, runs only the fixed headless main-scene invocation in a zero-capability AppContainer, enforces one process plus time and output budgets, and retains a path-free report and `RunReceipt`. Version mismatch, stale identity, copied authority, or exceeded boundaries fail closed. The route has passed success and fault cases with a purpose-built fixture, but it has not run an installed Godot release or the graybox project. It is absent from public CLI and MCP surfaces and does not advance any capability beyond `planned`.

The first alpha must run the full loop on the shared graybox project. It covers script validation, headless tests, actual game startup, and deterministic input. It also preserves logs, runtime capture, save and load results, win-state verification, and a Windows export.

## Unity

Current project inspection recognizes Unity markers, profile data, and a static `Temp/UnityLockfile` signal. It does not infer process liveness or choose an editor instance.

The planned adapter must bind the exact project and Editor version and use one editor lane. It must recover after domain reload, consume real EditMode and PlayMode results, capture the Game View, and start a Windows x64 Development Build. A viewport image or outer tool success is not enough.

## Unreal Engine

Current project inspection recognizes Unreal project markers and profile data. It does not open the editor, attach to a process, or inspect assets.

The planned adapter uses project-bound editor automation, Python where appropriate, Automation Framework results, and UAT or UBT for build work. It must distinguish editor viewport, PIE, cook, package, and packaged startup evidence. Asset or actor deletion requires recoverable transactions.

## Degradation and stop rules

An adapter stops when project, executable, process, editor session, scene or world identity is missing or changes. It also stops on unexpected dirty files, unavailable permissions, exceeded budgets, schema mismatch, or uncertain mutation.

The runtime does not choose among multiple matching editors by guesswork. It does not kill unrelated engine processes, switch an active checkout, or retry an uncertain mutation automatically.
