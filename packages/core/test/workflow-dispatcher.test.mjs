import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const baseTime = Date.parse("2026-08-28T03:00:00.000Z");
const input = Object.freeze({ schemaVersion: "1.0.0" });
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

function expectCoreError(code, uncertain) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    (uncertain === undefined || error?.mutationUncertain === uncertain);
}

function mutationRegistry({ twoSteps = false } = {}) {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    contracts.workflowCheckpointSchema,
  );
  const command = definition.commands.find(({ id }) => id === "project.inspect");
  command.permissions = ["write-project-metadata"];
  command.sideEffects = [
    { kind: "filesystem", scope: "test-metadata", boundary: "local" },
  ];
  command.lane = "project-write";
  command.retry = { mode: "never", maxAttempts: 1 };
  command.budgets = {
    maxChangedFiles: 4,
    maxChangedBytes: 4_096,
    maxDurationMs: 30_000,
    maxOutputBytes: 4_096,
    maxRepairCycles: 0,
  };
  command.requiredEvidence = ["run-receipt"];
  command.handler = {
    package: "@ai-game-playbook/core",
    export: "executeTestProjectMutation",
    digest: `sha256:${"d".repeat(64)}`,
  };
  const workflow = definition.workflows[0];
  const step = structuredClone(workflow.steps[0]);
  step.dependsOn = [];
  step.approvalCheckpoint = true;
  if (twoSteps) {
    const second = structuredClone(step);
    second.id = "step.inspect-second";
    second.dependsOn = [step.id];
    workflow.steps = [step, second];
  } else {
    workflow.steps = [step];
  }
  workflow.budgets = structuredClone(command.budgets);
  workflow.requiredEvidence = ["run-receipt"];
  return registry.validateRegistry(definition);
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-workflow-dispatch-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  return { project, root, sandbox };
}

function createBroker(validated, root) {
  return core.createPermissionBroker({
    registry: validated,
    project: {
      id: "project.dispatch-test",
      identityDigest: root.identityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 4,
        maxChangedBytes: 4_096,
        maxDurationMs: 30_000,
        maxOutputBytes: 4_096,
        maxRepairCycles: 0,
      },
    },
    trustedApprovalKeys: [
      { keyId: "approval.dispatch-test", publicKeyPem },
    ],
    now: () => baseTime,
  });
}

function authorizationRequest(checkpoint, stepId = "step.inspect") {
  return {
    runId: checkpoint.identity.runId,
    projectId: checkpoint.identity.projectId,
    projectIdentityDigest: checkpoint.identity.projectIdentityDigest,
    commandId: "project.inspect",
    input,
    workflow: {
      id: checkpoint.identity.workflow.id,
      stepId,
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    },
    scope: {
      paths: ["metadata/test.json"],
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: ["metadata"],
      publishTargets: [],
    },
    budgets: {
      maxChangedFiles: 1,
      maxChangedBytes: 1_024,
      maxDurationMs: 10_000,
      maxOutputBytes: 1_024,
      maxRepairCycles: 0,
    },
    deadlineAt: new Date(baseTime + 10_000).toISOString(),
  };
}

function signedGrant(challenge, grantId = "approval.dispatch-write") {
  const subject = core.createApprovalGrantSubject(challenge, {
    grantId,
    permission: "write-project-metadata",
    approvedAt: new Date(baseTime - 1_000).toISOString(),
    expiresAt: new Date(baseTime + 20_000).toISOString(),
    maxUses: 1,
  });
  return {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId: "approval.dispatch-test",
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
}

async function preparedExecution(t, overrides = {}) {
  const { root, sandbox } = await fixture(t);
  const validated = overrides.registry ?? mutationRegistry();
  const runId = overrides.runId ?? randomUUID();
  const checkpoint = core.createWorkflowCheckpoint({
    registry: validated,
    workflowId: "workflow.verify-feature",
    project: {
      id: "project.dispatch-test",
      identityDigest: root.identityDigest,
      rootIdentityDigest: root.identityDigest,
      stage: "vertical-slice",
    },
    runId,
    inputDigest: contracts.digestCanonicalJson(input),
    ttlMs: 60_000,
    now: () => baseTime,
  });
  const stored = await core.persistWorkflowCheckpoint({
    root,
    registry: validated,
    checkpoint,
  });
  const broker = createBroker(validated, root);
  const request = authorizationRequest(checkpoint);
  const challenge = broker.prepare(request);
  const authorization = broker.authorize(request, [signedGrant(challenge)]);
  assert.equal(authorization.status, "authorized");
  const lane = await core.acquireProjectLane({
    root,
    projectIdentityDigest: root.identityDigest,
    runId: overrides.laneRunId ?? runId,
    lane: overrides.lane ?? "project-write",
    leaseDurationMs: 30_000,
    waitTimeoutMs: 1_000,
    pollIntervalMs: 10,
    signal: null,
  });
  t.after(async () => {
    if (lane.state === "active") await lane.release();
    await rm(sandbox, { recursive: true, force: true });
  });
  return { authorization, broker, lane, registry: validated, root, stored };
}

function runtimePlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function receiptFor(validated, checkpoint, settlement) {
  const inFlight = checkpoint.inFlight;
  assert.notEqual(inFlight, undefined);
  const body = {
    schemaVersion: "1.0.0",
    receiptId: randomUUID(),
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
      packDigests: validated.packs
        .filter(({ provides }) => provides.commands.includes(inFlight.command.id))
        .map(({ digest }) => digest)
        .sort(),
      approvalIds: [...inFlight.approvalIds].sort(),
    },
    environment: {
      platform: runtimePlatform(),
      architecture: process.arch,
      nodeVersion: process.versions.node,
      projectIdentityDigest: checkpoint.identity.projectRootIdentityDigest,
    },
    timing: {
      startedAt: checkpoint.updatedAt,
      endedAt: settlement.settledAt,
      durationMs:
        Date.parse(settlement.settledAt) - Date.parse(checkpoint.updatedAt),
    },
    effects: settlement.actual,
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: {
        status: "passed",
        code: "dispatch-test-complete",
        message: "The bounded test mutation completed.",
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

function successfulExecutor(validated, calls) {
  return core.bindWorkflowStepExecutor({
    registry: validated,
    commandId: "project.inspect",
    invoke: async ({ authorization, checkpoint }) => {
      calls.push(checkpoint.sequence);
      const settlement = authorization.lease.settle({
        outcome: "succeeded",
        mutationUncertain: false,
        actual: {
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
        },
      });
      return { receipt: receiptFor(validated, checkpoint, settlement), settlement };
    },
  });
}

test("durable dispatcher persists admission and start before one exact executor invocation", async (t) => {
  assert.equal(typeof core.bindWorkflowStepExecutor, "function");
  assert.equal(typeof core.dispatchProjectWorkflowStep, "function");
  const execution = await preparedExecution(t);
  const calls = [];
  const result = await core.dispatchProjectWorkflowStep({
    root: execution.root,
    registry: execution.registry,
    stored: execution.stored,
    authorization: execution.authorization,
    lane: execution.lane,
    executor: successfulExecutor(execution.registry, calls),
    signal: null,
    maxArtifactBytes: 0,
    now: () => baseTime,
  });

  assert.deepEqual(calls, [2]);
  assert.equal(result.admitted.checkpoint.sequence, 1);
  assert.equal(result.admitted.checkpoint.inFlight.sideEffect, "not-started");
  assert.equal(result.started.checkpoint.sequence, 2);
  assert.equal(result.started.checkpoint.inFlight.sideEffect, "started");
  assert.equal(result.receipt.chainLength, 1);
  assert.equal(result.terminal.checkpoint.sequence, 3);
  assert.equal(result.terminal.checkpoint.status, "succeeded");
  assert.equal(result.terminal.checkpoint.receiptChainHead, result.receipt.receipt.receiptDigest);

  const loadedCheckpoint = await core.loadWorkflowCheckpoint({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    project: {
      id: "project.dispatch-test",
      identityDigest: execution.root.identityDigest,
      rootIdentityDigest: execution.root.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(input),
    now: () => baseTime,
  });
  assert.equal(loadedCheckpoint.chainLength, 4);
  assert.equal(loadedCheckpoint.checkpoint.status, "succeeded");
  const loadedReceipt = await core.loadRunReceiptChain({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    projectId: "project.dispatch-test",
    projectIdentityDigest: execution.root.identityDigest,
    workflowId: "workflow.verify-feature",
    resolvedPlanDigest:
      execution.stored.checkpoint.identity.workflow.resolvedPlanDigest,
    maxArtifactBytes: 0,
  });
  assert.equal(loadedReceipt.receipts.length, 1);
});

test("a later step reloads and extends the durable receipt chain before mutation", async (t) => {
  const validated = mutationRegistry({ twoSteps: true });
  const execution = await preparedExecution(t, { registry: validated });
  const first = await core.dispatchProjectWorkflowStep({
    root: execution.root,
    registry: execution.registry,
    stored: execution.stored,
    authorization: execution.authorization,
    lane: execution.lane,
    executor: successfulExecutor(execution.registry, []),
    signal: null,
    maxArtifactBytes: 0,
    now: () => baseTime,
  });
  assert.equal(first.terminal.checkpoint.status, "waiting-approval");

  const secondRequest = authorizationRequest(
    first.terminal.checkpoint,
    "step.inspect-second",
  );
  const secondChallenge = execution.broker.prepare(secondRequest);
  const secondAuthorization = execution.broker.authorize(secondRequest, [
    signedGrant(secondChallenge, "approval.dispatch-write-second"),
  ]);
  assert.equal(secondAuthorization.status, "authorized");
  const secondCalls = [];
  const second = await core.dispatchProjectWorkflowStep({
    root: execution.root,
    registry: execution.registry,
    stored: first.terminal,
    authorization: secondAuthorization,
    lane: execution.lane,
    executor: successfulExecutor(execution.registry, secondCalls),
    signal: null,
    maxArtifactBytes: 0,
    now: () => baseTime,
  });

  assert.deepEqual(secondCalls, [5]);
  assert.equal(second.receipt.chainLength, 2);
  assert.equal(
    second.receipt.receipt.previousReceiptDigest,
    first.receipt.receipt.receiptDigest,
  );
  assert.equal(second.terminal.checkpoint.status, "succeeded");
  const loaded = await core.loadRunReceiptChain({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    projectId: "project.dispatch-test",
    projectIdentityDigest: execution.root.identityDigest,
    workflowId: "workflow.verify-feature",
    resolvedPlanDigest:
      execution.stored.checkpoint.identity.workflow.resolvedPlanDigest,
    maxArtifactBytes: 0,
  });
  assert.equal(loaded.receipts.length, 2);
});

test("receipt-head corruption blocks a later step before admission or executor invocation", async (t) => {
  const validated = mutationRegistry({ twoSteps: true });
  const execution = await preparedExecution(t, { registry: validated });
  const first = await core.dispatchProjectWorkflowStep({
    root: execution.root,
    registry: execution.registry,
    stored: execution.stored,
    authorization: execution.authorization,
    lane: execution.lane,
    executor: successfulExecutor(execution.registry, []),
    signal: null,
    maxArtifactBytes: 0,
    now: () => baseTime,
  });
  await writeFile(
    join(
      execution.root.canonicalPath,
      ".ai-game-playbook",
      "evidence",
      "receipts",
      `${execution.stored.checkpoint.identity.runId}.head.json`,
    ),
    "{}\n",
    "utf8",
  );
  const secondRequest = authorizationRequest(
    first.terminal.checkpoint,
    "step.inspect-second",
  );
  const secondChallenge = execution.broker.prepare(secondRequest);
  const secondAuthorization = execution.broker.authorize(secondRequest, [
    signedGrant(secondChallenge, "approval.dispatch-corrupt-head"),
  ]);
  assert.equal(secondAuthorization.status, "authorized");
  let calls = 0;
  const executor = core.bindWorkflowStepExecutor({
    registry: execution.registry,
    commandId: "project.inspect",
    invoke: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });

  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: execution.root,
      registry: execution.registry,
      stored: first.terminal,
      authorization: secondAuthorization,
      lane: execution.lane,
      executor,
      signal: null,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    (error) =>
      error?.name === "CoreBoundaryError" &&
      error?.code === "run-receipt-store-corrupt" &&
      error?.mutationUncertain === false,
  );
  assert.equal(calls, 0);
  assert.equal(secondAuthorization.lease.state, "settled");
  const checkpoint = await core.loadWorkflowCheckpoint({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    project: {
      id: "project.dispatch-test",
      identityDigest: execution.root.identityDigest,
      rootIdentityDigest: execution.root.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(input),
    now: () => baseTime,
  });
  assert.equal(checkpoint.chainLength, 4);
  assert.equal(checkpoint.checkpoint.checkpointDigest, first.terminal.checkpoint.checkpointDigest);
});

test("dispatcher rejects copied executor authority and a lane owned by another run", async (t) => {
  const copiedExecution = await preparedExecution(t);
  const copiedBinding = {
    ...successfulExecutor(copiedExecution.registry, []),
  };
  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: copiedExecution.root,
      registry: copiedExecution.registry,
      stored: copiedExecution.stored,
      authorization: copiedExecution.authorization,
      lane: copiedExecution.lane,
      executor: copiedBinding,
      signal: null,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    expectCoreError("workflow-dispatch-binding-mismatch", false),
  );

  const wrongCommandBinding = core.bindWorkflowStepExecutor({
    registry: copiedExecution.registry,
    commandId: "engine.rollback",
    invoke: async () => {
      throw new Error("must not run");
    },
  });
  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: copiedExecution.root,
      registry: copiedExecution.registry,
      stored: copiedExecution.stored,
      authorization: copiedExecution.authorization,
      lane: copiedExecution.lane,
      executor: wrongCommandBinding,
      signal: null,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    expectCoreError("workflow-dispatch-binding-mismatch", false),
  );

  const wrongLaneExecution = await preparedExecution(t, {
    laneRunId: randomUUID(),
  });
  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: wrongLaneExecution.root,
      registry: wrongLaneExecution.registry,
      stored: wrongLaneExecution.stored,
      authorization: wrongLaneExecution.authorization,
      lane: wrongLaneExecution.lane,
      executor: successfulExecutor(wrongLaneExecution.registry, []),
      signal: null,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    expectCoreError("workflow-dispatch-binding-mismatch", false),
  );
});

test("dispatcher closes authorization and leaves the initial head when cancelled before admission", async (t) => {
  const execution = await preparedExecution(t);
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const executor = core.bindWorkflowStepExecutor({
    registry: execution.registry,
    commandId: "project.inspect",
    invoke: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });

  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: execution.root,
      registry: execution.registry,
      stored: execution.stored,
      authorization: execution.authorization,
      lane: execution.lane,
      executor,
      signal: controller.signal,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    expectCoreError("workflow-dispatch-cancelled", false),
  );
  assert.equal(calls, 0);
  assert.equal(execution.authorization.lease.state, "settled");
  const loaded = await core.loadWorkflowCheckpoint({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    project: {
      id: "project.dispatch-test",
      identityDigest: execution.root.identityDigest,
      rootIdentityDigest: execution.root.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(input),
    now: () => baseTime,
  });
  assert.equal(loaded.chainLength, 1);
  assert.equal(loaded.checkpoint.sequence, 0);
});

test("authorization expiry after admission closes the lease without crossing the start boundary", async (t) => {
  const execution = await preparedExecution(t);
  let clockReads = 0;
  const clock = () => {
    clockReads += 1;
    return clockReads < 4 ? baseTime : baseTime + 20_000;
  };
  let calls = 0;
  const executor = core.bindWorkflowStepExecutor({
    registry: execution.registry,
    commandId: "project.inspect",
    invoke: async () => {
      calls += 1;
      throw new Error("must not run");
    },
  });

  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: execution.root,
      registry: execution.registry,
      stored: execution.stored,
      authorization: execution.authorization,
      lane: execution.lane,
      executor,
      signal: null,
      maxArtifactBytes: 0,
      now: clock,
    }),
    expectCoreError("workflow-checkpoint-transition-invalid", false),
  );
  assert.equal(calls, 0);
  assert.equal(execution.authorization.lease.state, "settled");
  const loaded = await core.loadWorkflowCheckpoint({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    project: {
      id: "project.dispatch-test",
      identityDigest: execution.root.identityDigest,
      rootIdentityDigest: execution.root.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(input),
    now: () => baseTime + 20_000,
  });
  assert.equal(loaded.chainLength, 2);
  assert.equal(loaded.checkpoint.sequence, 1);
  assert.equal(loaded.checkpoint.inFlight.sideEffect, "not-started");
});

test("executor failure after the durable start is never retried and remains uncertain", async (t) => {
  const execution = await preparedExecution(t);
  let calls = 0;
  const executor = core.bindWorkflowStepExecutor({
    registry: execution.registry,
    commandId: "project.inspect",
    invoke: async () => {
      calls += 1;
      throw new Error("fixture failure");
    },
  });

  await assert.rejects(
    core.dispatchProjectWorkflowStep({
      root: execution.root,
      registry: execution.registry,
      stored: execution.stored,
      authorization: execution.authorization,
      lane: execution.lane,
      executor,
      signal: null,
      maxArtifactBytes: 0,
      now: () => baseTime,
    }),
    expectCoreError("workflow-dispatch-execution-failed", true),
  );
  assert.equal(calls, 1);
  assert.equal(execution.authorization.lease.state, "settled");
  const loaded = await core.loadWorkflowCheckpoint({
    root: execution.root,
    registry: execution.registry,
    runId: execution.stored.checkpoint.identity.runId,
    project: {
      id: "project.dispatch-test",
      identityDigest: execution.root.identityDigest,
      rootIdentityDigest: execution.root.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(input),
    now: () => baseTime,
  });
  assert.equal(loaded.chainLength, 3);
  assert.equal(loaded.checkpoint.status, "running");
  assert.equal(loaded.checkpoint.inFlight.sideEffect, "started");
  await assert.rejects(
    core.loadRunReceiptChain({
      root: execution.root,
      registry: execution.registry,
      runId: execution.stored.checkpoint.identity.runId,
      projectId: "project.dispatch-test",
      projectIdentityDigest: execution.root.identityDigest,
      workflowId: "workflow.verify-feature",
      resolvedPlanDigest:
        execution.stored.checkpoint.identity.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-not-found"),
  );
});
