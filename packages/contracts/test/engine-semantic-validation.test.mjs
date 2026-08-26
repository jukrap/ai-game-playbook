import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;
const startedAt = "2026-08-26T01:02:03.000Z";
const endedAt = "2026-08-26T01:02:04.000Z";

const runHandle = {
  schemaVersion: "1.0.0",
  runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
  projectId: "sample.graybox",
  workflow: {
    id: "workflow.verify-feature",
    version: "1.0.0",
    resolvedPlanDigest: digest,
  },
  status: "running",
  createdAt: startedAt,
  updatedAt: endedAt,
  latestReceiptDigest: secondDigest,
  commands: {
    status: "run.status",
    cancel: "run.cancel",
    resume: "run.resume",
  },
};

const inputReplay = {
  schemaVersion: "1.0.0",
  scenarioId: "scenario.collectible-win",
  scenarioVersion: "1.0.0",
  runId: runHandle.runId,
  projectIdentityDigest: digest,
  sessionIdentityDigest: secondDigest,
  seed: "graybox-seed-1",
  tickRate: 60,
  initialStateDigest: digest,
  inputMappingDigest: secondDigest,
  events: [
    { tick: 1, action: "move.forward", value: "1.000000", durationTicks: 60 },
    { tick: 2, action: "jump", value: "1.000000", durationTicks: 1 },
    { tick: 61, action: "move.forward", value: "0.000000", durationTicks: 1 },
  ],
  terminalStateDigest: secondDigest,
  oracle: {
    id: "oracle.collectible-win",
    outcome: "passed",
    toleranceDigest: digest,
  },
  divergenceCount: 0,
  completedAt: endedAt,
};

test("engine lifecycle semantics accept ordered run and replay evidence", () => {
  assert.deepEqual(contracts.checkRunHandleSemantics(runHandle), []);
  assert.deepEqual(contracts.checkInputReplayTraceSemantics(inputReplay), []);
});

test("run handle semantics reject time, command, and checkpoint contradictions", () => {
  const invalid = structuredClone(runHandle);
  invalid.status = "waiting-approval";
  invalid.updatedAt = "2026-08-26T01:02:02.000Z";
  invalid.commands.resume = invalid.commands.cancel;

  const codes = new Set(
    contracts.checkRunHandleSemantics(invalid).map(({ code }) => code),
  );
  assert.equal(codes.has("run-handle-checkpoint-contradiction"), true);
  assert.equal(codes.has("run-handle-command-identity-collision"), true);
  assert.equal(codes.has("run-handle-timestamp-invalid"), true);
});

test("input replay semantics reject reordering, overlap, and oracle contradictions", () => {
  const invalid = structuredClone(inputReplay);
  invalid.events = [invalid.events[2], invalid.events[0], invalid.events[1]];
  invalid.events[0].tick = 60;
  invalid.divergenceCount = 1;

  const codes = new Set(
    contracts.checkInputReplayTraceSemantics(invalid).map(({ code }) => code),
  );
  assert.equal(codes.has("input-replay-event-order-invalid"), true);
  assert.equal(codes.has("input-replay-event-overlap"), true);
  assert.equal(codes.has("input-replay-oracle-contradiction"), true);
});
