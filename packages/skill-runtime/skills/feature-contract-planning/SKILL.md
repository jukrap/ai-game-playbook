---
name: feature-contract-planning
description: Use when turning a game idea, mechanic, bug fix, or vertical-slice milestone into a bounded implementation contract.
---
# Feature Contract Planning

Plan one observable player outcome at a time.

## Workflow

1. Inspect the project profile and identify the current stage, engine, target platform, declared budgets, and unknowns.
2. State the player-visible outcome and the core-loop reason for doing it now.
3. List allowed source, scene, asset, configuration, and save-data changes. Exclude unrelated cleanup and future expansion.
4. Define completion as observable oracles: initial state, input or trigger, state transition, visible result, persistence or restart behavior, and failure path.
5. Set time, changed-file, changed-byte, repair-cycle, performance, and evidence budgets appropriate to risk.
6. Identify destructive or uncertain effects and require a rollback or explicit no-rollback decision before execution.
7. For an unproven design assumption, choose the cheapest discriminating prototype and classify the result as supported, refuted, or inconclusive.

## Stop conditions

- Do not treat a broad feature list, subjective quality claim, or implementation checklist as a completion oracle.
- Do not invent engine support, performance budgets, save compatibility, asset rights, or test availability.
- Do not combine independent risky outcomes into one contract when they can be verified separately.

## Evidence

Return the contract, assumptions, allowed changes, acceptance oracles, budgets, risks, rollback policy, required evidence, and unresolved decisions. Keep design intent separate from observed implementation evidence.
