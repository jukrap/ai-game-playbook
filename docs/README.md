# Documentation

> Status: public design package, reviewed on 2026-08-26. Product implementation has not started.

[한국어](README.ko.md) · [Project overview](../README.md)

## Audience and purpose

This package is for prospective users, contributors, and maintainers who need to understand the intended product boundary before implementation. It describes planned contracts and current limitations without presenting planned behavior as shipped functionality.

## Document set

| Document | Purpose |
| --- | --- |
| [Status and scope](status-and-scope.md) | Current repository state, initial audience, included work, and exclusions |
| [Concepts](concepts.md) | Shared lifecycle, public types, support grades, and run outcomes |
| [Planned CLI](planned-cli.md) | Intended `agpb` command groups and execution semantics |
| [Architecture](architecture.md) | Control plane, adapters, bridges, project state, and generated surfaces |
| [Engine support](engine-support.md) | Common engine contract and engine-specific verification thresholds |
| [Security and permissions](security-and-permissions.md) | Approval classes, stop conditions, isolation, and data movement |
| [Assets and provenance](assets-and-provenance.md) | Placeholder-first asset lifecycle, rights metadata, QA, and providers |
| [Evidence and verification](evidence-and-verification.md) | Receipts, evidence grades, deterministic playtests, and golden tasks |
| [Roadmap](roadmap.md) | Documentation approval, implementation order, and release criteria |

The file [planned-surface.json](planned-surface.json) is a machine-readable design artifact. It is not a runtime registry and cannot be used to invoke commands.

## Status language

- **Current** means the artifact is present and can be inspected in this repository.
- **Planned** means the contract is designed but has no product implementation.
- **Detected**, **headless**, **editor-preview**, and **verified** are engine support grades that require progressively stronger runtime evidence.
- A roadmap milestone does not imply availability.

## Package boundary

Included here are durable public explanations, planned interfaces, limits, risks, and maintenance rules. Excluded are private planning notes, raw investigation records, local machine paths, unreviewed generated output, secrets, logs, captures, and runtime evidence.

## Maintenance

English files are authoritative. Each Korean mirror records its English file path, SHA-256 digest, and translation date. A public documentation change must update both languages in the same change and pass checks for pairs, digests, links, heading structure, code fences, planned command/type parity, and private-path leakage.

Project maintainers own this package. Review it whenever implementation status, public commands, support grades, permission defaults, engine targets, or release scope changes. Superseded product claims should be updated in place; historical work belongs outside the public package.

## Caveats

- No live engine loop has been verified for this product.
- Exact engine patch versions will be pinned again at implementation start.
- Package naming and public interfaces remain provisional until documentation approval.
- A project license must be selected before external code adoption or package publication.
