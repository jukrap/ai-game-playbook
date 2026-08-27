import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function request() {
  return {
    schemaVersion: "1.0.0",
    workload: "engine-project-process",
    projectRootIdentityDigest: digest("a"),
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    requirements: contracts.PROCESS_CONTAINMENT_REQUIREMENTS,
  };
}

function report() {
  const assessmentRequest = request();
  const value = {
    schemaVersion: "1.0.0",
    assessmentId: "018f6f35-2c9e-7d1a-8a4b-123456789ac0",
    requestDigest:
      contracts.computeProcessContainmentRequestDigest(assessmentRequest),
    projectRootIdentityDigest: assessmentRequest.projectRootIdentityDigest,
    workload: assessmentRequest.workload,
    policyDigest: assessmentRequest.policyDigest,
    requirements: assessmentRequest.requirements,
    platform: "windows",
    architecture: "x64",
    provider: {
      catalogDigest: digest("b"),
      status: "unavailable",
      code: "process-containment-provider-unavailable",
    },
    controls: {
      filesystem: {
        requirement: "deny-project-writes",
        status: "unavailable",
      },
      network: { requirement: "deny", status: "unavailable" },
      childProcesses: { requirement: "deny", status: "unavailable" },
    },
    probe: {
      status: "not-run",
      externalProcessStarted: false,
      mutationPerformed: false,
      networkAccessPerformed: false,
    },
    decision: "block",
    checkedAt: "2026-08-27T02:00:00.000Z",
    evidenceGrade: "implemented",
  };
  const { schemaVersion: _, ...digestInput } = value;
  return {
    ...value,
    assessmentDigest:
      contracts.computeProcessContainmentAssessmentDigest(digestInput),
  };
}

test("containment assessment contracts represent only a fail-closed unavailable provider", () => {
  assert.equal(
    contracts.processContainmentAssessmentRequestSchema.version,
    "1.0.0",
  );
  assert.equal(
    contracts.processContainmentAssessmentReportSchema.version,
    "1.0.0",
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentAssessmentRequestSemantics(request()),
  );

  const value = report();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentAssessmentReportSemantics(value),
  );
  assert.equal(value.decision, "block");
  assert.equal(value.probe.externalProcessStarted, false);
  assert.equal("path" in value.provider, false);
});

test("containment assessment semantics reject forged readiness and side effects", () => {
  const value = report();
  for (const changed of [
    { ...value, decision: "allow" },
    {
      ...value,
      provider: { ...value.provider, status: "ready" },
    },
    {
      ...value,
      controls: {
        ...value.controls,
        network: { ...value.controls.network, status: "verified" },
      },
    },
    {
      ...value,
      probe: { ...value.probe, externalProcessStarted: true },
    },
    {
      ...value,
      provider: { ...value.provider, path: "C:\\tools\\sandbox.exe" },
    },
  ]) {
    assert.throws(
      () =>
        contracts.assertProcessContainmentAssessmentReportSemantics(changed),
      TypeError,
    );
  }
});

test("containment assessment semantics reject malformed nested controls deterministically", () => {
  const value = report();
  const { schemaVersion: _, assessmentDigest: __, ...digestInput } = value;

  assert.throws(
    () =>
      contracts.computeProcessContainmentAssessmentDigest({
        ...digestInput,
        controls: null,
      }),
    {
      name: "TypeError",
      message: "process containment controls are outside the contract",
    },
  );
});

test("containment assessment validation rejects executable properties and provider injection", () => {
  let getterCalled = false;
  const accessorReport = report();
  Object.defineProperty(accessorReport, "provider", {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error("must not execute");
    },
  });

  assert.throws(
    () =>
      contracts.assertProcessContainmentAssessmentReportSemantics(
        accessorReport,
      ),
    TypeError,
  );
  assert.equal(getterCalled, false);

  assert.throws(
    () =>
      contracts.assertProcessContainmentAssessmentRequestSemantics({
        ...request(),
        provider: { assess() {} },
      }),
    TypeError,
  );

  const symbolReport = report();
  symbolReport[Symbol("provider")] = "hidden";
  assert.throws(
    () =>
      contracts.assertProcessContainmentAssessmentReportSemantics(
        symbolReport,
      ),
    TypeError,
  );
});
