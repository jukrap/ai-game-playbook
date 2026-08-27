# Assets and Provenance

> Status: the asset policy and `AssetProvenance` contract exist. Automated generation providers and engine-backed asset QA are not available.

[한국어](assets-and-provenance.ko.md) · [Documentation](README.md)

## Lifecycle

Every asset follows the same promotion path:

`typed placeholder → user or licensed asset → candidate → QA → approved → production`

An asset may stop at any stage. Generation, conversion, file decode, or engine import success does not skip rights review, visual or audio review, runtime QA, performance checks, or approval.

## Provenance record

`AssetProvenance` records the information needed to understand and reproduce an asset decision:

- source type, lineage, original and current file hashes;
- license, rights status, restrictions, and approval;
- transformations and tools;
- provider, model, checkpoint, prompt inputs, and seed when applicable;
- external transmission and cost;
- technical, aesthetic, runtime, performance, and production QA state.

Unknown fields remain unknown. The harness does not infer ownership or grant rights.

## First-alpha sources

The first alpha fully supports deterministic typed placeholders and user-provided assets. Placeholders should make asset role, scale, collision, orientation, pivot, and replacement boundary explicit.

User assets enter as candidates until provenance and applicable QA are complete. The harness preserves a fallback so a rejected candidate does not block gameplay work.

Blender and local image workflows may be optional tools, but the harness does not install them automatically. Local tools still require exact executable identity, bounded paths, outputs, and receipts when they become executable features.

## QA gates

Applicable checks include:

| Gate | Examples |
| --- | --- |
| File integrity | Format, decode, dimensions, channels, duration, hash |
| Engine import | Import settings, warnings, scale, orientation, materials, animation |
| Runtime | Correct scene, camera, lighting, playback, collision, interaction |
| Performance | Texture and mesh budgets, memory, draw calls, shader cost, audio size |
| Product | Style fit, readability, accessibility, content policy, approval |

Passing one gate does not imply another. A decoded PNG is not runtime evidence, and an imported mesh is not production approval.

## Hosted providers

Hosted providers are disabled by default. The first optional provider pack may support at most one image provider.

Before a call, the user must see and approve the destination, transmitted data, model or checkpoint, expected cost, rights terms, and output handling. Network permission, external-transfer permission, and paid-call permission are separate decisions.

Provider output enters the lifecycle as a candidate. It never moves directly to production.

## Deferred scope

Generated 3D and audio assets are later packs. Computer-generated video is outside the first version. Mobile, console, XR, and platform-store asset requirements are also deferred.
