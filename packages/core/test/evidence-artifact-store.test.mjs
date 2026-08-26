import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174100";
const RECEIPT_ID = "523e4567-e89b-42d3-a456-426614174100";
const AUTHORIZATION_ID = "623e4567-e89b-42d3-a456-426614174100";
const PROJECT_ID = "project.artifact-fixture";
const WORKFLOW_ID = "workflow.artifact-fixture";
const PLAN_DIGEST = contracts.sha256Digest("artifact fixture plan");

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

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
    (candidate) => candidate.id === "doctor",
  );
  assert.ok(found);
  return found;
}

async function fixture(t, { initialize = true } = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-artifact-store-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  const root = await core.canonicalizeProjectRoot(project);
  if (initialize) await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project, root };
}

function artifact(path, content, overrides = {}) {
  return {
    artifactId: "artifact.runtime-frame",
    kind: "runtime-frame",
    path,
    digest: contracts.sha256Digest(content),
    bytes: Buffer.byteLength(content),
    complete: true,
    createdAt: new Date(Date.UTC(2026, 7, 27, 1, 0, 0, 5)).toISOString(),
    commandId: "doctor",
    ...overrides,
  };
}

function receipt(root, artifacts) {
  const descriptor = command();
  const value = {
    schemaVersion: "1.0.0",
    receiptId: RECEIPT_ID,
    status: "succeeded",
    identity: {
      runId: RUN_ID,
      workflowId: WORKFLOW_ID,
      stepId: "step.capture-runtime-frame",
      attempt: 1,
      phase: "command",
      projectId: PROJECT_ID,
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
      inputDigest: contracts.sha256Digest("artifact fixture input"),
      authorizationId: AUTHORIZATION_ID,
      authorizationRequestDigest: contracts.sha256Digest(
        "artifact fixture authorization",
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
      startedAt: new Date(Date.UTC(2026, 7, 27, 1, 0, 0, 0)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 7, 27, 1, 0, 0, 10)).toISOString(),
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
        code: "evidence-stored",
        message: "Runtime frame captured.",
      },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts,
    diagnostics: [],
    recovery: { attempted: false, outcome: "not-run", actions: [] },
    receiptDigest: contracts.sha256Digest("placeholder"),
  };
  value.receiptDigest = contracts.computeRunReceiptDigest(value);
  return value;
}

function promotionRequest(root, value, maxArtifactBytes) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: value,
    maxArtifactBytes,
  };
}

function loadRequest(root, maxArtifactBytes) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    runId: RUN_ID,
    projectId: PROJECT_ID,
    projectIdentityDigest: root.identityDigest,
    workflowId: WORKFLOW_ID,
    resolvedPlanDigest: PLAN_DIGEST,
    maxArtifactBytes,
  };
}

test("complete receipt artifacts promote to immutable bytes and a canonical manifest", async (t) => {
  assert.equal(typeof core.promoteRunReceiptArtifacts, "function");
  assert.equal(
    core.EVIDENCE_ARTIFACT_STORE_PATH,
    ".ai-game-playbook/evidence/artifacts",
  );

  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(join(project, "captures", "frame.bin"), content);
  const draft = receipt(root, [artifact("captures/frame.bin", content)]);

  const promoted = await core.promoteRunReceiptArtifacts(
    promotionRequest(root, draft, content.byteLength),
  );
  assert.equal(Object.isFrozen(promoted), true);
  assert.equal(Object.isFrozen(promoted.artifacts), true);
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.rootIdentityDigest, root.identityDigest);
  assert.equal(contracts.isRunReceiptDigestValid(promoted.receipt), true);
  assert.notEqual(promoted.receipt.receiptDigest, draft.receiptDigest);

  const stored = promoted.artifacts[0];
  assert.ok(stored);
  assert.equal(stored.sourcePath, "captures/frame.bin");
  assert.equal(stored.digest, draft.artifacts[0].digest);
  assert.equal(stored.bytes, content.byteLength);
  assert.equal(promoted.receipt.artifacts[0].path, stored.objectPath);
  assert.equal(promoted.receipt.artifacts[0].sourcePath, stored.sourcePath);
  assert.equal(
    promoted.receipt.artifacts[0].manifestDigest,
    stored.manifestDigest,
  );
  assert.deepEqual(
    await readFile(join(project, ...stored.objectPath.split("/"))),
    content,
  );

  const manifestBytes = await readFile(
    join(project, ...stored.manifestPath.split("/")),
  );
  assert.equal(manifestBytes[0] === 0xef, false);
  const manifestText = manifestBytes.toString("utf8");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifestText, `${contracts.canonicalizeJson(manifest)}\n`);
  assert.equal(
    core.computeEvidenceArtifactManifestDigest(manifest),
    manifest.manifestDigest,
  );
  assert.equal(manifest.producer.receiptId, RECEIPT_ID);
  assert.equal(manifest.artifact.path, stored.objectPath);
  assert.equal(manifest.manifestDigest, promoted.receipt.artifacts[0].manifestDigest);

  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: promoted.receipt,
    maxArtifactBytes: content.byteLength,
  });
  await writeFile(join(project, "captures", "frame.bin"), "source drift");
  const loaded = await core.loadRunReceiptChain(
    loadRequest(root, content.byteLength),
  );
  assert.equal(loaded.receipts[0].receiptDigest, promoted.receipt.receiptDigest);
});

test("unpromoted, mismatched, and over-budget complete artifacts fail before receipt mutation", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from("bounded evidence\n");
  await writeFile(join(project, "captures", "frame.txt"), content);
  const draft = receipt(root, [artifact("captures/frame.txt", content)]);

  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: draft,
      maxArtifactBytes: content.byteLength,
    }),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
  await assert.rejects(
    core.promoteRunReceiptArtifacts(
      promotionRequest(root, draft, content.byteLength - 1),
    ),
    expectCoreError("evidence-artifact-budget-exceeded"),
  );

  const wrong = receipt(root, [
    artifact("captures/frame.txt", content, {
      digest: contracts.sha256Digest("different bytes"),
    }),
  ]);
  await assert.rejects(
    core.promoteRunReceiptArtifacts(
      promotionRequest(root, wrong, content.byteLength),
    ),
    expectCoreError("evidence-artifact-source-invalid"),
  );
  assert.deepEqual(
    await readdir(
      join(project, ".ai-game-playbook", "evidence", "artifacts", "manifests"),
    ),
    [],
  );
  assert.deepEqual(
    await readdir(
      join(project, ".ai-game-playbook", "evidence", "receipts"),
    ),
    [],
  );
});

test("promotion is idempotent and concurrent callers converge on immutable identity", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from("concurrent evidence\n");
  await writeFile(join(project, "captures", "same.txt"), content);
  const draft = receipt(root, [artifact("captures/same.txt", content)]);
  const request = promotionRequest(root, draft, content.byteLength);

  const [left, right] = await Promise.all([
    core.promoteRunReceiptArtifacts(request),
    core.promoteRunReceiptArtifacts(request),
  ]);
  assert.deepEqual(left.receipt, right.receipt);
  assert.equal(
    (await readdir(join(project, ...core.EVIDENCE_ARTIFACT_OBJECTS_PATH.split("/"))))
      .length,
    1,
  );
  assert.equal(
    (
      await readdir(
        join(project, ...core.EVIDENCE_ARTIFACT_MANIFESTS_PATH.split("/")),
      )
    ).length,
    1,
  );

  const repeated = await core.promoteRunReceiptArtifacts(
    promotionRequest(root, left.receipt, content.byteLength),
  );
  assert.equal(repeated.status, "ready");
  assert.deepEqual(repeated.receipt, left.receipt);
});

test("identical artifact bytes share one object while retaining distinct manifests", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from("shared immutable evidence\n");
  await writeFile(join(project, "captures", "shared.txt"), content);
  const draft = receipt(root, [
    artifact("captures/shared.txt", content, {
      artifactId: "artifact.shared-log",
      kind: "command-output",
    }),
    artifact("captures/shared.txt", content, {
      artifactId: "artifact.shared-report",
      kind: "test-report",
    }),
  ]);
  const promoted = await core.promoteRunReceiptArtifacts(
    promotionRequest(root, draft, content.byteLength * 2),
  );
  assert.equal(new Set(promoted.receipt.artifacts.map((item) => item.path)).size, 1);
  assert.equal(
    (await readdir(join(project, ...core.EVIDENCE_ARTIFACT_OBJECTS_PATH.split("/"))))
      .length,
    1,
  );
  assert.equal(
    (
      await readdir(
        join(project, ...core.EVIDENCE_ARTIFACT_MANIFESTS_PATH.split("/")),
      )
    ).length,
    2,
  );
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: promoted.receipt,
    maxArtifactBytes: content.byteLength * 2,
  });
});

test("artifact calls snapshot request data and require runtime-issued authority", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from("detached request evidence\n");
  await writeFile(join(project, "captures", "snapshot.txt"), content);
  const draft = receipt(root, [artifact("captures/snapshot.txt", content)]);
  const request = promotionRequest(root, draft, content.byteLength);
  const pending = core.promoteRunReceiptArtifacts(request);
  draft.artifacts[0].digest = contracts.sha256Digest("mutated after dispatch");
  request.maxArtifactBytes = 0;
  const promoted = await pending;
  assert.equal(promoted.receipt.artifacts[0].digest, contracts.sha256Digest(content));

  const receipts = [promoted.receipt];
  const verifyPending = core.verifyRunReceiptArtifacts({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipts,
    maxArtifactBytes: content.byteLength,
  });
  receipts[0] = receipt(root, []);
  await verifyPending;

  await assert.rejects(
    core.promoteRunReceiptArtifacts({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: promoted.receipt,
      maxArtifactBytes: content.byteLength,
      extra: true,
    }),
    expectCoreError("invalid-evidence-artifact-store-request"),
  );
  await assert.rejects(
    core.promoteRunReceiptArtifacts({
      root,
      registry: { ...registry.BUILTIN_REGISTRY },
      receipt: promoted.receipt,
      maxArtifactBytes: content.byteLength,
    }),
    expectCoreError("invalid-evidence-artifact-store-request"),
  );
});

test("one receipt artifact identity cannot be rebound to different bytes", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const firstContent = Buffer.from("first immutable evidence\n");
  const secondContent = Buffer.from("second immutable evidence\n");
  await writeFile(join(project, "captures", "first.txt"), firstContent);
  await writeFile(join(project, "captures", "second.txt"), secondContent);
  const first = receipt(root, [artifact("captures/first.txt", firstContent)]);
  await core.promoteRunReceiptArtifacts(
    promotionRequest(root, first, firstContent.byteLength),
  );

  const conflicting = receipt(root, [
    artifact("captures/second.txt", secondContent),
  ]);
  await assert.rejects(
    core.promoteRunReceiptArtifacts(
      promotionRequest(root, conflicting, secondContent.byteLength),
    ),
    expectCoreError("evidence-artifact-conflict"),
  );
});

test("competing artifact bindings produce one manifest winner and one unreachable object", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const leftContent = Buffer.from("left competing evidence\n");
  const rightContent = Buffer.from("right competing evidence\n");
  await writeFile(join(project, "captures", "left.txt"), leftContent);
  await writeFile(join(project, "captures", "right.txt"), rightContent);
  const results = await Promise.allSettled([
    core.promoteRunReceiptArtifacts(
      promotionRequest(
        root,
        receipt(root, [artifact("captures/left.txt", leftContent)]),
        leftContent.byteLength,
      ),
    ),
    core.promoteRunReceiptArtifacts(
      promotionRequest(
        root,
        receipt(root, [artifact("captures/right.txt", rightContent)]),
        rightContent.byteLength,
      ),
    ),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(
    rejected[0].reason?.code,
    "evidence-artifact-conflict",
  );
  assert.equal(
    (
      await readdir(
        join(project, ...core.EVIDENCE_ARTIFACT_MANIFESTS_PATH.split("/")),
      )
    ).length,
    1,
  );
  assert.equal(
    (await readdir(join(project, ...core.EVIDENCE_ARTIFACT_OBJECTS_PATH.split("/"))))
      .length,
    2,
  );

  const winner = fulfilled[0].value;
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: winner.receipt,
    maxArtifactBytes: winner.receipt.artifacts[0].bytes,
  });
  await core.loadRunReceiptChain(
    loadRequest(root, winner.receipt.artifacts[0].bytes),
  );
});

test("receipt load fails closed when immutable blob or manifest bytes drift", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "captures"));
  const content = Buffer.from("tamper witness\n");
  await writeFile(join(project, "captures", "witness.txt"), content);
  const promoted = await core.promoteRunReceiptArtifacts(
    promotionRequest(
      root,
      receipt(root, [artifact("captures/witness.txt", content)]),
      content.byteLength,
    ),
  );
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: promoted.receipt,
    maxArtifactBytes: content.byteLength,
  });
  const stored = promoted.artifacts[0];
  assert.ok(stored);
  const objectNative = join(project, ...stored.objectPath.split("/"));
  const manifestNative = join(project, ...stored.manifestPath.split("/"));

  await writeFile(objectNative, Buffer.alloc(content.byteLength, 0x78));
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(root, content.byteLength)),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
  await writeFile(objectNative, content);

  const manifest = JSON.parse(await readFile(manifestNative, "utf8"));
  manifest.source.path = "captures/other.txt";
  manifest.manifestDigest =
    core.computeEvidenceArtifactManifestDigest(manifest);
  await writeFile(manifestNative, `${contracts.canonicalizeJson(manifest)}\n`);
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(root, content.byteLength)),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
});

test("incomplete artifacts remain unpromoted and cannot satisfy complete evidence", async (t) => {
  const { root } = await fixture(t);
  const incomplete = artifact("captures/pending.bin", Buffer.alloc(0), {
    bytes: 0,
    complete: false,
  });
  const draft = receipt(root, [incomplete]);
  const promoted = await core.promoteRunReceiptArtifacts(
    promotionRequest(root, draft, 0),
  );
  assert.equal(promoted.status, "ready");
  assert.deepEqual(promoted.receipt, draft);
  assert.deepEqual(promoted.artifacts, []);
  const stored = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: draft,
    maxArtifactBytes: 0,
  });
  assert.equal(stored.chainLength, 1);
});

test("artifact promotion never creates an uninitialized store", async (t) => {
  const { project, root } = await fixture(t, { initialize: false });
  await mkdir(join(project, "captures"));
  const content = Buffer.from("no implicit store\n");
  await writeFile(join(project, "captures", "frame.txt"), content);
  const draft = receipt(root, [artifact("captures/frame.txt", content)]);

  await assert.rejects(
    core.promoteRunReceiptArtifacts(
      promotionRequest(root, draft, content.byteLength),
    ),
    expectCoreError("evidence-artifact-store-not-found"),
  );
  assert.deepEqual((await readdir(project)).sort(), ["captures"]);
});

test("artifact storage rejects an outside-directory relocation", async (t) => {
  const { sandbox, project, root } = await fixture(t);
  const artifactRoot = join(
    project,
    ".ai-game-playbook",
    "evidence",
    "artifacts",
  );
  await rm(artifactRoot, { recursive: true });
  const outside = join(sandbox, "outside-artifacts");
  await mkdir(join(outside, "objects"), { recursive: true });
  await mkdir(join(outside, "manifests"), { recursive: true });
  await symlink(
    outside,
    artifactRoot,
    process.platform === "win32" ? "junction" : "dir",
  );
  await mkdir(join(project, "captures"));
  const content = Buffer.from("relocated evidence\n");
  await writeFile(join(project, "captures", "frame.txt"), content);
  const draft = receipt(root, [artifact("captures/frame.txt", content)]);

  await assert.rejects(
    core.promoteRunReceiptArtifacts(
      promotionRequest(root, draft, content.byteLength),
    ),
    expectCoreError("evidence-artifact-corrupt"),
  );
  assert.deepEqual(await readdir(join(outside, "objects")), []);
  assert.deepEqual(await readdir(join(outside, "manifests")), []);
});
