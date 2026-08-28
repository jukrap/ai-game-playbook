import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const runId = "623e4567-e89b-42d3-a456-426614174000";
const projectIdentityDigest = `sha256:${"9".repeat(64)}`;
const inputDigest = `sha256:${"8".repeat(64)}`;
const now = Date.parse("2026-08-26T06:00:00.000Z");

function expectCoreError(code, uncertain) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    (uncertain === undefined || error?.mutationUncertain === uncertain);
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-workflow-store-"));
  const project = join(sandbox, "project");
  const store = join(project, ".ai-game-playbook", "state", "workflows");
  await mkdir(store, { recursive: true });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    sandbox,
    project,
    store,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function validatedRegistry() {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    contracts.workflowCheckpointSchema,
  );
  return registry.validateRegistry(definition);
}

function checkpointRequest(validated, overrides = {}) {
  return {
    registry: validated,
    workflowId: "workflow.verify-feature",
    project: {
      id: "project.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
    },
    runId,
    inputDigest,
    ttlMs: 86_400_000,
    now: () => now,
    ...overrides,
  };
}

function loadRequest(root, validated, overrides = {}) {
  return {
    root,
    registry: validated,
    runId,
    project: {
      id: "project.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
    },
    inputDigest,
    now: () => now + 100,
    ...overrides,
  };
}

function broker(validated, currentTime = now + 100) {
  return core.createPermissionBroker({
    registry: validated,
    project: {
      id: "project.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 32,
        maxChangedBytes: 1_048_576,
        maxDurationMs: 900_000,
        maxOutputBytes: 4_194_304,
        maxRepairCycles: 3,
      },
    },
    trustedApprovalKeys: [],
    now: () => currentTime,
  });
}

function authorizeCommand(
  validated,
  checkpoint,
  {
    commandId = "project.inspect",
    stepId = "step.inspect",
    authorizationTime = now + 100,
  } = {},
) {
  return broker(validated, authorizationTime).authorize(
    {
      runId,
      projectId: "project.graybox",
      projectIdentityDigest,
      commandId,
      input: { schemaVersion: "1.0.0" },
      workflow: {
        id: "workflow.verify-feature",
        stepId,
        resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
      },
      scope: {
        paths: ["project.godot"],
        objectIds: [],
        destinations: [],
        dataClasses: [],
        changeKinds: [],
        publishTargets: [],
      },
      budgets: {
        maxDurationMs: 30_000,
        maxOutputBytes: 1_048_576,
        maxRepairCycles: 0,
      },
      deadlineAt: new Date(authorizationTime + 30_000).toISOString(),
    },
    [],
  );
}

function authorizeInspect(validated, checkpoint) {
  return authorizeCommand(validated, checkpoint);
}

function rollbackRegistry() {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    contracts.workflowCheckpointSchema,
  );
  const step = structuredClone(definition.workflows[0].steps[0]);
  step.onFailure = "rollback";
  step.rollbackCommandId = "engine.rollback";
  definition.workflows[0].steps = [step];
  definition.workflows[0].requiredEvidence = ["rollback-state"];
  const rollbackCommand = definition.commands.find(
    ({ id }) => id === "engine.rollback",
  );
  const inspectCommand = definition.commands.find(
    ({ id }) => id === "project.inspect",
  );
  rollbackCommand.permissions = ["read-project"];
  rollbackCommand.sideEffects = [
    { kind: "none", scope: "project", boundary: "local" },
  ];
  rollbackCommand.lane = "parallel-read";
  rollbackCommand.input = structuredClone(inspectCommand.input);
  rollbackCommand.budgets = structuredClone(inspectCommand.budgets);
  return registry.validateRegistry(definition);
}

function actualEffects(overrides = {}) {
  return {
    changedPaths: [],
    changedBytes: 0,
    objectIds: [],
    destinations: [],
    dataClasses: [],
    changeKinds: [],
    publishTargets: [],
    durationMs: 0,
    outputBytes: 0,
    repairCycles: 0,
    ...overrides,
  };
}

function receiptFor(checkpoint, overrides = {}, receiptTime = now + 100) {
  const inFlight = checkpoint.inFlight;
  const timestamp = new Date(receiptTime).toISOString();
  const receipt = {
    schemaVersion: "1.0.0",
    receiptId:
      inFlight.phase === "rollback"
        ? "823e4567-e89b-42d3-a456-426614174000"
        : "723e4567-e89b-42d3-a456-426614174000",
    ...(checkpoint.receiptChainHead === undefined
      ? {}
      : { previousReceiptDigest: checkpoint.receiptChainHead }),
    status: "succeeded",
    identity: {
      runId: checkpoint.identity.runId,
      workflowId: checkpoint.identity.workflow.id,
      stepId: inFlight.stepId,
      attempt: inFlight.attempt,
      phase: inFlight.phase,
      projectId: checkpoint.identity.projectId,
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: inFlight.command.id,
        version: inFlight.command.version,
        descriptorDigest: inFlight.command.descriptorDigest,
      },
      registryDigest: checkpoint.identity.registryDigest,
      handlerDigest: inFlight.command.handlerDigest,
      inputDigest: inFlight.inputDigest,
      authorizationId: inFlight.authorizationId,
      authorizationRequestDigest: inFlight.authorizationRequestDigest,
      packDigests: [],
      approvalIds: [...inFlight.approvalIds],
    },
    environment: {
      platform: "windows",
      architecture: "x64",
      nodeVersion: "22.22.0",
      projectIdentityDigest: checkpoint.identity.projectIdentityDigest,
    },
    timing: { startedAt: timestamp, endedAt: timestamp, durationMs: 0 },
    effects: actualEffects(),
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: { status: "passed", code: "verified", message: "Verified." },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts: [],
    diagnostics: [],
    recovery: { attempted: false, outcome: "not-run", actions: [] },
    ...overrides,
    receiptDigest: inputDigest,
  };
  receipt.receiptDigest = contracts.computeRunReceiptDigest(receipt);
  return receipt;
}

async function persistInitial(root, validated) {
  const checkpoint = core.createWorkflowCheckpoint(
    checkpointRequest(validated),
  );
  const stored = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint,
  });
  return { checkpoint, stored };
}

test("workflow checkpoints persist as canonical append-only records with a CAS head", async (t) => {
  assert.equal(typeof core.persistWorkflowCheckpoint, "function");
  assert.equal(typeof core.loadWorkflowCheckpoint, "function");
  assert.equal(typeof core.resumeWorkflowCheckpoint, "function");
  assert.equal(
    core.WORKFLOW_CHECKPOINT_STORE_PATH,
    ".ai-game-playbook/state/workflows",
  );

  const { root, store } = await fixture(t);
  const validated = validatedRegistry();
  const { checkpoint, stored } = await persistInitial(root, validated);

  assert.equal(Object.isFrozen(stored), true);
  assert.equal(stored.checkpoint, checkpoint);
  assert.equal(stored.chainLength, 1);
  assert.equal(stored.rootIdentityDigest, root.identityDigest);
  assert.match(stored.headDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal("absolutePath" in stored, false);

  const files = (await readdir(store)).sort();
  assert.equal(files.length, 2);
  assert.equal(files.some((name) => name === `${runId}.head.json`), true);
  assert.equal(files.some((name) => name.endsWith(".checkpoint.json")), true);
  for (const name of files) {
    const text = await readFile(join(store, name), "utf8");
    assert.equal(text, `${contracts.canonicalizeJson(JSON.parse(text))}\n`);
    assert.equal(text.includes(root.canonicalPath), false);
  }

  const loaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  assert.notEqual(loaded, stored);
  assert.deepEqual(loaded.checkpoint, checkpoint);
  assert.equal(loaded.chainLength, 1);
  assert.equal(loaded.headDigest, stored.headDigest);

  const resumed = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: loaded,
    policy: "safe",
    now: () => now + 200,
  });
  assert.equal(resumed.disposition, "ready-for-authorization");
  assert.equal(resumed.recoveryPersisted, false);
  assert.equal(resumed.stored, loaded);

  const authorization = authorizeInspect(validated, resumed.checkpoint);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: resumed.checkpoint,
    authorization,
    now: () => now + 200,
  });
  const appended = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: admitted,
    previous: resumed.stored,
  });
  assert.equal(appended.chainLength, 2);
  assert.equal(appended.checkpoint.sequence, 1);

  const reloaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  assert.equal(reloaded.chainLength, 2);
  assert.equal(reloaded.checkpoint.checkpointDigest, admitted.checkpointDigest);
});

test("restart recovery discards unused authorization but preserves started effects as uncertain", async (t) => {
  const first = await fixture(t);
  const validated = validatedRegistry();
  const initial = await persistInitial(first.root, validated);
  const authorization = authorizeInspect(validated, initial.checkpoint);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial.checkpoint,
    authorization,
    now: () => now + 100,
  });
  await core.persistWorkflowCheckpoint({
    root: first.root,
    registry: validated,
    checkpoint: admitted,
    previous: initial.stored,
  });

  const loadedAdmission = await core.loadWorkflowCheckpoint(
    loadRequest(first.root, validated),
  );
  const recoveredAdmission = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: loadedAdmission,
    policy: "safe",
    now: () => now + 300,
  });
  assert.equal(recoveredAdmission.disposition, "ready-for-authorization");
  assert.equal(recoveredAdmission.recoveryPersisted, true);
  assert.equal(recoveredAdmission.checkpoint.status, "prepared");
  assert.equal(recoveredAdmission.checkpoint.inFlight, undefined);
  assert.equal(recoveredAdmission.checkpoint.sequence, 2);
  assert.equal(
    (await core.loadWorkflowCheckpoint(loadRequest(first.root, validated)))
      .chainLength,
    3,
  );

  const second = await fixture(t);
  const secondInitial = await persistInitial(second.root, validated);
  const secondAuthorization = authorizeInspect(
    validated,
    secondInitial.checkpoint,
  );
  const secondAdmitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: secondInitial.checkpoint,
    authorization: secondAuthorization,
    now: () => now + 100,
  });
  const secondStoredAdmission = await core.persistWorkflowCheckpoint({
    root: second.root,
    registry: validated,
    checkpoint: secondAdmitted,
    previous: secondInitial.stored,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: secondAdmitted,
    now: () => now + 100,
  });
  await core.persistWorkflowCheckpoint({
    root: second.root,
    registry: validated,
    checkpoint: started,
    previous: secondStoredAdmission,
  });

  const loadedStarted = await core.loadWorkflowCheckpoint(
    loadRequest(second.root, validated),
  );
  const recoveredStarted = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: loadedStarted,
    policy: "safe",
    now: () => now + 400,
  });
  assert.equal(recoveredStarted.disposition, "reconciliation-required");
  assert.equal(recoveredStarted.recoveryPersisted, true);
  assert.equal(recoveredStarted.checkpoint.status, "uncertain");
  assert.equal(recoveredStarted.checkpoint.inFlight.sideEffect, "uncertain");
  assert.equal(recoveredStarted.checkpoint.sequence, 3);
  assert.throws(
    () =>
      core.beginWorkflowStep({
        registry: validated,
        checkpoint: recoveredStarted.checkpoint,
        authorization: secondAuthorization,
        now: () => now + 500,
      }),
    expectCoreError("workflow-checkpoint-transition-invalid"),
  );
});

test("a settled rollback chain reloads without promoting the recovered failure", async (t) => {
  const { root } = await fixture(t);
  const validated = rollbackRegistry();
  let stored = await persistInitial(root, validated);
  const forwardAuthorization = authorizeInspect(validated, stored.checkpoint);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: stored.checkpoint,
    authorization: forwardAuthorization,
    now: () => now + 100,
  });
  let head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: admitted,
    previous: stored.stored,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now + 100,
  });
  head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: started,
    previous: head,
  });
  const failedReceipt = receiptFor(started, {
    status: "failed",
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: { status: "failed", code: "verification-failed", message: "Failed." },
    },
  });
  const failedSettlement = forwardAuthorization.lease.settle({
    outcome: "failed",
    mutationUncertain: false,
    actual: actualEffects(),
  });
  const waitingRollback = core.settleWorkflowStep({
    registry: validated,
    checkpoint: started,
    receipt: failedReceipt,
    settlement: failedSettlement,
    now: () => now + 200,
  });
  head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: waitingRollback,
    previous: head,
  });

  const rollbackAuthorization = authorizeCommand(validated, waitingRollback, {
    commandId: "engine.rollback",
    authorizationTime: now + 200,
  });
  const rollbackAdmitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: waitingRollback,
    authorization: rollbackAuthorization,
    now: () => now + 200,
  });
  head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: rollbackAdmitted,
    previous: head,
  });
  const rollbackStarted = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: rollbackAdmitted,
    now: () => now + 200,
  });
  head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: rollbackStarted,
    previous: head,
  });
  const rollbackReceipt = receiptFor(rollbackStarted, {
    mutation: {
      status: "rolled-back",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts: [
      {
        artifactId: "artifact.rollback-state",
        kind: "rollback-state",
        path: ".ai-game-playbook/evidence/rollback-state.json",
        digest: `sha256:${"3".repeat(64)}`,
        bytes: 128,
        complete: true,
        createdAt: new Date(now + 200).toISOString(),
        commandId: "engine.rollback",
      },
    ],
  }, now + 200);
  const rollbackSettlement = rollbackAuthorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });
  const recovered = core.settleWorkflowStep({
    registry: validated,
    checkpoint: rollbackStarted,
    receipt: rollbackReceipt,
    settlement: rollbackSettlement,
    now: () => now + 200,
  });
  head = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: recovered,
    previous: head,
  });

  const loaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  assert.equal(head.chainLength, 7);
  assert.equal(loaded.chainLength, 7);
  assert.equal(loaded.checkpoint.status, "failed");
  assert.deepEqual(loaded.checkpoint.evidenceKinds, [
    "rollback-state",
    "run-receipt",
  ]);
  assert.deepEqual(
    loaded.checkpoint.attempts.map(({ phase, outcome }) => ({ phase, outcome })),
    [
      { phase: "command", outcome: "failed" },
      { phase: "rollback", outcome: "rolled-back" },
    ],
  );
});

test("resume policy and expiry fail closed without reviving stale authority", async (t) => {
  const { root } = await fixture(t);
  const validated = validatedRegistry();
  await persistInitial(root, validated);
  const loaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );

  await assert.rejects(
    core.resumeWorkflowCheckpoint({
      registry: validated,
      stored: loaded,
      policy: "never",
      now: () => now + 100,
    }),
    expectCoreError("workflow-checkpoint-resume-unsafe"),
  );

  const expired = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: loaded,
    policy: "safe",
    now: () => now + 86_400_001,
  });
  assert.equal(expired.disposition, "terminal");
  assert.equal(expired.recoveryPersisted, true);
  assert.equal(expired.checkpoint.status, "expired");
  assert.equal(expired.checkpoint.sequence, 1);

  const second = await fixture(t);
  const secondInitial = await persistInitial(second.root, validated);
  const authorization = authorizeInspect(validated, secondInitial.checkpoint);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: secondInitial.checkpoint,
    authorization,
    now: () => now + 100,
  });
  const storedAdmission = await core.persistWorkflowCheckpoint({
    root: second.root,
    registry: validated,
    checkpoint: admitted,
    previous: secondInitial.stored,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now + 200,
  });
  await core.persistWorkflowCheckpoint({
    root: second.root,
    registry: validated,
    checkpoint: started,
    previous: storedAdmission,
  });
  const expiredStarted = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: await core.loadWorkflowCheckpoint(
      loadRequest(second.root, validated),
    ),
    policy: "safe",
    now: () => now + 86_400_001,
  });
  assert.equal(expiredStarted.disposition, "reconciliation-required");
  assert.equal(expiredStarted.checkpoint.status, "uncertain");
  assert.equal(
    Date.parse(expiredStarted.checkpoint.updatedAt) >=
      Date.parse(expiredStarted.checkpoint.expiresAt),
    true,
  );
});

test("competing checkpoint branches cannot replace the accepted head", async (t) => {
  const { root } = await fixture(t);
  const validated = validatedRegistry();
  await persistInitial(root, validated);
  const firstLoaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  const secondLoaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  const firstResume = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: firstLoaded,
    policy: "safe",
    now: () => now + 100,
  });
  const secondResume = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: secondLoaded,
    policy: "safe",
    now: () => now + 100,
  });
  const firstAuthorization = authorizeInspect(validated, firstResume.checkpoint);
  const secondAuthorization = authorizeInspect(
    validated,
    secondResume.checkpoint,
  );
  const firstChild = core.beginWorkflowStep({
    registry: validated,
    checkpoint: firstResume.checkpoint,
    authorization: firstAuthorization,
    now: () => now + 200,
  });
  const secondChild = core.beginWorkflowStep({
    registry: validated,
    checkpoint: secondResume.checkpoint,
    authorization: secondAuthorization,
    now: () => now + 200,
  });

  await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: firstChild,
    previous: firstResume.stored,
  });
  await assert.rejects(
    core.persistWorkflowCheckpoint({
      root,
      registry: validated,
      checkpoint: secondChild,
      previous: secondResume.stored,
    }),
    expectCoreError("workflow-checkpoint-store-conflict", false),
  );
  const current = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated),
  );
  assert.equal(current.checkpoint.checkpointDigest, firstChild.checkpointDigest);
});

test("a self-consistent but illegal checkpoint transition is rejected by chain validation", async (t) => {
  const { root, store } = await fixture(t);
  const validated = validatedRegistry();
  const { checkpoint } = await persistInitial(root, validated);
  const {
    checkpointDigest: _checkpointDigest,
    parentCheckpointDigest: _parentCheckpointDigest,
    ...retained
  } = checkpoint;
  const forgedBody = {
    ...retained,
    sequence: 1,
    evidenceKinds: ["forged-evidence"],
    updatedAt: "2026-08-26T06:00:00.100Z",
    parentCheckpointDigest: checkpoint.checkpointDigest,
  };
  const forged = {
    ...forgedBody,
    checkpointDigest: contracts.computeWorkflowCheckpointDigest(forgedBody),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(forged), []);
  const recordText = `${contracts.canonicalizeJson(forged)}\n`;
  const recordName = `${runId}.1.${forged.checkpointDigest.slice("sha256:".length)}.checkpoint.json`;
  await writeFile(join(store, recordName), recordText, "utf8");

  const headBody = {
    schemaVersion: "1.0.0",
    runId,
    checkpointId: forged.checkpointId,
    sequence: 1,
    checkpointDigest: forged.checkpointDigest,
    recordDigest: contracts.sha256Digest(recordText),
    registryDigest: forged.identity.registryDigest,
    projectIdentityDigest: forged.identity.projectIdentityDigest,
    updatedAt: forged.updatedAt,
  };
  const head = {
    ...headBody,
    headDigest: contracts.digestCanonicalJson({
      domain: "ai-game-playbook.workflow-checkpoint-head",
      version: "1",
      subject: headBody,
    }),
  };
  await writeFile(
    join(store, `${runId}.head.json`),
    `${contracts.canonicalizeJson(head)}\n`,
    "utf8",
  );

  await assert.rejects(
    core.loadWorkflowCheckpoint(loadRequest(root, validated)),
    expectCoreError("workflow-checkpoint-store-corrupt", false),
  );
});

test("forged reconciliation cannot bypass registered authority or finite target shape", async (t) => {
  const { root, store } = await fixture(t);
  const validated = validatedRegistry();
  const initial = await persistInitial(root, validated);
  const authorization = authorizeInspect(validated, initial.checkpoint);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial.checkpoint,
    authorization,
    now: () => now + 100,
  });
  const storedAdmission = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: admitted,
    previous: initial.stored,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now + 200,
  });
  await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint: started,
    previous: storedAdmission,
  });
  const loaded = await core.loadWorkflowCheckpoint(
    loadRequest(root, validated, { now: () => now + 300 }),
  );
  const resumed = await core.resumeWorkflowCheckpoint({
    registry: validated,
    stored: loaded,
    policy: "safe",
    now: () => now + 400,
  });
  assert.equal(resumed.checkpoint.status, "uncertain");
  assert.equal(resumed.checkpoint.attempts.length, 0);

  const parent = resumed.checkpoint;
  const {
    checkpointDigest: _checkpointDigest,
    parentCheckpointDigest: _parentCheckpointDigest,
    inFlight: _inFlight,
    reconciliation: _reconciliation,
    ...retained
  } = parent;
  const proofDigest = `sha256:${"4".repeat(64)}`;
  const updatedAt = new Date(now + 500).toISOString();
  const forgedBody = {
    ...retained,
    sequence: parent.sequence + 1,
    status: "failed",
    evidenceKinds: [
      "proof.test",
      "run-receipt",
      "workflow-reconciliation",
    ],
    artifactDigests: [proofDigest],
    reconciliation: {
      reconciliationRunId: "a23e4567-e89b-42d3-a456-426614174000",
      workflowId: "workflow.forged-reconciliation",
      resolvedPlanDigest: `sha256:${"3".repeat(64)}`,
      inputDigest: `sha256:${"2".repeat(64)}`,
      receiptDigest: `sha256:${"1".repeat(64)}`,
      proofKind: "proof.test",
      proofDigest,
      targetCheckpointHeadDigest: resumed.stored.headDigest,
      targetReceiptState: "missing",
      outcome: "failed",
      reconciledAt: updatedAt,
    },
    updatedAt,
    parentCheckpointDigest: parent.checkpointDigest,
  };
  const forged = {
    ...forgedBody,
    checkpointDigest: contracts.computeWorkflowCheckpointDigest(forgedBody),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(forged), []);
  const recordText = `${contracts.canonicalizeJson(forged)}\n`;
  const recordName = `${runId}.${forged.sequence}.${forged.checkpointDigest.slice("sha256:".length)}.checkpoint.json`;
  await writeFile(join(store, recordName), recordText, "utf8");

  const headBody = {
    schemaVersion: "1.0.0",
    runId,
    checkpointId: forged.checkpointId,
    sequence: forged.sequence,
    checkpointDigest: forged.checkpointDigest,
    recordDigest: contracts.sha256Digest(recordText),
    registryDigest: forged.identity.registryDigest,
    projectIdentityDigest: forged.identity.projectIdentityDigest,
    updatedAt: forged.updatedAt,
  };
  const head = {
    ...headBody,
    headDigest: contracts.digestCanonicalJson({
      domain: "ai-game-playbook.workflow-checkpoint-head",
      version: "1",
      subject: headBody,
    }),
  };
  await writeFile(
    join(store, `${runId}.head.json`),
    `${contracts.canonicalizeJson(head)}\n`,
    "utf8",
  );

  await assert.rejects(
    core.loadWorkflowCheckpoint(
      loadRequest(root, validated, { now: () => now + 600 }),
    ),
    expectCoreError("workflow-checkpoint-store-corrupt", false),
  );
});

test("corrupt, noncanonical, missing, mismatched, and linked store state is preserved and rejected", async (t) => {
  const first = await fixture(t);
  const validated = validatedRegistry();
  await persistInitial(first.root, validated);
  const headPath = join(first.store, `${runId}.head.json`);
  const originalHead = await readFile(headPath, "utf8");
  await writeFile(headPath, ` ${originalHead}`, "utf8");
  await assert.rejects(
    core.loadWorkflowCheckpoint(loadRequest(first.root, validated)),
    expectCoreError("workflow-checkpoint-store-corrupt", false),
  );
  assert.equal(await readFile(headPath, "utf8"), ` ${originalHead}`);

  const second = await fixture(t);
  await persistInitial(second.root, validated);
  const recordName = (await readdir(second.store)).find((name) =>
    name.endsWith(".checkpoint.json"),
  );
  const recordPath = join(second.store, recordName);
  const originalRecord = await readFile(recordPath, "utf8");
  await writeFile(recordPath, `${originalRecord.slice(0, -2)}x}\n`, "utf8");
  await assert.rejects(
    core.loadWorkflowCheckpoint(loadRequest(second.root, validated)),
    expectCoreError("workflow-checkpoint-store-corrupt", false),
  );
  assert.equal(await readFile(recordPath, "utf8"), `${originalRecord.slice(0, -2)}x}\n`);

  const third = await fixture(t);
  await persistInitial(third.root, validated);
  await assert.rejects(
    core.loadWorkflowCheckpoint(
      loadRequest(third.root, validated, {
        project: {
          id: "project.other",
          identityDigest: projectIdentityDigest,
          stage: "vertical-slice",
        },
      }),
    ),
    expectCoreError("workflow-checkpoint-store-mismatch", false),
  );

  const linkedSandbox = await mkdtemp(join(tmpdir(), "agpb-workflow-link-"));
  t.after(() => rm(linkedSandbox, { recursive: true, force: true }));
  const linkedProject = join(linkedSandbox, "project");
  const outside = join(linkedSandbox, "outside");
  await mkdir(join(linkedProject, ".ai-game-playbook", "state"), {
    recursive: true,
  });
  await mkdir(outside);
  await symlink(
    outside,
    join(linkedProject, ".ai-game-playbook", "state", "workflows"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const linkedRoot = await core.canonicalizeProjectRoot(linkedProject);
  await assert.rejects(
    core.persistWorkflowCheckpoint({
      root: linkedRoot,
      registry: validated,
      checkpoint: core.createWorkflowCheckpoint(checkpointRequest(validated)),
    }),
    expectCoreError("project-path-link"),
  );
});

test("store requests require same-process handles and exact declared identity", async (t) => {
  const { root } = await fixture(t);
  const validated = validatedRegistry();
  const { checkpoint, stored } = await persistInitial(root, validated);

  const wrongRootCheckpoint = core.createWorkflowCheckpoint(
    checkpointRequest(validated, {
      runId: "723e4567-e89b-42d3-a456-426614174000",
      project: {
        id: "project.graybox",
        identityDigest: projectIdentityDigest,
        rootIdentityDigest: `sha256:${"6".repeat(64)}`,
        stage: "vertical-slice",
      },
    }),
  );
  await assert.rejects(
    core.persistWorkflowCheckpoint({
      root,
      registry: validated,
      checkpoint: wrongRootCheckpoint,
    }),
    expectCoreError("workflow-checkpoint-store-mismatch"),
  );

  await assert.rejects(
    core.persistWorkflowCheckpoint({
      root,
      registry: validated,
      checkpoint: structuredClone(checkpoint),
      previous: stored,
    }),
    expectCoreError("workflow-checkpoint-state-invalid"),
  );
  await assert.rejects(
    core.loadWorkflowCheckpoint({
      ...loadRequest(root, validated),
      undeclared: true,
    }),
    expectCoreError("invalid-workflow-checkpoint-store-request"),
  );
  await assert.rejects(
    core.resumeWorkflowCheckpoint({
      registry: validated,
      stored: structuredClone(stored),
      policy: "safe",
      now: () => now + 100,
    }),
    expectCoreError("invalid-workflow-checkpoint-store-request"),
  );
});
