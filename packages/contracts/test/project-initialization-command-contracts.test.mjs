import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;
const startedAt = "2026-08-27T03:00:00.000Z";
const endedAt = "2026-08-27T03:00:01.000Z";
const runId = "11111111-1111-4111-8111-111111111111";

const targetDefinitions = [
  [".ai-game-playbook", "directory", "committed", "none"],
  [
    ".ai-game-playbook/profile.json",
    "file",
    "committed",
    "project-profile",
  ],
  [".ai-game-playbook/policies", "directory", "committed", "none"],
  [".ai-game-playbook/features", "directory", "committed", "none"],
  [
    ".ai-game-playbook/packs.lock.json",
    "file",
    "committed",
    "pack-lock",
  ],
  [
    ".ai-game-playbook/.gitignore",
    "file",
    "committed",
    "ignore-policy",
  ],
  [".ai-game-playbook/cache", "directory", "local-only", "none"],
  [".ai-game-playbook/evidence", "directory", "local-only", "none"],
  [
    ".ai-game-playbook/evidence/artifacts",
    "directory",
    "local-only",
    "none",
  ],
  [
    ".ai-game-playbook/evidence/artifacts/manifests",
    "directory",
    "local-only",
    "none",
  ],
  [
    ".ai-game-playbook/evidence/artifacts/objects",
    "directory",
    "local-only",
    "none",
  ],
  [
    ".ai-game-playbook/evidence/receipts",
    "directory",
    "local-only",
    "none",
  ],
  [".ai-game-playbook/logs", "directory", "local-only", "none"],
  [".ai-game-playbook/screenshots", "directory", "local-only", "none"],
  [".ai-game-playbook/locks", "directory", "local-only", "none"],
  [".ai-game-playbook/local", "directory", "local-only", "none"],
  [".ai-game-playbook/state", "directory", "local-only", "none"],
  [".ai-game-playbook/state/packs", "directory", "local-only", "none"],
  [
    ".ai-game-playbook/state/packs/transactions",
    "directory",
    "local-only",
    "none",
  ],
  [
    ".ai-game-playbook/state/workflows",
    "directory",
    "local-only",
    "none",
  ],
  [".agents", "directory", "committed", "none"],
  [".agents/skills", "directory", "committed", "none"],
];

function targets() {
  let fileIndex = 0;
  return targetDefinitions.map(([path, kind, policy, content]) => {
    const base = {
      path,
      kind,
      policy,
      content,
      action: "create",
      code: "target-absent",
    };
    if (kind === "directory") return base;
    fileIndex += 1;
    return {
      ...base,
      desiredDigest: digest(String(fileIndex)),
      desiredBytes: 64,
    };
  });
}

function commandInput() {
  const body = {
    schemaVersion: "1.0.0",
    disposition: "ready",
    runId,
    registryDigest: digest("a"),
    initPlanDigest: digest("b"),
    project: {
      id: "sample.graybox",
      identityDigest: digest("c"),
      rootIdentityDigest: digest("d"),
      stage: "vertical-slice",
    },
    profileDigest: digest("e"),
    packLockDigest: digest("f"),
    targets: targets(),
    conflicts: [],
    summary: { create: 22, retain: 0, conflict: 0 },
    budgets: {
      maxChangedFiles: 22,
      maxChangedBytes: 384,
      maxDurationMs: 30000,
      maxOutputBytes: 1048576,
      maxRepairCycles: 0,
    },
  };
  return {
    ...body,
    preparedPlanDigest:
      contracts.computeProjectInitializationPreparedPlanDigest(body),
  };
}

function succeededReport(input = commandInput()) {
  const body = {
    schemaVersion: "1.0.0",
    commandId: "project.initialize",
    runId,
    registryDigest: input.registryDigest,
    project: input.project,
    initPlanDigest: input.initPlanDigest,
    preparedPlanDigest: input.preparedPlanDigest,
    profileDigest: input.profileDigest,
    packLockDigest: input.packLockDigest,
    inputDigest: digest("7"),
    status: "succeeded",
    code: "project-initialization-complete",
    mutationAttempted: true,
    mutationUncertain: false,
    effects: {
      changedPaths: input.targets.map(({ path }) => path),
      changedBytes: 192,
      appliedPaths: input.targets.map(({ path }) => path),
      rolledBackPaths: [],
      controlPlaneState: {
        changedPaths: [
          `.ai-game-playbook/evidence/receipts/${runId}.${"1".repeat(64)}.receipt.json`,
          `.ai-game-playbook/evidence/receipts/${runId}.head.json`,
          `.ai-game-playbook/state/workflows/${runId}.3.${"2".repeat(64)}.checkpoint.json`,
          `.ai-game-playbook/state/workflows/${runId}.head.json`,
        ],
        changedFiles: 4,
        changedBytes: 8192,
      },
    },
    timing: { startedAt, endedAt, durationMs: 1000 },
    authorization: {
      authorizationId: "22222222-2222-4222-8222-222222222222",
      requestDigest: digest("8"),
      status: "succeeded",
      mutationUncertain: false,
      violations: [],
      approvalIds: ["approval.project-initialize"],
      settledAt: "2026-08-27T03:00:01.001Z",
    },
    evidence: {
      receipt: {
        receiptId: "33333333-3333-4333-8333-333333333333",
        receiptDigest: digest("9"),
        headDigest: digest("a"),
        chainLength: 1,
      },
      checkpoint: {
        checkpointId: "44444444-4444-4444-8444-444444444444",
        checkpointDigest: digest("b"),
        headDigest: digest("c"),
        sequence: 3,
      },
      activeMarker: { status: "cleared" },
    },
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
  };
  return {
    ...body,
    reportDigest: contracts.computeProjectInitializationReportDigest(body),
  };
}

test("project initialization command schemas are internal, versioned, and closed", () => {
  assert.deepEqual(
    contracts.PROJECT_INITIALIZATION_TARGET_DEFINITIONS,
    targetDefinitions.map(([path, kind, policy, content]) => ({
      path,
      kind,
      policy,
      content,
    })),
  );
  assert.equal(
    contracts.projectInitializationCommandInputSchema.id,
    "project-initialization-command-input",
  );
  assert.equal(
    contracts.projectInitializationReportSchema.id,
    "project-initialization-report",
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS[
      "project-initialization-command-input"
    ],
    contracts.projectInitializationCommandInputSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["project-initialization-report"],
    contracts.projectInitializationReportSchema,
  );
  assert.equal(
    contracts.projectInitializationCommandInputSchema.schema
      .additionalProperties,
    false,
  );
  assert.equal(
    contracts.projectInitializationReportSchema.schema.additionalProperties,
    false,
  );
});

test("command input binds the exact ready 22-target layout", () => {
  const input = commandInput();
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationCommandInputSemantics(input),
  );
  assert.equal(input.targets.length, 22);
  assert.match(input.preparedPlanDigest, /^sha256:[0-9a-f]{64}$/);

  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        preparedPlanDigest: digest("0"),
      }),
    /digest/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        summary: { ...input.summary, create: 19 },
      }),
    /summary/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        targets: input.targets.map((target, index) =>
          index === 1
            ? { ...target, desiredDigest: undefined }
            : target,
        ),
      }),
    /target/,
  );
});

test("command input rejects conflicts, duplicate paths, and unbounded authority", () => {
  const input = commandInput();
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        targets: input.targets.map((target, index) =>
          index === 20 ? { ...target, policy: "local-only" } : target,
        ),
      }),
    /layout/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        disposition: "blocked",
      }),
    /ready/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        targets: input.targets.map((target, index) =>
          index === 19 ? { ...target, path: input.targets[18].path } : target,
        ),
      }),
    /path/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        budgets: { ...input.budgets, maxRepairCycles: 1 },
      }),
    /budget/,
  );

  const disguisedTargets = [...input.targets];
  Object.defineProperty(disguisedTargets, "hiddenAuthority", {
    value: ".ai-game-playbook/local/undeclared.json",
  });
  assert.throws(
    () =>
      contracts.assertProjectInitializationCommandInputSemantics({
        ...input,
        targets: disguisedTargets,
      }),
    /collection/,
  );
});

test("successful reports bind settlement, effects, durable evidence, and digest", () => {
  const report = succeededReport();
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationReportSemantics(report),
  );
  assert.match(report.reportDigest, /^sha256:[0-9a-f]{64}$/);

  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        reportDigest: digest("0"),
      }),
    /digest/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        mutationUncertain: true,
      }),
    /uncertain/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        evidence: {
          ...report.evidence,
          activeMarker: { status: "retained", digest: digest("1") },
        },
      }),
    /marker/,
  );


  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        effects: {
          ...report.effects,
          controlPlaneState: {
            ...report.effects.controlPlaneState,
            changedPaths: [
              ...report.effects.controlPlaneState.changedPaths.slice(0, -1),
              ".ai-game-playbook/cache/undeclared-control-state.json",
            ],
          },
        },
      }),
    /control-plane/,
  );

  const controlOnlyBody = {
    ...report,
    effects: {
      changedPaths: [],
      changedBytes: 0,
      appliedPaths: [],
      rolledBackPaths: [],
      controlPlaneState: {
        changedPaths: [
          ".ai-game-playbook",
          ".ai-game-playbook/locks",
          ...report.effects.controlPlaneState.changedPaths,
        ],
        changedFiles: report.effects.controlPlaneState.changedFiles + 2,
        changedBytes: report.effects.controlPlaneState.changedBytes,
      },
    },
  };
  delete controlOnlyBody.reportDigest;
  const controlOnlyReport = {
    ...controlOnlyBody,
    reportDigest:
      contracts.computeProjectInitializationReportDigest(controlOnlyBody),
  };
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationReportSemantics(controlOnlyReport),
  );
});

test("recovery-required reports retain the marker and cannot claim success", () => {
  const succeeded = succeededReport();
  const body = {
    ...succeeded,
    status: "recovery-required",
    code: "project-initialization-recovery-required",
    mutationUncertain: true,
    authorization: {
      ...succeeded.authorization,
      status: "uncertain",
      mutationUncertain: true,
    },
    evidence: {
      ...succeeded.evidence,
      activeMarker: { status: "retained", digest: digest("d") },
    },
    error: {
      code: "project-initialization-commit-failed",
      at: "project-initialization.commit",
    },
  };
  delete body.reportDigest;
  const report = {
    ...body,
    reportDigest: contracts.computeProjectInitializationReportDigest(body),
  };

  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationReportSemantics(report),
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        authorization: {
          ...report.authorization,
          status: "succeeded",
        },
      }),
    /authorization/,
  );
  assert.throws(
    () =>
      contracts.assertProjectInitializationReportSemantics({
        ...report,
        evidence: {
          ...report.evidence,
          activeMarker: { status: "cleared" },
        },
      }),
    /marker/,
  );
});
