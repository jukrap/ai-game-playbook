import type {
  ProjectInitializationRecoveryReport,
  ProjectInitializationReport,
  Sha256Digest,
  StableId,
} from "@ai-game-playbook/contracts";
import type { LocalApprovalSigningKey } from "@ai-game-playbook/core";
import {
  assertPreparedProjectInitialization,
  assertProjectInitializationRecoveryAssessmentWitness,
  createProjectInitializationAuthorizationRequest,
  executePreparedProjectInitialization,
  runProjectInitializationRecoveryAssessment,
  type PreparedProjectInitialization,
} from "@ai-game-playbook/project-runtime";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import { isProxy } from "node:util/types";

import {
  runCodexLocalApprovalSession,
  type CodexApprovalPresenter,
} from "./approval.js";
import { CodexProjectInitializationBoundaryError } from "./errors.js";
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

const PROJECT_INITIALIZATION_COMMAND_ID = "project.initialize" as StableId;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const CODEX_PROJECT_INITIALIZATION_APPROVAL_MIN_WAIT_MS: number =
  HOST_OPERATION_APPROVAL_MIN_WAIT_MS;
export const CODEX_PROJECT_INITIALIZATION_APPROVAL_MAX_WAIT_MS: number =
  HOST_OPERATION_APPROVAL_MAX_WAIT_MS;

export interface PrepareCodexProjectInitializationRequest {
  readonly plan: PreparedProjectInitialization;
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

export type PreparedCodexProjectInitialization =
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

export type RunCodexProjectInitializationRequest =
  | {
      readonly operation: Extract<
        PreparedCodexProjectInitialization,
        { readonly disposition: "no-op" }
      >;
      readonly signal: AbortSignal | null;
    }
  | {
      readonly operation: Extract<
        PreparedCodexProjectInitialization,
        { readonly disposition: "ready" }
      >;
      readonly presenter: CodexApprovalPresenter;
      readonly signingKey: LocalApprovalSigningKey;
      readonly signal: AbortSignal | null;
    };

export type CodexProjectInitializationRunResult =
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
      readonly approval: "not-required";
      readonly disposition: "no-op";
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly runId: string;
      readonly planDigest: Sha256Digest;
      readonly status: "completed";
      readonly approval: "authorized";
      readonly disposition: ProjectInitializationReport["status"];
      readonly output: ProjectInitializationReport;
    };

export interface InspectCodexProjectInitializationRecoveryRequest {
  readonly projectRoot: string;
  readonly runId: string;
}

type OperationPhase = "prepared" | "running" | "settled";

interface OperationState {
  readonly plan: PreparedProjectInitialization;
  readonly approval?: BoundHostApproval;
  phase: OperationPhase;
}

const operationStates = new WeakMap<object, OperationState>();

function operationError(
  code: ConstructorParameters<
    typeof CodexProjectInitializationBoundaryError
  >[0],
  message: string,
): never {
  throw new CodexProjectInitializationBoundaryError(code, message);
}

function hostFailure(
  kind: HostOperationFailureKind,
  message: string,
): never {
  operationError(
    kind === "signing-key-mismatch"
      ? "codex-project-initialization-signing-key-mismatch"
      : "codex-project-initialization-operation-invalid",
    message,
  );
}

function operationState(value: unknown): OperationState {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization operation must be prepared in this process.",
    );
  }
  const state = operationStates.get(value);
  if (state === undefined) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization operation must be prepared in this process.",
    );
  }
  return state;
}

function initializationCommand() {
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === PROJECT_INITIALIZATION_COMMAND_ID,
  );
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.handler.export !== "executePreparedProjectInitialization" ||
    command.lane !== "project-write" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1
  ) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization registry binding is unavailable.",
    );
  }
  return command;
}

function validatePrepareRequest(
  value: unknown,
): PrepareCodexProjectInitializationRequest {
  const record = exactHostOperationDataRecord(
    value,
    ["plan", "signingKey", "approvalWaitMs"],
    hostFailure,
  );
  assertHostApprovalWait(record["approvalWaitMs"], hostFailure);
  try {
    assertPreparedProjectInitialization(record["plan"]);
  } catch {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization requires one same-process prepared plan.",
    );
  }
  return Object.freeze({
    plan: record["plan"] as PreparedProjectInitialization,
    signingKey: record["signingKey"] as LocalApprovalSigningKey | null,
    approvalWaitMs: record["approvalWaitMs"] as number,
  });
}

function publicOperation(
  plan: PreparedProjectInitialization,
  approval?: BoundHostApproval,
): PreparedCodexProjectInitialization {
  const base: PreparedOperationBase = {
    schemaVersion: "1.0.0",
    runId: plan.runId,
    planDigest: plan.preparedPlanDigest,
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
  if (plan.disposition !== "ready" || approval === undefined) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Ready project initialization is missing its approval binding.",
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

export function prepareCodexProjectInitialization(
  value: PrepareCodexProjectInitializationRequest,
): PreparedCodexProjectInitialization {
  const request = validatePrepareRequest(value);
  if (request.plan.disposition === "blocked") {
    operationError(
      "codex-project-initialization-plan-blocked",
      "Conflicted project initialization cannot enter host execution.",
    );
  }
  const command = initializationCommand();
  if (request.plan.disposition === "ready" && request.signingKey === null) {
    hostFailure(
      "signing-key-mismatch",
      "Project initialization requires one active local approval key.",
    );
  }
  const approval =
    request.plan.disposition === "ready"
      ? createBoundHostApproval({
          registry: BUILTIN_REGISTRY,
          project: {
            id: request.plan.project.id,
            identityDigest: request.plan.project.identityDigest,
            stage: request.plan.project.stage,
            budgets: command.budgets,
          },
          signingKey: request.signingKey!,
          approvalWaitMs: request.approvalWaitMs,
          createAuthorizationRequest: (deadlineAt) =>
            createProjectInitializationAuthorizationRequest({
              plan: request.plan,
              deadlineAt,
            }),
          fail: hostFailure,
        })
      : undefined;
  const operation = publicOperation(request.plan, approval);
  operationStates.set(operation, {
    plan: request.plan,
    ...(approval === undefined ? {} : { approval }),
    phase: "prepared",
  });
  return operation;
}

export async function runCodexProjectInitialization(
  value: RunCodexProjectInitializationRequest,
): Promise<CodexProjectInitializationRunResult> {
  const operationCandidate =
    value !== null && typeof value === "object" && !isProxy(value)
      ? Object.getOwnPropertyDescriptor(value, "operation")?.value
      : undefined;
  const state = operationState(operationCandidate);
  const operation = operationCandidate as PreparedCodexProjectInitialization;
  const record = exactHostOperationDataRecord(
    value,
    operation.disposition === "no-op"
      ? ["operation", "signal"]
      : ["operation", "presenter", "signingKey", "signal"],
    hostFailure,
  );
  if (record["operation"] !== operation) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization requires the exact prepared operation.",
    );
  }
  if (state.phase === "running") {
    operationError(
      "codex-project-initialization-operation-active",
      "Project initialization is already running.",
    );
  }
  if (state.phase === "settled") {
    operationError(
      "codex-project-initialization-operation-settled",
      "Project initialization has already settled.",
    );
  }
  if (!isHostOperationSignal(record["signal"])) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization requires a genuine cancellation signal or null.",
    );
  }
  const signal = record["signal"] as AbortSignal | null;
  if (operation.disposition === "ready") {
    if (state.approval === undefined) {
      operationError(
        "codex-project-initialization-operation-invalid",
        "Ready project initialization lost its approval binding.",
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
      return Object.freeze({
        schemaVersion: "1.0.0",
        runId: operation.runId,
        planDigest: operation.planDigest,
        status: "completed",
        approval: "not-required",
        disposition: "no-op",
      });
    }
    if (state.approval === undefined) {
      operationError(
        "codex-project-initialization-operation-invalid",
        "Ready project initialization lost its approval session.",
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
      const output = await executePreparedProjectInitialization({
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
        disposition: output.status,
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

function validateRecoveryRequest(
  value: unknown,
): InspectCodexProjectInitializationRecoveryRequest {
  const record = exactHostOperationDataRecord(
    value,
    ["projectRoot", "runId"],
    hostFailure,
  );
  if (
    typeof record["projectRoot"] !== "string" ||
    record["projectRoot"].length === 0 ||
    typeof record["runId"] !== "string" ||
    !UUID_PATTERN.test(record["runId"])
  ) {
    operationError(
      "codex-project-initialization-operation-invalid",
      "Project initialization recovery requires a canonical run identity.",
    );
  }
  return Object.freeze({
    projectRoot: record["projectRoot"] as string,
    runId: record["runId"],
  });
}

export async function inspectCodexProjectInitializationRecovery(
  value: InspectCodexProjectInitializationRecoveryRequest,
): Promise<ProjectInitializationRecoveryReport> {
  const request = validateRecoveryRequest(value);
  const assess = () =>
    runProjectInitializationRecoveryAssessment({
      schemaVersion: "1.0.0",
      projectRoot: request.projectRoot,
      runId: request.runId,
    });
  const first = await assess();
  const current = await assess();
  assertProjectInitializationRecoveryAssessmentWitness(first);
  assertProjectInitializationRecoveryAssessmentWitness(current);
  if (
    first.reportDigest !== current.reportDigest ||
    current.selection.status === "not-requested" ||
    current.selection.runId !== request.runId
  ) {
    operationError(
      "codex-project-initialization-recovery-mismatch",
      "Project initialization state changed during recovery assessment.",
    );
  }
  return current;
}
