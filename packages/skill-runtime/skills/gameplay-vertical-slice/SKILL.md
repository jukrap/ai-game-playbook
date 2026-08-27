---
name: gameplay-vertical-slice
description: Use when shaping or reviewing a small playable game loop, gameplay architecture, or vertical-slice milestone.
---
# Gameplay Vertical Slice

Build the smallest loop that can prove the risky player experience.

## Workflow

1. Define the player fantasy, core action loop, fail and retry loop, terminal or win state, target session length, and riskiest assumption.
2. Bound one playable slice with explicit input, camera, movement, collision, interaction, feedback, HUD, save or restart, and content placeholders that apply.
3. Assign authoritative state and ownership for input, simulation, presentation, persistence, UI, and engine integration. Keep dependencies directional and interfaces narrow.
4. Choose deterministic typed placeholders and the cheapest discriminating prototype before committing production assets or broad architecture.
5. Define state transitions and observable oracles for success, failure, interruption, restart, and completion. Include debug visibility without making debug state the result.
6. Integrate one system at a time, verify the loop with controlled input, and record design results as supported, refuted, or inconclusive.
7. Defer expansion, polish, and reusable frameworks until the slice proves a need.

## Stop conditions

- Do not turn a vertical slice into a full content plan or speculative engine framework.
- Do not hide unresolved game feel, state ownership, restart, or failure behavior behind visual polish.
- Do not claim playability from static scene construction or isolated component tests alone.

## Evidence

Report the bounded loop, state ownership, dependency boundaries, placeholders, input trace, state transitions, runtime result, failure and restart behavior, proven assumptions, and deferred scope.
