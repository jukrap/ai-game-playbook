import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "../dist/index.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/;

test("the builtin runtime registry exposes only implemented commands", () => {
  assert.equal(Object.isFrozen(registry.BUILTIN_REGISTRY), true);
  assert.match(registry.BUILTIN_REGISTRY.digest, digestPattern);
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.commands.map(({ id }) => id),
    ["doctor", "init", "project.inspect"],
  );

  const doctor = registry.BUILTIN_REGISTRY.commands[0];
  assert.equal(doctor.lifecycle, "experimental");
  assert.deepEqual(doctor.cli, { path: ["doctor"], aliases: [] });
  assert.deepEqual(doctor.permissions, ["read-project"]);
  assert.deepEqual(doctor.sideEffects, [
    { kind: "none", scope: "project-diagnostics", boundary: "local" },
  ]);
  assert.equal(doctor.lane, "parallel-read");
  assert.equal(doctor.input.schemaId, contracts.doctorRequestSchema.schemaId);
  assert.equal(doctor.output.schemaId, contracts.doctorReportSchema.schemaId);
  assert.equal(doctor.handler.package, "@ai-game-playbook/cli");
  assert.equal(doctor.handler.export, "runDoctor");
  assert.match(doctor.handler.digest, digestPattern);

  const init = registry.BUILTIN_REGISTRY.commands.find(({ id }) => id === "init");
  assert.notEqual(init, undefined);
  assert.deepEqual(init.cli, { path: ["init"], aliases: [] });
  assert.deepEqual(init.permissions, ["read-project"]);
  assert.deepEqual(init.sideEffects, [
    {
      kind: "none",
      scope: "project-initialization-plan",
      boundary: "local",
    },
  ]);
  assert.equal(init.lane, "parallel-read");
  assert.equal(init.input.schemaId, contracts.initRequestSchema.schemaId);
  assert.equal(init.output.schemaId, contracts.initReportSchema.schemaId);
  assert.equal(init.handler.package, "@ai-game-playbook/cli");
  assert.equal(init.handler.export, "runInit");
  assert.match(init.handler.digest, digestPattern);

  const inspect = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.inspect",
  );
  assert.notEqual(inspect, undefined);
  assert.deepEqual(inspect.cli, { path: ["project", "inspect"], aliases: [] });
  assert.deepEqual(inspect.capabilities, ["project.inspect"]);
  assert.deepEqual(inspect.permissions, ["read-project"]);
  assert.deepEqual(inspect.sideEffects, [
    { kind: "none", scope: "project-static-inspection", boundary: "local" },
  ]);
  assert.equal(inspect.lane, "parallel-read");
  assert.equal(inspect.timeoutMs, 10_000);
  assert.deepEqual(inspect.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(inspect.budgets.maxChangedFiles, 0);
  assert.equal(inspect.budgets.maxChangedBytes, 0);
  assert.equal(
    inspect.input.schemaId,
    contracts.projectInspectRequestSchema.schemaId,
  );
  assert.equal(
    inspect.output.schemaId,
    contracts.projectInspectReportSchema.schemaId,
  );
  assert.equal(inspect.handler.package, "@ai-game-playbook/cli");
  assert.equal(inspect.handler.export, "runProjectInspect");
  assert.match(inspect.handler.digest, digestPattern);
  assert.equal(
    registry.BUILTIN_REGISTRY.schemas.some(
      ({ schemaId }) => schemaId === contracts.gameProjectProfileSchema.schemaId,
    ),
    true,
  );
});

test("builtin generated surfaces preserve implemented schema and command identity", () => {
  const surfaces = registry.BUILTIN_REGISTRY_SURFACES;
  assert.equal(surfaces.registryDigest, registry.BUILTIN_REGISTRY.digest);
  assert.deepEqual(surfaces.cli.data.commands.map(({ id }) => id), [
    "doctor",
    "init",
    "project.inspect",
  ]);
  assert.deepEqual(surfaces.docs.data.commands.map(({ id }) => id), [
    "doctor",
    "init",
    "project.inspect",
  ]);
  assert.deepEqual(surfaces.mcp.data.tools.map(({ commandId }) => commandId), [
    "doctor",
    "init",
    "project.inspect",
  ]);
  assert.equal(surfaces.mcp.data.tools[0].enabledByDefault, false);
  assert.equal(surfaces.mcp.data.tools[1].enabledByDefault, false);
  assert.equal(surfaces.mcp.data.tools[2].enabledByDefault, false);
  assert.equal(
    surfaces.mcp.data.tools[0].outputSchemaId,
    contracts.doctorReportSchema.schemaId,
  );
});

test("the builtin registry routes one bounded project inspection skill", () => {
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.skills.map(({ id }) => id),
    ["project.inspection"],
  );

  const skill = registry.BUILTIN_REGISTRY.skills[0];
  assert.equal(skill.lifecycle, "stable");
  assert.equal(skill.invocation, "model");
  assert.deepEqual(skill.capabilities, ["project.inspect"]);
  assert.deepEqual(skill.requiredPermissions, ["read-project"]);
  assert.equal(skill.body.path, "skills/project-inspection/SKILL.md");
  assert.match(skill.body.digest, digestPattern);
  assert.equal(skill.body.maxTokens, 800);
  assert.deepEqual(skill.references, []);
  assert.equal(skill.triggers.every((trigger) => trigger.startsWith("Use when")), true);
  assert.equal(skill.exclusions.length > 0, true);
  assert.equal(skill.completionCriteria.length > 0, true);
  assert.equal(skill.evidenceDuties.length > 0, true);

  assert.deepEqual(
    registry.BUILTIN_REGISTRY_SURFACES.skills.data.routes.map(({ id }) => id),
    ["project.inspection"],
  );
  assert.equal(
    registry.BUILTIN_REGISTRY_SURFACES.skills.data.routes[0].body.digest,
    skill.body.digest,
  );
});

test("builtin registry validates implemented input and output values", () => {
  const doctor = registry.BUILTIN_REGISTRY.commands[0];
  const request = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    doctor.input,
    { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample" },
  );
  assert.equal(request.projectRoot, "D:\\games\\sample");

  const output = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    doctor.output,
    {
      schemaVersion: "1.0.0",
      commandId: "doctor",
      status: "attention",
      controlPlaneVersion: "0.0.0",
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      project: {
        requestedPath: "D:\\games\\sample",
        state: "uninitialized",
      },
      checks: [
        {
          id: "project.state",
          status: "warning",
          code: "project-state-not-initialized",
          message: "Project-local runtime state has not been initialized.",
        },
      ],
    },
  );
  assert.equal(output.status, "attention");

  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        registry.BUILTIN_REGISTRY,
        doctor.input,
        { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample", extra: true },
      ),
    (error) => error?.code === "registered-value-invalid",
  );
  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        registry.BUILTIN_REGISTRY,
        doctor.input,
        { schemaVersion: "1.0.0", projectRoot: "D:\\games\\bad\npath" },
      ),
    (error) => error?.code === "registered-value-invalid",
  );

  const init = registry.BUILTIN_REGISTRY.commands.find(({ id }) => id === "init");
  const initInput = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    init.input,
    { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample" },
  );
  assert.equal(initInput.projectRoot, "D:\\games\\sample");

  const initOutput = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    init.output,
    {
      schemaVersion: "1.0.0",
      commandId: "init",
      mode: "plan-only",
      status: "blocked",
      controlPlaneVersion: "0.0.0",
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      project: { requestedPath: "D:\\games\\sample" },
      targets: [],
      issues: [
        {
          code: "project-root-not-found",
          message: "The selected project root is unavailable.",
          nextAction: "Select one existing local project directory.",
        },
      ],
      summary: { create: 0, retain: 0, conflict: 0 },
      mutationPerformed: false,
      applySupported: false,
      externalInstallPlanned: false,
      networkAccessPlanned: false,
    },
  );
  assert.equal(initOutput.mode, "plan-only");

  const inspect = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.inspect",
  );
  const inspectInput = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    inspect.input,
    { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample" },
  );
  assert.equal(inspectInput.projectRoot, "D:\\games\\sample");
});
