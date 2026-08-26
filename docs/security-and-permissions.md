# Security and Permissions

> Status: planned permission policy with early private admission, workflow-checkpoint, durable checkpoint-store, and a pack-specific transaction executor. General command dispatch and editor or bridge enforcement do not exist.

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

Authorization is not execution by itself. The general broker is not yet connected to a command dispatcher, CLI, MCP, process workflow, or engine bridge. One narrow exception is the private pack executor: it accepts only a same-process prepared plan, a broker-issued `install` decision with exact paths and conservative rollback budgets, and an attested `project-write` lease before invoking filesystem CAS. Grant use counts and active leases remain memory-only and cannot survive restart; there is no approval UI, durable approval or revocation store, recovery action, or secret-path classifier yet. The registry derives a domain-separated workflow-plan digest from exact validated authority, rejects ambiguous bindings, and semantically checks the immutable plan. The workflow state machine re-resolves that plan before accepting a broker decision and binds the exact authorization and actual effect to each transition. Its durable checkpoint store preserves the resulting uncertainty barrier across restart, but it deliberately discards stale authorization capability and cannot yet reconcile or clear uncertainty. Memory, CPU, and GPU request budgets are rejected while runtime enforcement and accounting are unavailable.

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

The current core binds a canonical project root, rejects writable path links and portable path ambiguity, and performs bounded staged SHA-256 compare-and-swap writes and exact-digest single-file deletion. Its fixed-layout bootstrap creates only six runtime directories, one segment at a time, without recursive deletion or caller-selected paths. It verifies parent and target identities, treats concurrent creation as idempotent only after reinspection, reverses only directories created by the failed call, and reports ambiguous cleanup as mutation-uncertain. Private pack preflight accepts only a same-process validated registry and offline, hook-free regular-file artifacts. It verifies local content, canonical installed state, exact dependencies, downgrade policy, owned hashes, non-owned collisions, and resource limits before producing an immutable write-free plan. Control-plane state and lock namespaces are reserved from pack ownership. The pack executor does not create pack artifact-parent directories or obtain authority itself: those artifact parents must already exist, and the caller must supply the exact approved decision and lane. It rechecks lease expiry before transaction start and around every forward staging or commit boundary. Authorization budgets use captured rollback-preimage sizes, and a one-pack update stops when it would invalidate an installed dependent. Final artifact digests, including unchanged files in a state-only update, are checked with write-free CAS guards before installed-state commit. The executor writes an immutable started record before final-file effects, stages state and artifacts, commits canonical installed state last, appends a terminal record, and settles observed paths and bytes. Clear later failures roll earlier file commits back in reverse with exact digests; uncertain commits stop without retry and require later reconciliation. Installed-state-owned removal remains available when a pack disappears from the current registry. No CLI, transaction reconciler, pack-owned directory lifecycle, or pack acquisition path exists yet.

Path checks resolve the final target and reject traversal, absolute-path injection, and symlink escape. Engine and system tools are detected but not installed automatically.

## Network, providers, and telemetry

Telemetry is not planned. Routine evidence remains local. External evidence export, network access, and provider calls are separate actions requiring approval with destination, data categories, retention expectations, model/provider identity, and estimated cost.

Hosted providers are disabled by default. The first version may permit at most one optional image provider pack. Installation approval does not authorize a later transmission or paid call.

## Secrets and public artifacts

Secrets and local connection details belong in ignored, machine-local configuration. Receipts store redacted command information and hashes where raw values would expose secrets. Public documentation, exports, and diagnostics must exclude private absolute paths, tokens, internal URLs, and raw local configuration unless the user explicitly selects and approves them.
