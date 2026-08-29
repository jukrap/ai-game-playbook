import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as registry from "../dist/index.js";

const scenarioUrl = new URL(
  "../../../golden/graybox/scenario.json",
  import.meta.url,
);

async function loadScenario() {
  return JSON.parse(await readFile(scenarioUrl, "utf8"));
}

test("canonical graybox scenario is schema-valid and semantically deterministic", async () => {
  const scenario = await loadScenario();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv, { mode: "full" });
  const validate = ajv.compile(contracts.playtestScenarioSchema.schema);

  assert.equal(validate(scenario), true, JSON.stringify(validate.errors));
  assert.deepEqual(contracts.checkPlaytestScenarioSemantics(scenario), []);
  assert.equal(
    contracts.computePlaytestScenarioDigest(scenario),
    "sha256:4bce945905093f746939b6b8f1c6183d0795f2f74b533763970aeed5be4e6c0f",
  );
});

test("the builtin registry binds both graybox scenario schemas", async () => {
  const scenario = await loadScenario();
  const registeredSchemas = new Map(
    registry.BUILTIN_REGISTRY.schemas.map(({ schemaId, digest }) => [
      schemaId,
      digest,
    ]),
  );

  assert.equal(
    registeredSchemas.get(contracts.playtestScenarioSchema.schemaId),
    contracts.playtestScenarioSchema.digest,
  );
  assert.equal(
    registeredSchemas.get(contracts.playtestScenarioBindingSchema.schemaId),
    contracts.playtestScenarioBindingSchema.digest,
  );
  assert.equal(
    registeredSchemas.get(
      contracts.godotDeterministicReplayTranscriptSchema.schemaId,
    ),
    contracts.godotDeterministicReplayTranscriptSchema.digest,
  );
  assert.deepEqual(
    registry.validateRegisteredContractValue(
      registry.BUILTIN_REGISTRY,
      {
        schemaId: contracts.playtestScenarioSchema.schemaId,
        digest: contracts.playtestScenarioSchema.digest,
      },
      scenario,
    ),
    scenario,
  );
});

test("canonical graybox scenario fixes the cross-engine core behavior surface", async () => {
  const scenario = await loadScenario();

  assert.equal(Object.hasOwn(scenario, "engine"), false);
  assert.equal(Object.hasOwn(scenario, "featureContractDigest"), false);
  assert.equal(Object.hasOwn(scenario, "projectProfileDigest"), false);
  assert.deepEqual(
    scenario.checkpoints.map(({ oracleId }) => oracleId),
    [
      "oracle.graybox.initial",
      "oracle.graybox.movement-camera",
      "oracle.graybox.collision",
      "oracle.graybox.first-collectible",
    ],
  );
  assert.deepEqual(
    scenario.terminal.map(({ oracleId }) => oracleId),
    ["oracle.graybox.win"],
  );
  assert.deepEqual(scenario.requiredArtifacts, [
    "artifact.input-replay",
    "artifact.runtime-frame",
    "artifact.runtime-log",
    "artifact.state-trace",
  ]);
});

test("canonical graybox digest changes when required behavior is weakened", async () => {
  const scenario = await loadScenario();
  const weakened = structuredClone(scenario);
  weakened.terminal[0].assertions = weakened.terminal[0].assertions.filter(
    ({ path }) => path !== "game.won",
  );

  assert.notEqual(
    contracts.computePlaytestScenarioDigest(weakened),
    contracts.computePlaytestScenarioDigest(scenario),
  );
});
