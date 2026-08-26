import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;
const startedAt = "2026-08-26T01:02:03.000Z";
const endedAt = "2026-08-26T01:02:04.000Z";

const capabilityReport = {
  schemaVersion: "1.0.0",
  reportId: "capability-report.graybox",
  projectId: "sample.graybox",
  generatedAt: startedAt,
  engineIdentity: {
    engine: "godot",
    version: "4.7.2",
    projectIdentityDigest: digest,
    executableDigest: secondDigest,
  },
  environmentDigest: digest,
  capabilities: [
    {
      id: "engine.detect",
      operation: "detect",
      operationVersion: "1.0.0",
      support: "detected",
      execution: "headless",
      requiredComponents: [],
      limitations: [],
      permissions: ["read-project"],
      requiredEvidence: ["engine-identity"],
      evidenceGrade: "locally-executed",
      latestReceiptDigest: secondDigest,
      checkedAt: startedAt,
    },
  ],
};

const featureContract = {
  schemaVersion: "1.0.0",
  featureId: "feature.collectible-loop",
  version: "1.0.0",
  projectId: "sample.graybox",
  status: "approved",
  playerOutcome: "Collect every item and reach the win state.",
  scope: {
    allowedPaths: [
      { path: "gameplay/collectibles", access: "read-write", recursive: true },
    ],
    allowedEditorObjects: [],
    allowedChangeKinds: ["source", "scene", "test"],
    exclusions: ["project settings"],
  },
  completion: {
    oracleId: "oracle.collectible-win",
    criteria: [
      {
        id: "criterion.win-state",
        statement: "A deterministic replay reaches the win state.",
        evidenceKinds: ["input-replay", "state-oracle"],
      },
    ],
    zeroTestPolicy: "fail",
  },
  risk: {
    level: "medium",
    factors: ["scene mutation"],
    uncertainMutationPolicy: "stop",
  },
  budgets: {
    maxChangedFiles: 12,
    maxChangedBytes: 131072,
    maxDurationMs: 600000,
    maxOutputBytes: 2097152,
    maxRepairCycles: 3,
  },
  rollback: {
    mode: "required",
    preimageRequired: true,
    commandId: "engine.rollback",
    requiredEvidence: ["rollback-state"],
  },
  approval: {
    approvalId: "approval.collectible-loop",
    approvedBy: "user",
    approvedAt: startedAt,
    expiresAt: "2026-08-27T01:02:03.000Z",
    contractDigest: digest,
  },
};
featureContract.approval.contractDigest =
  contracts.computeFeatureContractApprovalDigest(featureContract);

const assetProvenance = {
  schemaVersion: "1.0.0",
  assetId: "asset.collectible-concept",
  slotId: "slot.collectible",
  state: "production",
  source: {
    kind: "hosted-provider",
    label: "Collectible concept image",
    acquiredAt: startedAt,
  },
  lineage: [
    {
      stageId: "stage.generate",
      operation: "generate",
      toolId: "asset.image-provider",
      toolVersion: "1.0.0",
      inputHashes: [],
      outputHashes: [secondDigest],
      parametersDigest: digest,
      startedAt,
      endedAt,
    },
    {
      stageId: "stage.qa",
      operation: "qa",
      toolId: "asset.qa",
      toolVersion: "1.0.0",
      inputHashes: [secondDigest],
      outputHashes: [secondDigest],
      parametersDigest: digest,
      startedAt: endedAt,
      endedAt: "2026-08-26T01:02:05.000Z",
    },
    {
      stageId: "stage.promote",
      operation: "promote",
      toolId: "asset.promote",
      toolVersion: "1.0.0",
      inputHashes: [secondDigest],
      outputHashes: [secondDigest],
      parametersDigest: digest,
      startedAt: "2026-08-26T01:02:05.000Z",
      endedAt: "2026-08-26T01:02:06.000Z",
    },
  ],
  rights: {
    identifier: "LicenseRef-Provider-Terms",
    redistribution: "restricted",
    commercialUse: "allowed",
  },
  generation: {
    provider: "provider.example",
    model: "image-model-v1",
    deterministic: false,
    promptDigest: digest,
  },
  transfer: {
    destination: "provider.example",
    fields: ["prompt"],
    approvalId: "approval.asset-transfer",
  },
  cost: {
    currency: "USD",
    estimated: "1.00",
    actual: "0.75",
    approvalId: "approval.asset-cost",
  },
  qa: [
    {
      checkId: "qa.asset-content",
      scope: "content",
      outcome: "pass",
      artifactHashes: [secondDigest],
      findings: [],
    },
  ],
  approvals: [
    "approval.asset-transfer",
    "approval.asset-cost",
    "approval.asset-promote",
  ],
  currentFiles: [
    {
      path: "assets/collectibles/concept.png",
      digest: secondDigest,
      bytes: 4096,
    },
  ],
};

const runReceipt = {
  schemaVersion: "1.0.0",
  receiptId: "018f6f35-2c9e-7d1a-8a4b-123456789abc",
  previousReceiptDigest: secondDigest,
  status: "succeeded",
  identity: {
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    workflowId: "workflow.verify-feature",
    stepId: "step.run-tests",
    attempt: 1,
    projectId: "sample.graybox",
    featureId: "feature.collectible-loop",
  },
  authority: {
    command: { id: "verify", version: "1.0.0" },
    registryDigest: digest,
    handlerDigest: secondDigest,
    packDigests: [],
    approvalIds: ["approval.collectible-loop"],
  },
  environment: {
    platform: "windows",
    architecture: "x64",
    nodeVersion: "22.22.0",
    projectIdentityDigest: digest,
    engine: { id: "godot", version: "4.7.2" },
  },
  timing: { startedAt, endedAt, durationMs: 1000 },
  outcomes: {
    outer: { status: "passed", exitCode: 0, timedOut: false },
    inner: { status: "passed", code: "verified", message: "Verified." },
    tests: {
      status: "passed",
      discovered: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
    },
  },
  mutation: {
    status: "none",
    changedFiles: [],
    unexpectedDirtyFiles: [],
  },
  artifacts: [],
  diagnostics: [],
  recovery: { attempted: false, outcome: "not-run", actions: [] },
  receiptDigest: digest,
};
runReceipt.receiptDigest = contracts.computeRunReceiptDigest(runReceipt);

test("semantic checks accept internally consistent capability and receipt fixtures", () => {
  assert.deepEqual(
    contracts.checkFeatureContractSemantics(featureContract),
    [],
  );
  assert.deepEqual(
    contracts.checkEngineCapabilityReportSemantics(
      capabilityReport,
    ),
    [],
  );
  assert.deepEqual(
    contracts.checkRunReceiptSemantics(
      runReceipt,
    ),
    [],
  );
});

test("feature contract semantics retain approval across lifecycle transitions", () => {
  for (const status of ["approved", "active", "completed", "expired"]) {
    const contract = structuredClone(featureContract);
    contract.status = status;
    assert.equal(contracts.isFeatureContractApprovalDigestValid(contract), true);
    assert.deepEqual(contracts.checkFeatureContractSemantics(contract), []);
  }
});

test("feature contract semantics reject stale approval and rollback contradictions", () => {
  const tampered = structuredClone(featureContract);
  tampered.playerOutcome = "A changed outcome.";
  tampered.approval.expiresAt = tampered.approval.approvedAt;
  tampered.rollback = {
    mode: "not-applicable",
    preimageRequired: true,
    commandId: "engine.rollback",
    requiredEvidence: ["rollback-state"],
  };

  assert.deepEqual(
    contracts
      .checkFeatureContractSemantics(tampered)
      .map(({ code }) => code),
    [
      "feature-contract-approval-window-invalid",
      "feature-contract-digest-mismatch",
      "feature-contract-rollback-contradiction",
    ],
  );

  const missingApproval = structuredClone(featureContract);
  missingApproval.status = "completed";
  delete missingApproval.approval;
  assert.deepEqual(
    contracts
      .checkFeatureContractSemantics(missingApproval)
      .map(({ code }) => code),
    ["feature-contract-approval-required"],
  );
});

test("asset provenance semantics accept a complete promoted provider asset", () => {
  assert.deepEqual(contracts.checkAssetProvenanceSemantics(assetProvenance), []);
});

test("asset provenance semantics reject missing consent, weak QA, and broken lineage", () => {
  const incomplete = structuredClone(assetProvenance);
  delete incomplete.generation;
  delete incomplete.transfer;
  delete incomplete.cost;
  assert.equal(
    contracts
      .checkAssetProvenanceSemantics(incomplete)
      .some(({ code }) => code === "asset-provenance-hosted-provider-incomplete"),
    true,
  );

  const waived = structuredClone(assetProvenance);
  waived.qa[0].outcome = "waived";
  waived.qa[0].waiverApprovalId = "approval.asset-waiver";
  assert.equal(
    contracts
      .checkAssetProvenanceSemantics(waived)
      .some(({ code }) => code === "asset-provenance-approval-missing"),
    true,
  );

  const broken = structuredClone(assetProvenance);
  broken.rights.commercialUse = "unknown";
  broken.qa[0].outcome = "fail";
  broken.qa[0].findings = ["Artifact failed content QA."];
  broken.cost.actual = "2.00";
  broken.lineage[1].startedAt = startedAt;
  broken.lineage[1].inputHashes = [digest];
  broken.lineage[2].operation = "edit";

  const codes = new Set(
    contracts
      .checkAssetProvenanceSemantics(broken)
      .map(({ code }) => code),
  );
  assert.equal(codes.has("asset-provenance-cost-overrun"), true);
  assert.equal(codes.has("asset-provenance-lineage-invalid"), true);
  assert.equal(codes.has("asset-provenance-promotion-invalid"), true);
  assert.equal(codes.has("asset-provenance-qa-invalid"), true);
  assert.equal(codes.has("asset-provenance-rights-invalid"), true);
});

test("run receipt semantic checks reject count and duration contradictions", () => {
  const receipt = structuredClone(runReceipt);
  receipt.outcomes.tests.discovered = 4;
  receipt.timing.durationMs = 999;
  receipt.receiptDigest = contracts.computeRunReceiptDigest(receipt);

  const issues = contracts.checkRunReceiptSemantics(receipt);
  assert.deepEqual(
    issues.map(({ code }) => code),
    ["run-receipt-duration-mismatch", "run-receipt-test-count-mismatch"],
  );
  assert.equal(Object.isFrozen(issues), true);
  assert.equal(issues.every(Object.isFrozen), true);
});

test("run receipt digests attest the canonical body and cannot self-parent", () => {
  assert.equal(typeof contracts.computeRunReceiptDigest, "function");
  assert.equal(typeof contracts.isRunReceiptDigestValid, "function");

  const valid = structuredClone(runReceipt);
  valid.receiptDigest = contracts.computeRunReceiptDigest(valid);
  assert.equal(contracts.isRunReceiptDigestValid(valid), true);
  assert.deepEqual(contracts.checkRunReceiptSemantics(valid), []);

  const tampered = structuredClone(valid);
  tampered.outcomes.inner.message = "Changed after attestation.";
  assert.equal(contracts.isRunReceiptDigestValid(tampered), false);
  assert.equal(
    contracts
      .checkRunReceiptSemantics(tampered)
      .some(({ code }) => code === "run-receipt-digest-mismatch"),
    true,
  );

  const selfParent = structuredClone(valid);
  selfParent.previousReceiptDigest = selfParent.receiptDigest;
  selfParent.receiptDigest = contracts.computeRunReceiptDigest(selfParent);
  selfParent.previousReceiptDigest = selfParent.receiptDigest;
  const issues = contracts.checkRunReceiptSemantics(selfParent);
  assert.equal(
    issues.some(({ code }) => code === "run-receipt-self-parent"),
    true,
  );
});

test("capability semantic checks reject duplicate and future observations", () => {
  const report = structuredClone(capabilityReport);
  report.capabilities.push({
    ...structuredClone(report.capabilities[0]),
    checkedAt: "2026-08-26T01:02:04.000Z",
  });

  assert.deepEqual(
    contracts
      .checkEngineCapabilityReportSemantics(report)
      .map(({ code }) => code),
    [
      "engine-capability-duplicate-id",
      "engine-capability-duplicate-operation",
      "engine-capability-future-observation",
    ],
  );
});

test("capability semantic checks bind observed support to witnessed evidence", () => {
  const detected = structuredClone(capabilityReport);
  detected.capabilities[0].evidenceGrade = "implemented";
  delete detected.capabilities[0].latestReceiptDigest;

  assert.deepEqual(
    contracts
      .checkEngineCapabilityReportSemantics(detected)
      .map(({ code }) => code),
    [
      "engine-capability-observed-without-execution-evidence",
      "engine-capability-observed-without-receipt",
    ],
  );

  const editorPreview = structuredClone(capabilityReport);
  editorPreview.capabilities[0].support = "editor-preview";
  assert.deepEqual(
    contracts
      .checkEngineCapabilityReportSemantics(editorPreview)
      .map(({ code }) => code),
    ["engine-capability-editor-without-engine-evidence"],
  );
});
