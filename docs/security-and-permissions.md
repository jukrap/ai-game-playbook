# Security and Permissions

> Status: planned permission policy with an early private admission primitive. Filesystem, process, mutating-lane, and in-memory grant enforcement exist, but command dispatch and editor or bridge enforcement do not.

[한국어](security-and-permissions.ko.md) · [Documentation](README.md)

## Default permission model

| Action | Planned default |
| --- | --- |
| Read project files and inspect state | Allowed within the selected project |
| Change source inside an approved feature contract | Allowed within declared path and change budgets |
| Control an editor | One approval per project and editor session |
| Run approved tests and builds | Allowed within configured time, output, and resource budgets |
| Install or update a pack or skill | Separate approval every time |
| Access the network | Separate approval every time |
| Transmit project data externally | Separate approval every time |
| Make a paid provider call | Separate approval every time |
| Perform a destructive action | Separate approval every time |
| Publish or release | Separate approval every time |

Permission is evaluated by the control plane, not delegated to MCP annotations, a skill, an engine bridge, or a host UI. Approval is bound to project identity, command, scope, session when relevant, budgets, and expiration.

The current private broker accepts only a registry instance validated in the same process. It validates the actual command payload against the registered input schema, binds its digest to the project, command/handler, registry, feature, workflow step, editor session, normalized targets, budgets, deadline, and run, and verifies domain-separated, one-permission Ed25519 grants against configured public keys. Sensitive grants are single-use; grants are reserved synchronously before an authorization lease is returned. Automatic admission is limited to bounded project reads, approved feature-source paths and change kinds, and registered test/build workflow steps that do not declare an approval checkpoint. Test/build authority does not imply project-file or editor-object mutation. Editor-object source mutations remain rejected until object operation types can be checked against the feature contract.

Authorization is not execution. The primitive is not yet connected to the process runner, filesystem CAS, project lane, CLI, MCP, or an engine bridge. Grant use counts, active leases, and uncertainty barriers are memory-only and cannot survive restart; there is no approval UI, durable revocation/checkpoint store, recovery action, or secret-path classifier yet. A workflow plan digest is bound as supplied by the caller but is not independently attested until the workflow runtime exists. Memory, CPU, and GPU request budgets are rejected while runtime enforcement and accounting are unavailable. Reported effects are checked at settlement, and undeclared or malformed side-effect completion blocks later side effects in that broker instance, but a durable workflow must eventually preserve and reconcile the same state.

## Fail-closed stop conditions

A run stops before further mutation when any of the following occurs:

- More than one plausible project or editor instance exists.
- Project, engine, process, session, scene/world, or feature-contract identity changes.
- A file outside owned or approved paths would be changed.
- An unexpected dirty file or compare-and-swap mismatch appears.
- A path traversal, symlink escape, stale PID, invalid token, or schema mismatch is detected.
- Time, output, changed-file, changed-byte, repair, resource, or cost budget is exceeded.
- The operation ends with uncertain mutation state.
- Required tests are missing, incomplete, skipped entirely, or report zero tests.

Uncertain mutations are not automatically retried. The workflow first records an `uncertain` receipt and requires state reconciliation or explicit recovery.

## Process and editor isolation

The current private core digest-binds a local executable and project root, spawns it directly with an argument array, limits environment values and project-scoped working directories, caps time, idle time, and combined output, and terminates only the owned process tree on interruption. Windows retains only a minimal non-secret OS baseline and masks inherited user/path values unless explicitly allowlisted. Interrupted execution remains mutation-uncertain and is not safe to retry without reconciliation. This boundary is not a CPU, memory, filesystem, or network sandbox.

The current private core admits `project-write`, `editor-bound`, and `build-bound` work through one fixed local lease per initialized project. The record binds root and project digests, a run UUID, PID, captured runtime-start identity, runtime nonce, lane, and an editor-session digest when applicable. Acquisition has bounded waiting and cancellation; renewal is explicit and compare-and-swap protected. Expiration alone never permits takeover: a live, reused, or unverifiable foreign PID remains blocking, while a dead owner record is atomically quarantined before reacquisition. Foreign live process start time is not yet independently attested by the operating system, automatic heartbeats and parallel-reader coordination do not exist, and no actual editor session is controlled yet.

Planned local bridges use authenticated, project-scoped sessions, bounded request bodies and queues, timeouts, cancellation, and normalized outer/inner errors. They bind to loopback by default and do not expose an unauthenticated server.

## Filesystem and pack safety

The current core binds a canonical project root, rejects writable path links and portable path ambiguity, and performs bounded staged SHA-256 compare-and-swap writes. The managed pack lifecycle remains planned: install and update will stage content, validate digests and manifests, detect user changes, and promote only owned paths. Uninstall will remove only files still matching owned hashes.

Path checks resolve the final target and reject traversal, absolute-path injection, and symlink escape. Engine and system tools are detected but not installed automatically.

## Network, providers, and telemetry

Telemetry is not planned. Routine evidence remains local. External evidence export, network access, and provider calls are separate actions requiring approval with destination, data categories, retention expectations, model/provider identity, and estimated cost.

Hosted providers are disabled by default. The first version may permit at most one optional image provider pack. Installation approval does not authorize a later transmission or paid call.

## Secrets and public artifacts

Secrets and local connection details belong in ignored, machine-local configuration. Receipts store redacted command information and hashes where raw values would expose secrets. Public documentation, exports, and diagnostics must exclude private absolute paths, tokens, internal URLs, and raw local configuration unless the user explicitly selects and approves them.
