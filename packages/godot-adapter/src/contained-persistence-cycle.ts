import {
  GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
  GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS,
  GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE,
  GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
  GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
  GODOT_PERSISTENCE_CYCLE_STEP_ID,
  GODOT_PERSISTENCE_CYCLE_TERMINATION_GRACE_MS,
  GODOT_PERSISTENCE_CYCLE_WORKFLOW_ID,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertGodotPersistenceCycleReportSemantics,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computeGodotPersistenceCycleReportDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  godotPersistenceCycleExpectationSchema,
  godotPersistenceCycleReportSchema,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  type EngineExecutionSnapshotBinding,
  type ExecutionBudgets,
  type GodotPersistenceCycleContainmentBinding,
  type GodotPersistenceCycleEngineRunEvidence,
  type GodotPersistenceCycleExpectation,
  type GodotPersistenceCycleOutputInvalidCode,
  type GodotPersistenceCycleReport,
  type GodotPersistenceCycleReportCode,
  type GodotPersistenceCycleReportDigestInput,
  type GodotPersistenceCycleTranscript,
  type GodotPersistenceCycleTranscriptSummary,
  type GodotVersionProbeReport,
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
  consumeWindowsContainedGodotPersistenceTranscript,
  createWindowsContainedEngineAdmission,
  prepareWindowsContainedGodotPersistenceRun,
  runWindowsContainedGodotPersistence,
  type PreparedWindowsContainedGodotPersistenceRun,
  type WindowsContainedGodotPersistenceExecution,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";
import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";

import { GodotAdapterBoundaryError } from "./errors.js";
import {
  GODOT_GRAYBOX_FRESH_STATE_HASH,
  GODOT_GRAYBOX_PERSISTED_STATE_HASH,
  GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  verifyGodotGrayboxProjectRoot,
  type GodotGrayboxProjectReport,
} from "./graybox-project.js";
import {
  createGodotPersistenceCycleExpectation,
  parseGodotPersistenceCycleOutput,
} from "./persistence-cycle-result.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

const commandId = parseStableId(GODOT_PERSISTENCE_CYCLE_COMMAND_ID) as StableId &
  typeof GODOT_PERSISTENCE_CYCLE_COMMAND_ID;
const workflowId = parseStableId(
  GODOT_PERSISTENCE_CYCLE_WORKFLOW_ID,
) as StableId & typeof GODOT_PERSISTENCE_CYCLE_WORKFLOW_ID;
const stepId = parseStableId(GODOT_PERSISTENCE_CYCLE_STEP_ID) as StableId &
  typeof GODOT_PERSISTENCE_CYCLE_STEP_ID;
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
  "addons/ai_game_playbook/validators/project_validation.gd",
  "manifest.json",
  "project.godot",
  "scenario.json",
  "scenes/main.tscn",
  "scripts/graybox_game.gd",
  "scripts/graybox_persistence.gd",
  "scripts/graybox_replay.gd",
]);

export interface PrepareGodotContainedPersistenceCycleRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export interface PreparedGodotContainedPersistenceCycle {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly commandId: typeof commandId;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: typeof workflowId;
    readonly version: "1.0.0";
    readonly stepId: typeof stepId;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
    readonly sourceDigest: Sha256Digest;
    readonly manifestDigest: typeof GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST;
    readonly mainScene: "scenes/main.tscn";
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
  readonly persistence: {
    readonly expectationDigest: Sha256Digest;
    readonly saveSchemaVersion: "1.0.0";
    readonly freshStateHash: typeof GODOT_GRAYBOX_FRESH_STATE_HASH;
    readonly persistedStateHash: typeof GODOT_GRAYBOX_PERSISTED_STATE_HASH;
  };
  readonly snapshot: {
    readonly bindingDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly executableSnapshotDigest: Sha256Digest;
    readonly capturedAt: string;
  };
  readonly containment: GodotPersistenceCycleContainmentBinding;
  readonly input: GodotPersistenceCycleExpectation;
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

export interface CreateGodotContainedPersistenceCycleAuthorizationRequest {
  readonly plan: PreparedGodotContainedPersistenceCycle;
  readonly deadlineAt: string;
}

export interface RunGodotContainedPersistenceCycleRequest {
  readonly plan: PreparedGodotContainedPersistenceCycle;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface ValidatedPreparationRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

interface PreparedAuthority {
  readonly runtime: GodotVersionProbeRuntimeBinding;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly graybox: GodotGrayboxProjectReport;
  readonly expectation: GodotPersistenceCycleExpectation;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotPersistenceRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();
const retainedTranscripts = new WeakMap<
  object,
  GodotPersistenceCycleTranscript
>();

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
      "containmentRuntime",
      "launchWitness",
    ],
    "godot-persistence-preparation-invalid",
    "Godot persistence preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "godot-persistence-preparation-invalid",
      "Godot persistence preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-persistence-preparation-invalid",
      "Godot persistence preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    return fail(
      "godot-persistence-preparation-invalid",
      "Godot persistence preparation requires one supported project stage.",
    );
  }
  if (isProxy(record["versionProbe"])) {
    return fail(
      "godot-persistence-preparation-invalid",
      "Godot persistence preparation rejects proxied version evidence.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    return fail(
      "godot-persistence-version-invalid",
      "Godot persistence requires one valid version report.",
    );
  }
  return Object.freeze({
    runId: record["runId"],
    projectId,
    projectStage: record["projectStage"] as ProjectStage,
    versionProbe,
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
      "godot-persistence-version-untrusted",
      "Godot persistence requires the original same-process version report.",
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
      "godot-persistence-version-mismatch",
      "Godot persistence version evidence does not match its exact project and executable authority.",
    );
  }
  return runtime;
}

function resolvePersistenceWorkflow(stage: ProjectStage): ResolvedWorkflowPlan {
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
      "godot-persistence-workflow-invalid",
      "Godot persistence workflow does not match its registered boundary.",
    );
  }
  return workflow;
}

export async function prepareGodotContainedPersistenceCycle(
  value: unknown,
): Promise<PreparedGodotContainedPersistenceCycle> {
  const request = validatePreparationRequest(value);
  const runtime = versionRuntime(request);
  const workflow = resolvePersistenceWorkflow(request.projectStage);
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
      "godot-persistence-snapshot-failed",
      "Godot persistence project and executable snapshots could not be captured safely.",
    );
  }
  if (
    Date.parse(binding.project.capturedAt) <
    Date.parse(request.versionProbe.execution.endedAt)
  ) {
    return fail(
      "godot-persistence-snapshot-stale",
      "Godot persistence snapshots predate the bound version report.",
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
      "godot-persistence-source-invalid",
      "Godot persistence requires the complete fixed graybox source snapshot.",
    );
  }
  if (
    graybox.projectId !== request.projectId ||
    graybox.manifestDigest !== GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST ||
    graybox.persistence.freshStateHash !== GODOT_GRAYBOX_FRESH_STATE_HASH ||
    graybox.persistence.persistedStateHash !==
      GODOT_GRAYBOX_PERSISTED_STATE_HASH
  ) {
    return fail(
      "godot-persistence-source-invalid",
      "Godot persistence source and state identities do not agree.",
    );
  }
  const expectation = createGodotPersistenceCycleExpectation({
    projectId: request.projectId,
    sourceDigest: graybox.sourceDigest,
    freshStateHash: graybox.persistence.freshStateHash,
    persistedStateHash: graybox.persistence.persistedStateHash,
  });
  let admission: ProcessContainmentEngineAdmission;
  try {
    admission = await createWindowsContainedEngineAdmission({
      runtime: request.containmentRuntime,
      launchWitness: request.launchWitness,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-persistence-containment-unavailable",
      "Godot persistence containment could not be bound to the exact source snapshot.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotPersistenceRun;
  try {
    preparedRun = await prepareWindowsContainedGodotPersistenceRun({
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
      "godot-persistence-run-preparation-failed",
      "Godot persistence execution could not be bound to its containment authority.",
    );
  }
  const containment: GodotPersistenceCycleContainmentBinding = deepFreeze({
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
      sourceDigest: graybox.sourceDigest,
      manifestDigest: graybox.manifestDigest,
      mainScene: graybox.mainScene,
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
    persistence: {
      expectationDigest: expectation.expectationDigest,
      saveSchemaVersion: expectation.saveSchemaVersion,
      freshStateHash: expectation.freshStateHash,
      persistedStateHash: expectation.persistedStateHash,
    },
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment,
    input: expectation,
    support: {
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      liveValidated: false as const,
      reason:
        "Contained persistence execution is available, but exact installed-engine and export validation remain pending.",
    },
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  const plan: PreparedGodotContainedPersistenceCycle = Object.freeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-persistence-cycle",
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

export async function assertPreparedGodotContainedPersistenceCycle(
  plan: PreparedGodotContainedPersistenceCycle,
): Promise<void> {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-persistence-plan-untrusted",
      "Godot persistence plan was not prepared by this process.",
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
    plan.project.sourceDigest !== authority.graybox.sourceDigest ||
    plan.project.manifestDigest !== authority.graybox.manifestDigest ||
    plan.project.mainScene !== authority.graybox.mainScene ||
    plan.persistence.expectationDigest !==
      authority.expectation.expectationDigest ||
    canonicalizeJson(plan.input) !== canonicalizeJson(authority.expectation) ||
    plan.snapshot.bindingDigest !== authority.binding.bindingDigest ||
    plan.containment.admissionDigest !== authority.admission.admissionDigest ||
    plan.containment.runRequestDigest !== authority.preparedRun.requestDigest ||
    plan.containment.profileDigest !== authority.preparedRun.request.profile.digest ||
    plan.containment.expiresAt !== authority.preparedRun.request.startDeadline ||
    authority.preparedRun.request.inputBindingDigest !==
      authority.expectation.expectationDigest
  ) {
    return fail(
      "godot-persistence-plan-drift",
      "Godot persistence plan no longer matches its same-process authority.",
    );
  }
  const workflow = resolvePersistenceWorkflow(authority.workflow.projectStage);
  if (
    workflow.resolvedPlanDigest !== authority.workflow.resolvedPlanDigest ||
    canonicalizeJson(workflow) !== canonicalizeJson(authority.workflow)
  ) {
    return fail(
      "godot-persistence-workflow-invalid",
      "Godot persistence workflow changed after preparation.",
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
      canonicalizeJson(graybox.persistence) !==
        canonicalizeJson(authority.graybox.persistence)
    ) {
      return fail(
        "godot-persistence-source-drift",
        "Godot persistence source identity changed after preparation.",
      );
    }
    await assertWindowsContainedEngineAdmission({
      admission: authority.admission,
      runtime: authority.containmentRuntime,
      binding: authority.binding,
      root: authority.runtime.root,
      executable: authority.runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
    });
  } catch (error) {
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-persistence-authority-invalid",
      "Godot persistence lost its source, executable, or containment authority.",
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
    return fail(code, "Godot persistence requires one canonical deadline.");
  }
  return value;
}

function authorityForPlan(
  plan: PreparedGodotContainedPersistenceCycle,
): PreparedAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-persistence-plan-untrusted",
      "Godot persistence execution requires one original prepared plan.",
    );
  }
  return authority;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

function authorizationObjectIds(
  plan: PreparedGodotContainedPersistenceCycle,
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
      plan.persistence.expectationDigest,
      plan.persistence.freshStateHash,
      plan.persistence.persistedStateHash,
      plan.project.inspectionDigest,
      plan.project.manifestDigest,
      plan.project.sourceDigest,
      plan.versionProbe.digest,
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
}

export function createGodotContainedPersistenceCycleAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = exactRecord(
    value,
    ["deadlineAt", "plan"],
    "godot-persistence-authorization-invalid",
    "Godot persistence authorization contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotContainedPersistenceCycle;
  const authority = authorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-persistence-authorization-invalid",
      "Godot persistence authorization cannot reuse a consumed plan.",
    );
  }
  const deadlineAt = canonicalTimestamp(
    record["deadlineAt"],
    "godot-persistence-authorization-invalid",
  );
  if (
    Date.parse(deadlineAt) > Date.parse(plan.containment.expiresAt) ||
    Date.now() >= Date.parse(deadlineAt)
  ) {
    return fail(
      "godot-persistence-authorization-invalid",
      "Godot persistence authorization exceeds its prepared start window.",
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
      "godot-persistence-authorization-invalid",
      "Godot persistence authorization is no longer active.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotContainedPersistenceCycle,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-persistence-authorization-invalid",
      "Godot persistence authorization must come from the active permission broker.",
    );
  }
  assertAuthorizationActive(authorization);
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  const workflow = BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === workflowId,
  );
  const step = workflow?.steps[0];
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "build-bound" ||
    command.input.schemaId !== godotPersistenceCycleExpectationSchema.schemaId ||
    command.input.digest !== godotPersistenceCycleExpectationSchema.digest ||
    command.output.schemaId !== godotPersistenceCycleReportSchema.schemaId ||
    command.output.digest !== godotPersistenceCycleReportSchema.digest ||
    canonicalizeJson(command.permissions) !==
      canonicalizeJson([
        "read-project",
        "host-tool-inspection",
        "test-build",
      ]) ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== "godot-persistence-cycle" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.timeoutMs !== GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS ||
    command.cancellation.mode !== "process-tree" ||
    command.cancellation.graceMs !==
      GODOT_PERSISTENCE_CYCLE_TERMINATION_GRACE_MS ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotPersistenceCycle" ||
    workflow === undefined ||
    workflow.lifecycle !== "internal" ||
    workflow.steps.length !== 1 ||
    step?.id !== stepId ||
    step.commandId !== commandId ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked"
  ) {
    return fail(
      "godot-persistence-authorization-invalid",
      "Registered Godot persistence authority does not match the executor boundary.",
    );
  }
  const expected = createGodotContainedPersistenceCycleAuthorizationRequest({
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
    canonicalizeJson(challenge.workflow) !==
      canonicalizeJson(expected.workflow) ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !==
      canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 1
  ) {
    return fail(
      "godot-persistence-authorization-invalid",
      "Godot persistence authorization is not exactly bound to its prepared plan.",
    );
  }
  return authorization;
}

function knownRunRequest(
  value: unknown,
): value is RunGodotContainedPersistenceCycleRequest {
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
    !["authorization", "plan", "signal"].every((name) =>
      names.includes(name),
    )
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
  return (
    plan !== null &&
    typeof plan === "object" &&
    preparedAuthorities.has(plan)
  );
}

export function isGodotContainedPersistenceCycleRunRequest(
  value: unknown,
): value is RunGodotContainedPersistenceCycleRequest {
  return knownRunRequest(value);
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotContainedPersistenceCycle;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: PreparedAuthority;
} {
  if (!knownRunRequest(value)) {
    return fail(
      "godot-persistence-execution-invalid",
      "Godot persistence requires one exact same-process execution request.",
    );
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")
    ?.value as PreparedGodotContainedPersistenceCycle;
  const signal = Object.getOwnPropertyDescriptor(value, "signal")?.value;
  if (signal !== null && !(signal instanceof AbortSignal)) {
    return fail(
      "godot-persistence-execution-invalid",
      "Godot persistence cancellation signal is outside the runtime boundary.",
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
      "godot-persistence-settlement-failed",
      "Godot persistence effects could not be settled with the permission broker.",
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
      "godot-persistence-settlement-invalid",
      "Godot persistence settlement returned a non-canonical violation code.",
      true,
    );
  }
}

function commandDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  if (command === undefined) {
    return fail(
      "godot-persistence-receipt-invalid",
      "Godot persistence receipt lost its registered command.",
      true,
    );
  }
  return command;
}

interface PersistenceClassification {
  readonly status: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly code: GodotPersistenceCycleReportCode;
  readonly summary: GodotPersistenceCycleTranscriptSummary;
  readonly transcript?: GodotPersistenceCycleTranscript;
  readonly mutationUncertain: boolean;
}

function unavailableClassification(
  report: ProcessContainmentEngineRunReport,
): PersistenceClassification {
  if (report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-persistence-engine-run-cancelled" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  if (report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-persistence-engine-run-uncertain" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: true,
    });
  }
  if (report.outcome === "failed") {
    return Object.freeze({
      status: "failed" as const,
      code: "godot-persistence-engine-process-failed" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  return Object.freeze({
    status: "uncertain" as const,
    code: "godot-persistence-transcript-unavailable" as const,
    summary: Object.freeze({ status: "unavailable" as const }),
    mutationUncertain: true,
  });
}

function rejectedClassification(
  execution: WindowsContainedGodotPersistenceExecution,
  code: GodotPersistenceCycleOutputInvalidCode,
): PersistenceClassification {
  if (execution.transcript.status !== "available") {
    return unavailableClassification(execution.report);
  }
  const summary = Object.freeze({
    status: "rejected" as const,
    outputDigest: execution.transcript.digest,
    bytes: execution.transcript.bytes,
    code,
  });
  if (execution.report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-persistence-engine-run-uncertain" as const,
      summary,
      mutationUncertain: true,
    });
  }
  if (execution.report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-persistence-engine-run-cancelled" as const,
      summary,
      mutationUncertain: execution.report.mutationUncertain,
    });
  }
  return Object.freeze({
    status: "failed" as const,
    code,
    summary,
    mutationUncertain: execution.report.mutationUncertain,
  });
}

function validatedClassification(
  execution: WindowsContainedGodotPersistenceExecution,
  transcript: GodotPersistenceCycleTranscript,
): PersistenceClassification {
  const summary = Object.freeze({
    status: "validated" as const,
    transcriptDigest: transcript.transcriptDigest,
    outputDigest: transcript.wire.outputDigest,
    bytes: transcript.wire.bytes,
    eventCount: transcript.wire.eventCount,
    terminal: "persistence-cycle-passed" as const,
    terminalCode: "passed" as const,
    saveDigest: transcript.terminal.saveDigest,
    saveBytes: transcript.terminal.saveBytes,
  });
  if (execution.report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-persistence-engine-run-uncertain" as const,
      summary,
      transcript,
      mutationUncertain: true,
    });
  }
  if (execution.report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-persistence-engine-run-cancelled" as const,
      summary,
      transcript,
      mutationUncertain: execution.report.mutationUncertain,
    });
  }
  const passed =
    execution.report.outcome === "succeeded" &&
    execution.report.process.exitCode === 0;
  return Object.freeze({
    status: passed ? ("succeeded" as const) : ("failed" as const),
    code: passed
      ? ("godot-persistence-cycle-passed" as const)
      : ("godot-persistence-exit-outcome-mismatch" as const),
    summary,
    transcript,
    mutationUncertain: execution.report.mutationUncertain,
  });
}

function classifyExecution(
  execution: WindowsContainedGodotPersistenceExecution,
  expectation: GodotPersistenceCycleExpectation,
): PersistenceClassification {
  if (execution.transcript.status !== "available") {
    return unavailableClassification(execution.report);
  }
  let raw: string;
  try {
    raw = consumeWindowsContainedGodotPersistenceTranscript(execution);
  } catch {
    return unavailableClassification(execution.report);
  }
  const parsed = parseGodotPersistenceCycleOutput(raw, expectation);
  if (parsed.status === "invalid") {
    return rejectedClassification(execution, parsed.code);
  }
  const transcript = parsed.transcript;
  if (
    transcript.expectationDigest !== expectation.expectationDigest ||
    transcript.wire.outputDigest !== execution.transcript.digest ||
    transcript.wire.bytes !== execution.transcript.bytes
  ) {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-persistence-engine-run-uncertain" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: true,
    });
  }
  return validatedClassification(execution, transcript);
}

function discardTranscript(
  execution: WindowsContainedGodotPersistenceExecution,
): void {
  if (execution.transcript.status !== "available") return;
  try {
    consumeWindowsContainedGodotPersistenceTranscript(execution);
  } catch {
    // The untrusted report is already being discarded.
  }
}

function engineRunEvidence(
  report: ProcessContainmentEngineRunReport,
): GodotPersistenceCycleEngineRunEvidence {
  if (
    report.request.profile.id !==
      GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE.profileId ||
    report.operationId !== GODOT_PERSISTENCE_CYCLE_COMMAND_ID ||
    report.invocationDigest !== GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST ||
    report.inputBindingDigest === null
  ) {
    return fail(
      "godot-persistence-engine-report-profile-mismatch",
      "Godot persistence evidence requires the exact two-process execution profile.",
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
    operationId: GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
    invocationDigest: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
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
  classification: PersistenceClassification,
  settlement: PermissionSettlement,
): PersistenceClassification {
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
      classification.code === "godot-persistence-transcript-unavailable"
        ? ("godot-persistence-transcript-unavailable" as const)
        : ("godot-persistence-engine-run-uncertain" as const),
    mutationUncertain: true,
  });
}

function resultMessage(classification: PersistenceClassification): string {
  if (classification.status === "succeeded") {
    return "Contained Godot persistence save and restart-load cycle passed.";
  }
  if (classification.status === "cancelled") {
    return "Contained Godot persistence cycle was cancelled after cleanup.";
  }
  if (classification.status === "uncertain") {
    return "Contained Godot persistence cycle ended without trustworthy complete evidence.";
  }
  if (classification.summary.status === "rejected") {
    return "Contained Godot persistence output failed protocol validation.";
  }
  if (classification.summary.status === "validated") {
    return "Contained Godot persistence output disagreed with the native process outcome.";
  }
  return "Contained Godot persistence cycle failed before a transcript was available.";
}

function componentStatus(
  value: "succeeded" | "failed" | "cancelled" | "uncertain",
): "passed" | "failed" | "cancelled" | "uncertain" {
  return value === "succeeded" ? "passed" : value;
}

function receiptFrom(
  plan: PreparedGodotContainedPersistenceCycle,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  },
  classification: PersistenceClassification,
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
      "godot-persistence-receipt-persistence-failed",
      "Godot persistence receipt could not be retained safely.",
      mutationUncertain ||
        (error instanceof Error &&
          "mutationUncertain" in error &&
          error.mutationUncertain === true),
    );
  }
}

function reportFrom(
  plan: PreparedGodotContainedPersistenceCycle,
  engineRun: ProcessContainmentEngineRunReport,
  classification: PersistenceClassification,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  receipt: RunReceipt,
  stored: Awaited<ReturnType<typeof persistRunReceipt>>,
): GodotPersistenceCycleReport {
  const final = finalClassification(classification, settlement);
  const digestInput: GodotPersistenceCycleReportDigestInput = deepFreeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    runId: plan.runId,
    workflow: plan.workflow,
    project: plan.project,
    executable: plan.executable,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: plan.versionProbe,
    persistence: plan.persistence,
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
        "Contained persistence evidence was retained, but exact installed-engine runtime capture and Windows export validation remain pending.",
    },
    mutationPerformed:
      !engineRun.effects.sourceProjectPreserved ||
      !engineRun.effects.sourceExecutablePreserved,
    externalProcessStarted: engineRun.process.started,
    networkAccessPerformed: engineRun.effects.networkConnectionEstablished,
  });
  const result = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
    ...digestInput,
    reportDigest: computeGodotPersistenceCycleReportDigest(digestInput),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: godotPersistenceCycleReportSchema.schemaId,
      digest: godotPersistenceCycleReportSchema.digest,
    },
    result,
  ) as unknown as GodotPersistenceCycleReport;
  assertGodotPersistenceCycleReportSemantics(validated);
  if (final.transcript !== undefined) {
    retainedTranscripts.set(validated, final.transcript);
  }
  return validated;
}

function reportIdentityMatches(
  plan: PreparedGodotContainedPersistenceCycle,
  report: ProcessContainmentEngineRunReport,
): boolean {
  return (
    report.runId === plan.runId &&
    report.requestDigest === plan.containment.runRequestDigest &&
    report.admissionDigest === plan.containment.admissionDigest &&
    report.request.profile.id ===
      GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE.profileId &&
    report.profileDigest === plan.containment.profileDigest &&
    report.profileCatalogDigest === plan.containment.profileCatalogDigest &&
    report.operationId === GODOT_PERSISTENCE_CYCLE_COMMAND_ID &&
    report.invocationDigest === GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST &&
    report.inputBindingDigest === plan.persistence.expectationDigest &&
    report.snapshotBindingDigest === plan.containment.snapshotBindingDigest &&
    report.projectSnapshotDigest === plan.containment.projectSnapshotDigest &&
    report.executableSnapshotDigest ===
      plan.containment.executableSnapshotDigest
  );
}

function classificationForProviderError(
  cancelled: boolean,
  mutationUncertain: boolean,
): PersistenceClassification {
  return Object.freeze({
    status: cancelled
      ? ("cancelled" as const)
      : mutationUncertain
        ? ("uncertain" as const)
        : ("failed" as const),
    code: cancelled
      ? ("godot-persistence-engine-run-cancelled" as const)
      : mutationUncertain
        ? ("godot-persistence-engine-run-uncertain" as const)
        : ("godot-persistence-engine-process-failed" as const),
    summary: Object.freeze({ status: "unavailable" as const }),
    mutationUncertain,
  });
}

function cancellationRequested(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

export async function runGodotContainedPersistenceCycle(
  value: unknown,
): Promise<GodotPersistenceCycleReport> {
  const request = validateRunRequest(value);
  if (cancellationRequested(request.signal)) {
    settle(request.authorization, "cancelled", false, 0, 0, false);
    return fail(
      "godot-persistence-cancelled-before-admission",
      "Godot persistence was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedPersistenceCycle(request.plan);
    assertAuthorizationActive(request.authorization);
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", false, 0, 0, false);
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-persistence-authority-invalid",
      "Godot persistence lost its authority before dispatch.",
    );
  }
  request.authority.consumed = true;
  const approvalIds = Object.freeze(
    [...request.authorization.lease.grantIds]
      .sort()
      .map((entry) => parseStableId(entry)),
  );
  const dispatchStartedMs = Date.now();
  let execution: WindowsContainedGodotPersistenceExecution;
  try {
    execution = await runWindowsContainedGodotPersistence({
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
        ? "godot-persistence-execution-cancelled"
        : mutationUncertain
          ? "godot-persistence-execution-uncertain"
          : "godot-persistence-execution-failed",
      "Godot persistence did not return a trustworthy native report.",
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
    const classification: PersistenceClassification = Object.freeze({
      status: "uncertain",
      code: "godot-persistence-engine-run-uncertain",
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
      "godot-persistence-execution-uncertain",
      "Godot persistence returned a mismatched native report identity.",
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

export async function runGodotPersistenceCycle(
  value: unknown,
): Promise<GodotPersistenceCycleReport> {
  if (!isGodotContainedPersistenceCycleRunRequest(value)) {
    return fail(
      "godot-persistence-execution-invalid",
      "Godot persistence is available only through its prepared internal workflow.",
    );
  }
  return runGodotContainedPersistenceCycle(value);
}

export function consumeGodotContainedPersistenceCycleTranscript(
  report: unknown,
): GodotPersistenceCycleTranscript {
  const transcript =
    report !== null && typeof report === "object"
      ? retainedTranscripts.get(report)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "godot-persistence-transcript-unavailable",
      "Godot persistence transcript is unavailable, cloned, or already consumed.",
    );
  }
  retainedTranscripts.delete(report as object);
  return transcript;
}
