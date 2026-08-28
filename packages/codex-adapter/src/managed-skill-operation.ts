import {
  PROJECT_STAGES,
  isStableId,
  type PackOperationCommandOutput,
  type ProjectStage,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointStatus,
} from "@ai-game-playbook/contracts";
import {
  canonicalizeProjectRoot,
  createPermissionApprovalSession,
  createPermissionBroker,
  getLocalApprovalTrustedKey,
  inspectLocalApprovalSigningKey,
  queryWorkflowCheckpointHeads,
  type AuthorizedPermissionDecision,
  type CanonicalProjectRoot,
  type LocalApprovalSigningKey,
  type PermissionApprovalSession,
  type WorkflowCheckpointHeadSummary,
} from "@ai-game-playbook/core";
import {
  PackRuntimeError,
  createPackOperationAuthorizationRequest,
  dispatchPreparedPackOperation,
  inspectPackTransactionRecovery,
  type PackTransactionRecoveryReport,
  type PreparedPackOperation,
} from "@ai-game-playbook/pack-runtime";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import {
  prepareManagedProjectSkillInstallation,
  type PreparedProjectSkillMaterialization,
} from "@ai-game-playbook/skill-runtime";
import { isProxy } from "node:util/types";

import {
  CODEX_APPROVAL_HOST_ID,
  CODEX_APPROVAL_MAX_WAIT_MS,
  runCodexLocalApprovalSession,
  type CodexApprovalPresenter,
} from "./approval.js";
import { CodexManagedSkillBoundaryError } from "./errors.js";

const PACK_ADD_COMMAND_ID = "pack.add" as StableId;
const PACK_ADD_WORKFLOW_ID = "workflow.pack-add" as StableId;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUS_MAX_ENTRIES = 1_024;
const STATUS_MAX_HEADS = 256;
const STATUS_MAX_TOTAL_HEAD_BYTES = 4 * 1024 * 1024;
const RECOVERY_MAX_DIRECTORY_ENTRIES = 10_000;

export const CODEX_MANAGED_SKILL_APPROVAL_MIN_WAIT_MS: number = 1_000;
export const CODEX_MANAGED_SKILL_APPROVAL_MAX_WAIT_MS: number =
  CODEX_APPROVAL_MAX_WAIT_MS;

export interface PrepareCodexManagedSkillInstallationRequest {
  readonly materialization: PreparedProjectSkillMaterialization;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly signingKey: LocalApprovalSigningKey;
  readonly approvalWaitMs: number;
}

interface PreparedOperationBase {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly planDigest: Sha256Digest;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly mutationPerformed: false;
}

export type PreparedCodexManagedSkillInstallation =
  | (PreparedOperationBase & {
      readonly disposition: "no-op";
      readonly approval: { readonly required: false };
    })
  | (PreparedOperationBase & {
      readonly disposition: "ready";
      readonly approval: {
        readonly required: true;
        readonly sessionId: string;
        readonly promptDigest: Sha256Digest;
        readonly sessionDigest: Sha256Digest;
        readonly expiresAt: string;
      };
    });

export type RunCodexManagedSkillInstallationRequest =
  | {
      readonly operation: Extract<
        PreparedCodexManagedSkillInstallation,
        { readonly disposition: "no-op" }
      >;
      readonly signal: AbortSignal | null;
    }
  | {
      readonly operation: Extract<
        PreparedCodexManagedSkillInstallation,
        { readonly disposition: "ready" }
      >;
      readonly presenter: CodexApprovalPresenter;
      readonly signingKey: LocalApprovalSigningKey;
      readonly signal: AbortSignal | null;
    };

export type CodexManagedSkillInstallationRunResult =
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly planDigest: Sha256Digest;
      readonly status: "not-authorized";
      readonly approval: "cancelled" | "denied" | "expired";
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly planDigest: Sha256Digest;
      readonly status: "completed";
      readonly approval: "authorized" | "not-required";
      readonly output: PackOperationCommandOutput;
    };

export interface CodexManagedSkillInstallationHead {
  readonly checkpointId: string;
  readonly sequence: number;
  readonly checkpointDigest: Sha256Digest;
  readonly status: WorkflowCheckpointStatus;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly projectAuthority: "current";
  readonly projectStage: ProjectStage;
  readonly registryAuthority: "current";
  readonly workflowId: typeof PACK_ADD_WORKFLOW_ID;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly inFlight?: WorkflowCheckpointHeadSummary["inFlight"];
  readonly updatedAt: string;
}

export type CodexManagedSkillInstallationStatus =
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly disposition: "not-found";
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly disposition: "found";
      readonly head: CodexManagedSkillInstallationHead;
    };

export type CodexManagedSkillInstallationRecovery =
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly disposition: "not-found";
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly disposition: "transaction-not-found";
      readonly head: CodexManagedSkillInstallationHead;
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly disposition: "assessed";
      readonly head: CodexManagedSkillInstallationHead;
      readonly report: PackTransactionRecoveryReport;
    };

type OperationPhase = "prepared" | "running" | "settled";

interface OperationState {
  readonly plan: PreparedPackOperation;
  readonly session?: PermissionApprovalSession;
  readonly signingKeyId?: StableId;
  readonly signingKeyFingerprint?: Sha256Digest;
  phase: OperationPhase;
}

type DataRecord = Record<string, unknown>;

const operationStates = new WeakMap<object, OperationState>();

function operationError(
  code: ConstructorParameters<typeof CodexManagedSkillBoundaryError>[0],
  message: string,
): never {
  throw new CodexManagedSkillBoundaryError(code, message);
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation requires one plain data request.",
    );
  }
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw new TypeError("not plain data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index]) ||
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("request fields are not exact data properties");
    }
    return Object.freeze(
      Object.fromEntries(
        keys.map((key) => [key, descriptors[key]?.value]),
      ),
    );
  } catch (error) {
    if (error instanceof CodexManagedSkillBoundaryError) throw error;
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation request fields are invalid.",
    );
  }
}

function validSignal(value: unknown): value is AbortSignal | null {
  return (
    value === null ||
    (typeof value === "object" &&
      value !== null &&
      !isProxy(value) &&
      value instanceof AbortSignal)
  );
}

function operationState(value: unknown): OperationState {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value)
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation must be prepared in this process.",
    );
  }
  const state = operationStates.get(value);
  if (state === undefined) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation must be prepared in this process.",
    );
  }
  return state;
}

function packAddCommand() {
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === PACK_ADD_COMMAND_ID,
  );
  if (
    command === undefined ||
    command.handler.export !== "dispatchPreparedPackOperation" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation registry binding is unavailable.",
    );
  }
  return command;
}

function validatePrepareRequest(
  value: unknown,
): PrepareCodexManagedSkillInstallationRequest {
  const record = exactDataRecord(value, [
    "materialization",
    "projectId",
    "projectStage",
    "signingKey",
    "approvalWaitMs",
  ]);
  if (
    !isStableId(record["projectId"]) ||
    !PROJECT_STAGES.includes(record["projectStage"] as ProjectStage) ||
    !Number.isSafeInteger(record["approvalWaitMs"]) ||
    (record["approvalWaitMs"] as number) <
      CODEX_MANAGED_SKILL_APPROVAL_MIN_WAIT_MS ||
    (record["approvalWaitMs"] as number) >
      CODEX_MANAGED_SKILL_APPROVAL_MAX_WAIT_MS
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation requires canonical project fields and a bounded approval wait.",
    );
  }
  let keySnapshot;
  try {
    keySnapshot = inspectLocalApprovalSigningKey(
      record["signingKey"] as LocalApprovalSigningKey,
    );
  } catch {
    operationError(
      "codex-managed-skill-signing-key-mismatch",
      "Managed skill operation requires one active local approval key.",
    );
  }
  if (keySnapshot.status !== "active") {
    operationError(
      "codex-managed-skill-signing-key-mismatch",
      "Managed skill operation requires one active local approval key.",
    );
  }
  return Object.freeze({
    materialization:
      record["materialization"] as PreparedProjectSkillMaterialization,
    projectId: record["projectId"],
    projectStage: record["projectStage"] as ProjectStage,
    signingKey: record["signingKey"] as LocalApprovalSigningKey,
    approvalWaitMs: record["approvalWaitMs"] as number,
  });
}

function publicOperation(
  plan: PreparedPackOperation,
  session?: PermissionApprovalSession,
): PreparedCodexManagedSkillInstallation {
  const base: PreparedOperationBase = {
    schemaVersion: "1.0.0",
    runId: plan.runId,
    planDigest: plan.planDigest,
    project: Object.freeze({
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
    }),
    mutationPerformed: false,
  };
  if (plan.disposition === "no-op") {
    return Object.freeze({
      ...base,
      disposition: "no-op",
      approval: Object.freeze({ required: false as const }),
    });
  }
  if (session === undefined) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Ready managed skill operation is missing its approval session.",
    );
  }
  return Object.freeze({
    ...base,
    disposition: "ready",
    approval: Object.freeze({
      required: true as const,
      sessionId: session.presentation.session.sessionId,
      promptDigest: session.presentation.prompt.promptDigest,
      sessionDigest: session.presentation.session.sessionDigest,
      expiresAt: session.presentation.session.expiresAt,
    }),
  });
}

export async function prepareCodexManagedSkillInstallation(
  value: PrepareCodexManagedSkillInstallationRequest,
): Promise<PreparedCodexManagedSkillInstallation> {
  const request = validatePrepareRequest(value);
  const keySnapshot = inspectLocalApprovalSigningKey(request.signingKey);
  const plan = await prepareManagedProjectSkillInstallation({
    materialization: request.materialization,
    projectId: request.projectId,
    projectStage: request.projectStage,
  });
  if (plan.disposition === "conflicted") {
    operationError(
      "codex-managed-skill-plan-conflicted",
      "Conflicted managed skill plan cannot enter host execution.",
    );
  }

  let session: PermissionApprovalSession | undefined;
  if (plan.disposition === "ready") {
    const command = packAddCommand();
    const createdAt = Date.now();
    const sessionExpiresAt = new Date(
      createdAt + request.approvalWaitMs,
    ).toISOString();
    const requestDeadline = new Date(
      createdAt + request.approvalWaitMs + command.budgets.maxDurationMs,
    ).toISOString();
    const broker = createPermissionBroker({
      registry: BUILTIN_REGISTRY,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
        stage: request.projectStage,
        budgets: command.budgets,
      },
      trustedApprovalKeys: [getLocalApprovalTrustedKey(request.signingKey)],
      now: Date.now,
    });
    const authorizationRequest = createPackOperationAuthorizationRequest({
      plan,
      budgets: command.budgets,
      deadlineAt: requestDeadline,
    });
    const pending = broker.authorize(authorizationRequest, []);
    if (pending.status !== "approval-required") {
      operationError(
        "codex-managed-skill-operation-invalid",
        "Managed skill installation did not produce an approval challenge.",
      );
    }
    session = createPermissionApprovalSession({
      broker,
      registry: BUILTIN_REGISTRY,
      request: authorizationRequest,
      hostId: CODEX_APPROVAL_HOST_ID as StableId,
      expiresAt: sessionExpiresAt,
      grantTerms: pending.missingPermissions.map((permission) =>
        Object.freeze({
          permission,
          expiresAt: requestDeadline,
          maxUses: 1,
        }),
      ),
      now: Date.now,
    });
  }

  const operation = publicOperation(plan, session);
  operationStates.set(operation, {
    plan,
    ...(session === undefined ? {} : { session }),
    ...(plan.disposition === "no-op"
      ? {}
      : {
          signingKeyId: keySnapshot.keyId,
          signingKeyFingerprint: keySnapshot.publicKeyFingerprint,
        }),
    phase: "prepared",
  });
  return operation;
}

function settleAuthorizationUncertain(
  authorization: AuthorizedPermissionDecision,
  startedAt: number,
): void {
  if (authorization.lease.state !== "active") return;
  authorization.lease.settle({
    outcome: "uncertain",
    mutationUncertain: true,
    actual: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: Math.max(0, Date.now() - startedAt),
      outputBytes: 0,
      repairCycles: 0,
    },
  });
}

export async function runCodexManagedSkillInstallation(
  value: RunCodexManagedSkillInstallationRequest,
): Promise<CodexManagedSkillInstallationRunResult> {
  const operationCandidate =
    value !== null && typeof value === "object" && !isProxy(value)
      ? Object.getOwnPropertyDescriptor(value, "operation")?.value
      : undefined;
  const state = operationState(operationCandidate);
  const operation = operationCandidate as PreparedCodexManagedSkillInstallation;
  const record = exactDataRecord(
    value,
    operation.disposition === "no-op"
      ? ["operation", "signal"]
      : ["operation", "presenter", "signingKey", "signal"],
  );
  if (record["operation"] !== operation) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill execution requires the exact prepared operation.",
    );
  }
  if (state.phase === "running") {
    operationError(
      "codex-managed-skill-operation-active",
      "Managed skill operation is already running.",
    );
  }
  if (state.phase === "settled") {
    operationError(
      "codex-managed-skill-operation-settled",
      "Managed skill operation has already settled.",
    );
  }
  if (!validSignal(record["signal"])) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation requires a genuine cancellation signal or null.",
    );
  }
  const signal = record["signal"] as AbortSignal | null;

  if (operation.disposition === "ready") {
    let keySnapshot;
    try {
      keySnapshot = inspectLocalApprovalSigningKey(
        record["signingKey"] as LocalApprovalSigningKey,
      );
    } catch {
      operationError(
        "codex-managed-skill-signing-key-mismatch",
        "Managed skill execution requires the bound local approval key.",
      );
    }
    if (
      keySnapshot.status !== "active" ||
      keySnapshot.keyId !== state.signingKeyId ||
      keySnapshot.publicKeyFingerprint !== state.signingKeyFingerprint
    ) {
      operationError(
        "codex-managed-skill-signing-key-mismatch",
        "Managed skill execution requires the bound active approval key.",
      );
    }
  }

  state.phase = "running";
  try {
    if (operation.disposition === "no-op") {
      const output = await dispatchPreparedPackOperation({
        plan: state.plan,
        signal,
      });
      return Object.freeze({
        schemaVersion: "1.0.0",
        runId: operation.runId,
        planDigest: operation.planDigest,
        status: "completed",
        approval: "not-required",
        output,
      });
    }
    if (state.session === undefined) {
      operationError(
        "codex-managed-skill-operation-invalid",
        "Ready managed skill operation lost its approval session.",
      );
    }
    const resolution = await runCodexLocalApprovalSession(
      state.session,
      record["presenter"] as CodexApprovalPresenter,
      record["signingKey"] as LocalApprovalSigningKey,
      signal ?? undefined,
    );
    if (resolution.status !== "authorized") {
      return Object.freeze({
        schemaVersion: "1.0.0",
        runId: operation.runId,
        planDigest: operation.planDigest,
        status: "not-authorized",
        approval: resolution.status,
      });
    }
    const dispatchStartedAt = Date.now();
    try {
      const output = await dispatchPreparedPackOperation({
        plan: state.plan,
        authorization: resolution.authorization,
        signal,
      });
      return Object.freeze({
        schemaVersion: "1.0.0",
        runId: operation.runId,
        planDigest: operation.planDigest,
        status: "completed",
        approval: "authorized",
        output,
      });
    } catch (error) {
      settleAuthorizationUncertain(
        resolution.authorization,
        dispatchStartedAt,
      );
      throw error;
    }
  } finally {
    state.phase = "settled";
  }
}

export interface CodexManagedSkillInstallationQueryRequest {
  readonly projectRoot: unknown;
  readonly runId: string;
}

interface QueriedStatus {
  readonly root: CanonicalProjectRoot;
  readonly status: CodexManagedSkillInstallationStatus;
}

function validateStatusRequest(
  value: unknown,
): CodexManagedSkillInstallationQueryRequest {
  const record = exactDataRecord(value, ["projectRoot", "runId"]);
  if (
    typeof record["runId"] !== "string" ||
    !UUID_PATTERN.test(record["runId"])
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill status requires a canonical run identity.",
    );
  }
  return Object.freeze({
    projectRoot: record["projectRoot"],
    runId: record["runId"],
  });
}

function publicHead(
  head: WorkflowCheckpointHeadSummary,
): CodexManagedSkillInstallationHead {
  if (
    head.workflowId !== PACK_ADD_WORKFLOW_ID ||
    head.projectAuthority !== "current" ||
    head.registryAuthority !== "current"
  ) {
    operationError(
      "codex-managed-skill-status-mismatch",
      "Durable operation head is not a current managed pack-add authority.",
    );
  }
  return Object.freeze({
    checkpointId: head.checkpointId,
    sequence: head.sequence,
    checkpointDigest: head.checkpointDigest,
    status: head.status,
    projectId: head.projectId,
    projectIdentityDigest: head.projectIdentityDigest,
    projectAuthority: "current",
    projectStage: head.projectStage,
    registryAuthority: "current",
    workflowId: PACK_ADD_WORKFLOW_ID,
    resolvedPlanDigest: head.resolvedPlanDigest,
    ...(head.inFlight === undefined
      ? {}
      : { inFlight: Object.freeze({ ...head.inFlight }) }),
    updatedAt: head.updatedAt,
  });
}

async function queryStatus(value: unknown): Promise<QueriedStatus> {
  const request = validateStatusRequest(value);
  const root = await canonicalizeProjectRoot(request.projectRoot);
  const query = await queryWorkflowCheckpointHeads({
    root,
    registry: BUILTIN_REGISTRY,
    maxEntries: STATUS_MAX_ENTRIES,
    maxHeads: STATUS_MAX_HEADS,
    maxTotalHeadBytes: STATUS_MAX_TOTAL_HEAD_BYTES,
  });
  const found = query.heads.find(({ runId }) => runId === request.runId);
  if (found === undefined) {
    return Object.freeze({
      root,
      status: Object.freeze({
        schemaVersion: "1.0.0",
        runId: request.runId,
        disposition: "not-found",
      }),
    });
  }
  return Object.freeze({
    root,
    status: Object.freeze({
      schemaVersion: "1.0.0",
      runId: request.runId,
      disposition: "found",
      head: publicHead(found),
    }),
  });
}

export async function queryCodexManagedSkillInstallationStatus(
  value: CodexManagedSkillInstallationQueryRequest,
): Promise<CodexManagedSkillInstallationStatus> {
  return (await queryStatus(value)).status;
}

export async function inspectCodexManagedSkillInstallationRecovery(
  value: CodexManagedSkillInstallationQueryRequest,
): Promise<CodexManagedSkillInstallationRecovery> {
  const queried = await queryStatus(value);
  if (queried.status.disposition === "not-found") return queried.status;
  const { head } = queried.status;
  try {
    const report = await inspectPackTransactionRecovery({
      root: queried.root,
      runId: queried.status.runId,
      project: {
        id: head.projectId,
        identityDigest: head.projectIdentityDigest,
      },
      maxDirectoryEntries: RECOVERY_MAX_DIRECTORY_ENTRIES,
    });
    const current = await queryStatus(value);
    if (
      current.status.disposition !== "found" ||
      current.status.head.checkpointDigest !== head.checkpointDigest
    ) {
      operationError(
        "codex-managed-skill-status-mismatch",
        "Durable operation head changed during recovery assessment.",
      );
    }
    return Object.freeze({
      schemaVersion: "1.0.0",
      runId: queried.status.runId,
      disposition: "assessed",
      head: current.status.head,
      report,
    });
  } catch (error) {
    if (
      error instanceof PackRuntimeError &&
      error.code === "pack-transaction-not-found"
    ) {
      return Object.freeze({
        schemaVersion: "1.0.0",
        runId: queried.status.runId,
        disposition: "transaction-not-found",
        head,
      });
    }
    throw error;
  }
}
