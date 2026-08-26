# Security and Permissions

> Status: planned permission policy with implemented private admission, workflow checkpoints, managed-pack transactions, and a read-only CLI diagnostic. General mutation dispatch and engine enforcement do not exist.

[한국어](security-and-permissions.ko.md) · [Documentation](README.md)

## Current enforcement

The current private broker accepts only a registry validated in the same process. It validates command input against the registered schema and binds authorization to project, command and handler, registry, feature, workflow step, optional editor session, normalized scope, budgets, deadline, and run identity. Sensitive authority uses one-permission Ed25519 grants, exact scope, expiration, and single-use reservation.

Authorization is not execution. The broker is not connected to a general mutation dispatcher, MCP server, process workflow, or engine bridge. The narrow pack executor and stable-state recovery finalizer require their own same-process plan, exact `install` decision, and attested project-write lease. Grant reservations and active leases are memory-only and do not survive restart.

The current CLI dispatches only read-only `doctor`. Its descriptor declares `read-project`, no side effect, and a `parallel-read` lane. It cannot request elevated authority or call repair.

## Default permission model

| Action | Default |
| --- | --- |
| Read selected project files and inspect local state | Allowed within bounded paths |
| Change source inside an approved feature contract | Allowed only within declared path, change, and budget scope |
| Control an editor | One approval per project and editor session |
| Run approved tests and builds | Allowed within configured time, output, and resource budgets |
| Install, update, or remove a pack or skill | Separate approval every time |
| Access the network | Separate approval every time |
| Transmit project data externally | Separate approval every time |
| Make a paid provider call | Separate approval every time |
| Perform a destructive action | Separate approval every time |
| Publish or release | Separate approval every time |

MCP annotations, skill text, engine bridges, and host UI labels never grant permission. A blanket `--yes` must not combine installation, network, external transmission, paid calls, destructive work, and publishing.

## Doctor boundary

`agpb doctor` performs bounded local reads for the runtime registry, Node.js version, canonical project root, fixed runtime directories, installed-pack state, and active transaction marker. The complete report is validated against the registry-bound output schema before rendering.

Doctor behavior is fail-closed:

- an uninitialized project is reported as attention without creating directories;
- an unavailable or unsafe root is blocking;
- incomplete, linked, or conflicting runtime state is blocking;
- malformed, noncanonical, or wrong-project installed state is blocking;
- a valid, malformed, or changing active transaction marker is blocking; and
- unsupported or malformed runtime-version text is blocking.

The command never initializes, repairs, deletes, clears, finalizes, installs, spawns an engine, opens a network connection, or controls an editor. Human and JSON modes use the same report and exit category.

## Fail-closed stop conditions

A mutating run must stop before further mutation when any of the following occurs:

- More than one plausible project or editor instance exists.
- Project, engine, process, session, scene/world, registry, handler, or feature identity changes.
- A file outside owned or approved paths would be changed.
- An unexpected dirty file or compare-and-swap mismatch appears.
- Path traversal, link escape, stale identity, invalid token, or schema mismatch is detected.
- Time, output, changed-file, changed-byte, repair, resource, or cost budget is exceeded.
- The operation ends with uncertain mutation state.
- Required tests are missing, incomplete, all skipped, or report zero tests.

Uncertain mutation is never automatically retried. It requires a new reconciliation or recovery attempt with its own authority and receipt.

## Process and editor isolation

The current core digest-binds a local executable and project root, spawns it directly with an argument array, limits environment values and project-scoped working directories, caps time, idle time, and combined output, and terminates only the owned process tree. Interrupted execution remains mutation-uncertain even if termination succeeds. This is not a CPU, memory, filesystem, or network sandbox.

Mutating lanes use one fixed project-local lease. The record binds root and project digests, run ID, runtime identity, nonce, lane, and optional editor-session digest. Acquisition has bounded waiting and cancellation; renewal is explicit. Expiration alone does not permit takeover of a live or unverifiable owner. Automatic heartbeats, parallel-reader coordination, independent foreign-process start attestation, and actual editor control remain planned.

Planned local bridges use authenticated project-scoped sessions, bounded request bodies and queues, deadlines, cancellation, and separate outer transport and inner operation results. They bind loopback by default and expose no unauthenticated mutation server.

## Filesystem and pack safety

The core binds one canonical local project root, rejects path ambiguity and writable links, bounds directory traversal and file size, and stages exact compare-and-swap writes, deletion, and reversible empty-directory removal. The fixed bootstrap creates only six predetermined runtime directories and rolls back only identities created by the failed call.

Pack preflight is write-free and accepts only validated offline regular-file artifacts. It verifies content digests, canonical installed state, dependencies, downgrade policy, ownership, non-owned collisions, reserved namespaces, and budgets. Existing directories remain shared. Only explicitly declared missing direct artifact parents may receive pack-digest-bound ownership markers.

Execution requires an exact plan, approved scope, and project-write lease. It writes an active marker before the started journal record, commits artifacts through compare-and-swap, commits canonical installed state last, records a terminal outcome, and clears only the exact marker after a non-uncertain terminal. Clear later failures restore detached directories before rolling earlier file commits back in reverse. Uncertain commits stop without retry.

Recovery inspection performs two bounded, write-free observations and preserves mixed, unstable, unreadable, contradictory, and foreign-marker states for diagnosis. Finalization requires a new exact approval and lane, re-inspects before each write boundary, may close only a stable attested state, and never repairs pack artifacts. Unexpected tombstone content is preserved and blocks cleanup.

`doctor` can report installed-state corruption or a remaining marker, but it cannot classify recovery, append journal records, clear a marker, or invoke the finalizer. No mutating pack CLI or distributed pack acquisition path exists yet.

## Network, providers, and telemetry

Telemetry is not planned. Routine evidence remains local. External evidence export, network access, and provider calls are separate actions requiring destination, data-category, retention, provider/model, and cost disclosure plus explicit approval.

Hosted providers are disabled by default. A later version may permit at most one optional image-provider pack. Installation approval never authorizes a later transmission or paid call.

## Secrets and public artifacts

Secrets and local connection details belong in ignored machine-local configuration. Receipts and diagnostics must redact values that could expose credentials or private machine details. Public documentation and exports exclude private absolute paths, tokens, internal URLs, and raw local configuration unless the user explicitly selects and approves those exact data.
