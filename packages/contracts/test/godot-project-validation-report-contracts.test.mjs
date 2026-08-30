import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (value) => contracts.digestCanonicalJson({ value });
const runId = "00000000-0000-4000-8000-000000000001";
const importReceiptId = "00000000-0000-4000-8000-000000000002";
const validationReceiptId = "00000000-0000-4000-8000-000000000003";

function phaseBody({ phase, startedAt, endedAt, receipt }) {
  const profile =
    phase === "import"
      ? contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE
      : contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE;
  const expectationDigest = digest("expectation");
  const outputDigest = digest(`${phase}-output`);
  const admissionDigest = digest(`${phase}-admission`);
  const requestDigest = digest(`${phase}-request`);
  const snapshotBindingDigest = digest(`${phase}-snapshot-binding`);
  const projectSnapshotDigest = digest(`${phase}-project-snapshot`);
  const executableSnapshotDigest = digest(`${phase}-executable-snapshot`);
  return {
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("registry"),
    runId,
    workflow: {
      id: contracts.GODOT_PROJECT_VALIDATION_WORKFLOW_ID,
      version: "1.0.0",
      resolvedPlanDigest: digest("resolved-plan"),
      stepId:
        phase === "import"
          ? contracts.GODOT_PROJECT_IMPORT_STEP_ID
          : contracts.GODOT_PROJECT_VALIDATION_STEP_ID,
    },
    project: {
      id: "golden.graybox.godot",
      identityDigest: digest("project-identity"),
      inspectionDigest: digest("project-inspection"),
      sourceDigest: digest("project-source"),
      sourceManifestDigest: digest("project-source-manifest"),
      mainScene: "scenes/main.tscn",
    },
    executable: {
      digest: digest("executable"),
      identityDigest: digest("executable-identity"),
    },
    targetVersion: contracts.GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: contracts.GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: {
      digest: digest("version-probe"),
      status: "matched",
      exactTargetMatch: true,
    },
    expectationDigest,
    containment: {
      admissionDigest,
      runRequestDigest: requestDigest,
      policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
      providerDescriptorDigest: digest("provider"),
      providerCatalogDigest: digest("provider-catalog"),
      profileDigest: profile.profileDigest,
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
      startedAt,
      endedAt,
      durationMs: 1_000,
    },
    authorization: {
      authorizationId:
        phase === "import" ? importReceiptId : validationReceiptId,
      requestDigest: digest(`${phase}-authorization`),
      status: "succeeded",
      mutationUncertain: false,
      violations: [],
      approvalIds: ["approval.host-tool-inspection"],
      durationMs: 1_000,
      outputBytes: 1_024,
      settledAt: new Date(Date.parse(endedAt) + 1).toISOString(),
    },
    engineRun: {
      requestDigest,
      reportDigest: digest(`${phase}-engine-report`),
      admissionDigest,
      profileId: profile.profileId,
      profileDigest: profile.profileDigest,
      profileCatalogDigest:
        contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      operationId: profile.operationId,
      invocationDigest: profile.invocationDigest,
      inputBindingDigest: expectationDigest,
      snapshotBindingDigest,
      projectSnapshotDigest,
      executableSnapshotDigest,
      process: {
        started: true,
        startedAt: new Date(Date.parse(startedAt) + 100).toISOString(),
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
    receipt,
    support: {
      grade: "planned",
      evidenceGrade: "locally-executed",
      liveValidated: false,
      reason: "Contained fixture execution does not validate an installed engine.",
    },
    mutationPerformed: false,
    externalProcessStarted: true,
    networkAccessPerformed: false,
  };
}

function importReport() {
  const body = {
    ...phaseBody({
      phase: "import",
      startedAt: "2026-08-30T00:00:00.000Z",
      endedAt: "2026-08-30T00:00:01.000Z",
      receipt: {
        status: "retained",
        receiptId: importReceiptId,
        receiptDigest: digest("import-receipt"),
        headDigest: digest("import-head"),
        chainLength: 1,
      },
    }),
    status: "succeeded",
    code: "godot-project-import-passed",
  };
  return {
    schemaVersion: "1.0.0",
    commandId: contracts.GODOT_PROJECT_IMPORT_COMMAND_ID,
    ...body,
    reportDigest: contracts.computeGodotProjectImportReportDigest(body),
  };
}

function validationReport(predecessor = importReport()) {
  const phase = phaseBody({
    phase: "validation",
    startedAt: "2026-08-30T00:00:02.000Z",
    endedAt: "2026-08-30T00:00:03.000Z",
    receipt: {
      status: "retained",
      receiptId: validationReceiptId,
      receiptDigest: digest("validation-receipt"),
      headDigest: digest("validation-head"),
      chainLength: 2,
    },
  });
  const body = {
    ...phase,
    importPhase: {
      reportDigest: predecessor.reportDigest,
      engineRunReportDigest: predecessor.engineRun.reportDigest,
      projectSnapshotDigest: predecessor.engineRun.projectSnapshotDigest,
      sourceManifestDigest: predecessor.project.sourceManifestDigest,
      receiptId: predecessor.receipt.receiptId,
      receiptDigest: predecessor.receipt.receiptDigest,
      receiptHeadDigest: predecessor.receipt.headDigest,
      receiptChainLength: predecessor.receipt.chainLength,
      completedAt: predecessor.execution.endedAt,
    },
    status: "succeeded",
    code: "godot-project-validation-passed",
    transcript: {
      status: "validated",
      transcriptDigest: digest("validation-transcript"),
      outputDigest: phase.engineRun.output.logDigest,
      bytes: phase.engineRun.output.capturedBytes,
      eventCount: 2,
      terminal: "validation-passed",
      terminalCode: "passed",
      rootType: "Node3D",
    },
  };
  return {
    schemaVersion: "1.0.0",
    commandId: contracts.GODOT_PROJECT_VALIDATION_COMMAND_ID,
    ...body,
    reportDigest: contracts.computeGodotProjectValidationReportDigest(body),
  };
}

test("Godot project phase reports bind import, validation, and receipt lineage", () => {
  const imported = importReport();
  const validated = validationReport(imported);
  assert.doesNotThrow(() =>
    contracts.assertGodotProjectImportReportSemantics(imported),
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotProjectValidationReportSemantics(validated),
  );
  assert.equal(validated.importPhase.reportDigest, imported.reportDigest);
  assert.equal(
    validated.receipt.chainLength,
    validated.importPhase.receiptChainLength + 1,
  );
  assert.equal(validated.support.liveValidated, false);
});

test("Godot project phase reports reject digest and predecessor contradictions", () => {
  const changedImport = structuredClone(importReport());
  changedImport.code = "godot-project-import-process-failed";
  assert.throws(() =>
    contracts.assertGodotProjectImportReportSemantics(changedImport),
  );

  const wrongImportChain = structuredClone(importReport());
  wrongImportChain.receipt.chainLength = 2;
  const {
    schemaVersion: _importSchemaVersion,
    commandId: _importCommandId,
    reportDigest: _importReportDigest,
    ...wrongImportBody
  } = wrongImportChain;
  assert.throws(() =>
    contracts.computeGodotProjectImportReportDigest(wrongImportBody),
  );

  const predecessor = importReport();
  const drifted = structuredClone(validationReport(predecessor));
  drifted.importPhase.sourceManifestDigest = digest("other-source-manifest");
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    reportDigest: _reportDigest,
    ...driftedBody
  } = drifted;
  assert.throws(() =>
    contracts.computeGodotProjectValidationReportDigest(driftedBody),
  );

  const brokenChain = structuredClone(validationReport(predecessor));
  brokenChain.receipt.chainLength = 1;
  const {
    schemaVersion: _brokenSchemaVersion,
    commandId: _brokenCommandId,
    reportDigest: _brokenReportDigest,
    ...brokenBody
  } = brokenChain;
  assert.throws(() =>
    contracts.computeGodotProjectValidationReportDigest(brokenBody),
  );
});

test("Godot project phase report validation never invokes accessors", () => {
  let called = false;
  const hostile = importReport();
  Object.defineProperty(hostile, "engineRun", {
    enumerable: true,
    get() {
      called = true;
      return null;
    },
  });
  assert.throws(() =>
    contracts.assertGodotProjectImportReportSemantics(hostile),
  );
  assert.equal(called, false);
});
