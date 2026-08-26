# Core Concepts and Public Types

> Status: versioned schemas, semantic validators, deterministic workflow-plan resolution, and early private permission, workflow-state, checkpoint, and receipt consumers are implemented. Most executable product surfaces and engine capability remain planned.

[한국어](concepts.ko.md) · [Documentation](README.md)

## Operating model

AI Game Playbook is planned as a contract-driven control plane. A run starts by identifying the project and available capabilities, then binds work to an approved feature, budget, engine instance, and execution lane. Every material action produces evidence that is evaluated separately from process exit status.

The common lifecycle is:

`detect → negotiate → inspect → mutate → save → compile/import → test → play → deterministic input → logs → capture → profile → build/export → rollback`

An adapter may report a step as unsupported. It must not silently skip a required step or substitute weaker evidence.

## Public contract types

The current foundation implements these contracts as versioned JSON schemas and TypeScript definitions with fail-closed semantic checks. The registry can derive one immutable workflow plan from validated descriptors, but this does not make any CLI command, workflow, or engine operation executable.

| Type | Responsibility |
| --- | --- |
| `CommandDescriptor` | Input/output schemas, required capabilities, permissions, side effects, lane, timeout, retry, budgets, and required evidence for one operation |
| `PackManifest` | Pack version, compatible engines, supplied skills and commands, dependencies, digest, owned paths, and install/update/remove lifecycle |
| `GameProjectProfile` | Engine, version, project identity, development stage, target platform, and declared quality/change budgets |
| `EngineCapabilityReport` | Detected operations, limitations, identity, and support grade for the current environment |
| `FeatureContract` | Player-visible outcome, allowed change scope, completion conditions, risks, budgets, and rollback plan |
| `ApprovalGrant` | One signed permission bound to exact project, command, request, scope, budget, expiration, and optional feature, workflow, or editor session identity |
| `ResolvedWorkflowPlan` | One finite DAG bound to exact registry, workflow, stage, command and handler authority, lanes, permissions, budgets, transitions, and evidence duties before execution |
| `WorkflowCheckpointRecord` | Immutable sequence, exact resolved-plan and project authority, in-flight authorization, attempts, cumulative budgets, evidence, receipt-chain head, TTL, and parent digest |
| `RunReceipt` | Run, feature, plan, command descriptor, handler, input, and authorization identity; timing, outer and inner results, artifacts, changed files, and recovery result |
| `AssetProvenance` | Asset source and lineage, rights, transformations, provider/model/checkpoint/seed when applicable, cost and approvals, file hashes, and QA state |

Schema identifiers and command identifiers are stable machine names. Human-readable help and translations do not create alternate command identities.

## Project and feature identity

A `GameProjectProfile` is the root of execution identity. It prevents a command from attaching to an editor or project merely because a process name or port looks plausible. A `FeatureContract` narrows the authorized outcome and change surface within that project.

Identity is checked before mutation, after editor reload or restart, and before evidence is promoted. A changed project root, engine build, process, session, scene/world, or unexpected dirty file stops the run.

## Skills, roles, and workflows

- A **skill** is a progressively loaded method with triggers, exclusions, required capabilities, and verification criteria. It cannot grant permission.
- A **role lens** is a review perspective with decision questions and evidence duties, not a virtual employee or an independent executor.
- A **workflow** is a bounded sequence of registered commands with checkpoints, budgets, and stop conditions. Before execution, its descriptor is resolved into a domain-separated plan with deterministic topological order and exact implementation authority.

The default plan selects one to five skills and no more than three role lenses for a task. One executor owns mutations; parallel work is limited to safe reads and independent analysis. The private state machine now consumes a resolved plan, separates authorization from the dispatch boundary, verifies exact permission settlement and receipts, advances declared failure and rollback transitions, and blocks uncertainty or cumulative budget overrun. Its append-only checkpoint store validates a bounded parent chain and supports restart hydration without restoring stale authorization: undispatched admission requires reauthorization, while a dispatched unsettled step requires reconciliation. Separate private stores persist canonical receipt bodies behind a compare-and-swap head and promote complete artifact snapshots into immutable SHA-256 objects with producer-bound manifests. Command dispatch, durable approval, artifact format QA, retention/export, uncertainty resolution, and engine execution are not implemented yet.

## Run outcomes

Process exit, command result, tests, gameplay assertions, capture quality, performance, and build result are separate outcomes. A run can therefore finish with states such as `succeeded`, `failed`, `blocked`, `cancelled`, or `uncertain` without losing the more specific component results.

An uncertain mutation is never retried automatically. Recovery must first reconcile project and engine state against the pre-change receipt.

## Support grades

| Grade | Meaning |
| --- | --- |
| `planned` | Contract exists, but no runtime capability is established |
| `detected` | Compatible project and tool identity are found |
| `headless` | Required non-editor checks run successfully |
| `editor-preview` | Editor-bound behavior and preview evidence run successfully |
| `verified` | Required actual gameplay and target build/export scenarios pass with complete receipts |

Support grades apply per capability and environment, not only per engine name. A screenshot, generated file, or successful process alone cannot establish `verified` support.
