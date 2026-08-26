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
      checkedAt: startedAt,
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
