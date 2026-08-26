import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";
import { validPublicContractFixtures } from "./fixtures/public-contracts.mjs";

function schemaReference(schema) {
  return { schemaId: schema.schemaId, digest: schema.digest };
}

test("registered contract values are schema-bound, detached, and frozen", () => {
  assert.equal(typeof registry.validateRegisteredContractValue, "function");
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  const input = structuredClone(validPublicContractFixtures["feature-contract"]);
  const result = registry.validateRegisteredContractValue(
    validated,
    schemaReference(contracts.featureContractSchema),
    input,
  );

  input.playerOutcome = "changed after validation";
  assert.notEqual(result.playerOutcome, input.playerOutcome);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.scope), true);
  assert.throws(() => {
    result.playerOutcome = "mutation";
  }, TypeError);
});

test("registered contract validation rejects bypass, schema drift, and extra fields", () => {
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  const feature = structuredClone(validPublicContractFixtures["feature-contract"]);

  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        structuredClone(validated),
        schemaReference(contracts.featureContractSchema),
        feature,
      ),
    TypeError,
  );
  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        validated,
        {
          ...schemaReference(contracts.featureContractSchema),
          digest: `sha256:${"f".repeat(64)}`,
        },
        feature,
      ),
    (error) =>
      error?.name === "RegistryContractValueError" &&
      error?.code === "registered-schema-digest-mismatch",
  );
  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        validated,
        schemaReference(contracts.featureContractSchema),
        { ...feature, undeclared: true },
      ),
    (error) =>
      error?.name === "RegistryContractValueError" &&
      error?.code === "registered-value-invalid",
  );
});
