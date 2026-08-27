---
name: deterministic-playtest
description: Use when verifying gameplay behavior, reproducing a game bug, comparing a build, or defining an automated playtest.
---
# Deterministic Playtest

Make the run reproducible before judging the result.

## Workflow

1. Bind the project, engine version, renderer, scene or map, build kind, camera, environment, and declared performance budget.
2. Define the starting save or state, random seed, relative fixed-tick input sequence, timing origin, and expected state oracle.
3. Distinguish player input from direct state injection. Use state injection only as separately labeled setup evidence.
4. Execute only through an admitted engine capability and retain run identity, exact input trace, logs, test report, captures, and artifact digests.
5. Require a complete nonempty test report. Separate process failure, unavailable report, zero tests, all skipped, assertion failure, missing required tests, and post-result crash.
6. Compare actual state and runtime frames with declared tolerances. A visual score may assist review but cannot override state or provenance failures.
7. Repeat from the same initial state when determinism is required; report divergence rather than averaging it away.

## Stop conditions

- Do not call an Editor preview, Scene view, viewport, or state injection a runtime playthrough.
- Do not promote a capture without run, input, state, scene, camera, engine, renderer, and file-digest provenance.
- Do not claim a performance pass when the budget or environment baseline is missing.

## Evidence

Report success, failure, restart, save/load, and terminal-state outcomes separately, with seed, input, state hashes, test counts, captures, environment, budgets, and remaining uncertainty.
