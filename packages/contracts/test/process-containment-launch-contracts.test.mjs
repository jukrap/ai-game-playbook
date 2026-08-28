import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digests = Array.from({ length: 16 }, (_, index) =>
  contracts.digestCanonicalJson({ index }),
);

function projectSnapshotInput() {
  return {
    kind: "synthetic-read-only",
    projectRootIdentityDigest: digests[0],
    manifestDigest: digests[1],
    fileCount: 1,
    totalBytes: 128,
    capturedAt: "2026-08-29T00:00:00.000Z",
  };
}

function projectSnapshot() {
  const input = projectSnapshotInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    snapshotDigest:
      contracts.computeProcessContainmentLaunchProjectSnapshotDigest(input),
  };
}

function executableSnapshotInput() {
  return {
    kind: "provider-artifact-copy",
    providerDescriptorDigest: digests[2],
    artifactDigest: digests[3],
    artifactBytes: 4_096,
    capturedAt: "2026-08-29T00:00:00.000Z",
  };
}

function executableSnapshot() {
  const input = executableSnapshotInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    snapshotDigest:
      contracts.computeProcessContainmentLaunchExecutableSnapshotDigest(input),
  };
}

function launchRequest() {
  return {
    schemaVersion: "1.0.0",
    launchId: "018f6f35-2c9e-7d1a-8a4b-123456789ae0",
    providerDescriptorDigest: digests[2],
    providerCatalogDigest: digests[4],
    host: {
      platform: "windows",
      architecture: "x64",
    },
    workload: "engine-project-process",
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    selfTest: {
      requestDigest: digests[5],
      reportDigest: digests[6],
      expiresAt: "2026-08-29T00:01:00.000Z",
    },
    projectSnapshot: projectSnapshot(),
    executableSnapshot: executableSnapshot(),
    invocationDigest:
      contracts.PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST,
    challengeDigest: digests[7],
    expectedOutputDigest: digests[8],
    issuedAt: "2026-08-29T00:00:00.000Z",
    expiresAt: "2026-08-29T00:00:30.000Z",
    limits: {
      timeoutMs: contracts.PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
      maxOutputBytes: contracts.PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
      terminationGraceMs:
        contracts.PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS,
      maxProcesses: 1,
    },
  };
}

function successfulReportInput(request = launchRequest()) {
  return {
    launchId: request.launchId,
    request,
    requestDigest:
      contracts.computeProcessContainmentLaunchRequestDigest(request),
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    projectSnapshotDigest: request.projectSnapshot.snapshotDigest,
    executableSnapshotDigest: request.executableSnapshot.snapshotDigest,
    invocationDigest: request.invocationDigest,
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:02.000Z",
    durationMs: 1_000,
    process: {
      started: true,
      exitCode: 0,
      totalProcesses: 1,
      activeProcesses: 0,
    },
    output: {
      expectedDigest: request.expectedOutputDigest,
      observedDigest: request.expectedOutputDigest,
      capturedBytes: 128,
      observedBytes: 128,
      truncated: false,
    },
    termination: {
      requested: false,
      confirmed: true,
    },
    effects: {
      projectSnapshotPreserved: true,
      executableSnapshotPreserved: true,
      projectMutationPerformed: false,
      networkConnectionEstablished: false,
      childProcessStarted: false,
      cleanup: "complete",
    },
    outcome: "succeeded",
    mutationUncertain: false,
  };
}

function report(input = successfulReportInput()) {
  return {
    schemaVersion: "1.0.0",
    ...input,
    reportDigest:
      contracts.computeProcessContainmentLaunchReportDigest(input),
  };
}

test("launch snapshots and request bind fresh path-free identities", () => {
  const request = launchRequest();

  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentLaunchRequestSemantics(request),
  );
  assert.equal(
    request.projectSnapshot.snapshotDigest,
    contracts.computeProcessContainmentLaunchProjectSnapshotDigest(
      projectSnapshotInput(),
    ),
  );
  assert.equal(
    request.executableSnapshot.snapshotDigest,
    contracts.computeProcessContainmentLaunchExecutableSnapshotDigest(
      executableSnapshotInput(),
    ),
  );
  assert.equal(JSON.stringify(request).includes("\\"), false);

  for (const mutate of [
    (candidate) => {
      candidate.projectSnapshot.manifestDigest = digests[9];
    },
    (candidate) => {
      candidate.executableSnapshot.artifactDigest = digests[9];
    },
    (candidate) => {
      candidate.projectSnapshot.capturedAt =
        "2026-08-28T23:59:59.999Z";
    },
    (candidate) => {
      candidate.selfTest.expiresAt = "2026-08-29T00:00:29.999Z";
    },
    (candidate) => {
      candidate.limits.maxProcesses = 2;
    },
  ]) {
    const changed = structuredClone(request);
    mutate(changed);
    assert.throws(
      () => contracts.assertProcessContainmentLaunchRequestSemantics(changed),
      TypeError,
    );
  }
});

test("only a clean bounded launch can report succeeded", () => {
  const succeeded = report();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentLaunchReportSemantics(succeeded),
  );

  for (const mutate of [
    (candidate) => {
      candidate.process.exitCode = 1;
    },
    (candidate) => {
      candidate.output.observedDigest = digests[9];
    },
    (candidate) => {
      candidate.effects.projectSnapshotPreserved = false;
    },
    (candidate) => {
      candidate.effects.networkConnectionEstablished = true;
    },
    (candidate) => {
      candidate.effects.childProcessStarted = true;
    },
    (candidate) => {
      candidate.effects.cleanup = "incomplete";
    },
    (candidate) => {
      candidate.termination.requested = true;
    },
  ]) {
    const forged = structuredClone(succeeded);
    mutate(forged);
    assert.throws(
      () => {
        const { schemaVersion: _schemaVersion, reportDigest: _digest, ...input } =
          forged;
        forged.reportDigest =
          contracts.computeProcessContainmentLaunchReportDigest(input);
        contracts.assertProcessContainmentLaunchReportSemantics(forged);
      },
      TypeError,
    );
  }
});

test("failed and uncertain launch settlements remain distinguishable", () => {
  const failedInput = successfulReportInput();
  failedInput.process.exitCode = 2;
  failedInput.outcome = "failed";
  const failed = report(failedInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentLaunchReportSemantics(failed),
  );

  const uncertainInput = successfulReportInput();
  uncertainInput.process.exitCode = null;
  uncertainInput.termination.requested = true;
  uncertainInput.termination.confirmed = false;
  uncertainInput.effects.projectSnapshotPreserved = false;
  uncertainInput.effects.executableSnapshotPreserved = false;
  uncertainInput.effects.cleanup = "uncertain";
  uncertainInput.outcome = "uncertain";
  uncertainInput.mutationUncertain = true;
  const uncertain = report(uncertainInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentLaunchReportSemantics(uncertain),
  );

  const mislabeled = structuredClone(uncertain);
  mislabeled.outcome = "failed";
  assert.throws(
    () => {
      const { schemaVersion: _schemaVersion, reportDigest: _digest, ...input } =
        mislabeled;
      mislabeled.reportDigest =
        contracts.computeProcessContainmentLaunchReportDigest(input);
      contracts.assertProcessContainmentLaunchReportSemantics(mislabeled);
    },
    TypeError,
  );
});

test("launch contracts reject active objects and undeclared data", () => {
  let getterCalled = false;
  const accessor = launchRequest();
  Object.defineProperty(accessor, "launchId", {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error("must not execute");
    },
  });
  assert.throws(
    () => contracts.assertProcessContainmentLaunchRequestSemantics(accessor),
    TypeError,
  );
  assert.equal(getterCalled, false);

  const symbol = launchRequest();
  symbol[Symbol("hidden")] = true;
  assert.throws(
    () => contracts.assertProcessContainmentLaunchRequestSemantics(symbol),
    TypeError,
  );

  const unknown = report();
  unknown.projectPath = "C:\\forbidden";
  assert.throws(
    () => contracts.assertProcessContainmentLaunchReportSemantics(unknown),
    TypeError,
  );

  const custom = Object.assign(
    Object.create({ inherited: true }),
    projectSnapshot(),
  );
  const request = launchRequest();
  request.projectSnapshot = custom;
  assert.throws(
    () => contracts.assertProcessContainmentLaunchRequestSemantics(request),
    TypeError,
  );
});

test("launch schemas are foundation protocols, not public command contracts", () => {
  assert.ok(contracts.processContainmentLaunchRequestSchema);
  assert.ok(contracts.processContainmentLaunchReportSchema);
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS[
      "process-containment-launch-request"
    ],
    contracts.processContainmentLaunchRequestSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS[
      "process-containment-launch-report"
    ],
    contracts.processContainmentLaunchReportSchema,
  );
  assert.equal(
    contracts.PUBLIC_CONTRACT_SCHEMAS[
      "process-containment-launch-request"
    ],
    undefined,
  );
});
