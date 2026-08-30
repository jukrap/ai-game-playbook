import {
  GODOT_PROJECT_IMPORT_COMMAND_ID,
  GODOT_PROJECT_IMPORT_COMMAND_TIMEOUT_MS,
  GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
  GODOT_PROJECT_IMPORT_INVOCATION_DIGEST,
  GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
  GODOT_PROJECT_IMPORT_STEP_ID,
  GODOT_PROJECT_IMPORT_TERMINATION_GRACE_MS,
  GODOT_PROJECT_VALIDATION_COMMAND_ID,
  GODOT_PROJECT_VALIDATION_COMMAND_TIMEOUT_MS,
  GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
  GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
  GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  GODOT_PROJECT_VALIDATION_STEP_ID,
  GODOT_PROJECT_VALIDATION_TERMINATION_GRACE_MS,
  GODOT_PROJECT_VALIDATION_WORKFLOW_ID,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertGodotProjectImportReportSemantics,
  assertGodotProjectValidationReportSemantics,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computeGodotProjectImportReportDigest,
  computeGodotProjectValidationReportDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  godotProjectImportReportSchema,
  godotProjectValidationExpectationSchema,
  godotProjectValidationReportSchema,
  parsePortableProjectPath,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  type EngineExecutionSnapshotBinding,
  type ExecutionBudgets,
  type GodotProjectImportReport,
  type GodotProjectImportReportCode,
  type GodotProjectImportReportDigestInput,
  type GodotProjectPhaseContainmentBinding,
  type GodotProjectPhaseEngineRunEvidence,
  type GodotProjectPhaseStatus,
  type GodotProjectValidationExpectation,
  type GodotProjectValidationOutputInvalidCode,
  type GodotProjectValidationReport,
  type GodotProjectValidationReportCode,
  type GodotProjectValidationReportDigestInput,
  type GodotProjectValidationTranscript,
  type GodotProjectValidationTranscriptSummary,
  type GodotVersionProbeReport,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineRunReport,
  type ProcessContainmentEngineExecutionProfile,
  type ProjectStage,
  type ResolvedWorkflowPlan,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertAuthorizedPermissionDecision,
  loadRunReceiptChain,
  persistRunReceipt,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
  type StoredRunReceipt,
} from "@ai-game-playbook/core";
import {
  assertEngineExecutionSnapshotAuthority,
  captureEngineExecutionSnapshots,
} from "@ai-game-playbook/engine-common";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  assertWindowsContainedEngineAdmission,
  consumeWindowsContainedGodotValidationTranscript,
  createWindowsContainedEngineAdmission,
  prepareWindowsContainedGodotImportRun,
  prepareWindowsContainedGodotValidationRun,
  runWindowsContainedGodotImport,
  runWindowsContainedGodotValidation,
  type PreparedWindowsContainedGodotImportRun,
  type PreparedWindowsContainedGodotValidationRun,
  type WindowsContainedGodotValidationExecution,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";
import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";

import { GodotAdapterBoundaryError } from "./errors.js";
import {
  GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  verifyGodotGrayboxProjectRoot,
  type GodotGrayboxProjectReport,
} from "./graybox-project.js";
import {
  createGodotProjectValidationExpectation,
  parseGodotProjectValidationOutput,
} from "./project-validation-result.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

const importCommandId: StableId = parseStableId(
  GODOT_PROJECT_IMPORT_COMMAND_ID,
);
const validationCommandId: StableId = parseStableId(
  GODOT_PROJECT_VALIDATION_COMMAND_ID,
);
const workflowId: StableId = parseStableId(
  GODOT_PROJECT_VALIDATION_WORKFLOW_ID,
);
const importStepId: StableId = parseStableId(GODOT_PROJECT_IMPORT_STEP_ID);
const validationStepId: StableId = parseStableId(
  GODOT_PROJECT_VALIDATION_STEP_ID,
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const projectStages = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const sourcePaths = Object.freeze([
  "addons/ai_game_playbook/validators/project_validation.gd",
  "manifest.json",
  "project.godot",
  "scenario.json",
  "scenes/main.tscn",
  "scripts/graybox_game.gd",
  "scripts/graybox_replay.gd",
]);

export interface PrepareGodotContainedProjectImportRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export interface PreparedGodotContainedProjectImport {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly commandId: typeof GODOT_PROJECT_IMPORT_COMMAND_ID;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: typeof GODOT_PROJECT_VALIDATION_WORKFLOW_ID;
    readonly version: "1.0.0";
    readonly stepId: typeof GODOT_PROJECT_IMPORT_STEP_ID;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
    readonly sourceDigest: Sha256Digest;
    readonly sourceManifestDigest: Sha256Digest;
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
  readonly snapshot: {
    readonly bindingDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly executableSnapshotDigest: Sha256Digest;
    readonly capturedAt: string;
  };
  readonly containment: GodotProjectPhaseContainmentBinding;
  readonly input: GodotProjectValidationExpectation;
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

export interface CreateGodotContainedProjectImportAuthorizationRequest {
  readonly plan: PreparedGodotContainedProjectImport;
  readonly deadlineAt: string;
}

export interface RunGodotContainedProjectImportRequest {
  readonly plan: PreparedGodotContainedProjectImport;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

export interface PrepareGodotContainedProjectValidationRequest {
  readonly importReport: GodotProjectImportReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export interface PreparedGodotContainedProjectValidation {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly commandId: typeof GODOT_PROJECT_VALIDATION_COMMAND_ID;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: typeof GODOT_PROJECT_VALIDATION_WORKFLOW_ID;
    readonly version: "1.0.0";
    readonly stepId: typeof GODOT_PROJECT_VALIDATION_STEP_ID;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly project: PreparedGodotContainedProjectImport["project"];
  readonly executable: PreparedGodotContainedProjectImport["executable"];
  readonly versionProbe: PreparedGodotContainedProjectImport["versionProbe"];
  readonly snapshot: PreparedGodotContainedProjectImport["snapshot"];
  readonly containment: GodotProjectPhaseContainmentBinding;
  readonly importPhase: {
    readonly reportDigest: Sha256Digest;
    readonly engineRunReportDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly sourceManifestDigest: Sha256Digest;
    readonly receiptId: string;
    readonly receiptDigest: Sha256Digest;
    readonly receiptHeadDigest: Sha256Digest;
    readonly receiptChainLength: number;
    readonly completedAt: string;
  };
  readonly input: GodotProjectValidationExpectation;
  readonly support: PreparedGodotContainedProjectImport["support"];
  readonly effects: PreparedGodotContainedProjectImport["effects"];
  readonly preparationDigest: Sha256Digest;
}

export interface CreateGodotContainedProjectValidationAuthorizationRequest {
  readonly plan: PreparedGodotContainedProjectValidation;
  readonly deadlineAt: string;
}

export interface RunGodotContainedProjectValidationRequest {
  readonly plan: PreparedGodotContainedProjectValidation;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface ValidatedImportPreparationRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

interface ImportAuthority {
  readonly runtime: GodotVersionProbeRuntimeBinding;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly graybox: GodotGrayboxProjectReport;
  readonly expectation: GodotProjectValidationExpectation;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotImportRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

interface RetainedImportAuthority {
  readonly authority: ImportAuthority;
  readonly report: GodotProjectImportReport;
  readonly stored: StoredRunReceipt;
  validationPrepared: boolean;
}

interface ValidationAuthority {
  readonly parent: RetainedImportAuthority;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly graybox: GodotGrayboxProjectReport;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotValidationRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

const importAuthorities = new WeakMap<object, ImportAuthority>();
const retainedImports = new WeakMap<object, RetainedImportAuthority>();
const validationAuthorities = new WeakMap<object, ValidationAuthority>();
const retainedValidationTranscripts = new WeakMap<
  object,
  GodotProjectValidationTranscript
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

function canonicalTimestamp(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !timestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    return fail(code, "Godot project phase requires one canonical timestamp.");
  }
  return value;
}

function validateImportPreparationRequest(
  value: unknown,
): ValidatedImportPreparationRequest {
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
    "godot-project-import-preparation-invalid",
    "Godot project import preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "godot-project-import-preparation-invalid",
      "Godot project import preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-project-import-preparation-invalid",
      "Godot project import preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    return fail(
      "godot-project-import-preparation-invalid",
      "Godot project import preparation requires one supported project stage.",
    );
  }
  if (isProxy(record["versionProbe"])) {
    return fail(
      "godot-project-import-preparation-invalid",
      "Godot project import preparation rejects proxied version evidence.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    return fail(
      "godot-project-import-version-invalid",
      "Godot project import requires one valid version report.",
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
  versionProbe: GodotVersionProbeReport,
  projectId: StableId,
): GodotVersionProbeRuntimeBinding {
  const runtime = boundGodotVersionProbeRuntime(versionProbe);
  if (runtime === undefined) {
    return fail(
      "godot-project-version-untrusted",
      "Godot project phases require the original same-process version report.",
    );
  }
  if (
    !exactVersionMatch(versionProbe) ||
    versionProbe.project.id !== projectId ||
    versionProbe.registryDigest !== BUILTIN_REGISTRY.digest ||
    versionProbe.project.identityDigest !== runtime.root.identityDigest ||
    versionProbe.project.rootIdentityDigest !== runtime.root.identityDigest ||
    versionProbe.executable.digest !== runtime.executable.digest ||
    versionProbe.executable.identityDigest !== runtime.executable.identityDigest
  ) {
    return fail(
      "godot-project-version-mismatch",
      "Godot project version evidence does not match its project and executable authority.",
    );
  }
  return runtime;
}

function resolveProjectWorkflow(stage: ProjectStage): ResolvedWorkflowPlan {
  const workflow = resolveWorkflowPlan(BUILTIN_REGISTRY, workflowId, stage);
  const first = workflow.steps[0];
  const second = workflow.steps[1];
  if (
    workflow.workflow.id !== workflowId ||
    workflow.workflow.version !== "1.0.0" ||
    workflow.steps.length !== 2 ||
    first?.id !== importStepId ||
    first.command.id !== importCommandId ||
    first.dependsOn.length !== 0 ||
    second?.id !== validationStepId ||
    second.command.id !== validationCommandId ||
    second.dependsOn.length !== 1 ||
    second.dependsOn[0] !== importStepId
  ) {
    return fail(
      "godot-project-workflow-invalid",
      "Godot project validation workflow does not match its registered two-phase boundary.",
    );
  }
  return workflow;
}

function containmentBinding(
  admission: ProcessContainmentEngineAdmission,
  requestDigest: Sha256Digest,
  profile: ProcessContainmentEngineExecutionProfile,
  binding: EngineExecutionSnapshotBinding,
): GodotProjectPhaseContainmentBinding {
  return deepFreeze({
    admissionDigest: admission.admissionDigest,
    runRequestDigest: requestDigest,
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    providerDescriptorDigest: admission.providerDescriptorDigest,
    providerCatalogDigest: admission.providerCatalogDigest,
    profileDigest: profile.profileDigest,
    profileCatalogDigest:
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    snapshotBindingDigest: binding.bindingDigest,
    projectSnapshotDigest: binding.project.snapshotDigest,
    executableSnapshotDigest: binding.executable.snapshotDigest,
    decision: "qualified" as const,
    evidenceGrade: "locally-executed" as const,
    expiresAt: admission.expiresAt,
  });
}

function preparationSupport() {
  return Object.freeze({
    grade: "planned" as const,
    evidenceGrade: "locally-executed" as const,
    liveValidated: false as const,
    reason:
      "Contained fixture evidence is retained, but exact installed-engine import, runtime capture, save/load, and Windows export validation remain pending.",
  });
}

export async function prepareGodotContainedProjectImport(
  value: unknown,
): Promise<PreparedGodotContainedProjectImport> {
  const request = validateImportPreparationRequest(value);
  const runtime = versionRuntime(request.versionProbe, request.projectId);
  const workflow = resolveProjectWorkflow(request.projectStage);
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
      "godot-project-import-snapshot-failed",
      "Godot project import snapshots could not be captured safely.",
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
      "godot-project-import-source-invalid",
      "Godot project import requires the complete fixed graybox source.",
    );
  }
  const expectation = createGodotProjectValidationExpectation({
    projectId: request.projectId,
    sourceDigest: graybox.sourceDigest,
    mainScene: parsePortableProjectPath(graybox.mainScene),
  });
  let admission: ProcessContainmentEngineAdmission;
  try {
    admission = await createWindowsContainedEngineAdmission({
      runtime: request.containmentRuntime,
      launchWitness: request.launchWitness,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      operationId: GODOT_PROJECT_IMPORT_COMMAND_ID,
      invocationDigest: GODOT_PROJECT_IMPORT_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-project-import-containment-unavailable",
      "Godot project import containment could not be bound to the source snapshot.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotImportRun;
  try {
    preparedRun = await prepareWindowsContainedGodotImportRun({
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
      "godot-project-import-run-preparation-failed",
      "Godot project import could not be bound to its containment authority.",
    );
  }
  const body = deepFreeze({
    schemaVersion: "1.0.0" as const,
    runId: request.runId,
    commandId: GODOT_PROJECT_IMPORT_COMMAND_ID,
    registryDigest: BUILTIN_REGISTRY.digest,
    workflow: {
      id: GODOT_PROJECT_VALIDATION_WORKFLOW_ID,
      version: "1.0.0" as const,
      stepId: GODOT_PROJECT_IMPORT_STEP_ID,
      resolvedPlanDigest: workflow.resolvedPlanDigest,
    },
    project: {
      id: request.projectId,
      identityDigest: runtime.root.identityDigest,
      inspectionDigest: request.versionProbe.project.inspectionDigest,
      sourceDigest: graybox.sourceDigest,
      sourceManifestDigest: binding.project.manifestDigest,
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
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment: containmentBinding(
      admission,
      preparedRun.requestDigest,
      GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
      binding,
    ),
    input: expectation,
    support: preparationSupport(),
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  const plan: PreparedGodotContainedProjectImport = deepFreeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-project-import",
      version: "1.0.0",
      plan: body,
    }),
  });
  importAuthorities.set(plan, {
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

function importAuthorityForPlan(
  plan: unknown,
): ImportAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? importAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-project-import-plan-untrusted",
      "Godot project import plan is missing, cloned, or from another process.",
    );
  }
  return authority;
}

export async function assertPreparedGodotContainedProjectImport(
  plan: unknown,
): Promise<void> {
  const authority = importAuthorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-project-import-plan-consumed",
      "Godot project import plan was already consumed.",
    );
  }
  if (canonicalizeJson(plan) !== authority.canonicalPlan) {
    return fail(
      "godot-project-import-plan-invalid",
      "Godot project import plan no longer matches its preparation.",
    );
  }
  await assertEngineExecutionSnapshotAuthority({
    binding: authority.binding,
    root: authority.runtime.root,
    executable: authority.runtime.executable,
  });
  await assertWindowsContainedEngineAdmission({
    admission: authority.admission,
    runtime: authority.containmentRuntime,
    binding: authority.binding,
    root: authority.runtime.root,
    executable: authority.runtime.executable,
    operationId: GODOT_PROJECT_IMPORT_COMMAND_ID,
    invocationDigest: GODOT_PROJECT_IMPORT_INVOCATION_DIGEST,
  });
  const graybox = await verifyGodotGrayboxProjectRoot({
    root: authority.runtime.root,
    binding: authority.binding,
    executable: authority.runtime.executable,
  });
  if (
    graybox.manifestDigest !== GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST ||
    graybox.sourceDigest !== authority.graybox.sourceDigest
  ) {
    return fail(
      "godot-project-import-source-drift",
      "Godot project import source changed after preparation.",
    );
  }
}

function validateValidationPreparationRequest(value: unknown): {
  readonly parent: RetainedImportAuthority;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
} {
  const record = exactRecord(
    value,
    ["importReport", "containmentRuntime", "launchWitness"],
    "godot-project-validation-preparation-invalid",
    "Godot project validation preparation contains undeclared fields.",
  );
  const importReport = record["importReport"];
  const parent =
    importReport !== null && typeof importReport === "object"
      ? retainedImports.get(importReport)
      : undefined;
  if (parent === undefined) {
    return fail(
      "godot-project-validation-import-untrusted",
      "Godot project validation requires the original retained import report.",
    );
  }
  if (parent.validationPrepared) {
    return fail(
      "godot-project-validation-import-consumed",
      "Godot project import report already prepared its validation successor.",
    );
  }
  try {
    assertGodotProjectImportReportSemantics(importReport);
  } catch {
    return fail(
      "godot-project-validation-import-invalid",
      "Godot project import report no longer matches its contract.",
    );
  }
  if (
    importReport !== parent.report ||
    canonicalizeJson(importReport) !== canonicalizeJson(parent.report) ||
    importReport.status !== "succeeded" ||
    importReport.code !== "godot-project-import-passed" ||
    importReport.authorization.status !== "succeeded" ||
    importReport.engineRun.outcome !== "succeeded" ||
    importReport.receipt.receiptDigest !== parent.stored.receipt.receiptDigest ||
    importReport.receipt.headDigest !== parent.stored.headDigest ||
    importReport.receipt.chainLength !== parent.stored.chainLength
  ) {
    return fail(
      "godot-project-validation-import-incomplete",
      "Godot project validation requires one complete successful import predecessor.",
    );
  }
  if (record["containmentRuntime"] !== parent.authority.containmentRuntime) {
    return fail(
      "godot-project-validation-runtime-mismatch",
      "Godot project validation must use the import phase containment runtime.",
    );
  }
  return Object.freeze({
    parent,
    containmentRuntime:
      record["containmentRuntime"] as WindowsContainmentProviderRuntime,
    launchWitness:
      record["launchWitness"] as WindowsContainedSyntheticLaunchWitness,
  });
}

async function assertRetainedImportReceiptCurrent(
  parent: RetainedImportAuthority,
): Promise<void> {
  let loaded: Awaited<ReturnType<typeof loadRunReceiptChain>>;
  try {
    loaded = await loadRunReceiptChain({
      root: parent.authority.runtime.root,
      registry: BUILTIN_REGISTRY,
      runId: parent.report.runId,
      projectId: parent.report.project.id,
      projectIdentityDigest: parent.report.project.identityDigest,
      workflowId,
      resolvedPlanDigest: parent.report.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    });
  } catch {
    return fail(
      "godot-project-validation-import-receipt-invalid",
      "Godot project validation requires its current durable import receipt.",
    );
  }
  if (
    loaded.receipts.length !== 1 ||
    loaded.stored.chainLength !== 1 ||
    loaded.stored.headDigest !== parent.stored.headDigest ||
    loaded.stored.receipt.receiptDigest !==
      parent.stored.receipt.receiptDigest ||
    canonicalizeJson(loaded.stored.receipt) !==
      canonicalizeJson(parent.stored.receipt)
  ) {
    return fail(
      "godot-project-validation-import-receipt-invalid",
      "Godot project validation import receipt is stale or contradictory.",
    );
  }
}

export async function prepareGodotContainedProjectValidation(
  value: unknown,
): Promise<PreparedGodotContainedProjectValidation> {
  const request = validateValidationPreparationRequest(value);
  const parent = request.parent;
  await assertRetainedImportReceiptCurrent(parent);
  const runtime = parent.authority.runtime;
  let binding: EngineExecutionSnapshotBinding;
  try {
    binding = await captureEngineExecutionSnapshots({
      root: runtime.root,
      executable: runtime.executable,
      engine: "godot",
      projectInspectionDigest:
        parent.authority.versionProbe.project.inspectionDigest,
    });
  } catch {
    return fail(
      "godot-project-validation-snapshot-failed",
      "Godot project validation snapshots could not be captured safely.",
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
      "godot-project-validation-source-invalid",
      "Godot project validation requires the complete fixed graybox source.",
    );
  }
  if (
    graybox.sourceDigest !== parent.report.project.sourceDigest ||
    binding.project.manifestDigest !==
      parent.report.project.sourceManifestDigest ||
    parent.authority.expectation.expectationDigest !==
      parent.report.expectationDigest
  ) {
    return fail(
      "godot-project-validation-source-drift",
      "Godot project validation source differs from its import predecessor.",
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
      operationId: GODOT_PROJECT_VALIDATION_COMMAND_ID,
      invocationDigest: GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-project-validation-containment-unavailable",
      "Godot project validation containment could not be bound to the source snapshot.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotValidationRun;
  try {
    preparedRun = await prepareWindowsContainedGodotValidationRun({
      runtime: request.containmentRuntime,
      admission,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      runId: parent.report.runId,
      expectationDigest: parent.authority.expectation.expectationDigest,
    });
  } catch {
    return fail(
      "godot-project-validation-run-preparation-failed",
      "Godot project validation could not be bound to its containment authority.",
    );
  }
  const body = deepFreeze({
    schemaVersion: "1.0.0" as const,
    runId: parent.report.runId,
    commandId: GODOT_PROJECT_VALIDATION_COMMAND_ID,
    registryDigest: BUILTIN_REGISTRY.digest,
    workflow: {
      id: GODOT_PROJECT_VALIDATION_WORKFLOW_ID,
      version: "1.0.0" as const,
      stepId: GODOT_PROJECT_VALIDATION_STEP_ID,
      resolvedPlanDigest: parent.report.workflow.resolvedPlanDigest,
    },
    project: {
      ...parent.report.project,
      sourceManifestDigest: binding.project.manifestDigest,
    },
    executable: parent.report.executable,
    versionProbe: parent.report.versionProbe,
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment: containmentBinding(
      admission,
      preparedRun.requestDigest,
      GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
      binding,
    ),
    importPhase: {
      reportDigest: parent.report.reportDigest,
      engineRunReportDigest: parent.report.engineRun.reportDigest,
      projectSnapshotDigest: parent.report.engineRun.projectSnapshotDigest,
      sourceManifestDigest: parent.report.project.sourceManifestDigest,
      receiptId: parent.report.receipt.receiptId,
      receiptDigest: parent.report.receipt.receiptDigest,
      receiptHeadDigest: parent.report.receipt.headDigest,
      receiptChainLength: parent.report.receipt.chainLength,
      completedAt: parent.report.execution.endedAt,
    },
    input: parent.authority.expectation,
    support: preparationSupport(),
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  const plan: PreparedGodotContainedProjectValidation = deepFreeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-project-validation",
      version: "1.0.0",
      plan: body,
    }),
  });
  validationAuthorities.set(plan, {
    parent,
    binding,
    graybox,
    admission,
    preparedRun,
    workflow: parent.authority.workflow,
    canonicalPlan: canonicalizeJson(plan),
    consumed: false,
  });
  parent.validationPrepared = true;
  return plan;
}

function validationAuthorityForPlan(
  plan: unknown,
): ValidationAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? validationAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-project-validation-plan-untrusted",
      "Godot project validation plan is missing, cloned, or from another process.",
    );
  }
  return authority;
}

export async function assertPreparedGodotContainedProjectValidation(
  plan: unknown,
): Promise<void> {
  const authority = validationAuthorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-project-validation-plan-consumed",
      "Godot project validation plan was already consumed.",
    );
  }
  if (canonicalizeJson(plan) !== authority.canonicalPlan) {
    return fail(
      "godot-project-validation-plan-invalid",
      "Godot project validation plan no longer matches its preparation.",
    );
  }
  assertGodotProjectImportReportSemantics(authority.parent.report);
  await assertRetainedImportReceiptCurrent(authority.parent);
  await assertEngineExecutionSnapshotAuthority({
    binding: authority.binding,
    root: authority.parent.authority.runtime.root,
    executable: authority.parent.authority.runtime.executable,
  });
  await assertWindowsContainedEngineAdmission({
    admission: authority.admission,
    runtime: authority.parent.authority.containmentRuntime,
    binding: authority.binding,
    root: authority.parent.authority.runtime.root,
    executable: authority.parent.authority.runtime.executable,
    operationId: GODOT_PROJECT_VALIDATION_COMMAND_ID,
    invocationDigest: GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
  });
  const graybox = await verifyGodotGrayboxProjectRoot({
    root: authority.parent.authority.runtime.root,
    binding: authority.binding,
    executable: authority.parent.authority.runtime.executable,
  });
  if (
    graybox.sourceDigest !== authority.graybox.sourceDigest ||
    graybox.sourceDigest !== authority.parent.report.project.sourceDigest ||
    authority.binding.project.manifestDigest !==
      authority.parent.report.project.sourceManifestDigest
  ) {
    return fail(
      "godot-project-validation-source-drift",
      "Godot project validation source changed after preparation.",
    );
  }
}

function authorizationBudgets(
  phase: "import" | "validation",
): ExecutionBudgets {
  const importing = phase === "import";
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: importing
      ? GODOT_PROJECT_IMPORT_COMMAND_TIMEOUT_MS
      : GODOT_PROJECT_VALIDATION_COMMAND_TIMEOUT_MS,
    maxOutputBytes: importing
      ? GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES
      : GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

function authorizationObjectIds(
  plan:
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation,
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
      plan.input.expectationDigest,
      plan.project.inspectionDigest,
      plan.project.sourceDigest,
      plan.project.sourceManifestDigest,
      plan.versionProbe.digest,
      ...("importPhase" in plan
        ? [
            plan.importPhase.reportDigest,
            plan.importPhase.receiptDigest,
            plan.importPhase.receiptHeadDigest,
          ]
        : []),
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
}

function createAuthorizationRequest(
  value: unknown,
  phase: "import" | "validation",
): PermissionAuthorizationRequest {
  const code = `godot-project-${phase}-authorization-invalid`;
  const record = exactRecord(
    value,
    ["deadlineAt", "plan"],
    code,
    `Godot project ${phase} authorization contains undeclared fields.`,
  );
  const plan = record["plan"] as
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation;
  const authority =
    phase === "import"
      ? importAuthorityForPlan(plan)
      : validationAuthorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      code,
      `Godot project ${phase} authorization cannot reuse a consumed plan.`,
    );
  }
  const deadlineAt = canonicalTimestamp(record["deadlineAt"], code);
  if (
    Date.parse(deadlineAt) > Date.parse(plan.containment.expiresAt) ||
    Date.now() >= Date.parse(deadlineAt)
  ) {
    return fail(
      code,
      `Godot project ${phase} authorization exceeds its prepared start window.`,
    );
  }
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId:
      phase === "import" ? importCommandId : validationCommandId,
    input: plan.input,
    workflow: Object.freeze({
      id: workflowId,
      stepId: phase === "import" ? importStepId : validationStepId,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    }),
    scope: Object.freeze({
      paths: sourcePaths,
      objectIds: authorizationObjectIds(plan),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze([]),
      publishTargets: Object.freeze([]),
    }),
    budgets: authorizationBudgets(phase),
    deadlineAt,
  });
}

export function createGodotContainedProjectImportAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  return createAuthorizationRequest(value, "import");
}

export function createGodotContainedProjectValidationAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  return createAuthorizationRequest(value, "validation");
}

function assertAuthorizationActive(
  authorization: AuthorizedPermissionDecision,
  phase: "import" | "validation",
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
      `godot-project-${phase}-authorization-invalid`,
      `Godot project ${phase} authorization is no longer active.`,
    );
  }
}

function validateAuthorization(
  plan:
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation,
  value: unknown,
  phase: "import" | "validation",
): AuthorizedPermissionDecision {
  const code = `godot-project-${phase}-authorization-invalid`;
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      code,
      `Godot project ${phase} authorization must come from the permission broker.`,
    );
  }
  assertAuthorizationActive(authorization, phase);
  const expectedCommandId =
    phase === "import" ? importCommandId : validationCommandId;
  const expectedStepId = phase === "import" ? importStepId : validationStepId;
  const expectedOutput =
    phase === "import"
      ? godotProjectImportReportSchema
      : godotProjectValidationReportSchema;
  const expectedScope =
    phase === "import" ? "godot-project-import" : "godot-project-validation";
  const expectedExport =
    phase === "import" ? "runGodotProjectImport" : "runGodotProjectValidation";
  const expectedTimeout =
    phase === "import"
      ? GODOT_PROJECT_IMPORT_COMMAND_TIMEOUT_MS
      : GODOT_PROJECT_VALIDATION_COMMAND_TIMEOUT_MS;
  const expectedGrace =
    phase === "import"
      ? GODOT_PROJECT_IMPORT_TERMINATION_GRACE_MS
      : GODOT_PROJECT_VALIDATION_TERMINATION_GRACE_MS;
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === expectedCommandId,
  );
  const workflow = BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === workflowId,
  );
  const step = workflow?.steps.find(({ id }) => id === expectedStepId);
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "build-bound" ||
    command.input.schemaId !== godotProjectValidationExpectationSchema.schemaId ||
    command.input.digest !== godotProjectValidationExpectationSchema.digest ||
    command.output.schemaId !== expectedOutput.schemaId ||
    command.output.digest !== expectedOutput.digest ||
    canonicalizeJson(command.permissions) !==
      canonicalizeJson([
        "read-project",
        "host-tool-inspection",
        "test-build",
      ]) ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== expectedScope ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.timeoutMs !== expectedTimeout ||
    command.cancellation.mode !== "process-tree" ||
    command.cancellation.graceMs !== expectedGrace ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== expectedExport ||
    workflow === undefined ||
    workflow.lifecycle !== "internal" ||
    workflow.steps.length !== 2 ||
    step === undefined ||
    step.commandId !== expectedCommandId ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked" ||
    (phase === "import"
      ? step.dependsOn.length !== 0
      : step.dependsOn.length !== 1 || step.dependsOn[0] !== importStepId)
  ) {
    return fail(
      code,
      `Registered Godot project ${phase} authority does not match the executor boundary.`,
    );
  }
  const expected = createAuthorizationRequest(
    { plan, deadlineAt: authorization.challenge.deadlineAt },
    phase,
  );
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
      code,
      `Godot project ${phase} authorization is not exactly bound to its plan.`,
    );
  }
  return authorization;
}

function knownRunRequest(
  value: unknown,
  phase: "import" | "validation",
): boolean {
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
  return (
    plan !== null &&
    typeof plan === "object" &&
    (phase === "import"
      ? importAuthorities.has(plan)
      : validationAuthorities.has(plan))
  );
}

export function isGodotContainedProjectImportRunRequest(
  value: unknown,
): value is RunGodotContainedProjectImportRequest {
  return knownRunRequest(value, "import");
}

export function isGodotContainedProjectValidationRunRequest(
  value: unknown,
): value is RunGodotContainedProjectValidationRequest {
  return knownRunRequest(value, "validation");
}

function validateRunRequest(
  value: unknown,
  phase: "import",
): {
  readonly plan: PreparedGodotContainedProjectImport;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: ImportAuthority;
};
function validateRunRequest(
  value: unknown,
  phase: "validation",
): {
  readonly plan: PreparedGodotContainedProjectValidation;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: ValidationAuthority;
};
function validateRunRequest(
  value: unknown,
  phase: "import" | "validation",
) {
  if (!knownRunRequest(value, phase)) {
    return fail(
      `godot-project-${phase}-execution-invalid`,
      `Godot project ${phase} requires one prepared internal request.`,
    );
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")?.value as
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation;
  const signal = Object.getOwnPropertyDescriptor(value, "signal")?.value;
  if (signal !== null && !(signal instanceof AbortSignal)) {
    return fail(
      `godot-project-${phase}-execution-invalid`,
      `Godot project ${phase} cancellation signal is invalid.`,
    );
  }
  const authority =
    phase === "import"
      ? importAuthorityForPlan(plan)
      : validationAuthorityForPlan(plan);
  if (authority.consumed) {
    return fail(
      `godot-project-${phase}-plan-consumed`,
      `Godot project ${phase} plan was already consumed.`,
    );
  }
  return Object.freeze({
    plan,
    authorization: validateAuthorization(
      plan,
      Object.getOwnPropertyDescriptor(value, "authorization")?.value,
      phase,
    ),
    signal: signal as AbortSignal | null,
    authority,
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
  outcome: GodotProjectPhaseStatus,
  mutationUncertain: boolean,
  durationMs: number,
  outputBytes: number,
  networkObserved: boolean,
  phase: "import" | "validation",
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome,
      mutationUncertain,
      actual: permissionEffects(durationMs, outputBytes, networkObserved),
    });
  } catch {
    return fail(
      `godot-project-${phase}-settlement-failed`,
      `Godot project ${phase} effects could not be settled.`,
      true,
    );
  }
}

function receiptStatus(
  settlement: PermissionSettlement,
): GodotProjectPhaseStatus {
  if (settlement.status === "succeeded") return "succeeded";
  if (settlement.status === "failed") return "failed";
  if (settlement.status === "cancelled") return "cancelled";
  return "uncertain";
}

function componentStatus(
  value: GodotProjectPhaseStatus,
): "passed" | "failed" | "cancelled" | "uncertain" {
  return value === "succeeded" ? "passed" : value;
}

function stableViolations(
  settlement: PermissionSettlement,
  phase: "import" | "validation",
): readonly StableId[] {
  try {
    return Object.freeze(
      settlement.violations.map((entry) => parseStableId(entry)).sort(),
    );
  } catch {
    return fail(
      `godot-project-${phase}-settlement-invalid`,
      `Godot project ${phase} settlement returned an invalid violation.`,
      true,
    );
  }
}

interface PhaseClassification<Code extends string> {
  readonly status: GodotProjectPhaseStatus;
  readonly code: Code;
  readonly mutationUncertain: boolean;
}

interface ValidationClassification
  extends PhaseClassification<GodotProjectValidationReportCode> {
  readonly summary: GodotProjectValidationTranscriptSummary;
  readonly transcript?: GodotProjectValidationTranscript;
}

function finalClassification<Code extends string>(
  classification: PhaseClassification<Code>,
  settlement: PermissionSettlement,
  uncertainCode: Code,
): PhaseClassification<Code> {
  if (
    settlement.status !== "uncertain" &&
    settlement.status !== "scope-violation"
  ) {
    return classification;
  }
  return Object.freeze({
    ...classification,
    status: "uncertain" as const,
    code: uncertainCode,
    mutationUncertain: true,
  });
}

function engineRunEvidence(
  report: ProcessContainmentEngineRunReport,
  profile: ProcessContainmentEngineExecutionProfile,
): GodotProjectPhaseEngineRunEvidence {
  if (
    report.request.profile.id !== profile.profileId ||
    report.operationId !== profile.operationId ||
    report.invocationDigest !== profile.invocationDigest ||
    report.inputBindingDigest === null
  ) {
    return fail(
      "godot-project-engine-report-profile-mismatch",
      "Godot project engine evidence requires the exact phase profile.",
      true,
    );
  }
  return deepFreeze({
    requestDigest: report.requestDigest,
    reportDigest: report.reportDigest,
    admissionDigest: report.admissionDigest,
    profileId: profile.profileId,
    profileDigest: report.profileDigest,
    profileCatalogDigest: report.profileCatalogDigest,
    operationId:
      profile.profileId === GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.profileId
        ? GODOT_PROJECT_IMPORT_COMMAND_ID
        : GODOT_PROJECT_VALIDATION_COMMAND_ID,
    invocationDigest: profile.invocationDigest,
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

function resultMessage(
  phase: "import" | "validation",
  status: GodotProjectPhaseStatus,
  summary?: GodotProjectValidationTranscriptSummary,
): string {
  if (status === "succeeded") {
    return phase === "import"
      ? "Contained Godot project import completed with preserved source and cleanup."
      : "Contained Godot project validation loaded and instantiated the declared main scene.";
  }
  if (status === "cancelled") {
    return `Contained Godot project ${phase} was cancelled after cleanup.`;
  }
  if (status === "uncertain") {
    return `Contained Godot project ${phase} ended without complete trustworthy evidence.`;
  }
  if (summary?.status === "validated") {
    return "Contained Godot project validation produced one declared semantic failure.";
  }
  if (summary?.status === "rejected") {
    return "Contained Godot project validation output failed protocol validation.";
  }
  return `Contained Godot project ${phase} process failed.`;
}

function receiptFrom(
  plan:
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation,
  phase: "import" | "validation",
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  },
  classification: PhaseClassification<string>,
  engineRun?: ProcessContainmentEngineRunReport,
  previous?: StoredRunReceipt,
  summary?: GodotProjectValidationTranscriptSummary,
): RunReceipt {
  const commandId = phase === "import" ? importCommandId : validationCommandId;
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  if (command === undefined) {
    return fail(
      `godot-project-${phase}-receipt-invalid`,
      `Godot project ${phase} receipt lost its command descriptor.`,
      true,
    );
  }
  const status = receiptStatus(settlement);
  const innerStatus = componentStatus(status);
  const outerStatus =
    engineRun === undefined
      ? innerStatus
      : componentStatus(engineRun.outcome);
  const body = {
    schemaVersion: runReceiptSchema.version,
    receiptId: randomUUID(),
    ...(previous === undefined
      ? {}
      : { previousReceiptDigest: previous.receipt.receiptDigest }),
    status,
    identity: {
      runId: plan.runId,
      workflowId,
      stepId: phase === "import" ? importStepId : validationStepId,
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
        message: resultMessage(phase, classification.status, summary),
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
        message: resultMessage(phase, classification.status, summary),
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
    { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
    receipt,
  ) as unknown as RunReceipt;
}

async function retainReceipt(
  root: GodotVersionProbeRuntimeBinding["root"],
  receipt: RunReceipt,
  mutationUncertain: boolean,
  phase: "import" | "validation",
  previous?: StoredRunReceipt,
): Promise<StoredRunReceipt> {
  try {
    return await persistRunReceipt({
      root,
      registry: BUILTIN_REGISTRY,
      receipt,
      ...(previous === undefined ? {} : { previous }),
      maxArtifactBytes: 0,
    });
  } catch (error) {
    throw new GodotAdapterBoundaryError(
      `godot-project-${phase}-receipt-persistence-failed`,
      `Godot project ${phase} receipt could not be retained safely.`,
      mutationUncertain ||
        (error instanceof Error &&
          "mutationUncertain" in error &&
          error.mutationUncertain === true),
    );
  }
}

function importClassification(
  report: ProcessContainmentEngineRunReport,
): PhaseClassification<GodotProjectImportReportCode> {
  if (report.outcome === "succeeded") {
    return Object.freeze({
      status: "succeeded" as const,
      code: "godot-project-import-passed" as const,
      mutationUncertain: false,
    });
  }
  if (report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-project-import-cancelled" as const,
      mutationUncertain: report.mutationUncertain,
    });
  }
  if (report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-project-import-uncertain" as const,
      mutationUncertain: true,
    });
  }
  return Object.freeze({
    status: "failed" as const,
    code: "godot-project-import-process-failed" as const,
    mutationUncertain: report.mutationUncertain,
  });
}

function reportIdentityMatches(
  plan:
    | PreparedGodotContainedProjectImport
    | PreparedGodotContainedProjectValidation,
  report: ProcessContainmentEngineRunReport,
  profile: ProcessContainmentEngineExecutionProfile,
): boolean {
  return (
    report.runId === plan.runId &&
    report.requestDigest === plan.containment.runRequestDigest &&
    report.admissionDigest === plan.containment.admissionDigest &&
    report.request.profile.id === profile.profileId &&
    report.profileDigest === plan.containment.profileDigest &&
    report.profileCatalogDigest === plan.containment.profileCatalogDigest &&
    report.operationId === profile.operationId &&
    report.invocationDigest === profile.invocationDigest &&
    report.inputBindingDigest === plan.input.expectationDigest &&
    report.snapshotBindingDigest === plan.containment.snapshotBindingDigest &&
    report.projectSnapshotDigest === plan.containment.projectSnapshotDigest &&
    report.executableSnapshotDigest ===
      plan.containment.executableSnapshotDigest
  );
}

function approvalIds(
  authorization: AuthorizedPermissionDecision,
): readonly StableId[] {
  return Object.freeze(
    [...authorization.lease.grantIds]
      .sort()
      .map((entry) => parseStableId(entry)),
  );
}

function importReportFrom(
  plan: PreparedGodotContainedProjectImport,
  engineRun: ProcessContainmentEngineRunReport,
  classification: PhaseClassification<GodotProjectImportReportCode>,
  settlement: PermissionSettlement,
  approvals: readonly StableId[],
  receipt: RunReceipt,
  stored: StoredRunReceipt,
): GodotProjectImportReport {
  const final = finalClassification(
    classification,
    settlement,
    "godot-project-import-uncertain",
  );
  const input: GodotProjectImportReportDigestInput = deepFreeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    runId: plan.runId,
    workflow: plan.workflow,
    project: plan.project,
    executable: plan.executable,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: plan.versionProbe,
    expectationDigest: plan.input.expectationDigest,
    containment: plan.containment,
    execution: {
      processStarted: engineRun.process.started,
      startedAt: engineRun.startedAt,
      endedAt: engineRun.completedAt,
      durationMs: engineRun.durationMs,
    },
    status: final.status,
    code: final.code,
    authorization: {
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: settlement.status,
      mutationUncertain: settlement.mutationUncertain,
      violations: stableViolations(settlement, "import"),
      approvalIds: approvals,
      durationMs: settlement.actual.durationMs,
      outputBytes: settlement.actual.outputBytes,
      settledAt: settlement.settledAt,
    },
    engineRun: engineRunEvidence(
      engineRun,
      GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    ),
    receipt: {
      status: "retained" as const,
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
      headDigest: stored.headDigest,
      chainLength: stored.chainLength,
    },
    support: preparationSupport(),
    mutationPerformed:
      !engineRun.effects.sourceProjectPreserved ||
      !engineRun.effects.sourceExecutablePreserved,
    externalProcessStarted: engineRun.process.started,
    networkAccessPerformed: engineRun.effects.networkConnectionEstablished,
  });
  const report = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: GODOT_PROJECT_IMPORT_COMMAND_ID,
    ...input,
    reportDigest: computeGodotProjectImportReportDigest(input),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: godotProjectImportReportSchema.schemaId,
      digest: godotProjectImportReportSchema.digest,
    },
    report,
  ) as unknown as GodotProjectImportReport;
  assertGodotProjectImportReportSemantics(validated);
  return validated;
}

function providerErrorClassification(
  phase: "import" | "validation",
  cancelled: boolean,
  mutationUncertain: boolean,
): PhaseClassification<string> {
  return Object.freeze({
    status: cancelled
      ? ("cancelled" as const)
      : mutationUncertain
        ? ("uncertain" as const)
        : ("failed" as const),
    code:
      phase === "import"
        ? cancelled
          ? "godot-project-import-cancelled"
          : mutationUncertain
            ? "godot-project-import-uncertain"
            : "godot-project-import-process-failed"
        : cancelled
          ? "godot-project-validation-cancelled"
          : mutationUncertain
            ? "godot-project-validation-uncertain"
            : "godot-project-validation-process-failed",
    mutationUncertain,
  });
}

function cancellationRequested(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

export async function runGodotContainedProjectImport(
  value: unknown,
): Promise<GodotProjectImportReport> {
  const request = validateRunRequest(value, "import");
  if (cancellationRequested(request.signal)) {
    settle(request.authorization, "cancelled", false, 0, 0, false, "import");
    return fail(
      "godot-project-import-cancelled-before-admission",
      "Godot project import was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedProjectImport(request.plan);
    assertAuthorizationActive(request.authorization, "import");
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", false, 0, 0, false, "import");
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-project-import-authority-invalid",
      "Godot project import lost its authority before dispatch.",
    );
  }
  request.authority.consumed = true;
  const approvals = approvalIds(request.authorization);
  const startedMs = Date.now();
  let engineRun: ProcessContainmentEngineRunReport;
  try {
    engineRun = await runWindowsContainedGodotImport({
      prepared: request.authority.preparedRun,
      signal: request.signal,
    });
  } catch (error) {
    const endedMs = Math.max(startedMs, Date.now());
    const cancelled =
      cancellationRequested(request.signal) &&
      error instanceof Error &&
      "code" in error &&
      error.code === "engine-run-cancelled-before-start";
    const mutationUncertain =
      error instanceof Error &&
      "mutationUncertain" in error &&
      error.mutationUncertain === true;
    const classification = providerErrorClassification(
      "import",
      cancelled,
      mutationUncertain,
    );
    const settlement = settle(
      request.authorization,
      classification.status,
      classification.mutationUncertain,
      endedMs - startedMs,
      0,
      false,
      "import",
    );
    const receipt = receiptFrom(
      request.plan,
      "import",
      settlement,
      approvals,
      {
        startedAt: new Date(startedMs).toISOString(),
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - startedMs,
      },
      classification,
    );
    await retainReceipt(
      request.authority.runtime.root,
      receipt,
      mutationUncertain,
      "import",
    );
    return fail(
      cancelled
        ? "godot-project-import-execution-cancelled"
        : mutationUncertain
          ? "godot-project-import-execution-uncertain"
          : "godot-project-import-execution-failed",
      "Godot project import did not return a trustworthy native report.",
      mutationUncertain || settlement.mutationUncertain,
    );
  }
  if (
    !reportIdentityMatches(
      request.plan,
      engineRun,
      GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    )
  ) {
    const settlement = settle(
      request.authorization,
      "uncertain",
      true,
      engineRun.durationMs,
      engineRun.output.capturedBytes,
      engineRun.effects.networkConnectionEstablished,
      "import",
    );
    const classification = providerErrorClassification("import", false, true);
    const receipt = receiptFrom(
      request.plan,
      "import",
      settlement,
      approvals,
      {
        startedAt: engineRun.startedAt,
        endedAt: engineRun.completedAt,
        durationMs: engineRun.durationMs,
      },
      classification,
      engineRun,
    );
    await retainReceipt(
      request.authority.runtime.root,
      receipt,
      true,
      "import",
    );
    return fail(
      "godot-project-import-execution-uncertain",
      "Godot project import returned a mismatched native report.",
      true,
    );
  }
  const classification = importClassification(engineRun);
  const settlement = settle(
    request.authorization,
    classification.status,
    classification.mutationUncertain,
    engineRun.durationMs,
    engineRun.output.capturedBytes,
    engineRun.effects.networkConnectionEstablished,
    "import",
  );
  const final = finalClassification(
    classification,
    settlement,
    "godot-project-import-uncertain",
  ) as PhaseClassification<GodotProjectImportReportCode>;
  const receipt = receiptFrom(
    request.plan,
    "import",
    settlement,
    approvals,
    {
      startedAt: engineRun.startedAt,
      endedAt: engineRun.completedAt,
      durationMs: engineRun.durationMs,
    },
    final,
    engineRun,
  );
  const stored = await retainReceipt(
    request.authority.runtime.root,
    receipt,
    settlement.mutationUncertain,
    "import",
  );
  const report = importReportFrom(
    request.plan,
    engineRun,
    final,
    settlement,
    approvals,
    receipt,
    stored,
  );
  retainedImports.set(report, {
    authority: request.authority,
    report,
    stored,
    validationPrepared: false,
  });
  return report;
}

function unavailableValidationClassification(
  report: ProcessContainmentEngineRunReport,
): ValidationClassification {
  if (report.outcome === "cancelled") {
    return Object.freeze({
      status: "cancelled" as const,
      code: "godot-project-validation-cancelled" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  if (report.outcome === "uncertain") {
    return Object.freeze({
      status: "uncertain" as const,
      code: "godot-project-validation-uncertain" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: true,
    });
  }
  if (report.outcome === "failed") {
    return Object.freeze({
      status: "failed" as const,
      code: "godot-project-validation-process-failed" as const,
      summary: Object.freeze({ status: "unavailable" as const }),
      mutationUncertain: report.mutationUncertain,
    });
  }
  return Object.freeze({
    status: "uncertain" as const,
    code: "godot-project-validation-transcript-unavailable" as const,
    summary: Object.freeze({ status: "unavailable" as const }),
    mutationUncertain: true,
  });
}

function rejectedValidationClassification(
  execution: WindowsContainedGodotValidationExecution,
  code: GodotProjectValidationOutputInvalidCode,
): ValidationClassification {
  if (execution.transcript.status !== "available") {
    return unavailableValidationClassification(execution.report);
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

function classifyValidationExecution(
  execution: WindowsContainedGodotValidationExecution,
  expectation: GodotProjectValidationExpectation,
): ValidationClassification {
  if (execution.transcript.status !== "available") {
    return unavailableValidationClassification(execution.report);
  }
  let raw: string;
  try {
    raw = consumeWindowsContainedGodotValidationTranscript(execution);
  } catch {
    return unavailableValidationClassification(execution.report);
  }
  const parsed = parseGodotProjectValidationOutput(raw, expectation);
  if (parsed.status === "invalid") {
    return rejectedValidationClassification(execution, parsed.code);
  }
  const transcript = parsed.transcript;
  const passed = transcript.terminal.event === "validation-passed";
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
    return rejectedValidationClassification(
      execution,
      "godot-project-validation-exit-outcome-mismatch",
    );
  }
  const summary: GodotProjectValidationTranscriptSummary = passed
    ? Object.freeze({
        status: "validated" as const,
        transcriptDigest: transcript.transcriptDigest,
        outputDigest: transcript.wire.outputDigest,
        bytes: transcript.wire.bytes,
        eventCount: 2 as const,
        terminal: "validation-passed" as const,
        terminalCode: "passed" as const,
        rootType: transcript.terminal.rootType,
      })
    : Object.freeze({
        status: "validated" as const,
        transcriptDigest: transcript.transcriptDigest,
        outputDigest: transcript.wire.outputDigest,
        bytes: transcript.wire.bytes,
        eventCount: 2 as const,
        terminal: "validation-failed" as const,
        terminalCode: transcript.terminal.code,
      });
  return Object.freeze({
    status: passed ? ("succeeded" as const) : ("failed" as const),
    code: passed
      ? ("godot-project-validation-passed" as const)
      : (`godot-project-validation-${transcript.terminal.code}` as GodotProjectValidationReportCode),
    summary,
    transcript,
    mutationUncertain: execution.report.mutationUncertain,
  });
}

function discardValidationTranscript(
  execution: WindowsContainedGodotValidationExecution,
): void {
  if (execution.transcript.status !== "available") return;
  try {
    consumeWindowsContainedGodotValidationTranscript(execution);
  } catch {
    // The report is already untrusted; best-effort consumption only.
  }
}

function validationReportFrom(
  plan: PreparedGodotContainedProjectValidation,
  engineRun: ProcessContainmentEngineRunReport,
  classification: ValidationClassification,
  settlement: PermissionSettlement,
  approvals: readonly StableId[],
  receipt: RunReceipt,
  stored: StoredRunReceipt,
): GodotProjectValidationReport {
  const final = finalClassification(
    classification,
    settlement,
    "godot-project-validation-uncertain",
  ) as ValidationClassification;
  const input: GodotProjectValidationReportDigestInput = deepFreeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    runId: plan.runId,
    workflow: plan.workflow,
    project: plan.project,
    executable: plan.executable,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: plan.versionProbe,
    expectationDigest: plan.input.expectationDigest,
    containment: plan.containment,
    importPhase: plan.importPhase,
    execution: {
      processStarted: engineRun.process.started,
      startedAt: engineRun.startedAt,
      endedAt: engineRun.completedAt,
      durationMs: engineRun.durationMs,
    },
    status: final.status,
    code: final.code,
    transcript: classification.summary,
    authorization: {
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: settlement.status,
      mutationUncertain: settlement.mutationUncertain,
      violations: stableViolations(settlement, "validation"),
      approvalIds: approvals,
      durationMs: settlement.actual.durationMs,
      outputBytes: settlement.actual.outputBytes,
      settledAt: settlement.settledAt,
    },
    engineRun: engineRunEvidence(
      engineRun,
      GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    ),
    receipt: {
      status: "retained" as const,
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
      headDigest: stored.headDigest,
      chainLength: stored.chainLength,
    },
    support: preparationSupport(),
    mutationPerformed:
      !engineRun.effects.sourceProjectPreserved ||
      !engineRun.effects.sourceExecutablePreserved,
    externalProcessStarted: engineRun.process.started,
    networkAccessPerformed: engineRun.effects.networkConnectionEstablished,
  });
  const report = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: GODOT_PROJECT_VALIDATION_COMMAND_ID,
    ...input,
    reportDigest: computeGodotProjectValidationReportDigest(input),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: godotProjectValidationReportSchema.schemaId,
      digest: godotProjectValidationReportSchema.digest,
    },
    report,
  ) as unknown as GodotProjectValidationReport;
  assertGodotProjectValidationReportSemantics(validated);
  if (classification.transcript !== undefined) {
    retainedValidationTranscripts.set(validated, classification.transcript);
  }
  return validated;
}

export async function runGodotContainedProjectValidation(
  value: unknown,
): Promise<GodotProjectValidationReport> {
  const request = validateRunRequest(value, "validation");
  const parent = request.authority.parent;
  if (cancellationRequested(request.signal)) {
    settle(
      request.authorization,
      "cancelled",
      false,
      0,
      0,
      false,
      "validation",
    );
    return fail(
      "godot-project-validation-cancelled-before-admission",
      "Godot project validation was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedProjectValidation(request.plan);
    assertAuthorizationActive(request.authorization, "validation");
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(
        request.authorization,
        "failed",
        false,
        0,
        0,
        false,
        "validation",
      );
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    return fail(
      "godot-project-validation-authority-invalid",
      "Godot project validation lost its authority before dispatch.",
    );
  }
  request.authority.consumed = true;
  const approvals = approvalIds(request.authorization);
  const startedMs = Date.now();
  let execution: WindowsContainedGodotValidationExecution;
  try {
    execution = await runWindowsContainedGodotValidation({
      prepared: request.authority.preparedRun,
      signal: request.signal,
    });
  } catch (error) {
    const endedMs = Math.max(startedMs, Date.now());
    const cancelled =
      cancellationRequested(request.signal) &&
      error instanceof Error &&
      "code" in error &&
      error.code === "engine-run-cancelled-before-start";
    const mutationUncertain =
      error instanceof Error &&
      "mutationUncertain" in error &&
      error.mutationUncertain === true;
    const classification = providerErrorClassification(
      "validation",
      cancelled,
      mutationUncertain,
    );
    const settlement = settle(
      request.authorization,
      classification.status,
      classification.mutationUncertain,
      endedMs - startedMs,
      0,
      false,
      "validation",
    );
    const receipt = receiptFrom(
      request.plan,
      "validation",
      settlement,
      approvals,
      {
        startedAt: new Date(startedMs).toISOString(),
        endedAt: new Date(endedMs).toISOString(),
        durationMs: endedMs - startedMs,
      },
      classification,
      undefined,
      parent.stored,
    );
    await retainReceipt(
      parent.authority.runtime.root,
      receipt,
      mutationUncertain,
      "validation",
      parent.stored,
    );
    return fail(
      cancelled
        ? "godot-project-validation-execution-cancelled"
        : mutationUncertain
          ? "godot-project-validation-execution-uncertain"
          : "godot-project-validation-execution-failed",
      "Godot project validation did not return a trustworthy native report.",
      mutationUncertain || settlement.mutationUncertain,
    );
  }
  if (
    !reportIdentityMatches(
      request.plan,
      execution.report,
      GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    )
  ) {
    discardValidationTranscript(execution);
    const settlement = settle(
      request.authorization,
      "uncertain",
      true,
      execution.report.durationMs,
      execution.report.output.capturedBytes,
      execution.report.effects.networkConnectionEstablished,
      "validation",
    );
    const classification: ValidationClassification = Object.freeze({
      status: "uncertain",
      code: "godot-project-validation-uncertain",
      summary: Object.freeze({ status: "unavailable" }),
      mutationUncertain: true,
    });
    const receipt = receiptFrom(
      request.plan,
      "validation",
      settlement,
      approvals,
      {
        startedAt: execution.report.startedAt,
        endedAt: execution.report.completedAt,
        durationMs: execution.report.durationMs,
      },
      classification,
      execution.report,
      parent.stored,
      classification.summary,
    );
    await retainReceipt(
      parent.authority.runtime.root,
      receipt,
      true,
      "validation",
      parent.stored,
    );
    return fail(
      "godot-project-validation-execution-uncertain",
      "Godot project validation returned a mismatched native report.",
      true,
    );
  }
  const classification = classifyValidationExecution(
    execution,
    parent.authority.expectation,
  );
  const settlement = settle(
    request.authorization,
    classification.status,
    classification.mutationUncertain,
    execution.report.durationMs,
    execution.report.output.capturedBytes,
    execution.report.effects.networkConnectionEstablished,
    "validation",
  );
  const final = finalClassification(
    classification,
    settlement,
    "godot-project-validation-uncertain",
  ) as ValidationClassification;
  const receipt = receiptFrom(
    request.plan,
    "validation",
    settlement,
    approvals,
    {
      startedAt: execution.report.startedAt,
      endedAt: execution.report.completedAt,
      durationMs: execution.report.durationMs,
    },
    final,
    execution.report,
    parent.stored,
    classification.summary,
  );
  const stored = await retainReceipt(
    parent.authority.runtime.root,
    receipt,
    settlement.mutationUncertain,
    "validation",
    parent.stored,
  );
  return validationReportFrom(
    request.plan,
    execution.report,
    final,
    settlement,
    approvals,
    receipt,
    stored,
  );
}

export async function runGodotProjectImport(
  value: unknown,
): Promise<GodotProjectImportReport> {
  if (!isGodotContainedProjectImportRunRequest(value)) {
    return fail(
      "godot-project-import-execution-invalid",
      "Godot project import is available only through its prepared internal workflow.",
    );
  }
  return runGodotContainedProjectImport(value);
}

export async function runGodotProjectValidation(
  value: unknown,
): Promise<GodotProjectValidationReport> {
  if (!isGodotContainedProjectValidationRunRequest(value)) {
    return fail(
      "godot-project-validation-execution-invalid",
      "Godot project validation is available only after its retained import phase.",
    );
  }
  return runGodotContainedProjectValidation(value);
}

export function consumeGodotContainedProjectValidationTranscript(
  report: unknown,
): GodotProjectValidationTranscript {
  const transcript =
    report !== null && typeof report === "object"
      ? retainedValidationTranscripts.get(report)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "godot-project-validation-transcript-unavailable",
      "Godot project validation transcript is unavailable, cloned, or already consumed.",
    );
  }
  retainedValidationTranscripts.delete(report as object);
  return transcript;
}
