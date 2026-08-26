import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";
import { validPublicContractFixtures } from "./fixtures/public-contracts.mjs";

function expectDiagnostic(definition, code) {
  assert.throws(
    () => registry.validateRegistry(definition),
    (error) =>
      error?.name === "RegistryValidationError" &&
      error?.diagnostics?.some((diagnostic) => diagnostic.code === code),
    `expected ${code}`,
  );
}

function createPack(id, version, dependencies = []) {
  const pack = structuredClone(validPublicContractFixtures["pack-manifest"]);
  pack.id = id;
  pack.version = version;
  pack.compatibility.controlPlane = {
    minimum: "0.0.0",
    maximumExclusive: "1.0.0",
  };
  pack.provides = {
    commands: [],
    skills: [],
    workflows: [],
    capabilities: [],
    schemas: [],
  };
  pack.dependencies = dependencies;
  pack.lifecycleHooks = {};
  const directory = id.replaceAll(".", "-");
  pack.artifacts[0].target =
    `.ai-game-playbook/packs/${directory}/index.js`;
  pack.ownedPaths[0].path = pack.artifacts[0].target;
  pack.digest = contracts.computePackManifestDigest(pack);
  return pack;
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

test("pack dependency graphs are versioned, sorted, and deterministically attested", () => {
  const definition = createValidRegistryDefinition();
  definition.packs.push(
    createPack("feature.gameplay", "1.1.0", [
      {
        id: "foundation.core",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
    ]),
    createPack("foundation.core", "1.2.0"),
  );
  const reordered = structuredClone(definition);
  reordered.packs.reverse();

  const first = registry.validateRegistry(definition);
  const second = registry.validateRegistry(reordered);
  assert.deepEqual(
    first.packs.map(({ id }) => id),
    ["feature.gameplay", "foundation.core"],
  );
  assert.equal(first.digest, second.digest);
});

test("pack manifests bind their canonical body to the declared digest", () => {
  assert.equal(typeof contracts.computePackManifestDigest, "function");
  assert.equal(typeof contracts.isPackManifestDigestValid, "function");

  const definition = createValidRegistryDefinition();
  const pack = createPack("pack.attested", "1.0.0");
  pack.digest = contracts.computePackManifestDigest(pack);
  assert.equal(contracts.isPackManifestDigestValid(pack), true);
  const signed = {
    ...structuredClone(pack),
    signature: {
      algorithm: "ed25519",
      keyId: "key.release",
      value: "detached-signature",
    },
  };
  assert.equal(contracts.computePackManifestDigest(signed), pack.digest);
  definition.packs.push(pack);
  assert.equal(registry.validateRegistry(definition).packs.length, 1);

  const tampered = createValidRegistryDefinition();
  const tamperedPack = structuredClone(pack);
  tamperedPack.license = { status: "declared", expression: "MIT" };
  assert.equal(contracts.isPackManifestDigestValid(tamperedPack), false);
  tampered.packs.push(tamperedPack);
  expectDiagnostic(tampered, "pack-digest-mismatch");
});

test("pack validation rejects empty intervals and control-plane incompatibility", () => {
  const invalidControlPlane = createValidRegistryDefinition();
  invalidControlPlane.controlPlaneVersion = "latest";
  expectDiagnostic(invalidControlPlane, "invalid-control-plane-version");

  const invalidInterval = createValidRegistryDefinition();
  const invalidIntervalPack = createPack("pack.invalid-interval", "1.0.0");
  invalidIntervalPack.compatibility.engines[0].minimum = "4.8.0";
  invalidIntervalPack.compatibility.engines[0].maximumExclusive = "4.8.0";
  invalidInterval.packs.push(invalidIntervalPack);
  expectDiagnostic(invalidInterval, "pack-version-interval-invalid");

  const incompatible = createValidRegistryDefinition();
  const incompatiblePack = createPack("pack.incompatible", "1.0.0");
  incompatiblePack.compatibility.controlPlane = {
    minimum: "1.0.0",
    maximumExclusive: "2.0.0",
  };
  incompatible.packs.push(incompatiblePack);
  expectDiagnostic(incompatible, "pack-control-plane-incompatible");
});

test("pack validation rejects dependency gaps, version conflicts, and cycles", () => {
  const missing = createValidRegistryDefinition();
  missing.packs.push(
    createPack("feature.missing", "1.0.0", [
      {
        id: "foundation.missing",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
    ]),
  );
  expectDiagnostic(missing, "pack-dependency-missing");

  const optional = createValidRegistryDefinition();
  optional.packs.push(
    createPack("feature.optional", "1.0.0", [
      {
        id: "foundation.optional",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: true,
      },
    ]),
  );
  assert.equal(registry.validateRegistry(optional).packs.length, 1);

  const conflict = createValidRegistryDefinition();
  conflict.packs.push(
    createPack("foundation.core", "2.0.0"),
    createPack("feature.conflict", "1.0.0", [
      {
        id: "foundation.core",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
    ]),
  );
  expectDiagnostic(conflict, "pack-dependency-version-mismatch");

  const cycle = createValidRegistryDefinition();
  cycle.packs.push(
    createPack("cycle.first", "1.0.0", [
      {
        id: "cycle.second",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
    ]),
    createPack("cycle.second", "1.0.0", [
      {
        id: "cycle.first",
        minimum: "1.0.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
    ]),
  );
  expectDiagnostic(cycle, "pack-dependency-cycle");
});

test("pack validation rejects duplicate identities and unresolved provisions", () => {
  const duplicate = createValidRegistryDefinition();
  duplicate.packs.push(
    createPack("pack.duplicate", "1.0.0"),
    createPack("pack.duplicate", "2.0.0"),
  );
  expectDiagnostic(duplicate, "duplicate-id");

  const unresolved = createValidRegistryDefinition();
  const unresolvedPack = createPack("pack.unresolved", "1.0.0");
  unresolvedPack.provides.commands = ["command.missing"];
  unresolved.packs.push(unresolvedPack);
  expectDiagnostic(unresolved, "pack-provision-missing");

  const duplicateDependency = createValidRegistryDefinition();
  duplicateDependency.packs.push(
    createPack("foundation.shared", "1.0.0"),
    createPack("pack.duplicate-dependency", "1.0.0", [
      {
        id: "foundation.shared",
        minimum: "0.9.0",
        maximumExclusive: "2.0.0",
        optional: false,
      },
      {
        id: "foundation.shared",
        minimum: "1.0.0",
        maximumExclusive: "3.0.0",
        optional: true,
      },
    ]),
  );
  expectDiagnostic(duplicateDependency, "pack-dependency-duplicate");

  const collision = createValidRegistryDefinition();
  const firstProvider = createPack("pack.first-provider", "1.0.0");
  const secondProvider = createPack("pack.second-provider", "1.0.0");
  firstProvider.provides.commands = ["verify"];
  secondProvider.provides.commands = ["verify"];
  collision.packs.push(firstProvider, secondProvider);
  expectDiagnostic(collision, "pack-provision-collision");

  const missingHook = createValidRegistryDefinition();
  const missingHookPack = createPack("pack.missing-hook", "1.0.0");
  missingHookPack.lifecycleHooks = { install: "pack.install-missing" };
  missingHook.packs.push(missingHookPack);
  expectDiagnostic(missingHook, "pack-lifecycle-command-missing");
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
