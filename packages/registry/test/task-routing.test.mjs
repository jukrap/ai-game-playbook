import assert from "node:assert/strict";
import test from "node:test";

import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

const digest = "sha256:" + "b".repeat(64);

function setup() {
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  return {
    validated,
    selection: {
      schemaVersion: "1.0.0",
      selectionId: "018f6f35-2c9e-7d1a-8a4b-123456789ac0",
      registryDigest: validated.digest,
      projectId: "sample.graybox",
      stage: "vertical-slice",
      source: "model",
      skills: ["gameplay.vertical-slice"],
      roleLenses: ["lens.gameplay-risk"],
      rationaleDigest: digest,
      selectedAt: "2026-08-26T01:02:03.000Z",
    },
  };
}

test("task routing validates, detaches, and freezes bounded selections", () => {
  const { validated, selection } = setup();
  const result = registry.validateTaskRoutingSelection(validated, selection);

  assert.deepEqual(result, selection);
  assert.notEqual(result, selection);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.skills), true);
  assert.throws(() => result.skills.push("another.skill"), TypeError);
});

test("task routing rejects registry, identity, stage, and invocation mismatches", () => {
  const { validated, selection } = setup();
  const invalidCases = [
    [{ ...selection, registryDigest: digest }, "routing-registry-digest-mismatch"],
    [{ ...selection, skills: ["missing.skill"] }, "routing-skill-missing"],
    [{ ...selection, stage: "concept" }, "routing-skill-stage-mismatch"],
    [
      {
        ...selection,
        roleLenses: ["missing.lens"],
      },
      "routing-role-lens-missing",
    ],
  ];

  for (const [invalid, expectedCode] of invalidCases) {
    assert.throws(
      () => registry.validateTaskRoutingSelection(validated, invalid),
      (error) =>
        error?.name === "TaskRoutingSelectionError" &&
        error?.diagnostics.some(({ code }) => code === expectedCode),
    );
  }

  assert.throws(
    () =>
      registry.validateTaskRoutingSelection(
        structuredClone(validated),
        selection,
      ),
    /validateRegistry/,
  );

  const userOnlyDefinition = createValidRegistryDefinition();
  userOnlyDefinition.skills[0].invocation = "user";
  const userOnlyRegistry = registry.validateRegistry(userOnlyDefinition);
  assert.throws(
    () =>
      registry.validateTaskRoutingSelection(userOnlyRegistry, {
        ...selection,
        registryDigest: userOnlyRegistry.digest,
      }),
    (error) =>
      error?.diagnostics.some(
        ({ code }) => code === "routing-skill-invocation-mismatch",
      ),
  );

  const experimentalDefinition = createValidRegistryDefinition();
  experimentalDefinition.skills[0].lifecycle = "experimental";
  const experimentalRegistry = registry.validateRegistry(experimentalDefinition);
  assert.throws(
    () =>
      registry.validateTaskRoutingSelection(experimentalRegistry, {
        ...selection,
        registryDigest: experimentalRegistry.digest,
      }),
    (error) =>
      error?.diagnostics.some(
        ({ code }) => code === "routing-lifecycle-not-routable",
      ),
  );
});

test("task routing schema rejects selection cardinality overflow", () => {
  const { validated, selection } = setup();
  const tooManySkills = Array.from(
    { length: 6 },
    (_, index) => "skill." + (index + 1),
  );
  const tooManyLenses = Array.from(
    { length: 4 },
    (_, index) => "lens." + (index + 1),
  );

  for (const invalid of [
    { ...selection, skills: tooManySkills },
    { ...selection, roleLenses: tooManyLenses },
  ]) {
    assert.throws(
      () => registry.validateTaskRoutingSelection(validated, invalid),
      (error) =>
        error?.name === "TaskRoutingSelectionError" &&
        error?.diagnostics[0]?.code === "routing-schema-invalid",
    );
  }
});
