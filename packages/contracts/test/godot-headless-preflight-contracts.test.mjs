import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function containment(projectRootIdentityDigest = digest("b")) {
  return {
    assessmentDigest: digest("6"),
    requestDigest: contracts.computeProcessContainmentRequestDigest({
      schemaVersion: "1.0.0",
      workload: "engine-project-process",
      projectRootIdentityDigest,
      policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
      requirements: contracts.PROCESS_CONTAINMENT_REQUIREMENTS,
    }),
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    providerCatalogDigest: digest("8"),
    decision: "block",
    evidenceGrade: "implemented",
  };
}

function report() {
  const value = {
    schemaVersion: "1.0.0",
    commandId: "engine.headless-preflight",
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("a"),
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    project: {
      id: "sample.graybox",
      identityDigest: digest("b"),
      rootIdentityDigest: digest("b"),
      inspectionDigest: digest("c"),
    },
    executable: {
      digest: digest("d"),
      identityDigest: digest("e"),
    },
    targetVersion: "4.7.2",
    targetReleaseStatus: "stable",
    versionProbe: {
      digest: digest("f"),
      status: "invalid-output",
      exactTargetMatch: false,
    },
    mode: "dynamic-main-scene",
    frameBudget: 2,
    invocationDigest: contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    containment: containment(),
    status: "blocked",
    code: "godot-headless-containment-unavailable",
    blockers: [
      "godot-headless-containment-unavailable",
      "godot-headless-version-unverified",
    ],
    preconditions: {
      version: "blocked",
      containment: "blocked",
    },
    isolation: {
      filesystem: "unavailable",
      network: "unavailable",
      childProcesses: "unavailable",
      writablePaths: [],
    },
    execution: {
      processStarted: false,
      startedAt: "2026-08-27T01:00:00.000Z",
      endedAt: "2026-08-27T01:00:00.010Z",
      durationMs: 10,
    },
    authorization: {
      authorizationId: "018f6f35-2c9e-7d1a-8a4b-123456789abe",
      requestDigest: digest("1"),
      status: "failed",
      mutationUncertain: false,
      violations: [],
      approvalIds: ["approval.host-tool-inspection"],
      durationMs: 10,
      outputBytes: 0,
      settledAt: "2026-08-27T01:00:00.011Z",
    },
    receipt: {
      status: "retained",
      receiptId: "018f6f35-2c9e-7d1a-8a4b-123456789abf",
      receiptDigest: digest("2"),
      headDigest: digest("3"),
      chainLength: 1,
    },
    support: {
      grade: "planned",
      evidenceGrade: "implemented",
      reason: "No contained Godot project process was started.",
    },
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  };
  const { schemaVersion: _, commandId: __, ...digestInput } = value;
  return {
    ...value,
    preflightDigest:
      contracts.computeGodotHeadlessPreflightDigest(digestInput),
  };
}

test("Godot headless preflight contracts retain a fail-closed blocked admission", () => {
  assert.equal(
    contracts.godotHeadlessPreflightRequestSchema.version,
    "1.0.0",
  );
  assert.equal(
    contracts.godotHeadlessPreflightReportSchema.version,
    "1.0.0",
  );

  const value = report();
  assert.doesNotThrow(() =>
    contracts.assertGodotHeadlessPreflightReportSemantics(value),
  );
  assert.equal(value.execution.processStarted, false);
  assert.equal(value.containment.decision, "block");
  assert.equal("projectRoot" in value, false);
  assert.equal("arguments" in value, false);
  assert.equal("stdout" in value, false);
});

test("Godot headless preflight semantics reject false execution and support claims", () => {
  const value = report();
  for (const changed of [
    { ...value, externalProcessStarted: true },
    {
      ...value,
      support: { ...value.support, grade: "headless" },
    },
    {
      ...value,
      preconditions: { ...value.preconditions, containment: "passed" },
    },
    {
      ...value,
      containment: { ...value.containment, decision: "allow" },
    },
    {
      ...value,
      containment: {
        ...value.containment,
        policyDigest: digest("9"),
      },
    },
    {
      ...value,
      blockers: ["godot-headless-version-unverified"],
      code: "godot-headless-version-unverified",
    },
  ]) {
    assert.throws(
      () => contracts.assertGodotHeadlessPreflightReportSemantics(changed),
      TypeError,
    );
  }
});

test("Godot headless preflight semantics reject malformed nested evidence deterministically", () => {
  const value = report();
  const { schemaVersion: _, commandId: __, preflightDigest: ___, ...digestInput } =
    value;

  assert.throws(
    () =>
      contracts.computeGodotHeadlessPreflightDigest({
        ...digestInput,
        versionProbe: null,
      }),
    {
      name: "TypeError",
      message: "Godot headless preflight blockers are contradictory",
    },
  );
});

test("Godot headless preflight containment request digest cannot be rebound", () => {
  const value = report();
  const changed = {
    ...value,
    containment: {
      ...value.containment,
      requestDigest: digest("9"),
    },
  };
  const {
    schemaVersion: _,
    commandId: __,
    preflightDigest: ___,
    ...digestInput
  } = changed;
  assert.throws(
    () => {
      const reattested = {
        ...changed,
        preflightDigest:
          contracts.computeGodotHeadlessPreflightDigest(digestInput),
      };
      contracts.assertGodotHeadlessPreflightReportSemantics(reattested);
    },
    TypeError,
  );
});
