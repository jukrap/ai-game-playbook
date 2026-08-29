# Status and Scope

> Status: early source-built foundation. Public commands are write-free, a private Windows x64 contained-process path is fixture-tested, every engine support grade is `planned`, and no package is published.

[한국어](status-and-scope.ko.md) · [Documentation](README.md)

## What works now

The repository builds a private pnpm workspace and an `agpb` executable from source. Nine commands are available:

| Command group | Current behavior |
| --- | --- |
| `init` | Plans a fixed project-local layout without writing it |
| `doctor` | Checks runtime, registry, project state, and managed-state health |
| `project inspect` | Reads bounded engine markers and the committed project profile |
| `pack list`, `pack doctor` | Inspect installed pack identity, ownership, drift, and recovery state |
| `skill list`, `skill check` | List twelve packaged skills and inspect their fixed project targets |
| `engine status`, `engine capabilities` | Report static Godot project compatibility and planned operation gaps |

All nine commands avoid project writes, engine launch, editor control, network access, and software installation. Human and JSON output share the same validated result and exit category.

A tracked Godot `4.7.2` graybox project source covers movement, camera, collision, collectibles, HUD state, save and load, a win state, deterministic input replay, and state tracing. An exact manifest and adapter tests bind its file set, hashes, scenario semantics, required structure, and fixed `planned` support state. A separate bounded parser now validates the fixed replay line protocol, oracle set and timing, state hashes, terminal outcome, and process-exit agreement. This remains implementation and source-integrity evidence only; an installed Godot release has not parsed or run the project or produced a replay transcript.

The repository also contains typed contracts, one validated registry, and bounded project, process, permission, and workflow primitives. Receipt, artifact, managed-pack, MCP, and host-setup foundations are present too. A private one-shot host operation can create or retain the fixed control layout and the non-owned shared `.agents/skills` parent with rollback and durable evidence. The twelve packaged skills are bound to one digest-checked experimental pack. A second private operation covers exact install approval, stale-plan revalidation, one project-write lane, compare-and-swap ownership, checkpoints, receipts, content-addressed terminal transaction evidence, rollback, and recovery barriers. These pieces are foundations unless a public command above exposes them.

Internal recovery finalization now uses a recovery-run identity separate from the original pack transaction. It requires fresh approval, revalidates the transaction under one project-write lane, and returns success only when journal closure, content-addressed closure evidence, a `RunReceipt`, and the terminal workflow checkpoint agree. If evidence retention fails after the transaction closes, no success is returned and the started checkpoint remains for later reconciliation. The runtime does not retry that mutation.

The first internal evidence-reconciliation provider can now close that retained one-step pack-recovery checkpoint from an exact stable closure proof. Reconciliation has a separate run, approval, and receipt, observes the current checkpoint head and target-receipt state, and records no original attempt or target receipt-chain entry. It never replays the pack mutation. This provider is private and does not cover multi-step, rollback, process, editor, or general engine workflows.

An internal one-shot approval session now carries an exact prompt through approval, denial, cancellation, expiry, external digest signing, and final broker validation. Serialized presentation data has no authority, and an accepted approval cannot be replayed after signing or authorization fails. No public renderer, durable signing-key store, CLI mutation route, or MCP mutation route uses this session yet.

The private Codex adapter can drive that session through a same-process presenter callback. The callback receives only immutable display data and cancellation, while the adapter binds the exact response and keeps the signer and execution authority separate. Project initialization and managed-skill installation each use a separate one-shot operation, approval, run identity, and durable evidence chain. A clean project can initialize first and install skills through a second approval. This is not a concrete host UI or MCP elicitation route, and it does not expose a public mutation command.

The core also has a private in-memory local signer for that path. It imports a caller-supplied canonical Ed25519 private key, derives the broker trust binding, and issues signer leases bounded to five minutes and 32 signatures. Cancellation, expiry, exhaustion, copied handles, and explicit closure fail closed. It does not generate keys, touch key files, provide durable storage, or expose key material to the presenter.

The local host runner now connects exact project initialization and managed-skill add to durable dispatch and read-only recovery inspection. Recovery execution, evidence reconciliation, pack update or removal, and every engine mutation remain disconnected from the host path.

A separate Windows x64 package builds one native containment artifact. Its opt-in self-test proves bounded file denial, owned loopback network denial, child-process denial, process-count limits, termination settlement, and exact cleanup on disposable state. A fresh successful witness can then authorize one fixed synthetic read-only launch. That launch binds path-free disposable snapshots, a challenge, invocation and output digests, time and output budgets, one process, termination, and cleanup. A successful launch witness can be consumed once more to bind exact read-only user-project and executable snapshots to one short-lived internal admission. Copied plans, reports, witnesses, snapshots, admissions, and source handoffs carry no reusable authority.

For an exact target-version Godot report, a private approval-bound route can consume that admission once. It stages the admitted manifest and executable in disposable roots, starts one fixed headless invocation in a zero-capability AppContainer, and retains a path-free process report and `RunReceipt`. Success, bounded failure, timeout, and caller cancellation are exercised with a purpose-built fixture. A cancelled run returns only after process-tree settlement and disposable-state cleanup; the source project remains outside the AppContainer and is rechecked after execution.

This package has no public command or MCP tool. It accepts no arbitrary command, environment, network target, or source write authority. It is not registered in the public provider catalog, and no installed Godot release or graybox loop has been verified.

## What is not available

There is no installable or published package. The following product capabilities do not exist yet:

- public project initialization or skill materialization;
- public pack add, update, remove, repair, or recovery finalization;
- a concrete approval UI, durable signing-key storage, or key rotation;
- a live Godot, Unity, or Unreal engine bridge;
- editor connection, scene or asset mutation, game input, or runtime capture;
- engine tests, a live-validated playable golden project, build or export execution;
- evidence list, show, export, or release publication.

Internal Godot discovery and contained preflight code does not change this status. The public compiled catalog remains empty. The private route can run only an exact-version, approval-bound, fixed headless invocation from staged copies, and it has been verified only with a purpose-built fixture. No installed Godot release, playable frame, deterministic input, runtime capture, or target export has been retained, so live-engine support remains unestablished.

## Product scope

The first complete target is an offline, single-player 3D vertical slice for Windows x64. It covers movement, camera, collision, a collectible, HUD count, save and load, a win state, deterministic replay, tests, runtime capture, and a local build.

Godot is the first adapter target, followed by Unity and Unreal Engine. Linux is used for static and headless CI where possible. Live editor checks may require a Windows runner.

The first alpha excludes web-game frameworks, multiplayer, mobile, console, XR, and macOS verification. It also excludes a desktop dashboard, automatic engine installation, and hosted 3D or audio generation.

## Release meaning

The current version is `0.0.0` and should not be presented as an alpha release. `0.1.0-alpha` requires a complete Godot graybox loop with retained evidence. Unity and Unreal stay `planned` until their own loops pass.

Version `1.0.0` requires all three engines to reach `verified` for the declared golden project. Install lifecycle, rollback, permission, evidence, and behavior-evaluation contracts must also be stable.

The package marker remains `UNLICENSED`. A project license is required before package publication or external code distribution.
