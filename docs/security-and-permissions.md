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
