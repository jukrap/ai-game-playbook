import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as evidence from "../dist/index.js";

const FILE_PATH = "assets/collectibles/collectible.glb";
const FILE_DIGEST = contracts.sha256Digest("collectible bytes");
const SOURCE_DIGEST = contracts.sha256Digest("source bytes");
const PARAMETERS_DIGEST = contracts.sha256Digest("parameters");

function provenance(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    assetId: "asset.collectible-mesh",
    slotId: "slot.collectible",
    state: "approved",
    source: {
      kind: "user-provided",
      label: "User supplied collectible",
      acquiredAt: "2026-08-27T04:00:00.000Z",
    },
    lineage: [
      {
        stageId: "stage.ingest",
        operation: "ingest",
        toolId: "asset.ingest",
        toolVersion: "1.0.0",
        inputHashes: [SOURCE_DIGEST],
        outputHashes: [FILE_DIGEST],
        parametersDigest: PARAMETERS_DIGEST,
        startedAt: "2026-08-27T04:00:00.000Z",
        endedAt: "2026-08-27T04:00:01.000Z",
      },
      {
        stageId: "stage.promote",
        operation: "promote",
        toolId: "asset.promote",
        toolVersion: "1.0.0",
        inputHashes: [FILE_DIGEST],
        outputHashes: [FILE_DIGEST],
        parametersDigest: PARAMETERS_DIGEST,
        startedAt: "2026-08-27T04:00:01.000Z",
        endedAt: "2026-08-27T04:00:02.000Z",
      },
    ],
    rights: {
      identifier: "LicenseRef-UserOwned",
      redistribution: "restricted",
      commercialUse: "allowed",
      userAssertion: "The user supplied this asset.",
    },
    qa: [
      {
        checkId: "qa.content",
        scope: "content",
        outcome: "pass",
        artifactHashes: [FILE_DIGEST],
        findings: [],
      },
    ],
    approvals: ["approval.asset-promote"],
    currentFiles: [
      { path: FILE_PATH, digest: FILE_DIGEST, bytes: 17 },
    ],
    ...overrides,
  };
}

function assess(record, file = {}) {
  return evidence.assessAssetProvenance({
    registry: registry.BUILTIN_REGISTRY,
    provenance: record,
    file: {
      path: FILE_PATH,
      digest: FILE_DIGEST,
      bytes: 17,
      ...file,
    },
  });
}

test("asset provenance assessment validates schema, semantics, and current file identity", () => {
  const record = provenance();
  const result = assess(record);
  record.source.label = "changed after assessment";
  record.qa[0].outcome = "fail";

  assert.equal(result.component, "artifact-provenance");
  assert.equal(result.status, "passed");
  assert.equal(result.code, "artifact.provenance-passed");
  assert.match(result.recordDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(result.asset, {
    assetId: "asset.collectible-mesh",
    slotId: "slot.collectible",
    state: "approved",
    sourceKind: "user-provided",
    lineageStages: 2,
    currentFiles: 1,
    qa: { pass: 1, fail: 0, unverified: 0, waived: 0 },
    rights: { commercialUse: "allowed", redistribution: "restricted" },
  });
  assert.deepEqual(result.semanticIssueCodes, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.asset), true);
  assert.equal(Object.isFrozen(result.asset.qa), true);
  assert.equal(Object.isFrozen(result.semanticIssueCodes), true);
  assert.equal(JSON.stringify(result).includes("changed after assessment"), false);
});

test("asset provenance assessment distinguishes schema and semantic failures", () => {
  const schemaInvalid = assess({ ...provenance(), extra: true });
  assert.equal(schemaInvalid.status, "failed");
  assert.equal(schemaInvalid.code, "artifact.provenance-schema-invalid");
  assert.equal(schemaInvalid.recordDigest, undefined);

  const semanticInvalid = assess(
    provenance({
      cost: {
        currency: "USD",
        estimated: "1.00",
        actual: "2.00",
        approvalId: "approval.asset-promote",
      },
    }),
  );
  assert.equal(semanticInvalid.status, "failed");
  assert.equal(semanticInvalid.code, "artifact.provenance-semantics-invalid");
  assert.match(semanticInvalid.recordDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(semanticInvalid.semanticIssueCodes, [
    "asset-provenance-cost-overrun",
  ]);
  assert.equal(semanticInvalid.asset, undefined);
});

test("asset provenance assessment requires an exact current-file match", () => {
  const cases = [
    { name: "path", file: { path: "assets/other.glb" } },
    { name: "digest", file: { digest: contracts.sha256Digest("other") } },
    { name: "bytes", file: { bytes: 18 } },
  ];

  for (const fixture of cases) {
    const result = assess(provenance(), fixture.file);
    assert.equal(result.status, "failed", fixture.name);
    assert.equal(
      result.code,
      "artifact.provenance-current-file-mismatch",
      fixture.name,
    );
    assert.equal(result.asset, undefined, fixture.name);
  }
});

test("asset provenance assessment rejects forged authority and open requests", () => {
  const valid = {
    registry: registry.BUILTIN_REGISTRY,
    provenance: provenance(),
    file: { path: FILE_PATH, digest: FILE_DIGEST, bytes: 17 },
  };
  const invalid = [
    { ...valid, registry: structuredClone(registry.BUILTIN_REGISTRY) },
    { ...valid, extra: true },
    { ...valid, file: { ...valid.file, extra: true } },
    { ...valid, file: { ...valid.file, path: "../escape.glb" } },
    { ...valid, file: { ...valid.file, bytes: -1 } },
  ];

  for (const value of invalid) {
    assert.throws(
      () => evidence.assessAssetProvenance(value),
      (error) =>
        error?.name === "EvidenceNormalizationError" &&
        (error?.code === "invalid-artifact-provenance-request" ||
          error?.code === "artifact-provenance-authority-mismatch"),
    );
  }
});
