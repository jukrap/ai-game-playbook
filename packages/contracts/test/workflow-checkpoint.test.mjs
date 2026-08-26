import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function checkpointBody() {
  return {
    schemaVersion: "1.0.0",
    checkpointId: "123e4567-e89b-42d3-a456-426614174000",
    sequence: 0,
    identity: {
      runId: "223e4567-e89b-42d3-a456-426614174000",
      projectId: "project.game",
      projectIdentityDigest: digest("a"),
      projectStage: "vertical-slice",
      featureId: "feature.collectible",
      featureContractDigest: digest("b"),
      registryDigest: digest("c"),
      workflow: {
        id: "workflow.verify-feature",
        version: "1.0.0",
        resolvedPlanDigest: digest("d"),
      },
      inputDigest: digest("e"),
    },
    status: "prepared",
    nextOrdinal: 0,
    attempts: [],
    budgetUsage: {
      durationMs: 0,
      outputBytes: 0,
      changedFiles: 0,
      changedBytes: 0,
      repairCycles: 0,
    },
    evidenceKinds: [],
    artifactDigests: [],
    createdAt: "2026-08-26T04:30:00.000Z",
    updatedAt: "2026-08-26T04:30:00.000Z",
    expiresAt: "2026-08-27T04:30:00.000Z",
  };
}

test("workflow checkpoints domain-bind immutable resumable state", () => {
  assert.equal(typeof contracts.computeWorkflowCheckpointDigest, "function");
  assert.equal(typeof contracts.checkWorkflowCheckpointSemantics, "function");

  const body = checkpointBody();
  const checkpoint = {
    ...body,
    checkpointDigest: contracts.computeWorkflowCheckpointDigest(body),
  };

  assert.equal(contracts.isWorkflowCheckpointDigestValid(checkpoint), true);
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(checkpoint), []);
  assert.notEqual(
    checkpoint.checkpointDigest,
    contracts.digestCanonicalJson(body),
  );
});

test("workflow checkpoint semantics reject broken chain, lifecycle, identity, and canonical state", () => {
  const body = checkpointBody();
  const checkpoint = {
    ...body,
    sequence: 1,
    status: "running",
    identity: {
      ...body.identity,
      featureContractDigest: undefined,
    },
    evidenceKinds: ["runtime-frame", "project-profile"],
    artifactDigests: [digest("f"), digest("a")],
    updatedAt: "2026-08-28T04:30:00.000Z",
    checkpointDigest: digest("0"),
  };

  assert.deepEqual(
    new Set(
      contracts
        .checkWorkflowCheckpointSemantics(checkpoint)
        .map(({ code }) => code),
    ),
    new Set([
      "workflow-checkpoint-digest-mismatch",
      "workflow-checkpoint-chain-invalid",
      "workflow-checkpoint-state-invalid",
      "workflow-checkpoint-identity-invalid",
      "workflow-checkpoint-canonical-invalid",
      "workflow-checkpoint-time-invalid",
    ]),
  );
});

test("uncertain effects remain attestable after the resume window expires", () => {
  const base = checkpointBody();
  const inFlight = {
    stepId: "step.inspect",
    ordinal: 0,
    attempt: 1,
    phase: "command",
    command: {
      id: "project.inspect",
      version: "1.0.0",
      descriptorDigest: digest("1"),
      handlerDigest: digest("2"),
      lane: "parallel-read",
      permissions: ["read-project"],
    },
    inputDigest: digest("3"),
    authorizationId: "323e4567-e89b-42d3-a456-426614174000",
    authorizationRequestDigest: digest("4"),
    authorizationExpiresAt: "2026-08-26T04:31:00.000Z",
    approvalIds: [],
    sideEffect: "uncertain",
  };
  const uncertainBody = {
    ...base,
    sequence: 1,
    status: "uncertain",
    inFlight,
    updatedAt: "2026-08-28T04:30:00.000Z",
    parentCheckpointDigest: digest("5"),
  };
  const uncertain = {
    ...uncertainBody,
    checkpointDigest:
      contracts.computeWorkflowCheckpointDigest(uncertainBody),
  };
  assert.deepEqual(contracts.checkWorkflowCheckpointSemantics(uncertain), []);

  const runningBody = {
    ...uncertainBody,
    status: "running",
    inFlight: { ...inFlight, sideEffect: "started" },
  };
  const running = {
    ...runningBody,
    checkpointDigest: contracts.computeWorkflowCheckpointDigest(runningBody),
  };
  assert.equal(
    contracts
      .checkWorkflowCheckpointSemantics(running)
      .some(({ code }) => code === "workflow-checkpoint-time-invalid"),
    true,
  );
});
