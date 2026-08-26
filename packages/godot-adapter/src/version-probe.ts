import {
  ENGINE_STATUS_MAX_EXECUTABLE_BYTES,
  GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  assertGodotVersionProbeReportSemantics,
  canonicalizeJson,
  computeGodotVersionProbeDigest,
  digestCanonicalJson,
  engineStatusRequestSchema,
  godotVersionProbeReportSchema,
  godotVersionProbeRequestSchema,
  parseStableId,
  type EngineStatusReport,
  type EngineStatusRequest,
  type ExecutionBudgets,
  type GodotVersionProbeCommandInput,
  type GodotVersionProbeDigestInput,
  type GodotVersionProbeReport,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  assertAuthorizedPermissionDecision,
  assertProcessExecutableIdentity,
  assertProjectRootIdentity,
  bindProcessExecutable,
  canonicalizeProjectRoot,
  runBoundedProcess,
  type AuthorizedPermissionDecision,
  type BoundProcessExecutable,
  type BoundedProcessResult,
  type CanonicalProjectRoot,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

import { GodotAdapterBoundaryError } from "./errors.js";
import { runGodotEngineStatus } from "./status.js";
import {
  classifyGodotVersionProbeResult,
  type GodotVersionProbeResult,
} from "./version-probe-result.js";

export const GODOT_VERSION_PROBE_COMMAND_ID: StableId =
  parseStableId("engine.version-probe");
export const GODOT_VERSION_PROBE_PROCESS_TIMEOUT_MS: number = 5_000;
export const GODOT_VERSION_PROBE_IDLE_TIMEOUT_MS: number = 2_000;
export const GODOT_VERSION_PROBE_TERMINATION_GRACE_MS: number = 1_000;
export const GODOT_VERSION_PROBE_COMMAND_TIMEOUT_MS: number = 10_000;

export interface PrepareGodotVersionProbeRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly request: EngineStatusRequest;
  readonly executablePath: string;
}

export interface PreparedGodotVersionProbe {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "ready";
  readonly runId: string;
  readonly commandId: typeof GODOT_VERSION_PROBE_COMMAND_ID;
  readonly registryDigest: Sha256Digest;
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
  readonly statusDigest: Sha256Digest;
  readonly input: GodotVersionProbeCommandInput;
  readonly planDigest: Sha256Digest;
}

export interface CreateGodotVersionProbeAuthorizationRequest {
  readonly plan: PreparedGodotVersionProbe;
  readonly deadlineAt: string;
}

export interface RunGodotVersionProbeRequest {
  readonly plan: PreparedGodotVersionProbe;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface PreparedGodotVersionProbeInternals {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly statusRequest: EngineStatusRequest;
}

type DataRecord = Record<string, unknown>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const preparedProbeInternals = new WeakMap<
  object,
  PreparedGodotVersionProbeInternals
>();

function fail(
  code: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new GodotAdapterBoundaryError(code, message, mutationUncertain);
}

function dataRecord(
  value: unknown,
  code: string,
  message: string,
): DataRecord {
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
    | typeof engineStatusRequestSchema
    | typeof godotVersionProbeRequestSchema
    | typeof godotVersionProbeReportSchema,
) {
  return Object.freeze({ schemaId: schema.schemaId, digest: schema.digest });
}

function canonicalTimestamp(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !timestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    fail(code, "Godot version probe deadline must be a canonical UTC timestamp.");
  }
  return value;
}

function validatePreparationRequest(
  value: unknown,
): Readonly<PrepareGodotVersionProbeRequest> {
  const record = dataRecord(
    value,
    "godot-version-preparation-invalid",
    "Godot version probe preparation contains invalid authority.",
  );
  exactKeys(
    record,
    ["executablePath", "projectId", "request", "runId"],
    "godot-version-preparation-invalid",
    "Godot version probe preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    fail(
      "godot-version-preparation-invalid",
      "Godot version probe requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-version-preparation-invalid",
      "Godot version probe requires one stable project identity.",
    );
  }
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(engineStatusRequestSchema),
    record["request"],
  ) as unknown as EngineStatusRequest;
  if (typeof record["executablePath"] !== "string") {
    fail(
      "godot-version-preparation-invalid",
      "Godot version probe requires one explicit executable candidate.",
    );
  }
  return Object.freeze({
    runId: record["runId"] as string,
    projectId,
    request,
    executablePath: record["executablePath"] as string,
  });
}

function assertReadyStatus(report: EngineStatusReport): void {
  if (
    report.status !== "ready" ||
    report.project.status !== "detected" ||
    report.project.rootIdentityDigest === undefined ||
    report.project.inspectionDigest === undefined ||
    report.executable.status !== "candidate" ||
    report.executable.candidate === undefined ||
    report.compatibility.status !== "major-minor-match"
  ) {
    fail(
      "godot-version-status-not-ready",
      "Static Godot project and executable identity must be ready before a version process is planned.",
    );
  }
}

function sameStatus(left: EngineStatusReport, right: EngineStatusReport): boolean {
  return (
    left.statusDigest === right.statusDigest &&
    left.project.rootIdentityDigest === right.project.rootIdentityDigest &&
    left.project.inspectionDigest === right.project.inspectionDigest &&
    left.executable.candidate?.digest === right.executable.candidate?.digest &&
    left.executable.candidate?.identityDigest ===
      right.executable.candidate?.identityDigest
  );
}

function statusMatchesBindings(
  status: EngineStatusReport,
  root: CanonicalProjectRoot,
  executable: BoundProcessExecutable,
): boolean {
  return (
    status.project.canonicalPath === root.canonicalPath &&
    status.project.rootIdentityDigest === root.identityDigest &&
    status.executable.candidate?.digest === executable.digest &&
    status.executable.candidate?.identityDigest === executable.identityDigest &&
    status.executable.candidate?.bytes === executable.size
  );
}

function planBody(
  value: Omit<PreparedGodotVersionProbe, "planDigest">,
): Omit<PreparedGodotVersionProbe, "planDigest"> {
  return Object.freeze(value);
}

export async function prepareGodotVersionProbe(
  value: unknown,
): Promise<PreparedGodotVersionProbe> {
  const request = validatePreparationRequest(value);
  const firstStatus = await runGodotEngineStatus(request.request, {
    executablePath: request.executablePath,
  });
  assertReadyStatus(firstStatus);
  const root = await canonicalizeProjectRoot(request.request.projectRoot);
  const executable = await bindProcessExecutable({
    path: request.executablePath,
    maxBytes: ENGINE_STATUS_MAX_EXECUTABLE_BYTES,
    allowedEnvironmentKeys: Object.freeze([]),
  });
  const secondStatus = await runGodotEngineStatus(request.request, {
    executablePath: executable.canonicalPath,
  });
  assertReadyStatus(secondStatus);
  if (
    !sameStatus(firstStatus, secondStatus) ||
    !statusMatchesBindings(secondStatus, root, executable)
  ) {
    fail(
      "godot-version-plan-drift",
      "Godot project or executable identity changed during version probe preparation.",
    );
  }
  await assertProjectRootIdentity(root);
  await assertProcessExecutableIdentity(executable);
  const inspectionDigest = secondStatus.project.inspectionDigest;
  const rootIdentityDigest = secondStatus.project.rootIdentityDigest;
  const candidate = secondStatus.executable.candidate;
  if (
    inspectionDigest === undefined ||
    rootIdentityDigest === undefined ||
    candidate === undefined
  ) {
    fail(
      "godot-version-plan-drift",
      "Godot version probe lost a required static identity.",
    );
  }
  const input = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotVersionProbeRequestSchema),
    {
      schemaVersion: "1.0.0",
      engine: "godot",
      statusDigest: secondStatus.statusDigest,
      projectRootIdentityDigest: rootIdentityDigest,
      projectInspectionDigest: inspectionDigest,
      executableDigest: candidate.digest,
      executableIdentityDigest: candidate.identityDigest,
      targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
      targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    },
  ) as unknown as GodotVersionProbeCommandInput;
  const body = planBody({
    schemaVersion: "1.0.0",
    disposition: "ready",
    runId: request.runId,
    commandId: GODOT_VERSION_PROBE_COMMAND_ID,
    registryDigest: BUILTIN_REGISTRY.digest,
    project: Object.freeze({
      id: request.projectId,
      identityDigest: root.identityDigest,
      rootIdentityDigest,
      inspectionDigest,
    }),
    executable: Object.freeze({
      digest: executable.digest,
      identityDigest: executable.identityDigest,
    }),
    statusDigest: secondStatus.statusDigest,
    input,
  });
  const plan = Object.freeze({
    ...body,
    planDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-version-probe-plan",
      version: "1.0.0",
      ...body,
    }),
  });
  preparedProbeInternals.set(
    plan,
    Object.freeze({ root, executable, statusRequest: request.request }),
  );
  return plan;
}

function internalsForPlan(
  plan: PreparedGodotVersionProbe,
): PreparedGodotVersionProbeInternals {
  const internals =
    typeof plan === "object" && plan !== null
      ? preparedProbeInternals.get(plan)
      : undefined;
  if (internals === undefined) {
    fail(
      "godot-version-plan-untrusted",
      "Godot version execution requires a same-process prepared plan.",
    );
  }
  return internals;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_VERSION_PROBE_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

export function createGodotVersionProbeAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = dataRecord(
    value,
    "godot-version-authorization-invalid",
    "Godot version authorization request is malformed.",
  );
  exactKeys(
    record,
    ["deadlineAt", "plan"],
    "godot-version-authorization-invalid",
    "Godot version authorization request contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotVersionProbe;
  internalsForPlan(plan);
  const deadlineAt = canonicalTimestamp(
    record["deadlineAt"],
    "godot-version-authorization-invalid",
  );
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: GODOT_VERSION_PROBE_COMMAND_ID,
    input: plan.input,
    scope: Object.freeze({
      paths: Object.freeze(["project.godot"]),
      objectIds: Object.freeze([]),
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
      "godot-version-authorization-invalid",
      "Godot version authorization is no longer active within its deadline.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotVersionProbe,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-version-authorization-invalid",
      "Godot version authorization must be produced by the active permission broker.",
    );
  }
  assertAuthorizationActive(authorization);
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === GODOT_VERSION_PROBE_COMMAND_ID,
  );
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "parallel-read" ||
    command.permissions.length !== 1 ||
    command.permissions[0] !== "read-project" ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "process" ||
    command.sideEffects[0]?.scope !== "godot-version-probe" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.cancellation.mode !== "process-tree" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotVersionProbe"
  ) {
    fail(
      "godot-version-authorization-invalid",
      "Registered Godot version authority does not match the executor boundary.",
    );
  }
  const expected = createGodotVersionProbeAuthorizationRequest({
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
    challenge.permissions.length !== 1 ||
    challenge.permissions[0]?.permission !== "read-project" ||
    challenge.permissions[0]?.mode !== "automatic" ||
    challenge.feature !== undefined ||
    challenge.workflow !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 0
  ) {
    fail(
      "godot-version-authorization-invalid",
      "Godot version authorization is not exactly bound to the prepared plan.",
    );
  }
  return authorization;
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotVersionProbe;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
  readonly internals: PreparedGodotVersionProbeInternals;
} {
  const record = dataRecord(
    value,
    "godot-version-execution-invalid",
    "Godot version execution request is malformed.",
  );
  exactKeys(
    record,
    ["authorization", "plan", "signal"],
    "godot-version-execution-invalid",
    "Godot version execution request contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotVersionProbe;
  const internals = internalsForPlan(plan);
  const signal = record["signal"];
  if (signal !== null && !(signal instanceof AbortSignal)) {
    fail(
      "godot-version-execution-invalid",
      "Godot version cancellation signal is outside the runtime boundary.",
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

async function assertPlanStable(
  plan: PreparedGodotVersionProbe,
  internals: PreparedGodotVersionProbeInternals,
): Promise<void> {
  await assertProjectRootIdentity(internals.root);
  await assertProcessExecutableIdentity(internals.executable);
  const status = await runGodotEngineStatus(internals.statusRequest, {
    executablePath: internals.executable.canonicalPath,
  });
  assertReadyStatus(status);
  if (
    status.statusDigest !== plan.statusDigest ||
    !statusMatchesBindings(status, internals.root, internals.executable)
  ) {
    fail(
      "godot-version-plan-drift",
      "Godot project or executable identity changed before process dispatch.",
    );
  }
  await assertProjectRootIdentity(internals.root);
  await assertProcessExecutableIdentity(internals.executable);
}

function emptyEffects(
  durationMs: number,
  outputBytes: number,
) {
  return {
    changedPaths: Object.freeze([]),
    changedBytes: 0,
    objectIds: Object.freeze([]),
    destinations: Object.freeze([]),
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
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome: mutationUncertain ? "uncertain" : outcome,
      mutationUncertain,
      actual: emptyEffects(durationMs, outputBytes),
    });
  } catch {
    return fail(
      "godot-version-settlement-failed",
      "Godot version effects could not be settled with the permission broker.",
      mutationUncertain,
    );
  }
}

function adapterError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  mutationUncertain = false,
): GodotAdapterBoundaryError {
  if (error instanceof GodotAdapterBoundaryError) return error;
  if (error instanceof CoreBoundaryError) {
    return new GodotAdapterBoundaryError(
      fallbackCode,
      fallbackMessage,
      mutationUncertain || error.mutationUncertain,
    );
  }
  return new GodotAdapterBoundaryError(
    fallbackCode,
    fallbackMessage,
    mutationUncertain,
  );
}

function reportFrom(
  plan: PreparedGodotVersionProbe,
  processResult: BoundedProcessResult,
  probe: GodotVersionProbeResult,
  settlement: PermissionSettlement,
): GodotVersionProbeReport {
  if (settlement.status === "scope-violation") {
    fail(
      "godot-version-scope-violation",
      "Godot version execution exceeded its approved scope or budget.",
      true,
    );
  }
  const authorization = Object.freeze({
    authorizationId: settlement.authorizationId,
    requestDigest: settlement.requestDigest,
    status: settlement.status,
    mutationUncertain: settlement.mutationUncertain,
    violations: Object.freeze(
      settlement.violations.map((violation) => parseStableId(violation)),
    ),
    durationMs: settlement.actual.durationMs,
    outputBytes: settlement.actual.outputBytes,
    settledAt: settlement.settledAt,
  });
  const digestInput: GodotVersionProbeDigestInput = Object.freeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: plan.registryDigest,
    runId: plan.runId,
    project: plan.project,
    executable: plan.executable,
    targetVersion: probe.targetVersion,
    targetReleaseStatus: probe.targetReleaseStatus,
    status: probe.status,
    code: probe.code,
    process: probe.process,
    output: probe.output,
    ...(probe.version === undefined ? {} : { version: probe.version }),
    execution: Object.freeze({
      startedAt: processResult.startedAt,
      endedAt: processResult.endedAt,
      durationMs: processResult.durationMs,
      processStarted: processResult.identity !== undefined,
    }),
    isolation: Object.freeze({
      filesystem: "not-enforced" as const,
      network: "not-enforced" as const,
    }),
    authorization,
  });
  const report = Object.freeze({
    schemaVersion: "1.0.0" as const,
    commandId: "engine.version-probe" as const,
    ...digestInput,
    probeDigest: computeGodotVersionProbeDigest(digestInput),
  });
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotVersionProbeReportSchema),
    report,
  ) as unknown as GodotVersionProbeReport;
  assertGodotVersionProbeReportSemantics(validated);
  return validated;
}

export async function runGodotVersionProbe(
  value: unknown,
): Promise<GodotVersionProbeReport> {
  const request = validateRunRequest(value);
  const startedAt = performance.now();
  if (request.signal?.aborted === true) {
    const settlement = settle(request.authorization, "cancelled", false, 0, 0);
    fail(
      "godot-version-cancelled-before-spawn",
      "Godot version execution was cancelled before process dispatch.",
      settlement.mutationUncertain,
    );
  }
  try {
    await assertPlanStable(request.plan, request.internals);
  } catch (error) {
    const errorMutationUncertain =
      error instanceof GodotAdapterBoundaryError || error instanceof CoreBoundaryError
        ? error.mutationUncertain
        : false;
    const settlement = settle(
      request.authorization,
      "failed",
      errorMutationUncertain,
      Math.max(0, Math.ceil(performance.now() - startedAt)),
      0,
    );
    throw new GodotAdapterBoundaryError(
      "godot-version-plan-drift",
      "Godot version plan could not be revalidated before process dispatch.",
      errorMutationUncertain || settlement.mutationUncertain,
    );
  }
  try {
    assertAuthorizationActive(request.authorization);
  } catch {
    const settlement = settle(
      request.authorization,
      "failed",
      false,
      Math.max(0, Math.ceil(performance.now() - startedAt)),
      0,
    );
    fail(
      "godot-version-authorization-invalid",
      "Godot version authorization expired before process dispatch.",
      settlement.mutationUncertain,
    );
  }

  let processResult: BoundedProcessResult;
  try {
    processResult = await runBoundedProcess({
      root: request.internals.root,
      executable: request.internals.executable,
      arguments: Object.freeze(["--version"]),
      workingDirectory: null,
      environment: Object.freeze({}),
      limits: Object.freeze({
        timeoutMs: GODOT_VERSION_PROBE_PROCESS_TIMEOUT_MS,
        idleTimeoutMs: GODOT_VERSION_PROBE_IDLE_TIMEOUT_MS,
        maxOutputBytes: GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
        terminationGraceMs: GODOT_VERSION_PROBE_TERMINATION_GRACE_MS,
      }),
      signal: request.signal,
    });
  } catch (error) {
    const cancelled =
      error instanceof CoreBoundaryError &&
      error.code === "process-cancelled-before-spawn";
    const settlement = settle(
      request.authorization,
      cancelled ? "cancelled" : "failed",
      error instanceof CoreBoundaryError && error.mutationUncertain,
      Math.max(0, Math.ceil(performance.now() - startedAt)),
      0,
    );
    throw adapterError(
      error,
      cancelled
        ? "godot-version-cancelled-before-spawn"
        : "godot-version-process-dispatch-failed",
      cancelled
        ? "Godot version execution was cancelled before process dispatch."
        : "Godot version process could not be dispatched safely.",
      settlement.mutationUncertain,
    );
  }

  let probe: GodotVersionProbeResult;
  try {
    probe = classifyGodotVersionProbeResult(processResult);
  } catch (error) {
    settle(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, Math.ceil(performance.now() - startedAt)),
      processResult.output.observedBytes,
    );
    throw adapterError(
      error,
      "godot-version-result-invalid",
      "Godot version process result could not be normalized safely.",
      true,
    );
  }
  try {
    await assertProjectRootIdentity(request.internals.root);
    await assertProcessExecutableIdentity(request.internals.executable);
    const postStatus = await runGodotEngineStatus(request.internals.statusRequest, {
      executablePath: request.internals.executable.canonicalPath,
    });
    assertReadyStatus(postStatus);
    if (
      postStatus.statusDigest !== request.plan.statusDigest ||
      !statusMatchesBindings(
        postStatus,
        request.internals.root,
        request.internals.executable,
      )
    ) {
      fail(
        "godot-version-plan-drift",
        "Godot project or executable identity changed during process execution.",
        true,
      );
    }
  } catch (error) {
    settle(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, Math.ceil(performance.now() - startedAt)),
      processResult.output.observedBytes,
    );
    throw new GodotAdapterBoundaryError(
      "godot-version-plan-drift",
      "Godot project or executable identity changed during process execution.",
      true,
    );
  }
  const mutationUncertain = processResult.mutationUncertain;
  const outcome =
    probe.status === "matched"
      ? "succeeded"
      : probe.status === "cancelled"
        ? "cancelled"
        : probe.status === "uncertain"
          ? "uncertain"
          : "failed";
  const settlement = settle(
    request.authorization,
    outcome,
    mutationUncertain,
    Math.max(0, Math.ceil(performance.now() - startedAt)),
    processResult.output.observedBytes,
  );
  return reportFrom(request.plan, processResult, probe, settlement);
}
