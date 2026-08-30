import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

function expectation() {
  const digestInput = {
    engine: "godot",
    targetVersion: contracts.GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus:
      contracts.GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    projectId: "golden.graybox.godot",
    sourceDigest: contracts.sha256Digest("graybox source"),
    mainScene: "scenes/main.tscn",
    validatorScript: contracts.GODOT_PROJECT_VALIDATOR_SCRIPT,
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    expectationDigest:
      contracts.computeGodotProjectValidationExpectationDigest(digestInput),
  };
}

function transcript(terminal = "passed") {
  const expected = expectation();
  const identity = {
    projectId: expected.projectId,
    sourceDigest: expected.sourceDigest,
    mainScene: expected.mainScene,
  };
  const digestInput = {
    invocationDigest: contracts.GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
    expectationDigest: expected.expectationDigest,
    wire: {
      outputDigest: contracts.sha256Digest("validation output"),
      bytes: 512,
      eventCount: 2,
      lineEnding: "lf",
    },
    started: {
      event: "validation-started",
      ...identity,
    },
    terminal:
      terminal === "passed"
        ? {
            event: "validation-passed",
            ...identity,
            resourceType: "PackedScene",
            rootType: "Node3D",
          }
        : {
            event: "validation-failed",
            ...identity,
            code: "main-scene-load-failed",
          },
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    transcriptDigest:
      contracts.computeGodotProjectValidationTranscriptDigest(digestInput),
  };
}

test("Godot project validation binds one exact import and validator identity", () => {
  const value = expectation();
  assert.equal(
    contracts.godotProjectValidationExpectationSchema.id,
    "godot-project-validation-expectation",
  );
  assert.equal(
    contracts.godotProjectValidationTranscriptSchema.id,
    "godot-project-validation-transcript",
  );
  assert.equal(
    contracts.GODOT_PROJECT_VALIDATOR_SCRIPT,
    "res://addons/ai_game_playbook/validators/project_validation.gd",
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotProjectValidationExpectationSemantics(value),
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotProjectValidationTranscriptSemantics(transcript()),
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotProjectValidationTranscriptSemantics(
      transcript("failed"),
    ),
  );
});

test("Godot project validation rejects identity drift even after digest recomputation", () => {
  const value = structuredClone(transcript());
  value.terminal.sourceDigest = contracts.sha256Digest("other source");
  const {
    schemaVersion: _schemaVersion,
    transcriptDigest: _transcriptDigest,
    ...digestInput
  } = value;
  value.transcriptDigest =
    contracts.computeGodotProjectValidationTranscriptDigest(digestInput);
  assert.throws(
    () => contracts.assertGodotProjectValidationTranscriptSemantics(value),
    TypeError,
  );

  const forgedExpectation = structuredClone(expectation());
  forgedExpectation.mainScene = "../outside.tscn";
  const {
    schemaVersion: _version,
    expectationDigest: _digest,
    ...forgedInput
  } = forgedExpectation;
  assert.throws(
    () =>
      contracts.computeGodotProjectValidationExpectationDigest(forgedInput),
    TypeError,
  );
});

test("Godot project validation enforces terminal shape and bounded wire evidence", () => {
  const wrongTerminal = structuredClone(transcript());
  wrongTerminal.terminal.code = "manifest-invalid";
  const {
    schemaVersion: _version,
    transcriptDigest: _digest,
    ...wrongTerminalInput
  } = wrongTerminal;
  wrongTerminal.transcriptDigest =
    contracts.computeGodotProjectValidationTranscriptDigest(
      wrongTerminalInput,
    );
  assert.throws(
    () =>
      contracts.assertGodotProjectValidationTranscriptSemantics(wrongTerminal),
    TypeError,
  );

  const wrongWire = structuredClone(transcript());
  wrongWire.wire.eventCount = 3;
  const {
    schemaVersion: _schemaVersion,
    transcriptDigest: _transcriptDigest,
    ...wrongWireInput
  } = wrongWire;
  wrongWire.transcriptDigest =
    contracts.computeGodotProjectValidationTranscriptDigest(wrongWireInput);
  assert.throws(
    () => contracts.assertGodotProjectValidationTranscriptSemantics(wrongWire),
    TypeError,
  );
});

test("Godot project validation rejects accessors without invoking them", () => {
  const value = transcript();
  let invoked = false;
  Object.defineProperty(value, "terminal", {
    enumerable: true,
    get() {
      invoked = true;
      return {};
    },
  });
  assert.throws(
    () => contracts.assertGodotProjectValidationTranscriptSemantics(value),
    TypeError,
  );
  assert.equal(invoked, false);
});
