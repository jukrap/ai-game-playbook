import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

function expectPlanError(code) {
  return (error) =>
    error?.name === "WorkflowPlanResolutionError" && error?.code === code;
}

test("workflow plans resolve a deterministic attested command DAG", () => {
  assert.equal(typeof registry.resolveWorkflowPlan, "function");
  assert.equal(typeof contracts.computeResolvedWorkflowPlanDigest, "function");
  assert.equal(typeof contracts.checkResolvedWorkflowPlanSemantics, "function");
  const validated = registry.validateRegistry(createValidRegistryDefinition());

  const first = registry.resolveWorkflowPlan(
    validated,
    "workflow.verify-feature",
    "vertical-slice",
  );
  const second = registry.resolveWorkflowPlan(
    validated,
    "workflow.verify-feature",
    "vertical-slice",
  );

  assert.deepEqual(first, second);
  assert.equal(first.registryDigest, validated.digest);
  assert.equal(contracts.isResolvedWorkflowPlanDigestValid(first), true);
  assert.deepEqual(contracts.checkResolvedWorkflowPlanSemantics(first), []);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv, { mode: "full" });
  const validatePlan = ajv.compile(contracts.resolvedWorkflowPlanSchema.schema);
  assert.equal(validatePlan(first), true, JSON.stringify(validatePlan.errors));
  assert.deepEqual(
    first.steps.map(({ id, ordinal }) => [id, ordinal]),
    [
      ["step.inspect", 0],
      ["step.verify", 1],
    ],
  );
  assert.equal(first.steps[1].command.id, "verify");
  assert.equal(first.steps[1].rollbackCommand.id, "engine.rollback");
  assert.equal(first.steps[1].command.handlerDigest.startsWith("sha256:"), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.steps), true);
  assert.equal(Object.isFrozen(first.steps[1].command), true);
});

test("workflow plan semantics reject tampered order, dependencies, canonical arrays, and digest", () => {
  const plan = structuredClone(
    registry.resolveWorkflowPlan(
      registry.validateRegistry(createValidRegistryDefinition()),
      "workflow.verify-feature",
      "vertical-slice",
    ),
  );
  plan.steps[0].ordinal = 1;
  plan.steps[1].dependsOn = ["step.unknown"];
  plan.steps[1].command.permissions.reverse();
  plan.requiredEvidence.reverse();

  assert.deepEqual(
    new Set(
      contracts
        .checkResolvedWorkflowPlanSemantics(plan)
        .map(({ code }) => code),
    ),
    new Set([
      "resolved-workflow-plan-digest-mismatch",
      "resolved-workflow-plan-order-invalid",
      "resolved-workflow-plan-dependency-invalid",
      "resolved-workflow-plan-canonical-invalid",
    ]),
  );
});

test("resolved workflow plan digest is domain separated from its plain subject digest", () => {
  const plan = registry.resolveWorkflowPlan(
    registry.validateRegistry(createValidRegistryDefinition()),
    "workflow.verify-feature",
    "vertical-slice",
  );
  const { resolvedPlanDigest: _resolvedPlanDigest, ...subject } = plan;

  assert.notEqual(
    contracts.computeResolvedWorkflowPlanDigest(plan),
    contracts.digestCanonicalJson(subject),
  );
});

test("workflow plan order follows dependencies rather than descriptor array order", () => {
  const definition = createValidRegistryDefinition();
  definition.workflows[0].steps.reverse();
  const validated = registry.validateRegistry(definition);
  const plan = registry.resolveWorkflowPlan(
    validated,
    "workflow.verify-feature",
    "vertical-slice",
  );

  assert.deepEqual(
    plan.steps.map(({ id }) => id),
    ["step.inspect", "step.verify"],
  );
});

test("workflow plan resolution rejects missing, unsupported, and unvalidated authority", () => {
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  assert.throws(
    () =>
      registry.resolveWorkflowPlan(
        validated,
        "workflow.missing",
        "vertical-slice",
      ),
    expectPlanError("workflow-plan-not-found"),
  );
  assert.throws(
    () =>
      registry.resolveWorkflowPlan(
        validated,
        "workflow.verify-feature",
        "concept",
      ),
    expectPlanError("workflow-plan-stage-unsupported"),
  );
  assert.throws(
    () =>
      registry.resolveWorkflowPlan(
        createValidRegistryDefinition(),
        "workflow.verify-feature",
        "vertical-slice",
      ),
    TypeError,
  );
});

test("workflow plan digest changes with exact command implementation authority", () => {
  const firstDefinition = createValidRegistryDefinition();
  const secondDefinition = createValidRegistryDefinition();
  secondDefinition.commands.find(({ id }) => id === "verify").handler.digest =
    `sha256:${"f".repeat(64)}`;

  const first = registry.resolveWorkflowPlan(
    registry.validateRegistry(firstDefinition),
    "workflow.verify-feature",
    "vertical-slice",
  );
  const second = registry.resolveWorkflowPlan(
    registry.validateRegistry(secondDefinition),
    "workflow.verify-feature",
    "vertical-slice",
  );

  assert.notEqual(first.resolvedPlanDigest, second.resolvedPlanDigest);
  assert.notEqual(
    first.steps[1].command.descriptorDigest,
    second.steps[1].command.descriptorDigest,
  );
});
