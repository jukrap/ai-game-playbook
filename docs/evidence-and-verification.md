# Evidence and Verification

> Status: receipt, artifact, and result-normalization foundations exist. Public evidence queries, export, and live-engine verification remain planned.

[한국어](evidence-and-verification.ko.md) · [Documentation](README.md)

## Evidence grades

Evidence strength is recorded separately from engine support:

| Grade | Meaning |
| --- | --- |
| `documented` | A contract or expected behavior is written down |
| `implemented` | Matching code exists and passes structural checks |
| `test-witnessed` | Automated tests observed the behavior |
| `locally-executed` | A real local tool or process produced a retained result |
| `engine-verified` | The exact engine scenario ran with complete identity and runtime evidence |

Evidence never promotes itself. A report can be schema-valid yet too weak to support a gameplay, performance, build, or engine claim.

## Run receipts

A `RunReceipt` identifies the project, feature, workflow, command, handler, registry, input, and permission for one run. It also records timing, results, artifacts, changed files, and recovery.

Receipts are append-only records linked by digests. A current implementation can persist and reload bounded private chains and preserve promoted artifact objects. These APIs are not yet exposed through `agpb evidence` commands.

A successful outer response and a successful inner result are separate fields. Cancellation, termination uncertainty, rollback, and post-result failure remain visible.

## Component results

The result model distinguishes:

- process startup or exit failure;
- unavailable or inconsistent test report;
- zero discovered tests;
- all tests skipped;
- assertion failure;
- missing required test IDs;
- a process crash after a passing report;
- gameplay, capture, performance, build, and rollback outcomes.

Zero tests is not success. A passing report does not erase a later process failure.

## Deterministic gameplay evidence

A reproducible run identifies the project, engine, version, build, renderer, scene or map, and camera. It also fixes the initial state, seed, timing origin, fixed-step input, and expected state oracle.

Runtime capture also records the run, input, state, engine, renderer, scene, camera, and file digest. Editor viewports, direct state injection, and static images are labeled separately from an actual playthrough.

Required scenarios for the shared graybox include success, failure, restart, save, load, and win-state paths. Repeating the same initial state and input must either reproduce the result or report divergence.

## Artifact integrity

The private artifact foundation snapshots a complete project-local file into a content-addressed object and binds it to a manifest and receipt. Reload rechecks the object, manifest, chain, identity, and byte budget.

A limited assessor can inspect bounded UTF-8, canonical JSON, and non-interlaced PNG content, with optional `AssetProvenance` matching. It cannot prove that a PNG came from a live runtime frame, that an engine imported an asset correctly, or that an asset is production-ready.

Retention, cleanup, historical registry migration, broader formats, and public list, show, or export commands are still planned.

## Performance evidence

Performance claims require a declared budget and a comparable baseline. The run records the environment, build, scenario, input, seed, and warm-up. It also records the profiler, sample method, and tolerance.

Editor and packaged-player results are not interchangeable. Report averages, percentiles, sustained worst windows, spikes, memory, allocations, load time, and stalls when they apply. Without a matching environment or budget, the result is `unverified`.

## Golden tasks

The shared 3D graybox is the first cross-engine behavior target. It contains movement, camera, collision, a collectible, HUD count, save and load, and a win state.

Each adapter must run the same player-visible scenarios while preserving engine-specific build and test evidence. A static scene, successful compilation, or editor screenshot does not complete the task.

## Support decisions

Support is promoted per capability only when every required evidence item exists at the required grade. Missing identity, incomplete tests, non-runtime captures, unavailable build startup, or absent rollback remains an explicit gap.

The current public Godot reports contain only `documented` operation entries and static project observations. They do not establish live-engine evidence.
