---
name: deterministic-balance-review
description: Use when designing or reviewing combat, economy, progression, reward, difficulty, spawn, drop, or cooldown balance with reproducible scenarios.
---
# Deterministic Balance Review

Turn balance opinions into explicit models and reproducible comparisons.

## Workflow

1. Define the player-facing question, affected systems, target audience or skill band, and the decision this review must support.
2. Inventory every input with its unit, valid range, source, default, dependency, and rounding rule. Mark assumptions and unknowns instead of inventing values.
3. Declare invariants and failure states such as impossible progression, dominant strategies, resource inflation, unwinnable encounters, soft locks, or rewards that never become reachable.
4. Build representative and boundary scenarios. Bind each run to the same initial state, ruleset, seed set, simulation step, horizon, and stopping condition.
5. Compare the baseline and candidate with distributions, percentiles, failure rates, time or turns to outcome, resource flow, and applicable player-state segments. Do not rely on averages alone.
6. Vary one important parameter at a time, then test relevant interactions. Report sensitivity cliffs, unstable feedback loops, exploit paths, and results that depend on an unverified assumption.
7. Classify the candidate as accept, reject, revise, blocked, or unverified against criteria declared before the comparison. Keep simulation evidence separate from actual playtest evidence.

## Stop conditions

- Do not claim a balance win without a declared model, baseline, scenarios, seed policy, sample count, and acceptance criteria.
- Do not hide a harmful tail, subgroup, exploit, or dead-end state behind a favorable mean.
- Do not treat a deterministic simulation as proof of player experience, accessibility, retention, or fun.
- Do not mutate production tuning data or widen the review scope without an approved change contract.

## Evidence

Report model and ruleset identity, inputs and units, assumptions, invariants, scenarios, initial state, seeds, sample count, distributions, sensitivity results, baseline and candidate deltas, decision, and remaining uncertainty.
