import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
} from "@ai-game-playbook/registry";
import * as projectRuntime from "../dist/index.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_IDENTITY_DIGEST = contracts.sha256Digest("graybox-project");
const INPUT_DIGEST = contracts.sha256Digest("initialization-input");
const EVIDENCE_DIGEST = `sha256:${"a".repeat(64)}`;

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-init-recovery-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root: await core.canonicalizeProjectRoot(project) };
}

function profile() {
  const projectId = "project.graybox";
  const engine = { id: "godot", version: "4.7.2" };
  return {
    schemaVersion: "1.0.0",
    projectId,
    projectRoot: ".",
    engine: {
      ...engine,
      projectIdentityDigest: contracts.computeGameProjectIdentityDigest({
        projectId,
        engine,
      }),
    },
    stage: {
      declared: "vertical-slice",
      effective: "vertical-slice",
      confidence: "medium",
      evidence: [
        {
          locator: "project.godot",
          grade: "declared",
          digest: EVIDENCE_DIGEST,
        },
      ],
      reason: "The vertical-slice milestone is declared.",
    },
    teamSize: 1,
    gameShape: "offline-single-player-3d",
    targets: [
      {
        platform: "windows",
        architecture: "x64",
        configuration: "development",
      },
    ],
    budgets: {
      maxChangedFiles: 24,
      maxChangedBytes: 262144,
      maxDurationMs: 900000,
      maxOutputBytes: 4194304,
      maxRepairCycles: 3,
    },
    coreLoop: ["move", "collect", "win"],
    pillars: ["responsive movement", "clear feedback"],
    exclusions: ["multiplayer", "web export"],
  };
}

async function preparePlan(root, runId) {
  const reviewed = await core.planProjectInitialization({ root });
  const expectedInitPlanDigest = contracts.computeInitPlanDigest({
    registryDigest: BUILTIN_REGISTRY.digest,
    projectIdentityDigest: reviewed.rootIdentityDigest,
    targets: reviewed.targets,
  });
  return projectRuntime.prepareProjectInitialization({
    registry: BUILTIN_REGISTRY,
    targetRoot: root,
    expectedInitPlanDigest,
    profile: profile(),
    runId,
  });
}

function authorizePlan(plan) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "approval.project-initialization";
  const broker = core.createPermissionBroker({
    registry: BUILTIN_REGISTRY,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      stage: plan.project.stage,
      budgets: profile().budgets,
    },
    trustedApprovalKeys: [
      {
        keyId,
        publicKeyPem: publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    ],
  });
  const deadlineAt = new Date(Date.now() + 60_000).toISOString();
  const request =
    projectRuntime.createProjectInitializationAuthorizationRequest({
      plan,
      deadlineAt,
    });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  const subject = core.createApprovalGrantSubject(pending.challenge, {
    grantId: "grant.project-initialization",
    permission: "write-project-metadata",
    approvedAt: new Date(Date.now() - 1).toISOString(),
    expiresAt: deadlineAt,
    maxUses: 1,
  });
  const grant = {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId,
      value: sign(
        null,
        Buffer.from(
          contracts.computeApprovalGrantSigningDigest(subject),
          "utf8",
        ),
        privateKey,
      ).toString("base64url"),
    },
  };
  const decision = broker.authorize(request, [grant]);
  assert.equal(decision.status, "authorized");
  return decision;
}

async function waitForPath(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await lstat(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function persistWaitingApproval(root, runId = RUN_ID) {
  await core.initializeProjectState({ root });
  const checkpoint = core.createWorkflowCheckpoint({
    registry: BUILTIN_REGISTRY,
    workflowId: "workflow.project-initialization",
    project: {
      id: "project.graybox",
      identityDigest: PROJECT_IDENTITY_DIGEST,
      rootIdentityDigest: root.identityDigest,
      stage: "vertical-slice",
    },
    runId,
    inputDigest: INPUT_DIGEST,
    ttlMs: 86_400_000,
    now: () => Date.parse("2026-08-27T04:00:00.000Z"),
  });
  const stored = await core.persistWorkflowCheckpoint({
    root,
    registry: BUILTIN_REGISTRY,
    checkpoint,
  });
  return { checkpoint, stored };
}

async function replaceHeadWithStartedCheckpoint(root, checkpoint) {
  const workflow = resolveWorkflowPlan(
    BUILTIN_REGISTRY,
    "workflow.project-initialization",
    checkpoint.identity.projectStage,
  );
  const command = workflow.steps[0].command;
  const { checkpointDigest: _checkpointDigest, ...initialBody } = checkpoint;
  const inFlight = {
    stepId: workflow.steps[0].id,
    ordinal: 0,
    attempt: 1,
    phase: "command",
    command,
    inputDigest: checkpoint.identity.inputDigest,
    authorizationId:
      checkpoint.identity.runId === RUN_ID
        ? "99999999-9999-4999-8999-999999999999"
        : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authorizationRequestDigest: contracts.sha256Digest(
      `authorization-${checkpoint.identity.runId}`,
    ),
    authorizationExpiresAt: "2026-08-27T04:01:00.000Z",
    approvalIds: ["approval.project-initialize"],
  };
  const admittedBody = {
    ...initialBody,
    checkpointId: checkpoint.checkpointId,
    sequence: 1,
    status: "running",
    inFlight: {
      ...inFlight,
      sideEffect: "not-started",
    },
    updatedAt: "2026-08-27T04:00:01.000Z",
    parentCheckpointDigest: checkpoint.checkpointDigest,
  };
  const admitted = {
    ...admittedBody,
    checkpointDigest:
      contracts.computeWorkflowCheckpointDigest(admittedBody),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(admitted), []);
  await writeCheckpointHead(root, admitted);
  const { checkpointDigest: _admittedDigest, ...admittedWithoutDigest } =
    admitted;
  const body = {
    ...admittedWithoutDigest,
    sequence: 2,
    inFlight: { ...inFlight, sideEffect: "started" },
    updatedAt: "2026-08-27T04:00:02.000Z",
    parentCheckpointDigest: admitted.checkpointDigest,
  };
  const started = {
    ...body,
    checkpointDigest: contracts.computeWorkflowCheckpointDigest(body),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(started), []);
  await writeCheckpointHead(root, started);
  return started;
}

async function writeCheckpointHead(root, checkpoint) {
  const recordText = `${contracts.canonicalizeJson(checkpoint)}\n`;
  const recordDigest = contracts.sha256Digest(recordText);
  const headBody = {
    schemaVersion: "1.0.0",
    runId: checkpoint.identity.runId,
    checkpointId: checkpoint.checkpointId,
    sequence: checkpoint.sequence,
    checkpointDigest: checkpoint.checkpointDigest,
    recordDigest,
    registryDigest: checkpoint.identity.registryDigest,
    projectIdentityDigest: checkpoint.identity.projectIdentityDigest,
    updatedAt: checkpoint.updatedAt,
  };
  const head = {
    ...headBody,
    headDigest: contracts.digestCanonicalJson({
      domain: "ai-game-playbook.workflow-checkpoint-head",
      version: "1",
      subject: headBody,
    }),
  };
  const store = join(
    root.canonicalPath,
    ".ai-game-playbook",
    "state",
    "workflows",
  );
  await writeFile(
    join(
      store,
      `${checkpoint.identity.runId}.${checkpoint.sequence}.${checkpoint.checkpointDigest.slice("sha256:".length)}.checkpoint.json`,
    ),
    recordText,
  );
  await writeFile(
    join(store, `${checkpoint.identity.runId}.head.json`),
    `${contracts.canonicalizeJson(head)}\n`,
  );
}

function receiptFor(root, checkpoint) {
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.initialize",
  );
  assert.notEqual(command, undefined);
  const startedAt = "2026-08-27T04:00:02.000Z";
  const endedAt = "2026-08-27T04:00:02.010Z";
  const body = {
    schemaVersion: "1.0.0",
    receiptId: "55555555-5555-4555-8555-555555555555",
    status: "succeeded",
    identity: {
      runId: RUN_ID,
      workflowId: "workflow.project-initialization",
      stepId: "step.project-initialize",
      attempt: 1,
      phase: "command",
      projectId: "project.graybox",
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: command.id,
        version: command.version,
        descriptorDigest: contracts.digestCanonicalJson(command),
      },
      registryDigest: BUILTIN_REGISTRY.digest,
      handlerDigest: command.handler.digest,
      inputDigest: INPUT_DIGEST,
      authorizationId: "66666666-6666-4666-8666-666666666666",
      authorizationRequestDigest: contracts.sha256Digest(
        "authorization-request",
      ),
      packDigests: [],
      approvalIds: [],
    },
    environment: {
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "macos"
            : "linux",
      architecture: process.arch === "arm64" ? "arm64" : "x64",
      nodeVersion: process.versions.node,
      projectIdentityDigest: root.identityDigest,
    },
    timing: { startedAt, endedAt, durationMs: 10 },
    effects: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 10,
      outputBytes: 0,
      repairCycles: 0,
    },
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: {
        status: "passed",
        code: "receipt-persisted",
        message: "Receipt persisted.",
      },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts: [],
    diagnostics: [],
    recovery: { attempted: false, outcome: "not-run", actions: [] },
  };
  return {
    ...body,
    receiptDigest: contracts.computeRunReceiptDigest(body),
  };
}

test("initialization recovery assessment treats an untouched project as clear without writes", async (t) => {
  const { project } = await fixture(t);

  assert.equal(
    typeof projectRuntime.runProjectInitializationRecoveryAssessment,
    "function",
  );
  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.inventory), true);
  assert.equal(Object.isFrozen(report.candidates), true);
  assert.equal(report.status, "clear");
  assert.equal(report.code, "initialization-recovery-clear");
  assert.equal(report.inventory.storeStatus, "missing");
  assert.equal(report.controlState.status, "absent");
  assert.deepEqual(report.candidates, []);
  assert.deepEqual(report.issues, []);
  assert.equal(report.finalizationReady, false);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.networkAccessPerformed, false);
  assert.equal(report.editorControlPerformed, false);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
  assert.deepEqual(await readdir(project), []);
});

test("a waiting-approval initialization is visible as abandoned authorization attention", async (t) => {
  const { project, root } = await fixture(t);
  const { checkpoint, stored } = await persistWaitingApproval(root);

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(report.status, "attention");
  assert.equal(report.code, "initialization-recovery-attention");
  assert.equal(report.inventory.storeStatus, "present");
  assert.equal(report.inventory.initializationCandidates, 1);
  assert.equal(report.controlState.status, "tracked");
  assert.deepEqual(report.candidates, [
    {
      validationLevel: "head-and-latest-record-presence",
      runId: RUN_ID,
      checkpointId: checkpoint.checkpointId,
      sequence: checkpoint.sequence,
      checkpointDigest: checkpoint.checkpointDigest,
      headDigest: stored.headDigest,
      status: "waiting-approval",
      disposition: "authorization-abandoned",
      actionCode: "review-abandoned-authorization",
      projectId: "project.graybox",
      projectIdentityDigest: PROJECT_IDENTITY_DIGEST,
      projectRootIdentityDigest: root.identityDigest,
      projectAuthority: "current",
      projectStage: "vertical-slice",
      registryDigest: BUILTIN_REGISTRY.digest,
      registryAuthority: "current",
      workflowId: "workflow.project-initialization",
      workflowVersion: "1.0.0",
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
      inputDigest: INPUT_DIGEST,
      updatedAt: checkpoint.updatedAt,
    },
  ]);
  assert.deepEqual(report.summary, {
    terminalCandidates: 0,
    attentionCandidates: 1,
    recoveryCandidates: 0,
    blockedCandidates: 0,
    attentionIssues: 0,
    blockedIssues: 0,
  });
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("an exact run selector upgrades only that current checkpoint to full-chain evidence", async (t) => {
  const { project, root } = await fixture(t);
  const { checkpoint, stored } = await persistWaitingApproval(root);

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId: RUN_ID,
    });

  assert.equal(report.status, "attention");
  assert.equal(report.validationLevel, "selected-full-chain");
  assert.deepEqual(report.selection, { status: "assessed", runId: RUN_ID });
  assert.deepEqual(report.selected, {
    runId: RUN_ID,
    disposition: "authorization-abandoned",
    actionCode: "review-abandoned-authorization",
    checkpoint: {
      status: "verified",
      chainLength: 1,
      checkpointDigest: checkpoint.checkpointDigest,
      headDigest: stored.headDigest,
    },
    receipt: { status: "not-declared" },
  });
  assert.doesNotThrow(() =>
    projectRuntime.assertProjectInitializationRecoveryAssessmentWitness(
      report,
    ),
  );
  assert.throws(
    () =>
      projectRuntime.assertProjectInitializationRecoveryAssessmentWitness(
        structuredClone(report),
      ),
    /same-process|witness/i,
  );
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("a selected checkpoint with a missing ancestor becomes a bounded blocked report", async (t) => {
  const { project, root } = await fixture(t);
  const { checkpoint } = await persistWaitingApproval(root);
  await replaceHeadWithStartedCheckpoint(root, checkpoint);
  await rm(
    join(
      project,
      ".ai-game-playbook",
      "state",
      "workflows",
      `${RUN_ID}.0.${checkpoint.checkpointDigest.slice("sha256:".length)}.checkpoint.json`,
    ),
  );

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId: RUN_ID,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.inventory.storeStatus, "present");
  assert.equal(report.validationLevel, "head-and-latest-record-presence");
  assert.deepEqual(report.selection, { status: "blocked", runId: RUN_ID });
  assert.equal("selected" in report, false);
  assert.equal(report.candidates[0].disposition, "corrupt");
  assert.equal(
    report.candidates[0].actionCode,
    "repair-initialization-evidence",
  );
  assert.deepEqual(report.issues, [
    {
      severity: "blocked",
      code: "initialization-checkpoint-chain-invalid",
      subject: "checkpoint",
      runId: RUN_ID,
    },
  ]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(project), false);
  assert.equal(serialized.includes(".checkpoint.json"), false);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("a durable receipt omitted by the selected checkpoint is a blocked contradiction", async (t) => {
  const { project, root } = await fixture(t);
  const { checkpoint } = await persistWaitingApproval(root);
  const receipt = receiptFor(root, checkpoint);
  const storedReceipt = await core.persistRunReceipt({
    root,
    registry: BUILTIN_REGISTRY,
    receipt,
    maxArtifactBytes: 0,
  });

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId: RUN_ID,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.code, "initialization-recovery-blocked");
  assert.equal(report.candidates[0].disposition, "corrupt");
  assert.equal(report.candidates[0].actionCode, "repair-initialization-evidence");
  assert.deepEqual(report.selected.receipt, {
    status: "contradictory",
    chainLength: 1,
    receiptDigest: receipt.receiptDigest,
    headDigest: storedReceipt.headDigest,
  });
  assert.deepEqual(report.issues, [
    {
      severity: "blocked",
      code: "initialization-receipt-not-declared",
      subject: "receipt",
      runId: RUN_ID,
    },
  ]);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("a partial control layout without a durable initialization head is untracked attention", async (t) => {
  const { project } = await fixture(t);
  await mkdir(join(project, ".ai-game-playbook"));

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(report.status, "attention");
  assert.equal(report.inventory.storeStatus, "missing");
  assert.deepEqual(report.controlState, {
    status: "partial-untracked",
    disposition: "untracked-control-state",
    actionCode: "inspect-untracked-control-state",
  });
  assert.deepEqual(report.issues, [
    {
      severity: "attention",
      code: "initialization-control-state-untracked",
      subject: "control-state",
    },
  ]);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
  assert.deepEqual(await readdir(join(project, ".ai-game-playbook")), []);
});

test("a wrong-kind initialization target is blocked instead of treated as missing", async (t) => {
  const { project } = await fixture(t);
  await mkdir(join(project, ".ai-game-playbook"));
  await mkdir(join(project, ".ai-game-playbook", "profile.json"));

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.controlState.status, "partial-untracked");
  assert.deepEqual(report.issues, [
    {
      severity: "blocked",
      code: "initialization-control-state-invalid",
      subject: "control-state",
    },
  ]);
  assert.equal(JSON.stringify(report).includes(project), false);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("multiple started initialization candidates block automatic recovery selection", async (t) => {
  const { project, root } = await fixture(t);
  const secondRunId = "22222222-2222-4222-8222-222222222222";
  const first = await persistWaitingApproval(root, RUN_ID);
  const second = await persistWaitingApproval(root, secondRunId);
  await replaceHeadWithStartedCheckpoint(root, first.checkpoint);
  await replaceHeadWithStartedCheckpoint(root, second.checkpoint);

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.summary.recoveryCandidates, 2);
  assert.equal(report.summary.blockedIssues, 1);
  assert.deepEqual(
    report.candidates.map(({ runId, disposition }) => ({ runId, disposition })),
    [
      { runId: RUN_ID, disposition: "restart-recovery-required" },
      {
        runId: secondRunId,
        disposition: "restart-recovery-required",
      },
    ],
  );
  assert.deepEqual(report.issues, [
    {
      severity: "blocked",
      code: "multiple-active-initialization-runs",
      subject: "checkpoint",
    },
  ]);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("a completed initialization reconciles matching terminal checkpoint and receipt chains", async (t) => {
  const { project, root } = await fixture(t);
  const runId = "33333333-3333-4333-8333-333333333333";
  const plan = await preparePlan(root, runId);
  const authorization = authorizePlan(plan);
  const execution = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization,
    signal: null,
  });
  assert.equal(execution.status, "succeeded");

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId,
    });

  assert.equal(report.status, "clear");
  assert.equal(report.validationLevel, "selected-full-chain");
  assert.equal(report.candidates[0].status, "succeeded");
  assert.equal(report.candidates[0].disposition, "terminal");
  assert.equal(report.selected.disposition, "terminal");
  assert.deepEqual(report.selected.receipt, {
    status: "verified",
    chainLength: execution.evidence.receipt.chainLength,
    receiptDigest: execution.evidence.receipt.receiptDigest,
    headDigest: execution.evidence.receipt.headDigest,
  });
  assert.equal(
    report.selected.checkpoint.checkpointDigest,
    execution.evidence.checkpoint.checkpointDigest,
  );
  assert.equal(
    report.selected.checkpoint.headDigest,
    execution.evidence.checkpoint.headDigest,
  );
  assert.equal(report.finalizationReady, false);
  assert.deepEqual(report.issues, []);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("a receipt with different in-flight authorization is a blocked contradiction", async (t) => {
  const { project, root } = await fixture(t);
  const { checkpoint } = await persistWaitingApproval(root);
  const started = await replaceHeadWithStartedCheckpoint(root, checkpoint);
  const receipt = receiptFor(root, started);
  const storedReceipt = await core.persistRunReceipt({
    root,
    registry: BUILTIN_REGISTRY,
    receipt,
    maxArtifactBytes: 0,
  });
  const settledBody = {
    ...started,
    sequence: 3,
    status: "succeeded",
    nextOrdinal: 1,
    attempts: [
      {
        stepId: started.inFlight.stepId,
        ordinal: started.inFlight.ordinal,
        attempt: started.inFlight.attempt,
        phase: started.inFlight.phase,
        outcome: "succeeded",
        receiptDigest: receipt.receiptDigest,
      },
    ],
    evidenceKinds: ["run-receipt"],
    receiptChainHead: receipt.receiptDigest,
    updatedAt: "2026-08-27T04:00:03.000Z",
    parentCheckpointDigest: started.checkpointDigest,
  };
  delete settledBody.inFlight;
  delete settledBody.checkpointDigest;
  const settled = {
    ...settledBody,
    checkpointDigest:
      contracts.computeWorkflowCheckpointDigest(settledBody),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(settled), []);
  await writeCheckpointHead(root, settled);

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId: RUN_ID,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.candidates[0].disposition, "corrupt");
  assert.deepEqual(report.selected.receipt, {
    status: "contradictory",
    chainLength: 1,
    receiptDigest: receipt.receiptDigest,
    headDigest: storedReceipt.headDigest,
  });
  assert.deepEqual(report.issues, [
    {
      severity: "blocked",
      code: "initialization-receipt-binding-mismatch",
      subject: "receipt",
      runId: RUN_ID,
    },
  ]);
});

test("an uncertain initialization preserves matching receipt uncertainty as reconciliation-required", async (t) => {
  const { project, root } = await fixture(t);
  const runId = "44444444-4444-4444-8444-444444444444";
  const plan = await preparePlan(root, runId);
  const authorization = authorizePlan(plan);
  const controller = new AbortController();
  const policiesPath = join(project, ".ai-game-playbook", "policies");
  const userFile = join(policiesPath, "user-owned.txt");
  const interfere = (async () => {
    await waitForPath(policiesPath);
    await writeFile(userFile, "preserve me\n", "utf8");
    controller.abort();
  })();

  const execution = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization,
    signal: controller.signal,
  });
  await interfere;
  assert.equal(execution.status, "recovery-required");

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
      runId,
    });

  assert.equal(report.status, "recovery-required");
  assert.equal(report.candidates[0].status, "uncertain");
  assert.equal(report.candidates[0].disposition, "reconciliation-required");
  assert.equal(report.selected.disposition, "reconciliation-required");
  assert.deepEqual(report.selected.receipt, {
    status: "uncertain",
    chainLength: execution.evidence.receipt.chainLength,
    receiptDigest: execution.evidence.receipt.receiptDigest,
    headDigest: execution.evidence.receipt.headDigest,
  });
  assert.deepEqual(report.issues, [
    {
      severity: "attention",
      code: "initialization-receipt-uncertain",
      subject: "receipt",
      runId,
    },
  ]);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});

test("an invalid checkpoint store becomes a bounded blocked report without raw diagnostics", async (t) => {
  const { project, root } = await fixture(t);
  await persistWaitingApproval(root);
  await writeFile(
    join(
      project,
      ".ai-game-playbook",
      "state",
      "workflows",
      "unexpected.json",
    ),
    "{}\n",
  );

  const report =
    await projectRuntime.runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: project,
    });

  assert.equal(report.status, "blocked");
  assert.equal(report.inventory.storeStatus, "invalid");
  assert.deepEqual(report.candidates, []);
  assert.equal(
    report.issues.some(
      ({ severity, code, subject }) =>
        severity === "blocked" &&
        code === "initialization-checkpoint-store-invalid" &&
        subject === "inventory",
    ),
    true,
  );
  assert.equal(JSON.stringify(report).includes(project), false);
  assert.equal(JSON.stringify(report).includes("unexpected.json"), false);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationRecoveryReportSemantics(report),
  );
});
