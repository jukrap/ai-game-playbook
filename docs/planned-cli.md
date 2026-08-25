# Planned Command-Line Interface

> Status: interface plan only. The `agpb` executable does not exist yet, so none of these commands can currently be run.

[한국어](planned-cli.ko.md) · [Documentation](README.md)

## Command groups

```text
agpb init
agpb doctor
agpb project inspect
agpb pack list
agpb pack add
agpb pack update
agpb pack remove
agpb pack doctor
agpb skill list
agpb skill install
agpb skill check
agpb engine status
agpb engine capabilities
agpb engine connect
agpb run <workflow>
agpb verify
agpb evidence list
agpb evidence show
agpb evidence export
agpb docs check
```

No slash-command interface is promised. Host integrations may route natural language or UI actions to canonical command IDs, but the public executable remains `agpb`.

## Workspace and project setup

- `agpb init` is planned to create project-local policy and profile files without installing an engine or modifying unrelated files.
- `agpb doctor` is planned to inspect the control-plane installation, managed paths, dependencies, and local configuration.
- `agpb project inspect` is planned to detect engine metadata, project identity, development stage, targets, budgets, and ambiguous state without mutating the project.

## Packs and skills

- `agpb pack list|add|update|remove|doctor` is planned to manage digest-pinned packs through staging, owned-path checks, conflict detection, rollback, and safe uninstall.
- `agpb skill list|install|check` is planned to expose progressively loaded workflow guidance. Installing a skill does not grant editor, network, or filesystem authority.

Pack installation, update, and removal require explicit approval. User-modified or non-owned files must never be overwritten or removed automatically.

## Engine connection

- `agpb engine status` is planned to show detected projects, processes, sessions, and support grades.
- `agpb engine capabilities` is planned to negotiate available operations and explicit degradation reasons.
- `agpb engine connect` is planned to bind one approved project/editor session. Ambiguous instances stop instead of selecting a likely candidate.

Editor control requires one approval per project/session. Mutating editor commands run through a single project lane.

## Workflows and verification

- `agpb run <workflow>` is planned to execute a registered, bounded workflow under a feature contract.
- `agpb verify` is planned to run the required compile/import, tests, gameplay assertions, capture checks, profiling, and build/export evidence for the current contract.

Workflow repair is limited to three cycles. Time, output, changed-file, changed-byte, and external-cost budgets are enforced. Unknown completion state produces `uncertain` and disables automatic retry.

## Evidence and documentation

- `agpb evidence list|show` is planned to inspect local receipts and artifacts.
- `agpb evidence export` is the only planned route for sending an evidence package outside the project boundary and always requires explicit approval.
- `agpb docs check` is planned to validate generated command documentation and translated public docs after the runtime registry exists.

## Common command contract

Every command is planned to declare input and output schemas, capabilities, permissions, side effects, execution lane, timeout, retry mode, budgets, evidence requirements, and handler digest. Outer process success and inner operation success must both pass. Test execution must also prove a complete report and a nonzero test count.

The machine-readable inventory is in [planned-surface.json](planned-surface.json). It describes the intended surface and is not executable configuration.
