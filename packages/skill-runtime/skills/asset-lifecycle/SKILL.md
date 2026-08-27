---
name: asset-lifecycle
description: Use when a game asset is introduced, generated, transformed, imported, reviewed, or promoted toward production use.
---
# Asset Lifecycle

Keep every asset reversible, attributable, and visibly staged.

## Workflow

1. Identify the typed asset slot, intended engine use, format, dimensions, performance budget, and fallback.
2. Start with a deterministic placeholder unless a reviewed user-provided or licensed asset already exists.
3. Record source, rights, transformations, file digest, and any provider, model, seed, approval, external transmission, or cost.
4. Keep new or changed bytes in a candidate state. Quarantine untrusted input and validate type, decode, size, and project-path boundaries before import.
5. Run the QA appropriate to the asset: technical decode/import, visual or audio review, runtime budget, integration, and fallback behavior.
6. Promote only through `candidate -> QA -> approved -> production`; preserve the prior production asset until replacement is verified.

## Stop conditions

- Do not call a hosted provider, transmit project data, or incur cost without separate approval.
- Do not infer a license or claim game readiness from generation, conversion, or import success alone.
- Do not write directly into a production slot when provenance, QA, approval, or rollback evidence is missing.

## Evidence

Report the asset state, file digest, lineage, rights status, QA results, engine/runtime evidence level, approval, and remaining limitations. Label preview-only or static evidence honestly.
