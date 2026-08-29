import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;

function scenario() {
  return {
    schemaVersion: "1.0.0",
    scenarioId: "scenario.graybox.core",
    version: "1.0.0",
    initialState: {
      sceneId: "scene.graybox.main",
      seed: "graybox-core-v1",
      resetProcedure: "reset.fresh-profile",
    },
    clock: {
      kind: "fixed-tick",
      rateHz: 60,
      warmupTicks: 30,
      maximumTicks: 720,
    },
    inputs: [
      {
        sequence: 0,
        tick: 30,
        device: "keyboard",
        action: "move.forward",
        phase: "pressed",
      },
      {
        sequence: 1,
        tick: 90,
        device: "keyboard",
        action: "move.forward",
        phase: "released",
      },
      {
        sequence: 2,
        tick: 100,
        device: "mouse",
        action: "camera.look",
        phase: "axis",
        value: ["0.250000", "0"],
      },
    ],
    checkpoints: [
      {
        oracleId: "oracle.graybox.initial",
        atTick: 30,
        assertions: [
          {
            path: "camera.active",
            operator: "eq",
            expected: { kind: "boolean", value: true },
          },
          { path: "player.position.x", operator: "exists" },
        ],
        stateHashFields: ["camera.active", "player.position.x"],
        onFailureArtifacts: ["artifact.runtime-log", "artifact.state-trace"],
      },
    ],
    terminal: [
      {
        oracleId: "oracle.graybox.win",
        withinTicks: { firstTick: 430, lastTick: 720 },
        assertions: [
          {
            path: "game.won",
            operator: "eq",
            expected: { kind: "boolean", value: true },
          },
          {
            path: "hud.collectible-count",
            operator: "eq",
            expected: { kind: "integer", value: "2" },
          },
        ],
        stateHashFields: ["game.won", "hud.collectible-count"],
        onFailureArtifacts: ["artifact.runtime-frame", "artifact.runtime-log"],
      },
    ],
    requiredArtifacts: [
      "artifact.input-replay",
      "artifact.runtime-frame",
      "artifact.runtime-log",
      "artifact.state-trace",
    ],
    budgets: {
      wallClockMs: 30000,
      outputBytes: 1048576,
      screenshots: 1,
      repairCycles: 0,
    },
  };
}

test("playtest scenario schema accepts a bounded engine-neutral definition", () => {
  const value = scenario();

  assert.equal(contracts.playtestScenarioSchema.id, "playtest-scenario");
  assert.equal(contracts.playtestScenarioSchema.version, "1.0.0");
  assert.deepEqual(contracts.checkPlaytestScenarioSemantics(value), []);
  assert.match(
    contracts.computePlaytestScenarioDigest(value),
    /^sha256:[0-9a-f]{64}$/,
  );
});

test("playtest scenario binding keeps reusable behavior separate from run identity", () => {
  const value = scenario();
  const binding = {
    schemaVersion: "1.0.0",
    bindingId: "binding.graybox.godot",
    scenarioDigest: contracts.computePlaytestScenarioDigest(value),
    featureContractDigest: digest,
    projectProfileDigest: `sha256:${"b".repeat(64)}`,
  };
  assert.equal(
    contracts.playtestScenarioBindingSchema.id,
    "playtest-scenario-binding",
  );
  assert.notEqual(
    contracts.computePlaytestScenarioBindingDigest(binding),
    contracts.digestCanonicalJson(binding),
  );
  assert.equal(Object.hasOwn(value, "projectProfileDigest"), false);
});

test("playtest scenario semantics reject reordered and duplicate input", () => {
  const reordered = scenario();
  reordered.inputs[1].sequence = 2;
  reordered.inputs[2].sequence = 1;
  reordered.inputs[2].tick = 20;

  const reorderedCodes = new Set(
    contracts
      .checkPlaytestScenarioSemantics(reordered)
      .map(({ code }) => code),
  );
  assert.equal(reorderedCodes.has("playtest-input-order-invalid"), true);
  assert.equal(reorderedCodes.has("playtest-input-tick-invalid"), true);

  const duplicate = scenario();
  duplicate.inputs.splice(1, 0, {
    ...structuredClone(duplicate.inputs[0]),
    sequence: 1,
  });
  duplicate.inputs[2].sequence = 2;
  duplicate.inputs[3].sequence = 3;
  assert.equal(
    contracts
      .checkPlaytestScenarioSemantics(duplicate)
      .some(({ code }) => code === "playtest-input-duplicate"),
    true,
  );
});

test("playtest scenario semantics reject ambiguous oracle timing and sets", () => {
  const invalid = scenario();
  invalid.terminal[0].withinTicks = { firstTick: 721, lastTick: 700 };
  invalid.terminal[0].oracleId = invalid.checkpoints[0].oracleId;
  invalid.terminal[0].stateHashFields.reverse();
  invalid.requiredArtifacts.reverse();

  const codes = new Set(
    contracts
      .checkPlaytestScenarioSemantics(invalid)
      .map(({ code }) => code),
  );
  assert.equal(codes.has("playtest-oracle-identity-collision"), true);
  assert.equal(codes.has("playtest-oracle-window-invalid"), true);
  assert.equal(codes.has("playtest-oracle-field-order-invalid"), true);
  assert.equal(codes.has("playtest-artifact-order-invalid"), true);
});

test("playtest scenario semantics reject duplicate assertions and zero tolerance", () => {
  const invalid = scenario();
  invalid.terminal[0].assertions.push({
    path: "hud.collectible-count",
    operator: "eq",
    expected: { kind: "integer", value: "2" },
  });
  invalid.terminal[0].assertions.push({
    path: "player.position.x",
    operator: "within",
    expected: { kind: "decimal", value: "4.000000" },
    tolerance: "0.000000",
  });
  invalid.terminal[0].stateHashFields = ["game.won"];
  invalid.checkpoints[0].assertions.reverse();

  const codes = new Set(
    contracts
      .checkPlaytestScenarioSemantics(invalid)
      .map(({ code }) => code),
  );
  assert.equal(codes.has("playtest-oracle-assertion-duplicate"), true);
  assert.equal(codes.has("playtest-oracle-assertion-order-invalid"), true);
  assert.equal(codes.has("playtest-oracle-tolerance-invalid"), true);
  assert.equal(codes.has("playtest-oracle-hash-coverage-invalid"), true);
});

test("playtest scenario digest is domain-separated and behavior-sensitive", () => {
  const value = scenario();
  const computed = contracts.computePlaytestScenarioDigest(value);

  assert.notEqual(computed, contracts.digestCanonicalJson(value));
  const changed = scenario();
  changed.inputs[2].value = ["0.500000", "0"];
  assert.notEqual(contracts.computePlaytestScenarioDigest(changed), computed);
});
