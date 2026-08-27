import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function clearReport() {
  const body = {
    schemaVersion: "1.0.0",
    commandId: "project.initialization-recovery.assess",
    status: "clear",
    code: "initialization-recovery-clear",
    registryDigest: digest("a"),
    projectRootIdentityDigest: digest("b"),
    validationLevel: "head-and-latest-record-presence",
    inventory: {
      storeStatus: "missing",
      entriesObserved: 0,
      headFilesObserved: 0,
      recordFilesObserved: 0,
      initializationCandidates: 0,
    },
    controlState: { status: "absent" },
    selection: { status: "not-requested" },
    candidates: [],
    issues: [],
    summary: {
      terminalCandidates: 0,
      attentionCandidates: 0,
      recoveryCandidates: 0,
      blockedCandidates: 0,
      attentionIssues: 0,
      blockedIssues: 0,
    },
    finalizationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
  };
  return {
    ...body,
    reportDigest:
      contracts.computeProjectInitializationRecoveryReportDigest(body),
  };
}

function candidate(overrides = {}) {
  return {
    validationLevel: "head-and-latest-record-presence",
    runId: "11111111-1111-4111-8111-111111111111",
    checkpointId: "22222222-2222-4222-8222-222222222222",
    sequence: 0,
    checkpointDigest: digest("c"),
    headDigest: digest("d"),
    status: "waiting-approval",
    disposition: "authorization-abandoned",
    actionCode: "review-abandoned-authorization",
    projectId: "project.graybox",
    projectIdentityDigest: digest("e"),
    projectRootIdentityDigest: digest("b"),
    projectAuthority: "current",
    projectStage: "vertical-slice",
    registryDigest: digest("a"),
    registryAuthority: "current",
    workflowId: "workflow.project-initialization",
    workflowVersion: "1.0.0",
    resolvedPlanDigest: digest("f"),
    inputDigest: digest("1"),
    updatedAt: "2026-08-27T04:00:00.000Z",
    ...overrides,
  };
}

function reportWithCandidates(candidates, overrides = {}) {
  const dispositions = candidates.map(({ disposition }) => disposition);
  const body = {
    schemaVersion: "1.0.0",
    commandId: "project.initialization-recovery.assess",
    status: "attention",
    code: "initialization-recovery-attention",
    registryDigest: digest("a"),
    projectRootIdentityDigest: digest("b"),
    validationLevel: "head-and-latest-record-presence",
    inventory: {
      storeStatus: "present",
      entriesObserved: 2,
      headFilesObserved: 1,
      recordFilesObserved: 1,
      initializationCandidates: candidates.length,
    },
    controlState: { status: "tracked" },
    selection: { status: "not-requested" },
    candidates,
    issues: [],
    summary: {
      terminalCandidates: dispositions.filter((value) => value === "terminal")
        .length,
      attentionCandidates: dispositions.filter(
        (value) => value === "authorization-abandoned",
      ).length,
      recoveryCandidates: dispositions.filter((value) =>
        ["restart-recovery-required", "reconciliation-required"].includes(
          value,
        ),
      ).length,
      blockedCandidates: dispositions.filter((value) =>
        ["authority-stale", "corrupt"].includes(value),
      ).length,
      attentionIssues: 0,
      blockedIssues: 0,
    },
    finalizationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
    ...overrides,
  };
  return {
    ...body,
    reportDigest:
      contracts.computeProjectInitializationRecoveryReportDigest(body),
  };
}

test("project initialization recovery contracts are versioned, closed, and catalogued", () => {
  assert.equal(
    contracts.PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID,
    "project.initialization-recovery.assess",
  );
  assert.equal(
    contracts.projectInitializationRecoveryRequestSchema.id,
    "project-initialization-recovery-request",
  );
  assert.equal(
    contracts.projectInitializationRecoveryReportSchema.id,
    "project-initialization-recovery-report",
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS[
      "project-initialization-recovery-request"
    ],
    contracts.projectInitializationRecoveryRequestSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS[
      "project-initialization-recovery-report"
    ],
    contracts.projectInitializationRecoveryReportSchema,
  );
  assert.equal(
    contracts.projectInitializationRecoveryRequestSchema.schema
      .additionalProperties,
    false,
  );
  assert.equal(
    contracts.projectInitializationRecoveryReportSchema.schema
      .additionalProperties,
    false,
  );
});

test("recovery request accepts only a project root and optional exact run selector", () => {
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryRequestSemantics({
      schemaVersion: "1.0.0",
      projectRoot: "D:\\games\\graybox",
    }),
  );
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryRequestSemantics({
      schemaVersion: "1.0.0",
      projectRoot: "D:\\games\\graybox",
      runId: "11111111-1111-4111-8111-111111111111",
    }),
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryRequestSemantics({
        schemaVersion: "1.0.0",
        projectRoot: "D:\\games\\graybox",
        inputDigest: digest("c"),
      }),
    /field|request/i,
  );
});

test("a missing-store clear report is canonical, immutable in meaning, and digest-bound", () => {
  const report = clearReport();
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
  assert.match(report.reportDigest, /^sha256:[0-9a-f]{64}$/);
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryReportSemantics({
        ...report,
        finalizationReady: true,
      }),
    /finalization|effect|report/i,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryReportSemantics({
        ...report,
        status: "recovery-required",
      }),
    /status|digest|report/i,
  );
});

test("candidate dispositions drive attention and recovery-required status exactly", () => {
  const attention = reportWithCandidates([candidate()]);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(attention),
  );

  const active = candidate({
    status: "running",
    disposition: "restart-recovery-required",
    actionCode: "prepare-recovery-finalization",
    inFlight: { phase: "command", sideEffect: "started" },
  });
  const selected = {
    runId: active.runId,
    disposition: active.disposition,
    actionCode: active.actionCode,
    checkpoint: {
      status: "verified",
      chainLength: 2,
      checkpointDigest: active.checkpointDigest,
      headDigest: active.headDigest,
    },
    receipt: { status: "missing" },
  };
  const recovery = reportWithCandidates([active], {
    status: "recovery-required",
    code: "initialization-recovery-required",
    validationLevel: "selected-full-chain",
    selection: { status: "assessed", runId: active.runId },
    selected,
  });
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(recovery),
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryReportSemantics({
        ...recovery,
        summary: { ...recovery.summary, recoveryCandidates: 0 },
      }),
    /summary|digest/i,
  );
});

test("recovery reports reject unbound authority promoted as current and noncanonical candidates", () => {
  const valid = reportWithCandidates([candidate()]);
  const invalidAuthority = {
    ...valid,
    candidates: [
      { ...valid.candidates[0], projectRootIdentityDigest: undefined },
    ],
  };
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryReportSemantics(
        invalidAuthority,
      ),
    /candidate|authority/i,
  );

  const laterRun = candidate({
    runId: "33333333-3333-4333-8333-333333333333",
    checkpointId: "44444444-4444-4444-8444-444444444444",
  });
  const canonical = reportWithCandidates([candidate(), laterRun]);
  const reversed = {
    ...canonical,
    candidates: [...canonical.candidates].reverse(),
  };
  const { reportDigest: _reportDigest, ...reversedBody } = reversed;
  assert.throws(
    () =>
      contracts.computeProjectInitializationRecoveryReportDigest({
        ...reversedBody,
      }),
    /candidate/i,
  );
});

test("current authority may be corrupt but cannot be mislabeled as stale", () => {
  const corrupt = candidate({
    disposition: "corrupt",
    actionCode: "repair-initialization-evidence",
  });
  const valid = reportWithCandidates([corrupt], {
    status: "blocked",
    code: "initialization-recovery-blocked",
  });
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(valid),
  );

  const mislabeled = candidate({
    disposition: "authority-stale",
    actionCode: "inspect-initialization-authority",
  });
  const invalid = { ...valid, candidates: [mislabeled] };
  assert.throws(
    () =>
      contracts.assertProjectInitializationRecoveryReportSemantics(invalid),
    /candidate|authority/i,
  );
});
