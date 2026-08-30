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
      "engine.deterministic-replay",
      "engine.executable-discovery",
      "engine.headless-preflight",
      "engine.persistence-cycle",
      "engine.project-import",
      "engine.project-validation",
      "engine.runtime-frame-capture",
      "engine.status",
      "engine.version-probe",
      "init",
      "pack.add",
      "pack.doctor",
      "pack.list",
      "pack.recover",
      "project.initialization-recovery.assess",
      "project.initialize",
      "project.inspect",
      "skill.check",
      "skill.list",
      "workflow.evidence-reconcile",
    ],
  );
  assert.equal(
    registry.BUILTIN_REGISTRY.commands.some(
      ({ id }) => id === "engine.deterministic-replay",
    ),
    true,
  );
  assert.equal(
    registry.BUILTIN_REGISTRY_SURFACES.cli.data.commands.some(
      ({ id }) => id === "engine.deterministic-replay",
    ),
    false,
  );
  assert.equal(
    registry.BUILTIN_REGISTRY_SURFACES.mcp.data.tools.some(
      ({ commandId }) => commandId === "engine.deterministic-replay",
    ),
    false,
  );
  for (const commandId of [
    "engine.persistence-cycle",
    "engine.project-import",
    "engine.project-validation",
    "engine.runtime-frame-capture",
  ]) {
    assert.equal(
      registry.BUILTIN_REGISTRY_SURFACES.cli.data.commands.some(
        ({ id }) => id === commandId,
      ),
      false,
    );
    assert.equal(
      registry.BUILTIN_REGISTRY_SURFACES.mcp.data.tools.some(
        ({ commandId: candidate }) => candidate === commandId,
      ),
      false,
    );
  }

  const packAdd = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "pack.add",
  );
  assert.notEqual(packAdd, undefined);
  assert.equal(packAdd.lifecycle, "internal");
  assert.deepEqual(packAdd.cli, {
    path: ["internal", "pack", "add"],
    aliases: [],
  });
  assert.deepEqual(packAdd.permissions, ["install"]);
  assert.equal(packAdd.lane, "project-write");
  assert.equal(
    packAdd.input.schemaId,
    contracts.packOperationCommandInputSchema.schemaId,
  );
  assert.equal(
    packAdd.output.schemaId,
    contracts.packOperationCommandOutputSchema.schemaId,
  );
  assert.equal(packAdd.handler.package, "@ai-game-playbook/pack-runtime");
  assert.equal(packAdd.handler.export, "dispatchPreparedPackOperation");
  assert.match(packAdd.handler.digest, digestPattern);

  const packRecovery = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "pack.recover",
  );
  assert.notEqual(packRecovery, undefined);
  assert.equal(packRecovery.lifecycle, "internal");
  assert.deepEqual(packRecovery.cli, {
    path: ["internal", "pack", "recover"],
    aliases: [],
  });
  assert.deepEqual(packRecovery.permissions, ["install"]);
  assert.equal(packRecovery.lane, "project-write");
  assert.equal(
    packRecovery.input.schemaId,
    contracts.packRecoveryCommandInputSchema.schemaId,
  );
  assert.equal(
    packRecovery.output.schemaId,
    contracts.packRecoveryCommandOutputSchema.schemaId,
  );
  assert.equal(
    packRecovery.handler.package,
    "@ai-game-playbook/pack-runtime",
  );
  assert.equal(
    packRecovery.handler.export,
    "dispatchPreparedPackRecoveryFinalization",
  );
  assert.match(packRecovery.handler.digest, digestPattern);

  const workflowReconciliation = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === contracts.WORKFLOW_RECONCILIATION_COMMAND_ID,
  );
  assert.notEqual(workflowReconciliation, undefined);
  assert.equal(workflowReconciliation.lifecycle, "internal");
  assert.deepEqual(workflowReconciliation.cli, {
    path: ["internal", "workflow", "evidence-reconcile"],
    aliases: [],
  });
  assert.deepEqual(workflowReconciliation.permissions, [
    "write-project-metadata",
  ]);
  assert.equal(workflowReconciliation.lane, "project-write");
  assert.equal(
    workflowReconciliation.input.schemaId,
    contracts.workflowReconciliationCommandInputSchema.schemaId,
  );
  assert.equal(
    workflowReconciliation.output.schemaId,
    contracts.workflowReconciliationCommandOutputSchema.schemaId,
  );
  assert.equal(
    workflowReconciliation.handler.package,
    "@ai-game-playbook/pack-runtime",
  );
  assert.equal(
    workflowReconciliation.handler.export,
    "dispatchPreparedPackRecoveryWorkflowReconciliation",
  );
  assert.match(workflowReconciliation.handler.digest, digestPattern);

  const packAddWorkflow = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.pack-add",
  );
  assert.notEqual(packAddWorkflow, undefined);
  assert.equal(packAddWorkflow.lifecycle, "internal");
  assert.deepEqual(packAddWorkflow.steps, [
    {
      id: "step.pack-add",
      commandId: "pack.add",
      dependsOn: [],
      onFailure: "stop",
      approvalCheckpoint: true,
    },
  ]);

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
  assert.equal(
    headlessPreflight.timeoutMs,
    contracts.GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  );
  assert.deepEqual(headlessPreflight.cancellation, {
    mode: "process-tree",
    graceMs: contracts.GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  });
  assert.deepEqual(headlessPreflight.retry, { mode: "never", maxAttempts: 1 });
  assert.equal(headlessPreflight.budgets.maxChangedFiles, 0);
  assert.equal(headlessPreflight.budgets.maxChangedBytes, 0);
  assert.equal(
    headlessPreflight.budgets.maxDurationMs,
    contracts.GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  );
  assert.equal(
    headlessPreflight.budgets.maxOutputBytes,
    contracts.GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
  );
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

  const deterministicReplay = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.deterministic-replay",
  );
  assert.notEqual(deterministicReplay, undefined);
  assert.equal(deterministicReplay.lifecycle, "internal");
  assert.deepEqual(deterministicReplay.cli, {
    path: ["internal", "engine", "deterministic-replay"],
    aliases: [],
  });
  assert.deepEqual(deterministicReplay.capabilities, [
    "engine.deterministic-replay",
  ]);
  assert.deepEqual(deterministicReplay.permissions, [
    "read-project",
    "host-tool-inspection",
    "test-build",
  ]);
  assert.deepEqual(deterministicReplay.sideEffects, [
    {
      kind: "process",
      scope: "godot-deterministic-replay",
      boundary: "local",
    },
  ]);
  assert.equal(deterministicReplay.lane, "build-bound");
  assert.equal(
    deterministicReplay.timeoutMs,
    contracts.GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS,
  );
  assert.deepEqual(deterministicReplay.cancellation, {
    mode: "process-tree",
    graceMs: contracts.GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS,
  });
  assert.deepEqual(deterministicReplay.retry, {
    mode: "never",
    maxAttempts: 1,
  });
  assert.equal(
    deterministicReplay.input.schemaId,
    contracts.playtestScenarioSchema.schemaId,
  );
  assert.equal(
    deterministicReplay.output.schemaId,
    contracts.godotDeterministicReplayReportSchema.schemaId,
  );
  assert.equal(
    deterministicReplay.handler.package,
    "@ai-game-playbook/godot-adapter",
  );
  assert.equal(
    deterministicReplay.handler.export,
    "runGodotDeterministicReplay",
  );
  assert.match(deterministicReplay.handler.digest, digestPattern);

  const runtimeFrameCapture = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === contracts.GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID,
  );
  assert.notEqual(runtimeFrameCapture, undefined);
  assert.equal(runtimeFrameCapture.lifecycle, "internal");
  assert.deepEqual(runtimeFrameCapture.cli, {
    path: ["internal", "engine", "runtime-frame-capture"],
    aliases: [],
  });
  assert.deepEqual(runtimeFrameCapture.permissions, [
    "read-project",
    "host-tool-inspection",
    "test-build",
    "write-project-metadata",
  ]);
  assert.deepEqual(runtimeFrameCapture.sideEffects, [
    {
      kind: "process",
      scope: "godot-runtime-frame-capture",
      boundary: "local",
    },
    {
      kind: "filesystem",
      scope: "godot-runtime-frame-source",
      boundary: "local",
    },
  ]);
  assert.equal(runtimeFrameCapture.lane, "build-bound");
  assert.equal(
    runtimeFrameCapture.timeoutMs,
    contracts.GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS,
  );
  assert.deepEqual(runtimeFrameCapture.cancellation, {
    mode: "process-tree",
    graceMs: contracts.GODOT_RUNTIME_FRAME_CAPTURE_TERMINATION_GRACE_MS,
  });
  assert.deepEqual(runtimeFrameCapture.budgets, {
    maxChangedBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    maxChangedFiles: 1,
    maxDurationMs: contracts.GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS,
    maxOutputBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
  assert.equal(
    runtimeFrameCapture.output.schemaId,
    contracts.runtimeFrameEvidenceSchema.schemaId,
  );
  assert.deepEqual(runtimeFrameCapture.requiredEvidence, [
    "runtime-frame-evidence",
    "run-receipt",
  ]);
  assert.equal(
    runtimeFrameCapture.handler.export,
    "runGodotRuntimeFrameCapture",
  );
  assert.match(runtimeFrameCapture.handler.digest, digestPattern);

  const runtimeFrameWorkflow = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === contracts.GODOT_RUNTIME_FRAME_CAPTURE_WORKFLOW_ID,
  );
  assert.notEqual(runtimeFrameWorkflow, undefined);
  assert.equal(runtimeFrameWorkflow.lifecycle, "internal");
  assert.equal(runtimeFrameWorkflow.steps.length, 1);
  assert.equal(
    runtimeFrameWorkflow.steps[0].id,
    contracts.GODOT_RUNTIME_FRAME_CAPTURE_STEP_ID,
  );
  assert.equal(
    runtimeFrameWorkflow.steps[0].commandId,
    contracts.GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID,
  );
  assert.equal(runtimeFrameWorkflow.resumePolicy, "never");

  const persistenceCycle = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
  );
  assert.notEqual(persistenceCycle, undefined);
  assert.equal(persistenceCycle.lifecycle, "internal");
  assert.deepEqual(persistenceCycle.cli, {
    path: ["internal", "engine", "persistence-cycle"],
    aliases: [],
  });
  assert.deepEqual(persistenceCycle.capabilities, [
    contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
  ]);
  assert.deepEqual(persistenceCycle.permissions, [
    "read-project",
    "host-tool-inspection",
    "test-build",
  ]);
  assert.deepEqual(persistenceCycle.sideEffects, [
    {
      kind: "process",
      scope: "godot-persistence-cycle",
      boundary: "local",
    },
  ]);
  assert.equal(persistenceCycle.lane, "build-bound");
  assert.equal(
    persistenceCycle.timeoutMs,
    contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS,
  );
  assert.deepEqual(persistenceCycle.cancellation, {
    mode: "process-tree",
    graceMs: contracts.GODOT_PERSISTENCE_CYCLE_TERMINATION_GRACE_MS,
  });
  assert.deepEqual(persistenceCycle.retry, {
    mode: "never",
    maxAttempts: 1,
  });
  assert.equal(
    persistenceCycle.input.schemaId,
    contracts.godotPersistenceCycleExpectationSchema.schemaId,
  );
  assert.equal(
    persistenceCycle.output.schemaId,
    contracts.godotPersistenceCycleReportSchema.schemaId,
  );
  assert.deepEqual(persistenceCycle.requiredEvidence, [
    "godot-persistence-cycle",
    "run-receipt",
  ]);
  assert.equal(
    persistenceCycle.handler.package,
    "@ai-game-playbook/godot-adapter",
  );
  assert.equal(persistenceCycle.handler.export, "runGodotPersistenceCycle");
  assert.match(persistenceCycle.handler.digest, digestPattern);

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

  const initialize = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.initialize",
  );
  assert.notEqual(initialize, undefined);
  assert.equal(initialize.lifecycle, "internal");
  assert.deepEqual(initialize.cli, {
    path: ["internal", "project", "initialize"],
    aliases: [],
  });
  assert.deepEqual(initialize.permissions, ["write-project-metadata"]);
  assert.deepEqual(initialize.sideEffects, [
    {
      kind: "filesystem",
      scope: "bounded-project-initialization",
      boundary: "local",
    },
  ]);
  assert.equal(initialize.lane, "project-write");
  assert.equal(initialize.retry.mode, "never");
  assert.equal(initialize.retry.maxAttempts, 1);
  assert.equal(
    initialize.input.schemaId,
    contracts.projectInitializationCommandInputSchema.schemaId,
  );
  assert.equal(
    initialize.output.schemaId,
    contracts.projectInitializationReportSchema.schemaId,
  );
  assert.equal(initialize.handler.package, "@ai-game-playbook/project-runtime");
  assert.equal(
    initialize.handler.export,
    "executePreparedProjectInitialization",
  );
  assert.match(initialize.handler.digest, digestPattern);

  const recoveryAssessment = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.initialization-recovery.assess",
  );
  assert.notEqual(recoveryAssessment, undefined);
  assert.equal(recoveryAssessment.lifecycle, "internal");
  assert.deepEqual(recoveryAssessment.cli, {
    path: ["internal", "project", "initialization-recovery", "assess"],
    aliases: [],
  });
  assert.deepEqual(recoveryAssessment.permissions, ["read-project"]);
  assert.deepEqual(recoveryAssessment.sideEffects, [
    {
      kind: "none",
      scope: "project-initialization-recovery-assessment",
      boundary: "local",
    },
  ]);
  assert.equal(recoveryAssessment.lane, "parallel-read");
  assert.equal(recoveryAssessment.timeoutMs, 10_000);
  assert.deepEqual(recoveryAssessment.cancellation, {
    mode: "not-applicable",
    graceMs: 0,
  });
  assert.deepEqual(recoveryAssessment.retry, {
    mode: "never",
    maxAttempts: 1,
  });
  assert.deepEqual(recoveryAssessment.budgets, {
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  });
  assert.deepEqual(recoveryAssessment.requiredEvidence, [
    "project-initialization-recovery-assessment",
  ]);
  assert.equal(
    recoveryAssessment.input.schemaId,
    contracts.projectInitializationRecoveryRequestSchema.schemaId,
  );
  assert.equal(
    recoveryAssessment.output.schemaId,
    contracts.projectInitializationRecoveryReportSchema.schemaId,
  );
  assert.equal(
    recoveryAssessment.handler.package,
    "@ai-game-playbook/project-runtime",
  );
  assert.equal(
    recoveryAssessment.handler.export,
    "runProjectInitializationRecoveryAssessment",
  );
  assert.match(recoveryAssessment.handler.digest, digestPattern);

  for (const [id, inputSchema, outputSchema, exportName, scope] of [
    [
      "pack.doctor",
      contracts.packDoctorRequestSchema,
      contracts.packDoctorReportSchema,
      "runPackDoctor",
      "pack-managed-diagnostics",
    ],
    [
      "pack.list",
      contracts.packListRequestSchema,
      contracts.packListReportSchema,
      "runPackList",
      "pack-installed-list",
    ],
  ]) {
    const command = registry.BUILTIN_REGISTRY.commands.find(
      ({ id: commandId }) => commandId === id,
    );
    assert.notEqual(command, undefined);
    assert.deepEqual(command.cli, { path: id.split("."), aliases: [] });
    assert.deepEqual(command.permissions, ["read-project"]);
    assert.deepEqual(command.sideEffects, [
      { kind: "none", scope, boundary: "local" },
    ]);
    assert.equal(command.lane, "parallel-read");
    assert.equal(command.timeoutMs, 10_000);
    assert.deepEqual(command.retry, { mode: "never", maxAttempts: 1 });
    assert.equal(command.budgets.maxChangedFiles, 0);
    assert.equal(command.budgets.maxChangedBytes, 0);
    assert.equal(command.input.schemaId, inputSchema.schemaId);
    assert.equal(command.output.schemaId, outputSchema.schemaId);
    assert.equal(command.handler.package, "@ai-game-playbook/pack-runtime");
    assert.equal(command.handler.export, exportName);
    assert.match(command.handler.digest, digestPattern);
  }

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
  assert.equal(
    registry.BUILTIN_REGISTRY.schemas.some(
      ({ schemaId, digest }) =>
        schemaId === contracts.runtimeFrameEvidenceSchema.schemaId &&
        digest === contracts.runtimeFrameEvidenceSchema.digest,
    ),
    true,
  );
  for (const approvalSchema of [
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    contracts.approvalSessionChallengeSchema,
    contracts.approvalSessionResponseSchema,
  ]) {
    assert.equal(
      registry.BUILTIN_REGISTRY.schemas.some(
        ({ schemaId, digest }) =>
          schemaId === approvalSchema.schemaId &&
          digest === approvalSchema.digest,
      ),
      true,
    );
  }

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

test("the builtin registry binds internal operations to finite workflow steps", () => {
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.workflows.map(({ id }) => id),
    [
      "workflow.evidence-reconciliation",
      "workflow.godot-deterministic-replay",
      "workflow.godot-headless-preflight",
      "workflow.godot-persistence-cycle",
      "workflow.godot-project-validation",
      "workflow.godot-runtime-frame-capture",
      "workflow.pack-add",
      "workflow.pack-recover",
      "workflow.project-initialization",
    ],
  );
  const workflow = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.godot-headless-preflight",
  );
  assert.notEqual(workflow, undefined);
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

  const replay = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.godot-deterministic-replay",
  );
  assert.notEqual(replay, undefined);
  assert.equal(replay.lifecycle, "internal");
  assert.equal(replay.input.schemaId, contracts.playtestScenarioSchema.schemaId);
  assert.equal(
    replay.output.schemaId,
    contracts.godotDeterministicReplayReportSchema.schemaId,
  );
  assert.deepEqual(replay.steps, [
    {
      id: "step.godot-deterministic-replay",
      commandId: "engine.deterministic-replay",
      dependsOn: [],
      onFailure: "blocked",
      approvalCheckpoint: false,
    },
  ]);
  assert.deepEqual(replay.requiredEvidence, [
    "godot-deterministic-replay",
    "run-receipt",
  ]);
  const replayPlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    replay.id,
    "vertical-slice",
  );
  assert.equal(replayPlan.steps.length, 1);
  assert.equal(replayPlan.steps[0].command.id, "engine.deterministic-replay");
  assert.equal(replayPlan.steps[0].command.lane, "build-bound");
  assert.equal(contracts.isResolvedWorkflowPlanDigestValid(replayPlan), true);

  const persistence = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === contracts.GODOT_PERSISTENCE_CYCLE_WORKFLOW_ID,
  );
  assert.notEqual(persistence, undefined);
  assert.equal(persistence.lifecycle, "internal");
  assert.equal(
    persistence.input.schemaId,
    contracts.godotPersistenceCycleExpectationSchema.schemaId,
  );
  assert.equal(
    persistence.output.schemaId,
    contracts.godotPersistenceCycleReportSchema.schemaId,
  );
  assert.deepEqual(persistence.steps, [
    {
      id: contracts.GODOT_PERSISTENCE_CYCLE_STEP_ID,
      commandId: contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
      dependsOn: [],
      onFailure: "blocked",
      approvalCheckpoint: false,
    },
  ]);
  assert.deepEqual(persistence.requiredEvidence, [
    "godot-persistence-cycle",
    "run-receipt",
  ]);
  const persistencePlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    persistence.id,
    "vertical-slice",
  );
  assert.equal(persistencePlan.steps.length, 1);
  assert.equal(
    persistencePlan.steps[0].command.id,
    contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
  );
  assert.equal(persistencePlan.steps[0].command.lane, "build-bound");
  assert.equal(
    contracts.isResolvedWorkflowPlanDigestValid(persistencePlan),
    true,
  );

  const projectValidation = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.godot-project-validation",
  );
  assert.notEqual(projectValidation, undefined);
  assert.deepEqual(projectValidation.steps, [
    {
      id: "step.godot-project-import",
      commandId: "engine.project-import",
      dependsOn: [],
      onFailure: "blocked",
      approvalCheckpoint: false,
    },
    {
      id: "step.godot-project-validation",
      commandId: "engine.project-validation",
      dependsOn: ["step.godot-project-import"],
      onFailure: "blocked",
      approvalCheckpoint: false,
    },
  ]);
  const projectValidationPlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    projectValidation.id,
    "vertical-slice",
  );
  assert.deepEqual(
    projectValidationPlan.steps.map(({ id, command, dependsOn }) => ({
      id,
      commandId: command.id,
      dependsOn,
    })),
    [
      {
        id: "step.godot-project-import",
        commandId: "engine.project-import",
        dependsOn: [],
      },
      {
        id: "step.godot-project-validation",
        commandId: "engine.project-validation",
        dependsOn: ["step.godot-project-import"],
      },
    ],
  );
  assert.equal(
    contracts.isResolvedWorkflowPlanDigestValid(projectValidationPlan),
    true,
  );

  const initialization = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.project-initialization",
  );
  assert.notEqual(initialization, undefined);
  assert.equal(initialization.lifecycle, "internal");
  assert.equal(
    initialization.input.schemaId,
    contracts.projectInitializationCommandInputSchema.schemaId,
  );
  assert.equal(
    initialization.output.schemaId,
    contracts.projectInitializationReportSchema.schemaId,
  );
  assert.deepEqual(initialization.steps, [
    {
      id: "step.project-initialize",
      commandId: "project.initialize",
      dependsOn: [],
      onFailure: "stop",
      approvalCheckpoint: true,
    },
  ]);
  assert.deepEqual(initialization.requiredEvidence, ["run-receipt"]);
  const initializationPlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    initialization.id,
    "vertical-slice",
  );
  assert.equal(initializationPlan.steps.length, 1);
  assert.equal(initializationPlan.steps[0].command.id, "project.initialize");
  assert.equal(initializationPlan.steps[0].command.lane, "project-write");
  assert.equal(
    contracts.isResolvedWorkflowPlanDigestValid(initializationPlan),
    true,
  );

  const recovery = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === "workflow.pack-recover",
  );
  assert.notEqual(recovery, undefined);
  assert.equal(recovery.lifecycle, "internal");
  assert.equal(
    recovery.input.schemaId,
    contracts.packRecoveryCommandInputSchema.schemaId,
  );
  assert.equal(
    recovery.output.schemaId,
    contracts.packRecoveryCommandOutputSchema.schemaId,
  );
  assert.deepEqual(recovery.steps, [
    {
      id: "step.pack-recover",
      commandId: "pack.recover",
      dependsOn: [],
      onFailure: "stop",
      approvalCheckpoint: true,
    },
  ]);
  assert.deepEqual(recovery.requiredEvidence, [
    "pack-recovery",
    "run-receipt",
  ]);
  const recoveryPlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    recovery.id,
    "vertical-slice",
  );
  assert.equal(recoveryPlan.steps.length, 1);
  assert.equal(recoveryPlan.steps[0].command.id, "pack.recover");
  assert.equal(recoveryPlan.steps[0].command.lane, "project-write");
  assert.equal(contracts.isResolvedWorkflowPlanDigestValid(recoveryPlan), true);

  const reconciliation = registry.BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === contracts.WORKFLOW_RECONCILIATION_WORKFLOW_ID,
  );
  assert.notEqual(reconciliation, undefined);
  assert.equal(reconciliation.lifecycle, "internal");
  assert.equal(
    reconciliation.input.schemaId,
    contracts.workflowReconciliationCommandInputSchema.schemaId,
  );
  assert.equal(
    reconciliation.output.schemaId,
    contracts.workflowReconciliationCommandOutputSchema.schemaId,
  );
  assert.deepEqual(reconciliation.steps, [
    {
      id: contracts.WORKFLOW_RECONCILIATION_STEP_ID,
      commandId: contracts.WORKFLOW_RECONCILIATION_COMMAND_ID,
      dependsOn: [],
      onFailure: "stop",
      approvalCheckpoint: true,
    },
  ]);
  assert.deepEqual(reconciliation.requiredEvidence, [
    "run-receipt",
    "workflow-reconciliation",
  ]);
  const reconciliationPlan = registry.resolveWorkflowPlan(
    registry.BUILTIN_REGISTRY,
    reconciliation.id,
    "vertical-slice",
  );
  assert.equal(reconciliationPlan.steps.length, 1);
  assert.equal(
    reconciliationPlan.steps[0].command.id,
    contracts.WORKFLOW_RECONCILIATION_COMMAND_ID,
  );
  assert.equal(reconciliationPlan.steps[0].command.lane, "project-write");
  assert.equal(
    contracts.isResolvedWorkflowPlanDigestValid(reconciliationPlan),
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
    "pack.doctor",
    "pack.list",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.deepEqual(surfaces.docs.data.commands.map(({ id }) => id), [
    "doctor",
    "engine.capabilities",
    "engine.status",
    "init",
    "pack.doctor",
    "pack.list",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.deepEqual(surfaces.mcp.data.tools.map(({ commandId }) => commandId), [
    "doctor",
    "engine.capabilities",
    "engine.status",
    "init",
    "pack.doctor",
    "pack.list",
    "project.inspect",
    "skill.check",
    "skill.list",
  ]);
  assert.equal(
    surfaces.mcp.data.tools.every(({ enabledByDefault }) => !enabledByDefault),
    true,
  );
  const recoveryCommandId = "project.initialization-recovery.assess";
  assert.equal(
    surfaces.cli.data.commands.some(({ id }) => id === recoveryCommandId),
    false,
  );
  assert.equal(
    surfaces.docs.data.commands.some(({ id }) => id === recoveryCommandId),
    false,
  );
  assert.equal(
    surfaces.mcp.data.tools.some(
      ({ commandId }) => commandId === recoveryCommandId,
    ),
    false,
  );
  assert.equal(
    JSON.stringify(surfaces.skills.data).includes(recoveryCommandId),
    false,
  );
  assert.equal(
    surfaces.mcp.data.tools[0].outputSchemaId,
    contracts.doctorReportSchema.schemaId,
  );
});

test("the builtin registry routes a bounded capability-first game skill catalog", () => {
  const expectedSkillIds = [
    "asset.lifecycle",
    "balance.deterministic-review",
    "build.export-readiness",
    "engine.change-safety",
    "evidence.support-review",
    "feature.contract-planning",
    "gameplay.vertical-slice",
    "performance.budget-review",
    "playtest.deterministic",
    "project.inspection",
    "save-load.integrity",
    "ui.game-qa",
  ];
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.skills.map(({ id }) => id),
    expectedSkillIds,
  );

  for (const skill of registry.BUILTIN_REGISTRY.skills) {
    assert.equal(skill.lifecycle, "stable");
    assert.equal(skill.invocation, "model");
    assert.deepEqual(skill.requiredPermissions, ["read-project"]);
    assert.match(skill.body.path, /^skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/u);
    assert.match(skill.body.digest, digestPattern);
    assert.equal(skill.body.maxTokens, 800);
    assert.deepEqual(skill.references, []);
    assert.equal(
      skill.triggers.every((trigger) => trigger.startsWith("Use when")),
      true,
    );
    assert.equal(skill.exclusions.length > 0, true);
    assert.equal(skill.completionCriteria.length > 0, true);
    assert.equal(skill.evidenceDuties.length > 0, true);
  }

  const projectInspection = registry.BUILTIN_REGISTRY.skills.find(
    ({ id }) => id === "project.inspection",
  );
  assert.notEqual(projectInspection, undefined);
  assert.deepEqual(projectInspection.capabilities, [
    "engine.capabilities",
    "project.inspect",
  ]);
  assert.equal(
    projectInspection.body.path,
    "skills/project-inspection/SKILL.md",
  );

  const balanceReview = registry.BUILTIN_REGISTRY.skills.find(
    ({ id }) => id === "balance.deterministic-review",
  );
  assert.notEqual(balanceReview, undefined);
  assert.deepEqual(balanceReview.capabilities, [
    "balance.model",
    "balance.simulate",
    "balance.review",
  ]);
  assert.deepEqual(balanceReview.requiredPermissions, ["read-project"]);
  assert.equal(
    balanceReview.body.path,
    "skills/deterministic-balance-review/SKILL.md",
  );
  assert.equal(
    balanceReview.triggers.some((trigger) =>
      trigger.includes("combat, economy, progression, reward, difficulty"),
    ),
    true,
  );
  assert.equal(
    balanceReview.completionCriteria.some((criterion) =>
      criterion.includes("sensitivity"),
    ),
    true,
  );

  assert.deepEqual(
    registry.BUILTIN_REGISTRY_SURFACES.skills.data.routes.map(({ id }) => id),
    expectedSkillIds,
  );
  for (const route of registry.BUILTIN_REGISTRY_SURFACES.skills.data.routes) {
    assert.equal(
      route.body.digest,
      registry.BUILTIN_REGISTRY.skills.find(({ id }) => id === route.id)?.body
        .digest,
    );
  }
});

test("the builtin registry binds packaged project skills to one managed pack", () => {
  assert.equal(registry.BUILTIN_REGISTRY.packs.length, 1);
  const pack = registry.BUILTIN_REGISTRY.packs[0];
  const skills = registry.BUILTIN_REGISTRY.skills;
  const expectedCapabilities = [
    ...new Set(skills.flatMap(({ capabilities }) => capabilities)),
  ].sort();
  const expectedArtifacts = skills.map((skill) => {
    const name = skill.body.path.split("/")[1];
    return {
      source: skill.body.path,
      target: `.agents/skills/${name}/SKILL.md`,
      digest: skill.body.digest,
      mode: "file",
    };
  });
  const expectedOwnedPaths = expectedArtifacts.flatMap((artifact) => [
    {
      path: artifact.target.slice(0, -"/SKILL.md".length),
      kind: "directory",
    },
    {
      path: artifact.target,
      kind: "file",
      digest: artifact.digest,
    },
  ]);

  assert.equal(pack.id, "pack.project-skills");
  assert.equal(pack.version, "1.0.0");
  assert.equal(pack.kind, "skill");
  assert.equal(pack.lifecycle, "experimental");
  assert.deepEqual(pack.compatibility, {
    controlPlane: { minimum: "0.0.0", maximumExclusive: "1.0.0" },
    operatingSystems: ["windows", "linux", "macos"],
    engines: [],
    hosts: [],
  });
  assert.deepEqual(pack.provides, {
    commands: [],
    skills: skills.map(({ id }) => id),
    workflows: [],
    capabilities: expectedCapabilities,
    schemas: [],
  });
  assert.deepEqual(pack.dependencies, []);
  assert.deepEqual(pack.permissions, ["read-project", "install"]);
  assert.deepEqual(pack.network, { required: false, destinations: [] });
  assert.deepEqual(pack.artifacts, expectedArtifacts);
  assert.deepEqual(pack.ownedPaths, expectedOwnedPaths);
  assert.deepEqual(pack.lifecycleHooks, {});
  assert.deepEqual(pack.license, { status: "unresolved" });
  assert.equal(contracts.isPackManifestDigestValid(pack), true);
  assert.match(pack.digest, digestPattern);
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

test("pack recovery schemas enforce conditional execution outcomes", () => {
  const command = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === contracts.PACK_RECOVERY_COMMAND_ID,
  );
  assert.notEqual(command, undefined);
  const digest = `sha256:${"a".repeat(64)}`;
  const input = {
    schemaVersion: "1.0.0",
    recoveryRunId: "018f6f35-2c9e-7d1a-8a4b-123456789ac0",
    transactionRunId: "018f6f35-2c9e-7d1a-8a4b-123456789abc",
    reportDigest: digest,
    journalSnapshotDigest: digest,
    action: "append-terminal",
    finalOutcome: "committed",
    planDigest: digest,
  };
  const output = {
    schemaVersion: "1.0.0",
    status: "finalized",
    recoveryRunId: input.recoveryRunId,
    transactionRunId: input.transactionRunId,
    action: input.action,
    finalOutcome: input.finalOutcome,
    reportDigest: digest,
    finalReportDigest: digest,
    journalRecordDigest: digest,
    planDigest: digest,
    receiptDigest: digest,
    mutationUncertain: false,
  };

  assert.equal(
    registry.validateRegisteredContractValue(
      registry.BUILTIN_REGISTRY,
      command.input,
      input,
    ).recoveryRunId,
    input.recoveryRunId,
  );
  assert.equal(
    registry.validateRegisteredContractValue(
      registry.BUILTIN_REGISTRY,
      command.output,
      output,
    ).status,
    "finalized",
  );
  const nonFinalizedOutput = {
    schemaVersion: output.schemaVersion,
    recoveryRunId: output.recoveryRunId,
    transactionRunId: output.transactionRunId,
    action: output.action,
    finalOutcome: output.finalOutcome,
    reportDigest: output.reportDigest,
    planDigest: output.planDigest,
    receiptDigest: output.receiptDigest,
  };

  for (const invalidInput of [
    { ...input, extra: true },
    {
      ...input,
      action: "append-reconciliation",
      finalOutcome: "rolled-back",
    },
  ]) {
    assert.throws(
      () =>
        registry.validateRegisteredContractValue(
          registry.BUILTIN_REGISTRY,
          command.input,
          invalidInput,
        ),
      (error) => error?.code === "registered-value-invalid",
    );
  }

  for (const invalidOutput of [
    {
      ...nonFinalizedOutput,
      status: "finalized",
      mutationUncertain: false,
    },
    {
      ...nonFinalizedOutput,
      status: "recovery-required",
      mutationUncertain: false,
    },
    {
      ...nonFinalizedOutput,
      status: "failed",
      mutationUncertain: true,
    },
  ]) {
    assert.throws(
      () =>
        registry.validateRegisteredContractValue(
          registry.BUILTIN_REGISTRY,
          command.output,
          invalidOutput,
        ),
      (error) => error?.code === "registered-value-invalid",
    );
  }
});
