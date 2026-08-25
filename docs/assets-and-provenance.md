# Assets and Provenance

> Status: planned asset policy. No asset pipeline or provider integration exists yet.

[한국어](assets-and-provenance.ko.md) · [Documentation](README.md)

## Default lifecycle

The planned production path is:

`typed placeholder → user/licensed asset → candidate → QA → approved → production`

Every gameplay or UI asset begins as a typed slot with purpose, expected dimensions or scale, format, collision or interaction needs, performance budget, and fallback behavior. A placeholder remains valid until a candidate proves it satisfies that slot.

No downloaded, converted, or generated file is production-ready merely because creation succeeded.

## `AssetProvenance`

Each candidate is planned to carry:

- Stable asset and slot identities.
- Original source category, lineage, and source file hash.
- Declared license or rights status and any attribution obligations.
- Transformation steps, tool versions, input hashes, and output hashes.
- Provider, model, checkpoint, prompt digest, seed, and settings when generation is used.
- Estimated and actual cost, external-transmission approval, and reviewer approval.
- Engine import settings, dependencies, QA results, promotion state, and rollback target.

Unknown rights or missing lineage blocks promotion to production. The system does not infer ownership from file availability.

## Supported first-version inputs

The first version is planned to fully support deterministic placeholders and user-provided or licensed assets. Placeholders should be engine-native, reproducible, inexpensive to rebuild, visually distinguishable by role, and suitable for gameplay testing.

Optional local Blender, image, or ML tools may be detected and configured by the user, but they are never installed automatically. Their outputs follow the same candidate, provenance, QA, and approval path.

## Hosted provider boundary

Hosted providers are disabled by default. At most one image-provider pack may be active in the first version. Before each call, the user must see and approve the destination, transmitted data, provider/model, expected cost, rights assumptions, and retention caveat.

Installing a provider pack does not approve later network access. A response is quarantined as a candidate until its content, dimensions, format, rights metadata, file hash, and engine import are checked.

3D and audio generation are deferred to later packs. Cinematic and video generation are outside the first-version scope.

## QA and promotion

Asset QA is type-specific and engine-backed where relevant. It may include dimensions, color space, alpha, compression, mesh topology, scale, pivots, UVs, materials, animation, collision, memory, import warnings, visual state coverage, and runtime performance.

Promotion is a staged operation. It validates the candidate, records approvals, updates stable bindings, imports or compiles, runs affected gameplay/UI checks, captures evidence, and retains a rollback path. Failure leaves the existing production asset unchanged whenever possible.

## UI assets

HUD and menu assets use stable element and asset IDs, parent-relative hierarchy, safe-area behavior, and appropriate atlas or nine-slice rules. Visual similarity, interaction/focus, and gameplay-state binding are evaluated separately across viewport, state, input-modality, and locale combinations.

A rendered frame is not proof that editable hierarchy, interaction, accessibility, or gameplay binding is correct. The receipt links editable source, imported asset, scene hierarchy, runtime state, and capture by hash.
