# Documentation

> Status: describes the current source-built foundation and the intended product boundary. It does not claim released engine automation.

[한국어](README.ko.md) · [Project overview](../README.md)

Use this page to choose the shortest document that answers your question.

## Start here

| Question | Read |
| --- | --- |
| What works now? | [Status and scope](status-and-scope.md) |
| Which commands can I run? | [CLI guide](cli.md) |
| Which game-development skills are packaged? | [Skills](skills.md) |
| What is planned next? | [Roadmap](roadmap.md) |

## Use the foundation safely

| Topic | Read |
| --- | --- |
| Engine detection and verification levels | [Engine support](engine-support.md) |
| Permissions, stop rules, and data movement | [Security and permissions](security-and-permissions.md) |
| Receipts, evidence grades, and deterministic checks | [Evidence and verification](evidence-and-verification.md) |
| Placeholder assets, rights, and production promotion | [Assets and provenance](assets-and-provenance.md) |

## Understand the design

| Topic | Read |
| --- | --- |
| Shared terms, public types, and support grades | [Core concepts](concepts.md) |
| Control plane, packages, adapters, and project state | [Architecture](architecture.md) |
| Machine-readable public status | [Planned surface](planned-surface.json) |
| Registry-derived status snapshot | [Foundation plan](../generated/foundation-plan.json) |

The two JSON files report status; they are not executable configuration. The CLI dispatches only commands present in the validated runtime registry.

## Status language

- **Available**: the source-built executable dispatches that exact command.
- **Foundation**: code and tests exist, but no public workflow or engine capability is implied.
- **Planned**: the contract or roadmap exists without usable runtime support.
- **Verified**: the required engine, gameplay, and target-build evidence exists for that capability and environment.

## Language and maintenance

English files are the maintained originals. Every Korean mirror records its source path, SHA-256 digest, and translation date. Documentation checks require matching pairs, heading levels, code fences, commands, public types, links, skill catalog entries, and concise status text.

Public docs contain product facts, limits, and user guidance. Development history, local paths, raw diagnostics, secrets, and machine-specific evidence stay outside this package.
