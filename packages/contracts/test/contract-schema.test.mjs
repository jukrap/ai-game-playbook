import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const definition = {
  id: "command-descriptor",
  version: "1.0.0",
  title: "Command Descriptor",
  description: "A canonical command declaration.",
  schema: {
    type: "object",
    properties: {
      schemaVersion: { type: "string" },
      id: { type: "string" },
    },
    required: ["schemaVersion", "id"],
    additionalProperties: false,
  },
};

test("contract schemas receive deterministic versioned identity and digest", () => {
  assert.equal(typeof contracts.defineContractSchema, "function");

  const first = contracts.defineContractSchema(definition);
  const second = contracts.defineContractSchema({
    ...definition,
    schema: {
      required: ["schemaVersion", "id"],
      properties: {
        id: { type: "string" },
        schemaVersion: { type: "string" },
      },
      additionalProperties: false,
      type: "object",
    },
  });

  assert.equal(first.id, "command-descriptor");
  assert.equal(first.version, "1.0.0");
  assert.equal(
    first.schemaId,
    "urn:ai-game-playbook:schema:command-descriptor:1.0.0",
  );
  assert.equal(
    first.schema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.equal(first.schema.$id, first.schemaId);
  assert.equal(first.schema.title, definition.title);
  assert.equal(first.schema.description, definition.description);
  assert.deepEqual(first.schema.properties.schemaVersion, {
    type: "string",
    const: "1.0.0",
  });
  assert.equal(first.digest, second.digest);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
});

test("contract schema definitions reject ambiguous or unsafe roots", () => {
  for (const [input, path] of [
    [{ ...definition, id: "Command" }, "$definition.id"],
    [{ ...definition, version: "1" }, "$definition.version"],
    [{ ...definition, title: "" }, "$definition.title"],
    [{ ...definition, hidden: true }, '$definition["hidden"]'],
    [
      {
        ...definition,
        schema: { ...definition.schema, $id: "https://example.invalid" },
      },
      '$definition.schema["$id"]',
    ],
    [
      {
        ...definition,
        schema: { ...definition.schema, additionalProperties: true },
      },
      '$definition.schema["additionalProperties"]',
    ],
    [
      { ...definition, schema: { ...definition.schema, type: "array" } },
      '$definition.schema["type"]',
    ],
    [
      {
        ...definition,
        schema: {
          ...definition.schema,
          properties: { id: { type: "string" } },
        },
      },
      '$definition.schema["properties"]["schemaVersion"]',
    ],
    [
      {
        ...definition,
        schema: {
          ...definition.schema,
          required: ["id"],
        },
      },
      '$definition.schema["required"]',
    ],
  ]) {
    assert.throws(
      () => contracts.defineContractSchema(input),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-contract-schema" &&
        error?.path === path,
    );
  }
});

test("contract schema definitions are detached from mutable authoring input", () => {
  const mutableDefinition = structuredClone(definition);
  const contractSchema = contracts.defineContractSchema(mutableDefinition);

  mutableDefinition.schema.properties.id.type = "number";

  assert.deepEqual(contractSchema.schema.properties.id, { type: "string" });
  assert.throws(() => {
    contractSchema.schema.properties.id.type = "number";
  }, TypeError);
});
