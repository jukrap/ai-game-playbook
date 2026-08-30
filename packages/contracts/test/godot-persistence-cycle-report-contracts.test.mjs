import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (value) => contracts.digestCanonicalJson({ value });

function reportBody() {
  const outputDigest = digest("persistence-output");
  const expectationInput = {
    engine: "godot",
    targetVersion: contracts.GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus:
      contracts.GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    projectId: "golden.graybox.godot",
    sourceDigest: digest("source"),
    saveSchemaVersion: "1.0.0",
    freshStateHash: digest("fresh-state"),
    persistedStateHash: digest("persisted-state"),
  };
  const expectationDigest =
    contracts.computeGodotPersistenceCycleExpectationDigest(expectationInput);
  const requestDigest = digest("request");
  const admissionDigest = digest("admission");
  const snapshotBindingDigest = digest("snapshot-binding");
  const projectSnapshotDigest = digest("project-snapshot");
  const executableSnapshotDigest = digest("executable-snapshot");
  return {
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("registry"),
    runId: "00000000-0000-4000-8000-000000000101",
    workflow: {
      id: contracts.GODOT_PERSISTENCE_CYCLE_WORKFLOW_ID,
      version: "1.0.0",
      stepId: contracts.GODOT_PERSISTENCE_CYCLE_STEP_ID,
      resolvedPlanDigest: digest("resolved-plan"),
    },
    project: {
      id: "golden.graybox.godot",
      identityDigest: digest("project-identity"),
      inspectionDigest: digest("project-inspection"),
      sourceDigest: expectationInput.sourceDigest,
      manifestDigest: digest("manifest"),
      mainScene: "scenes/main.tscn",
    },
    executable: {
      digest: digest("executable"),
      identityDigest: digest("executable-identity"),
    },
    targetVersion: contracts.GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus:
      contracts.GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: {
      digest: digest("version-probe"),
      status: "matched",
      exactTargetMatch: true,
    },
    persistence: {
      expectationDigest,
      saveSchemaVersion: "1.0.0",
      freshStateHash: expectationInput.freshStateHash,
      persistedStateHash: expectationInput.persistedStateHash,
    },
    containment: {
      admissionDigest,
      runRequestDigest: requestDigest,
      policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
      providerDescriptorDigest: digest("provider"),
      providerCatalogDigest: digest("provider-catalog"),
      profileDigest:
        contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE
          .profileDigest,
      profileCatalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      snapshotBindingDigest,
      projectSnapshotDigest,
      executableSnapshotDigest,
      decision: "qualified",
      evidenceGrade: "locally-executed",
      expiresAt: "2026-08-30T00:02:00.000Z",
    },
    execution: {
      processStarted: true,
      startedAt: "2026-08-30T00:00:00.000Z",
      endedAt: "2026-08-30T00:00:02.000Z",
      durationMs: 2_000,
    },
    status: "succeeded",
    code: "godot-persistence-cycle-passed",
    transcript: {
      status: "validated",
      transcriptDigest: digest("transcript"),
      outputDigest,
      bytes: 2_048,
      eventCount: contracts.GODOT_PERSISTENCE_CYCLE_MAX_EVENTS,
      terminal: "persistence-cycle-passed",
      terminalCode: "passed",
      saveDigest: digest("save"),
      saveBytes: 512,
    },
    authorization: {
      authorizationId: "00000000-0000-4000-8000-000000000102",
      requestDigest: digest("authorization"),
      status: "succeeded",
      mutationUncertain: false,
      violations: [],
      approvalIds: ["approval.test-build"],
      durationMs: 2_000,
      outputBytes: 2_048,
      settledAt: "2026-08-30T00:00:02.001Z",
    },
    engineRun: {
      requestDigest,
      reportDigest: digest("engine-report"),
      admissionDigest,
      profileId:
        contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE.profileId,
      profileDigest:
        contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE
          .profileDigest,
      profileCatalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      operationId: contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
      invocationDigest: contracts.GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
      inputBindingDigest: expectationDigest,
      snapshotBindingDigest,
      projectSnapshotDigest,
      executableSnapshotDigest,
      process: {
        started: true,
        startedAt: "2026-08-30T00:00:00.100Z",
        exitCode: 0,
        totalProcesses: contracts.GODOT_PERSISTENCE_CYCLE_PHASE_COUNT,
        activeProcesses: 0,
      },
      output: {
        logDigest: outputDigest,
        capturedBytes: 2_048,
        observedBytes: 2_048,
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
    },
    receipt: {
      status: "retained",
      receiptId: "00000000-0000-4000-8000-000000000103",
      receiptDigest: digest("receipt"),
      headDigest: digest("head"),
      chainLength: 1,
    },
    support: {
      grade: "planned",
      evidenceGrade: "locally-executed",
      liveValidated: false,
      reason:
        "Contained fixture execution does not validate the exact target engine distribution.",
    },
    mutationPerformed: false,
    externalProcessStarted: true,
    networkAccessPerformed: false,
  };
}

function report() {
  const body = reportBody();
  return {
    schemaVersion: "1.0.0",
    commandId: contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
    ...body,
    reportDigest: contracts.computeGodotPersistenceCycleReportDigest(body),
  };
}

test("Godot persistence report binds a two-process transcript, settlement, and receipt", () => {
  const value = report();
  assert.doesNotThrow(() =>
    contracts.assertGodotPersistenceCycleReportSemantics(value),
  );
  assert.match(value.reportDigest, /^sha256:[0-9a-f]{64}$/u);

  for (const mutate of [
    (copy) => {
      copy.engineRun.process.totalProcesses = 1;
    },
    (copy) => {
      copy.transcript.saveBytes += 1;
    },
    (copy) => {
      copy.persistence.persistedStateHash = digest("other-state");
    },
    (copy) => {
      copy.workflow.stepId = "step.other";
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() =>
      contracts.assertGodotPersistenceCycleReportSemantics(changed),
    );
  }
});

test("Godot persistence report distinguishes rejected and unavailable output", () => {
  const rejectedBody = reportBody();
  rejectedBody.status = "failed";
  rejectedBody.code = "godot-persistence-output-event-count-invalid";
  rejectedBody.transcript = {
    status: "rejected",
    outputDigest: rejectedBody.engineRun.output.logDigest,
    bytes: rejectedBody.engineRun.output.capturedBytes,
    code: rejectedBody.code,
  };
  rejectedBody.authorization.status = "failed";
  rejectedBody.engineRun.outcome = "failed";
  rejectedBody.engineRun.process.exitCode = 2;
  assert.doesNotThrow(() =>
    contracts.computeGodotPersistenceCycleReportDigest(rejectedBody),
  );

  const unavailable = reportBody();
  unavailable.status = "uncertain";
  unavailable.code = "godot-persistence-transcript-unavailable";
  unavailable.transcript = { status: "unavailable" };
  unavailable.authorization.status = "uncertain";
  unavailable.authorization.mutationUncertain = true;
  assert.doesNotThrow(() =>
    contracts.computeGodotPersistenceCycleReportDigest(unavailable),
  );

  const uncertainEngine = reportBody();
  uncertainEngine.status = "uncertain";
  uncertainEngine.code = "godot-persistence-engine-run-uncertain";
  uncertainEngine.transcript = {
    status: "rejected",
    outputDigest: uncertainEngine.engineRun.output.logDigest,
    bytes: uncertainEngine.engineRun.output.capturedBytes,
    code: "godot-persistence-output-event-shape-invalid",
  };
  uncertainEngine.authorization.status = "uncertain";
  uncertainEngine.authorization.mutationUncertain = true;
  uncertainEngine.engineRun.outcome = "uncertain";
  uncertainEngine.engineRun.mutationUncertain = true;
  uncertainEngine.engineRun.effects.cleanup = "uncertain";
  assert.doesNotThrow(() =>
    contracts.computeGodotPersistenceCycleReportDigest(uncertainEngine),
  );
});

test("Godot persistence report rejects recomputed semantic contradictions", () => {
  const cases = [
    (body) => {
      body.engineRun.process.totalProcesses = 1;
    },
    (body) => {
      body.transcript.bytes -= 1;
      body.authorization.outputBytes -= 1;
    },
    (body) => {
      body.project.sourceDigest = digest("other-source");
    },
    (body) => {
      body.containment.profileDigest = digest("other-profile");
    },
    (body) => {
      body.project.mainScene = "../outside.tscn";
    },
  ];
  for (const mutate of cases) {
    const body = reportBody();
    mutate(body);
    assert.throws(() =>
      contracts.computeGodotPersistenceCycleReportDigest(body),
    );
  }

  const exitMismatch = reportBody();
  exitMismatch.status = "failed";
  exitMismatch.code = "godot-persistence-exit-outcome-mismatch";
  exitMismatch.authorization.status = "failed";
  exitMismatch.engineRun.outcome = "failed";
  exitMismatch.engineRun.process.exitCode = 2;
  assert.doesNotThrow(() =>
    contracts.computeGodotPersistenceCycleReportDigest(exitMismatch),
  );
});

test("Godot persistence report parsing never invokes accessors or unsafe arrays", () => {
  let accessorCalled = false;
  const hostile = report();
  Object.defineProperty(hostile, "engineRun", {
    enumerable: true,
    get() {
      accessorCalled = true;
      return null;
    },
  });
  assert.throws(() =>
    contracts.assertGodotPersistenceCycleReportSemantics(hostile),
  );
  assert.equal(accessorCalled, false);

  let iteratorCalled = false;
  const unsafe = reportBody();
  const approvals = ["approval.test-build"];
  Object.defineProperty(approvals, Symbol.iterator, {
    value() {
      iteratorCalled = true;
      return [][Symbol.iterator]();
    },
  });
  unsafe.authorization.approvalIds = approvals;
  assert.throws(() =>
    contracts.computeGodotPersistenceCycleReportDigest(unsafe),
  );
  assert.equal(iteratorCalled, false);
});
