import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

function expectDiagnostic(definition, code) {
  assert.throws(
    () => registry.validateRegistry(definition),
    (error) =>
      error?.name === "RegistryValidationError" &&
      error?.diagnostics?.some((diagnostic) => diagnostic.code === code),
    `expected ${code}`,
  );
}

test("valid registries are sorted, immutable, and deterministically attested", () => {
  assert.equal(typeof registry.validateRegistry, "function");

  const firstInput = createValidRegistryDefinition();
  const secondInput = createValidRegistryDefinition();
  secondInput.commands.reverse();
  secondInput.schemas.reverse();

  const first = registry.validateRegistry(firstInput);
  const second = registry.validateRegistry(secondInput);

  assert.deepEqual(
    first.commands.map(({ id }) => id),
    ["engine.rollback", "internal.health", "project.inspect", "verify"],
  );
  assert.equal(first.digest, second.digest);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => first.commands.reverse(), TypeError);

  firstInput.commands[0].summary = "mutated after validation";
  assert.notEqual(
    first.commands.find(({ id }) => id === "project.inspect").summary,
    "mutated after validation",
  );
});

test("registry validation reports descriptor schema failures with bounded paths", () => {
  const definition = createValidRegistryDefinition();
  definition.commands[0].timeoutMs = 0;

  expectDiagnostic(definition, "descriptor-schema-invalid");
});

test("registry input budgets fail before deeply nested values reach schema compilation", () => {
  let nested = { value: true };
  for (let depth = 0; depth < 140; depth += 1) {
    nested = { nested };
  }

  expectDiagnostic(nested, "registry-input-invalid");
});

test("unsafe schemas are rejected before validator compilation", () => {
  const oversizedDefinition = createValidRegistryDefinition();
  oversizedDefinition.schemas.push(
    contracts.defineContractSchema({
      id: "oversized-pattern-input",
      version: "1.0.0",
      title: "Oversized Pattern Input",
      schema: {
        type: "object",
        properties: {
          schemaVersion: { type: "string" },
          value: { type: "string", pattern: "(".repeat(513) },
        },
        required: ["schemaVersion", "value"],
        additionalProperties: false,
      },
    }),
  );

  assert.throws(
    () => registry.validateRegistry(oversizedDefinition),
    (error) => {
      const codes = error?.diagnostics?.map(({ code }) => code);
      return (
        error?.name === "RegistryValidationError" &&
        codes?.includes("schema-complexity-exceeded") &&
        !codes?.includes("schema-attestation-invalid")
      );
    },
  );

  const nestedQuantifierDefinition = createValidRegistryDefinition();
  nestedQuantifierDefinition.schemas.push(
    contracts.defineContractSchema({
      id: "nested-quantifier-input",
      version: "1.0.0",
      title: "Nested Quantifier Input",
      schema: {
        type: "object",
        properties: {
          schemaVersion: { type: "string" },
          value: { type: "string", pattern: "^(a+)+$", maxLength: 64 },
        },
        required: ["schemaVersion", "value"],
        additionalProperties: false,
      },
    }),
  );
  expectDiagnostic(nestedQuantifierDefinition, "schema-complexity-exceeded");
});

test("registry diagnostics and normalization never depend on localeCompare", () => {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error("localeCompare must not be called");
  };

  try {
    const definition = createValidRegistryDefinition();
    definition.commands.reverse();
    const validated = registry.validateRegistry(definition);
    assert.deepEqual(
      validated.commands.map(({ id }) => id),
      ["engine.rollback", "internal.health", "project.inspect", "verify"],
    );

    const error = new registry.RegistryValidationError([
      { code: "duplicate-id", path: "$.z", message: "z" },
      { code: "duplicate-id", path: "$.a", message: "a" },
    ]);
    assert.deepEqual(
      error.diagnostics.map(({ path }) => path),
      ["$.a", "$.z"],
    );

    const routingError = new registry.TaskRoutingSelectionError([
      { code: "routing-skill-missing", path: "$.z", message: "z" },
      { code: "routing-skill-missing", path: "$.a", message: "a" },
    ]);
    assert.deepEqual(
      routingError.diagnostics.map(({ path }) => path),
      ["$.a", "$.z"],
    );
  } finally {
    String.prototype.localeCompare = original;
  }
});

test("registry validation rejects duplicate IDs and CLI path collisions", () => {
  const duplicate = createValidRegistryDefinition();
  duplicate.commands.push(structuredClone(duplicate.commands[0]));
  expectDiagnostic(duplicate, "duplicate-id");

  const aliasCollision = createValidRegistryDefinition();
  aliasCollision.commands[1].cli.aliases = [["inspect"]];
  expectDiagnostic(aliasCollision, "cli-path-collision");
});

test("registry validation enforces command authority, lane, and retry invariants", () => {
  const missingPermission = createValidRegistryDefinition();
  missingPermission.commands[2].permissions = [];
  expectDiagnostic(missingPermission, "side-effect-without-permission");

  const wrongLane = createValidRegistryDefinition();
  wrongLane.commands[2].permissions = ["write-project-source"];
  expectDiagnostic(wrongLane, "lane-permission-mismatch");

  const unsafeRetry = createValidRegistryDefinition();
  unsafeRetry.commands[2].retry = {
    mode: "read-only",
    maxAttempts: 2,
    backoffMs: [10],
  };
  expectDiagnostic(unsafeRetry, "unsafe-retry-policy");

  const invalidNeverRetry = createValidRegistryDefinition();
  invalidNeverRetry.commands[0].retry = { mode: "never", maxAttempts: 2 };
  expectDiagnostic(invalidNeverRetry, "invalid-retry-attempts");
});

test("network effect boundaries remain independent from project serialization lanes", () => {
  const definition = createValidRegistryDefinition();
  definition.commands.push({
    ...structuredClone(definition.commands[0]),
    id: "network.lookup",
    cli: { path: ["network", "lookup"], aliases: [] },
    permissions: ["read-project", "network"],
    sideEffects: [
      { kind: "network", scope: "declared-endpoint", boundary: "network" },
    ],
    lane: "parallel-read",
    retry: { mode: "never", maxAttempts: 1 },
    handler: {
      ...definition.commands[0].handler,
      export: "lookupNetworkMetadata",
    },
  });

  const validated = registry.validateRegistry(definition);
  assert.equal(validated.commands.some(({ id }) => id === "network.lookup"), true);
});

test("registry validation binds every schema reference to an exact digest", () => {
  const missing = createValidRegistryDefinition();
  missing.commands[0].input.schemaId =
    "urn:ai-game-playbook:schema:missing-input:1.0.0";
  expectDiagnostic(missing, "schema-reference-missing");

  const wrongDigest = createValidRegistryDefinition();
  wrongDigest.commands[0].input.digest = `sha256:${"f".repeat(64)}`;
  expectDiagnostic(wrongDigest, "schema-digest-mismatch");

  const tamperedSchema = createValidRegistryDefinition();
  tamperedSchema.schemas[0] = {
    ...tamperedSchema.schemas[0],
    digest: `sha256:${"f".repeat(64)}`,
  };
  expectDiagnostic(tamperedSchema, "schema-attestation-invalid");
});

test("registry validation rejects external schema references", () => {
  const definition = createValidRegistryDefinition();
  const external = contracts.defineContractSchema({
    id: "external-ref-input",
    version: "1.0.0",
    title: "External Ref Input",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string" },
        value: { $ref: "https://example.invalid/value.schema.json" },
      },
      required: ["schemaVersion"],
      additionalProperties: false,
    },
  });
  definition.schemas.push(external);

  expectDiagnostic(definition, "external-schema-reference");
});

test("registry validation rejects nested schema identities and hidden attestation fields", () => {
  const nestedIdentity = createValidRegistryDefinition();
  nestedIdentity.schemas.push(
    contracts.defineContractSchema({
      id: "nested-identity-input",
      version: "1.0.0",
      title: "Nested Identity Input",
      schema: {
        type: "object",
        properties: {
          schemaVersion: { type: "string" },
          value: {
            $id: "urn:ai-game-playbook:schema:nested-resource:1.0.0",
            type: "string",
          },
        },
        required: ["schemaVersion"],
        additionalProperties: false,
      },
    }),
  );
  expectDiagnostic(nestedIdentity, "schema-attestation-invalid");

  const hiddenField = createValidRegistryDefinition();
  hiddenField.schemas[0] = {
    ...hiddenField.schemas[0],
    hidden: true,
  };
  expectDiagnostic(hiddenField, "schema-attestation-invalid");
});

test("registry validation requires finite resolvable workflow DAGs", () => {
  const missingCommand = createValidRegistryDefinition();
  missingCommand.workflows[0].steps[0].commandId = "missing.command";
  expectDiagnostic(missingCommand, "workflow-command-missing");

  const missingDependency = createValidRegistryDefinition();
  missingDependency.workflows[0].steps[0].dependsOn = ["step.missing"];
  expectDiagnostic(missingDependency, "workflow-dependency-missing");

  const cycle = createValidRegistryDefinition();
  cycle.workflows[0].steps[0].dependsOn = ["step.verify"];
  expectDiagnostic(cycle, "workflow-cycle");

  const missingRollback = createValidRegistryDefinition();
  missingRollback.workflows[0].steps[1].rollbackCommandId = "missing.rollback";
  expectDiagnostic(missingRollback, "workflow-rollback-command-missing");
});
