import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const generatedAt = "2026-08-27T01:02:03.000Z";

const executionByOperation = Object.freeze({
  detect: "static",
  negotiate: "static",
  inspect: "static",
  mutate: "editor-preview",
  save: "editor-preview",
  "compile-import": "headless",
  test: "headless",
  play: "runtime",
  "input-replay": "runtime",
  logs: "runtime",
  capture: "runtime",
  profile: "runtime",
  "build-export": "packaged",
  rollback: "editor-preview",
});

function containment() {
  return {
    registration: "compiled",
    dynamicRegistration: false,
    providerCount: 0,
    catalogDigest: digest("c"),
    status: "unavailable",
    selfTestPerformed: false,
    launchAvailable: false,
    decision: "block",
    requirements: {
      filesystem: "deny-project-writes",
      network: "deny",
      childProcesses: "deny",
    },
    reason: "No verified process-containment provider is compiled into this runtime.",
  };
}

function issue(severity = "attention") {
  return {
    severity,
    code:
      severity === "blocked"
        ? "godot-project-unavailable"
        : "process-containment-provider-unavailable",
    message:
      severity === "blocked"
        ? "The selected Godot project is unavailable."
        : "Engine project process launch remains blocked.",
    nextAction:
      severity === "blocked"
        ? "Select one stable Godot project directory."
        : "Install no tool automatically; wait for a verified provider implementation.",
  };
}

function identityBoundReport() {
  const rootIdentityDigest = digest("b");
  const observedVersion = "4.7.0";
  const projectId = contracts.computeStaticEngineCapabilitiesProjectId(
    rootIdentityDigest,
  );
  const projectIdentityDigest = contracts.computeGameProjectIdentityDigest({
    projectId,
    engine: { id: "godot", version: observedVersion },
  });
  const engineStatusDigest = digest("d");
  const registryDigest = digest("a");
  const containmentSummary = containment();
  const environmentDigest = contracts.computeEngineCapabilitiesEnvironmentDigest({
    registryDigest,
    engine: "godot",
    engineStatusDigest,
    projectRootIdentityDigest: rootIdentityDigest,
    providerCatalogDigest: containmentSummary.catalogDigest,
    supportGradeCeiling: "planned",
  });
  const capabilityReport = {
    schemaVersion: "1.0.0",
    reportId: contracts.computeEngineCapabilitiesReportId({
      environmentDigest,
      generatedAt,
    }),
    projectId,
    generatedAt,
    engineIdentity: {
      engine: "godot",
      version: observedVersion,
      projectIdentityDigest,
    },
    environmentDigest,
    capabilities: contracts.ENGINE_OPERATION_KINDS.map((operation) => ({
      id: `godot.${operation}`,
      operation,
      operationVersion: "1.0.0",
      support: "planned",
      execution: executionByOperation[operation],
      requiredComponents: ["godot-adapter"],
      limitations: ["No live Godot execution evidence is retained."],
      degradeReason: "The operation has no qualifying retained engine receipt.",
      permissions: ["read-project"],
      requiredEvidence: [`engine-${operation}-receipt`],
      evidenceGrade: "documented",
      checkedAt: generatedAt,
    })),
  };
  const project = {
    status: "detected",
    requestedPath: "C:\\game",
    canonicalPath: "C:\\game",
    rootIdentityDigest,
    inspectionDigest: digest("e"),
    identitySource: "derived-static",
    projectId,
    projectIdentityDigest,
    observedVersion,
  };
  const issues = [issue()];
  const digestInput = {
    controlPlaneVersion: "0.0.0",
    registryDigest,
    engine: "godot",
    engineStatusDigest,
    project,
    containment: containmentSummary,
    capabilityReport,
    supportGradeCeiling: "planned",
    issues,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
    selfTestPerformed: false,
  };
  return {
    schemaVersion: "1.0.0",
    commandId: "engine.capabilities",
    status: contracts.computeEngineCapabilitiesStatus(issues),
    ...digestInput,
    reportDigest: contracts.computeEngineCapabilitiesReportDigest(digestInput),
  };
}

function blockedReport() {
  const issues = [issue("blocked"), issue()];
  const digestInput = {
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("a"),
    engine: "godot",
    engineStatusDigest: digest("d"),
    project: {
      status: "blocked",
      requestedPath: "C:\\missing",
    },
    containment: containment(),
    supportGradeCeiling: "planned",
    issues,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
    selfTestPerformed: false,
  };
  return {
    schemaVersion: "1.0.0",
    commandId: "engine.capabilities",
    status: contracts.computeEngineCapabilitiesStatus(issues),
    ...digestInput,
    reportDigest: contracts.computeEngineCapabilitiesReportDigest(digestInput),
  };
}

test("engine capabilities contracts expose one strict Godot read request", () => {
  assert.equal(contracts.engineCapabilitiesRequestSchema.version, "1.0.0");
  assert.equal(contracts.engineCapabilitiesReportSchema.version, "1.0.0");
  assert.doesNotThrow(() =>
    contracts.assertEngineCapabilitiesRequestSemantics({
      schemaVersion: "1.0.0",
      projectRoot: "C:\\game",
      engine: "godot",
    }),
  );
  assert.throws(
    () =>
      contracts.assertEngineCapabilitiesRequestSemantics({
        schemaVersion: "1.0.0",
        projectRoot: "C:\\game",
        engine: "godot",
        executablePath: "C:\\Godot.exe",
      }),
    /request/u,
  );
});

test("engine capabilities bind all common operations as planned evidence", () => {
  const report = identityBoundReport();

  assert.equal(report.status, "attention");
  assert.equal(report.capabilityReport.capabilities.length, 14);
  assert.deepEqual(
    report.capabilityReport.capabilities.map(({ operation }) => operation),
    contracts.ENGINE_OPERATION_KINDS,
  );
  assert.equal(
    report.capabilityReport.capabilities.every(
      ({ support, evidenceGrade, latestReceiptDigest }) =>
        support === "planned" &&
        evidenceGrade === "documented" &&
        latestReceiptDigest === undefined,
    ),
    true,
  );
  assert.doesNotThrow(() =>
    contracts.assertEngineCapabilitiesReportSemantics(report),
  );
  assert.match(report.reportDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("engine capabilities preserve a blocked unbound project without inventing identity", () => {
  const report = blockedReport();

  assert.equal(report.status, "blocked");
  assert.equal(report.capabilityReport, undefined);
  assert.equal(report.project.canonicalPath, undefined);
  assert.equal(report.project.projectIdentityDigest, undefined);
  assert.doesNotThrow(() =>
    contracts.assertEngineCapabilitiesReportSemantics(report),
  );
});

test("engine capabilities reject support promotion, identity drift, and effect claims", () => {
  const promoted = identityBoundReport();
  promoted.capabilityReport.capabilities[0] = {
    ...promoted.capabilityReport.capabilities[0],
    support: "detected",
    evidenceGrade: "locally-executed",
    latestReceiptDigest: digest("f"),
  };
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(promoted),
    /planned|support/u,
  );

  const drifted = identityBoundReport();
  drifted.project.projectIdentityDigest = digest("f");
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(drifted),
    /identity|digest/u,
  );

  const effectful = identityBoundReport();
  effectful.externalProcessStarted = true;
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(effectful),
    /authority|effect|process/u,
  );
});

test("engine capabilities digest binds issues, containment, and capability inventory", () => {
  const first = identityBoundReport();
  const changed = identityBoundReport();
  changed.containment.reason = "A changed bounded reason.";
  const {
    schemaVersion: _,
    commandId: __,
    status: ___,
    reportDigest: ____,
    ...changedInput
  } = changed;

  assert.notEqual(
    first.reportDigest,
    contracts.computeEngineCapabilitiesReportDigest(changedInput),
  );
});

test("engine capabilities reject accessors, symbols, and custom prototypes", () => {
  const accessor = identityBoundReport();
  Object.defineProperty(accessor.project, "requestedPath", {
    enumerable: true,
    get() {
      throw new Error("must not execute");
    },
  });
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(accessor),
    /project|contract/u,
  );

  const symbol = identityBoundReport();
  symbol[Symbol("authority")] = true;
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(symbol),
    /report|contract/u,
  );

  const custom = identityBoundReport();
  Object.setPrototypeOf(custom.containment, { launch() {} });
  assert.throws(
    () => contracts.assertEngineCapabilitiesReportSemantics(custom),
    /containment|contract/u,
  );
});
