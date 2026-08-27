import {
  digestCanonicalJson,
  isStableId,
  type RunReceipt,
  type SemanticVersion,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointRecord,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  resolveWorkflowPlan,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { CoreBoundaryError } from "./errors.js";
import {
  assertAuthorizedPermissionDecision,
  type AuthorizedPermissionDecision,
  type PermissionActualEffects,
  type PermissionSettlement,
  type PermissionSettlementOutcome,
} from "./permission-broker.js";
import {
  assertProjectLaneLease,
  type ProjectLaneLease,
  type ProjectMutationLane,
} from "./project-lane.js";
import {
  assertProjectRootIdentity,
  type CanonicalProjectRoot,
} from "./project-path.js";
import {
  loadRunReceiptChain,
  persistRunReceipt,
  RUN_RECEIPT_MAX_ARTIFACT_BYTES,
  type StoredRunReceipt,
} from "./run-receipt-store.js";
import {
  persistWorkflowCheckpoint,
  type StoredWorkflowCheckpoint,
} from "./workflow-checkpoint-store.js";
import {
  beginWorkflowStep,
  markWorkflowStepStarted,
  settleWorkflowStep,
} from "./workflow-state.js";

type DataRecord = Record<string, unknown>;

export interface WorkflowStepExecutorContext {
  readonly authorization: AuthorizedPermissionDecision;
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly lane: ProjectLaneLease;
  readonly signal: AbortSignal | null;
}

export interface WorkflowStepExecutorResult {
  readonly receipt: RunReceipt;
  readonly settlement: PermissionSettlement;
}

export type WorkflowStepExecutorInvoke = (
  context: WorkflowStepExecutorContext,
) => Promise<WorkflowStepExecutorResult>;

export interface BindWorkflowStepExecutorRequest {
  readonly registry: ValidatedRegistry;
  readonly commandId: StableId;
  readonly invoke: WorkflowStepExecutorInvoke;
}

export interface WorkflowStepExecutorBinding {
  readonly commandId: StableId;
  readonly commandVersion: SemanticVersion;
  readonly commandDescriptorDigest: Sha256Digest;
  readonly handlerPackage: string;
  readonly handlerExport: string;
  readonly handlerDigest: Sha256Digest;
  readonly lane: ProjectMutationLane;
  readonly registryDigest: Sha256Digest;
}

export interface DispatchProjectWorkflowStepRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly stored: StoredWorkflowCheckpoint;
  readonly authorization: AuthorizedPermissionDecision;
  readonly lane: ProjectLaneLease;
  readonly executor: WorkflowStepExecutorBinding;
  readonly signal: AbortSignal | null;
  readonly maxArtifactBytes: number;
  readonly now?: () => number;
}

export interface DispatchedProjectWorkflowStep {
  readonly admitted: StoredWorkflowCheckpoint;
  readonly started: StoredWorkflowCheckpoint;
  readonly receipt: StoredRunReceipt;
  readonly terminal: StoredWorkflowCheckpoint;
}

interface ExecutorInternals {
  readonly registry: ValidatedRegistry;
  readonly invoke: WorkflowStepExecutorInvoke;
}

const executorBindings = new WeakMap<object, ExecutorInternals>();

function dispatchError(
  code:
    | "invalid-workflow-dispatch-request"
    | "workflow-dispatch-binding-mismatch"
    | "workflow-dispatch-cancelled"
    | "workflow-dispatch-evidence-failed"
    | "workflow-dispatch-execution-failed",
  path: string,
  message: string,
  mutationUncertain = false,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message, mutationUncertain);
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      path,
      "expected a plain request object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      path,
      "request properties must be enumerable data fields",
    );
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const keys = Object.keys(record);
  const allowedSet = new Set(allowed);
  if (keys.some((key) => !allowedSet.has(key))) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      path,
      "request contains undeclared fields",
    );
  }
  if (required.some((key) => !Object.hasOwn(record, key))) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      path,
      "request is missing a required field",
    );
  }
}

function readClock(now: () => number): number {
  let value: unknown;
  try {
    value = now();
  } catch {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.now",
      "clock failed",
    );
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > 8_640_000_000_000_000
  ) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.now",
      "clock returned an invalid timestamp",
    );
  }
  return value as number;
}

function emptyEffects(durationMs: number): PermissionActualEffects {
  return Object.freeze({
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
  });
}

function settleWithoutObservedEffects(
  authorization: AuthorizedPermissionDecision,
  outcome: PermissionSettlementOutcome,
  mutationUncertain: boolean,
  durationMs: number,
): void {
  if (authorization.lease.state !== "active") return;
  try {
    authorization.lease.settle({
      outcome,
      mutationUncertain,
      actual: emptyEffects(durationMs),
    });
  } catch {
    // The caller still receives the fail-closed dispatch error. A copied or already
    // consumed lease cannot be repaired by this boundary.
  }
}

function assertNotCancelled(
  signal: AbortSignal | null,
  authorization: AuthorizedPermissionDecision,
  startedAt: number,
  now: () => number,
): void {
  if (signal?.aborted !== true) return;
  const durationMs = Math.max(0, readClock(now) - startedAt);
  settleWithoutObservedEffects(
    authorization,
    "cancelled",
    false,
    durationMs,
  );
  throw dispatchError(
    "workflow-dispatch-cancelled",
    "$request.signal",
    "workflow dispatch was cancelled before the side-effect boundary",
  );
}

function executorInternals(
  value: unknown,
): {
  readonly binding: WorkflowStepExecutorBinding;
  readonly internals: ExecutorInternals;
} {
  if (value === null || typeof value !== "object") {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request.executor",
      "executor must be a same-process binding",
    );
  }
  const internals = executorBindings.get(value);
  if (internals === undefined) {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request.executor",
      "executor must be created by this dispatcher runtime",
    );
  }
  return { binding: value as WorkflowStepExecutorBinding, internals };
}

export function bindWorkflowStepExecutor(
  value: BindWorkflowStepExecutorRequest,
): WorkflowStepExecutorBinding {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["registry", "commandId", "invoke"],
    ["registry", "commandId", "invoke"],
    "$request",
  );
  assertValidatedRegistry(record["registry"]);
  if (typeof record["commandId"] !== "string" || !isStableId(record["commandId"])) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.commandId",
      "expected a canonical command ID",
    );
  }
  if (typeof record["invoke"] !== "function") {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.invoke",
      "executor invoke must be a function",
    );
  }
  const registry = value.registry;
  const command = registry.commands.find(({ id }) => id === value.commandId);
  if (command === undefined) {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request.commandId",
      "executor command is not present in the validated registry",
    );
  }
  if (command.lane === "parallel-read") {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request.commandId",
      "project workflow dispatcher accepts only mutation lanes",
    );
  }
  const binding: WorkflowStepExecutorBinding = Object.freeze({
    commandId: command.id,
    commandVersion: command.version,
    commandDescriptorDigest: digestCanonicalJson(command),
    handlerPackage: command.handler.package,
    handlerExport: command.handler.export,
    handlerDigest: command.handler.digest,
    lane: command.lane,
    registryDigest: registry.digest,
  });
  executorBindings.set(binding, {
    registry,
    invoke: value.invoke,
  });
  return binding;
}

function assertDispatchBinding(
  request: DispatchProjectWorkflowStepRequest,
  binding: WorkflowStepExecutorBinding,
  internals: ExecutorInternals,
): void {
  const checkpoint = request.stored.checkpoint;
  if (
    internals.registry !== request.registry ||
    binding.registryDigest !== request.registry.digest ||
    request.stored.rootIdentityDigest !== request.root.identityDigest ||
    checkpoint.identity.projectRootIdentityDigest !== request.root.identityDigest ||
    request.lane.rootIdentityDigest !== request.root.identityDigest ||
    request.lane.projectIdentityDigest !== checkpoint.identity.projectIdentityDigest ||
    request.lane.runId !== checkpoint.identity.runId ||
    request.lane.lane !== binding.lane ||
    request.lane.state !== "active"
  ) {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request",
      "project, run, registry, lane, or executor binding differs from the durable checkpoint",
    );
  }
  const plan = resolveWorkflowPlan(
    request.registry,
    checkpoint.identity.workflow.id,
    checkpoint.identity.projectStage,
  );
  const step = plan.steps[checkpoint.nextOrdinal];
  const expected =
    checkpoint.status === "waiting-rollback"
      ? step?.rollbackCommand
      : step?.command;
  if (
    step === undefined ||
    expected === undefined ||
    expected.id !== binding.commandId ||
    expected.version !== binding.commandVersion ||
    expected.descriptorDigest !== binding.commandDescriptorDigest ||
    expected.handlerDigest !== binding.handlerDigest ||
    expected.lane !== binding.lane
  ) {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$request.executor",
      "executor authority differs from the next resolved workflow command",
    );
  }
}

function validateDispatchRequest(
  value: DispatchProjectWorkflowStepRequest,
): {
  readonly request: DispatchProjectWorkflowStepRequest;
  readonly internals: ExecutorInternals;
  readonly now: () => number;
} {
  const record = dataRecord(value, "$request");
  const required = [
    "root",
    "registry",
    "stored",
    "authorization",
    "lane",
    "executor",
    "signal",
    "maxArtifactBytes",
  ];
  exactKeys(
    record,
    [...required, "now"],
    required,
    "$request",
  );
  assertValidatedRegistry(record["registry"]);
  assertAuthorizedPermissionDecision(record["authorization"]);
  assertProjectLaneLease(record["lane"]);
  if (record["signal"] !== null && !(record["signal"] instanceof AbortSignal)) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.signal",
      "signal must be a genuine AbortSignal or null",
    );
  }
  if (
    !Number.isSafeInteger(record["maxArtifactBytes"]) ||
    (record["maxArtifactBytes"] as number) < 0 ||
    (record["maxArtifactBytes"] as number) > RUN_RECEIPT_MAX_ARTIFACT_BYTES
  ) {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.maxArtifactBytes",
      "artifact verification budget is outside the store limit",
    );
  }
  if (record["now"] !== undefined && typeof record["now"] !== "function") {
    throw dispatchError(
      "invalid-workflow-dispatch-request",
      "$request.now",
      "now must be a clock function",
    );
  }
  const executor = executorInternals(record["executor"]);
  const now = value.now ?? Date.now;
  readClock(now);
  assertDispatchBinding(value, executor.binding, executor.internals);
  return {
    request: value,
    internals: executor.internals,
    now,
  };
}

function assertExecutorResult(value: unknown): WorkflowStepExecutorResult {
  const record = dataRecord(value, "$executorResult");
  exactKeys(
    record,
    ["receipt", "settlement"],
    ["receipt", "settlement"],
    "$executorResult",
  );
  return value as WorkflowStepExecutorResult;
}

function uncertainFailure(
  code: "workflow-dispatch-evidence-failed" | "workflow-dispatch-execution-failed",
  path: string,
  message: string,
): CoreBoundaryError {
  return dispatchError(code, path, message, true);
}

function errorReportsUncertainty(error: unknown): boolean {
  return error instanceof CoreBoundaryError && error.mutationUncertain;
}

async function loadPreviousReceipt(
  request: DispatchProjectWorkflowStepRequest,
): Promise<StoredRunReceipt | undefined> {
  const checkpoint = request.stored.checkpoint;
  if (checkpoint.receiptChainHead === undefined) return undefined;
  const loaded = await loadRunReceiptChain({
    root: request.root,
    registry: request.registry,
    runId: checkpoint.identity.runId,
    projectId: checkpoint.identity.projectId,
    projectIdentityDigest: request.root.identityDigest,
    workflowId: checkpoint.identity.workflow.id,
    resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    ...(checkpoint.identity.featureId === undefined
      ? {}
      : {
          featureId: checkpoint.identity.featureId,
          featureContractDigest: checkpoint.identity.featureContractDigest,
        }),
    maxArtifactBytes: request.maxArtifactBytes,
  });
  if (loaded.stored.receipt.receiptDigest !== checkpoint.receiptChainHead) {
    throw dispatchError(
      "workflow-dispatch-binding-mismatch",
      "$checkpoint.receiptChainHead",
      "durable receipt head differs from the workflow checkpoint",
    );
  }
  return loaded.stored;
}

export async function dispatchProjectWorkflowStep(
  value: DispatchProjectWorkflowStepRequest,
): Promise<DispatchedProjectWorkflowStep> {
  const { request, internals, now } = validateDispatchRequest(value);
  const dispatchStartedAt = readClock(now);
  assertNotCancelled(request.signal, request.authorization, dispatchStartedAt, now);
  await assertProjectRootIdentity(request.root);
  await request.lane.assertOwned();
  assertNotCancelled(request.signal, request.authorization, dispatchStartedAt, now);
  let previousReceipt: StoredRunReceipt | undefined;
  try {
    previousReceipt = await loadPreviousReceipt(request);
  } catch (error) {
    settleWithoutObservedEffects(
      request.authorization,
      errorReportsUncertainty(error) ? "uncertain" : "failed",
      errorReportsUncertainty(error),
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw error;
  }

  let admittedCheckpoint: WorkflowCheckpointRecord;
  try {
    admittedCheckpoint = beginWorkflowStep({
      registry: request.registry,
      checkpoint: request.stored.checkpoint,
      authorization: request.authorization,
      now,
    });
  } catch (error) {
    settleWithoutObservedEffects(
      request.authorization,
      errorReportsUncertainty(error) ? "uncertain" : "failed",
      errorReportsUncertainty(error),
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw error;
  }
  let admitted: StoredWorkflowCheckpoint;
  try {
    admitted = await persistWorkflowCheckpoint({
      root: request.root,
      registry: request.registry,
      checkpoint: admittedCheckpoint,
      previous: request.stored,
    });
  } catch {
    settleWithoutObservedEffects(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw uncertainFailure(
      "workflow-dispatch-evidence-failed",
      "$checkpoint.admitted",
      "workflow admission could not be retained",
    );
  }

  let startedCheckpoint: WorkflowCheckpointRecord;
  try {
    assertNotCancelled(
      request.signal,
      request.authorization,
      dispatchStartedAt,
      now,
    );
    await request.lane.assertOwned();
    assertNotCancelled(
      request.signal,
      request.authorization,
      dispatchStartedAt,
      now,
    );
    startedCheckpoint = markWorkflowStepStarted({
      registry: request.registry,
      checkpoint: admitted.checkpoint,
      now,
    });
  } catch (error) {
    settleWithoutObservedEffects(
      request.authorization,
      errorReportsUncertainty(error) ? "uncertain" : "failed",
      errorReportsUncertainty(error),
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw error;
  }
  let started: StoredWorkflowCheckpoint;
  try {
    started = await persistWorkflowCheckpoint({
      root: request.root,
      registry: request.registry,
      checkpoint: startedCheckpoint,
      previous: admitted,
    });
  } catch {
    settleWithoutObservedEffects(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw uncertainFailure(
      "workflow-dispatch-evidence-failed",
      "$checkpoint.started",
      "the dispatch boundary could not be retained",
    );
  }

  let executorResult: WorkflowStepExecutorResult;
  try {
    executorResult = assertExecutorResult(
      await internals.invoke(
        Object.freeze({
          authorization: request.authorization,
          checkpoint: started.checkpoint,
          lane: request.lane,
          signal: request.signal,
        }),
      ),
    );
  } catch {
    settleWithoutObservedEffects(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw uncertainFailure(
      "workflow-dispatch-execution-failed",
      "$executor",
      "executor stopped after the durable side-effect boundary",
    );
  }

  let terminalCheckpoint: WorkflowCheckpointRecord;
  try {
    await request.lane.assertOwned();
    terminalCheckpoint = settleWorkflowStep({
      registry: request.registry,
      checkpoint: started.checkpoint,
      receipt: executorResult.receipt,
      settlement: executorResult.settlement,
      now,
    });
  } catch {
    settleWithoutObservedEffects(
      request.authorization,
      "uncertain",
      true,
      Math.max(0, readClock(now) - dispatchStartedAt),
    );
    throw uncertainFailure(
      "workflow-dispatch-evidence-failed",
      "$executorResult",
      "executor result could not be reconciled with the durable authority",
    );
  }

  let receipt: StoredRunReceipt;
  try {
    receipt = await persistRunReceipt({
      root: request.root,
      registry: request.registry,
      receipt: executorResult.receipt,
      ...(previousReceipt === undefined
        ? {}
        : { previous: previousReceipt }),
      maxArtifactBytes: request.maxArtifactBytes,
    });
  } catch {
    throw uncertainFailure(
      "workflow-dispatch-evidence-failed",
      "$receipt",
      "run receipt could not be retained after execution",
    );
  }

  let terminal: StoredWorkflowCheckpoint;
  try {
    terminal = await persistWorkflowCheckpoint({
      root: request.root,
      registry: request.registry,
      checkpoint: terminalCheckpoint,
      previous: started,
    });
  } catch {
    throw uncertainFailure(
      "workflow-dispatch-evidence-failed",
      "$checkpoint.terminal",
      "terminal checkpoint could not be retained after the run receipt",
    );
  }

  return Object.freeze({ admitted, started, receipt, terminal });
}
