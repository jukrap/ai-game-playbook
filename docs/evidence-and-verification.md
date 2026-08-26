# Evidence and Verification

> Status: the receipt and checkpoint contracts and their in-memory settlement boundary are implemented. Durable product receipts and engine evidence do not exist yet.

[한국어](evidence-and-verification.ko.md) · [Documentation](README.md)

## Evidence grades

| Grade | What it establishes |
| --- | --- |
| `documented` | A behavior is stated in a reviewed document |
| `implemented` | Corresponding implementation can be located and inspected |
| `test-witnessed` | A relevant automated test and its result have been observed |
| `locally-executed` | The behavior has run locally with a complete result |
| `engine-verified` | The required behavior has run in the intended engine/runtime environment with complete evidence |

Grades are ordinal but not interchangeable. A document, code path, fixture, screenshot, or successful process cannot be promoted to stronger evidence without its required witness.

## `RunReceipt`

The implemented receipt contract binds the following to one run identity:

- Project, exact feature contract, resolved workflow plan, step/phase/attempt, editor session, optional engine, and environment identity.
- Registry, command descriptor, handler, input, authorization request, approval, and optional pack digests.
- Start/end times, timeout/cancellation state, outer exit, inner operation result, and component outcomes.
- Logs, complete test reports, gameplay assertions, input traces, state snapshots, captures, profiles, builds, exports, and artifact hashes.
- Changed files, before/after hashes, dirty-state reconciliation, rollback attempt, and recovery result.
- Approvals, network destinations, transmitted data classes, provider/model information, and cost when applicable.

The private state machine currently forms a domain-separated, hash-linked receipt chain across immutable checkpoints and accepts only complete artifacts from successful settlements. Restart persistence and hydration remain unimplemented. The planned resume boundary requires matching project and workflow identity, a valid TTL, unchanged approved scope and dirty state, and renewed approval when a session or external action changes.

## Test authority

Test outcomes distinguish process failure, incomplete report, assertion failure, all-skipped, zero tests, post-result crash, and success. Success requires a complete report, a nonzero test count, all required test IDs, and passing assertions. Retries preserve the first failure and cannot hide deterministic divergence.

Gameplay outcome, capture outcome, performance outcome, and build outcome remain separate from test outcome. A passing unit suite cannot prove a collectible, HUD binding, save/load, or packaged startup works.

## Deterministic playtest

Playtests use relative input scheduled on fixed or physics ticks through the engine's real input mapping. Teleportation and direct state mutation are diagnostic actions, not player input. Each scenario fixes a seed, initial state, input trace, state oracle, required artifacts, and budgets.

Determinism means the declared gameplay observations repeat within the stated environment and tolerance. It does not imply bitwise identity across different hardware, drivers, renderers, physics builds, or model versions.

## Runtime capture

Only a frame captured from actual play can serve as runtime visual evidence. Editor previews, scene thumbnails, and imported images receive different evidence classes. A capture is accepted only after file completion, decode, dimensions, provenance fields, and hash are verified.

Visual scores are advisory. They cannot override gameplay-state failures, missing interaction, critical visual findings, or mismatched baseline identity.

## Common golden task

1. Reset a deterministic 3D graybox.
2. Move through actual player input.
3. Verify camera behavior and collision.
4. Collect an item.
5. Verify gameplay score and HUD counter increase.
6. Save, then restart the process or session.
7. Load and verify world and score restoration.
8. Exercise a failure and restart path.
9. Collect the remainder and verify the win state.
10. Capture an actual runtime frame and exit cleanly.
11. Repeat the essential behavior in the Windows target build or export.

## Performance and support claims

Performance is judged against a project-declared budget and a baseline with matching hardware, driver, engine, renderer, settings, scene, and workload. Without budget or comparable environment identity, the result is `unverified`.

An engine capability reaches `verified` only after required golden scenarios, recovery behavior, and target build/export evidence pass. Missing artifacts, partial runs, dependency-blocked runs, timeouts, and zero-test executions are never reported as success.
