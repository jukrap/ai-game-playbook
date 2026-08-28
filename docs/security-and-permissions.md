# Security and Permissions

> Status: current public commands are write-free and network-free. Stronger mutation and engine permissions are designed but not publicly dispatchable.

[한국어](security-and-permissions.ko.md) · [Documentation](README.md)

## Current public boundary

All nine public CLI commands require only project read access. Their descriptors allow zero changed files and zero changed bytes. They do not launch an engine, connect to an editor, install software, call a provider, publish, or export evidence.

The optional MCP runtime is also read-only. It binds one canonical project, registers only an explicit subset of generated tools, and exposes no HTTP transport. MCP annotations are descriptive hints; the runtime permission boundary remains authoritative.

Private write and process foundations do not make those effects public. A path, plan, report, or generated descriptor cannot bypass command admission.

## Permission model

The intended broker separates these permission classes:

| Class | Default decision |
| --- | --- |
| Read project state | Allow within the selected project and fixed budgets |
| Change source inside an approved feature | Allow only after the feature and exact scope are bound |
| Control an editor | Ask once per project and session |
| Run an approved test or build | Allow within declared time, output, and resource budgets |
| Install, access network, transmit data, incur cost, destroy, publish, or release | Ask every time |

Current public commands use only the first row. The remaining decisions describe the target policy, not available CLI behavior.

An approval binds the project, command, request, scope, budget, expiration, and relevant feature, workflow, or editor session. It is single-purpose and cannot be transferred through copied data.

## Approval presentation boundary

The control plane now defines an internal, host-neutral `ApprovalPrompt` contract. It presents the exact project, command, registry, input digest, scope, budgets, deadline, permission modes, and stable impact classes that a future host must show before requesting a signature.

The prompt has no field for raw command input, an absolute project root, credentials, a signature, or an approval key. Its digest detects changes to the displayed authority but is not itself permission to execute. A validated serialized copy can be rendered, but only the original in-process prompt remains linked to the broker challenge that can produce an unsigned grant subject. The resulting grant still requires a trusted signature and exact broker validation.

The core also has an internal one-shot approval session. Its serializable challenge binds one host ID, the prompt and request digests, a presentation deadline, and exact grant expiry and use terms. A host response can only approve, deny, or cancel that exact session. It contains no command input, grant, signature, or key material. The host receives a validated immutable prompt copy; only the original in-process session handle retains the request, prompt authority, and broker binding.

After an approval response is accepted, the session cannot return to pending. An external signer receives only each exact grant digest, and the resulting signed grants go back to the original broker for full request validation. Denial, cancellation, and expiry never invoke the signer. A signer or broker failure after approval terminates the session as failed, so retry requires a new session and a new decision. A host's own tool prompt and a future MCP elicitation are additional presentation boundaries, not substitutes for this grant check.

The private Codex adapter now has a same-process presenter port for that session. It passes only the immutable presentation and a cancellation signal to the host callback. The adapter constructs the response identity and digests itself, allows only one active presentation per session, and keeps the signer, broker, raw request, and original session handle outside the presenter. Caller cancellation, presentation expiry, host failure, and an invalid decision all end without signing; host failure and invalid output also close the session before returning a bounded error.

The core now also has a private in-memory local signer. It imports only a caller-supplied, canonical, unencrypted PKCS#8 Ed25519 key and derives the broker's SPKI trust binding from that key. A signer lease lasts at most five minutes, allows at most 32 signatures, accepts only canonical approval digests and a genuine cancellation signal, and can be closed independently of the key. Closing the key blocks every remaining lease and drops the retained key object. It does not claim memory zeroization or revoke signatures already returned.

A scoped signer-use boundary closes the lease after its callback resolves or rejects. Returning, retaining, or directly closing the signer inside the callback cannot keep it usable after that boundary settles. The private local host runner takes the exact expiry and signature count from the original approval session, uses this scoped boundary around presentation and authorization, and leaves the caller-owned key open for an explicit later lifecycle decision.

One private managed-skill operation now binds the prepared plan, approval session, project identity, run identity, and signing-key identity to an in-process handle. The handle contains no key, lease, absolute path, or transferable authority. It can be invoked once: approval dispatches the exact plan immediately in the same call, while denial, cancellation, expiry, a copied handle, a different key, a concurrent invocation, or a repeated invocation stops before another effect. The original operation is never retried automatically.

After interruption, a bounded read-only query can report the durable workflow head. A separate read-only recovery assessment compares the transaction journal and project state twice and rejects a workflow head that changes during inspection. It may report that no transaction exists, but it cannot resume the original operation or write a recovery decision. Recovery finalization remains a separately authorized internal workflow.

Project initialization uses the same one-shot host rules with its own operation type. It binds the fixed-layout plan and exact key ID and fingerprint, presents approval before any write, and dispatches immediately after approval. Its approval-admission window is separate from the 30-second execution budget. A blocked plan cannot become an operation, and an already initialized project completes as a no-op without approval or mutation authority.

Initialization and managed-skill installation never share an approval or run identity. A clean-project sequence completes initialization first, then prepares a fresh skill plan and asks separately before installation. Initialization recovery is read-only, selects one exact run, repeats the bounded assessment, and fails if state changes between observations. It cannot execute recovery finalization.

Approval waiting and execution time now have separate bounds. A request that needs explicit approval may reserve up to five minutes for admission in addition to its registered execution duration. Automatic requests gain no extra delay. Once approval succeeds, the authorization lease ends at the earliest of the grant expiry, the absolute request deadline, or the authorization time plus the execution budget. Approval therefore cannot silently consume the execution budget or enlarge it.

The runtime does not generate, read, write, or persist signing keys. Key paths and private material never enter the presenter, prompt, session data, snapshot, receipt, or bounded error. Durable key storage, rotation, backup, and operating-system access controls remain unimplemented.

These pieces are internal integration boundaries, not a user interface or an MCP elicitation implementation. No public command renders the prompt or accepts an approval, and the read-only MCP tool catalog is unchanged. The private host path now owns project initialization and managed-skill add through separate approval and dispatch operations with read-only recovery inspection. Public initialization, installation, and recovery remain unavailable; recovery execution still requires its separate internal approval and cannot be reached through this host path.

## Stop conditions

Execution stops before a new effect when any of these conditions appears:

- more than one project or editor instance matches;
- project, executable, process-start, session, scene, world, registry, command, or handler identity changes;
- an unexpected dirty file appears;
- a required permission is missing or expired;
- time, output, file, byte, repair-cycle, or message budget is exceeded;
- a target is linked, case-aliased, outside the project, malformed, oversized, or changed since planning;
- a process or mutation cannot be settled with certainty.

Uncertain mutation is not retried. Recovery first inspects the durable checkpoint and real project state.

## Filesystem and managed content

Project paths are canonicalized and checked against one bound root. Linked paths, parent traversal, case aliases, unexpected file types, and identity changes fail closed. Compare-and-swap writes require the observed preimage to remain unchanged at commit time.

Managed packs declare exact owned files and directories. Stable installed state is committed last. Clear failure rolls back confirmed writes in reverse order; uncertain effects preserve the transaction marker for inspection. Removal must not touch unowned files.

The current `pack list`, `pack doctor`, `skill check`, and `init` commands only inspect or plan these states.

## Internal recovery closure

One internal workflow can finalize an already inspected managed-pack transaction. The recovery execution has its own run identity; it never reuses the transaction identity for approval, lane ownership, checkpoints, or receipts. The original transaction identity remains bound to its journal and active marker.

The runtime revalidates the exact report before admission, persists a started checkpoint before the effect, and promotes the actual terminal or reconciliation record into content-addressed evidence. Success requires that closure record, its receipt, and the terminal checkpoint to agree. A failure after the side-effect boundary is uncertain: it returns no success, preserves the started checkpoint, releases the lane, and does not retry automatically.

This workflow is internal. It does not make `pack add`, `pack update`, `pack remove`, skill installation, or recovery available through CLI or MCP.

## Internal evidence reconciliation

If a pack-recovery mutation closes but later evidence promotion is interrupted, a separate internal workflow can inspect the retained uncertain checkpoint, current checkpoint-head record, target-receipt state, and stable journal closure. It prepares a new plan and requires a new metadata-write approval, project-write lane, run identity, and receipt. The original command is never dispatched again.

Reconciliation succeeds only when one complete proof, the target identities, the current store head, the observed receipt state, the registered command, and the new zero-mutation receipt all agree. A missing target receipt is recorded as missing. If one is present, it must be the single detached successful receipt for that command, and its complete closure artifact must match the current proof exactly. The target checkpoint becomes terminal with append-only reconciliation metadata; its original attempts and receipt-chain head are preserved. Drift, copied plans, incomplete proof, a changed or contradictory target receipt, or any domain mutation stops the operation.

This is not a general recovery escape hatch. The core contract can represent a proved `succeeded` or `failed` target, but the current pack-recovery provider emits only `succeeded` after proving the completed closure. Version 1 supports only that one-step command phase. It does not reconcile rollback, multi-step, process, editor, or live-engine effects, and it has no public CLI, MCP, or host mutation surface.

## Processes and editors

Process authority binds the executable content and identity, start information, project, command, policy, and budget. PID, process name, port, or window title alone is insufficient.

Output, duration, child processes, cancellation, and termination settlement are bounded. A process result does not imply that inner tests or gameplay passed. Editor-bound work uses one lane per project and requires an exact session identity after reload or restart.

The current containment-provider catalog is empty. Godot project startup preflight therefore blocks before launch.

## MCP limits

The STDIO runtime limits unread input, cumulative raw and parsed input, serialized output, total messages, and pending requests. Deadlines and cancellation wait for bounded settlement. If a handler does not settle in time, the runtime blocks that plan and cancels active peers.

MCP currently exposes only explicitly selected read-only tools. It has no mutation, provider, executable, editor-control, or network route.

## Network, providers, and telemetry

The project has no telemetry. Evidence leaves a project only through the planned explicit export command.

Network access, external transmission, and paid provider calls require separate approval. A future provider flow must show the destination, data, model or checkpoint, expected cost, and rights information before transmission. Hosted providers are disabled by default.

## Secrets and logs

Secrets and machine-specific configuration stay local and ignored. Logs and receipts should record identities, digests, bounded diagnostics, and redacted error context, not credentials or unrestricted file content.

Public documentation and generated status must not contain local paths, private diagnostics, or secrets.
