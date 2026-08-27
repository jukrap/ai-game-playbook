import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const firstDigest = `sha256:${"1".repeat(64)}`;
const secondDigest = `sha256:${"2".repeat(64)}`;
const thirdDigest = `sha256:${"3".repeat(64)}`;

function project(state = "ready") {
  return {
    requestedPath: "D:\\games\\sample",
    canonicalPath: "D:\\games\\sample",
    identityDigest: firstDigest,
    state,
  };
}

function presentState() {
  return {
    status: "present",
    formatVersion: "1.1.0",
    projectId: "project.sample",
    revision: 2,
    stateDigest: secondDigest,
    fileDigest: thirdDigest,
  };
}

function listEntry(id = "pack.sample") {
  return {
    id,
    version: "1.2.3",
    digest: secondDigest,
    dependencyCount: 1,
    artifactCount: 2,
    artifactBytes: 24,
    ownedDirectoryCount: 1,
    installedAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
  };
}

function emptyDoctorSummary() {
  return {
    installedPacks: 0,
    registryCurrent: 0,
    registryDifferent: 0,
    registryUnavailable: 0,
    declaredArtifacts: 0,
    currentArtifacts: 0,
    missingArtifacts: 0,
    modifiedArtifacts: 0,
    unreadableArtifacts: 0,
    declaredDirectories: 0,
    currentDirectories: 0,
    missingDirectories: 0,
    modifiedDirectories: 0,
    unreadableDirectories: 0,
  };
}

test("pack inspection schemas are strict versioned contracts", () => {
  for (const schema of [
    contracts.packListRequestSchema,
    contracts.packListReportSchema,
    contracts.packDoctorRequestSchema,
    contracts.packDoctorReportSchema,
  ]) {
    assert.equal(schema.version, "1.0.0");
    assert.match(schema.digest, /^sha256:[0-9a-f]{64}$/);
  }

  for (const request of [
    contracts.packListRequestSchema,
    contracts.packDoctorRequestSchema,
  ]) {
    assert.equal(request.schema.additionalProperties, false);
    assert.deepEqual(request.schema.required, ["schemaVersion", "projectRoot"]);
    assert.deepEqual(Object.keys(request.schema.properties).sort(), [
      "projectRoot",
      "schemaVersion",
    ]);
  }
});

test("pack list summaries and digest attest a canonical bounded listing", () => {
  const entries = Object.freeze([Object.freeze(listEntry())]);
  const issues = Object.freeze([]);
  const installedState = Object.freeze(presentState());
  const summary = contracts.summarizePackListEntries(entries);
  assert.deepEqual(summary, {
    installedPacks: 1,
    dependencies: 1,
    artifacts: 2,
    artifactBytes: 24,
    ownedDirectories: 1,
  });
  const listDigest = contracts.computePackListDigest({
    registryDigest: firstDigest,
    projectIdentityDigest: firstDigest,
    projectState: "ready",
    installedState,
    entries,
    issues,
  });
  const report = {
    schemaVersion: "1.0.0",
    commandId: "pack.list",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: project(),
    installedState,
    entries,
    issues,
    summary,
    listDigest,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };

  assert.doesNotThrow(() => contracts.assertPackListReportSemantics(report));
  assert.equal(
    contracts.computePackListStatus([{ severity: "attention" }]),
    "attention",
  );
  assert.equal(
    contracts.computePackListStatus([{ severity: "blocked" }]),
    "blocked",
  );
});

test("pack list semantics reject noncanonical entries and detached aggregates", () => {
  const first = listEntry("pack.alpha");
  const second = listEntry("pack.beta");
  const installedState = presentState();
  const entries = [second, first];
  assert.throws(
    () => contracts.summarizePackListEntries(entries),
    /ordered|canonical/i,
  );

  const canonicalEntries = [first];
  const issues = [];
  const report = {
    schemaVersion: "1.0.0",
    commandId: "pack.list",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: project(),
    installedState,
    entries: canonicalEntries,
    issues,
    summary: {
      ...contracts.summarizePackListEntries(canonicalEntries),
      artifacts: 99,
    },
    listDigest: contracts.computePackListDigest({
      registryDigest: firstDigest,
      projectIdentityDigest: firstDigest,
      projectState: "ready",
      installedState,
      entries: canonicalEntries,
      issues,
    }),
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };
  assert.throws(
    () => contracts.assertPackListReportSemantics(report),
    /summary/i,
  );
});

test("pack list semantics preserve unbound and uninitialized boundaries", () => {
  const blockedIssue = {
    severity: "blocked",
    code: "project-root-unavailable",
    message: "The selected project root is unavailable.",
    nextAction: "Select one existing project directory.",
  };
  const unbound = {
    schemaVersion: "1.0.0",
    commandId: "pack.list",
    status: "blocked",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: {
      requestedPath: "D:\\missing",
      state: "unavailable",
    },
    installedState: { status: "not-inspected" },
    entries: [],
    issues: [blockedIssue],
    summary: contracts.summarizePackListEntries([]),
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };
  assert.doesNotThrow(() => contracts.assertPackListReportSemantics(unbound));

  const attentionIssue = {
    severity: "attention",
    code: "pack-runtime-uninitialized",
    message: "Pack runtime state is not initialized.",
    nextAction: "Review the initialization plan.",
  };
  const uninitializedProject = project("uninitialized");
  const uninitialized = {
    ...unbound,
    status: "attention",
    project: uninitializedProject,
    issues: [attentionIssue],
    listDigest: contracts.computePackListDigest({
      registryDigest: firstDigest,
      projectIdentityDigest: firstDigest,
      projectState: "uninitialized",
      installedState: { status: "not-inspected" },
      entries: [],
      issues: [attentionIssue],
    }),
  };
  assert.doesNotThrow(() =>
    contracts.assertPackListReportSemantics(uninitialized),
  );
});

test("pack doctor aggregates integrity and registry observations", () => {
  const packs = [
    {
      id: "pack.sample",
      version: "1.2.3",
      digest: secondDigest,
      registryStatus: "current",
      integrityStatus: "current",
      artifacts: {
        declared: 2,
        current: 2,
        missing: 0,
        modified: 0,
        unreadable: 0,
      },
      directories: {
        declared: 1,
        current: 1,
        missing: 0,
        modified: 0,
        unreadable: 0,
      },
    },
  ];
  const summary = contracts.summarizePackDoctorObservations(packs);
  assert.deepEqual(summary, {
    installedPacks: 1,
    registryCurrent: 1,
    registryDifferent: 0,
    registryUnavailable: 0,
    declaredArtifacts: 2,
    currentArtifacts: 2,
    missingArtifacts: 0,
    modifiedArtifacts: 0,
    unreadableArtifacts: 0,
    declaredDirectories: 1,
    currentDirectories: 1,
    missingDirectories: 0,
    modifiedDirectories: 0,
    unreadableDirectories: 0,
  });
  const installedState = presentState();
  const transaction = { status: "clear" };
  const findings = [];
  const reportDigest = contracts.computePackDoctorDigest({
    registryDigest: firstDigest,
    projectIdentityDigest: firstDigest,
    projectState: "ready",
    installedState,
    transaction,
    packs,
    findings,
  });
  const report = {
    schemaVersion: "1.0.0",
    commandId: "pack.doctor",
    status: "healthy",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: project(),
    installedState,
    transaction,
    packs,
    findings,
    summary,
    reportDigest,
    repairPerformed: false,
    recoveryFinalizationPerformed: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };

  assert.doesNotThrow(() => contracts.assertPackDoctorReportSemantics(report));
});

test("pack doctor requires recovery detail for active transactions", () => {
  const transaction = {
    status: "recovery-required",
    runId: "11111111-1111-4111-8111-111111111111",
    operation: "update",
    pack: { id: "pack.sample", version: "1.2.3", digest: secondDigest },
    markerFileDigest: thirdDigest,
    recovery: {
      stable: true,
      consistency: "incomplete",
      observedState: "preimage",
      mutationUncertain: false,
      finalizationAction: "append-terminal",
      reportDigest: firstDigest,
    },
  };
  const finding = {
    severity: "blocked",
    code: "pack-transaction-recovery-required",
    message: "An active pack transaction requires recovery review.",
    nextAction: "Review recovery evidence before finalization.",
    packId: "pack.sample",
  };
  assert.equal(
    contracts.computePackDoctorStatus([finding]),
    "blocked",
  );
  assert.doesNotThrow(() =>
    contracts.computePackDoctorDigest({
      registryDigest: firstDigest,
      projectIdentityDigest: firstDigest,
      projectState: "ready",
      installedState: { status: "empty" },
      transaction,
      packs: [],
      findings: [finding],
    }),
  );

  assert.throws(
    () =>
      contracts.computePackDoctorDigest({
        registryDigest: firstDigest,
        projectIdentityDigest: firstDigest,
        projectState: "ready",
        installedState: { status: "empty" },
        transaction: { status: "recovery-required" },
        packs: [],
        findings: [finding],
      }),
    /transaction|recovery/i,
  );

  const invalidTransactionReport = {
    schemaVersion: "1.0.0",
    commandId: "pack.doctor",
    status: "blocked",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: project(),
    installedState: presentState(),
    transaction: { status: "invalid" },
    packs: [
      {
        id: "pack.sample",
        version: "1.2.3",
        digest: secondDigest,
        registryStatus: "current",
        integrityStatus: "current",
        artifacts: {
          declared: 0,
          current: 0,
          missing: 0,
          modified: 0,
          unreadable: 0,
        },
        directories: {
          declared: 0,
          current: 0,
          missing: 0,
          modified: 0,
          unreadable: 0,
        },
      },
    ],
    findings: [
      {
        severity: "blocked",
        code: "pack-transaction-invalid",
        message: "The transaction state is invalid.",
        nextAction: "Review recovery evidence before mutation.",
      },
    ],
    summary: {
      ...emptyDoctorSummary(),
      installedPacks: 1,
      registryCurrent: 1,
    },
    repairPerformed: false,
    recoveryFinalizationPerformed: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };
  invalidTransactionReport.reportDigest = contracts.computePackDoctorDigest({
    registryDigest: invalidTransactionReport.registryDigest,
    projectIdentityDigest: invalidTransactionReport.project.identityDigest,
    projectState: invalidTransactionReport.project.state,
    installedState: invalidTransactionReport.installedState,
    transaction: invalidTransactionReport.transaction,
    packs: invalidTransactionReport.packs,
    findings: invalidTransactionReport.findings,
  });
  assert.throws(
    () => contracts.assertPackDoctorReportSemantics(invalidTransactionReport),
    /unsettled|integrity/i,
  );
});

test("pack doctor rejects count drift, false healthy status, and effect claims", () => {
  const installedState = { status: "empty" };
  const transaction = { status: "clear" };
  const packs = [];
  const finding = {
    severity: "blocked",
    code: "pack-owned-artifact-missing",
    message: "An owned artifact is missing.",
    nextAction: "Review the managed path before mutation.",
    packId: "pack.sample",
    path: "addons/sample.gd",
  };
  const report = {
    schemaVersion: "1.0.0",
    commandId: "pack.doctor",
    status: "healthy",
    controlPlaneVersion: "0.0.0",
    registryDigest: firstDigest,
    project: project(),
    installedState,
    transaction,
    packs,
    findings: [finding],
    summary: emptyDoctorSummary(),
    reportDigest: contracts.computePackDoctorDigest({
      registryDigest: firstDigest,
      projectIdentityDigest: firstDigest,
      projectState: "ready",
      installedState,
      transaction,
      packs,
      findings: [finding],
    }),
    repairPerformed: false,
    recoveryFinalizationPerformed: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    artifactContentExposed: false,
    sourceLocationExposed: false,
  };
  assert.throws(
    () => contracts.assertPackDoctorReportSemantics(report),
    /status/i,
  );
  assert.equal(
    contracts.packDoctorReportSchema.schema.properties.mutationPerformed.const,
    false,
  );
  assert.equal(
    contracts.packDoctorReportSchema.schema.properties.recoveryFinalizationPerformed
      .const,
    false,
  );
});
