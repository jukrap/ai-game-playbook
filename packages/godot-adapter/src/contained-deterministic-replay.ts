import {
  GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS,
  GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertGodotDeterministicReplayReportSemantics,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computeGodotDeterministicReplayReportDigest,
  computePlaytestScenarioDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  godotDeterministicReplayReportSchema,
  parseSemanticVersion,
  parseStableId,
  playtestScenarioSchema,
  runReceiptSchema,
  type EngineExecutionSnapshotBinding,
  type ExecutionBudgets,
  type GodotDeterministicReplayContainmentBinding,
  type GodotDeterministicReplayEngineRunEvidence,
  type GodotDeterministicReplayOutputInvalidCode,
  type GodotDeterministicReplayReport,
  type GodotDeterministicReplayReportCode,
  type GodotDeterministicReplayReportDigestInput,
  type GodotDeterministicReplayTranscript,
  type GodotDeterministicReplayTranscriptSummary,
  type GodotVersionProbeReport,
  type PlaytestScenario,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineRunReport,
  type ProjectStage,
  type ResolvedWorkflowPlan,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertAuthorizedPermissionDecision,
  persistRunReceipt,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
} from "@ai-game-playbook/core";
import { captureEngineExecutionSnapshots } from "@ai-game-playbook/engine-common";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  assertWindowsContainedEngineAdmission,
  consumeWindowsContainedGodotReplayTranscript,
  createWindowsContainedEngineAdmission,
  prepareWindowsContainedGodotReplayRun,
  runWindowsContainedGodotReplay,
  type PreparedWindowsContainedGodotReplayRun,
  type WindowsContainedGodotReplayExecution,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";
import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  createGodotDeterministicReplayExpectation,
  parseGodotDeterministicReplayOutput,
  type GodotDeterministicReplayExpectation,
} from "./deterministic-replay-result.js";
import { GodotAdapterBoundaryError } from "./errors.js";
import {
  GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  GODOT_GRAYBOX_SCENARIO_DIGEST,
  verifyGodotGrayboxProjectRoot,
  type GodotGrayboxProjectReport,
} from "./graybox-project.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

const commandId: StableId = parseStableId("engine.deterministic-replay");
const workflowId: StableId = parseStableId("workflow.godot-deterministic-replay");
const stepId: StableId = parseStableId("step.godot-deterministic-replay");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const projectStages = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const grayboxSourcePaths = Object.freeze([
  "manifest.json",
  "project.godot",
  "scenario.json",
  "scenes/main.tscn",
  "scripts/graybox_capture.gd",
  "scripts/graybox_game.gd",
  "scripts/graybox_replay.gd",
]);

export interface PrepareGodotContainedDeterministicReplayRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly scenario: PlaytestScenario;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export interface PreparedGodotContainedDeterministicReplay {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly commandId: StableId;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: StableId;
    readonly version: "1.0.0";
    readonly stepId: StableId;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
  };
  readonly executable: {
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
  };
  readonly versionProbe: {
    readonly digest: Sha256Digest;
    readonly status: "matched";
    readonly exactTargetMatch: true;
  };
  readonly scenario: {
    readonly id: StableId;
    readonly digest: typeof GODOT_GRAYBOX_SCENARIO_DIGEST;
    readonly expectationDigest: Sha256Digest;
    readonly manifestDigest: typeof GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST;
  };
  readonly snapshot: {
    readonly bindingDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly executableSnapshotDigest: Sha256Digest;
    readonly capturedAt: string;
  };
  readonly containment: GodotDeterministicReplayContainmentBinding;
  readonly input: PlaytestScenario;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "locally-executed";
    readonly liveValidated: false;
    readonly reason: string;
  };
  readonly effects: {
    readonly engineProcessStarted: false;
    readonly projectMutationPerformed: false;
    readonly networkAccessPerformed: false;
  };
  readonly preparationDigest: Sha256Digest;
}

export interface CreateGodotContainedDeterministicReplayAuthorizationRequest {
  readonly plan: PreparedGodotContainedDeterministicReplay;
  readonly deadlineAt: string;
}

export interface RunGodotContainedDeterministicReplayRequest {
  readonly plan: PreparedGodotContainedDeterministicReplay;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface ValidatedPreparationRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly scenario: PlaytestScenario;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

interface PreparedAuthority {
  readonly runtime: GodotVersionProbeRuntimeBinding;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly graybox: GodotGrayboxProjectReport;
  readonly expectation: GodotDeterministicReplayExpectation;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotReplayRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();
const retainedTranscripts = new WeakMap<object, GodotDeterministicReplayTranscript>();

function fail(
  code: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new GodotAdapterBoundaryError(code, message, mutationUncertain);
}

function exactRecord(
  value: unknown,
  names: readonly string[],
  code: string,
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return fail(code, message);
  }
  const actualNames = Object.getOwnPropertyNames(value);
  if (
    actualNames.length !== names.length ||
    !names.every((name) => actualNames.includes(name))
  ) {
    return fail(code, message);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail(code, message);
    }
  }
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validatePreparationRequest(value: unknown): ValidatedPreparationRequest {
  const record = exactRecord(
    value,
    [
      "runId",
      "projectId",
      "projectStage",
      "versionProbe",
      "scenario",
      "containmentRuntime",
      "launchWitness",
    ],
    "godot-replay-preparation-invalid",
    "Godot replay preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "godot-replay-preparation-invalid",
      "Godot replay preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-replay-preparation-invalid",
      "Godot replay preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    return fail(
      "godot-replay-preparation-invalid",
      "Godot replay preparation requires one supported project stage.",
    );
  }
  if (isProxy(record["versionProbe"]) || isProxy(record["scenario"])) {
    return fail(
      "godot-replay-preparation-invalid",
      "Godot replay preparation rejects proxied evidence and scenario values.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    return fail(
      "godot-replay-version-invalid",
      "Godot replay requires one valid version report.",
    );
  }
  let scenario: PlaytestScenario;
  try {
    scenario = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: playtestScenarioSchema.schemaId,
        digest: playtestScenarioSchema.digest,
      },
      record["scenario"],
    ) as unknown as PlaytestScenario;
  } catch {
    return fail(
      "godot-replay-scenario-invalid",
      "Godot replay requires one registered deterministic scenario.",
    );
  }
  if (computePlaytestScenarioDigest(scenario) !== GODOT_GRAYBOX_SCENARIO_DIGEST) {
    return fail(
      "godot-replay-scenario-invalid",
      "Godot replay currently accepts only the fixed graybox scenario.",
    );
  }
  return Object.freeze({
    runId: record["runId"],
    projectId,
    projectStage: record["projectStage"] as ProjectStage,
    versionProbe,
    scenario: deepFreeze(scenario),
    containmentRuntime:
      record["containmentRuntime"] as WindowsContainmentProviderRuntime,
    launchWitness:
      record["launchWitness"] as WindowsContainedSyntheticLaunchWitness,
  });
}

function exactVersionMatch(report: GodotVersionProbeReport): boolean {
  return (
    report.status === "matched" &&
    report.version?.exactTargetMatch === true &&
    report.version.version === GODOT_VERSION_PROBE_TARGET_VERSION &&
    report.version.releaseStatus === GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS &&
    report.authorization.status === "succeeded"
  );
}

function versionRuntime(
  request: ValidatedPreparationRequest,
): GodotVersionProbeRuntimeBinding {
  const runtime = boundGodotVersionProbeRuntime(request.versionProbe);
  if (runtime === undefined) {
    return fail(
      "godot-replay-version-untrusted",
      "Godot replay requires the original same-process version report.",
    );
  }
  if (
    !exactVersionMatch(request.versionProbe) ||
    request.versionProbe.project.id !== request.projectId ||
    request.versionProbe.registryDigest !== BUILTIN_REGISTRY.digest ||
    request.versionProbe.project.identityDigest !== runtime.root.identityDigest ||
    request.versionProbe.project.rootIdentityDigest !== runtime.root.identityDigest ||
    request.versionProbe.executable.digest !== runtime.executable.digest ||
    request.versionProbe.executable.identityDigest !== runtime.executable.identityDigest
  ) {
    return fail(
      "godot-replay-version-mismatch",
      "Godot replay version evidence does not match its exact project and executable authority.",
    );
  }
  return runtime;
}

function resolveReplayWorkflow(stage: ProjectStage): ResolvedWorkflowPlan {
  const workflow = resolveWorkflowPlan(BUILTIN_REGISTRY, workflowId, stage);
  const step = workflow.steps[0];
  if (
    workflow.workflow.id !== workflowId ||
    workflow.workflow.version !== "1.0.0" ||
    workflow.steps.length !== 1 ||
    step?.id !== stepId ||
    step.command.id !== commandId
  ) {
    return fail(
      "godot-replay-workflow-invalid",
      "Godot replay workflow does not match its registered boundary.",
    );
  }
  return workflow;
}

export async function prepareGodotContainedDeterministicReplay(
  value: unknown,
): Promise<PreparedGodotContainedDeterministicReplay> {
  const request = validatePreparationRequest(value);
  const runtime = versionRuntime(request);
  const workflow = resolveReplayWorkflow(request.projectStage);
  const expectation = createGodotDeterministicReplayExpectation(request.scenario);
  let binding: EngineExecutionSnapshotBinding;
  try {
    binding = await captureEngineExecutionSnapshots({
      root: runtime.root,
      executable: runtime.executable,
      engine: "godot",
      projectInspectionDigest: request.versionProbe.project.inspectionDigest,
    });
  } catch {
    return fail(
      "godot-replay-snapshot-failed",
      "Godot replay project and executable snapshots could not be captured safely.",
    );
  }
  if (
    Date.parse(binding.project.capturedAt) <
    Date.parse(request.versionProbe.execution.endedAt)
  ) {
    return fail(
      "godot-replay-snapshot-stale",
      "Godot replay snapshots predate the bound version report.",
    );
  }
  let graybox: GodotGrayboxProjectReport;
  try {
    graybox = await verifyGodotGrayboxProjectRoot({
      root: runtime.root,
      binding,
      executable: runtime.executable,
    });
  } catch {
    return fail(
      "godot-replay-source-invalid",
      "Godot replay requires the complete fixed graybox source snapshot.",
    );
  }
  if (
    graybox.scenarioDigest !== expectation.scenarioDigest ||
    graybox.manifestDigest !== GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST
  ) {
    return fail(
      "godot-replay-source-invalid",
      "Godot replay source and scenario identities do not agree.",
    );
  }
  let admission: ProcessContainmentEngineAdmission;
  try {
    admission = await createWindowsContainedEngineAdmission({
      runtime: request.containmentRuntime,
      launchWitness: request.launchWitness,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-replay-containment-unavailable",
      "Godot replay containment could not be bound to the exact source snapshot.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotReplayRun;
  try {
    preparedRun = await prepareWindowsContainedGodotReplayRun({
      runtime: request.containmentRuntime,
      admission,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      runId: request.runId,
      expectationDigest: expectation.expectationDigest,
    });
  } catch {
    return fail(
      "godot-replay-run-preparation-failed",
      "Godot replay execution could not be bound to its containment authority.",
    );
  }
  const containment: GodotDeterministicReplayContainmentBinding = deepFreeze({
    admissionDigest: admission.admissionDigest,
    runRequestDigest: preparedRun.requestDigest,
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    providerDescriptorDigest: admission.providerDescriptorDigest,
    providerCatalogDigest: admission.providerCatalogDigest,
    profileDigest: preparedRun.request.profile.digest,
    profileCatalogDigest:
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    snapshotBindingDigest: binding.bindingDigest,
    projectSnapshotDigest: binding.project.snapshotDigest,
    executableSnapshotDigest: binding.executable.snapshotDigest,
    decision: "qualified" as const,
    evidenceGrade: "locally-executed" as const,
    expiresAt: preparedRun.request.startDeadline,
  });
  const body = deepFreeze({
    schemaVersion: "1.0.0" as const,
    runId: request.runId,
    commandId,
    registryDigest: BUILTIN_REGISTRY.digest,
    workflow: {
      id: workflowId,
      version: "1.0.0" as const,
      stepId,
      resolvedPlanDigest: workflow.resolvedPlanDigest,
    },
    project: {
      id: request.projectId,
      identityDigest: runtime.root.identityDigest,
      inspectionDigest: request.versionProbe.project.inspectionDigest,
    },
    executable: {
      digest: runtime.executable.digest,
      identityDigest: runtime.executable.identityDigest,
    },
    versionProbe: {
      digest: request.versionProbe.probeDigest,
      status: "matched" as const,
      exactTargetMatch: true as const,
    },
    scenario: {
      id: expectation.scenarioId,
      digest: GODOT_GRAYBOX_SCENARIO_DIGEST,
      expectationDigest: expectation.expectationDigest,
      manifestDigest: GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
    },
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment,
    input: request.scenario,
    support: {
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      liveValidated: false as const,
      reason:
        "Contained replay is available, but installed-engine runtime capture and export validation remain pending.",
    },
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  const plan: PreparedGodotContainedDeterministicReplay = Object.freeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-deterministic-replay",
      version: "1.0.0",
      plan: body,
    }),
  });
  preparedAuthorities.set(plan, {
    runtime,
    versionProbe: request.versionProbe,
    containmentRuntime: request.containmentRuntime,
    binding,
    graybox,
    expectation,
    admission,
    preparedRun,
    workflow,
    canonicalPlan: canonicalizeJson(plan),
    consumed: false,
  });
  return plan;
}

export async function assertPreparedGodotContainedDeterministicReplay(
  plan: PreparedGodotContainedDeterministicReplay,
): Promise<void> {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-replay-plan-untrusted",
      "Godot replay plan was not prepared by this process.",
    );
  }
  if (
    authority.consumed ||
    canonicalizeJson(plan) !== authority.canonicalPlan ||
    plan.commandId !== commandId ||
    plan.workflow.id !== workflowId ||
    plan.workflow.stepId !== stepId ||
    plan.effects.engineProcessStarted ||
    plan.effects.projectMutationPerformed ||
    plan.effects.networkAccessPerformed ||
    boundGodotVersionProbeRuntime(authority.versionProbe) !== authority.runtime ||
    plan.versionProbe.digest !== authority.versionProbe.probeDigest ||
    !exactVersionMatch(authority.versionProbe) ||
    plan.scenario.digest !== authority.expectation.scenarioDigest ||
    plan.scenario.expectationDigest !== authority.expectation.expectationDigest ||
    plan.scenario.manifestDigest !== authority.graybox.manifestDigest ||
    plan.snapshot.bindingDigest !== authority.binding.bindingDigest ||
    plan.containment.admissionDigest !== authority.admission.admissionDigest ||
    plan.containment.runRequestDigest !== authority.preparedRun.requestDigest ||
    plan.containment.profileDigest !== authority.preparedRun.request.profile.digest ||
    plan.containment.expiresAt !== authority.preparedRun.request.startDeadline ||
    authority.preparedRun.request.inputBindingDigest !==
      authority.expectation.expectationDigest
  ) {
    return fail(
      "godot-replay-plan-drift",
      "Godot replay plan no longer matches its same-process authority.",
    );
  }
  const workflow = resolveReplayWorkflow(authority.workflow.projectStage);
  if (
    workflow.resolvedPlanDigest !== authority.workflow.resolvedPlanDigest ||
    canonicalizeJson(workflow) !== canonicalizeJson(authority.workflow)
  ) {
    return fail(
      "godot-replay-workflow-invalid",
      "Godot replay workflow changed after preparation.",
    );
  }
  try {
    const graybox = await verifyGodotGrayboxProjectRoot({
      root: authority.runtime.root,
      binding: authority.binding,
      executable: authority.runtime.executable,
    });
    if (
      graybox.manifestDigest !== authority.graybox.manifestDigest ||
      graybox.sourceDigest !== authority.graybox.sourceDigest ||
      graybox.scenarioDigest !== authority.graybox.scenarioDigest
    ) {
      return fail(
        "godot-replay-source-drift",
        "Godot replay source identity changed after preparation.",
      );
    }
    await assertWindowsContainedEngineAdmission({
      admission: authority.admission,
      runtime: authority.containmentRuntime,
      binding: authority.binding,
      root: authority.runtime.root,
      executable: authority.runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    });
  } catch (error) {
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-replay-authority-invalid",
      "Godot replay lost its source, executable, or containment authority.",
    );
  }
}

function canonicalTimestamp(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    return fail(code, "Godot replay requires one canonical deadline.");
  }
  return value;
}

function authorityForPlan(
  plan: PreparedGodotContainedDeterministicReplay,
): PreparedAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-replay-plan-untrusted",
      "Godot replay execution requires one original prepared plan.",
    );
  }
  return authority;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

function authorizationObjectIds(
  plan: PreparedGodotContainedDeterministicReplay,
): readonly string[] {
  return Object.freeze(
    [
      plan.containment.admissionDigest,
      plan.containment.executableSnapshotDigest,
      plan.containment.policyDigest,
      plan.containment.profileCatalogDigest,
      plan.containment.profileDigest,
      plan.containment.projectSnapshotDigest,
      plan.containment.providerCatalogDigest,
      plan.containment.providerDescriptorDigest,
      plan.containment.runRequestDigest,
      plan.containment.snapshotBindingDigest,
      plan.executable.digest,
      plan.executable.identityDigest,
      plan.project.inspectionDigest,
      plan.scenario.digest,
      plan.scenario.expectationDigest,
      plan.scenario.manifestDigest,
      plan.versionProbe.digest,
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
}

export function createGodotContainedDeterministicReplayAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = exactRecord(
    value,
    ["deadlineAt", "plan"],
    "godot-replay-authorization-invalid",
    "Godot replay authorization contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotContainedDeterministicReplay;
  const authority = authorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-replay-authorization-invalid",
      "Godot replay authorization cannot reuse a consumed plan.",
    );
  }
  const deadlineAt = canonicalTimestamp(
    record["deadlineAt"],
    "godot-replay-authorization-invalid",
  );
  if (
    Date.parse(deadlineAt) > Date.parse(plan.containment.expiresAt) ||
    Date.now() >= Date.parse(deadlineAt)
  ) {
    return fail(
      "godot-replay-authorization-invalid",
      "Godot replay authorization exceeds its prepared start window.",
    );
  }
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId,
    input: plan.input,
    workflow: Object.freeze({
      id: plan.workflow.id,
      stepId: plan.workflow.stepId,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    }),
    scope: Object.freeze({
      paths: grayboxSourcePaths,
      objectIds: authorizationObjectIds(plan),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze([]),
      publishTargets: Object.freeze([]),
    }),
    budgets: authorizationBudgets(),
    deadlineAt,
  });
}

function assertAuthorizationActive(
  authorization: AuthorizedPermissionDecision,
): void {
  const expiresAt = Date.parse(authorization.lease.expiresAt);
  const deadlineAt = Date.parse(authorization.challenge.deadlineAt);
  if (
    authorization.lease.state !== "active" ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(deadlineAt) ||
    expiresAt > deadlineAt ||
    Date.now() >= expiresAt
  ) {
    fail(
      "godot-replay-authorization-invalid",
      "Godot replay authorization is no longer active.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotContainedDeterministicReplay,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-replay-authorization-invalid",
      "Godot replay authorization must come from the active permission broker.",
    );
  }
  assertAuthorizationActive(authorization);
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  const workflow = BUILTIN_REGISTRY.workflows.find(({ id }) => id === workflowId);
  const step = workflow?.steps[0];
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "build-bound" ||
    command.input.schemaId !== playtestScenarioSchema.schemaId ||
    command.input.digest !== playtestScenarioSchema.digest ||
    command.output.schemaId !== godotDeterministicReplayReportSchema.schemaId ||
    command.output.digest !== godotDeterministicReplayReportSchema.digest ||
    canonicalizeJson(command.permissions) !==
      canonicalizeJson([
        "read-project",
        "host-tool-inspection",
        "test-build",
      ]) ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== "godot-deterministic-replay" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.timeoutMs !== GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS ||
    command.cancellation.mode !== "process-tree" ||
    command.cancellation.graceMs !==
      GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotDeterministicReplay" ||
    workflow === undefined ||
    workflow.lifecycle !== "internal" ||
    workflow.steps.length !== 1 ||
    step?.id !== stepId ||
    step.commandId !== commandId ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked"
  ) {
    return fail(
      "godot-replay-authorization-invalid",
      "Registered Godot replay authority does not match the executor boundary.",
    );
  }
  const expected = createGodotContainedDeterministicReplayAuthorizationRequest({
    plan,
    deadlineAt: authorization.challenge.deadlineAt,
  });
  const challenge = authorization.challenge;
  if (
    challenge.runId !== plan.runId ||
    challenge.project.id !== plan.project.id ||
    challenge.project.identityDigest !== plan.project.identityDigest ||
    challenge.registryDigest !== plan.registryDigest ||
    challenge.command.id !== command.id ||
    challenge.command.version !== command.version ||
    challenge.command.handlerDigest !== command.handler.digest ||
    challenge.inputDigest !== digestCanonicalJson(plan.input) ||
    challenge.permissions.length !== 3 ||
    challenge.permissions[0]?.permission !== "host-tool-inspection" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.permissions[1]?.permission !== "read-project" ||
    challenge.permissions[1]?.mode !== "automatic" ||
    challenge.permissions[2]?.permission !== "test-build" ||
    challenge.permissions[2]?.mode !== "automatic" ||
    challenge.feature !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.workflow) !== canonicalizeJson(expected.workflow) ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 1
  ) {
    return fail(
      "godot-replay-authorization-invalid",
      "Godot replay authorization is not exactly bound to its prepared plan.",
    );
  }
  return authorization;
}

function knownRunRequest(
  value: unknown,
): value is RunGodotContainedDeterministicReplayRequest {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== 3 ||
    !["authorization", "plan", "signal"].every((name) => names.includes(name))
  ) {
    return false;
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")?.value;
  return plan !== null && typeof plan === "object" && preparedAuthorities.has(plan);
}

export function isGodotContainedDeterministicReplayRunRequest(
  value: unknown,
): value is RunGodotContainedDeterministicReplayRequest {
  return knownRunRequest(value);
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotContainedDeterministicReplay;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: PreparedAuthority;
} {
  if (!knownRunRequest(value)) {
    return fail(
      "godot-replay-execution-invalid",
      "Godot replay requires one exact same-process execution request.",
    );
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")
    ?.value as PreparedGodotContainedDeterministicReplay;
  const signal = Object.getOwnPropertyDescriptor(value, "signal")?.value;
  if (signal !== null && !(signal instanceof AbortSignal)) {
    return fail(
      "godot-replay-execution-invalid",
      "Godot replay cancellation signal is outside the runtime boundary.",
    );
  }
  return Object.freeze({
    plan,
    authorization: validateAuthorization(
      plan,
      Object.getOwnPropertyDescriptor(value, "authorization")?.value,
    ),
    signal: signal as AbortSignal | null,
    authority: authorityForPlan(plan),
  });
}

function permissionEffects(
  durationMs: number,
  outputBytes: number,
  networkObserved: boolean,
) {
  return {
    changedPaths: Object.freeze([]),
    changedBytes: 0,
    objectIds: Object.freeze([]),
    destinations: networkObserved
      ? Object.freeze(["network-observed"])
      : Object.freeze([]),
    dataClasses: Object.freeze([]),
    changeKinds: Object.freeze([]),
    publishTargets: Object.freeze([]),
    durationMs,
    outputBytes,
    repairCycles: 0,
  };
}

function settle(
  authorization: AuthorizedPermissionDecision,
  outcome: "succeeded" | "failed" | "cancelled" | "uncertain",
  mutationUncertain: boolean,
  durationMs: number,
  outputBytes: number,
  networkObserved: boolean,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome,
      mutationUncertain,
      actual: permissionEffects(durationMs, outputBytes, networkObserved),
    });
  } catch {
    return fail(
      "godot-replay-settlement-failed",
      "Godot replay effects could not be settled with the permission broker.",
      true,
    );
  }
}

function receiptStatus(
  settlement: PermissionSettlement,
): "succeeded" | "failed" | "cancelled" | "uncertain" {
  if (settlement.status === "succeeded") return "succeeded";
  if (settlement.status === "failed") return "failed";
  if (settlement.status === "cancelled") return "cancelled";
  return "uncertain";
}

function stableViolations(
  settlement: PermissionSettlement,
): readonly StableId[] {
  try {
    return Object.freeze(
      settlement.violations.map((entry) => parseStableId(entry)).sort(),
    );
  } catch {
    return fail(
      "godot-replay-settlement-invalid",
      "Godot replay settlement returned a non-canonical violation code.",
      true,
    );
  }
}

function commandDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  if (command === undefined) {
    return fail(
      "godot-replay-receipt-invalid",
      "Godot replay receipt lost its registered command.",
      true,
    );
  }
  return command;
}

interface ReplayClassification {
  readonly status: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly code: GodotDeterministicReplayReportCode;
  readonly summary: GodotDeterministicReplayTranscriptSummary;
  readonly transcript?: GodotDeterministicReplayTranscript;
  readonly mutationUncertain: boolean;
}

function unavailableClassification(
  report: ProcessContainmentEngineRunReport,
): ReplayClassification {
  if (report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-replay-engine-run-cancelled" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  if (report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-replay-engine-run-uncertain" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: true,
    });
  }
  if (report.outcome === "failed") {
    return Object.freeze({
      status: "failed" as const,
      code: "godot-replay-engine-process-failed" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  return Object.freeze({
    status: "uncertain" as const,
    code: "godot-replay-transcript-unavailable" as const,
    summary: Object.freeze({ status: "unavailable" as const }),
    mutationUncertain: true,
  });
}

function rejectedClassification(
  execution: WindowsContainedGodotReplayExecution,
  code: GodotDeterministicReplayOutputInvalidCode,
): ReplayClassification {
  if (execution.transcript.status !== "available") {
    return unavailableClassification(execution.report);
  }
  return Object.freeze({
    status: "failed" as const,
    code,
    summary: Object.freeze({
      status: "rejected" as const,
      outputDigest: execution.transcript.digest,
      bytes: execution.transcript.bytes,
      code,
    }),
    mutationUncertain: execution.report.mutationUncertain,
  });
}

function classifyExecution(
  execution: WindowsContainedGodotReplayExecution,
  expectation: GodotDeterministicReplayExpectation,
): ReplayClassification {
  if (execution.transcript.status !== "available") {
    return unavailableClassification(execution.report);
  }
  let raw: string;
  try {
    raw = consumeWindowsContainedGodotReplayTranscript(execution);
  } catch {
    return unavailableClassification(execution.report);
  }
  const parsed = parseGodotDeterministicReplayOutput(raw, expectation);
  if (parsed.status === "invalid") {
    return rejectedClassification(execution, parsed.code);
  }
  const transcript = parsed.transcript;
  const passed = transcript.terminal.event === "replay-passed";
  const exitMatches = passed
    ? execution.report.outcome === "succeeded" &&
      execution.report.process.exitCode === 0
    : execution.report.outcome === "failed" &&
      execution.report.process.exitCode === 2;
  if (
    !exitMatches ||
    transcript.expectationDigest !== expectation.expectationDigest ||
    transcript.wire.outputDigest !== execution.transcript.digest ||
    transcript.wire.bytes !== execution.transcript.bytes
  ) {
    return rejectedClassification(
      execution,
      "godot-replay-exit-outcome-mismatch",
    );
  }
  const terminalCode =
    transcript.terminal.event === "replay-passed"
      ? ("passed" as const)
      : transcript.terminal.code;
  return Object.freeze({
    status: passed ? ("succeeded" as const) : ("failed" as const),
    code: passed
      ? ("godot-replay-passed" as const)
      : (`godot-replay-${terminalCode}` as GodotDeterministicReplayReportCode),
    summary: Object.freeze({
      status: "validated" as const,
      transcriptDigest: transcript.transcriptDigest,
      outputDigest: transcript.wire.outputDigest,
      bytes: transcript.wire.bytes,
      eventCount: transcript.wire.eventCount,
      oracleCount: transcript.oracles.length,
      terminal: transcript.terminal.event,
      terminalCode,
      terminalTick: transcript.terminal.tick,
    }),
    transcript,
    mutationUncertain: execution.report.mutationUncertain,
  });
}

function discardTranscript(execution: WindowsContainedGodotReplayExecution): void {
  if (execution.transcript.status !== "available") return;
  try {
    consumeWindowsContainedGodotReplayTranscript(execution);
  } catch {
    // Consumption is best-effort here because the report is already untrusted.
  }
}

function engineRunEvidence(
  report: ProcessContainmentEngineRunReport,
): GodotDeterministicReplayEngineRunEvidence {
  if (
    report.request.profile.id !==
      GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId ||
    report.operationId !== "engine.deterministic-replay" ||
    report.invocationDigest !== GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST ||
    report.inputBindingDigest === null
  ) {
    return fail(
      "godot-replay-engine-report-profile-mismatch",
      "Godot replay evidence requires the exact deterministic execution profile.",
      true,
    );
  }
  return deepFreeze({
    requestDigest: report.requestDigest,
    reportDigest: report.reportDigest,
    admissionDigest: report.admissionDigest,
    profileId: report.request.profile.id,
    profileDigest: report.profileDigest,
    profileCatalogDigest: report.profileCatalogDigest,
    operationId: "engine.deterministic-replay" as const,
    invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    inputBindingDigest: report.inputBindingDigest,
    snapshotBindingDigest: report.snapshotBindingDigest,
    projectSnapshotDigest: report.projectSnapshotDigest,
    executableSnapshotDigest: report.executableSnapshotDigest,
    process: report.process,
    output: report.output,
    termination: report.termination,
    effects: report.effects,
    outcome: report.outcome,
    mutationUncertain: report.mutationUncertain,
  });
}

function finalClassification(
  classification: ReplayClassification,
  settlement: PermissionSettlement,
): ReplayClassification {
  if (
    settlement.status !== "uncertain" &&
    settlement.status !== "scope-violation"
  ) {
    return classification;
  }
  return Object.freeze({
    ...classification,
    status: "uncertain" as const,
    code:
      classification.summary.status === "unavailable" &&
      classification.code === "godot-replay-transcript-unavailable"
        ? ("godot-replay-transcript-unavailable" as const)
        : ("godot-replay-engine-run-uncertain" as const),
    mutationUncertain: true,
  });
}

function resultMessage(
  classification: ReplayClassification,
): string {
  if (classification.status === "succeeded") {
    return "Contained Godot deterministic replay passed every declared oracle.";
  }
  if (classification.status === "cancelled") {
    return "Contained Godot deterministic replay was cancelled after cleanup.";
  }
  if (classification.status === "uncertain") {
    return "Contained Godot deterministic replay ended without trustworthy complete evidence.";
  }
  if (classification.summary.status === "validated") {
    return "Contained Godot deterministic replay produced a valid scenario failure.";
  }
  if (classification.summary.status === "rejected") {
    return "Contained Godot deterministic replay output failed protocol validation.";
  }
  return "Contained Godot deterministic replay failed before a transcript was available.";
}

function componentStatus(
  value: "succeeded" | "failed" | "cancelled" | "uncertain",
): "passed" | "failed" | "cancelled" | "uncertain" {
  return value === "succeeded" ? "passed" : value;
}

function receiptFrom(
  plan: PreparedGodotContainedDeterministicReplay,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  },
  classification: ReplayClassification,
  engineRun?: ProcessContainmentEngineRunReport,
): RunReceipt {
  const command = commandDescriptor();
  const status = receiptStatus(settlement);
  const innerStatus = componentStatus(status);
  const outerStatus =
    engineRun === undefined
      ? innerStatus
      : componentStatus(engineRun.outcome);
  const body = {
    schemaVersion: runReceiptSchema.version,
    receiptId: randomUUID(),
    status,
    identity: {
      runId: plan.runId,
      workflowId: plan.workflow.id,
      stepId: plan.workflow.stepId,
      attempt: 1,
      phase: "command" as const,
      projectId: plan.project.id,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: command.id,
        version: command.version,
        descriptorDigest: digestCanonicalJson(command),
      },
      registryDigest: BUILTIN_REGISTRY.digest,
      handlerDigest: command.handler.digest,
      inputDigest: digestCanonicalJson(plan.input),
      authorizationId: settlement.authorizationId,
      authorizationRequestDigest: settlement.requestDigest,
      packDigests: Object.freeze([]),
      approvalIds,
    },
    environment: {
      platform: "windows" as const,
      architecture: "x64" as const,
      nodeVersion: parseSemanticVersion(process.versions.node).value,
      projectIdentityDigest: plan.project.identityDigest,
      engine: {
        id: "godot" as const,
        version: GODOT_VERSION_PROBE_TARGET_VERSION,
      },
    },
    timing,
    effects: {
      changedPaths: Object.freeze([]),
      changedBytes: 0,
      objectIds: Object.freeze([]),
      destinations: settlement.actual.destinations,
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze([]),
      publishTargets: Object.freeze([]),
      durationMs: timing.durationMs,
      outputBytes: settlement.actual.outputBytes,
      repairCycles: 0,
    },
    outcomes: {
      outer: {
        status: outerStatus,
        ...(typeof engineRun?.process.exitCode === "number"
          ? { exitCode: engineRun.process.exitCode }
          : {}),
        timedOut:
          engineRun?.termination.cause === "engine-timeout" ||
          engineRun?.termination.cause === "idle-timeout",
      },
      inner: {
        status: innerStatus,
        code: parseStableId(classification.code),
        message: resultMessage(classification),
      },
    },
    mutation: {
      status: settlement.mutationUncertain
        ? ("uncertain" as const)
        : ("none" as const),
      changedFiles: Object.freeze([]),
      unexpectedDirtyFiles: Object.freeze([]),
    },
    artifacts: Object.freeze([]),
    diagnostics: Object.freeze([
      {
        severity:
          status === "succeeded"
            ? ("info" as const)
            : status === "cancelled"
              ? ("warning" as const)
              : ("error" as const),
        code: parseStableId(classification.code),
        message: resultMessage(classification),
        redacted: true,
      },
    ]),
    recovery: {
      attempted: false,
      outcome: "not-run" as const,
      actions: Object.freeze([]),
    },
  };
  const receipt = Object.freeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
  return validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: runReceiptSchema.schemaId,
      digest: runReceiptSchema.digest,
    },
    receipt,
  ) as unknown as RunReceipt;
}

async function retainReceipt(
  authority: PreparedAuthority,
  receipt: RunReceipt,
  mutationUncertain: boolean,
) {
  try {
    return await persistRunReceipt({
      root: authority.runtime.root,
      registry: BUILTIN_REGISTRY,
      receipt,
      maxArtifactBytes: 0,
    });
  } catch (error) {
    throw new GodotAdapterBoundaryError(
      "godot-replay-receipt-persistence-failed",
      "Godot replay receipt could not be retained safely.",
      mutationUncertain ||
        (error instanceof Error &&
          "mutationUncertain" in error &&
          error.mutationUncertain === true),
    );
  }
}

function reportFrom(
  plan: PreparedGodotContainedDeterministicReplay,
  engineRun: ProcessContainmentEngineRunReport,
  classification: ReplayClassification,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  receipt: RunReceipt,
  stored: Awaited<ReturnType<typeof persistRunReceipt>>,
): GodotDeterministicReplayReport {
  const final = finalClassification(classification, settlement);
  const digestInput: GodotDeterministicReplayReportDigestInput = deepFreeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    runId: plan.runId,
    project: plan.project,
    executable: plan.executable,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: plan.versionProbe,
    scenario: {
      id: plan.scenario.id,
      digest: plan.scenario.digest,
      expectationDigest: plan.scenario.expectationDigest,
    },
    containment: plan.containment,
    execution: {
      processStarted: engineRun.process.started,
      startedAt: engineRun.startedAt,
      endedAt: engineRun.completedAt,
      durationMs: engineRun.durationMs,
    },
    status: final.status,
    code: final.code,
    transcript: final.summary,
    authorization: {
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: settlement.status,
      mutationUncertain: settlement.mutationUncertain,
      violations: stableViolations(settlement),
      approvalIds,
      durationMs: settlement.actual.durationMs,
      outputBytes: settlement.actual.outputBytes,
      settledAt: settlement.settledAt,
    },
    engineRun: engineRunEvidence(engineRun),
    receipt: {
      status: "retained" as const,
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
      headDigest: stored.headDigest,
      chainLength: stored.chainLength,
    },
    support: {
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      liveValidated: false as const,
      reason:
        "Contained replay evidence was retained, but installed-engine runtime capture, save/load, and Windows export validation remain pending.",
    },
    mutationPerformed:
      !engineRun.effects.sourceProjectPreserved ||
      !engineRun.effects.sourceExecutablePreserved,
    externalProcessStarted: engineRun.process.started,
    networkAccessPerformed: engineRun.effects.networkConnectionEstablished,
  });
  const result = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: "engine.deterministic-replay" as const,
    ...digestInput,
    reportDigest: computeGodotDeterministicReplayReportDigest(digestInput),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: godotDeterministicReplayReportSchema.schemaId,
      digest: godotDeterministicReplayReportSchema.digest,
    },
    result,
  ) as unknown as GodotDeterministicReplayReport;
  assertGodotDeterministicReplayReportSemantics(validated);
  if (final.transcript !== undefined) {
    retainedTranscripts.set(validated, final.transcript);
  }
  return validated;
}

function reportIdentityMatches(
  plan: PreparedGodotContainedDeterministicReplay,
  report: ProcessContainmentEngineRunReport,
): boolean {
  return (
    report.runId === plan.runId &&
    report.requestDigest === plan.containment.runRequestDigest &&
    report.admissionDigest === plan.containment.admissionDigest &&
    report.request.profile.id ===
      GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId &&
    report.profileDigest === plan.containment.profileDigest &&
    report.profileCatalogDigest === plan.containment.profileCatalogDigest &&
    report.operationId === "engine.deterministic-replay" &&
    report.invocationDigest === GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST &&
    report.inputBindingDigest === plan.scenario.expectationDigest &&
    report.snapshotBindingDigest === plan.containment.snapshotBindingDigest &&
    report.projectSnapshotDigest === plan.containment.projectSnapshotDigest &&
    report.executableSnapshotDigest === plan.containment.executableSnapshotDigest
  );
}

function classificationForProviderError(
  cancelled: boolean,
  mutationUncertain: boolean,
): ReplayClassification {
  return Object.freeze({
    status: cancelled
      ? ("cancelled" as const)
      : mutationUncertain
        ? ("uncertain" as const)
        : ("failed" as const),
    code: cancelled
      ? ("godot-replay-engine-run-cancelled" as const)
      : mutationUncertain
        ? ("godot-replay-engine-run-uncertain" as const)
        : ("godot-replay-engine-process-failed" as const),
    summary: Object.freeze({ status: "unavailable" as const }),
    mutationUncertain,
  });
}

function cancellationRequested(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

export async function runGodotContainedDeterministicReplay(
  value: unknown,
): Promise<GodotDeterministicReplayReport> {
  const request = validateRunRequest(value);
  if (cancellationRequested(request.signal)) {
    settle(request.authorization, "cancelled", false, 0, 0, false);
    return fail(
      "godot-replay-cancelled-before-admission",
      "Godot replay was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedDeterministicReplay(request.plan);
    assertAuthorizationActive(request.authorization);
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", false, 0, 0, false);
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-replay-authority-invalid",
      "Godot replay lost its authority before dispatch.",
    );
  }
  request.authority.consumed = true;
  const approvalIds = Object.freeze(
    [...request.authorization.lease.grantIds]
      .sort()
      .map((entry) => parseStableId(entry)),
  );
  const dispatchStartedMs = Date.now();
  let execution: WindowsContainedGodotReplayExecution;
  try {
    execution = await runWindowsContainedGodotReplay({
      prepared: request.authority.preparedRun,
      signal: request.signal,
    });
  } catch (error) {
    const endedMs = Math.max(dispatchStartedMs, Date.now());
    const cancelled =
      cancellationRequested(request.signal) &&
      error instanceof Error &&
      "code" in error &&
      error.code === "engine-run-cancelled-before-start";
    const mutationUncertain =
      error instanceof Error &&
      "mutationUncertain" in error &&
      error.mutationUncertain === true;
    const classification = classificationForProviderError(
      cancelled,
      mutationUncertain,
    );
    const settlement = settle(
      request.authorization,
      classification.status,
      classification.mutationUncertain,
      endedMs - dispatchStartedMs,
      0,
      false,
    );
    const receipt = receiptFrom(
      request.plan,
      settlement,
      approvalIds,
      {
        startedAt: new Date(dispatchStartedMs).toISOString(),
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - dispatchStartedMs,
      },
      classification,
    );
    await retainReceipt(request.authority, receipt, mutationUncertain);
    return fail(
      cancelled
        ? "godot-replay-execution-cancelled"
        : mutationUncertain
          ? "godot-replay-execution-uncertain"
          : "godot-replay-execution-failed",
      "Godot replay did not return a trustworthy native report.",
      mutationUncertain || settlement.mutationUncertain,
    );
  }
  if (!reportIdentityMatches(request.plan, execution.report)) {
    discardTranscript(execution);
    const settlement = settle(
      request.authorization,
      "uncertain",
      true,
      execution.report.durationMs,
      execution.report.output.capturedBytes,
      execution.report.effects.networkConnectionEstablished,
    );
    const classification: ReplayClassification = Object.freeze({
      status: "uncertain",
      code: "godot-replay-engine-run-uncertain",
      summary: Object.freeze({ status: "unavailable" }),
      mutationUncertain: true,
    });
    const receipt = receiptFrom(
      request.plan,
      settlement,
      approvalIds,
      {
        startedAt: execution.report.startedAt,
        endedAt: execution.report.completedAt,
        durationMs: execution.report.durationMs,
      },
      classification,
      execution.report,
    );
    await retainReceipt(request.authority, receipt, true);
    return fail(
      "godot-replay-execution-uncertain",
      "Godot replay returned a mismatched native report identity.",
      true,
    );
  }
  const classification = classifyExecution(
    execution,
    request.authority.expectation,
  );
  const settlement = settle(
    request.authorization,
    classification.status,
    classification.mutationUncertain,
    execution.report.durationMs,
    execution.report.output.capturedBytes,
    execution.report.effects.networkConnectionEstablished,
  );
  const final = finalClassification(classification, settlement);
  const receipt = receiptFrom(
    request.plan,
    settlement,
    approvalIds,
    {
      startedAt: execution.report.startedAt,
      endedAt: execution.report.completedAt,
      durationMs: execution.report.durationMs,
    },
    final,
    execution.report,
  );
  const stored = await retainReceipt(
    request.authority,
    receipt,
    settlement.mutationUncertain,
  );
  return reportFrom(
    request.plan,
    execution.report,
    final,
    settlement,
    approvalIds,
    receipt,
    stored,
  );
}

export async function runGodotDeterministicReplay(
  value: unknown,
): Promise<GodotDeterministicReplayReport> {
  if (!isGodotContainedDeterministicReplayRunRequest(value)) {
    return fail(
      "godot-replay-execution-invalid",
      "Godot deterministic replay is available only through its prepared internal workflow.",
    );
  }
  return runGodotContainedDeterministicReplay(value);
}

export function consumeGodotContainedDeterministicReplayTranscript(
  report: unknown,
): GodotDeterministicReplayTranscript {
  const transcript =
    report !== null && typeof report === "object"
      ? retainedTranscripts.get(report)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "godot-replay-transcript-unavailable",
      "Godot replay transcript is unavailable, cloned, or already consumed.",
    );
  }
  retainedTranscripts.delete(report as object);
  return transcript;
}
