---
name: performance-budget-review
description: Use when defining, measuring, comparing, or reviewing a game's runtime performance and resource budgets.
---
# Performance Budget Review

Bind every performance conclusion to a budget and a comparable environment.

## Workflow

1. Define target hardware, OS, engine and version, renderer, quality settings, resolution, build kind, scene, camera, input, seed, and warm-up policy.
2. Declare budgets before measurement: frame time or frame rate, CPU and GPU time, memory, allocations, load time, stalls, and content-specific limits that apply.
3. Establish a same-environment baseline and record profiler, sampling interval, sample count, aggregation, and tolerance. Keep Editor and packaged-player baselines separate.
4. Run a deterministic scenario after warm-up and retain raw bounded profiler artifacts plus normalized summaries. Capture average, percentile, worst sustained window, and spikes where meaningful.
5. Attribute regressions with scoped measurements. Change one relevant factor at a time and rerun the same scenario.
6. Classify each budget as pass, fail, blocked, or unverified and state whether the result is diagnostic, baseline-comparable, or release-representative.

## Stop conditions

- Do not claim a pass when a budget, baseline, environment identity, or sufficient sample is missing.
- Do not compare Editor and packaged results, different renderers, or different scenes as equivalent.
- Do not optimize by disabling required gameplay, visual, accessibility, or evidence behavior without approval.

## Evidence

Report environment and run identities, scenario and input, budgets, baseline, profiler artifacts and digests, sample method, normalized metrics, regressions, changed factors, and confidence limits.
