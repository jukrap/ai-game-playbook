import {
  GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET,
  GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
  GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
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
  type ExecutionBudgets,
  type GodotHeadlessPreflightBlocker,
  type GodotHeadlessPreflightCommandInput,
  type GodotHeadlessPreflightContainmentBinding,
  type GodotHeadlessPreflightDigestInput,
  type GodotHeadlessPreflightReport,
  type GodotVersionProbeReport,
  type ProjectStage,
  type ProcessContainmentAssessmentReport,
  type ResolvedWorkflowPlan,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
  RUN_RECEIPT_STORE_PATH,
  assessProcessContainment,
  assertAuthorizedPermissionDecision,
  assertProcessContainmentAssessmentWitness,
  assertProcessExecutableIdentity,
  assertProjectRootIdentity,
  persistRunReceipt,
  resolveProjectPath,
  type AuthorizedPermissionDecision,
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { randomUUID } from "node:crypto";

import { GodotAdapterBoundaryError } from "./errors.js";
import { runGodotEngineStatusWithExecutable } from "./status.js";
import {
  boundGodotVersionProbeRuntime,
  type GodotVersionProbeRuntimeBinding,
} from "./version-probe.js";

export const GODOT_HEADLESS_PREFLIGHT_COMMAND_ID: StableId = parseStableId(
  "engine.headless-preflight",
);
export const GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID: StableId = parseStableId(
  "workflow.godot-headless-preflight",
);
export const GODOT_HEADLESS_PREFLIGHT_STEP_ID: StableId = parseStableId(
  "step.godot-headless-preflight",
);

export interface PrepareGodotHeadlessPreflightFromVersionProbeRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
}

export interface PreparedGodotHeadlessPreflight {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "ready";
  readonly runId: string;
  readonly commandId: typeof GODOT_HEADLESS_PREFLIGHT_COMMAND_ID;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: typeof GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID;
    readonly version: "1.0.0";
    readonly stepId: typeof GODOT_HEADLESS_PREFLIGHT_STEP_ID;
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
  readonly containment: GodotHeadlessPreflightContainmentBinding;
  readonly input: GodotHeadlessPreflightCommandInput;
  readonly planDigest: Sha256Digest;
}

export interface CreateGodotHeadlessPreflightAuthorizationRequest {
  readonly plan: PreparedGodotHeadlessPreflight;
  readonly deadlineAt: string;
}

export interface RunGodotHeadlessPreflightRequest {
  readonly plan: PreparedGodotHeadlessPreflight;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface PreparedGodotHeadlessPreflightInternals {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly versionReport: GodotVersionProbeReport;
  readonly runtime: GodotVersionProbeRuntimeBinding;
  readonly containmentReport: ProcessContainmentAssessmentReport;
  readonly workflow: ResolvedWorkflowPlan;
}

type DataRecord = Record<string, unknown>;

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
const preparedPreflightInternals = new WeakMap<
  object,
  PreparedGodotHeadlessPreflightInternals
>();

function fail(
  code: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new GodotAdapterBoundaryError(code, message, mutationUncertain);
}

function dataRecord(value: unknown, code: string, message: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return fail(code, message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    return fail(code, message);
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  code: string,
  message: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code, message);
  }
}

function schemaReference(
  schema:
    | typeof godotHeadlessPreflightRequestSchema
    | typeof godotHeadlessPreflightReportSchema
    | typeof runReceiptSchema,
) {
  return Object.freeze({ schemaId: schema.schemaId, digest: schema.digest });
}

function canonicalTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !timestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    fail(
      "godot-headless-authorization-invalid",
      "Godot headless authorization deadline must be a canonical UTC timestamp.",
    );
  }
  return value;
}

function exactTargetMatch(report: GodotVersionProbeReport): boolean {
  return (
    report.status === "matched" &&
    report.version?.exactTargetMatch === true &&
    report.version.version === GODOT_VERSION_PROBE_TARGET_VERSION &&
    report.version.releaseStatus === GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS &&
    report.authorization.status === "succeeded"
  );
}

async function assertReceiptStoreReady(root: CanonicalProjectRoot): Promise<void> {
  try {
    await resolveProjectPath(root, RUN_RECEIPT_STORE_PATH, {
      expectedType: "directory",
      existence: "required",
    });
  } catch {
    fail(
      "godot-headless-receipt-store-unavailable",
      "Godot headless preflight requires initialized project-local receipt storage.",
    );
  }
}

async function assertRuntimeBindings(
  report: GodotVersionProbeReport,
  runtime: GodotVersionProbeRuntimeBinding,
): Promise<void> {
  const assertBoundIdentities = async (): Promise<void> => {
    try {
      await assertProjectRootIdentity(runtime.root);
      await assertProcessExecutableIdentity(runtime.executable);
    } catch {
      fail(
        "godot-headless-plan-drift",
        "Godot project or executable identity changed before headless admission.",
      );
    }
  };
  await assertBoundIdentities();
  let status: Awaited<ReturnType<typeof runGodotEngineStatusWithExecutable>>;
  try {
    status = await runGodotEngineStatusWithExecutable(
      runtime.statusRequest,
      runtime.executable,
    );
  } catch {
    return fail(
      "godot-headless-plan-drift",
      "Godot project status could not be revalidated before headless admission.",
    );
  }
  if (status.status !== "ready") {
    fail(
      "godot-headless-plan-drift",
      "Godot project status is no longer ready for headless preflight.",
    );
  }
  if (
    status.project.rootIdentityDigest !== report.project.rootIdentityDigest ||
    status.project.inspectionDigest !== report.project.inspectionDigest ||
    status.executable.candidate?.digest !== report.executable.digest ||
    status.executable.candidate?.identityDigest !==
      report.executable.identityDigest ||
    status.project.canonicalPath !== runtime.root.canonicalPath
  ) {
    fail(
      "godot-headless-plan-drift",
      "Godot project or executable identity changed before headless admission.",
    );
  }
  await assertReceiptStoreReady(runtime.root);
  await assertBoundIdentities();
}

function runtimeContainmentDecision(
  report: ProcessContainmentAssessmentReport,
): unknown {
  return (report as unknown as Record<string, unknown>)["decision"];
}

function containmentBindingFrom(
  report: ProcessContainmentAssessmentReport,
): GodotHeadlessPreflightContainmentBinding {
  return Object.freeze({
    assessmentDigest: report.assessmentDigest,
    requestDigest: report.requestDigest,
    policyDigest: report.policyDigest,
    providerCatalogDigest: report.provider.catalogDigest,
    decision: "block",
    evidenceGrade: "implemented",
  });
}

async function assertContainmentWitness(
  report: ProcessContainmentAssessmentReport,
  root: CanonicalProjectRoot,
): Promise<GodotHeadlessPreflightContainmentBinding> {
  if (runtimeContainmentDecision(report) !== "block") {
    fail(
      "godot-headless-contained-dispatch-unimplemented",
      "Godot headless contained process dispatch is not implemented for this assessment decision.",
    );
  }
  try {
    await assertProcessContainmentAssessmentWitness(report, root);
  } catch {
    return fail(
      "godot-headless-containment-witness-invalid",
      "Godot headless containment assessment lost its same-process project authority.",
    );
  }
  if (
    report.projectRootIdentityDigest !== root.identityDigest ||
    report.policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    report.provider.catalogDigest !==
      PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST ||
    report.provider.status !== "unavailable" ||
    report.controls.filesystem.status !== "unavailable" ||
    report.controls.network.status !== "unavailable" ||
    report.controls.childProcesses.status !== "unavailable" ||
    report.probe.status !== "not-run" ||
    report.probe.externalProcessStarted ||
    report.probe.mutationPerformed ||
    report.probe.networkAccessPerformed
  ) {
    fail(
      "godot-headless-containment-witness-invalid",
      "Godot headless containment assessment is not an exact fail-closed witness.",
    );
  }
  return containmentBindingFrom(report);
}

function validatePreparationRequest(value: unknown): {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly versionProbe: GodotVersionProbeReport;
} {
  const record = dataRecord(
    value,
    "godot-headless-preparation-invalid",
    "Godot headless preparation request is malformed.",
  );
  exactKeys(
    record,
    ["projectId", "projectStage", "runId", "versionProbe"],
    "godot-headless-preparation-invalid",
    "Godot headless preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    fail(
      "godot-headless-preparation-invalid",
      "Godot headless preparation requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-headless-preparation-invalid",
      "Godot headless preparation requires one stable project identity.",
    );
  }
  if (!projectStages.has(record["projectStage"] as ProjectStage)) {
    fail(
      "godot-headless-preparation-invalid",
      "Godot headless preparation requires one supported project stage.",
    );
  }
  const versionProbe = record["versionProbe"] as GodotVersionProbeReport;
  try {
    assertGodotVersionProbeReportSemantics(versionProbe);
  } catch {
    fail(
      "godot-headless-version-report-invalid",
      "Godot headless preparation requires a valid version probe report.",
    );
  }
  return Object.freeze({
    runId: record["runId"],
    projectId,
    projectStage: record["projectStage"] as ProjectStage,
    versionProbe,
  });
}

export async function prepareGodotHeadlessPreflightFromVersionProbe(
  value: unknown,
): Promise<PreparedGodotHeadlessPreflight> {
  const request = validatePreparationRequest(value);
  const runtime = boundGodotVersionProbeRuntime(request.versionProbe);
  if (runtime === undefined) {
    fail(
      "godot-headless-version-report-untrusted",
      "Godot headless preparation requires an original same-process version report.",
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
    fail(
      "godot-headless-version-report-mismatch",
      "Godot version evidence does not match the selected project and executable.",
    );
  }
  await assertRuntimeBindings(request.versionProbe, runtime);
  let containmentReport: ProcessContainmentAssessmentReport;
  try {
    containmentReport = await assessProcessContainment({ root: runtime.root });
  } catch {
    return fail(
      "godot-headless-containment-assessment-failed",
      "Godot headless containment could not be assessed for the bound project.",
    );
  }
  const containment = await assertContainmentWitness(
    containmentReport,
    runtime.root,
  );
  const workflow = resolveWorkflowPlan(
    BUILTIN_REGISTRY,
    GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID,
    request.projectStage,
  );
  const step = workflow.steps[0];
  if (
    workflow.workflow.id !== GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID ||
    workflow.workflow.version !== "1.0.0" ||
    workflow.steps.length !== 1 ||
    step?.id !== GODOT_HEADLESS_PREFLIGHT_STEP_ID ||
    step.command.id !== GODOT_HEADLESS_PREFLIGHT_COMMAND_ID
  ) {
    fail(
      "godot-headless-workflow-invalid",
      "Registered Godot headless workflow does not match the executor boundary.",
    );
  }
  const input = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotHeadlessPreflightRequestSchema),
    {
      schemaVersion: "1.0.0",
      engine: "godot",
      versionProbeDigest: request.versionProbe.probeDigest,
      versionProbeStatus: request.versionProbe.status,
      projectRootIdentityDigest: request.versionProbe.project.rootIdentityDigest,
      projectInspectionDigest: request.versionProbe.project.inspectionDigest,
      executableDigest: request.versionProbe.executable.digest,
      executableIdentityDigest: request.versionProbe.executable.identityDigest,
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
  const body = Object.freeze({
    schemaVersion: "1.0.0" as const,
    disposition: "ready" as const,
    runId: request.runId,
    commandId: GODOT_HEADLESS_PREFLIGHT_COMMAND_ID,
    registryDigest: BUILTIN_REGISTRY.digest,
    workflow: Object.freeze({
      id: GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID,
      version: "1.0.0" as const,
      stepId: GODOT_HEADLESS_PREFLIGHT_STEP_ID,
      resolvedPlanDigest: workflow.resolvedPlanDigest,
    }),
    project: Object.freeze({
      id: request.projectId,
      identityDigest: runtime.root.identityDigest,
      rootIdentityDigest: request.versionProbe.project.rootIdentityDigest,
      inspectionDigest: request.versionProbe.project.inspectionDigest,
    }),
    executable: Object.freeze({
      digest: runtime.executable.digest,
      identityDigest: runtime.executable.identityDigest,
    }),
    versionProbe: Object.freeze({
      digest: request.versionProbe.probeDigest,
      status: request.versionProbe.status,
      exactTargetMatch: exactTargetMatch(request.versionProbe),
    }),
    containment,
    input,
  });
  const plan = Object.freeze({
    ...body,
    planDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-headless-preflight-plan",
      version: "1.0.0",
      ...body,
    }),
  });
  preparedPreflightInternals.set(
    plan,
    Object.freeze({
      root: runtime.root,
      executable: runtime.executable,
      versionReport: request.versionProbe,
      runtime,
      containmentReport,
      workflow,
    }),
  );
  return plan;
}

function internalsForPlan(
  plan: PreparedGodotHeadlessPreflight,
): PreparedGodotHeadlessPreflightInternals {
  const internals =
    typeof plan === "object" && plan !== null
      ? preparedPreflightInternals.get(plan)
      : undefined;
  if (internals === undefined) {
    fail(
      "godot-headless-plan-untrusted",
      "Godot headless execution requires a same-process prepared plan.",
    );
  }
  return internals;
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

export function createGodotHeadlessPreflightAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = dataRecord(
    value,
    "godot-headless-authorization-invalid",
    "Godot headless authorization request is malformed.",
  );
  exactKeys(
    record,
    ["deadlineAt", "plan"],
    "godot-headless-authorization-invalid",
    "Godot headless authorization request contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotHeadlessPreflight;
  internalsForPlan(plan);
  const deadlineAt = canonicalTimestamp(record["deadlineAt"]);
  const objectIds = Object.freeze(
    [
      plan.executable.digest,
      plan.executable.identityDigest,
      plan.containment.assessmentDigest,
      plan.containment.policyDigest,
      plan.containment.providerCatalogDigest,
      plan.containment.requestDigest,
      plan.project.inspectionDigest,
      plan.versionProbe.digest,
    ]
      .filter((entry, index, values) => values.indexOf(entry) === index)
      .sort(),
  );
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: GODOT_HEADLESS_PREFLIGHT_COMMAND_ID,
    input: plan.input,
    workflow: Object.freeze({
      id: plan.workflow.id,
      stepId: plan.workflow.stepId,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    }),
    scope: Object.freeze({
      paths: Object.freeze(["project.godot"]),
      objectIds,
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
      "godot-headless-authorization-invalid",
      "Godot headless authorization is no longer active within its deadline.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotHeadlessPreflight,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-headless-authorization-invalid",
      "Godot headless authorization must be produced by the active permission broker.",
    );
  }
  assertAuthorizationActive(authorization);
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === GODOT_HEADLESS_PREFLIGHT_COMMAND_ID,
  );
  const workflow = BUILTIN_REGISTRY.workflows.find(
    ({ id }) => id === GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID,
  );
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
    step?.id !== GODOT_HEADLESS_PREFLIGHT_STEP_ID ||
    step.commandId !== GODOT_HEADLESS_PREFLIGHT_COMMAND_ID ||
    step.approvalCheckpoint ||
    step.onFailure !== "blocked"
  ) {
    fail(
      "godot-headless-authorization-invalid",
      "Registered Godot headless authority does not match the executor boundary.",
    );
  }
  const expected = createGodotHeadlessPreflightAuthorizationRequest({
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
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 1
  ) {
    fail(
      "godot-headless-authorization-invalid",
      "Godot headless authorization is not exactly bound to the prepared plan.",
    );
  }
  return authorization;
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotHeadlessPreflight;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly internals: PreparedGodotHeadlessPreflightInternals;
} {
  const record = dataRecord(
    value,
    "godot-headless-execution-invalid",
    "Godot headless execution request is malformed.",
  );
  exactKeys(
    record,
    ["authorization", "plan", "signal"],
    "godot-headless-execution-invalid",
    "Godot headless execution request contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotHeadlessPreflight;
  const internals = internalsForPlan(plan);
  const signal = record["signal"];
  if (signal !== null && !(signal instanceof AbortSignal)) {
    fail(
      "godot-headless-execution-invalid",
      "Godot headless cancellation signal is outside the runtime boundary.",
    );
  }
  const authorization = validateAuthorization(plan, record["authorization"]);
  return Object.freeze({
    plan,
    authorization,
    signal: signal as AbortSignal | null,
    internals,
  });
}

function emptyEffects(durationMs: number) {
  return {
    changedPaths: Object.freeze([]),
    changedBytes: 0,
    objectIds: Object.freeze([]),
    destinations: Object.freeze([]),
    dataClasses: Object.freeze([]),
    changeKinds: Object.freeze([]),
    publishTargets: Object.freeze([]),
    durationMs,
    outputBytes: 0,
    repairCycles: 0,
  };
}

function settle(
  authorization: AuthorizedPermissionDecision,
  outcome: "failed" | "cancelled",
  durationMs: number,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome,
      mutationUncertain: false,
      actual: emptyEffects(durationMs),
    });
  } catch {
    return fail(
      "godot-headless-settlement-failed",
      "Godot headless effects could not be settled with the permission broker.",
    );
  }
}

async function assertPlanStable(
  plan: PreparedGodotHeadlessPreflight,
  internals: PreparedGodotHeadlessPreflightInternals,
): Promise<void> {
  const containment = await assertContainmentWitness(
    internals.containmentReport,
    internals.root,
  );
  if (
    canonicalizeJson(containment) !== canonicalizeJson(plan.containment) ||
    canonicalizeJson(containment) !==
      canonicalizeJson(plan.input.containment)
  ) {
    fail(
      "godot-headless-containment-witness-invalid",
      "Godot headless plan no longer matches its containment assessment.",
    );
  }
  if (
    boundGodotVersionProbeRuntime(internals.versionReport) !==
      internals.runtime ||
    internals.versionReport.probeDigest !== plan.versionProbe.digest ||
    internals.versionReport.status !== plan.versionProbe.status
  ) {
    fail(
      "godot-headless-plan-drift",
      "Godot version evidence changed before headless admission.",
    );
  }
  await assertRuntimeBindings(internals.versionReport, internals.runtime);
  const workflow = resolveWorkflowPlan(
    BUILTIN_REGISTRY,
    GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID,
    internals.workflow.projectStage,
  );
  if (
    workflow.resolvedPlanDigest !== plan.workflow.resolvedPlanDigest ||
    canonicalizeJson(workflow) !== canonicalizeJson(internals.workflow)
  ) {
    fail(
      "godot-headless-plan-drift",
      "Godot headless workflow identity changed before admission.",
    );
  }
}

function blockersForPlan(
  plan: PreparedGodotHeadlessPreflight,
): readonly GodotHeadlessPreflightBlocker[] {
  return Object.freeze([
    "godot-headless-containment-unavailable" as const,
    ...(plan.versionProbe.exactTargetMatch
      ? []
      : (["godot-headless-version-unverified"] as const)),
  ]);
}

function currentPlatform(root: CanonicalProjectRoot): "windows" | "linux" | "macos" {
  if (root.platform === "win32") return "windows";
  if (root.platform === "linux") return "linux";
  if (root.platform === "darwin") return "macos";
  return fail(
    "godot-headless-runtime-unsupported",
    "Godot headless receipt storage requires a supported runtime platform.",
  );
}

function currentArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  return fail(
    "godot-headless-runtime-unsupported",
    "Godot headless receipt storage requires a supported runtime architecture.",
  );
}

function receiptFrom(
  plan: PreparedGodotHeadlessPreflight,
  internals: PreparedGodotHeadlessPreflightInternals,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  blockers: readonly GodotHeadlessPreflightBlocker[],
  startedAt: string,
  endedAt: string,
  durationMs: number,
): RunReceipt {
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === GODOT_HEADLESS_PREFLIGHT_COMMAND_ID,
  );
  if (command === undefined || settlement.status !== "failed") {
    fail(
      "godot-headless-receipt-invalid",
      "Godot headless admission could not produce a bounded blocked receipt.",
    );
  }
  const primary = blockers[0];
  if (primary === undefined) {
    fail(
      "godot-headless-receipt-invalid",
      "Godot headless blocked receipt requires one blocker.",
    );
  }
  const body = {
    schemaVersion: runReceiptSchema.version,
    receiptId: randomUUID(),
    status: "blocked" as const,
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
      platform: currentPlatform(internals.root),
      architecture: currentArchitecture(),
      nodeVersion: parseSemanticVersion(process.versions.node).value,
      projectIdentityDigest: internals.root.identityDigest,
      ...(plan.versionProbe.exactTargetMatch
        ? {
            engine: {
              id: "godot" as const,
              version: GODOT_VERSION_PROBE_TARGET_VERSION,
            },
          }
        : {}),
    },
    timing: { startedAt, endedAt, durationMs },
    effects: {
      changedPaths: Object.freeze([]),
      changedBytes: 0,
      objectIds: Object.freeze([]),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze([]),
      publishTargets: Object.freeze([]),
      durationMs,
      outputBytes: 0,
      repairCycles: 0,
    },
    outcomes: {
      outer: { status: "blocked" as const, timedOut: false },
      inner: {
        status: "blocked" as const,
        code: parseStableId(primary),
        message:
          "Godot headless preflight did not start because required safety preconditions were unavailable.",
      },
    },
    mutation: {
      status: "none" as const,
      changedFiles: Object.freeze([]),
      unexpectedDirtyFiles: Object.freeze([]),
    },
    artifacts: Object.freeze([]),
    diagnostics: Object.freeze(
      blockers.map((code) => ({
        severity: "warning" as const,
        code: parseStableId(code),
        message:
          code === "godot-headless-containment-unavailable"
            ? `Containment assessment ${plan.containment.assessmentDigest} blocked startup because provider catalog ${plan.containment.providerCatalogDigest} has no validated provider.`
            : "The exact target Godot version was not verified.",
        redacted: true,
      })),
    ),
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
    schemaReference(runReceiptSchema),
    receipt,
  ) as unknown as RunReceipt;
}

function reportFrom(
  plan: PreparedGodotHeadlessPreflight,
  stored: Awaited<ReturnType<typeof persistRunReceipt>>,
  receipt: RunReceipt,
  settlement: PermissionSettlement,
  approvalIds: readonly StableId[],
  blockers: readonly GodotHeadlessPreflightBlocker[],
): GodotHeadlessPreflightReport {
  const versionMatched = plan.versionProbe.exactTargetMatch;
  const digestInput: GodotHeadlessPreflightDigestInput = Object.freeze({
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
    status: "blocked",
    code: blockers[0] as GodotHeadlessPreflightBlocker,
    blockers,
    preconditions: Object.freeze({
      version: versionMatched ? "passed" : "blocked",
      containment: "blocked",
    }),
    isolation: Object.freeze({
      filesystem: "unavailable",
      network: "unavailable",
      childProcesses: "unavailable",
      writablePaths: Object.freeze([]),
    }),
    execution: Object.freeze({
      processStarted: false,
      ...receipt.timing,
    }),
    authorization: Object.freeze({
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: "failed",
      mutationUncertain: false,
      violations: Object.freeze([]),
      approvalIds,
      durationMs: settlement.actual.durationMs,
      outputBytes: 0,
      settledAt: settlement.settledAt,
    }),
    receipt: Object.freeze({
      status: "retained",
      receiptId: receipt.receiptId,
      receiptDigest: receipt.receiptDigest,
      headDigest: stored.headDigest,
      chainLength: stored.chainLength,
    }),
    support: Object.freeze({
      grade: "planned",
      evidenceGrade: "implemented",
      reason: "No contained Godot project process was started.",
    }),
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  });
  const report = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: "engine.headless-preflight" as const,
    ...digestInput,
    preflightDigest: computeGodotHeadlessPreflightDigest(digestInput),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotHeadlessPreflightReportSchema),
    report,
  ) as unknown as GodotHeadlessPreflightReport;
  assertGodotHeadlessPreflightReportSemantics(validated);
  return validated;
}

export async function runGodotHeadlessPreflight(
  value: unknown,
): Promise<GodotHeadlessPreflightReport> {
  const request = validateRunRequest(value);
  if (request.signal?.aborted === true) {
    settle(request.authorization, "cancelled", 0);
    fail(
      "godot-headless-cancelled-before-admission",
      "Godot headless preflight was cancelled before admission.",
    );
  }
  const startedMs = Date.now();
  try {
    await assertPlanStable(request.plan, request.internals);
    assertAuthorizationActive(request.authorization);
  } catch (error) {
    const endedMs = Math.max(startedMs, Date.now());
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", endedMs - startedMs);
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    throw new GodotAdapterBoundaryError(
      "godot-headless-plan-drift",
      "Godot headless plan could not be revalidated before admission.",
      false,
    );
  }
  const endedMs = Math.max(startedMs, Date.now());
  const durationMs = endedMs - startedMs;
  const settlement = settle(request.authorization, "failed", durationMs);
  const approvalIds = Object.freeze(
    [...request.authorization.lease.grantIds].sort(),
  );
  if (
    settlement.status !== "failed" ||
    settlement.mutationUncertain ||
    settlement.violations.length > 0
  ) {
    fail(
      "godot-headless-scope-violation",
      "Godot headless blocked admission exceeded its approved scope or budget.",
      true,
    );
  }
  const blockers = blockersForPlan(request.plan);
  const startedAt = new Date(startedMs).toISOString();
  const endedAt = new Date(endedMs).toISOString();
  const receipt = receiptFrom(
    request.plan,
    request.internals,
    settlement,
    approvalIds,
    blockers,
    startedAt,
    endedAt,
    durationMs,
  );
  let stored: Awaited<ReturnType<typeof persistRunReceipt>>;
  try {
    stored = await persistRunReceipt({
      root: request.internals.root,
      registry: BUILTIN_REGISTRY,
      receipt,
      maxArtifactBytes: 0,
    });
  } catch (error) {
    throw new GodotAdapterBoundaryError(
      "godot-headless-receipt-persistence-failed",
      "Godot headless blocked receipt could not be retained safely.",
      error instanceof Error &&
        "mutationUncertain" in error &&
        error.mutationUncertain === true,
    );
  }
  return reportFrom(
    request.plan,
    stored,
    receipt,
    settlement,
    approvalIds,
    blockers,
  );
}
