import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as godot from "../dist/index.js";

const scenarioUrl = new URL(
  "../../../golden/graybox/scenario.json",
  import.meta.url,
);

async function scenario() {
  return JSON.parse(await readFile(scenarioUrl, "utf8"));
}

function stateFor(oracle) {
  return oracle.stateHashFields.map((path, index) => ({
    path,
    value: index,
  }));
}

function line(event) {
  return `${godot.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX}${JSON.stringify(event)}\n`;
}

function passedOutput(value) {
  const oracles = [...value.checkpoints, ...value.terminal];
  const events = [
    {
      event: "replay-started",
      scenarioId: value.scenarioId,
      scenarioDigest: contracts.computePlaytestScenarioDigest(value),
      seed: value.initialState.seed,
    },
    ...oracles.map((oracle) => {
      const state = stateFor(oracle);
      return {
        event: "oracle-passed",
        oracleId: oracle.oracleId,
        terminal: value.terminal.includes(oracle),
        tick: oracle.atTick ?? oracle.withinTicks.firstTick,
        state,
        stateHash:
          contracts.computeGodotDeterministicReplayStateHash(state),
      };
    }),
  ];
  const terminalTick = events.at(-1).tick;
  events.push({
    event: "replay-passed",
    tick: terminalTick,
    scenarioDigest: contracts.computePlaytestScenarioDigest(value),
  });
  return events.map(line).join("");
}

function failedOutput(value) {
  const scenarioDigest = contracts.computePlaytestScenarioDigest(value);
  return [
    line({
      event: "replay-started",
      scenarioId: value.scenarioId,
      scenarioDigest,
      seed: value.initialState.seed,
    }),
    line({
      event: "replay-failed",
      code: "oracle-failed",
      tick: value.checkpoints[0].atTick,
      scenarioDigest,
      oracleId: value.checkpoints[0].oracleId,
    }),
  ].join("");
}

function startedEvent(value) {
  return {
    event: "replay-started",
    scenarioId: value.scenarioId,
    scenarioDigest: contracts.computePlaytestScenarioDigest(value),
    seed: value.initialState.seed,
  };
}

function passedOracleEvent(value, oracle, terminal, tick) {
  const state = stateFor(oracle);
  return {
    event: "oracle-passed",
    oracleId: oracle.oracleId,
    terminal,
    tick,
    state,
    stateHash: contracts.computeGodotDeterministicReplayStateHash(state),
  };
}

function replayOutput(value, events, terminal) {
  return [startedEvent(value), ...events, terminal].map(line).join("");
}

function processIdentity() {
  const body = {
    pid: 4242,
    spawnedAt: "2026-08-29T02:00:00.001Z",
    processToken: "123e4567-e89b-42d3-a456-426614174200",
    executableDigest: contracts.sha256Digest("godot executable"),
    rootIdentityDigest: contracts.sha256Digest("staged project"),
  };
  return { ...body, identityDigest: contracts.digestCanonicalJson(body) };
}

function processResult({
  outcome = "exited",
  exitCode = 0,
  signal = null,
  stdout = "",
  stderr = "",
  stopReason,
  outputTruncated = outcome === "output-limit",
} = {}) {
  const spawned = outcome !== "spawn-failed";
  const stopped = outcome !== "exited" && outcome !== "spawn-failed";
  const uncertain = outcome === "termination-uncertain";
  const reason =
    stopReason ?? (uncertain ? "timed-out" : stopped ? outcome : undefined);
  const stdoutBytes = Buffer.byteLength(stdout);
  const stderrBytes = Buffer.byteLength(stderr);
  const capturedBytes = stdoutBytes + stderrBytes;
  return {
    outcome,
    ...(spawned ? { identity: processIdentity() } : {}),
    startedAt: "2026-08-29T02:00:00.000Z",
    endedAt: "2026-08-29T02:00:00.010Z",
    durationMs: 10,
    exitCode,
    signal,
    ...(spawned ? {} : { spawnErrorCode: "ENOENT" }),
    output: {
      stdout,
      stderr,
      stdoutDigest: contracts.sha256Digest(stdout),
      stderrDigest: contracts.sha256Digest(stderr),
      stdoutObservedBytes: stdoutBytes,
      stderrObservedBytes: stderrBytes,
      capturedBytes,
      observedBytes: capturedBytes,
      truncated: outputTruncated,
    },
    termination: {
      requested: stopped,
      ...(reason === undefined ? {} : { reason }),
      escalated: stopped,
      confirmed: !uncertain,
    },
    mutationUncertain: stopped,
  };
}

test("Godot replay parser accepts one complete scenario-bound transcript", async () => {
  const value = await scenario();
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const output = passedOutput(value);
  const parsed = godot.parseGodotDeterministicReplayOutput(
    output,
    expectation,
  );

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.transcript.terminal.event, "replay-passed");
  assert.equal(
    parsed.transcript.oracles.length,
    value.checkpoints.length + value.terminal.length,
  );
  assert.equal(
    parsed.transcript.started.scenarioDigest,
    contracts.computePlaytestScenarioDigest(value),
  );
  assert.deepEqual(parsed.transcript.wire, {
    outputDigest: contracts.sha256Digest(output),
    bytes: Buffer.byteLength(output),
    eventCount: value.checkpoints.length + value.terminal.length + 2,
    lineEnding: "lf",
  });
  assert.equal(
    parsed.transcript.expectationDigest,
    expectation.expectationDigest,
  );
  assert.equal(Object.isFrozen(expectation), true);
  assert.equal(Object.isFrozen(parsed.transcript), true);
  assert.equal(JSON.stringify(parsed).includes(output), false);
});

test("Godot replay parser rejects framing, undeclared output, and incomplete success", async () => {
  const value = await scenario();
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const valid = passedOutput(value);
  const events = valid.trimEnd().split("\n");

  const crlf = godot.parseGodotDeterministicReplayOutput(
    valid.replaceAll("\n", "\r\n"),
    expectation,
  );
  assert.equal(crlf.status, "parsed");
  assert.equal(crlf.transcript.wire.lineEnding, "crlf");

  for (const [output, code] of [
    [valid.slice(0, -1), "godot-replay-output-framing-invalid"],
    [`engine diagnostic\n${valid}`, "godot-replay-output-prefix-invalid"],
    [
      `${events[0]}\n${events.at(-1)}\n`,
      "godot-replay-output-oracle-set-invalid",
    ],
    ["", "godot-replay-output-framing-invalid"],
    [
      valid.replace("\n", "\r\n"),
      "godot-replay-output-framing-invalid",
    ],
    [
      `${"x".repeat(contracts.GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES + 1)}\n`,
      "godot-replay-output-line-limit",
    ],
    [
      `${`${godot.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX}{}\n`.repeat(
        contracts.GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS + 1,
      )}`,
      "godot-replay-output-line-limit",
    ],
    [
      "x".repeat(expectation.maximumOutputBytes + 1),
      "godot-replay-output-byte-limit",
    ],
  ]) {
    assert.deepEqual(
      godot.parseGodotDeterministicReplayOutput(output, expectation),
      { status: "invalid", code },
    );
  }

  const duplicateKey =
    `${godot.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX}` +
    `{"event":"replay-started","event":"replay-started",` +
    `"scenarioId":"${value.scenarioId}",` +
    `"scenarioDigest":"${contracts.computePlaytestScenarioDigest(value)}",` +
    `"seed":"${value.initialState.seed}"}\n`;
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(duplicateKey, expectation),
    { status: "invalid", code: "godot-replay-output-json-invalid" },
  );
});

test("Godot replay parser requires the exact failure history", async () => {
  const value = await scenario();
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const scenarioDigest = contracts.computePlaytestScenarioDigest(value);
  const initial = value.checkpoints[0];
  const movement = value.checkpoints[1];
  const initialPassed = passedOracleEvent(value, initial, false, 30);

  const inputMissed = {
    event: "replay-failed",
    code: "input-missed",
    tick: 31,
    scenarioDigest,
    sequence: 0,
  };
  assert.equal(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [initialPassed], inputMissed),
      expectation,
    ).status,
    "parsed",
  );
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [], inputMissed),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-terminal-invalid" },
  );
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [initialPassed], { ...inputMissed, tick: 32 }),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-terminal-invalid" },
  );

  const windowExpired = {
    event: "replay-failed",
    code: "oracle-window-expired",
    tick: movement.withinTicks.lastTick,
    scenarioDigest,
    oracleId: movement.oracleId,
  };
  assert.equal(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [initialPassed], windowExpired),
      expectation,
    ).status,
    "parsed",
  );
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [], windowExpired),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-terminal-invalid" },
  );

  const maximumReached = {
    event: "replay-failed",
    code: "maximum-ticks-reached",
    tick: value.clock.maximumTicks,
    scenarioDigest,
  };
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(value, [], maximumReached),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-terminal-invalid" },
  );

  const checkpointScenario = structuredClone(value);
  checkpointScenario.checkpoints = [structuredClone(initial)];
  delete checkpointScenario.checkpoints[0].atTick;
  checkpointScenario.checkpoints[0].withinTicks = {
    firstTick: 500,
    lastTick: 600,
  };
  const checkpointExpectation =
    godot.createGodotDeterministicReplayExpectation(checkpointScenario);
  const terminalOracle = checkpointScenario.terminal[0];
  const terminalPassed = passedOracleEvent(
    checkpointScenario,
    terminalOracle,
    true,
    terminalOracle.withinTicks.firstTick,
  );
  const checkpointIncomplete = {
    event: "replay-failed",
    code: "checkpoint-incomplete",
    tick: terminalPassed.tick,
    scenarioDigest: contracts.computePlaytestScenarioDigest(checkpointScenario),
  };
  assert.equal(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(
        checkpointScenario,
        [terminalPassed],
        checkpointIncomplete,
      ),
      checkpointExpectation,
    ).status,
    "parsed",
  );
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      replayOutput(checkpointScenario, [terminalPassed], {
        ...checkpointIncomplete,
        tick: checkpointIncomplete.tick + 1,
      }),
      checkpointExpectation,
    ),
    { status: "invalid", code: "godot-replay-output-terminal-invalid" },
  );
});

test("Godot replay parser preserves engine order for same-tick oracles", async () => {
  const value = await scenario();
  value.checkpoints[1].withinTicks.firstTick = value.checkpoints[0].atTick;
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const lines = passedOutput(value).trimEnd().split("\n");
  [lines[1], lines[2]] = [lines[2], lines[1]];

  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(`${lines.join("\n")}\n`, expectation),
    {
      status: "invalid",
      code: "godot-replay-output-event-sequence-invalid",
    },
  );
});

test("Godot replay parser verifies oracle timing, fields, and state hashes", async () => {
  const value = await scenario();
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const events = passedOutput(value)
    .trimEnd()
    .split("\n")
    .map((entry) =>
      JSON.parse(
        entry.slice(godot.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX.length),
      ),
    );

  const badHash = structuredClone(events);
  badHash[1].stateHash = contracts.sha256Digest("forged state");
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      badHash.map(line).join(""),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-state-hash-invalid" },
  );

  const badField = structuredClone(events);
  badField[1].state[0].path = "game.undeclared";
  badField[1].stateHash =
    contracts.computeGodotDeterministicReplayStateHash(badField[1].state);
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      badField.map(line).join(""),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-oracle-state-invalid" },
  );

  const badTick = structuredClone(events);
  badTick[1].tick += 1;
  assert.deepEqual(
    godot.parseGodotDeterministicReplayOutput(
      badTick.map(line).join(""),
      expectation,
    ),
    { status: "invalid", code: "godot-replay-output-oracle-timing-invalid" },
  );
});

test("Godot replay classification binds protocol outcome to process exit", async () => {
  const value = await scenario();
  const expectation =
    godot.createGodotDeterministicReplayExpectation(value);
  const passed = passedOutput(value);
  const failed = failedOutput(value);

  const success = godot.classifyGodotDeterministicReplayResult(
    processResult({ stdout: passed }),
    expectation,
  );
  assert.equal(success.status, "replay-passed");
  assert.equal(success.code, "godot-replay-passed");
  assert.equal(success.process.code, "process.exited-zero");
  assert.equal("stdout" in success.output, false);

  const behaviorFailure = godot.classifyGodotDeterministicReplayResult(
    processResult({ exitCode: 2, stdout: failed }),
    expectation,
  );
  assert.equal(behaviorFailure.status, "replay-failed");
  assert.equal(behaviorFailure.code, "godot-replay-oracle-failed");

  for (const result of [
    processResult({ stdout: "" }),
    processResult({ exitCode: 2, stdout: passed }),
    processResult({ stdout: passed, stderr: "diagnostic" }),
  ]) {
    assert.equal(
      godot.classifyGodotDeterministicReplayResult(result, expectation).status,
      "invalid-output",
    );
  }

  const processFailure = godot.classifyGodotDeterministicReplayResult(
    processResult({ exitCode: 7, stdout: failed }),
    expectation,
  );
  assert.equal(processFailure.status, "process-failed");
  assert.equal(processFailure.code, "process.exit-nonzero");

  const timedOutWithFailureExit =
    godot.classifyGodotDeterministicReplayResult(
      processResult({
        outcome: "timed-out",
        exitCode: 2,
        stdout: failed,
      }),
      expectation,
    );
  assert.equal(timedOutWithFailureExit.status, "process-failed");
  assert.equal(timedOutWithFailureExit.code, "process.timed-out");

  const cancelled = godot.classifyGodotDeterministicReplayResult(
    processResult({
      outcome: "cancelled",
      exitCode: null,
      signal: "SIGTERM",
      stdout: failed,
      stopReason: "cancelled",
    }),
    expectation,
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.code, "process.cancelled");
});

test("Godot replay expectation rejects unregistered shape before reading accessors", async () => {
  const value = await scenario();
  let invoked = false;
  Object.defineProperty(value, "checkpoints", {
    enumerable: true,
    get() {
      invoked = true;
      return [];
    },
  });

  assert.throws(
    () => godot.createGodotDeterministicReplayExpectation(value),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-replay-scenario-invalid",
  );
  assert.equal(invoked, false);
});
