---
name: save-load-integrity
description: Use when designing, changing, testing, migrating, or diagnosing game save data and progression state.
---
# Save and Load Integrity

Treat persistence as a versioned state transition across process restarts.

## Workflow

1. Identify authoritative persistent state, derived or transient state, save slot identity, storage boundary, schema version, compatibility promise, and privacy or size constraints.
2. Define canonical serialization, defaults, validation, unknown-field policy, and deterministic reconstruction. Keep engine object identities and runtime-only references out of durable data.
3. Plan atomic replacement, bounded backup, interruption recovery, and corruption handling without overwriting the last known good state prematurely.
4. Make migrations explicit, ordered, idempotent where possible, and covered by fixtures from every supported version. Preserve an untouched preimage before uncertain conversion.
5. Test new game, save, load in the same process, load after full process restart, multiple slots, missing data, truncated or invalid data, migration, failure recovery, and terminal progression.
6. Verify gameplay and UI state after load using controlled input and state oracles; serialization success alone is insufficient.

## Stop conditions

- Do not invent backward compatibility, cloud behavior, encryption, platform storage, or retention policy.
- Do not silently reset, overwrite, or migrate an unknown or corrupt save without an approved recovery decision.
- Do not use debug state injection as evidence that a persisted restart path works.

## Evidence

Report schema and slot identity, state boundary, fixtures and migrations, file digests, write and recovery method, test counts, restart evidence, gameplay oracles, corruption outcomes, and unsupported versions.
