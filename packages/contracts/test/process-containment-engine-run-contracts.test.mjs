import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digests = Array.from({ length: 24 }, (_, index) =>
  contracts.digestCanonicalJson({ engineRun: index }),
);

function request() {
  const executionProfile =
    contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE;
  return {
    schemaVersion: "1.0.0",
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789af0",
    admissionDigest: digests[0],
    providerDescriptorDigest: digests[1],
    providerCatalogDigest: digests[2],
    host: { platform: "windows", architecture: "x64" },
    engine: "godot",
    workload: "engine-project-process",
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    profile: {
      id: executionProfile.profileId,
      digest: executionProfile.profileDigest,
      contractDigest: executionProfile.contractDigest,
      catalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    },
    operationId: "engine.headless-preflight",
    invocationDigest: contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    inputBindingDigest: null,
    snapshotBindingDigest: digests[3],
    project: {
      rootIdentityDigest: digests[4],
      snapshotDigest: digests[5],
      manifestDigest: digests[6],
      fileCount: 3,
      directoryCount: 2,
      totalBytes: 4_096,
    },
    executable: {
      snapshotDigest: digests[7],
      digest: digests[8],
      identityDigest: digests[9],
      bytes: 8_192,
    },
    issuedAt: "2026-08-29T00:00:00.000Z",
    startDeadline: "2026-08-29T00:00:30.000Z",
    limits: structuredClone(executionProfile.limits),
  };
}

function replayRequest() {
  const value = request();
  const executionProfile =
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE;
  value.profile = {
    id: executionProfile.profileId,
    digest: executionProfile.profileDigest,
    contractDigest: executionProfile.contractDigest,
    catalogDigest:
      contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  };
  value.operationId = executionProfile.operationId;
  value.invocationDigest = executionProfile.invocationDigest;
  value.inputBindingDigest = digests[11];
  value.limits = structuredClone(executionProfile.limits);
  return value;
}

function requestForProfile(executionProfile) {
  const value = request();
  value.profile = {
    id: executionProfile.profileId,
    digest: executionProfile.profileDigest,
    contractDigest: executionProfile.contractDigest,
    catalogDigest:
      contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  };
  value.operationId = executionProfile.operationId;
  value.invocationDigest = executionProfile.invocationDigest;
  value.inputBindingDigest = contracts.sha256Digest(
    `input:${executionProfile.profileId}`,
  );
  value.limits = structuredClone(executionProfile.limits);
  return value;
}

function successfulReportInput(runRequest = request()) {
  return {
    runId: runRequest.runId,
    request: runRequest,
    requestDigest:
      contracts.computeProcessContainmentEngineRunRequestDigest(runRequest),
    admissionDigest: runRequest.admissionDigest,
    providerDescriptorDigest: runRequest.providerDescriptorDigest,
    providerCatalogDigest: runRequest.providerCatalogDigest,
    engine: runRequest.engine,
    profileDigest: runRequest.profile.digest,
    profileContractDigest: runRequest.profile.contractDigest,
    profileCatalogDigest: runRequest.profile.catalogDigest,
    operationId: runRequest.operationId,
    invocationDigest: runRequest.invocationDigest,
    inputBindingDigest: runRequest.inputBindingDigest,
    snapshotBindingDigest: runRequest.snapshotBindingDigest,
    projectSnapshotDigest: runRequest.project.snapshotDigest,
    executableSnapshotDigest: runRequest.executable.snapshotDigest,
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:03.000Z",
    durationMs: 2_000,
    process: {
      started: true,
      startedAt: "2026-08-29T00:00:02.000Z",
      exitCode: 0,
      totalProcesses: 1,
      activeProcesses: 0,
    },
    output: {
      logDigest: digests[10],
      capturedBytes: 128,
      observedBytes: 128,
      truncated: false,
    },
    termination: {
      requested: false,
      confirmed: true,
      cause: "none",
    },
    effects: {
      sourceProjectPreserved: true,
      sourceExecutablePreserved: true,
      stagedProjectBaselinePreserved: true,
      stagedExecutableBaselinePreserved: true,
      profileBudgetPreserved: true,
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
    reportDigest: contracts.computeProcessContainmentEngineRunReportDigest(input),
  };
}

test("engine run request preserves the fixed path-free Godot preflight profile", () => {
  const value = request();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunRequestSemantics(value),
  );
  assert.equal(
    contracts.computeProcessContainmentEngineRunRequestDigest(value),
    contracts.computeProcessContainmentEngineRunRequestDigest(
      structuredClone(value),
    ),
  );
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("\\"), false);
  assert.equal(serialized.includes("project.godot"), false);
  assert.equal(serialized.includes("--headless"), false);

  for (const mutate of [
    (candidate) => {
      candidate.profile.id = "caller-selected";
    },
    (candidate) => {
      candidate.engine = "unity";
    },
    (candidate) => {
      candidate.operationId = "engine.play";
    },
    (candidate) => {
      candidate.project.fileCount =
        contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES + 1;
    },
    (candidate) => {
      candidate.project.totalBytes =
        contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES + 1;
    },
    (candidate) => {
      candidate.executable.bytes = contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES + 1;
    },
    (candidate) => {
      candidate.startDeadline = "2026-08-29T00:00:30.001Z";
    },
    (candidate) => {
      candidate.limits.maxProcesses = 2;
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(
      () => contracts.assertProcessContainmentEngineRunRequestSemantics(changed),
      TypeError,
    );
  }
});

test("engine run request admits only the registered deterministic replay tuple", () => {
  const value = replayRequest();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunRequestSemantics(value),
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(
      report(successfulReportInput(value)),
    ),
  );

  for (const mutate of [
    (candidate) => {
      candidate.profile.contractDigest =
        contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.contractDigest;
    },
    (candidate) => {
      candidate.operationId = "engine.headless-preflight";
    },
    (candidate) => {
      candidate.invocationDigest =
        contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST;
    },
    (candidate) => {
      candidate.inputBindingDigest = null;
    },
    (candidate) => {
      candidate.limits.idleTimeoutMs += 1;
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(
      () => contracts.assertProcessContainmentEngineRunRequestSemantics(changed),
      TypeError,
    );
  }
});

test("persistence cycle requires both ordered processes before succeeding", () => {
  const persistence = requestForProfile(
    contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE,
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunRequestSemantics(persistence),
  );

  const completedInput = successfulReportInput(persistence);
  completedInput.process.totalProcesses = 2;
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(
      report(completedInput),
    ),
  );

  const incompleteInput = successfulReportInput(persistence);
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineRunReportSemantics(
        report(incompleteInput),
      ),
    TypeError,
  );
});

test("engine run request keeps project import and semantic validation distinct", () => {
  const projectImport = requestForProfile(
    contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
  );
  const validation = requestForProfile(
    contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunRequestSemantics(projectImport),
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunRequestSemantics(validation),
  );
  assert.notEqual(projectImport.profile.id, validation.profile.id);
  assert.notEqual(projectImport.invocationDigest, validation.invocationDigest);

  const substituted = structuredClone(validation);
  substituted.profile = structuredClone(projectImport.profile);
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineRunRequestSemantics(substituted),
    TypeError,
  );

  const validationIdleInput = successfulReportInput(validation);
  validationIdleInput.process.exitCode = 123;
  validationIdleInput.termination.requested = true;
  validationIdleInput.termination.cause = "idle-timeout";
  validationIdleInput.outcome = "failed";
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(
      report(validationIdleInput),
    ),
  );

  const importIdleInput = successfulReportInput(projectImport);
  importIdleInput.process.exitCode = 123;
  importIdleInput.termination.requested = true;
  importIdleInput.termination.cause = "idle-timeout";
  importIdleInput.outcome = "failed";
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineRunReportSemantics(
        report(importIdleInput),
      ),
    TypeError,
  );
});

test("only a clean settled engine run can report succeeded", () => {
  const succeeded = report();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(succeeded),
  );
  assert.equal(JSON.stringify(succeeded).includes("project.godot"), false);

  for (const mutate of [
    (candidate) => {
      candidate.process.exitCode = 1;
    },
    (candidate) => {
      candidate.process.startedAt = null;
    },
    (candidate) => {
      candidate.output.truncated = true;
      candidate.output.observedBytes += 1;
    },
    (candidate) => {
      candidate.effects.sourceProjectPreserved = false;
    },
    (candidate) => {
      candidate.effects.stagedProjectBaselinePreserved = false;
    },
    (candidate) => {
      candidate.effects.stagedExecutableBaselinePreserved = false;
    },
    (candidate) => {
      candidate.effects.profileBudgetPreserved = false;
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
      candidate.termination.confirmed = false;
    },
    (candidate) => {
      candidate.termination.cause = "caller-cancelled";
    },
  ]) {
    const forged = structuredClone(succeeded);
    mutate(forged);
    assert.throws(() => {
      const { schemaVersion: _version, reportDigest: _digest, ...input } = forged;
      forged.reportDigest =
        contracts.computeProcessContainmentEngineRunReportDigest(input);
      contracts.assertProcessContainmentEngineRunReportSemantics(forged);
    }, TypeError);
  }
});

test("safe failure and uncertain settlement remain distinguishable", () => {
  const failedInput = successfulReportInput();
  failedInput.process.exitCode = 2;
  failedInput.outcome = "failed";
  const failed = report(failedInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(failed),
  );

  const idleInput = successfulReportInput(replayRequest());
  idleInput.process.exitCode = 124;
  idleInput.termination.requested = true;
  idleInput.termination.cause = "idle-timeout";
  idleInput.outcome = "failed";
  const idle = report(idleInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(idle),
  );

  const preflightIdleInput = successfulReportInput();
  preflightIdleInput.process.exitCode = 123;
  preflightIdleInput.termination.requested = true;
  preflightIdleInput.termination.cause = "idle-timeout";
  preflightIdleInput.outcome = "failed";
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineRunReportSemantics(
        report(preflightIdleInput),
      ),
    TypeError,
  );

  const notStartedInput = successfulReportInput();
  notStartedInput.process.started = false;
  notStartedInput.process.startedAt = null;
  notStartedInput.process.exitCode = null;
  notStartedInput.process.totalProcesses = 0;
  notStartedInput.outcome = "failed";
  const notStarted = report(notStartedInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(notStarted),
  );

  const uncertainInput = successfulReportInput();
  uncertainInput.process.exitCode = null;
  uncertainInput.process.totalProcesses = null;
  uncertainInput.process.activeProcesses = null;
  uncertainInput.termination.requested = true;
  uncertainInput.termination.confirmed = false;
  uncertainInput.termination.cause = "engine-timeout";
  uncertainInput.effects.sourceProjectPreserved = false;
  uncertainInput.effects.cleanup = "uncertain";
  uncertainInput.outcome = "uncertain";
  uncertainInput.mutationUncertain = true;
  const uncertain = report(uncertainInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(uncertain),
  );

  const mislabeled = structuredClone(uncertain);
  mislabeled.outcome = "failed";
  assert.throws(() => {
    const { schemaVersion: _version, reportDigest: _digest, ...input } =
      mislabeled;
    mislabeled.reportDigest =
      contracts.computeProcessContainmentEngineRunReportDigest(input);
    contracts.assertProcessContainmentEngineRunReportSemantics(mislabeled);
  }, TypeError);
});

test("confirmed caller cancellation remains distinct from failure and uncertainty", () => {
  const runningInput = successfulReportInput();
  runningInput.process.exitCode = 125;
  runningInput.termination.requested = true;
  runningInput.termination.cause = "caller-cancelled";
  runningInput.outcome = "cancelled";
  const running = report(runningInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(running),
  );

  const stagingInput = successfulReportInput();
  stagingInput.process.started = false;
  stagingInput.process.startedAt = null;
  stagingInput.process.exitCode = null;
  stagingInput.process.totalProcesses = 0;
  stagingInput.process.activeProcesses = 0;
  stagingInput.output.capturedBytes = 0;
  stagingInput.output.observedBytes = 0;
  stagingInput.termination.cause = "caller-cancelled";
  stagingInput.effects.stagedProjectBaselinePreserved = false;
  stagingInput.effects.stagedExecutableBaselinePreserved = false;
  stagingInput.outcome = "cancelled";
  const staging = report(stagingInput);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentEngineRunReportSemantics(staging),
  );

  for (const mutate of [
    (candidate) => {
      candidate.termination.confirmed = false;
    },
    (candidate) => {
      candidate.effects.cleanup = "incomplete";
    },
    (candidate) => {
      candidate.mutationUncertain = true;
    },
    (candidate) => {
      candidate.termination.cause = "engine-timeout";
    },
  ]) {
    const forged = structuredClone(running);
    mutate(forged);
    assert.throws(() => {
      const { schemaVersion: _version, reportDigest: _digest, ...input } = forged;
      forged.reportDigest =
        contracts.computeProcessContainmentEngineRunReportDigest(input);
      contracts.assertProcessContainmentEngineRunReportSemantics(forged);
    }, TypeError);
  }
});

test("engine run contract rejects accessors without invoking them", () => {
  let called = false;
  const hostile = request();
  Object.defineProperty(hostile, "engine", {
    enumerable: true,
    get() {
      called = true;
      return "godot";
    },
  });
  assert.throws(
    () => contracts.assertProcessContainmentEngineRunRequestSemantics(hostile),
    TypeError,
  );
  assert.equal(called, false);
});
