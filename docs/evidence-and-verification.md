# Evidence and Verification

> Status: the receipt and checkpoint contracts, settlement boundary, durable checkpoint chain, private durable receipt records, bounded private receipt-head queries, private content-addressed artifact payloads, pure process/test result normalizers, and limited private artifact format/provenance assessment are implemented. Evidence commands, engine report parsers, export, persisted artifact QA, and engine evidence do not exist yet.

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

The private workflow state machine forms a domain-separated, hash-linked receipt chain across immutable checkpoints and accepts only complete artifacts from successful settlements. Canonical checkpoint records persist append-only with a compare-and-swap head. Loading validates the bounded parent chain, transition legality, record and head digests, current registry plan, project identity, input, feature, dirty-state, and session bindings. It preserves and rejects malformed state instead of replacing it. Safe hydration never revives a serialized authorization: an undispatched admission returns to an authorization checkpoint, and a dispatched unsettled action becomes `uncertain`.

A private promotion API validates a complete artifact source as a stable project-local regular-file snapshot, checks its declared byte count and SHA-256 digest, and writes an immutable digest-addressed object. The promoted receipt directly attests the original portable source path and canonical manifest digest. The create-only manifest binds that source and retained object to the receipt execution context, project and runtime identity, registry, command descriptor, handler, input, authorization, packs, and approvals. Reusing the same receipt/artifact identity with different bytes or authority is rejected; concurrent identical promotion converges. Partial failure never advances a receipt head, although unreachable immutable bytes may remain for later retention analysis.

The private receipt store persists the promoted `RunReceipt` body as a canonical immutable record behind one compare-and-swap head per run. Persistence binds the same canonical project root, runtime, registry, command, workflow plan, and optional feature contract. Diagnostics require an explicit redaction marker, obvious credential-shaped and absolute private-machine text patterns are rejected, and fixed record, chain, artifact-count, and artifact-byte budgets apply. Every complete artifact must use its exact CAS object path and matching manifest; load reopens both twice. The source file is no longer evidence authority after promotion. Missing, malformed, noncanonical, tampered, relocated, rebound, stale, and competing state is preserved and rejected rather than repaired or silently replaced.

The bounded private head query inspects the entire fixed receipt directory under caller-selected limits no higher than 16,384 entries, 1,024 heads, and 16 MiB of aggregate head data. It accepts only canonical regular-file names, parses every head as bounded canonical JSON, requires the filename identity and latest record presence to match, then reopens heads and observes the inventory again before returning run-ID-ordered frozen summaries. The summary validation level is explicitly `head-and-latest-record-presence`: record bodies, predecessor reachability, artifacts, and engine evidence are not validated at that stage. Canonical record files with no current head are counted without being labeled reachable or orphaned.

A detailed load accepts only the original same-process query witness. It rejects foreign-project or mismatched-registry heads, refuses a selected head that advanced after the query, and then delegates to the existing bounded full-chain and artifact verification. Copying the summary cannot create load authority. This is a private discovery boundary, not an `agpb evidence` command, MCP tool, export path, persistent index, cursor, historical-registry archive, or retention mechanism.

The current receipt/object slice is bounded to 256 complete artifacts and 64 MiB across one verified receipt chain, with a 128 KiB manifest limit. A separate private assessment accepts one promoted complete artifact up to 16 MiB, revalidates the receipt, object, and manifest before and after reading the retained bytes, and returns bounded metadata without raw content. It can decode BOM-free UTF-8, parse exact canonical JSON under depth and node limits, or validate PNG chunks, CRCs, dimensions, bounded inflate output, and non-interlaced scanlines. Interlaced PNG is structurally checked but remains `unverified`. Optional `AssetProvenance` validation uses the exact current registry and requires the declared current-file path, digest, and byte count to match the assessed artifact. The assessment is not persisted and does not prove runtime-frame origin, engine import state, broader image semantics, or production readiness. Other formats, engine report parsing, retention cleanup or reachable-head garbage collection, CLI/MCP list/show/export operations, record encryption, and loading old chains under a different registry authority remain unavailable. Approval reservations and an action that can clear uncertainty are also not durable yet.

## Test authority

The implemented private normalizers accept a bounded process result and, for tests, an already-structured report observation. Process results are revalidated and mapped to fixed outcomes for zero or nonzero exit, spawn failure, timeout, idle timeout, output limit, cancellation, and unconfirmed termination. Normalized output retains bounded digests and counters but never raw stdout or stderr.

Test outcomes distinguish a process failure before a report, missing/incomplete/unparseable reports, inconsistent counts, assertion failure, all-skipped execution, zero discovered tests, missing required test IDs, post-result process failure/cancellation/uncertainty, and success. Success requires a complete report, a nonzero executed test count, all required test IDs, passing assertions, and a clean process result. A count-mismatched report is not projected into a receipt-compatible test summary. Retries preserve the first failure and cannot hide deterministic divergence.

This layer does not parse XML or JSON reports, run an engine or test process, select required test IDs, write receipts, or expose a command. Engine adapters must provide bounded report parsers and bind the normalized outcome to the same run authority before verification can use it.

Gameplay outcome, capture outcome, performance outcome, and build outcome remain separate from test outcome. A passing unit suite cannot prove a collectible, HUD binding, save/load, or packaged startup works.

## Deterministic playtest

Playtests use relative input scheduled on fixed or physics ticks through the engine's real input mapping. Teleportation and direct state mutation are diagnostic actions, not player input. Each scenario fixes a seed, initial state, input trace, state oracle, required artifacts, and budgets.

Determinism means the declared gameplay observations repeat within the stated environment and tolerance. It does not imply bitwise identity across different hardware, drivers, renderers, physics builds, or model versions.

## Runtime capture

Only a frame captured from actual play can serve as runtime visual evidence. Editor previews, scene thumbnails, and imported images receive different evidence classes. Successful PNG decoding by the private assessor proves only the retained file's bounded structure; it does not prove that an engine produced the frame during play. Future runtime-capture acceptance also requires file completion, dimensions, capture provenance, engine/session/state identity, and hash verification.

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
