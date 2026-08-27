# Core Concepts

> Status: the core schemas and registry contracts exist. Most mutating workflows and every live-engine capability remain planned.

[한국어](concepts.ko.md) · [Documentation](README.md)

## Operating model

AI Game Playbook treats game development as a bounded sequence of operations:

`detect → negotiate → inspect → mutate → save → compile/import → test → play → replay input → collect logs → capture → profile → build/export → rollback`

An engine adapter may report an operation as unsupported. It must not silently skip a required step or replace required evidence with a weaker artifact.

## Public contracts

| Type | Purpose |
| --- | --- |
| `CommandDescriptor` | Declares schemas, capabilities, permissions, side effects, lane, timeout, retry, budgets, evidence, and handler identity |
| `PackManifest` | Declares pack compatibility, dependencies, provided surfaces, digests, owned paths, and lifecycle |
| `ProjectPackLock` | Binds installed pack versions, dependencies, manifests, and lock identity to one project |
| `GameProjectProfile` | Identifies the engine, project, stage, target, and declared budgets |
| `EngineCapabilityReport` | Reports supported operations, limits, identity, degradation, and support grade |
| `FeatureContract` | Defines the player outcome, allowed changes, completion checks, risks, budgets, and rollback |
| `RunReceipt` | Records the run identity, command authority, results, artifacts, changed files, and recovery result |
| `AssetProvenance` | Records asset lineage, rights, transformations, provider details, cost, approval, hashes, and QA state |

Additional internal contracts cover approvals, resolved workflow plans, checkpoints, static engine reports, process containment, and component outcomes. A valid schema instance is data, not authority. Runtime authority also requires fresh identity and an admitted operation.

## Identity and authority

A project path, PID, port, process name, or window title is not enough to authorize work. Each operation binds the identities it needs. These can include the canonical project root, profile, command, handler, registry, process start, editor session, scene or world, and feature or workflow.

Identity is checked before an effect, after reload or restart, and before evidence is promoted. An unexpected root, executable, session, scene, dirty file, registry, or handler change stops the operation.

Approval is narrow and expires. A copied plan, report, receipt, or JSON object cannot be replayed as permission.

## Skills and workflows

A **skill** is progressively loaded guidance with triggers, exclusions, completion criteria, and evidence duties. It cannot grant permission.

A **review perspective** asks domain-specific decision questions. It is not a separate executor. A task should use no more than three perspectives.

A **workflow** is a finite graph of registered commands with budgets, transitions, checkpoints, and terminal conditions. One executor owns mutations. Parallel work is limited to independent reads and analysis.

## Outcomes

Process exit, command result, tests, gameplay assertions, capture quality, performance, build result, and rollback are separate outcomes. A run can be `succeeded`, `failed`, `blocked`, `cancelled`, or `uncertain` while preserving the reason for each component.

An uncertain mutation is never retried automatically. The project and engine state must be reconciled against the last durable checkpoint first.

## Support grades

| Grade | Meaning |
| --- | --- |
| `planned` | A contract exists, but usable runtime capability has not been established |
| `detected` | Compatible project and tool identity are established |
| `headless` | Required non-editor checks pass with retained evidence |
| `editor-preview` | Required editor-bound behavior and preview evidence pass |
| `verified` | Required gameplay and target build or export scenarios pass with complete receipts |

Grades apply to one capability in one environment. A generated file, screenshot, successful process, or static project marker cannot establish `verified` support by itself.
