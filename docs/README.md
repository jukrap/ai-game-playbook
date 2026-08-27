# Documentation

> Status: public design and implementation-status package, reviewed on 2026-08-27. The control-plane foundation and nine source-built write-free CLI commands are in progress.

[한국어](README.ko.md) · [Project overview](../README.md)

## Audience and purpose

This package is for prospective users, contributors, and maintainers who need to understand the product boundary and current capability. It distinguishes implemented foundations, source-built commands, planned runtime behavior, and released functionality.

## Document set

| Document | Purpose |
| --- | --- |
| [Status and scope](status-and-scope.md) | Current repository state, initial audience, included work, and exclusions |
| [Concepts](concepts.md) | Shared lifecycle, public types, support grades, and run outcomes |
| [CLI status](planned-cli.md) | Available `agpb init`, `agpb doctor`, `agpb project inspect`, `agpb skill list`, `agpb skill check`, and static Godot `agpb engine status` and `agpb engine capabilities` behavior plus the remaining planned groups |
| [Architecture](architecture.md) | Control plane, adapters, bridges, project state, and generated surfaces |
| [Engine support](engine-support.md) | Common engine contract and engine-specific verification thresholds |
| [Security and permissions](security-and-permissions.md) | Approval classes, stop conditions, isolation, and data movement |
| [Assets and provenance](assets-and-provenance.md) | Placeholder-first asset lifecycle, rights metadata, QA, and providers |
| [Evidence and verification](evidence-and-verification.md) | Receipts, evidence grades, deterministic playtests, and golden tasks |
| [Roadmap](roadmap.md) | Implementation order and release criteria |

The file [planned-surface.json](planned-surface.json) is manually maintained public status data. The generated [foundation plan](../generated/foundation-plan.json) is a digest-bound projection that separates available and planned commands and records the runtime-registry digest. Neither file is executable configuration; the source-built CLI consumes the validated runtime registry directly.

## Status language

- **Current** means the artifact is present and can be inspected in this repository.
- **Implemented foundation** means code and tests exist, but no user-facing runtime capability is implied.
- **Available command** means the source-built executable dispatches that exact registry command; it does not imply a published package or engine support.
- **Planned** means no usable runtime capability has been established.
- **Detected**, **headless**, **editor-preview**, and **verified** are engine support grades that require progressively stronger runtime evidence.
- A roadmap milestone does not imply availability.

## Package boundary

Included here are durable public explanations, current and planned interfaces, limits, risks, and maintenance rules. Excluded are private planning notes, raw investigation records, local machine paths, secrets, logs, captures, and runtime evidence.

## Maintenance

English files are authoritative. Each Korean mirror records its English file path, SHA-256 digest, and translation date. A public documentation change must update both languages in the same change and pass checks for pairs, digests, links, heading structure, code fences, command/type parity, runtime-registry drift, and private-path leakage.

Project maintainers own this package. Review it whenever implementation status, public commands, support grades, permission defaults, engine targets, or release scope changes.

## Caveats

- No live engine loop has been verified for this product.
- Exact engine patch versions will be pinned before each adapter implementation begins.
- Package naming and public interfaces remain provisional until the first release.
- A project license must be selected before external code adoption or package publication.
