import {
  GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  digestCanonicalJson,
  parseStableId,
  type EngineExecutionSnapshotBinding,
  type GodotVersionProbeReport,
  type ProcessContainmentEngineAdmission,
  type ProjectStage,
  type ResolvedWorkflowPlan,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import { captureEngineExecutionSnapshots } from "@ai-game-playbook/engine-common";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
} from "@ai-game-playbook/registry";
import {
  assertWindowsContainedEngineAdmission,
  createWindowsContainedEngineAdmission,
  type WindowsContainedSyntheticLaunchWitness,
  type WindowsContainmentProviderRuntime,
} from "@ai-game-playbook/windows-containment-provider";

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
  | "godot-headless-contained-dispatch-unimplemented"
  | "godot-headless-version-unverified";

export interface PreparedGodotContainedHeadlessAdmission {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "blocked";
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
  readonly containment: {
    readonly admissionDigest: Sha256Digest;
    readonly providerDescriptorDigest: Sha256Digest;
    readonly providerCatalogDigest: Sha256Digest;
    readonly decision: "qualified";
    readonly evidenceGrade: "locally-executed";
    readonly expiresAt: string;
  };
  readonly invocationDigest: typeof GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST;
  readonly blockers: readonly GodotContainedHeadlessAdmissionBlocker[];
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "locally-executed";
    readonly reason: "Contained Godot dispatch is not implemented.";
  };
  readonly effects: {
    readonly engineProcessStarted: false;
    readonly projectMutationPerformed: false;
    readonly networkAccessPerformed: false;
  };
  readonly preparationDigest: Sha256Digest;
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
  readonly workflow: ResolvedWorkflowPlan;
  readonly canonicalPlan: string;
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
  return Object.freeze([
    "godot-headless-contained-dispatch-unimplemented" as const,
    ...(versionMatched
      ? []
      : (["godot-headless-version-unverified"] as const)),
  ]);
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
  const versionMatched = exactVersionMatch(request.versionProbe);
  const body = deepFreeze({
    schemaVersion: "1.0.0" as const,
    disposition: "blocked" as const,
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
    containment: {
      admissionDigest: admission.admissionDigest,
      providerDescriptorDigest: admission.providerDescriptorDigest,
      providerCatalogDigest: admission.providerCatalogDigest,
      decision: "qualified" as const,
      evidenceGrade: "locally-executed" as const,
      expiresAt: admission.expiresAt,
    },
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    blockers: blockers(versionMatched),
    support: {
      grade: "planned" as const,
      evidenceGrade: "locally-executed" as const,
      reason: "Contained Godot dispatch is not implemented." as const,
    },
    effects: {
      engineProcessStarted: false as const,
      projectMutationPerformed: false as const,
      networkAccessPerformed: false as const,
    },
  });
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
    workflow,
    canonicalPlan: canonicalizeJson(plan),
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
  if (
    canonicalizeJson(plan) !== authority.canonicalPlan ||
    plan.disposition !== "blocked" ||
    plan.blockers[0] !== "godot-headless-contained-dispatch-unimplemented" ||
    plan.effects.engineProcessStarted ||
    plan.effects.projectMutationPerformed ||
    plan.effects.networkAccessPerformed ||
    boundGodotVersionProbeRuntime(authority.versionProbe) !== authority.runtime ||
    plan.versionProbe.digest !== authority.versionProbe.probeDigest ||
    plan.snapshot.bindingDigest !== authority.binding.bindingDigest ||
    plan.containment.admissionDigest !== authority.admission.admissionDigest
  ) {
    return fail(
      "godot-contained-admission-plan-drift",
      "Godot contained admission no longer matches its same-process authority.",
    );
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
