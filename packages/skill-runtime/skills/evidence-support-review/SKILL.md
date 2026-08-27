---
name: evidence-support-review
description: Use when deciding whether game-development evidence supports a feature, engine capability, quality, performance, build, or release claim.
---
# Evidence Support Review

Make the claim no stronger than its weakest required witness.

## Workflow

1. State the exact claim, project and run identity, required evidence grade, acceptance oracle, and freshness window.
2. Inventory locators and bind each item to its producer, command or tool, engine and version, scene or map, build, input, state, environment, time, and file digest where applicable.
3. Verify that each locator resolves to bounded retained evidence and that identity, provenance, schema, counts, and hashes remain consistent.
4. Separate documentation, implementation inspection, test witness, local execution, Editor preview, actual runtime play, capture, profiling, build, packaged startup, and rollback evidence.
5. Check negative evidence: zero or skipped tests, process failure, stale or cloned receipts, missing frames, state injection, unsupported formats, redaction gaps, and environment mismatch.
6. Return supported, unsupported, blocked, or unverified per claim. List the cheapest missing witness that could change the result.

## Stop conditions

- Do not promote a viewport, outer success, artifact existence, or visual similarity beyond what it proves.
- Do not infer engine support, production readiness, performance, rights, or rollback from unrelated evidence.
- Do not export evidence, reveal secrets, or repair retained records during review.

## Evidence

Report the claim-to-locator mapping, validated identities and digests, evidence grade per item, contradictions, missing witnesses, redaction status, final support decision, and residual uncertainty.
