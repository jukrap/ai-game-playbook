# Security and Permissions

> Status: planned permission policy with implemented private admission, workflow checkpoints, durable receipt and artifact records, bounded private receipt-head queries, managed-pack transactions, a closed-world process-containment assessment plus strict provider/self-test protocols, nine write-free CLI commands including bounded pack inspection and static Godot status and capability reporting, private permission-bound Godot executable discovery and version probing, fail-closed Godot headless-preflight admission, a read-only STDIO MCP boundary, and write-free skill-target and Codex configuration planning. General mutation dispatch and contained engine execution do not exist.

[한국어](security-and-permissions.ko.md) · [Documentation](README.md)

## Current enforcement

The current private broker accepts only a registry validated in the same process. It validates command input against the registered schema and binds authorization to project, command and handler, registry, feature, workflow step, optional editor session, normalized scope, budgets, deadline, and run identity. Sensitive authority uses one-permission Ed25519 grants, exact scope, expiration, and single-use reservation.

Authorization is not execution. The broker is not connected to a general mutation dispatcher or engine bridge. Three private Godot operations consume exact broker decisions directly: executable discovery settles a signed single-use host-tool inspection lease without starting a process, version probing settles a separate lease around one bounded process, and headless-preflight admission settles a workflow-bound lease as failed and retains a blocked receipt without starting a project process when the exact containment witness returns `block`. The current MCP runtime exposes only commands whose generated metadata and registered descriptors prove they are read-only, closed-world, and non-mutating; it has no elevated permission path to the broker. The narrow pack executor and stable-state recovery finalizer require their own same-process plan, exact `install` decision, and attested project-write lease. Grant reservations and active leases are memory-only and do not survive restart.

The current CLI dispatches plan-only `init`; read-only `doctor`, static `project inspect`, `pack list`, `pack doctor`, `skill list`, and `skill check`; and static read-only `engine status --engine godot` and `engine capabilities --engine godot`. All nine descriptors declare `read-project`, no side effect, a `parallel-read` lane, and zero changed-file and changed-byte budgets. None can request elevated authority, call repair or recovery finalization, materialize a skill, or enter a mutation lane.

MCP startup requires one bounded project root, at least one explicit generated tool name, and acknowledgement that selected project diagnostics can be disclosed to the active host. The runtime binds the canonical path and filesystem identity, rebinds every command input to that exact project, and refuses duplicated, unknown, write-capable, destructive, or open-world tools. The modern STDIO transport caps unread buffered input at 1 MiB and bounds each connection to 16 MiB of raw STDIO input, 16 MiB of reserialized JSON-RPC input, 16 MiB of serialized JSON-RPC output before transport, 1,024 inbound messages, and 32 unanswered requests. The runtime validates registered input and output schemas, emits bounded canonical results, and exposes neither HTTP nor network access. Its invocation supervisor supplies an internal abort signal to each registered handler binding when the SDK caller cancels or the descriptor deadline expires, then waits the descriptor's cancellation grace period for settlement. An invocation that does not settle within that grace permanently blocks its runtime plan, aborts active peers, and prevents later results from being returned as successful. Current MCP tools remain read-only; this mechanism does not expose process or mutation authority. Host approval UI remains host-owned; this acknowledgement is not evidence export or telemetry consent.

The shared skill runtime and Codex setup planner accept no caller-selected script or skill path. The skill runtime binds eleven stable model-invoked capability-first routes from the generated registry and requires every packaged source to remain a canonical regular file within a 64 KiB cap and to match its declared name, UTF-8/LF form, frontmatter, and SHA-256 digest. The route text grants no execution authority, and a task-routing selection remains bounded to one through five skills. CLI and MCP can return only bounded catalog metadata and target observations from that authority. Codex setup additionally binds the current supported Node.js executable and this installation's MCP entry point before returning deterministic project-skill and configuration bytes. Inspection rechecks runtime identities and classifies targets while refusing linked, case-aliased, type-conflicted, or oversized paths. A private preparation function accepts only the original same-process plan and a canonical run ID, fixes all 13 directories and 11 files internally, compares two identity-bound observations, blocks on every unsafe or modified target, and returns only metadata, digests, counts, and rollback-aware budgets. Desired content remains in private same-process state. Preparation grants no approval, mutation lane, write, checkpoint, receipt, rollback, or retry authority, and no executor exists.

Static project inspection binds one local root, limits directory observations and file bytes, rejects unsafe links and case ambiguity, and rechecks identities around reads. A `.git` marker never grants permission to execute Git, and an Editor lock never grants process, session, liveness, connection, or mutation authority. The report explicitly records no mutation, process launch, or network access. Invalid profiles and ambiguous engine candidates block later authority instead of selecting a likely target.

Static Godot status and capability reporting inherit that exact project boundary. Their public requests accept only the selected project and the literal `godot` engine identity. Capability reporting reuses status, checks the immutable compiled containment catalog, and emits only the fixed 14 planned operation contracts. It cannot carry an executable, provider, self-test, or launch input; search host tools; read a file outside the bound project; launch a process; control an Editor; create a receipt; or promote support.

Private host-tool inspection uses a separate `host-tool-inspection` permission class that is never automatic. Discovery preparation performs project-only reads and binds one digest over at most eight configured paths and 32 selected PATH directories. The broker challenge exposes that digest as an exact object scope and requires one signed single-use grant. Only then may discovery inspect configured candidates and the fixed direct names `godot`/`godot4` or `godot.exe`/`godot4.exe`; it never recursively scans, reads ambient PATH state, launches a process, installs software, accesses the network, or returns source paths. The resulting report grants no execution authority and is usable only in the creating process. Version preparation accepts only a candidate retained behind that original report, and dispatch requires another signed single-use grant scoped to the selected content and filesystem-identity digests. Project and executable identities are checked before and after each boundary, and every active lease is settled on success or failure.

Headless-preflight preparation accepts only the original completed version report from the same process. It revalidates project and executable identities, requires initialized ignored receipt storage, resolves one exact registered workflow step, and obtains a path-free core assessment for the exact project root and the fixed project-write, network, and child-process denial requirements. Assessment JSON alone grants no execution authority: core retains the original report/root pair in a same-process witness, rejects copies and rebinding, and rechecks project identity before use. The assessment request, policy, result, and closed provider-catalog digests are bound into the command input and third signed approval scope. The catalog currently contains no validated provider, the v1 schema can express only unavailable controls and `block`, and no probe or project process starts. Immediately before admission, the adapter revalidates the original witness and exact digests. It then settles the lease as a non-uncertain failure and retains one canonical `blocked` receipt whose authority input and redacted diagnostic bind the same assessment. Cancellation or identity drift before admission settles authority without creating that receipt. This is fail-closed admission evidence, not a filesystem, network, or child-process sandbox, and it cannot raise Godot above `planned`.

The private artifact promotion and receipt stores accept only the current same-process validated registry and a receipt bound to the exact project, runtime, command descriptor, handler, workflow plan, and optional feature contract. They require pre-existing ignored local directories, stable project-local source snapshots, digest-addressed create-only objects, canonical producer manifests, canonical receipt JSON, compare-and-swap heads, explicit diagnostic redaction markers, and bounded text and artifacts. Complete artifact objects and manifests are reopened twice during verification. These stores do not grant execution authority, repair corruption, retry a mutation, perform format QA, remove unreachable objects, or export data.

The private receipt-head query adds no write or execution authority. It scans only the fixed store under caller-selected limits, rejects noncanonical or non-file entries, reopens every head, and checks a second inventory observation before returning bounded summaries. A copied summary cannot authorize a detailed load; the original same-process witness, matching project identity, matching validated registry, and unchanged selected head are required before full-chain verification begins. Head-only discovery never upgrades malformed or uninspected record content to verified evidence.

A separate private artifact assessor inherits no additional authority. It snapshots the request before I/O, requires one exact promoted complete artifact, verifies the receipt/object/manifest before and after reading retained bytes, and applies fixed byte, JSON-tree, PNG-dimension, pixel, inflate, and chunk limits. Optional provenance validation requires the exact current registry and current-file identity. The assessor returns bounded codes and metadata rather than raw content; it performs no write, process launch, network access, engine control, export, retry, repair, or support-grade promotion. Unsupported interlaced PNG remains `unverified`.

## Default permission model

| Action | Default |
| --- | --- |
| Read selected project files and inspect local state | Allowed within bounded paths |
| Inspect exact host-tool candidates outside the project | Separate signed single-use approval every time |
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

## Initialization planning boundary

`agpb init` observes a fixed 20-target project layout and returns only a validated plan. It does not create a directory, write profile or policy bytes, install a pack, access the network, or reserve mutation authority. Existing targets with the expected filesystem kind are retained; type, case, link, parent, and observation conflicts block the plan without modifying the conflicting object. Retention does not validate existing metadata content.

A ready plan carries a digest over the runtime registry, canonical project identity, ordered target intent, and observed target state. The digest detects plan drift; it is not an approval grant, write lease, checkpoint, or apply token. `--apply` is rejected as invalid usage until a separate mutation contract and permission path are implemented.

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

The current core digest-binds a local executable and project root, spawns it directly with an argument array, limits environment values and project-scoped working directories, caps time, idle time, and combined output, and terminates only the owned process tree. Interrupted execution remains mutation-uncertain even if termination succeeds. This is not a CPU, memory, filesystem, network, or child-process sandbox. Engine-backed preflight that requires those controls therefore stops before process creation.

The contract layer now defines path-free provider descriptors and bounded self-test request/report schemas. They bind implementation and catalog digests, a fixed probe suite, a short challenge window, exact timing, effects, and outcome consistency. Core exposes only an immutable empty compiled catalog. No self-test process has run, no descriptor is registered, no current-time or host-identity witness exists, and no launch handle is created. A valid-looking serialized report, copied catalog, or digest therefore grants no authority and cannot change the existing `block` admission.

Mutating lanes use one fixed project-local lease. The record binds root and project digests, run ID, runtime identity, nonce, lane, and optional editor-session digest. Acquisition has bounded waiting and cancellation; renewal is explicit. Expiration alone does not permit takeover of a live or unverifiable owner. Automatic heartbeats, parallel-reader coordination, independent foreign-process start attestation, and actual editor control remain planned.

Planned local bridges use authenticated project-scoped sessions, bounded request bodies and queues, deadlines, cancellation, and separate outer transport and inner operation results. They bind loopback by default and expose no unauthenticated mutation server.

## Filesystem and pack safety

The core binds one canonical local project root, rejects path ambiguity and writable links, bounds directory traversal and file size, and stages exact compare-and-swap writes, deletion, and reversible empty-directory removal. The fixed bootstrap creates only 11 predetermined runtime directories and rolls back only identities created by the failed call.

Pack preflight is write-free and accepts only validated offline regular-file artifacts. It verifies content digests, canonical installed state, dependencies, downgrade policy, ownership, non-owned collisions, reserved namespaces, and budgets. Existing directories remain shared. Only explicitly declared missing direct artifact parents may receive pack-digest-bound ownership markers.

Execution requires an exact plan, approved scope, and project-write lease. It writes an active marker before the started journal record, commits artifacts through compare-and-swap, commits canonical installed state last, records a terminal outcome, and clears only the exact marker after a non-uncertain terminal. Clear later failures restore detached directories before rolling earlier file commits back in reverse. Uncertain commits stop without retry.

Recovery inspection performs two bounded, write-free observations and preserves mixed, unstable, unreadable, contradictory, and foreign-marker states for diagnosis. Finalization requires a new exact approval and lane, re-inspects before each write boundary, may close only a stable attested state, and never repairs pack artifacts. Unexpected tombstone content is preserved and blocks cleanup.

`doctor` can report installed-state corruption or a remaining marker, but it cannot classify recovery, append journal records, clear a marker, or invoke the finalizer. No mutating pack CLI or distributed pack acquisition path exists yet.

## Network, providers, and telemetry

Telemetry is not planned. Routine evidence remains local. External evidence export, network access, and provider calls are separate actions requiring destination, data-category, retention, provider/model, and cost disclosure plus explicit approval.

Hosted providers are disabled by default. A later version may permit at most one optional image-provider pack. Installation approval never authorizes a later transmission or paid call.

## Secrets and public artifacts

Secrets and local connection details belong in ignored machine-local configuration. Receipts and diagnostics must redact values that could expose credentials or private machine details. Public documentation and exports exclude private absolute paths, tokens, internal URLs, and raw local configuration unless the user explicitly selects and approves those exact data.
