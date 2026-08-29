import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const scenarioDigest = contracts.sha256Digest("graybox scenario");

function passedTranscript() {
  const state = [
    { path: "game.won", value: true },
    { path: "hud.collectible-count", value: 2 },
  ];
  const digestInput = {
    invocationDigest:
      contracts.GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    expectationDigest: contracts.sha256Digest("graybox expectation"),
    wire: {
      outputDigest: contracts.sha256Digest("replay output"),
      bytes: 256,
      eventCount: 3,
      lineEnding: "lf",
    },
    started: {
      event: "replay-started",
      scenarioId: "scenario.graybox.core",
      scenarioDigest,
      seed: "graybox-core-v1",
    },
    oracles: [
      {
        event: "oracle-passed",
        oracleId: "oracle.graybox.win",
        terminal: true,
        tick: 431,
        state,
        stateHash:
          contracts.computeGodotDeterministicReplayStateHash(state),
      },
    ],
    terminal: {
      event: "replay-passed",
      tick: 431,
      scenarioDigest,
    },
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    transcriptDigest:
      contracts.computeGodotDeterministicReplayTranscriptDigest(digestInput),
  };
}

function failedTranscript() {
  const digestInput = {
    invocationDigest:
      contracts.GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    expectationDigest: contracts.sha256Digest("graybox expectation"),
    wire: {
      outputDigest: contracts.sha256Digest("failure output"),
      bytes: 128,
      eventCount: 2,
      lineEnding: "crlf",
    },
    started: {
      event: "replay-started",
      scenarioId: "scenario.graybox.core",
      scenarioDigest,
      seed: "graybox-core-v1",
    },
    oracles: [],
    terminal: {
      event: "replay-failed",
      code: "oracle-failed",
      tick: 30,
      scenarioDigest,
      oracleId: "oracle.graybox.initial",
    },
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    transcriptDigest:
      contracts.computeGodotDeterministicReplayTranscriptDigest(digestInput),
  };
}

test("Godot deterministic replay transcript binds invocation, state, and terminal outcome", () => {
  const value = passedTranscript();

  assert.equal(
    contracts.godotDeterministicReplayTranscriptSchema.id,
    "godot-deterministic-replay-transcript",
  );
  assert.equal(
    contracts.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
    "AGPB_GRAYBOX ",
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotDeterministicReplayTranscriptSemantics(value),
  );
  assert.notEqual(
    value.transcriptDigest,
    contracts.digestCanonicalJson({
      invocationDigest: value.invocationDigest,
      expectationDigest: value.expectationDigest,
      wire: value.wire,
      started: value.started,
      oracles: value.oracles,
      terminal: value.terminal,
    }),
  );
});

test("Godot deterministic replay transcript rejects forged state and relationship digests", () => {
  const forgedState = structuredClone(passedTranscript());
  forgedState.oracles[0].state[1].value = 1;
  assert.throws(
    () => contracts.assertGodotDeterministicReplayTranscriptSemantics(forgedState),
    TypeError,
  );

  const forgedScenario = structuredClone(passedTranscript());
  forgedScenario.terminal.scenarioDigest = contracts.sha256Digest("other");
  const {
    schemaVersion: _,
    transcriptDigest: __,
    ...forgedScenarioDigestInput
  } = forgedScenario;
  forgedScenario.transcriptDigest =
    contracts.computeGodotDeterministicReplayTranscriptDigest(
      forgedScenarioDigestInput,
    );
  assert.throws(
    () =>
      contracts.assertGodotDeterministicReplayTranscriptSemantics(
        forgedScenario,
      ),
    TypeError,
  );

  const duplicate = structuredClone(passedTranscript());
  duplicate.oracles.push(structuredClone(duplicate.oracles[0]));
  const {
    schemaVersion: ___,
    transcriptDigest: ____,
    ...duplicateDigestInput
  } = duplicate;
  duplicate.transcriptDigest =
    contracts.computeGodotDeterministicReplayTranscriptDigest(
      duplicateDigestInput,
    );
  assert.throws(
    () => contracts.assertGodotDeterministicReplayTranscriptSemantics(duplicate),
    TypeError,
  );

  const forgedWire = structuredClone(passedTranscript());
  forgedWire.wire.eventCount = 4;
  const {
    schemaVersion: _____,
    transcriptDigest: ______,
    ...forgedWireDigestInput
  } = forgedWire;
  forgedWire.transcriptDigest =
    contracts.computeGodotDeterministicReplayTranscriptDigest(
      forgedWireDigestInput,
    );
  assert.throws(
    () =>
      contracts.assertGodotDeterministicReplayTranscriptSemantics(forgedWire),
    TypeError,
  );
});

test("Godot deterministic replay failure details are code-specific", () => {
  const valid = failedTranscript();
  assert.doesNotThrow(() =>
    contracts.assertGodotDeterministicReplayTranscriptSemantics(valid),
  );

  const invalid = structuredClone(valid);
  delete invalid.terminal.oracleId;
  invalid.terminal.sequence = 0;
  const {
    schemaVersion: _,
    transcriptDigest: __,
    ...digestInput
  } = invalid;
  invalid.transcriptDigest =
    contracts.computeGodotDeterministicReplayTranscriptDigest(digestInput);
  assert.throws(
    () => contracts.assertGodotDeterministicReplayTranscriptSemantics(invalid),
    TypeError,
  );
});

test("Godot deterministic replay transcript rejects accessors without invoking them", () => {
  const value = passedTranscript();
  let invoked = false;
  Object.defineProperty(value, "oracles", {
    enumerable: true,
    get() {
      invoked = true;
      return [];
    },
  });

  assert.throws(
    () => contracts.assertGodotDeterministicReplayTranscriptSemantics(value),
    TypeError,
  );
  assert.equal(invoked, false);
});
