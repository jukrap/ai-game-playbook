import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digests = Array.from({ length: 16 }, (_, index) =>
  contracts.digestCanonicalJson({ index }),
);

function projectInput() {
  return {
    kind: "bounded-read-only-source",
    engine: "godot",
    projectRootIdentityDigest: digests[0],
    projectInspectionDigest: digests[1],
    manifestDigest: digests[2],
    exclusionPolicyDigest: contracts.ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST,
    fileCount: 3,
    directoryCount: 2,
    totalBytes: 4_096,
    capturedAt: "2026-08-29T00:00:00.000Z",
  };
}

function projectSnapshot() {
  const input = projectInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    snapshotDigest: contracts.computeEngineProjectSnapshotDigest(input),
  };
}

function executableInput() {
  return {
    kind: "identity-bound-executable",
    engine: "godot",
    executableDigest: digests[3],
    executableIdentityDigest: digests[4],
    bytes: 8_192,
    capturedAt: "2026-08-29T00:00:00.000Z",
  };
}

function executableSnapshot() {
  const input = executableInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    snapshotDigest: contracts.computeEngineExecutableSnapshotDigest(input),
  };
}

function bindingInput() {
  return {
    engine: "godot",
    project: projectSnapshot(),
    executable: executableSnapshot(),
  };
}

function binding() {
  const input = bindingInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    bindingDigest: contracts.computeEngineExecutionSnapshotBindingDigest(input),
  };
}

test("engine execution snapshots attest bounded path-free identities", () => {
  const value = binding();

  assert.doesNotThrow(() =>
    contracts.assertEngineExecutionSnapshotBindingSemantics(value),
  );
  assert.equal(
    value.bindingDigest,
    contracts.computeEngineExecutionSnapshotBindingDigest(bindingInput()),
  );
  assert.deepEqual(contracts.ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES, [
    ".agents",
    ".ai-game-playbook",
    ".git",
    ".godot",
    ".worktrees",
  ]);
  assert.equal(JSON.stringify(value).includes("\\"), false);
  assert.equal(JSON.stringify(value).includes("project.godot"), false);
});

test("snapshot semantics reject drift, mixed engines, and unsafe budgets", () => {
  for (const mutate of [
    (candidate) => {
      candidate.project.manifestDigest = digests[8];
    },
    (candidate) => {
      candidate.executable.engine = "unity";
    },
    (candidate) => {
      candidate.project.fileCount = contracts.ENGINE_SNAPSHOT_MAX_FILES + 1;
    },
    (candidate) => {
      candidate.project.exclusionPolicyDigest = digests[9];
    },
    (candidate) => {
      candidate.executable.capturedAt = "2026-08-29T00:00:00.001Z";
    },
  ]) {
    const changed = structuredClone(binding());
    mutate(changed);
    assert.throws(
      () => contracts.assertEngineExecutionSnapshotBindingSemantics(changed),
      TypeError,
    );
  }
});

test("contained engine admission binds one qualification and exact snapshots", () => {
  const snapshots = binding();
  const input = {
    admissionId: "018f6f35-2c9e-7d1a-8a4b-123456789ae1",
    providerDescriptorDigest: digests[5],
    providerCatalogDigest: digests[6],
    host: { platform: "windows", architecture: "x64" },
    engine: "godot",
    workload: "engine-project-process",
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    qualification: {
      syntheticLaunchRequestDigest: digests[7],
      syntheticLaunchReportDigest: digests[8],
      expiresAt: "2026-08-29T00:00:30.000Z",
    },
    operationId: "engine.headless-preflight",
    invocationDigest: digests[9],
    snapshotBindingDigest: snapshots.bindingDigest,
    projectRootIdentityDigest: snapshots.project.projectRootIdentityDigest,
    projectSnapshotDigest: snapshots.project.snapshotDigest,
    executableSnapshotDigest: snapshots.executable.snapshotDigest,
    issuedAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:00:30.000Z",
    decision: "qualified",
    evidenceGrade: "locally-executed",
  };
  const admission = {
    schemaVersion: "1.0.0",
    ...input,
    admissionDigest: contracts.computeProcessContainmentEngineAdmissionDigest(input),
  };

  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineAdmissionSemantics(admission),
  );
  assert.equal(JSON.stringify(admission).includes("\\"), false);

  for (const mutate of [
    (candidate) => {
      candidate.projectSnapshotDigest = digests[10];
    },
    (candidate) => {
      candidate.decision = "allow";
    },
    (candidate) => {
      candidate.evidenceGrade = "engine-verified";
    },
    (candidate) => {
      candidate.expiresAt = "2026-08-29T00:00:30.001Z";
    },
  ]) {
    const changed = structuredClone(admission);
    mutate(changed);
    assert.throws(
      () => contracts.assertProcessContainmentEngineAdmissionSemantics(changed),
      TypeError,
    );
  }
});
