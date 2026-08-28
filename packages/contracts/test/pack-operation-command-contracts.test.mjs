import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

test("pack operation command contracts are closed and registry-addressable", () => {
  assert.equal(contracts.packOperationCommandInputSchema.id, "pack-operation-input");
  assert.equal(contracts.packOperationCommandOutputSchema.id, "pack-operation-output");
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["pack-operation-input"],
    contracts.packOperationCommandInputSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["pack-operation-output"],
    contracts.packOperationCommandOutputSchema,
  );
  assert.equal(
    contracts.packOperationCommandInputSchema.schema.additionalProperties,
    false,
  );
  assert.equal(
    contracts.packOperationCommandOutputSchema.schema.additionalProperties,
    false,
  );
  assert.deepEqual(contracts.PACK_OPERATION_COMMAND_IDS, {
    add: "pack.add",
    remove: "pack.remove",
    update: "pack.update",
  });
});

test("pack operation schemas expose only the bounded digest-bound surface", () => {
  assert.deepEqual(
    contracts.packOperationCommandInputSchema.schema.properties.operation.enum,
    ["add", "remove", "update"],
  );
  assert.deepEqual(
    contracts.packOperationCommandInputSchema.schema.required,
    ["schemaVersion", "operation", "packId", "planDigest"],
  );
  assert.equal(
    contracts.packOperationCommandInputSchema.schema.properties.planDigest
      .pattern,
    "^sha256:[0-9a-f]{64}$",
  );
  assert.deepEqual(
    contracts.packOperationCommandOutputSchema.schema.properties.status.enum,
    ["failed", "no-op", "recovery-required", "rolled-back", "succeeded"],
  );
  assert.deepEqual(
    contracts.packOperationCommandOutputSchema.schema.required,
    ["schemaVersion", "status", "planDigest"],
  );
  assert.equal(digest("a").length, 71);
});
