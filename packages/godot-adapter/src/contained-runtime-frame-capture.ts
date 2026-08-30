import {
  GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID,
  GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS,
  GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE,
  GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_STEP_ID,
  GODOT_RUNTIME_FRAME_CAPTURE_TERMINATION_GRACE_MS,
  GODOT_RUNTIME_FRAME_CAPTURE_WORKFLOW_ID,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computePlaytestScenarioDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  parsePortableProjectPath,
  parseSemanticVersion,
  parseStableId,
  playtestScenarioSchema,
  runReceiptSchema,
  runtimeFrameEvidenceSchema,
  type EngineExecutionSnapshotBinding,
  type ExecutionBudgets,
  type GodotVersionProbeReport,
  type PlaytestScenario,
  type PortableProjectPath,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineRunReport,
  type ProjectStage,
  type ResolvedWorkflowPlan,
  type RunReceipt,
  type RuntimeFrameEvidence,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointRecord,
} from "@ai-game-playbook/contracts";
import {
  acquireProjectLane,
  assertAuthorizedPermissionDecision,
  bindWorkflowStepExecutor,
  createWorkflowCheckpoint,
  dispatchProjectWorkflowStep,
  persistWorkflowCheckpoint,
  promoteRunReceiptArtifacts,
  resolveProjectPath,
  writeProjectFileCas,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
  type PermissionSettlementOutcome,
  type ProjectFileCasResult,
  type ProjectLaneLease,
} from "@ai-game-playbook/core";
import { captureEngineExecutionSnapshots } from "@ai-game-playbook/engine-common";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  assertWindowsContainedEngineAdmission,
  consumeWindowsContainedGodotCapturePayload,
  createWindowsContainedEngineAdmission,
  prepareWindowsContainedGodotCaptureRun,
  runWindowsContainedGodotCapture,
  type PreparedWindowsContainedGodotCaptureRun,
  type WindowsContainedGodotCaptureExecution,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";
import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";

import { GodotAdapterBoundaryError } from "./errors.js";
import {
  GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  GODOT_GRAYBOX_SCENARIO_DIGEST,
  verifyGodotGrayboxProjectRoot,
  type GodotGrayboxProjectReport,
} from "./graybox-project.js";
import {
  classifyGodotRuntimeFrameCaptureExecution,
  consumeGodotRuntimeFrameArtifactBytes,
  createGodotRuntimeFrameCaptureExpectation,
  type GodotRuntimeFrameCaptureExpectation,
  type GodotRuntimeFrameCaptureResult,
} from "./runtime-frame-capture-result.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

const commandId: StableId = parseStableId(
  GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID,
);
const workflowId: StableId = parseStableId(
  GODOT_RUNTIME_FRAME_CAPTURE_WORKFLOW_ID,
);
const stepId: StableId = parseStableId(GODOT_RUNTIME_FRAME_CAPTURE_STEP_ID);
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
const captureStorageDirectories = Object.freeze([
  ".ai-game-playbook/screenshots",
  ".ai-game-playbook/evidence/artifacts/manifests",
  ".ai-game-playbook/evidence/artifacts/objects",
  ".ai-game-playbook/evidence/receipts",
  ".ai-game-playbook/locks",
  ".ai-game-playbook/state/workflows",
]);
const workflowCheckpointTtlMs = 5 * 60 * 1_000;
const laneLeaseMs = 2 * 60 * 1_000;
const laneWaitMs = 30_000;
const lanePollMs = 50;

interface RuntimeFrameContainmentBinding {
  readonly admissionDigest: Sha256Digest;
  readonly runRequestDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly decision: "qualified";
  readonly evidenceGrade: "locally-executed";
  readonly expiresAt: string;
}

export interface PrepareGodotContainedRuntimeFrameCaptureRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly scenario: PlaytestScenario;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export interface PreparedGodotContainedRuntimeFrameCapture {
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
    readonly inputBindingDigest: Sha256Digest;
    readonly manifestDigest: typeof GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST;
  };
  readonly snapshot: {
    readonly bindingDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly executableSnapshotDigest: Sha256Digest;
    readonly capturedAt: string;
  };
  readonly containment: RuntimeFrameContainmentBinding;
  readonly storage: {
    readonly sourcePath: PortableProjectPath;
    readonly maximumBytes: typeof GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES;
  };
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

export interface CreateGodotContainedRuntimeFrameCaptureAuthorizationRequest {
  readonly plan: PreparedGodotContainedRuntimeFrameCapture;
  readonly deadlineAt: string;
}

export interface RunGodotContainedRuntimeFrameCaptureRequest {
  readonly plan: PreparedGodotContainedRuntimeFrameCapture;
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
  readonly expectation: GodotRuntimeFrameCaptureExpectation;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotCaptureRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

interface StoredSourceArtifact {
  readonly path: PortableProjectPath;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

interface CaptureDomainResult {
  readonly status: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly code: StableId;
  readonly mutationUncertain: boolean;
  readonly result?: GodotRuntimeFrameCaptureResult;
  readonly report?: ProcessContainmentEngineRunReport;
  readonly frame?: RuntimeFrameEvidence;
  readonly source?: StoredSourceArtifact;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();

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
  const actual = Object.getOwnPropertyNames(value);
  if (
    actual.length !== names.length ||
    !names.every((name) => actual.includes(name))
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
    "godot-capture-preparation-invalid",
    "Godot runtime frame preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "godot-capture-preparation-invalid",
      "Godot runtime frame preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-capture-preparation-invalid",
      "Godot runtime frame preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    return fail(
      "godot-capture-preparation-invalid",
      "Godot runtime frame preparation requires one supported project stage.",
    );
  }
  if (isProxy(record["versionProbe"]) || isProxy(record["scenario"])) {
    return fail(
      "godot-capture-preparation-invalid",
      "Godot runtime frame preparation rejects proxied evidence and scenario values.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    return fail(
      "godot-capture-version-invalid",
      "Godot runtime frame capture requires one valid version report.",
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
      "godot-capture-scenario-invalid",
      "Godot runtime frame capture requires one registered deterministic scenario.",
    );
  }
  if (computePlaytestScenarioDigest(scenario) !== GODOT_GRAYBOX_SCENARIO_DIGEST) {
    return fail(
      "godot-capture-scenario-invalid",
      "Godot runtime frame capture currently accepts only the fixed graybox scenario.",
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
      "godot-capture-version-untrusted",
      "Godot runtime frame capture requires the original same-process version report.",
    );
  }
  if (
    !exactVersionMatch(request.versionProbe) ||
    request.versionProbe.project.id !== request.projectId ||
    request.versionProbe.registryDigest !== BUILTIN_REGISTRY.digest ||
    request.versionProbe.project.identityDigest !== runtime.root.identityDigest ||
    request.versionProbe.project.rootIdentityDigest !== runtime.root.identityDigest ||
    request.versionProbe.executable.digest !== runtime.executable.digest ||
    request.versionProbe.executable.identityDigest !==
      runtime.executable.identityDigest
  ) {
    return fail(
      "godot-capture-version-mismatch",
      "Godot runtime frame version evidence differs from its project or executable authority.",
    );
  }
  return runtime;
}

function resolveCaptureWorkflow(stage: ProjectStage): ResolvedWorkflowPlan {
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
      "godot-capture-workflow-invalid",
      "Godot runtime frame workflow differs from its registered boundary.",
    );
  }
  return workflow;
}

function sourceArtifactPath(runId: string): PortableProjectPath {
  return parsePortableProjectPath(
    `.ai-game-playbook/screenshots/runtime-frame-${runId}.png`,
  );
}

async function assertCaptureStorageReady(
  runtime: GodotVersionProbeRuntimeBinding,
  sourcePath: PortableProjectPath,
): Promise<void> {
  try {
    for (const path of captureStorageDirectories) {
      await resolveProjectPath(runtime.root, path, {
        expectedType: "directory",
        existence: "required",
      });
    }
    await resolveProjectPath(runtime.root, sourcePath, {
      expectedType: "file",
      existence: "forbidden",
    });
  } catch {
    return fail(
      "godot-capture-storage-not-ready",
      "Godot runtime frame storage is missing, linked, or already occupied.",
    );
  }
}

export async function prepareGodotContainedRuntimeFrameCapture(
  value: unknown,
): Promise<PreparedGodotContainedRuntimeFrameCapture> {
  const request = validatePreparationRequest(value);
  const runtime = versionRuntime(request);
  const workflow = resolveCaptureWorkflow(request.projectStage);
  const expectation = createGodotRuntimeFrameCaptureExpectation({
    runId: request.runId,
    scenario: request.scenario,
  });
  const sourcePath = sourceArtifactPath(request.runId);
  await assertCaptureStorageReady(runtime, sourcePath);
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
      "godot-capture-snapshot-failed",
      "Godot runtime frame project and executable snapshots could not be captured safely.",
    );
  }
  if (
    Date.parse(binding.project.capturedAt) <
    Date.parse(request.versionProbe.execution.endedAt)
  ) {
    return fail(
      "godot-capture-snapshot-stale",
      "Godot runtime frame snapshots predate the bound version report.",
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
      "godot-capture-source-invalid",
      "Godot runtime frame capture requires the complete fixed graybox source snapshot.",
    );
  }
  if (
    graybox.scenarioDigest !== expectation.scenarioDigest ||
    graybox.manifestDigest !== GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST
  ) {
    return fail(
      "godot-capture-source-invalid",
      "Godot runtime frame source and scenario identities do not agree.",
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
      invocationDigest: GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-capture-containment-unavailable",
      "Godot runtime frame containment could not be bound to the source snapshot.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotCaptureRun;
  try {
    preparedRun = await prepareWindowsContainedGodotCaptureRun({
      runtime: request.containmentRuntime,
      admission,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      runId: request.runId,
      expectationDigest: expectation.inputBindingDigest,
    });
  } catch {
    return fail(
      "godot-capture-run-preparation-failed",
      "Godot runtime frame execution could not be bound to containment authority.",
    );
  }
  const containment: RuntimeFrameContainmentBinding = deepFreeze({
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
      inputBindingDigest: expectation.inputBindingDigest,
      manifestDigest: GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
    },
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment,
    storage: {
      sourcePath,
      maximumBytes:
        GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES as typeof GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    },
    input: request.scenario,
    support: {
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      liveValidated: false as const,
      reason:
        "Contained fixture execution is available, while installed-engine and export validation remain pending.",
    },
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  const plan: PreparedGodotContainedRuntimeFrameCapture = Object.freeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-runtime-frame-capture",
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

function authorityForPlan(
  plan: PreparedGodotContainedRuntimeFrameCapture,
): PreparedAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-capture-plan-untrusted",
      "Godot runtime frame execution requires one original prepared plan.",
    );
  }
  return authority;
}

export async function assertPreparedGodotContainedRuntimeFrameCapture(
  plan: PreparedGodotContainedRuntimeFrameCapture,
): Promise<void> {
  const authority = authorityForPlan(plan);
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
    plan.scenario.inputBindingDigest !== authority.expectation.inputBindingDigest ||
    plan.scenario.manifestDigest !== authority.graybox.manifestDigest ||
    plan.snapshot.bindingDigest !== authority.binding.bindingDigest ||
    plan.containment.admissionDigest !== authority.admission.admissionDigest ||
    plan.containment.runRequestDigest !== authority.preparedRun.requestDigest ||
    plan.containment.profileDigest !== authority.preparedRun.request.profile.digest ||
    plan.containment.expiresAt !== authority.preparedRun.request.startDeadline ||
    authority.preparedRun.request.inputBindingDigest !==
      authority.expectation.inputBindingDigest
  ) {
    return fail(
      "godot-capture-plan-drift",
      "Godot runtime frame plan no longer matches its same-process authority.",
    );
  }
  const workflow = resolveCaptureWorkflow(authority.workflow.projectStage);
  if (
    workflow.resolvedPlanDigest !== authority.workflow.resolvedPlanDigest ||
    canonicalizeJson(workflow) !== canonicalizeJson(authority.workflow)
  ) {
    return fail(
      "godot-capture-workflow-invalid",
      "Godot runtime frame workflow changed after preparation.",
    );
  }
  try {
    await assertCaptureStorageReady(authority.runtime, plan.storage.sourcePath);
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
        "godot-capture-source-drift",
        "Godot runtime frame source identity changed after preparation.",
      );
    }
    await assertWindowsContainedEngineAdmission({
      admission: authority.admission,
      runtime: authority.containmentRuntime,
      binding: authority.binding,
      root: authority.runtime.root,
      executable: authority.runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
    });
  } catch (error) {
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-capture-authority-invalid",
      "Godot runtime frame capture lost source, storage, executable, or containment authority.",
    );
  }
}

function canonicalTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    return fail(
      "godot-capture-authorization-invalid",
      "Godot runtime frame capture requires one canonical deadline.",
    );
  }
  return value;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 1,
    maxChangedBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    maxDurationMs: GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

function authorizationObjectIds(
  plan: PreparedGodotContainedRuntimeFrameCapture,
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
      plan.scenario.inputBindingDigest,
      plan.scenario.manifestDigest,
      plan.versionProbe.digest,
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
}

export function createGodotContainedRuntimeFrameCaptureAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = exactRecord(
    value,
    ["deadlineAt", "plan"],
    "godot-capture-authorization-invalid",
    "Godot runtime frame authorization contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotContainedRuntimeFrameCapture;
  const authority = authorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-capture-authorization-invalid",
      "Godot runtime frame authorization cannot reuse a consumed plan.",
    );
  }
  const deadlineAt = canonicalTimestamp(record["deadlineAt"]);
  if (
    Date.parse(deadlineAt) > Date.parse(plan.containment.expiresAt) ||
    Date.now() >= Date.parse(deadlineAt)
  ) {
    return fail(
      "godot-capture-authorization-invalid",
      "Godot runtime frame authorization exceeds its prepared start window.",
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
      paths: Object.freeze(
        [...grayboxSourcePaths, plan.storage.sourcePath].sort(),
      ),
      objectIds: authorizationObjectIds(plan),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze(["metadata" as const]),
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
      "godot-capture-authorization-invalid",
      "Godot runtime frame authorization is no longer active.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotContainedRuntimeFrameCapture,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-capture-authorization-invalid",
      "Godot runtime frame authorization must come from the active permission broker.",
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
    command.output.schemaId !== runtimeFrameEvidenceSchema.schemaId ||
    command.output.digest !== runtimeFrameEvidenceSchema.digest ||
    canonicalizeJson(command.permissions) !==
      canonicalizeJson([
        "read-project",
        "host-tool-inspection",
        "test-build",
        "write-project-metadata",
      ]) ||
    command.sideEffects.length !== 2 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== "godot-runtime-frame-capture" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.sideEffects[1]?.kind !== "filesystem" ||
    command.sideEffects[1]?.scope !== "godot-runtime-frame-source" ||
    command.sideEffects[1]?.boundary !== "local" ||
    command.timeoutMs !== GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS ||
    command.cancellation.mode !== "process-tree" ||
    command.cancellation.graceMs !==
      GODOT_RUNTIME_FRAME_CAPTURE_TERMINATION_GRACE_MS ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotRuntimeFrameCapture" ||
    workflow === undefined ||
    workflow.lifecycle !== "internal" ||
    workflow.steps.length !== 1 ||
    step?.id !== stepId ||
    step.commandId !== commandId ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked"
  ) {
    return fail(
      "godot-capture-authorization-invalid",
      "Registered Godot runtime frame authority differs from the executor boundary.",
    );
  }
  const expected = createGodotContainedRuntimeFrameCaptureAuthorizationRequest({
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
    challenge.permissions.length !== 4 ||
    challenge.permissions[0]?.permission !== "host-tool-inspection" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.permissions[1]?.permission !== "read-project" ||
    challenge.permissions[1]?.mode !== "automatic" ||
    challenge.permissions[2]?.permission !== "test-build" ||
    challenge.permissions[2]?.mode !== "automatic" ||
    challenge.permissions[3]?.permission !== "write-project-metadata" ||
    challenge.permissions[3]?.mode !== "approval-required" ||
    challenge.feature !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.workflow) !== canonicalizeJson(expected.workflow) ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 2
  ) {
    return fail(
      "godot-capture-authorization-invalid",
      "Godot runtime frame authorization is not exactly bound to its plan.",
    );
  }
  return authorization;
}

function knownRunRequest(
  value: unknown,
): value is RunGodotContainedRuntimeFrameCaptureRequest {
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

export function isGodotContainedRuntimeFrameCaptureRunRequest(
  value: unknown,
): value is RunGodotContainedRuntimeFrameCaptureRequest {
  return knownRunRequest(value);
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotContainedRuntimeFrameCapture;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: PreparedAuthority;
} {
  if (!knownRunRequest(value)) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot runtime frame capture requires one exact same-process request.",
    );
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")
    ?.value as PreparedGodotContainedRuntimeFrameCapture;
  const signal = Object.getOwnPropertyDescriptor(value, "signal")?.value;
  if (signal !== null && !(signal instanceof AbortSignal)) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot runtime frame cancellation signal is outside the runtime boundary.",
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

function reportIdentityMatches(
  plan: PreparedGodotContainedRuntimeFrameCapture,
  report: ProcessContainmentEngineRunReport,
): boolean {
  return (
    report.runId === plan.runId &&
    report.requestDigest === plan.containment.runRequestDigest &&
    report.admissionDigest === plan.containment.admissionDigest &&
    report.request.profile.id ===
      GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE.profileId &&
    report.profileDigest === plan.containment.profileDigest &&
    report.profileCatalogDigest === plan.containment.profileCatalogDigest &&
    report.operationId === GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID &&
    report.invocationDigest === GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST &&
    report.inputBindingDigest === plan.scenario.inputBindingDigest &&
    report.snapshotBindingDigest === plan.containment.snapshotBindingDigest &&
    report.projectSnapshotDigest === plan.containment.projectSnapshotDigest &&
    report.executableSnapshotDigest === plan.containment.executableSnapshotDigest
  );
}

function discardCapturePayload(
  execution: WindowsContainedGodotCaptureExecution,
): void {
  try {
    consumeWindowsContainedGodotCapturePayload(execution);
  } catch {
    // A mismatched execution is already untrusted; consumption only drops bytes.
  }
}

function domainStatus(
  result: GodotRuntimeFrameCaptureResult,
): CaptureDomainResult["status"] {
  if (result.status === "capture-passed") return "succeeded";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "uncertain") return "uncertain";
  return "failed";
}

function providerFailure(error: unknown): CaptureDomainResult {
  const cancelled =
    error instanceof Error &&
    "code" in error &&
    error.code === "engine-run-cancelled-before-start";
  const mutationUncertain =
    error instanceof Error &&
    "mutationUncertain" in error &&
    error.mutationUncertain === true;
  return Object.freeze({
    status: cancelled
      ? ("cancelled" as const)
      : mutationUncertain
        ? ("uncertain" as const)
        : ("failed" as const),
    code: parseStableId(
      cancelled
        ? "godot-capture-engine-run-cancelled"
        : mutationUncertain
          ? "godot-capture-engine-run-uncertain"
          : "godot-capture-engine-process-failed",
    ),
    mutationUncertain,
  });
}

function permissionOutcome(
  status: CaptureDomainResult["status"],
): PermissionSettlementOutcome {
  return status === "succeeded"
    ? "succeeded"
    : status === "cancelled"
      ? "cancelled"
      : status === "uncertain"
        ? "uncertain"
        : "failed";
}

function settle(
  authorization: AuthorizedPermissionDecision,
  domain: CaptureDomainResult,
  durationMs: number,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome: permissionOutcome(domain.status),
      mutationUncertain: domain.mutationUncertain,
      actual: {
        changedPaths:
          domain.source === undefined
            ? Object.freeze([])
            : Object.freeze([domain.source.path]),
        changedBytes: domain.source?.bytes ?? 0,
        objectIds: Object.freeze([]),
        destinations:
          domain.report?.effects.networkConnectionEstablished === true
            ? Object.freeze(["network-observed"])
            : Object.freeze([]),
        dataClasses: Object.freeze([]),
        changeKinds:
          domain.source === undefined
            ? Object.freeze([])
            : Object.freeze(["metadata" as const]),
        publishTargets: Object.freeze([]),
        durationMs,
        outputBytes: domain.report?.output.capturedBytes ?? 0,
        repairCycles: 0,
      },
    });
  } catch {
    return fail(
      "godot-capture-settlement-failed",
      "Godot runtime frame effects could not be settled with the permission broker.",
      true,
    );
  }
}

function settleUnhandledAuthorization(
  authorization: AuthorizedPermissionDecision,
  startedAtMs: number,
  effectsMayHaveStarted: boolean,
): void {
  if (authorization.lease.state !== "active") return;
  try {
    authorization.lease.settle({
      outcome: effectsMayHaveStarted ? "uncertain" : "failed",
      mutationUncertain: effectsMayHaveStarted,
      actual: {
        changedPaths: [],
        changedBytes: 0,
        objectIds: [],
        destinations: [],
        dataClasses: [],
        changeKinds: [],
        publishTargets: [],
        durationMs: Math.max(0, Date.now() - startedAtMs),
        outputBytes: 0,
        repairCycles: 0,
      },
    });
  } catch {
    return fail(
      "godot-capture-settlement-failed",
      "Godot runtime frame failure could not close its permission authority.",
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

function componentStatus(
  status: CaptureDomainResult["status"],
): "passed" | "failed" | "cancelled" | "uncertain" {
  return status === "succeeded" ? "passed" : status;
}

function commandDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  if (command === undefined) {
    return fail(
      "godot-capture-receipt-invalid",
      "Godot runtime frame receipt lost its registered command.",
      true,
    );
  }
  return command;
}

function receiptFrom(
  plan: PreparedGodotContainedRuntimeFrameCapture,
  checkpoint: WorkflowCheckpointRecord,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  },
  domain: CaptureDomainResult,
): RunReceipt {
  const command = commandDescriptor();
  const status = receiptStatus(settlement);
  const finalDomainStatus =
    settlement.status === "uncertain" || settlement.status === "scope-violation"
      ? ("uncertain" as const)
      : domain.status;
  const outerStatus =
    domain.report === undefined
      ? componentStatus(finalDomainStatus)
      : domain.report.outcome === "succeeded"
        ? ("passed" as const)
        : domain.report.outcome;
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
      inputDigest: checkpoint.identity.inputDigest,
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
      changedPaths: settlement.actual.changedPaths,
      changedBytes: settlement.actual.changedBytes,
      objectIds: settlement.actual.objectIds,
      destinations: settlement.actual.destinations,
      dataClasses: settlement.actual.dataClasses,
      changeKinds: settlement.actual.changeKinds,
      publishTargets: settlement.actual.publishTargets,
      durationMs: timing.durationMs,
      outputBytes: settlement.actual.outputBytes,
      repairCycles: 0,
    },
    outcomes: {
      outer: {
        status: outerStatus,
        ...(domain.report?.process.exitCode === null ||
        domain.report?.process.exitCode === undefined
          ? {}
          : { exitCode: domain.report.process.exitCode }),
        timedOut:
          domain.report?.termination.cause === "engine-timeout" ||
          domain.report?.termination.cause === "idle-timeout",
      },
      inner: {
        status: componentStatus(finalDomainStatus),
        code: domain.code,
        message:
          finalDomainStatus === "succeeded"
            ? "Runtime frame capture and artifact validation succeeded."
            : finalDomainStatus === "uncertain"
              ? "Runtime frame capture ended without complete trustworthy evidence."
              : finalDomainStatus === "cancelled"
                ? "Runtime frame capture was cancelled after bounded cleanup."
                : "Runtime frame capture produced a bounded failure.",
      },
    },
    mutation: {
      status:
        domain.source === undefined
          ? domain.mutationUncertain
            ? ("uncertain" as const)
            : ("none" as const)
          : ("committed" as const),
      changedFiles:
        domain.source === undefined
          ? Object.freeze([])
          : Object.freeze([
              {
                path: domain.source.path,
                postimageDigest: domain.source.digest,
                bytesDelta: domain.source.bytes,
              },
            ]),
      unexpectedDirtyFiles: Object.freeze([]),
    },
    artifacts:
      domain.source === undefined || domain.frame === undefined
        ? Object.freeze([])
        : Object.freeze([
            {
              artifactId: parseStableId("godot-runtime-frame"),
              kind: parseStableId("runtime-frame-evidence"),
              path: domain.source.path,
              digest: domain.frame.artifactDigest,
              bytes: domain.frame.bytes,
              complete: true,
              createdAt: timing.endedAt,
              commandId,
            },
          ]),
    diagnostics:
      finalDomainStatus === "succeeded"
        ? Object.freeze([])
        : Object.freeze([
            {
              severity: finalDomainStatus === "uncertain" ? "error" as const : "warning" as const,
              code: domain.code,
              message:
                "The runtime frame outcome requires the retained receipt and workflow state.",
              redacted: true,
            },
          ]),
    recovery: {
      attempted: false,
      outcome: "not-run" as const,
      actions: Object.freeze([
        finalDomainStatus === "uncertain"
          ? "Stopped without automatic retry."
          : "No recovery action was required.",
      ]),
    },
  };
  return Object.freeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
}

async function writeSourceArtifact(
  authority: PreparedAuthority,
  plan: PreparedGodotContainedRuntimeFrameCapture,
  result: GodotRuntimeFrameCaptureResult,
  lane: ProjectLaneLease,
): Promise<StoredSourceArtifact> {
  if (
    result.status !== "capture-passed" ||
    result.artifact.status !== "validated" ||
    result.frame === undefined
  ) {
    return fail(
      "godot-capture-artifact-unavailable",
      "Godot runtime frame bytes are unavailable for durable storage.",
      true,
    );
  }
  const bytes = consumeGodotRuntimeFrameArtifactBytes(result.artifact);
  if (
    bytes.byteLength !== result.frame.bytes ||
    bytes.byteLength > plan.storage.maximumBytes
  ) {
    return fail(
      "godot-capture-artifact-mismatch",
      "Godot runtime frame bytes changed before durable storage.",
      true,
    );
  }
  await lane.assertOwned();
  let written: ProjectFileCasResult;
  try {
    written = await writeProjectFileCas({
      root: authority.runtime.root,
      path: plan.storage.sourcePath,
      content: bytes,
      expected: { mode: "absent" },
      maxBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
  } finally {
    bytes.fill(0);
  }
  if (
    written.status !== "created" ||
    written.afterDigest !== result.frame.artifactDigest ||
    written.bytes !== result.frame.bytes
  ) {
    return fail(
      "godot-capture-artifact-write-mismatch",
      "Godot runtime frame source write contradicted its validated artifact.",
      true,
    );
  }
  return Object.freeze({
    path: written.path,
    digest: written.afterDigest,
    bytes: written.bytes,
  });
}

async function releaseLane(lane: ProjectLaneLease): Promise<void> {
  try {
    await lane.release();
  } catch {
    return fail(
      "godot-capture-lane-release-failed",
      "Godot runtime frame project lane could not be released safely.",
      true,
    );
  }
}

function failureCode(domain: CaptureDomainResult): string {
  if (domain.status === "cancelled") return "godot-capture-execution-cancelled";
  if (domain.status === "uncertain") return "godot-capture-execution-uncertain";
  return "godot-capture-execution-failed";
}

export async function runGodotContainedRuntimeFrameCapture(
  value: unknown,
): Promise<RuntimeFrameEvidence> {
  const operationStartedMs = Date.now();
  const request = validateRunRequest(value);
  if (request.signal?.aborted === true) {
    request.authorization.lease.settle({
      outcome: "cancelled",
      mutationUncertain: false,
      actual: {
        changedPaths: [],
        changedBytes: 0,
        objectIds: [],
        destinations: [],
        dataClasses: [],
        changeKinds: [],
        publishTargets: [],
        durationMs: 0,
        outputBytes: 0,
        repairCycles: 0,
      },
    });
    return fail(
      "godot-capture-cancelled-before-admission",
      "Godot runtime frame capture was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedRuntimeFrameCapture(request.plan);
    assertAuthorizationActive(request.authorization);
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      request.authorization.lease.settle({
        outcome: "failed",
        mutationUncertain: false,
        actual: {
          changedPaths: [],
          changedBytes: 0,
          objectIds: [],
          destinations: [],
          dataClasses: [],
          changeKinds: [],
          publishTargets: [],
          durationMs: 0,
          outputBytes: 0,
          repairCycles: 0,
        },
      });
    }
    throw error;
  }
  request.authority.consumed = true;
  let lane: ProjectLaneLease;
  try {
    lane = await acquireProjectLane({
      root: request.authority.runtime.root,
      projectIdentityDigest: request.plan.project.identityDigest,
      runId: request.plan.runId,
      lane: "build-bound",
      leaseDurationMs: laneLeaseMs,
      waitTimeoutMs: laneWaitMs,
      pollIntervalMs: lanePollMs,
      signal: request.signal,
    });
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      request.authorization.lease.settle({
        outcome: "failed",
        mutationUncertain: false,
        actual: {
          changedPaths: [],
          changedBytes: 0,
          objectIds: [],
          destinations: [],
          dataClasses: [],
          changeKinds: [],
          publishTargets: [],
          durationMs: 0,
          outputBytes: 0,
          repairCycles: 0,
        },
      });
    }
    throw error;
  }

  let domain: CaptureDomainResult | undefined;
  let finalSettlement: PermissionSettlement | undefined;
  let terminalStatus: WorkflowCheckpointRecord["status"] | undefined;
  let failure: unknown;
  let effectsMayHaveStarted = false;
  try {
    await lane.assertOwned();
    const initial = await persistWorkflowCheckpoint({
      root: request.authority.runtime.root,
      registry: BUILTIN_REGISTRY,
      checkpoint: createWorkflowCheckpoint({
        registry: BUILTIN_REGISTRY,
        workflowId,
        project: {
          id: request.plan.project.id,
          identityDigest: request.plan.project.identityDigest,
          rootIdentityDigest: request.plan.project.identityDigest,
          stage: request.authority.workflow.projectStage,
        },
        runId: request.plan.runId,
        inputDigest: digestCanonicalJson(request.plan.input),
        ttlMs: workflowCheckpointTtlMs,
      }),
    });
    const approvalIds = Object.freeze(
      [...request.authorization.lease.grantIds]
        .sort()
        .map((entry) => parseStableId(entry)),
    );
    const executor = bindWorkflowStepExecutor({
      registry: BUILTIN_REGISTRY,
      commandId,
      invoke: async ({ authorization, checkpoint, lane: ownedLane, signal }) => {
        const startedMs = Date.now();
        effectsMayHaveStarted = true;
        let current: CaptureDomainResult | undefined;
        let execution: WindowsContainedGodotCaptureExecution | undefined;
        try {
          execution = await runWindowsContainedGodotCapture({
            prepared: request.authority.preparedRun,
            signal,
          });
        } catch (error) {
          current = providerFailure(error);
        }
        if (execution !== undefined) {
          if (!reportIdentityMatches(request.plan, execution.report)) {
            discardCapturePayload(execution);
            current = Object.freeze({
              status: "uncertain" as const,
              code: parseStableId("godot-capture-engine-run-uncertain"),
              mutationUncertain: true,
              report: execution.report,
            });
          } else {
            let result: GodotRuntimeFrameCaptureResult;
            try {
              result = classifyGodotRuntimeFrameCaptureExecution(
                execution,
                request.authority.expectation,
              );
              current = Object.freeze({
                status: domainStatus(result),
                code: parseStableId(result.code),
                mutationUncertain:
                  result.status === "uncertain" ||
                  result.execution.mutationUncertain,
                result,
                report: execution.report,
                ...(result.frame === undefined ? {} : { frame: result.frame }),
              });
            } catch {
              current = Object.freeze({
                status: "uncertain" as const,
                code: parseStableId("godot-capture-engine-run-uncertain"),
                mutationUncertain: true,
                report: execution.report,
              });
            }
          }
        }
        if (current === undefined) {
          current = Object.freeze({
            status: "uncertain" as const,
            code: parseStableId("godot-capture-engine-run-uncertain"),
            mutationUncertain: true,
          });
        }
        if (
          current.status === "succeeded" &&
          current.result !== undefined &&
          current.frame !== undefined
        ) {
          const source = await writeSourceArtifact(
            request.authority,
            request.plan,
            current.result,
            ownedLane,
          );
          current = Object.freeze({ ...current, source });
        }
        const endedMs = Math.max(startedMs, Date.now());
        const settlement = settle(
          authorization,
          current,
          endedMs - startedMs,
        );
        finalSettlement = settlement;
        const receipt = receiptFrom(
          request.plan,
          checkpoint,
          settlement,
          approvalIds,
          {
            startedAt: new Date(startedMs).toISOString(),
            endedAt: new Date(endedMs).toISOString(),
            durationMs: endedMs - startedMs,
          },
          current,
        );
        const promoted = await promoteRunReceiptArtifacts({
          root: request.authority.runtime.root,
          registry: BUILTIN_REGISTRY,
          receipt,
          maxArtifactBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
        });
        validateRegisteredContractValue(
          BUILTIN_REGISTRY,
          { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
          promoted.receipt,
        );
        domain = current;
        return { receipt: promoted.receipt, settlement };
      },
    });
    const dispatched = await dispatchProjectWorkflowStep({
      root: request.authority.runtime.root,
      registry: BUILTIN_REGISTRY,
      stored: initial,
      authorization: request.authorization,
      lane,
      executor,
      signal: request.signal,
      maxArtifactBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
    terminalStatus = dispatched.terminal.checkpoint.status;
  } catch (error) {
    failure = error;
  }

  let releaseFailure: unknown;
  try {
    await releaseLane(lane);
  } catch (error) {
    releaseFailure = error;
  }
  if (releaseFailure !== undefined) {
    settleUnhandledAuthorization(
      request.authorization,
      operationStartedMs,
      true,
    );
    throw releaseFailure;
  }
  if (failure !== undefined) {
    settleUnhandledAuthorization(
      request.authorization,
      operationStartedMs,
      effectsMayHaveStarted,
    );
    throw failure;
  }
  if (domain === undefined) {
    return fail(
      "godot-capture-execution-uncertain",
      "Godot runtime frame workflow completed without a domain result.",
      true,
    );
  }
  const expectedTerminalStatus =
    finalSettlement?.status === "uncertain" ||
    finalSettlement?.status === "scope-violation"
      ? "uncertain"
      : finalSettlement?.status === "cancelled"
        ? "cancelled"
        : finalSettlement?.status === "failed"
          ? "blocked"
          : "succeeded";
  if (
    finalSettlement === undefined ||
    terminalStatus !== expectedTerminalStatus
  ) {
    return fail(
      "godot-capture-execution-uncertain",
      "Godot runtime frame settlement and durable workflow terminal state disagree.",
      true,
    );
  }
  if (finalSettlement.status !== "succeeded") {
    const violations = finalSettlement.violations.join(", ");
    return fail(
      finalSettlement.status === "scope-violation" ||
        finalSettlement.status === "uncertain"
        ? "godot-capture-execution-uncertain"
        : failureCode(domain),
      violations.length === 0
        ? "Godot runtime frame permission settlement did not succeed."
        : `Godot runtime frame permission settlement exceeded: ${violations}.`,
      finalSettlement.mutationUncertain ||
        finalSettlement.status === "scope-violation" ||
        finalSettlement.status === "uncertain",
    );
  }
  if (
    domain.status !== "succeeded" ||
    domain.frame === undefined ||
    domain.source === undefined ||
    request.authorization.lease.state !== "settled"
  ) {
    return fail(
      failureCode(domain),
      "Godot runtime frame capture did not produce retained successful evidence.",
      domain.mutationUncertain || domain.status === "uncertain",
    );
  }
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: runtimeFrameEvidenceSchema.schemaId,
      digest: runtimeFrameEvidenceSchema.digest,
    },
    domain.frame,
  ) as unknown as RuntimeFrameEvidence;
  if (
    validated.artifactDigest !== domain.source.digest ||
    validated.bytes !== domain.source.bytes ||
    validated.runId !== request.plan.runId ||
    validated.projectIdentityDigest !== request.plan.project.identityDigest
  ) {
    return fail(
      "godot-capture-evidence-mismatch",
      "Godot runtime frame evidence differs from its retained source artifact.",
      true,
    );
  }
  return validated;
}

export async function runGodotRuntimeFrameCapture(
  value: unknown,
): Promise<RuntimeFrameEvidence> {
  if (!isGodotContainedRuntimeFrameCaptureRunRequest(value)) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot runtime frame capture is available only through its prepared internal workflow.",
    );
  }
  return runGodotContainedRuntimeFrameCapture(value);
}
