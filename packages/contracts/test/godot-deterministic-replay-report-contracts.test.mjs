import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (value) => contracts.digestCanonicalJson({ value });

function reportBody() {
  const outputDigest = digest("output");
  const requestDigest = digest("request");
  const admissionDigest = digest("admission");
  const snapshotBindingDigest = digest("snapshot-binding");
  const projectSnapshotDigest = digest("project-snapshot");
  const executableSnapshotDigest = digest("executable-snapshot");
  const expectationDigest = digest("expectation");
  return {
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("registry"),
    runId: "00000000-0000-4000-8000-000000000001",
    project: {
      id: "golden.graybox.godot",
      identityDigest: digest("project-identity"),
      inspectionDigest: digest("project-inspection"),
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
    scenario: {
      id: "scenario.graybox.core",
      digest: digest("scenario"),
      expectationDigest,
    },
    containment: {
      admissionDigest,
      runRequestDigest: requestDigest,
      policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
      providerDescriptorDigest: digest("provider"),
      providerCatalogDigest: digest("provider-catalog"),
      profileDigest:
        contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE
          .profileDigest,
      profileCatalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      snapshotBindingDigest,
      projectSnapshotDigest,
      executableSnapshotDigest,
      decision: "qualified",
      evidenceGrade: "locally-executed",
      expiresAt: "2026-08-30T00:01:00.000Z",
    },
    execution: {
      processStarted: true,
      startedAt: "2026-08-30T00:00:00.000Z",
      endedAt: "2026-08-30T00:00:01.000Z",
      durationMs: 1_000,
    },
    status: "succeeded",
    code: "godot-replay-passed",
    transcript: {
      status: "validated",
      transcriptDigest: digest("transcript"),
      outputDigest,
      bytes: 1_024,
      eventCount: 3,
      oracleCount: 1,
      terminal: "replay-passed",
      terminalCode: "passed",
      terminalTick: 431,
    },
    authorization: {
      authorizationId: "00000000-0000-4000-8000-000000000002",
      requestDigest: digest("authorization"),
      status: "succeeded",
      mutationUncertain: false,
      violations: [],
      approvalIds: ["approval.test-build"],
      durationMs: 1_000,
      outputBytes: 1_024,
      settledAt: "2026-08-30T00:00:01.001Z",
    },
    engineRun: {
      requestDigest,
      reportDigest: digest("engine-report"),
      admissionDigest,
      profileId:
        contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE
          .profileId,
      profileDigest:
        contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE
          .profileDigest,
      profileCatalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      operationId: "engine.deterministic-replay",
      invocationDigest:
        contracts.GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
      inputBindingDigest: expectationDigest,
      snapshotBindingDigest,
      projectSnapshotDigest,
      executableSnapshotDigest,
      process: {
        started: true,
        startedAt: "2026-08-30T00:00:00.100Z",
        exitCode: 0,
        totalProcesses: 1,
        activeProcesses: 0,
      },
      output: {
        logDigest: outputDigest,
        capturedBytes: 1_024,
        observedBytes: 1_024,
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
      receiptId: "00000000-0000-4000-8000-000000000003",
      receiptDigest: digest("receipt"),
      headDigest: digest("head"),
      chainLength: 1,
    },
    support: {
      grade: "planned",
      evidenceGrade: "locally-executed",
      liveValidated: false,
      reason: "Synthetic contained execution does not validate an installed engine.",
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
    commandId: "engine.deterministic-replay",
    ...body,
    reportDigest:
      contracts.computeGodotDeterministicReplayReportDigest(body),
  };
}

test("Godot deterministic replay report binds transcript, engine run, settlement, and receipt", () => {
  const value = report();
  assert.doesNotThrow(() =>
    contracts.assertGodotDeterministicReplayReportSemantics(value),
  );
  assert.match(value.reportDigest, /^sha256:[0-9a-f]{64}$/u);

  const changed = structuredClone(value);
  changed.transcript.terminalTick += 1;
  assert.throws(() =>
    contracts.assertGodotDeterministicReplayReportSemantics(changed),
  );

  const missingTranscript = structuredClone(value);
  missingTranscript.transcript = { status: "unavailable" };
  assert.throws(() =>
    contracts.assertGodotDeterministicReplayReportSemantics(missingTranscript),
  );
});

test("Godot deterministic replay report parsing never invokes accessors", () => {
  let called = false;
  const hostile = report();
  Object.defineProperty(hostile, "engineRun", {
    enumerable: true,
    get() {
      called = true;
      return null;
    },
  });
  assert.throws(() =>
    contracts.assertGodotDeterministicReplayReportSemantics(hostile),
  );
  assert.equal(called, false);
});

test("Godot deterministic replay report rejects unsafe arrays without invoking iteration", () => {
  let called = false;
  const body = reportBody();
  const hostile = ["approval.test-build"];
  Object.defineProperty(hostile, Symbol.iterator, {
    value() {
      called = true;
      return [][Symbol.iterator]();
    },
  });
  body.authorization.approvalIds = hostile;

  assert.throws(() =>
    contracts.computeGodotDeterministicReplayReportDigest(body),
  );
  assert.equal(called, false);
});

test("Godot deterministic replay report rejects identity, timing, and process contradictions", () => {
  const invalidVersion = reportBody();
  invalidVersion.controlPlaneVersion = "0.0";
  assert.throws(() =>
    contracts.computeGodotDeterministicReplayReportDigest(invalidVersion),
  );

  const expiredStart = reportBody();
  expiredStart.containment.expiresAt = "2026-08-29T23:59:59.999Z";
  assert.throws(() =>
    contracts.computeGodotDeterministicReplayReportDigest(expiredStart),
  );

  const outputMismatch = reportBody();
  outputMismatch.engineRun.output.observedBytes += 1;
  assert.throws(() =>
    contracts.computeGodotDeterministicReplayReportDigest(outputMismatch),
  );

  const impossibleSuccess = reportBody();
  impossibleSuccess.engineRun.process.activeProcesses = 1;
  assert.throws(() =>
    contracts.computeGodotDeterministicReplayReportDigest(impossibleSuccess),
  );
});
