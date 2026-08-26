import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";
import * as evidence from "../dist/index.js";
import { rgbaPng } from "./fixtures/png.mjs";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174300";
const RECEIPT_ID = "523e4567-e89b-42d3-a456-426614174300";
const AUTHORIZATION_ID = "623e4567-e89b-42d3-a456-426614174300";
const SOURCE_PATH = "assets/collectibles/collectible.glb";
const ARTIFACT_ID = "artifact.collectible-file";
const ARTIFACT_KIND = "asset-file";
const PLAN_DIGEST = contracts.sha256Digest("artifact assessment plan");

function platform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function architecture() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

function command() {
  const found = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "doctor",
  );
  assert.ok(found);
  return found;
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-artifact-assessment-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  await mkdir(join(project, "assets", "collectibles"), { recursive: true });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root };
}

function draftReceipt(root, content) {
  const descriptor = command();
  const value = {
    schemaVersion: "1.0.0",
    receiptId: RECEIPT_ID,
    status: "succeeded",
    identity: {
      runId: RUN_ID,
      workflowId: "workflow.artifact-assessment",
      stepId: "step.assess-artifact",
      attempt: 1,
      phase: "command",
      projectId: "project.artifact-assessment",
      resolvedPlanDigest: PLAN_DIGEST,
    },
    authority: {
      command: {
        id: descriptor.id,
        version: descriptor.version,
        descriptorDigest: contracts.digestCanonicalJson(descriptor),
      },
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      handlerDigest: descriptor.handler.digest,
      inputDigest: contracts.sha256Digest("artifact assessment input"),
      authorizationId: AUTHORIZATION_ID,
      authorizationRequestDigest: contracts.sha256Digest(
        "artifact assessment authorization",
      ),
      packDigests: [],
      approvalIds: [],
    },
    environment: {
      platform: platform(),
      architecture: architecture(),
      nodeVersion: process.versions.node,
      projectIdentityDigest: root.identityDigest,
    },
    timing: {
      startedAt: "2026-08-27T05:00:00.000Z",
      endedAt: "2026-08-27T05:00:00.010Z",
      durationMs: 10,
    },
    effects: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 10,
      outputBytes: 0,
      repairCycles: 0,
    },
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: {
        status: "passed",
        code: "artifact-promoted",
        message: "Artifact promoted.",
      },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts: [
      {
        artifactId: ARTIFACT_ID,
        kind: ARTIFACT_KIND,
        path: SOURCE_PATH,
        digest: contracts.sha256Digest(content),
        bytes: content.byteLength,
        complete: true,
        createdAt: "2026-08-27T05:00:00.005Z",
        commandId: "doctor",
      },
    ],
    diagnostics: [],
    recovery: { attempted: false, outcome: "not-run", actions: [] },
    receiptDigest: contracts.sha256Digest("placeholder"),
  };
  value.receiptDigest = contracts.computeRunReceiptDigest(value);
  return value;
}

function provenance(content, overrides = {}) {
  const digest = contracts.sha256Digest(content);
  return {
    schemaVersion: "1.0.0",
    assetId: "asset.collectible",
    slotId: "slot.collectible",
    state: "approved",
    source: {
      kind: "user-provided",
      label: "Collectible",
      acquiredAt: "2026-08-27T04:59:59.000Z",
    },
    lineage: [
      {
        stageId: "stage.ingest",
        operation: "ingest",
        toolId: "asset.ingest",
        toolVersion: "1.0.0",
        inputHashes: [contracts.sha256Digest("source")],
        outputHashes: [digest],
        parametersDigest: contracts.sha256Digest("parameters"),
        startedAt: "2026-08-27T05:00:00.000Z",
        endedAt: "2026-08-27T05:00:00.001Z",
      },
      {
        stageId: "stage.promote",
        operation: "promote",
        toolId: "asset.promote",
        toolVersion: "1.0.0",
        inputHashes: [digest],
        outputHashes: [digest],
        parametersDigest: contracts.sha256Digest("parameters"),
        startedAt: "2026-08-27T05:00:00.001Z",
        endedAt: "2026-08-27T05:00:00.002Z",
      },
    ],
    rights: {
      identifier: "LicenseRef-UserOwned",
      redistribution: "restricted",
      commercialUse: "allowed",
    },
    qa: [
      {
        checkId: "qa.content",
        scope: "content",
        outcome: "pass",
        artifactHashes: [digest],
        findings: [],
      },
    ],
    approvals: ["approval.asset-promote"],
    currentFiles: [
      { path: SOURCE_PATH, digest, bytes: content.byteLength },
    ],
    ...overrides,
  };
}

async function promotedFixture(
  t,
  content = Buffer.from("bounded collectible bytes\n", "utf8"),
) {
  const { project, root } = await fixture(t);
  await writeFile(join(project, ...SOURCE_PATH.split("/")), content);
  const promoted = await core.promoteRunReceiptArtifacts({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: draftReceipt(root, content),
    maxArtifactBytes: content.byteLength,
  });
  return { project, root, content, promoted };
}

function request(root, receipt, content, provenanceRecord = provenance(content)) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt,
    artifactId: ARTIFACT_ID,
    expectedArtifactKind: ARTIFACT_KIND,
    expectation: { format: "utf8-text" },
    provenance: provenanceRecord,
    maxArtifactBytes: content.byteLength,
  };
}

test("stored artifact assessment binds retained bytes, format, and provenance", async (t) => {
  const { project, root, content, promoted } = await promotedFixture(t);
  await writeFile(join(project, ...SOURCE_PATH.split("/")), "source changed");

  const result = await evidence.assessStoredArtifact(
    request(root, promoted.receipt, content),
  );

  assert.equal(result.component, "artifact");
  assert.equal(result.status, "passed");
  assert.equal(result.code, "artifact.assessment-passed");
  assert.deepEqual(result.artifact, {
    artifactId: ARTIFACT_ID,
    kind: ARTIFACT_KIND,
    sourcePath: SOURCE_PATH,
    digest: contracts.sha256Digest(content),
    bytes: content.byteLength,
    manifestDigest: promoted.receipt.artifacts[0].manifestDigest,
  });
  assert.equal(result.format.status, "passed");
  assert.equal(result.provenance.status, "passed");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.artifact), true);
  assert.equal(Object.isFrozen(result.format), true);
  assert.equal(Object.isFrozen(result.provenance), true);
});

test("stored artifact assessment preserves format and provenance failures", async (t) => {
  const { root, content, promoted } = await promotedFixture(t);
  const formatFailure = await evidence.assessStoredArtifact({
    ...request(root, promoted.receipt, content, null),
    expectation: { format: "canonical-json", maxDepth: 8, maxNodes: 64 },
  });
  assert.equal(formatFailure.status, "failed");
  assert.equal(formatFailure.code, "artifact.assessment-format-failed");
  assert.equal(formatFailure.provenance.status, "not-required");

  const wrongProvenance = provenance(content, {
    currentFiles: [
      {
        path: SOURCE_PATH,
        digest: contracts.sha256Digest("other"),
        bytes: content.byteLength,
      },
    ],
  });
  const provenanceFailure = await evidence.assessStoredArtifact(
    request(root, promoted.receipt, content, wrongProvenance),
  );
  assert.equal(provenanceFailure.status, "failed");
  assert.equal(
    provenanceFailure.code,
    "artifact.assessment-provenance-failed",
  );
  assert.equal(
    provenanceFailure.provenance.code,
    "artifact.provenance-semantics-invalid",
  );

  const multipleFailure = await evidence.assessStoredArtifact({
    ...request(root, promoted.receipt, content, wrongProvenance),
    expectation: { format: "canonical-json", maxDepth: 8, maxNodes: 64 },
  });
  assert.equal(multipleFailure.status, "failed");
  assert.equal(multipleFailure.code, "artifact.assessment-multiple-failed");
});

test("stored artifact assessment preserves unsupported decode as unverified", async (t) => {
  const content = rgbaPng({ interlace: 1 });
  const { root, promoted } = await promotedFixture(t, content);
  const result = await evidence.assessStoredArtifact({
    ...request(root, promoted.receipt, content, null),
    expectation: {
      format: "png",
      maxWidth: 64,
      maxHeight: 64,
      maxPixels: 4096,
      maxDecodedBytes: 64 * 1024,
    },
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.code, "artifact.assessment-format-unverified");
  assert.equal(result.format.code, "artifact.format-png-interlace-unsupported");
});

test("stored artifact assessment fails closed when retained bytes drift", async (t) => {
  const { project, root, content, promoted } = await promotedFixture(t);
  const objectPath = promoted.receipt.artifacts[0].path;
  await writeFile(join(project, ...objectPath.split("/")), "tampered");

  await assert.rejects(
    evidence.assessStoredArtifact(request(root, promoted.receipt, content)),
    (error) =>
      error?.name === "CoreBoundaryError" &&
      String(error?.code).startsWith("evidence-artifact-"),
  );
});

test("stored artifact assessment snapshots request authority before I/O", async (t) => {
  const { root, content, promoted } = await promotedFixture(t);
  const receipt = structuredClone(promoted.receipt);
  const provenanceRecord = provenance(content);
  const pending = evidence.assessStoredArtifact(
    request(root, receipt, content, provenanceRecord),
  );
  receipt.artifacts[0].digest = contracts.sha256Digest("mutated");
  provenanceRecord.currentFiles[0].digest = contracts.sha256Digest("mutated");

  const result = await pending;
  assert.equal(result.status, "passed");
});

test("stored artifact assessment rejects open or unpromoted requests", async (t) => {
  const { root, content, promoted } = await promotedFixture(t);
  const base = request(root, promoted.receipt, content);
  const invalid = [
    { ...base, extra: true },
    { ...base, registry: structuredClone(registry.BUILTIN_REGISTRY) },
    { ...base, artifactId: "artifact.missing" },
    { ...base, expectedArtifactKind: "runtime-frame" },
    { ...base, receipt: draftReceipt(root, content) },
  ];

  for (const value of invalid) {
    await assert.rejects(
      evidence.assessStoredArtifact(value),
      (error) =>
        error?.name === "EvidenceNormalizationError" &&
        (error?.code === "invalid-stored-artifact-assessment-request" ||
          error?.code === "artifact-assessment-authority-mismatch"),
    );
  }
});
