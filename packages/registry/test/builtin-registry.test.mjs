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
    [
      "doctor",
      "engine.capabilities",
      "engine.executable-discovery",
      "engine.headless-preflight",
      "engine.status",
      "engine.version-probe",
      "init",
      "project.inspect",
      "skill.check",
      "skill.list",
    ],
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

  const engineCapabilities = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.capabilities",
  );
  assert.notEqual(engineCapabilities, undefined);
  assert.deepEqual(engineCapabilities.cli, {
    path: ["engine", "capabilities"],
    aliases: [],
  });
  assert.deepEqual(engineCapabilities.capabilities, ["engine.capabilities"]);
  assert.deepEqual(engineCapabilities.permissions, ["read-project"]);
  assert.deepEqual(engineCapabilities.sideEffects, [
    {
      kind: "none",
      scope: "godot-static-capabilities",
      boundary: "local",
    },
  ]);
  assert.equal(engineCapabilities.lane, "parallel-read");
  assert.equal(engineCapabilities.timeoutMs, 10_000);
  assert.deepEqual(engineCapabilities.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(engineCapabilities.budgets.maxChangedFiles, 0);
  assert.equal(engineCapabilities.budgets.maxChangedBytes, 0);
  assert.equal(
    engineCapabilities.input.schemaId,
    contracts.engineCapabilitiesRequestSchema.schemaId,
  );
  assert.equal(
    engineCapabilities.output.schemaId,
    contracts.engineCapabilitiesReportSchema.schemaId,
  );
  assert.equal(
    engineCapabilities.handler.package,
    "@ai-game-playbook/godot-adapter",
  );
  assert.equal(
    engineCapabilities.handler.export,
    "runGodotEngineCapabilities",
  );
  assert.match(engineCapabilities.handler.digest, digestPattern);

  const engineStatus = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.status",
  );
  assert.notEqual(engineStatus, undefined);
  assert.deepEqual(engineStatus.cli, { path: ["engine", "status"], aliases: [] });
  assert.deepEqual(engineStatus.capabilities, ["engine.status"]);
  assert.deepEqual(engineStatus.permissions, ["read-project"]);
  assert.deepEqual(engineStatus.sideEffects, [
    { kind: "none", scope: "godot-static-status", boundary: "local" },
  ]);
  assert.equal(engineStatus.lane, "parallel-read");
  assert.equal(engineStatus.timeoutMs, 10_000);
  assert.deepEqual(engineStatus.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(engineStatus.budgets.maxChangedFiles, 0);
  assert.equal(engineStatus.budgets.maxChangedBytes, 0);
  assert.equal(
    engineStatus.input.schemaId,
    contracts.engineStatusRequestSchema.schemaId,
  );
  assert.equal(
    engineStatus.output.schemaId,
    contracts.engineStatusReportSchema.schemaId,
  );
  assert.equal(engineStatus.handler.package, "@ai-game-playbook/godot-adapter");
  assert.equal(engineStatus.handler.export, "runGodotEngineStatus");
  assert.match(engineStatus.handler.digest, digestPattern);

  const executableDiscovery = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.executable-discovery",
  );
  assert.notEqual(executableDiscovery, undefined);
  assert.equal(executableDiscovery.lifecycle, "internal");
  assert.deepEqual(executableDiscovery.cli, {
    path: ["internal", "engine", "executable-discovery"],
    aliases: [],
  });
  assert.deepEqual(executableDiscovery.capabilities, [
    "engine.executable-discovery",
  ]);
  assert.deepEqual(executableDiscovery.permissions, [
    "read-project",
    "host-tool-inspection",
  ]);
  assert.deepEqual(executableDiscovery.sideEffects, [
    {
      kind: "none",
      scope: "godot-executable-discovery",
      boundary: "local",
    },
  ]);
  assert.equal(executableDiscovery.lane, "parallel-read");
  assert.equal(executableDiscovery.timeoutMs, 10_000);
  assert.deepEqual(executableDiscovery.cancellation, {
    mode: "not-applicable",
    graceMs: 0,
  });
  assert.deepEqual(executableDiscovery.retry, {
    mode: "never",
    maxAttempts: 1,
  });
  assert.equal(executableDiscovery.budgets.maxChangedFiles, 0);
  assert.equal(executableDiscovery.budgets.maxChangedBytes, 0);
  assert.equal(
    executableDiscovery.input.schemaId,
    contracts.godotExecutableDiscoveryRequestSchema.schemaId,
  );
  assert.equal(
    executableDiscovery.output.schemaId,
    contracts.godotExecutableDiscoveryReportSchema.schemaId,
  );
  assert.equal(
    executableDiscovery.handler.package,
    "@ai-game-playbook/godot-adapter",
  );
  assert.equal(executableDiscovery.handler.export, "runGodotExecutableDiscovery");
  assert.match(executableDiscovery.handler.digest, digestPattern);

  const headlessPreflight = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.headless-preflight",
  );
  assert.notEqual(headlessPreflight, undefined);
  assert.equal(headlessPreflight.lifecycle, "internal");
  assert.deepEqual(headlessPreflight.cli, {
    path: ["internal", "engine", "headless-preflight"],
    aliases: [],
  });
  assert.deepEqual(headlessPreflight.capabilities, [
    "engine.headless-preflight",
  ]);
  assert.deepEqual(headlessPreflight.permissions, [
    "read-project",
    "host-tool-inspection",
    "test-build",
  ]);
  assert.deepEqual(headlessPreflight.sideEffects, [
    {
      kind: "process",
      scope: "godot-headless-project-startup",
      boundary: "local",
    },
  ]);
  assert.equal(headlessPreflight.lane, "build-bound");
  assert.equal(headlessPreflight.timeoutMs, 10_000);
  assert.deepEqual(headlessPreflight.cancellation, {
    mode: "process-tree",
    graceMs: 1_000,
  });
  assert.deepEqual(headlessPreflight.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(headlessPreflight.budgets.maxChangedFiles, 0);
  assert.equal(headlessPreflight.budgets.maxChangedBytes, 0);
  assert.equal(headlessPreflight.budgets.maxDurationMs, 10_000);
  assert.equal(headlessPreflight.budgets.maxOutputBytes, 1_048_576);
  assert.equal(headlessPreflight.budgets.maxRepairCycles, 0);
  assert.equal(
    headlessPreflight.input.schemaId,
    contracts.godotHeadlessPreflightRequestSchema.schemaId,
  );
  assert.equal(
    headlessPreflight.output.schemaId,
    contracts.godotHeadlessPreflightReportSchema.schemaId,
  );
  assert.equal(
    headlessPreflight.handler.package,
    "@ai-game-playbook/godot-adapter",
  );
  assert.equal(headlessPreflight.handler.export, "runGodotHeadlessPreflight");
  assert.match(headlessPreflight.handler.digest, digestPattern);

  const versionProbe = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.version-probe",
  );
  assert.notEqual(versionProbe, undefined);
  assert.equal(versionProbe.lifecycle, "internal");
  assert.deepEqual(versionProbe.cli, {
    path: ["internal", "engine", "version-probe"],
    aliases: [],
  });
  assert.deepEqual(versionProbe.capabilities, ["engine.version-probe"]);
  assert.deepEqual(versionProbe.permissions, [
    "read-project",
    "host-tool-inspection",
  ]);
  assert.deepEqual(versionProbe.sideEffects, [
    { kind: "process", scope: "godot-version-probe", boundary: "local" },
  ]);
  assert.equal(versionProbe.lane, "parallel-read");
  assert.equal(versionProbe.timeoutMs, 10_000);
  assert.deepEqual(versionProbe.cancellation, {
    mode: "process-tree",
    graceMs: 1_000,
  });
  assert.deepEqual(versionProbe.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(versionProbe.budgets.maxChangedFiles, 0);
  assert.equal(versionProbe.budgets.maxChangedBytes, 0);
  assert.equal(versionProbe.budgets.maxDurationMs, 10_000);
  assert.equal(versionProbe.budgets.maxOutputBytes, 16_384);
  assert.equal(versionProbe.budgets.maxRepairCycles, 0);
  assert.equal(
    versionProbe.input.schemaId,
    contracts.godotVersionProbeRequestSchema.schemaId,
  );
  assert.equal(
    versionProbe.output.schemaId,
    contracts.godotVersionProbeReportSchema.schemaId,
  );
  assert.equal(versionProbe.handler.package, "@ai-game-playbook/godot-adapter");
  assert.equal(versionProbe.handler.export, "runGodotVersionProbe");
  assert.match(versionProbe.handler.digest, digestPattern);

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
  assert.equal(inspect.handler.package, "@ai-game-playbook/project-runtime");
  assert.equal(inspect.handler.export, "runProjectInspect");
  assert.match(inspect.handler.digest, digestPattern);
  assert.equal(
    registry.BUILTIN_REGISTRY.schemas.some(
      ({ schemaId }) => schemaId === contracts.gameProjectProfileSchema.schemaId,
    ),
    true,
  );

  for (const [id, inputSchema, outputSchema, exportName] of [
    [
      "skill.check",
      contracts.skillCheckRequestSchema,
      contracts.skillCheckReportSchema,
      "runSkillCheck",
    ],
    [
      "skill.list",
      contracts.skillListRequestSchema,
      contracts.skillListReportSchema,
      "runSkillList",
    ],
  ]) {
    const command = registry.BUILTIN_REGISTRY.commands.find(
      ({ id: commandId }) => commandId === id,
    );
    assert.notEqual(command, undefined);
    assert.deepEqual(command.cli, { path: id.split("."), aliases: [] });
    assert.deepEqual(command.permissions, ["read-project"]);
    assert.equal(command.sideEffects.every(({ kind }) => kind === "none"), true);
    assert.equal(command.lane, "parallel-read");
    assert.equal(command.input.schemaId, inputSchema.schemaId);
    assert.equal(command.output.schemaId, outputSchema.schemaId);
    assert.equal(command.handler.package, "@ai-game-playbook/cli");
    assert.equal(command.handler.export, exportName);
    assert.match(command.handler.digest, digestPattern);
  }
});

test("the builtin registry binds headless preflight to one finite workflow step", () => {
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.workflows.map(({ id }) => id),
    ["workflow.godot-headless-preflight"],
  );
  const workflow = registry.BUILTIN_REGISTRY.workflows[0];
  assert.equal(workflow.lifecycle, "internal");
  assert.equal(
    workflow.input.schemaId,
    contracts.godotHeadlessPreflightRequestSchema.schemaId,
  );
  assert.equal(
    workflow.output.schemaId,
    contracts.godotHeadlessPreflightReportSchema.schemaId,
  );
  assert.deepEqual(workflow.steps, [
    {
      id: "step.godot-headless-preflight",
      commandId: "engine.headless-preflight",
      dependsOn: [],
      onFailure: "blocked",
      approvalCheckpoint: false,
    },
  ]);
  assert.deepEqual(workflow.requiredEvidence, [
    "godot-headless-preflight",
    "run-receipt",
  ]);

  const plan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    workflow.id,
    "vertical-slice",
  );
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].command.id, "engine.headless-preflight");
  assert.equal(plan.steps[0].command.lane, "build-bound");
  assert.equal(
    contracts.isResolvedWorkflowPlanDigestValid(plan),
    true,
  );
});

test("builtin generated surfaces preserve implemented schema and command identity", () => {
  const surfaces = registry.BUILTIN_REGISTRY_SURFACES;
  assert.equal(surfaces.registryDigest, registry.BUILTIN_REGISTRY.digest);
  assert.deepEqual(surfaces.cli.data.commands.map(({ id }) => id), [
    "doctor",
    "engine.capabilities",
    "engine.status",
    "init",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.deepEqual(surfaces.docs.data.commands.map(({ id }) => id), [
    "doctor",
    "engine.capabilities",
    "engine.status",
    "init",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.deepEqual(surfaces.mcp.data.tools.map(({ commandId }) => commandId), [
    "doctor",
    "engine.capabilities",
    "engine.status",
    "init",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.equal(
    surfaces.mcp.data.tools.every(({ enabledByDefault }) => !enabledByDefault),
    true,
  );
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
  assert.deepEqual(skill.capabilities, [
    "engine.capabilities",
    "project.inspect",
  ]);
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
