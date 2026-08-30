import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as godot from "../dist/index.js";

function expectation() {
  return godot.createGodotPersistenceCycleExpectation({
    projectId: "golden.graybox.godot",
    sourceDigest: contracts.sha256Digest("graybox source"),
    freshStateHash: contracts.sha256Digest("fresh graybox state"),
    persistedStateHash: contracts.sha256Digest("persisted graybox state"),
  });
}

function events(expected) {
  const identity = {
    projectId: expected.projectId,
    sourceDigest: expected.sourceDigest,
  };
  const save = {
    saveDigest: contracts.sha256Digest("save bytes"),
    saveBytes: 128,
  };
  return [
    {
      event: "persistence-save-started",
      ...identity,
      freshStateHash: expected.freshStateHash,
    },
    {
      event: "persistence-save-completed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
      userfsPersistent: true,
    },
    {
      event: "persistence-load-started",
      ...identity,
      freshStateHash: expected.freshStateHash,
      ...save,
      userfsPersistent: true,
    },
    {
      event: "persistence-load-completed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
    },
    {
      event: "persistence-cycle-passed",
      ...identity,
      stateHash: expected.persistedStateHash,
      ...save,
    },
  ];
}

function output(expected, ending = "\n") {
  return events(expected)
    .map(
      (event) =>
        `${godot.GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX}${JSON.stringify(event)}${ending}`,
    )
    .join("");
}

test("Godot persistence parser accepts one ordered save/restart/load cycle", () => {
  const expected = expectation();
  const raw = output(expected);
  const parsed = godot.parseGodotPersistenceCycleOutput(raw, expected);

  assert.equal(parsed.status, "parsed");
  assert.equal(parsed.transcript.terminal.event, "persistence-cycle-passed");
  assert.equal(
    parsed.transcript.saveCompleted.saveDigest,
    parsed.transcript.loadCompleted.saveDigest,
  );
  assert.deepEqual(parsed.transcript.wire, {
    outputDigest: contracts.sha256Digest(raw),
    bytes: Buffer.byteLength(raw),
    eventCount: 5,
    lineEnding: "lf",
  });
  assert.equal(JSON.stringify(parsed).includes(raw), false);
});

test("Godot persistence parser rejects missing, reordered, duplicated, and drifted events", () => {
  const expected = expectation();
  const valid = events(expected);
  const candidates = [
    valid.slice(0, 4),
    [valid[1], valid[0], ...valid.slice(2)],
    [valid[0], valid[1], valid[1], valid[3], valid[4]],
    valid.map((event, index) =>
      index === 3
        ? { ...event, saveDigest: contracts.sha256Digest("different save") }
        : event,
    ),
  ];

  for (const candidate of candidates) {
    const raw = candidate
      .map(
        (event) =>
          `${godot.GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX}${JSON.stringify(event)}\n`,
      )
      .join("");
    assert.equal(
      godot.parseGodotPersistenceCycleOutput(raw, expected).status,
      "invalid",
    );
  }
});

test("Godot persistence parser rejects framing, JSON ambiguity, and volatile user storage", () => {
  const expected = expectation();
  const valid = output(expected);
  const duplicateKey = valid.replace(
    '"event":"persistence-save-started"',
    '"event":"persistence-save-started","event":"persistence-save-started"',
  );
  const volatile = events(expected);
  volatile[2] = { ...volatile[2], userfsPersistent: false };

  for (const candidate of [
    valid.slice(0, -1),
    valid.replace("\n", "\r\n"),
    duplicateKey,
    volatile
      .map(
        (event) =>
          `${godot.GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX}${JSON.stringify(event)}\n`,
      )
      .join(""),
  ]) {
    assert.equal(
      godot.parseGodotPersistenceCycleOutput(candidate, expected).status,
      "invalid",
    );
  }
});
