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
  queryWorkflowCheckpointHeads,
  type CanonicalProjectRoot,
  type LocalApprovalSigningKey,
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
  runCodexLocalApprovalSession,
  type CodexApprovalPresenter,
} from "./approval.js";
import { CodexManagedSkillBoundaryError } from "./errors.js";
import {
  HOST_OPERATION_APPROVAL_MAX_WAIT_MS,
  HOST_OPERATION_APPROVAL_MIN_WAIT_MS,
  assertBoundHostSigningKey,
  assertHostApprovalWait,
  createBoundHostApproval,
  exactHostOperationDataRecord,
  isHostOperationSignal,
  settleHostAuthorizationUncertain,
  type BoundHostApproval,
  type HostOperationFailureKind,
} from "./host-operation-boundary.js";

const PACK_ADD_COMMAND_ID = "pack.add" as StableId;
const PACK_ADD_WORKFLOW_ID = "workflow.pack-add" as StableId;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const STATUS_MAX_ENTRIES = 1_024;
const STATUS_MAX_HEADS = 256;
const STATUS_MAX_TOTAL_HEAD_BYTES = 4 * 1024 * 1024;
const RECOVERY_MAX_DIRECTORY_ENTRIES = 10_000;

export const CODEX_MANAGED_SKILL_APPROVAL_MIN_WAIT_MS: number =
  HOST_OPERATION_APPROVAL_MIN_WAIT_MS;
export const CODEX_MANAGED_SKILL_APPROVAL_MAX_WAIT_MS: number =
  HOST_OPERATION_APPROVAL_MAX_WAIT_MS;

export interface PrepareCodexManagedSkillInstallationRequest {
  readonly materialization: PreparedProjectSkillMaterialization;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
  readonly signingKey: LocalApprovalSigningKey | null;
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
  readonly approval?: BoundHostApproval;
  phase: OperationPhase;
}

const operationStates = new WeakMap<object, OperationState>();

function operationError(
  code: ConstructorParameters<typeof CodexManagedSkillBoundaryError>[0],
  message: string,
): never {
  throw new CodexManagedSkillBoundaryError(code, message);
}

function hostFailure(
  kind: HostOperationFailureKind,
  message: string,
): never {
  operationError(
    kind === "signing-key-mismatch"
      ? "codex-managed-skill-signing-key-mismatch"
      : "codex-managed-skill-operation-invalid",
    message,
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
  const record = exactHostOperationDataRecord(value, [
    "materialization",
    "projectId",
    "projectStage",
    "signingKey",
    "approvalWaitMs",
  ], hostFailure);
  assertHostApprovalWait(record["approvalWaitMs"], hostFailure);
  if (
    !isStableId(record["projectId"]) ||
    !PROJECT_STAGES.includes(record["projectStage"] as ProjectStage)
  ) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation requires canonical project fields and a bounded approval wait.",
    );
  }
  return Object.freeze({
    materialization:
      record["materialization"] as PreparedProjectSkillMaterialization,
    projectId: record["projectId"],
    projectStage: record["projectStage"] as ProjectStage,
    signingKey: record["signingKey"] as LocalApprovalSigningKey | null,
    approvalWaitMs: record["approvalWaitMs"] as number,
  });
}

function publicOperation(
  plan: PreparedPackOperation,
  approval?: BoundHostApproval,
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
  if (approval === undefined) {
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
      sessionId: approval.session.presentation.session.sessionId,
      promptDigest: approval.session.presentation.prompt.promptDigest,
      sessionDigest: approval.session.presentation.session.sessionDigest,
      expiresAt: approval.session.presentation.session.expiresAt,
    }),
  });
}

export async function prepareCodexManagedSkillInstallation(
  value: PrepareCodexManagedSkillInstallationRequest,
): Promise<PreparedCodexManagedSkillInstallation> {
  const request = validatePrepareRequest(value);
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

  let approval: BoundHostApproval | undefined;
  if (plan.disposition === "ready") {
    if (request.signingKey === null) {
      hostFailure(
        "signing-key-mismatch",
        "Managed skill installation requires one active local approval key.",
      );
    }
    const command = packAddCommand();
    approval = createBoundHostApproval({
      registry: BUILTIN_REGISTRY,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
        stage: request.projectStage,
        budgets: command.budgets,
      },
      signingKey: request.signingKey,
      approvalWaitMs: request.approvalWaitMs,
      createAuthorizationRequest: (deadlineAt) =>
        createPackOperationAuthorizationRequest({
          plan,
          budgets: command.budgets,
          deadlineAt,
        }),
      fail: hostFailure,
    });
  }

  const operation = publicOperation(plan, approval);
  operationStates.set(operation, {
    plan,
    ...(approval === undefined ? {} : { approval }),
    phase: "prepared",
  });
  return operation;
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
  const record = exactHostOperationDataRecord(
    value,
    operation.disposition === "no-op"
      ? ["operation", "signal"]
      : ["operation", "presenter", "signingKey", "signal"],
    hostFailure,
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
  if (!isHostOperationSignal(record["signal"])) {
    operationError(
      "codex-managed-skill-operation-invalid",
      "Managed skill operation requires a genuine cancellation signal or null.",
    );
  }
  const signal = record["signal"] as AbortSignal | null;

  if (operation.disposition === "ready") {
    if (state.approval === undefined) {
      operationError(
        "codex-managed-skill-operation-invalid",
        "Ready managed skill operation lost its approval binding.",
      );
    }
    assertBoundHostSigningKey(
      record["signingKey"],
      state.approval,
      hostFailure,
    );
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
    if (state.approval === undefined) {
      operationError(
        "codex-managed-skill-operation-invalid",
        "Ready managed skill operation lost its approval session.",
      );
    }
    const resolution = await runCodexLocalApprovalSession(
      state.approval.session,
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
      settleHostAuthorizationUncertain(
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
  const record = exactHostOperationDataRecord(
    value,
    ["projectRoot", "runId"],
    hostFailure,
  );
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
