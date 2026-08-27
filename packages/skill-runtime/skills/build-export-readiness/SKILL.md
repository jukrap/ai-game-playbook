---
name: build-export-readiness
description: Use when preparing, diagnosing, or reviewing a local game build or export without publishing it.
---
# Build and Export Readiness

Treat a produced file and a runnable player as separate checkpoints.

## Workflow

1. Bind the project, exact engine and toolchain version, target OS and architecture, build kind, renderer, configuration, output root, and declared budgets.
2. Define required scenes or maps, content, plugins, platform settings, tests, symbols, and startup oracle before building.
3. Use an isolated bounded output path. Preserve unknown or prior artifacts unless their ownership and replacement policy are explicit.
4. Compile, import, cook, package, or export only through admitted capabilities. Retain the complete structured report, exit state, bounded logs, warnings, and produced-file inventory.
5. Reject a zero-test or missing required-test result. Distinguish compile, content, packaging, signing, and post-build failures.
6. Launch the exact produced artifact when startup is claimed. Verify process identity, initial scene, logs, controlled input, shutdown, and an actual player frame when required.
7. Record artifact digests, byte counts, build identity, inputs, environment, and reproducibility limitations.

## Stop conditions

- Do not install toolchains, sign, upload, publish, or release without separate authority.
- Do not call Editor play, a successful build report, or file existence a packaged startup pass.
- Do not delete an output directory whose ownership or project boundary is uncertain.

## Evidence

Report the exact target and build identity, commands or tools, test counts, phase outcomes, logs, warnings, produced inventory, artifact digests, startup evidence, budgets, and every unavailable or unverified gate.
