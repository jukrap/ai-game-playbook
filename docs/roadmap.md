# Roadmap

> Status: the source-built control plane and private Windows x64 contained-process path are active. Installed-engine validation, public mutation, release packaging, and verified golden projects remain ahead.

[한국어](roadmap.ko.md) · [Documentation](README.md)

## Current checkpoint

The repository now has:

- a pnpm and TypeScript workspace with versioned contracts and one validated registry;
- nine write-free CLI commands with human and JSON output;
- project, pack, skill, and static Godot inspection;
- twelve packaged capability-first skills;
- a bounded read-only MCP runtime and write-free host setup planning;
- separate private one-shot project-initialization and managed-skill operations with approval, durable dispatch, and read-only recovery inspection;
- private pack recovery closure and finite evidence reconciliation;
- a source-built Windows x64 AppContainer and Job Object qualification path plus one-shot snapshot admission, staged Godot-process dispatch, bounded caller cancellation, permission settlement, and retained receipts;
- paired English and Korean public documentation with structural checks.

The contained process path has passed success, injected-failure, timeout, and running-process cancellation cases with a purpose-built fixture. Cancellation waits for native process-tree settlement and cleanup before retaining its receipt. This checkpoint does not include an installable package, an installed Godot validation, or a live engine loop.

## Stage 1: safe public execution

- expose approved initialization and skill materialization through a stable public approval boundary;
- carry the existing fresh-plan, project-write lane, compare-and-swap, durable checkpoint, receipt, rollback, and recovery rules through that public boundary;
- carry the finite internal pack-recovery reconciliation path through the public approval and evidence boundary, then add providers only for explicitly proved effect domains;
- expose managed pack add, update, remove, and recovery only after the same lifecycle passes conflict and interruption tests;
- design public evidence list, show, and explicit export with redaction and retention rules.

The private initialization-to-skill-install sequence now passes success, denial, cancellation, copied-handle, key-fingerprint, drift, concurrency, no-op, and repeat-call checks. Public mutation stays closed until the same behavior, evidence inspection, and interruption handling are delivered through a supported user-facing boundary.

## Stage 2: Godot alpha

- validate the existing contained startup path against an installed, pinned Godot release and the shared graybox project;
- connect the validated provider to a supported project-bound host path while keeping public dispatch closed until user-facing approval and evidence inspection are complete;
- require the exact admitted Godot executable and project identities at every dispatch and restart;
- add the thin GDScript bridge and bounded command schema;
- build the shared 3D graybox with movement, camera, collision, collectible, HUD, save and load, and win state;
- run script checks, tests, deterministic input, logs, runtime capture, restart, and Windows export;
- retain complete receipts and promote each required capability only from matching evidence.

Passing this stage allows `0.1.0-alpha`. Unity and Unreal remain `planned`.

## Stage 3: Unity adapter

- bind exact project and Editor instances and serialize editor work;
- implement source and editor change flows with domain-reload recovery;
- consume real EditMode and PlayMode results;
- verify Game View runtime capture and the shared graybox behavior;
- produce and start a Windows x64 Development Build with receipts.

Unity support advances per capability, not as one blanket engine label.

## Stage 4: Unreal adapter

- bind exact project, editor process, world, and transaction identity;
- support Blueprint and C++ change paths through bounded editor automation;
- consume Automation Framework results and distinguish viewport, PIE, cook, package, and packaged startup;
- verify the shared graybox, rollback, and Windows package.

Asset and actor deletion remains unavailable without a recoverable transaction.

## Stage 5: production workflows

- UI reconstruction and broader game UI QA;
- deterministic balance simulation and tuning comparison;
- Blender-based asset QA;
- one optional image-provider pack with cost, transmission, and rights approval;
- build and release hardening, richer evidence queries, and behavior evaluation.

A dashboard, desktop UI, generated 3D or audio, macOS verification, and additional platforms remain later work.

## Release gates

`0.1.0-alpha` requires the complete Godot loop. Later alpha releases may add Unity and Unreal only after their capabilities meet the same evidence rules.

`1.0.0` requires all three engines to be `verified` for the declared golden project on Windows x64. Install, update, conflict, rollback, uninstall, permission, interruption recovery, evidence retention, and behavior evaluation must also be stable.

Before any package release, the project must select a license and pin exact supported engine patches. Release artifacts must be clean and pass Windows and Linux CI. Live editor checks may use a controlled Windows runner.
