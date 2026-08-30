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
    saveSchemaVersion: "1.0.0",
    freshStateHash: contracts.sha256Digest("fresh graybox state"),
    persistedStateHash: contracts.sha256Digest("persisted graybox state"),
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    expectationDigest:
      contracts.computeGodotPersistenceCycleExpectationDigest(digestInput),
  };
}

function transcript() {
  const expected = expectation();
  const identity = {
    projectId: expected.projectId,
    sourceDigest: expected.sourceDigest,
  };
  const save = {
    saveDigest: contracts.sha256Digest("persisted save bytes"),
    saveBytes: 128,
  };
  const digestInput = {
    invocationDigest: contracts.GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
    expectationDigest: expected.expectationDigest,
    wire: {
      outputDigest: contracts.sha256Digest("persistence transcript"),
      bytes: 1_024,
      eventCount: contracts.GODOT_PERSISTENCE_CYCLE_MAX_EVENTS,
      lineEnding: "lf",
    },
    saveStarted: {
      event: "persistence-save-started",
      ...identity,
      freshStateHash: expected.freshStateHash,
    },
    saveCompleted: {
      event: "persistence-save-completed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
      userfsPersistent: true,
    },
    loadStarted: {
      event: "persistence-load-started",
      ...identity,
      freshStateHash: expected.freshStateHash,
      ...save,
      userfsPersistent: true,
    },
    loadCompleted: {
      event: "persistence-load-completed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
    },
    terminal: {
      event: "persistence-cycle-passed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
    },
  };
  return {
    schemaVersion: "1.0.0",
    ...digestInput,
    transcriptDigest:
      contracts.computeGodotPersistenceCycleTranscriptDigest(digestInput),
  };
}

test("Godot persistence cycle binds one exact two-process save/load identity", () => {
  const expected = expectation();
  const value = transcript();

  assert.equal(
    contracts.godotPersistenceCycleExpectationSchema.id,
    "godot-persistence-cycle-expectation",
  );
  assert.equal(
    contracts.godotPersistenceCycleTranscriptSchema.id,
    "godot-persistence-cycle-transcript",
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotPersistenceCycleExpectationSemantics(expected),
  );
  assert.doesNotThrow(() =>
    contracts.assertGodotPersistenceCycleTranscriptSemantics(value),
  );
});

test("Godot persistence cycle rejects save identity drift after digest recomputation", () => {
  const value = structuredClone(transcript());
  value.loadCompleted.saveDigest = contracts.sha256Digest("different save");
  const {
    schemaVersion: _schemaVersion,
    transcriptDigest: _transcriptDigest,
    ...digestInput
  } = value;
  value.transcriptDigest =
    contracts.computeGodotPersistenceCycleTranscriptDigest(digestInput);

  assert.throws(
    () => contracts.assertGodotPersistenceCycleTranscriptSemantics(value),
    TypeError,
  );
});

test("Godot persistence cycle rejects state drift and non-persistent user storage", () => {
  const stateDrift = structuredClone(transcript());
  stateDrift.terminal.stateHash = contracts.sha256Digest("other state");
  {
    const {
      schemaVersion: _schemaVersion,
      transcriptDigest: _transcriptDigest,
      ...digestInput
    } = stateDrift;
    stateDrift.transcriptDigest =
      contracts.computeGodotPersistenceCycleTranscriptDigest(digestInput);
  }
  assert.throws(
    () => contracts.assertGodotPersistenceCycleTranscriptSemantics(stateDrift),
    TypeError,
  );

  const volatile = structuredClone(transcript());
  volatile.loadStarted.userfsPersistent = false;
  {
    const {
      schemaVersion: _schemaVersion,
      transcriptDigest: _transcriptDigest,
      ...digestInput
    } = volatile;
    volatile.transcriptDigest =
      contracts.computeGodotPersistenceCycleTranscriptDigest(digestInput);
  }
  assert.throws(
    () => contracts.assertGodotPersistenceCycleTranscriptSemantics(volatile),
    TypeError,
  );
});

test("Godot persistence cycle rejects accessors without invoking them", () => {
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
    () => contracts.assertGodotPersistenceCycleTranscriptSemantics(value),
    TypeError,
  );
  assert.equal(invoked, false);
});
