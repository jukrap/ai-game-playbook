import {
  GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET,
  GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
  GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertGodotHeadlessPreflightReportSemantics,
  assertGodotHeadlessPreflightRequestSemantics,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computeGodotHeadlessPreflightDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  godotHeadlessPreflightReportSchema,
  godotHeadlessPreflightRequestSchema,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  type EngineExecutionSnapshotBinding,
  type ExecutionBudgets,
  type GodotHeadlessPreflightCommandInput,
  type GodotHeadlessPreflightDigestInput,
  type GodotHeadlessPreflightEngineRunEvidence,
  type GodotHeadlessPreflightQualifiedContainmentBinding,
  type GodotHeadlessPreflightReport,
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
  createWindowsContainedEngineAdmission,
  prepareWindowsContainedGodotEngineRun,
  runWindowsContainedGodotEngine,
  type PreparedWindowsContainedGodotEngineRun,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";
import { randomUUID } from "node:crypto";

import { GodotAdapterBoundaryError } from "./errors.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

const commandId = parseStableId("engine.headless-preflight");
const workflowId = parseStableId("workflow.godot-headless-preflight");
const stepId = parseStableId("step.godot-headless-preflight");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const projectStages = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);

export interface PrepareGodotContainedHeadlessAdmissionFromVersionProbeRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
  readonly containmentRuntime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
}

export type GodotContainedHeadlessAdmissionBlocker =
  "godot-headless-version-unverified";

interface PreparedGodotContainedHeadlessAdmissionBase {
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
    readonly rootIdentityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
  };
  readonly executable: {
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
  };
  readonly versionProbe: {
    readonly digest: Sha256Digest;
    readonly status: GodotVersionProbeReport["status"];
    readonly exactTargetMatch: boolean;
  };
  readonly snapshot: {
    readonly bindingDigest: Sha256Digest;
    readonly projectSnapshotDigest: Sha256Digest;
    readonly executableSnapshotDigest: Sha256Digest;
    readonly capturedAt: string;
  };
  readonly containment: GodotHeadlessPreflightQualifiedContainmentBinding;
  readonly invocationDigest: typeof GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "locally-executed";
    readonly reason: string;
  };
  readonly effects: {
    readonly engineProcessStarted: false;
    readonly projectMutationPerformed: false;
    readonly networkAccessPerformed: false;
  };
  readonly preparationDigest: Sha256Digest;
}

export interface BlockedGodotContainedHeadlessAdmission
  extends PreparedGodotContainedHeadlessAdmissionBase {
  readonly disposition: "blocked";
  readonly blockers: readonly [GodotContainedHeadlessAdmissionBlocker];
}

export interface ReadyGodotContainedHeadlessAdmission
  extends PreparedGodotContainedHeadlessAdmissionBase {
  readonly disposition: "ready";
  readonly blockers: readonly [];
  readonly input: GodotHeadlessPreflightCommandInput;
}

export type PreparedGodotContainedHeadlessAdmission =
  | BlockedGodotContainedHeadlessAdmission
  | ReadyGodotContainedHeadlessAdmission;

export interface CreateGodotContainedHeadlessAuthorizationRequest {
  readonly plan: ReadyGodotContainedHeadlessAdmission;
  readonly deadlineAt: string;
}

export interface RunGodotContainedHeadlessRequest {
  readonly plan: ReadyGodotContainedHeadlessAdmission;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface ValidatedRequest {
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
  readonly admission: ProcessContainmentEngineAdmission;
  readonly preparedRun: PreparedWindowsContainedGodotEngineRun;
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
  consumed: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();

function fail(code: string, message: string): never {
  throw new GodotAdapterBoundaryError(code, message, false);
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
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
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

function validateRequest(value: unknown): ValidatedRequest {
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
    "godot-contained-admission-preparation-invalid",
    "Godot contained admission preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "godot-contained-admission-preparation-invalid",
      "Godot contained admission preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-contained-admission-preparation-invalid",
      "Godot contained admission preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    return fail(
      "godot-contained-admission-preparation-invalid",
      "Godot contained admission preparation requires one supported project stage.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    return fail(
      "godot-contained-admission-version-invalid",
      "Godot contained admission requires one valid version report.",
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

function resolveHeadlessWorkflow(stage: ProjectStage): ResolvedWorkflowPlan {
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
      "godot-contained-admission-workflow-invalid",
      "Godot contained admission workflow does not match its registered boundary.",
    );
  }
  return workflow;
}

function assertVersionBinding(
  request: ValidatedRequest,
): GodotVersionProbeRuntimeBinding {
  const runtime = boundGodotVersionProbeRuntime(request.versionProbe);
  if (runtime === undefined) {
    return fail(
      "godot-contained-admission-version-untrusted",
      "Godot contained admission requires the original same-process version report.",
    );
  }
  if (
    request.versionProbe.project.id !== request.projectId ||
    request.versionProbe.registryDigest !== BUILTIN_REGISTRY.digest ||
    request.versionProbe.project.identityDigest !== runtime.root.identityDigest ||
    request.versionProbe.project.rootIdentityDigest !== runtime.root.identityDigest ||
    request.versionProbe.executable.digest !== runtime.executable.digest ||
    request.versionProbe.executable.identityDigest !==
      runtime.executable.identityDigest
  ) {
    return fail(
      "godot-contained-admission-version-mismatch",
      "Godot version report does not match its project and executable authority.",
    );
  }
  return runtime;
}

function blockers(
  versionMatched: boolean,
): readonly GodotContainedHeadlessAdmissionBlocker[] {
  return versionMatched
    ? Object.freeze([])
    : Object.freeze(["godot-headless-version-unverified" as const]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export async function prepareGodotContainedHeadlessAdmissionFromVersionProbe(
  value: unknown,
): Promise<PreparedGodotContainedHeadlessAdmission> {
  const request = validateRequest(value);
  const runtime = assertVersionBinding(request);
  const workflow = resolveHeadlessWorkflow(request.projectStage);
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
      "godot-contained-admission-snapshot-failed",
      "Godot project and executable snapshots could not be captured safely.",
    );
  }
  if (
    Date.parse(binding.project.capturedAt) <
    Date.parse(request.versionProbe.execution.endedAt)
  ) {
    return fail(
      "godot-contained-admission-snapshot-stale",
      "Godot execution snapshots predate the bound version report.",
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
      invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-contained-admission-qualification-failed",
      "Godot containment qualification could not be bound to the engine snapshots.",
    );
  }
  let preparedRun: PreparedWindowsContainedGodotEngineRun;
  try {
    preparedRun = await prepareWindowsContainedGodotEngineRun({
      runtime: request.containmentRuntime,
      admission,
      binding,
      root: runtime.root,
      executable: runtime.executable,
      runId: request.runId,
    });
  } catch {
    return fail(
      "godot-contained-admission-run-preparation-failed",
      "Godot contained execution could not be bound to its qualified admission.",
    );
  }
  const versionMatched = exactVersionMatch(request.versionProbe);
  const containment: GodotHeadlessPreflightQualifiedContainmentBinding =
    deepFreeze({
      admissionDigest: admission.admissionDigest,
      runRequestDigest: preparedRun.requestDigest,
      policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
      providerDescriptorDigest: admission.providerDescriptorDigest,
      providerCatalogDigest: admission.providerCatalogDigest,
      profileDigest: preparedRun.request.profile.digest,
      snapshotBindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      decision: "qualified" as const,
      evidenceGrade: "locally-executed" as const,
      expiresAt: preparedRun.request.startDeadline,
    });
  const common = deepFreeze({
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
      rootIdentityDigest: runtime.root.identityDigest,
      inspectionDigest: request.versionProbe.project.inspectionDigest,
    },
    executable: {
      digest: runtime.executable.digest,
      identityDigest: runtime.executable.identityDigest,
    },
    versionProbe: {
      digest: request.versionProbe.probeDigest,
      status: request.versionProbe.status,
      exactTargetMatch: versionMatched,
    },
    snapshot: {
      bindingDigest: binding.bindingDigest,
      projectSnapshotDigest: binding.project.snapshotDigest,
      executableSnapshotDigest: binding.executable.snapshotDigest,
      capturedAt: binding.project.capturedAt,
    },
    containment,
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
  let body:
    | Omit<BlockedGodotContainedHeadlessAdmission, "preparationDigest">
    | Omit<ReadyGodotContainedHeadlessAdmission, "preparationDigest">;
  if (versionMatched) {
    const input = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: godotHeadlessPreflightRequestSchema.schemaId,
        digest: godotHeadlessPreflightRequestSchema.digest,
      },
      {
        schemaVersion: "1.0.0",
        engine: "godot",
        versionProbeDigest: request.versionProbe.probeDigest,
        versionProbeStatus: request.versionProbe.status,
        projectRootIdentityDigest: runtime.root.identityDigest,
        projectInspectionDigest: request.versionProbe.project.inspectionDigest,
        executableDigest: runtime.executable.digest,
        executableIdentityDigest: runtime.executable.identityDigest,
        targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
        targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
        mode: "dynamic-main-scene",
        frameBudget: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET,
        invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
        containment,
        requirements: {
          filesystem: "deny-project-writes",
          network: "deny",
          childProcesses: "deny",
        },
      },
    ) as unknown as GodotHeadlessPreflightCommandInput;
    assertGodotHeadlessPreflightRequestSemantics(input);
    body = deepFreeze({
      ...common,
      disposition: "ready" as const,
      blockers: Object.freeze([]),
      input,
      support: {
        grade: "planned" as const,
        evidenceGrade: "locally-executed" as const,
        reason:
          "Contained startup is available, but engine support remains planned until a real Godot validation run is retained.",
      },
    });
  } else {
    body = deepFreeze({
      ...common,
      disposition: "blocked" as const,
      blockers: blockers(false) as readonly [GodotContainedHeadlessAdmissionBlocker],
      support: {
        grade: "planned" as const,
        evidenceGrade: "locally-executed" as const,
        reason: "The exact target Godot version was not verified.",
      },
    });
  }
  const plan: PreparedGodotContainedHeadlessAdmission = Object.freeze({
    ...body,
    preparationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-contained-headless-admission",
      version: "1.0.0",
      plan: body,
    }),
  });
  preparedAuthorities.set(plan, {
    runtime,
    versionProbe: request.versionProbe,
    containmentRuntime: request.containmentRuntime,
    binding,
    admission,
    preparedRun,
    workflow,
    canonicalPlan: canonicalizeJson(plan),
    consumed: false,
  });
  return plan;
}

export async function assertPreparedGodotContainedHeadlessAdmission(
  plan: PreparedGodotContainedHeadlessAdmission,
): Promise<void> {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined) {
    return fail(
      "godot-contained-admission-plan-untrusted",
      "Godot contained admission was not prepared by this process.",
    );
  }
  const versionMatched = exactVersionMatch(authority.versionProbe);
  if (
    canonicalizeJson(plan) !== authority.canonicalPlan ||
    authority.consumed ||
    plan.disposition !== (versionMatched ? "ready" : "blocked") ||
    (plan.disposition === "ready" && plan.blockers.length !== 0) ||
    (plan.disposition === "blocked" &&
      (plan.blockers.length !== 1 ||
        plan.blockers[0] !== "godot-headless-version-unverified")) ||
    plan.effects.engineProcessStarted ||
    plan.effects.projectMutationPerformed ||
    plan.effects.networkAccessPerformed ||
    boundGodotVersionProbeRuntime(authority.versionProbe) !== authority.runtime ||
    plan.versionProbe.digest !== authority.versionProbe.probeDigest ||
    plan.snapshot.bindingDigest !== authority.binding.bindingDigest ||
    plan.containment.admissionDigest !== authority.admission.admissionDigest ||
    plan.containment.runRequestDigest !== authority.preparedRun.requestDigest ||
    plan.containment.profileDigest !==
      authority.preparedRun.request.profile.digest ||
    plan.containment.expiresAt !==
      authority.preparedRun.request.startDeadline
  ) {
    return fail(
      "godot-contained-admission-plan-drift",
      "Godot contained admission no longer matches its same-process authority.",
    );
  }
  if (plan.disposition === "ready") {
    try {
      assertGodotHeadlessPreflightRequestSemantics(plan.input);
    } catch {
      return fail(
        "godot-contained-admission-plan-drift",
        "Godot contained admission input no longer matches its command contract.",
      );
    }
  }
  const workflow = resolveHeadlessWorkflow(authority.workflow.projectStage);
  if (
    workflow.resolvedPlanDigest !== authority.workflow.resolvedPlanDigest ||
    canonicalizeJson(workflow) !== canonicalizeJson(authority.workflow)
  ) {
    return fail(
      "godot-contained-admission-workflow-invalid",
      "Godot contained admission workflow changed after preparation.",
    );
  }
  try {
    await assertWindowsContainedEngineAdmission({
      admission: authority.admission,
      runtime: authority.containmentRuntime,
      binding: authority.binding,
      root: authority.runtime.root,
      executable: authority.runtime.executable,
      operationId: commandId,
      invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    });
  } catch {
    return fail(
      "godot-contained-admission-authority-invalid",
      "Godot contained admission lost its project, executable, or provider authority.",
    );
  }
}

function canonicalTimestampValue(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    return fail(code, "Godot contained execution requires one canonical deadline.");
  }
  return value;
}

function authorityForReadyPlan(
  plan: ReadyGodotContainedHeadlessAdmission,
): PreparedAuthority {
  const authority =
    plan !== null && typeof plan === "object"
      ? preparedAuthorities.get(plan)
      : undefined;
  if (authority === undefined || plan.disposition !== "ready") {
    return fail(
      "godot-contained-admission-plan-untrusted",
      "Godot contained execution requires one original ready plan.",
    );
  }
  return authority;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

function authorizationObjectIds(
  plan: ReadyGodotContainedHeadlessAdmission,
): readonly string[] {
  return Object.freeze(
    [
      plan.containment.admissionDigest,
      plan.containment.executableSnapshotDigest,
      plan.containment.policyDigest,
      plan.containment.profileDigest,
      plan.containment.projectSnapshotDigest,
      plan.containment.providerCatalogDigest,
      plan.containment.providerDescriptorDigest,
      plan.containment.runRequestDigest,
      plan.containment.snapshotBindingDigest,
      plan.executable.digest,
      plan.executable.identityDigest,
      plan.project.inspectionDigest,
      plan.versionProbe.digest,
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
}

export function createGodotContainedHeadlessAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = exactRecord(
    value,
    ["deadlineAt", "plan"],
    "godot-contained-authorization-invalid",
    "Godot contained authorization contains undeclared fields.",
  );
  const plan = record["plan"] as ReadyGodotContainedHeadlessAdmission;
  const authority = authorityForReadyPlan(plan);
  if (authority.consumed) {
    return fail(
      "godot-contained-authorization-invalid",
      "Godot contained authorization cannot reuse a consumed plan.",
    );
  }
  const deadlineAt = canonicalTimestampValue(
    record["deadlineAt"],
    "godot-contained-authorization-invalid",
  );
  if (
    Date.parse(deadlineAt) > Date.parse(plan.containment.expiresAt) ||
    Date.now() >= Date.parse(deadlineAt)
  ) {
    return fail(
      "godot-contained-authorization-invalid",
      "Godot contained authorization exceeds its prepared start window.",
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
      paths: Object.freeze(["project.godot"]),
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
      "godot-contained-authorization-invalid",
      "Godot contained authorization is no longer active.",
    );
  }
}

function validateAuthorization(
  plan: ReadyGodotContainedHeadlessAdmission,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-contained-authorization-invalid",
      "Godot contained authorization must come from the active permission broker.",
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
    canonicalizeJson(command.permissions) !==
      canonicalizeJson([
        "read-project",
        "host-tool-inspection",
        "test-build",
      ]) ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== "godot-headless-project-startup" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.cancellation.mode !== "process-tree" ||
    command.cancellation.graceMs !==
      GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotHeadlessPreflight" ||
    workflow === undefined ||
    workflow.lifecycle !== "internal" ||
    workflow.steps.length !== 1 ||
    step?.id !== stepId ||
    step.commandId !== commandId ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked"
  ) {
    return fail(
      "godot-contained-authorization-invalid",
      "Registered Godot contained authority does not match the executor boundary.",
    );
  }
  const expected = createGodotContainedHeadlessAuthorizationRequest({
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
      "godot-contained-authorization-invalid",
      "Godot contained authorization is not exactly bound to its prepared plan.",
    );
  }
  return authorization;
}

function knownContainedRunRequest(value: unknown): value is RunGodotContainedHeadlessRequest {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
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
    preparedAuthorities.has(plan) &&
    Object.getOwnPropertyDescriptor(plan, "disposition")?.value === "ready"
  );
}

function cancellationRequested(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

export function isGodotContainedHeadlessRunRequest(
  value: unknown,
): value is RunGodotContainedHeadlessRequest {
  return knownContainedRunRequest(value);
}

function validateRunRequest(value: unknown): {
  readonly plan: ReadyGodotContainedHeadlessAdmission;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly authority: PreparedAuthority;
} {
  if (!knownContainedRunRequest(value)) {
    return fail(
      "godot-contained-execution-invalid",
      "Godot contained execution requires one exact same-process request.",
    );
  }
  const plan = Object.getOwnPropertyDescriptor(value, "plan")
    ?.value as ReadyGodotContainedHeadlessAdmission;
  const signal = Object.getOwnPropertyDescriptor(value, "signal")?.value;
  if (signal !== null && !(signal instanceof AbortSignal)) {
    return fail(
      "godot-contained-execution-invalid",
      "Godot contained cancellation signal is outside the runtime boundary.",
    );
  }
  const authority = authorityForReadyPlan(plan);
  const authorization = validateAuthorization(
    plan,
    Object.getOwnPropertyDescriptor(value, "authorization")?.value,
  );
  return Object.freeze({
    plan,
    authorization,
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
      "godot-contained-settlement-failed",
      "Godot contained effects could not be settled with the permission broker.",
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

function stableViolations(settlement: PermissionSettlement): readonly StableId[] {
  try {
    return Object.freeze(settlement.violations.map((entry) => parseStableId(entry)));
  } catch {
    return fail(
      "godot-contained-settlement-invalid",
      "Godot contained settlement returned a non-canonical violation code.",
    );
  }
}

function commandDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
  if (command === undefined) {
    return fail(
      "godot-contained-receipt-invalid",
      "Godot contained receipt lost its registered command.",
    );
  }
  return command;
}

function runReceiptFrom(
  plan: ReadyGodotContainedHeadlessAdmission,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  },
  code: StableId,
  message: string,
  engineRun?: ProcessContainmentEngineRunReport,
): RunReceipt {
  const command = commandDescriptor();
  const status = receiptStatus(settlement);
  const componentStatus =
    status === "succeeded"
      ? ("passed" as const)
      : status === "failed"
        ? ("failed" as const)
        : status === "cancelled"
          ? ("cancelled" as const)
          : ("uncertain" as const);
  const exitCode = engineRun?.process.exitCode;
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
        status: componentStatus,
        ...(typeof exitCode === "number" ? { exitCode } : {}),
        timedOut:
          engineRun !== undefined &&
          engineRun.termination.cause === "engine-timeout",
      },
      inner: {
        status: componentStatus,
        code,
        message,
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
        code,
        message,
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
      "godot-contained-receipt-persistence-failed",
      "Godot contained execution receipt could not be retained safely.",
      mutationUncertain ||
        (error instanceof Error &&
          "mutationUncertain" in error &&
          error.mutationUncertain === true),
    );
  }
}

function engineRunEvidence(
  report: ProcessContainmentEngineRunReport,
): GodotHeadlessPreflightEngineRunEvidence {
  if (
    report.request.profile.id !== PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID ||
    report.operationId !== "engine.headless-preflight" ||
    report.inputBindingDigest !== null ||
    report.termination.cause === "idle-timeout"
  ) {
    throw new GodotAdapterBoundaryError(
      "godot-headless-engine-report-profile-mismatch",
      "Godot headless preflight evidence requires the exact preflight execution profile.",
      true,
    );
  }

  return deepFreeze({
    requestDigest: report.requestDigest,
    reportDigest: report.reportDigest,
    admissionDigest: report.admissionDigest,
    profileDigest: report.profileDigest,
    snapshotBindingDigest: report.snapshotBindingDigest,
    projectSnapshotDigest: report.projectSnapshotDigest,
    executableSnapshotDigest: report.executableSnapshotDigest,
    process: {
      started: report.process.started,
      exitCode: report.process.exitCode,
      totalProcesses: report.process.totalProcesses,
      activeProcesses: report.process.activeProcesses,
    },
    output: report.output,
    termination: {
      requested: report.termination.requested,
      confirmed: report.termination.confirmed,
      cause: report.termination.cause,
    },
    effects: report.effects,
    outcome: report.outcome,
    mutationUncertain: report.mutationUncertain,
  });
}

function finalCode(
  settlement: PermissionSettlement,
):
  | "godot-headless-engine-process-failed"
  | "godot-headless-engine-run-cancelled"
  | "godot-headless-engine-run-uncertain"
  | "godot-headless-preflight-passed" {
  if (settlement.status === "succeeded") {
    return "godot-headless-preflight-passed";
  }
  if (settlement.status === "failed") {
    return "godot-headless-engine-process-failed";
  }
  if (settlement.status === "cancelled") {
    return "godot-headless-engine-run-cancelled";
  }
  return "godot-headless-engine-run-uncertain";
}

function preflightReportFrom(
  plan: ReadyGodotContainedHeadlessAdmission,
  report: ProcessContainmentEngineRunReport,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  receipt: RunReceipt,
  stored: Awaited<ReturnType<typeof persistRunReceipt>>,
): GodotHeadlessPreflightReport {
  const status = receiptStatus(settlement);
  const code = finalCode(settlement);
  const digestInput: GodotHeadlessPreflightDigestInput = deepFreeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    runId: plan.runId,
    project: plan.project,
    executable: plan.executable,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    versionProbe: plan.versionProbe,
    mode: "dynamic-main-scene",
    frameBudget: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET,
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    containment: plan.containment,
    status,
    code,
    blockers: Object.freeze([]),
    preconditions: Object.freeze({
      version: "passed" as const,
      containment: "passed" as const,
    }),
    isolation: Object.freeze({
      filesystem: "disposable-copy" as const,
      network: "denied" as const,
      childProcesses: "denied" as const,
      writablePaths: Object.freeze([]),
    }),
    execution: Object.freeze({
      processStarted: report.process.started,
      startedAt: report.startedAt,
      endedAt: report.completedAt,
      durationMs: report.durationMs,
    }),
    authorization: Object.freeze({
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: settlement.status,
      mutationUncertain: settlement.mutationUncertain,
      violations: stableViolations(settlement),
      approvalIds,
      durationMs: settlement.actual.durationMs,
      outputBytes: settlement.actual.outputBytes,
      settledAt: settlement.settledAt,
    }),
    engineRun: engineRunEvidence(report),
    receipt: Object.freeze({
      status: "retained" as const,
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
      headDigest: stored.headDigest,
      chainLength: stored.chainLength,
    }),
    support: Object.freeze({
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      reason:
        "Contained startup evidence was retained, but engine support remains planned until validation uses an installed Godot release.",
    }),
    mutationPerformed:
      !report.effects.sourceProjectPreserved ||
      !report.effects.sourceExecutablePreserved,
    externalProcessStarted: report.process.started,
    networkAccessPerformed: report.effects.networkConnectionEstablished,
  });
  const result = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: "engine.headless-preflight" as const,
    ...digestInput,
    preflightDigest: computeGodotHeadlessPreflightDigest(digestInput),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    {
      schemaId: godotHeadlessPreflightReportSchema.schemaId,
      digest: godotHeadlessPreflightReportSchema.digest,
    },
    result,
  ) as unknown as GodotHeadlessPreflightReport;
  assertGodotHeadlessPreflightReportSemantics(validated);
  return validated;
}

export async function runGodotContainedHeadless(
  value: unknown,
): Promise<GodotHeadlessPreflightReport> {
  const request = validateRunRequest(value);
  if (cancellationRequested(request.signal)) {
    settle(request.authorization, "cancelled", false, 0, 0, false);
    return fail(
      "godot-contained-cancelled-before-admission",
      "Godot contained execution was cancelled before admission.",
    );
  }
  try {
    await assertPreparedGodotContainedHeadlessAdmission(request.plan);
    assertAuthorizationActive(request.authorization);
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", false, 0, 0, false);
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    throw new GodotAdapterBoundaryError(
      "godot-contained-admission-authority-invalid",
      "Godot contained execution lost its authority before dispatch.",
      false,
    );
  }
  request.authority.consumed = true;
  const approvalIds = Object.freeze(
    [...request.authorization.lease.grantIds].sort().map((entry) =>
      parseStableId(entry),
    ),
  );
  const dispatchStartedMs = Date.now();
  let report: ProcessContainmentEngineRunReport;
  try {
    report = await runWindowsContainedGodotEngine({
      prepared: request.authority.preparedRun,
      signal: request.signal,
    });
  } catch (error) {
    const endedMs = Math.max(dispatchStartedMs, Date.now());
    const cancelledBeforeNativeReport =
      cancellationRequested(request.signal) &&
      error instanceof Error &&
      "code" in error &&
      error.code === "engine-run-cancelled-before-start";
    const mutationUncertain =
      error instanceof Error &&
      "mutationUncertain" in error &&
      error.mutationUncertain === true;
    const settlement = settle(
      request.authorization,
      cancelledBeforeNativeReport
        ? "cancelled"
        : mutationUncertain
          ? "uncertain"
          : "failed",
      mutationUncertain,
      endedMs - dispatchStartedMs,
      0,
      false,
    );
    const code = parseStableId(finalCode(settlement));
    const timing = Object.freeze({
      startedAt: new Date(dispatchStartedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
      durationMs: endedMs - dispatchStartedMs,
    });
    const receipt = runReceiptFrom(
      request.plan,
      settlement,
      approvalIds,
      timing,
      code,
      cancelledBeforeNativeReport
        ? "Contained startup was cancelled before a native process report was available."
        : mutationUncertain
        ? "Contained startup ended without a trustworthy final process report."
        : "Contained startup failed before a process report was retained.",
    );
    await retainReceipt(request.authority, receipt, mutationUncertain);
    throw new GodotAdapterBoundaryError(
      cancelledBeforeNativeReport
        ? "godot-contained-execution-cancelled"
        : mutationUncertain
        ? "godot-contained-execution-uncertain"
        : "godot-contained-execution-failed",
      "Godot contained execution did not return a trustworthy final report.",
      mutationUncertain || settlement.mutationUncertain,
    );
  }
  if (
    report.runId !== request.plan.runId ||
    report.requestDigest !== request.plan.containment.runRequestDigest ||
    report.admissionDigest !== request.plan.containment.admissionDigest ||
    report.profileDigest !== request.plan.containment.profileDigest ||
    report.snapshotBindingDigest !==
      request.plan.containment.snapshotBindingDigest ||
    report.projectSnapshotDigest !==
      request.plan.containment.projectSnapshotDigest ||
    report.executableSnapshotDigest !==
      request.plan.containment.executableSnapshotDigest
  ) {
    const settlement = settle(
      request.authorization,
      "uncertain",
      true,
      report.durationMs,
      report.output.capturedBytes,
      report.effects.networkConnectionEstablished,
    );
    const receipt = runReceiptFrom(
      request.plan,
      settlement,
      approvalIds,
      {
        startedAt: report.startedAt,
        endedAt: report.completedAt,
        durationMs: report.durationMs,
      },
      parseStableId("godot-headless-engine-run-uncertain"),
      "Contained startup report identity did not match its approved plan.",
      report,
    );
    await retainReceipt(request.authority, receipt, true);
    throw new GodotAdapterBoundaryError(
      "godot-contained-execution-uncertain",
      "Godot contained execution returned a mismatched report identity.",
      true,
    );
  }
  const settlement = settle(
    request.authorization,
    report.outcome,
    report.mutationUncertain,
    report.durationMs,
    report.output.capturedBytes,
    report.effects.networkConnectionEstablished,
  );
  const code = parseStableId(finalCode(settlement));
  const status = receiptStatus(settlement);
  const message =
    status === "succeeded"
      ? "Contained Godot startup completed within its approved safety boundary."
      : status === "failed"
        ? "Contained Godot startup completed with a process failure."
        : status === "cancelled"
          ? "Contained Godot startup was cancelled after native cleanup completed."
          : "Contained Godot startup ended with uncertain effects or an exceeded authority boundary.";
  const receipt = runReceiptFrom(
    request.plan,
    settlement,
    approvalIds,
    {
      startedAt: report.startedAt,
      endedAt: report.completedAt,
      durationMs: report.durationMs,
    },
    code,
    message,
    report,
  );
  const stored = await retainReceipt(
    request.authority,
    receipt,
    settlement.mutationUncertain,
  );
  return preflightReportFrom(
    request.plan,
    report,
    settlement,
    approvalIds,
    receipt,
    stored,
  );
}
