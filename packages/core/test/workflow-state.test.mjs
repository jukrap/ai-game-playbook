import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const runId = "423e4567-e89b-42d3-a456-426614174000";
const projectIdentityDigest = `sha256:${"9".repeat(64)}`;
const inputDigest = `sha256:${"8".repeat(64)}`;
const now = Date.parse("2026-08-26T05:00:00.000Z");

function request(validatedRegistry) {
  return {
    registry: validatedRegistry,
    workflowId: "workflow.verify-feature",
    project: {
      id: "project.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
    },
    runId,
    inputDigest,
    feature: {
      id: "feature.collectible",
      contractDigest: `sha256:${"7".repeat(64)}`,
    },
    ttlMs: 86_400_000,
    now: () => now,
  };
}

function executionRequest(validatedRegistry) {
  const { feature: _feature, ...withoutFeature } = request(validatedRegistry);
  return withoutFeature;
}

function executionRegistry() {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(contracts.approvalGrantSchema);
  definition.schemas.push(contracts.approvalPromptSchema);
  return registry.validateRegistry(definition);
}

function broker(validatedRegistry) {
  return core.createPermissionBroker({
    registry: validatedRegistry,
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
    now: () => now,
  });
}

function authorizeCommand(
  validatedRegistry,
  checkpoint,
  {
    commandId = "project.inspect",
    stepId = "step.inspect",
    maxOutputBytes = 1_048_576,
  } = {},
) {
  return broker(validatedRegistry).authorize(
    {
      runId,
      projectId: "project.graybox",
      projectIdentityDigest,
      commandId,
      input: { schemaVersion: "1.0.0" },
      workflow: {
        id: "workflow.verify-feature",
        stepId,
        resolvedPlanDigest:
          checkpoint.identity.workflow.resolvedPlanDigest,
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
        maxOutputBytes,
        maxRepairCycles: 0,
      },
      deadlineAt: "2026-08-26T05:00:30.000Z",
    },
    [],
  );
}

function authorizeInspect(validatedRegistry, checkpoint) {
  return authorizeCommand(validatedRegistry, checkpoint);
}

function oneStepRegistry({
  onFailure = "stop",
  requiredEvidence = ["project-profile"],
  rollback = false,
} = {}) {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(contracts.approvalGrantSchema);
  definition.schemas.push(contracts.approvalPromptSchema);
  const step = structuredClone(definition.workflows[0].steps[0]);
  step.onFailure = onFailure;
  if (rollback) {
    step.rollbackCommandId = "engine.rollback";
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
  } else {
    delete step.rollbackCommandId;
  }
  definition.workflows[0].steps = [step];
  definition.workflows[0].requiredEvidence = requiredEvidence;
  return registry.validateRegistry(definition);
}

function twoReadStepRegistry() {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(contracts.approvalGrantSchema);
  definition.schemas.push(contracts.approvalPromptSchema);
  const first = structuredClone(definition.workflows[0].steps[0]);
  first.id = "step.inspect-a";
  const second = structuredClone(first);
  second.id = "step.inspect-b";
  second.dependsOn = [first.id];
  definition.workflows[0].steps = [first, second];
  definition.workflows[0].budgets.maxOutputBytes = 5;
  return registry.validateRegistry(definition);
}

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
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

function receiptFor(checkpoint, overrides = {}) {
  const inFlight = checkpoint.inFlight;
  const timestamp = new Date(now).toISOString();
  const receipt = {
    schemaVersion: "1.0.0",
    receiptId: "523e4567-e89b-42d3-a456-426614174000",
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
      ...(checkpoint.identity.featureId === undefined
        ? {}
        : {
            featureId: checkpoint.identity.featureId,
            featureContractDigest:
              checkpoint.identity.featureContractDigest,
          }),
      resolvedPlanDigest:
        checkpoint.identity.workflow.resolvedPlanDigest,
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
      ...(checkpoint.sessionIdentityDigest === undefined
        ? {}
        : { sessionIdentityDigest: checkpoint.sessionIdentityDigest }),
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

test("initial workflow checkpoints bind exact resolved plan and project identity", () => {
  assert.equal(typeof core.createWorkflowCheckpoint, "function");
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  const plan = registry.resolveWorkflowPlan(
    validated,
    "workflow.verify-feature",
    "vertical-slice",
  );

  const checkpoint = core.createWorkflowCheckpoint(request(validated));

  assert.equal(checkpoint.sequence, 0);
  assert.equal(checkpoint.status, "prepared");
  assert.equal(checkpoint.identity.registryDigest, validated.digest);
  assert.equal(
    checkpoint.identity.workflow.resolvedPlanDigest,
    plan.resolvedPlanDigest,
  );
  assert.equal(checkpoint.identity.projectStage, "vertical-slice");
  assert.equal(checkpoint.nextOrdinal, 0);
  assert.deepEqual(checkpoint.attempts, []);
  assert.equal(contracts.isWorkflowCheckpointDigestValid(checkpoint), true);
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(checkpoint), []);
  assert.equal(Object.isFrozen(checkpoint), true);
  assert.equal(Object.isFrozen(checkpoint.identity), true);
});

test("initial workflow checkpoints expose an approval stop before the first step", () => {
  const definition = createValidRegistryDefinition();
  definition.workflows[0].steps[0].approvalCheckpoint = true;
  const validated = registry.validateRegistry(definition);

  assert.equal(
    core.createWorkflowCheckpoint(request(validated)).status,
    "waiting-approval",
  );
});

test("workflow checkpoint creation rejects unvalidated authority, invalid identity, and unsafe TTL", () => {
  assert.throws(
    () => core.createWorkflowCheckpoint(request(createValidRegistryDefinition())),
    TypeError,
  );

  const validated = registry.validateRegistry(createValidRegistryDefinition());
  assert.throws(
    () =>
      core.createWorkflowCheckpoint({
        ...request(validated),
        runId: "not-a-run-id",
      }),
    expectCoreError("invalid-workflow-checkpoint-request"),
  );
  assert.throws(
    () =>
      core.createWorkflowCheckpoint({
        ...request(validated),
        ttlMs: 604_800_001,
      }),
    expectCoreError("invalid-workflow-checkpoint-request"),
  );
});

test("workflow steps begin only from exact broker authorization and record a pre-dispatch checkpoint", () => {
  assert.equal(typeof core.beginWorkflowStep, "function");
  assert.equal(typeof core.markWorkflowStepStarted, "function");
  const validated = executionRegistry();
  const checkpoint = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, checkpoint);
  assert.equal(authorization.status, "authorized");

  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint,
    authorization,
    now: () => now,
  });

  assert.equal(admitted.sequence, 1);
  assert.equal(admitted.parentCheckpointDigest, checkpoint.checkpointDigest);
  assert.equal(admitted.status, "running");
  assert.equal(admitted.inFlight.stepId, "step.inspect");
  assert.equal(admitted.inFlight.command.id, "project.inspect");
  assert.equal(admitted.inFlight.inputDigest, authorization.challenge.inputDigest);
  assert.equal(admitted.inFlight.sideEffect, "not-started");

  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  assert.equal(started.sequence, 2);
  assert.equal(started.inFlight.sideEffect, "started");
  assert.equal(started.parentCheckpointDigest, admitted.checkpointDigest);
  assert.equal(contracts.isWorkflowCheckpointDigestValid(started), true);
});

test("workflow step admission rejects copied checkpoints and forged authorization", () => {
  const validated = executionRegistry();
  const checkpoint = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, checkpoint);

  assert.throws(
    () =>
      core.beginWorkflowStep({
        registry: validated,
        checkpoint: structuredClone(checkpoint),
        authorization,
        now: () => now,
      }),
    expectCoreError("workflow-checkpoint-state-invalid"),
  );
  assert.throws(
    () =>
      core.beginWorkflowStep({
        registry: validated,
        checkpoint,
        authorization: {
          ...authorization,
          lease: {
            ...authorization.lease,
            state: "active",
          },
        },
        now: () => now,
      }),
    expectCoreError("permission-lease-state-invalid"),
  );
});

test("workflow step settlement advances the cursor and appends an exact receipt chain", () => {
  assert.equal(typeof core.settleWorkflowStep, "function");
  const validated = executionRegistry();
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const receipt = receiptFor(started);
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  const advanced = core.settleWorkflowStep({
    registry: validated,
    checkpoint: started,
    receipt,
    settlement,
    now: () => now,
  });

  assert.equal(advanced.sequence, 3);
  assert.equal(advanced.status, "prepared");
  assert.equal(advanced.nextOrdinal, 1);
  assert.equal(advanced.inFlight, undefined);
  assert.equal(advanced.receiptChainHead, receipt.receiptDigest);
  assert.deepEqual(advanced.attempts, [
    {
      stepId: "step.inspect",
      ordinal: 0,
      attempt: 1,
      phase: "command",
      outcome: "succeeded",
      receiptDigest: receipt.receiptDigest,
    },
  ]);
  assert.deepEqual(advanced.budgetUsage, {
    durationMs: 0,
    outputBytes: 0,
    changedFiles: 0,
    changedBytes: 0,
    repairCycles: 0,
  });
  assert.equal(contracts.isWorkflowCheckpointDigestValid(advanced), true);
});

test("a retained run receipt satisfies an explicit run-receipt evidence duty", () => {
  const validated = oneStepRegistry({ requiredEvidence: ["run-receipt"] });
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const receipt = receiptFor(started);
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  const completed = core.settleWorkflowStep({
    registry: validated,
    checkpoint: started,
    receipt,
    settlement,
    now: () => now,
  });

  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.evidenceKinds, ["run-receipt"]);
});

test("receipt filesystem identity remains independent from logical workflow identity", () => {
  const validated = oneStepRegistry({ requiredEvidence: ["run-receipt"] });
  const rootIdentityDigest = `sha256:${"6".repeat(64)}`;
  const initial = core.createWorkflowCheckpoint({
    ...executionRequest(validated),
    project: {
      ...executionRequest(validated).project,
      rootIdentityDigest,
    },
  });
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const receipt = receiptFor(started, {
    environment: {
      platform: "windows",
      architecture: "x64",
      nodeVersion: "22.22.0",
      projectIdentityDigest: rootIdentityDigest,
    },
  });
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  const completed = core.settleWorkflowStep({
    registry: validated,
    checkpoint: started,
    receipt,
    settlement,
    now: () => now,
  });

  assert.equal(completed.status, "succeeded");
  assert.equal(completed.identity.projectIdentityDigest, projectIdentityDigest);
  assert.equal(
    completed.identity.projectRootIdentityDigest,
    rootIdentityDigest,
  );
});

test("a root-bound checkpoint rejects a receipt that substitutes logical identity", () => {
  const validated = oneStepRegistry({ requiredEvidence: ["run-receipt"] });
  const initial = core.createWorkflowCheckpoint({
    ...executionRequest(validated),
    project: {
      ...executionRequest(validated).project,
      rootIdentityDigest: `sha256:${"6".repeat(64)}`,
    },
  });
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  assert.throws(
    () =>
      core.settleWorkflowStep({
        registry: validated,
        checkpoint: started,
        receipt: receiptFor(started),
        settlement,
        now: () => now,
      }),
    expectCoreError("workflow-checkpoint-receipt-invalid"),
  );
});

test("workflow settlement rejects copied broker settlement and mismatched receipt authority", () => {
  const validated = executionRegistry();
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  assert.throws(
    () =>
      core.settleWorkflowStep({
        registry: validated,
        checkpoint: started,
        receipt: receiptFor(started),
        settlement: structuredClone(settlement),
        now: () => now,
      }),
    expectCoreError("permission-lease-state-invalid"),
  );

  const mismatchedReceipt = receiptFor(started);
  mismatchedReceipt.authority.handlerDigest = `sha256:${"1".repeat(64)}`;
  mismatchedReceipt.receiptDigest =
    contracts.computeRunReceiptDigest(mismatchedReceipt);
  assert.throws(
    () =>
      core.settleWorkflowStep({
        registry: validated,
        checkpoint: started,
        receipt: mismatchedReceipt,
        settlement,
        now: () => now,
      }),
    expectCoreError("workflow-checkpoint-receipt-invalid"),
  );
});

test("workflow settlement rejects a receipt dated before dispatch", () => {
  const validated = executionRegistry();
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now + 1,
  });
  const receipt = receiptFor(started);
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects(),
  });

  assert.throws(
    () =>
      core.settleWorkflowStep({
        registry: validated,
        checkpoint: started,
        receipt,
        settlement,
        now: () => now + 1,
      }),
    expectCoreError("workflow-checkpoint-receipt-invalid"),
  );
});

test("scope violations after dispatch place the workflow behind an uncertainty barrier", () => {
  const validated = executionRegistry();
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
  });
  const receipt = receiptFor(started, {
    effects: actualEffects({
      changedPaths: ["project.godot"],
      changedBytes: 1,
      changeKinds: ["source"],
    }),
    mutation: {
      status: "committed",
      changedFiles: [{ path: "project.godot", bytesDelta: 1 }],
      unexpectedDirtyFiles: [],
    },
  });
  const settlement = authorization.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: actualEffects({
      changedPaths: ["project.godot"],
      changedBytes: 1,
      changeKinds: ["source"],
    }),
  });
  assert.equal(settlement.status, "scope-violation");

  const uncertain = core.settleWorkflowStep({
    registry: validated,
    checkpoint: started,
    receipt,
    settlement,
    now: () => now,
  });
  assert.equal(uncertain.status, "uncertain");
  assert.equal(uncertain.nextOrdinal, 0);
  assert.equal(uncertain.inFlight.sideEffect, "uncertain");
  assert.equal(uncertain.attempts.at(-1).outcome, "uncertain");
  assert.equal(uncertain.budgetUsage.changedFiles, 1);
});

test("a successful terminal step requires complete declared evidence", () => {
  for (const [artifacts, expectedStatus] of [
    [[], "blocked"],
    [
      [
        {
          artifactId: "artifact.project-profile",
          kind: "project-profile",
          path: ".ai-game-playbook/evidence/project-profile.json",
          digest: `sha256:${"2".repeat(64)}`,
          bytes: 256,
          complete: true,
          createdAt: new Date(now).toISOString(),
          commandId: "project.inspect",
        },
      ],
      "succeeded",
    ],
  ]) {
    const validated = oneStepRegistry();
    const initial = core.createWorkflowCheckpoint(executionRequest(validated));
    const authorization = authorizeInspect(validated, initial);
    const admitted = core.beginWorkflowStep({
      registry: validated,
      checkpoint: initial,
      authorization,
      now: () => now,
    });
    const started = core.markWorkflowStepStarted({
      registry: validated,
      checkpoint: admitted,
      now: () => now,
    });
    const receipt = receiptFor(started, { artifacts });
    const settlement = authorization.lease.settle({
      outcome: "succeeded",
      mutationUncertain: false,
      actual: actualEffects(),
    });
    const completed = core.settleWorkflowStep({
      registry: validated,
      checkpoint: started,
      receipt,
      settlement,
      now: () => now,
    });

    assert.equal(completed.status, expectedStatus);
    assert.equal(completed.nextOrdinal, 1);
    assert.deepEqual(
      completed.evidenceKinds,
      expectedStatus === "succeeded"
        ? ["project-profile", "run-receipt"]
        : ["run-receipt"],
    );
  }
});

test("a declared rollback runs as a separately authorized phase and ends recovered failure", () => {
  const validated = oneStepRegistry({
    onFailure: "rollback",
    requiredEvidence: ["rollback-state"],
    rollback: true,
  });
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const forwardAuthorization = authorizeInspect(validated, initial);
  const admitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization: forwardAuthorization,
    now: () => now,
  });
  const started = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: admitted,
    now: () => now,
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
    now: () => now,
  });
  assert.equal(waitingRollback.status, "waiting-rollback");
  assert.equal(waitingRollback.nextOrdinal, 0);

  const rollbackAuthorization = authorizeCommand(
    validated,
    waitingRollback,
    { commandId: "engine.rollback" },
  );
  const rollbackAdmitted = core.beginWorkflowStep({
    registry: validated,
    checkpoint: waitingRollback,
    authorization: rollbackAuthorization,
    now: () => now,
  });
  assert.equal(rollbackAdmitted.status, "rolling-back");
  assert.equal(rollbackAdmitted.inFlight.phase, "rollback");
  const rollbackStarted = core.markWorkflowStepStarted({
    registry: validated,
    checkpoint: rollbackAdmitted,
    now: () => now,
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
        createdAt: new Date(now).toISOString(),
        commandId: "engine.rollback",
      },
    ],
  });
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
    now: () => now,
  });

  assert.equal(recovered.status, "failed");
  assert.deepEqual(
    recovered.attempts.map(({ phase, outcome }) => ({ phase, outcome })),
    [
      { phase: "command", outcome: "failed" },
      { phase: "rollback", outcome: "rolled-back" },
    ],
  );
  assert.deepEqual(recovered.evidenceKinds, ["rollback-state", "run-receipt"]);
});

test("a checkpoint cannot create a second successor in the same runtime", () => {
  const validated = executionRegistry();
  const initial = core.createWorkflowCheckpoint(executionRequest(validated));
  const authorization = authorizeInspect(validated, initial);
  core.beginWorkflowStep({
    registry: validated,
    checkpoint: initial,
    authorization,
    now: () => now,
  });

  assert.throws(
    () =>
      core.beginWorkflowStep({
        registry: validated,
        checkpoint: initial,
        authorization,
        now: () => now,
      }),
    expectCoreError("workflow-checkpoint-state-invalid"),
  );
});

test("aggregate workflow budgets stop later steps even when each lease stayed in budget", () => {
  const validated = twoReadStepRegistry();
  let checkpoint = core.createWorkflowCheckpoint(executionRequest(validated));

  for (const stepId of ["step.inspect-a", "step.inspect-b"]) {
    const authorization = authorizeCommand(validated, checkpoint, {
      stepId,
      maxOutputBytes: 3,
    });
    const admitted = core.beginWorkflowStep({
      registry: validated,
      checkpoint,
      authorization,
      now: () => now,
    });
    const started = core.markWorkflowStepStarted({
      registry: validated,
      checkpoint: admitted,
      now: () => now,
    });
    const receipt = receiptFor(started, {
      effects: actualEffects({ outputBytes: 3 }),
    });
    const settlement = authorization.lease.settle({
      outcome: "succeeded",
      mutationUncertain: false,
      actual: actualEffects({ outputBytes: 3 }),
    });
    assert.equal(settlement.status, "succeeded");
    checkpoint = core.settleWorkflowStep({
      registry: validated,
      checkpoint: started,
      receipt,
      settlement,
      now: () => now,
    });
  }

  assert.equal(checkpoint.budgetUsage.outputBytes, 6);
  assert.equal(checkpoint.status, "uncertain");
  assert.equal(checkpoint.inFlight.sideEffect, "uncertain");
  assert.equal(checkpoint.attempts.at(-1).outcome, "uncertain");
});
