import { randomUUID } from "node:crypto";

import {
  checkRunReceiptSemantics,
  checkWorkflowCheckpointSemantics,
  compareCanonicalText,
  computeWorkflowCheckpointDigest,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  runReceiptSchema,
  workflowCheckpointSchema,
  type RunReceipt,
  type ProjectStage,
  type ResolvedWorkflowCommand,
  type ResolvedWorkflowPlan,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointAttempt,
  type WorkflowCheckpointBudgetUsage,
  type WorkflowCheckpointInFlight,
  type WorkflowCheckpointRecord,
  type WorkflowCheckpointStatus,
} from "@ai-game-playbook/contracts";
import {
  resolveWorkflowPlan,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { CoreBoundaryError } from "./errors.js";
import {
  assertAuthorizedPermissionDecision,
  assertPermissionSettlement,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationDecision,
  type PermissionAuthorizationLease,
  type PermissionSettlement,
} from "./permission-broker.js";

export const WORKFLOW_CHECKPOINT_MAX_TTL_MS: number =
  7 * 24 * 60 * 60 * 1000;
export const WORKFLOW_CHECKPOINT_MIN_TTL_MS: number = 1_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_STAGES = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const workflowCheckpointInstances = new WeakSet<object>();
const transitionedCheckpointInstances = new WeakSet<object>();
const checkpointAuthorizationLeases = new WeakMap<
  object,
  PermissionAuthorizationLease
>();

type DataRecord = Record<string, unknown>;

export interface WorkflowCheckpointProject {
  readonly id: StableId;
  readonly identityDigest: Sha256Digest;
  readonly stage: ProjectStage;
}

export interface WorkflowCheckpointFeature {
  readonly id: StableId;
  readonly contractDigest: Sha256Digest;
}

export interface CreateWorkflowCheckpointRequest {
  readonly registry: ValidatedRegistry;
  readonly workflowId: StableId;
  readonly project: WorkflowCheckpointProject;
  readonly runId: string;
  readonly inputDigest: Sha256Digest;
  readonly feature?: WorkflowCheckpointFeature;
  readonly dirtyStateDigest?: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
  readonly ttlMs: number;
  readonly now?: () => number;
}

export interface BeginWorkflowStepRequest {
  readonly registry: ValidatedRegistry;
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly authorization: PermissionAuthorizationDecision;
  readonly now?: () => number;
}

export interface MarkWorkflowStepStartedRequest {
  readonly registry: ValidatedRegistry;
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly now?: () => number;
}

export interface SettleWorkflowStepRequest {
  readonly registry: ValidatedRegistry;
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly receipt: RunReceipt;
  readonly settlement: PermissionSettlement;
  readonly now?: () => number;
}

function boundaryError(path: string, message: string): CoreBoundaryError {
  return new CoreBoundaryError(
    "invalid-workflow-checkpoint-request",
    path,
    message,
  );
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw boundaryError(path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw boundaryError(path, "object properties must be enumerable data fields");
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const actual = Object.keys(record);
  const allowedSet = new Set(allowed);
  if (actual.some((key) => !allowedSet.has(key))) {
    throw boundaryError(path, "request contains undeclared fields");
  }
  if (required.some((key) => !Object.hasOwn(record, key))) {
    throw boundaryError(path, "request is missing a required field");
  }
}

function stableId(value: unknown, path: string): StableId {
  if (typeof value !== "string" || !isStableId(value)) {
    throw boundaryError(path, "expected a canonical stable ID");
  }
  return value;
}

function digest(value: unknown, path: string): Sha256Digest {
  if (typeof value !== "string" || !isSha256Digest(value)) {
    throw boundaryError(path, "expected a canonical SHA-256 digest");
  }
  return value;
}

function readClock(now: unknown): number {
  if (typeof now !== "function") {
    throw boundaryError("$request.now", "expected a clock function");
  }
  let value: unknown;
  try {
    value = now();
  } catch {
    throw boundaryError("$request.now", "clock failed");
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < -8_640_000_000_000_000 ||
    (value as number) > 8_640_000_000_000_000
  ) {
    throw boundaryError("$request.now", "clock returned an invalid timestamp");
  }
  return value as number;
}

function project(value: unknown): WorkflowCheckpointProject {
  const record = dataRecord(value, "$request.project");
  exactKeys(
    record,
    ["id", "identityDigest", "stage"],
    ["id", "identityDigest", "stage"],
    "$request.project",
  );
  if (
    typeof record["stage"] !== "string" ||
    !PROJECT_STAGES.has(record["stage"] as ProjectStage)
  ) {
    throw boundaryError("$request.project.stage", "expected a known project stage");
  }
  return {
    id: stableId(record["id"], "$request.project.id"),
    identityDigest: digest(
      record["identityDigest"],
      "$request.project.identityDigest",
    ),
    stage: record["stage"] as ProjectStage,
  };
}

function feature(value: unknown): WorkflowCheckpointFeature | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = dataRecord(value, "$request.feature");
  exactKeys(
    record,
    ["id", "contractDigest"],
    ["id", "contractDigest"],
    "$request.feature",
  );
  return {
    id: stableId(record["id"], "$request.feature.id"),
    contractDigest: digest(
      record["contractDigest"],
      "$request.feature.contractDigest",
    ),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function retainCheckpoint(
  checkpoint: WorkflowCheckpointRecord,
): WorkflowCheckpointRecord {
  const retained = deepFreeze(checkpoint);
  workflowCheckpointInstances.add(retained);
  return retained;
}

export function retainHydratedWorkflowCheckpoint(
  checkpoint: WorkflowCheckpointRecord,
): WorkflowCheckpointRecord {
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `hydrated checkpoint violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return retainCheckpoint(checkpoint);
}

export function assertWorkflowCheckpointRuntimeInstance(
  value: unknown,
): WorkflowCheckpointRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    !workflowCheckpointInstances.has(value)
  ) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      "checkpoint must be produced or hydrated by this workflow runtime",
    );
  }
  const checkpoint = value as WorkflowCheckpointRecord;
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `checkpoint violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return checkpoint;
}

function checkpointError(
  code:
    | "workflow-checkpoint-plan-mismatch"
    | "workflow-checkpoint-state-invalid"
    | "workflow-checkpoint-transition-invalid",
  path: string,
  message: string,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message);
}

function trustedCheckpoint(value: unknown): WorkflowCheckpointRecord {
  const checkpoint = assertWorkflowCheckpointRuntimeInstance(value);
  if (transitionedCheckpointInstances.has(checkpoint)) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$request.checkpoint",
      "checkpoint already has a successor in this workflow runtime",
    );
  }
  return checkpoint;
}

function resolveCheckpointPlan(
  registry: ValidatedRegistry,
  value: unknown,
  currentTime: number,
): {
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly plan: ResolvedWorkflowPlan;
} {
  const checkpoint = trustedCheckpoint(value);
  if (registry.digest !== checkpoint.identity.registryDigest) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$request.registry",
      "registry digest differs from the checkpoint authority",
    );
  }
  if (currentTime >= Date.parse(checkpoint.expiresAt)) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$request.checkpoint.expiresAt",
      "checkpoint resume window has expired",
    );
  }
  const plan = resolveWorkflowPlan(
    registry,
    checkpoint.identity.workflow.id,
    checkpoint.identity.projectStage,
  );
  if (
    plan.registryDigest !== checkpoint.identity.registryDigest ||
    plan.workflow.version !== checkpoint.identity.workflow.version ||
    plan.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest
  ) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$request.checkpoint.identity.workflow",
      "resolved workflow authority changed after checkpoint creation",
    );
  }
  if (checkpoint.nextOrdinal > plan.steps.length) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$request.checkpoint.nextOrdinal",
      "workflow cursor exceeds the resolved plan",
    );
  }
  return { checkpoint, plan };
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function commandMatches(
  expected: ResolvedWorkflowCommand,
  actual: AuthorizedPermissionDecision["challenge"]["command"],
): boolean {
  return (
    actual.id === expected.id &&
    actual.version === expected.version &&
    actual.handlerDigest === expected.handlerDigest
  );
}

function appendInFlightCheckpoint(
  parent: WorkflowCheckpointRecord,
  status: "running" | "rolling-back",
  inFlight: WorkflowCheckpointInFlight,
  currentTime: number,
): WorkflowCheckpointRecord {
  const {
    checkpointDigest: _checkpointDigest,
    parentCheckpointDigest: _parentCheckpointDigest,
    inFlight: _previousInFlight,
    ...retained
  } = parent;
  const body: Omit<WorkflowCheckpointRecord, "checkpointDigest"> = {
    ...retained,
    sequence: parent.sequence + 1,
    status,
    inFlight,
    updatedAt: new Date(currentTime).toISOString(),
    parentCheckpointDigest: parent.checkpointDigest,
  };
  const checkpoint: WorkflowCheckpointRecord = {
    ...body,
    checkpointDigest: computeWorkflowCheckpointDigest(body),
  };
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `checkpoint transition violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  const child = retainCheckpoint(checkpoint);
  transitionedCheckpointInstances.add(parent);
  return child;
}

function assertAuthorizationBinding(
  checkpoint: WorkflowCheckpointRecord,
  plan: ResolvedWorkflowPlan,
  command: ResolvedWorkflowCommand,
  stepId: StableId,
  authorization: AuthorizedPermissionDecision,
  requireApproval: boolean,
  currentTime: number,
): void {
  const { challenge, lease } = authorization;
  const expectedFeatureId = checkpoint.identity.featureId;
  const expectedFeatureDigest = checkpoint.identity.featureContractDigest;
  const featureMatches =
    challenge.feature === undefined
      ? expectedFeatureId === undefined && expectedFeatureDigest === undefined
      : challenge.feature.id === expectedFeatureId &&
        challenge.feature.contractDigest === expectedFeatureDigest;
  if (
    lease.state !== "active" ||
    currentTime >= Date.parse(lease.expiresAt) ||
    challenge.runId !== checkpoint.identity.runId ||
    challenge.project.id !== checkpoint.identity.projectId ||
    challenge.project.identityDigest !==
      checkpoint.identity.projectIdentityDigest ||
    challenge.registryDigest !== checkpoint.identity.registryDigest ||
    challenge.workflow === undefined ||
    challenge.workflow.id !== checkpoint.identity.workflow.id ||
    challenge.workflow.stepId !== stepId ||
    challenge.workflow.resolvedPlanDigest !== plan.resolvedPlanDigest ||
    !commandMatches(command, challenge.command) ||
    !featureMatches ||
    !sameOptional(
      challenge.editorSessionIdentityDigest,
      checkpoint.sessionIdentityDigest,
    ) ||
    (requireApproval && lease.grantIds.length === 0)
  ) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.authorization",
      "authorization does not exactly match the checkpointed workflow step",
    );
  }
}

function receiptError(path: string, message: string): CoreBoundaryError {
  return new CoreBoundaryError(
    "workflow-checkpoint-receipt-invalid",
    path,
    message,
    true,
  );
}

function validateReceipt(
  registry: ValidatedRegistry,
  value: unknown,
): RunReceipt {
  let receipt: RunReceipt;
  try {
    receipt = validateRegisteredContractValue(
      registry,
      {
        schemaId: runReceiptSchema.schemaId,
        digest: runReceiptSchema.digest,
      },
      value,
    ) as unknown as RunReceipt;
  } catch {
    throw receiptError("$request.receipt", "receipt failed strict schema validation");
  }
  const issues = checkRunReceiptSemantics(receipt);
  if (issues.length > 0) {
    throw receiptError(
      "$request.receipt",
      `receipt violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return receipt;
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function assertReceiptBinding(
  registry: ValidatedRegistry,
  checkpoint: WorkflowCheckpointRecord,
  receipt: RunReceipt,
): void {
  const inFlight = checkpoint.inFlight;
  if (inFlight === undefined) {
    throw receiptError(
      "$request.checkpoint.inFlight",
      "receipt requires an in-flight command",
    );
  }
  const featureMatches =
    receipt.identity.featureId === checkpoint.identity.featureId &&
    receipt.identity.featureContractDigest ===
      checkpoint.identity.featureContractDigest;
  const previousMatches =
    receipt.previousReceiptDigest === checkpoint.receiptChainHead;
  const expectedPackDigests = registry.packs
    .filter(({ provides }) => provides.commands.includes(inFlight.command.id))
    .map(({ digest: packDigest }) => packDigest)
    .sort(compareCanonicalText);
  if (
    receipt.identity.runId !== checkpoint.identity.runId ||
    receipt.identity.workflowId !== checkpoint.identity.workflow.id ||
    receipt.identity.stepId !== inFlight.stepId ||
    receipt.identity.attempt !== inFlight.attempt ||
    receipt.identity.phase !== inFlight.phase ||
    receipt.identity.projectId !== checkpoint.identity.projectId ||
    receipt.identity.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest ||
    !featureMatches ||
    receipt.authority.command.id !== inFlight.command.id ||
    receipt.authority.command.version !== inFlight.command.version ||
    receipt.authority.command.descriptorDigest !==
      inFlight.command.descriptorDigest ||
    receipt.authority.registryDigest !== checkpoint.identity.registryDigest ||
    receipt.authority.handlerDigest !== inFlight.command.handlerDigest ||
    receipt.authority.inputDigest !== inFlight.inputDigest ||
    receipt.authority.authorizationId !== inFlight.authorizationId ||
    receipt.authority.authorizationRequestDigest !==
      inFlight.authorizationRequestDigest ||
    !sameStringArray(receipt.authority.approvalIds, inFlight.approvalIds) ||
    !sameStringArray(receipt.authority.packDigests, expectedPackDigests) ||
    receipt.environment.projectIdentityDigest !==
      checkpoint.identity.projectIdentityDigest ||
    receipt.environment.sessionIdentityDigest !==
      checkpoint.sessionIdentityDigest ||
    !previousMatches
  ) {
    throw receiptError(
      "$request.receipt",
      "receipt authority or execution identity differs from the in-flight checkpoint",
    );
  }
  const startedAt = Date.parse(receipt.timing.startedAt);
  const endedAt = Date.parse(receipt.timing.endedAt);
  if (startedAt < Date.parse(checkpoint.updatedAt)) {
    throw receiptError(
      "$request.receipt.timing.startedAt",
      "receipt execution cannot begin before the dispatch checkpoint",
    );
  }
  if (
    receipt.artifacts.some(
      (artifact) =>
        artifact.commandId !== inFlight.command.id ||
        Date.parse(artifact.createdAt) < startedAt ||
        Date.parse(artifact.createdAt) > endedAt,
    )
  ) {
    throw receiptError(
      "$request.receipt.artifacts",
      "receipt artifacts must be produced by the in-flight command during its run window",
    );
  }
}

function assertSettlementBinding(
  checkpoint: WorkflowCheckpointRecord,
  receipt: RunReceipt,
  value: unknown,
  currentTime: number,
): PermissionSettlement {
  assertPermissionSettlement(value);
  const settlement = value;
  const inFlight = checkpoint.inFlight;
  const lease = checkpointAuthorizationLeases.get(checkpoint);
  if (
    inFlight === undefined ||
    lease === undefined ||
    lease.state !== "settled" ||
    settlement.authorizationId !== inFlight.authorizationId ||
    settlement.authorizationId !== lease.authorizationId ||
    settlement.requestDigest !== inFlight.authorizationRequestDigest ||
    settlement.requestDigest !== lease.requestDigest ||
    digestCanonicalJson(settlement.actual) !== digestCanonicalJson(receipt.effects)
  ) {
    throw receiptError(
      "$request.settlement",
      "permission settlement does not match the completed in-flight authorization",
    );
  }
  const settledAt = Date.parse(settlement.settledAt);
  if (
    settledAt > currentTime ||
    settledAt < Date.parse(receipt.timing.endedAt)
  ) {
    throw receiptError(
      "$request.settlement.settledAt",
      "permission settlement must follow execution and cannot be future-dated",
    );
  }
  const receiptPaths = [
    ...receipt.mutation.changedFiles.map(({ path }) => path),
    ...receipt.mutation.unexpectedDirtyFiles,
  ].sort(compareCanonicalText);
  if (
    new Set(receiptPaths).size !== receiptPaths.length ||
    !sameStringArray(receiptPaths, settlement.actual.changedPaths)
  ) {
    throw receiptError(
      "$request.settlement.actual.changedPaths",
      "permission settlement paths must exactly reconcile receipt mutations",
    );
  }
  const statusMatches =
    settlement.status === "scope-violation" ||
    (settlement.status === "succeeded" && receipt.status === "succeeded") ||
    (settlement.status === "failed" &&
      (receipt.status === "failed" || receipt.status === "blocked")) ||
    (settlement.status === "cancelled" && receipt.status === "cancelled") ||
    (settlement.status === "uncertain" && receipt.status === "uncertain");
  if (!statusMatches) {
    throw receiptError(
      "$request.settlement.status",
      "permission settlement outcome contradicts the run receipt",
    );
  }
  return settlement;
}

function decimalMicros(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function formatDecimalMicros(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length === 0 ? whole.toString() : `${whole}.${trimmed}`;
}

function aggregateBudgetUsage(
  checkpoint: WorkflowCheckpointRecord,
  settlement: PermissionSettlement,
  plan: ResolvedWorkflowPlan,
): {
  readonly usage: WorkflowCheckpointBudgetUsage;
  readonly exceeded: boolean;
} {
  const previousCost = checkpoint.budgetUsage.cost;
  const actualCost = settlement.actual.cost;
  if (
    previousCost !== undefined &&
    actualCost !== undefined &&
    previousCost.currency !== actualCost.currency
  ) {
    throw receiptError(
      "$request.settlement.actual.cost",
      "workflow cost currency changed within one run",
    );
  }
  const costCurrency = previousCost?.currency ?? actualCost?.currency;
  const costMicros =
    (previousCost === undefined ? 0n : decimalMicros(previousCost.amount)) +
    (actualCost === undefined ? 0n : decimalMicros(actualCost.amount));
  const usage: WorkflowCheckpointBudgetUsage = {
    durationMs:
      checkpoint.budgetUsage.durationMs + settlement.actual.durationMs,
    outputBytes:
      checkpoint.budgetUsage.outputBytes + settlement.actual.outputBytes,
    changedFiles:
      checkpoint.budgetUsage.changedFiles +
      settlement.actual.changedPaths.length,
    changedBytes:
      checkpoint.budgetUsage.changedBytes + settlement.actual.changedBytes,
    repairCycles:
      checkpoint.budgetUsage.repairCycles + settlement.actual.repairCycles,
    ...(costCurrency === undefined
      ? {}
      : {
          cost: {
            currency: costCurrency,
            amount: formatDecimalMicros(costMicros),
          },
        }),
  };
  const maximumCost = plan.budgets.maxCost;
  const exceeded =
    usage.durationMs > plan.budgets.maxDurationMs ||
    usage.outputBytes > plan.budgets.maxOutputBytes ||
    usage.repairCycles > plan.budgets.maxRepairCycles ||
    (usage.changedFiles > 0 &&
      (plan.budgets.maxChangedFiles === undefined ||
        usage.changedFiles > plan.budgets.maxChangedFiles)) ||
    (usage.changedBytes > 0 &&
      (plan.budgets.maxChangedBytes === undefined ||
        usage.changedBytes > plan.budgets.maxChangedBytes)) ||
    (usage.cost !== undefined &&
      (maximumCost === undefined ||
        usage.cost.currency !== maximumCost.currency ||
        decimalMicros(usage.cost.amount) > decimalMicros(maximumCost.amount)));
  return { usage, exceeded };
}

function mergeCanonical<T extends string>(
  current: readonly T[],
  additions: readonly T[],
): readonly T[] {
  return [...new Set([...current, ...additions])].sort(compareCanonicalText);
}

interface SettledCheckpointTransition {
  readonly status: WorkflowCheckpointStatus;
  readonly nextOrdinal: number;
  readonly attempt: WorkflowCheckpointAttempt;
  readonly budgetUsage: WorkflowCheckpointBudgetUsage;
  readonly evidenceKinds: readonly StableId[];
  readonly artifactDigests: readonly Sha256Digest[];
  readonly receiptChainHead: Sha256Digest;
  readonly inFlight?: WorkflowCheckpointInFlight;
}

function appendSettledCheckpoint(
  parent: WorkflowCheckpointRecord,
  transition: SettledCheckpointTransition,
  currentTime: number,
): WorkflowCheckpointRecord {
  const {
    checkpointDigest: _checkpointDigest,
    parentCheckpointDigest: _parentCheckpointDigest,
    inFlight: _previousInFlight,
    receiptChainHead: _previousReceiptChainHead,
    ...retained
  } = parent;
  const body: Omit<WorkflowCheckpointRecord, "checkpointDigest"> = {
    ...retained,
    sequence: parent.sequence + 1,
    status: transition.status,
    nextOrdinal: transition.nextOrdinal,
    attempts: [...parent.attempts, transition.attempt],
    budgetUsage: transition.budgetUsage,
    evidenceKinds: [...transition.evidenceKinds],
    artifactDigests: [...transition.artifactDigests],
    receiptChainHead: transition.receiptChainHead,
    ...(transition.inFlight === undefined
      ? {}
      : { inFlight: transition.inFlight }),
    updatedAt: new Date(currentTime).toISOString(),
    parentCheckpointDigest: parent.checkpointDigest,
  };
  const checkpoint: WorkflowCheckpointRecord = {
    ...body,
    checkpointDigest: computeWorkflowCheckpointDigest(body),
  };
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `settled checkpoint violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  const child = retainCheckpoint(checkpoint);
  transitionedCheckpointInstances.add(parent);
  return child;
}

function nextReadyStatus(
  plan: ResolvedWorkflowPlan,
  nextOrdinal: number,
  evidenceKinds: readonly StableId[],
): WorkflowCheckpointStatus {
  if (nextOrdinal < plan.steps.length) {
    return plan.steps[nextOrdinal]?.approvalCheckpoint
      ? "waiting-approval"
      : "prepared";
  }
  return plan.requiredEvidence.every((kind) => evidenceKinds.includes(kind))
    ? "succeeded"
    : "blocked";
}

export function recoverHydratedWorkflowCheckpoint(
  registry: ValidatedRegistry,
  value: unknown,
  currentTime: number,
): WorkflowCheckpointRecord {
  const checkpoint = trustedCheckpoint(value);
  if (
    !Number.isSafeInteger(currentTime) ||
    currentTime < 0 ||
    currentTime > 8_640_000_000_000_000
  ) {
    throw boundaryError(
      "$currentTime",
      "expected an epoch millisecond inside the supported date range",
    );
  }
  if (registry.digest !== checkpoint.identity.registryDigest) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$registry",
      "registry digest differs from the checkpoint authority",
    );
  }
  const plan = resolveWorkflowPlan(
    registry,
    checkpoint.identity.workflow.id,
    checkpoint.identity.projectStage,
  );
  if (
    plan.workflow.version !== checkpoint.identity.workflow.version ||
    plan.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest
  ) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$checkpoint.identity.workflow",
      "resolved workflow authority changed after checkpoint persistence",
    );
  }

  const expired = currentTime >= Date.parse(checkpoint.expiresAt);
  const inFlight = checkpoint.inFlight;
  let status: WorkflowCheckpointStatus;
  let recoveredInFlight: WorkflowCheckpointInFlight | undefined;
  if (
    (checkpoint.status === "running" ||
      checkpoint.status === "rolling-back") &&
    inFlight !== undefined &&
    inFlight.sideEffect === "started"
  ) {
    status = "uncertain";
    recoveredInFlight = {
      ...inFlight,
      command: {
        ...inFlight.command,
        permissions: [...inFlight.command.permissions],
      },
      approvalIds: [...inFlight.approvalIds],
      sideEffect: "uncertain",
    };
  } else if (expired) {
    status = "expired";
  } else if (
    checkpoint.status === "running" &&
    inFlight?.sideEffect === "not-started"
  ) {
    status = plan.steps[checkpoint.nextOrdinal]?.approvalCheckpoint
      ? "waiting-approval"
      : "prepared";
  } else if (
    checkpoint.status === "rolling-back" &&
    inFlight?.sideEffect === "not-started"
  ) {
    status = "waiting-rollback";
  } else {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$checkpoint.status",
      "checkpoint does not require a restart recovery transition",
    );
  }

  const {
    checkpointDigest: _checkpointDigest,
    parentCheckpointDigest: _parentCheckpointDigest,
    inFlight: _previousInFlight,
    ...retained
  } = checkpoint;
  const body: Omit<WorkflowCheckpointRecord, "checkpointDigest"> = {
    ...retained,
    sequence: checkpoint.sequence + 1,
    status,
    ...(recoveredInFlight === undefined
      ? {}
      : { inFlight: recoveredInFlight }),
    updatedAt: new Date(currentTime).toISOString(),
    parentCheckpointDigest: checkpoint.checkpointDigest,
  };
  const recovered: WorkflowCheckpointRecord = {
    ...body,
    checkpointDigest: computeWorkflowCheckpointDigest(body),
  };
  const issues = checkWorkflowCheckpointSemantics(recovered);
  if (issues.length > 0) {
    throw checkpointError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `restart recovery violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  const child = retainCheckpoint(recovered);
  transitionedCheckpointInstances.add(checkpoint);
  return child;
}

export function createWorkflowCheckpoint(
  value: CreateWorkflowCheckpointRequest,
): WorkflowCheckpointRecord {
  const record = dataRecord(value, "$request");
  const required = [
    "registry",
    "workflowId",
    "project",
    "runId",
    "inputDigest",
    "ttlMs",
  ];
  exactKeys(
    record,
    [
      ...required,
      "feature",
      "dirtyStateDigest",
      "sessionIdentityDigest",
      "now",
    ],
    required,
    "$request",
  );
  const workflowId = stableId(record["workflowId"], "$request.workflowId");
  const projectBinding = project(record["project"]);
  const runId = record["runId"];
  if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
    throw boundaryError("$request.runId", "expected a canonical UUID");
  }
  const inputDigest = digest(record["inputDigest"], "$request.inputDigest");
  const featureBinding = feature(record["feature"]);
  const dirtyStateDigest =
    record["dirtyStateDigest"] === undefined
      ? undefined
      : digest(record["dirtyStateDigest"], "$request.dirtyStateDigest");
  const sessionIdentityDigest =
    record["sessionIdentityDigest"] === undefined
      ? undefined
      : digest(
          record["sessionIdentityDigest"],
          "$request.sessionIdentityDigest",
        );
  const ttlMs = record["ttlMs"];
  if (
    !Number.isSafeInteger(ttlMs) ||
    (ttlMs as number) < WORKFLOW_CHECKPOINT_MIN_TTL_MS ||
    (ttlMs as number) > WORKFLOW_CHECKPOINT_MAX_TTL_MS
  ) {
    throw boundaryError(
      "$request.ttlMs",
      "checkpoint TTL is outside the bounded resume window",
    );
  }
  const currentTime = readClock(record["now"] ?? Date.now);
  const expiresTime = currentTime + (ttlMs as number);
  if (!Number.isSafeInteger(expiresTime) || expiresTime > 8_640_000_000_000_000) {
    throw boundaryError("$request.ttlMs", "checkpoint expiry is outside the date range");
  }
  const plan = resolveWorkflowPlan(
    value.registry,
    workflowId,
    projectBinding.stage,
  );
  const timestamp = new Date(currentTime).toISOString();
  const body: Omit<WorkflowCheckpointRecord, "checkpointDigest"> = {
    schemaVersion: workflowCheckpointSchema.version,
    checkpointId: randomUUID(),
    sequence: 0,
    identity: {
      runId,
      projectId: projectBinding.id,
      projectIdentityDigest: projectBinding.identityDigest,
      projectStage: projectBinding.stage,
      ...(featureBinding === undefined
        ? {}
        : {
            featureId: featureBinding.id,
            featureContractDigest: featureBinding.contractDigest,
          }),
      registryDigest: value.registry.digest,
      workflow: {
        id: plan.workflow.id,
        version: plan.workflow.version,
        resolvedPlanDigest: plan.resolvedPlanDigest,
      },
      inputDigest,
    },
    status: plan.steps[0]?.approvalCheckpoint
      ? "waiting-approval"
      : "prepared",
    nextOrdinal: 0,
    attempts: [],
    budgetUsage: {
      durationMs: 0,
      outputBytes: 0,
      changedFiles: 0,
      changedBytes: 0,
      repairCycles: 0,
    },
    evidenceKinds: [],
    artifactDigests: [],
    ...(dirtyStateDigest === undefined ? {} : { dirtyStateDigest }),
    ...(sessionIdentityDigest === undefined
      ? {}
      : { sessionIdentityDigest }),
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(expiresTime).toISOString(),
  };
  const checkpoint: WorkflowCheckpointRecord = {
    ...body,
    checkpointDigest: computeWorkflowCheckpointDigest(body),
  };
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw new CoreBoundaryError(
      "workflow-checkpoint-state-invalid",
      "$checkpoint",
      `initial checkpoint violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return retainCheckpoint(checkpoint);
}

export function beginWorkflowStep(
  value: BeginWorkflowStepRequest,
): WorkflowCheckpointRecord {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["registry", "checkpoint", "authorization", "now"],
    ["registry", "checkpoint", "authorization"],
    "$request",
  );
  const currentTime = readClock(record["now"] ?? Date.now);
  const { checkpoint, plan } = resolveCheckpointPlan(
    value.registry,
    record["checkpoint"],
    currentTime,
  );
  assertAuthorizedPermissionDecision(record["authorization"]);
  const authorization = record["authorization"];
  if (
    checkpoint.status !== "prepared" &&
    checkpoint.status !== "waiting-approval" &&
    checkpoint.status !== "waiting-rollback"
  ) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint.status",
      "workflow step can begin only from a dispatch-ready state",
    );
  }
  const step = plan.steps[checkpoint.nextOrdinal];
  if (step === undefined) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint.nextOrdinal",
      "workflow has no step at the checkpoint cursor",
    );
  }
  const phase =
    checkpoint.status === "waiting-rollback" ? "rollback" : "command";
  const command = phase === "rollback" ? step.rollbackCommand : step.command;
  if (command === undefined) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint.status",
      "resolved step does not declare a rollback command",
    );
  }
  assertAuthorizationBinding(
    checkpoint,
    plan,
    command,
    step.id,
    authorization,
    checkpoint.status === "waiting-approval",
    currentTime,
  );
  const attempt =
    checkpoint.attempts.filter(
      (entry) =>
        entry.ordinal === checkpoint.nextOrdinal && entry.phase === phase,
    ).length + 1;
  if (attempt > 100) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint.attempts",
      "workflow step attempt limit is exhausted",
    );
  }
  const admitted = appendInFlightCheckpoint(
    checkpoint,
    phase === "rollback" ? "rolling-back" : "running",
    {
      stepId: step.id,
      ordinal: checkpoint.nextOrdinal,
      attempt,
      phase,
      command: {
        ...command,
        permissions: [...command.permissions],
      },
      inputDigest: authorization.challenge.inputDigest,
      authorizationId: authorization.lease.authorizationId,
      authorizationRequestDigest: authorization.challenge.requestDigest,
      authorizationExpiresAt: authorization.lease.expiresAt,
      approvalIds: [...authorization.lease.grantIds],
      sideEffect: "not-started",
    },
    currentTime,
  );
  checkpointAuthorizationLeases.set(admitted, authorization.lease);
  return admitted;
}

export function markWorkflowStepStarted(
  value: MarkWorkflowStepStartedRequest,
): WorkflowCheckpointRecord {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["registry", "checkpoint", "now"],
    ["registry", "checkpoint"],
    "$request",
  );
  const currentTime = readClock(record["now"] ?? Date.now);
  const { checkpoint, plan } = resolveCheckpointPlan(
    value.registry,
    record["checkpoint"],
    currentTime,
  );
  if (
    (checkpoint.status !== "running" &&
      checkpoint.status !== "rolling-back") ||
    checkpoint.inFlight === undefined ||
    checkpoint.inFlight.sideEffect !== "not-started"
  ) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint",
      "only an admitted, not-yet-started step can cross the dispatch boundary",
    );
  }
  const lease = checkpointAuthorizationLeases.get(checkpoint);
  if (
    lease === undefined ||
    lease.state !== "active" ||
    lease.authorizationId !== checkpoint.inFlight.authorizationId ||
    lease.requestDigest !== checkpoint.inFlight.authorizationRequestDigest ||
    currentTime >= Date.parse(checkpoint.inFlight.authorizationExpiresAt)
  ) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint.inFlight",
      "in-flight authorization is absent, settled, mismatched, or expired",
    );
  }
  const step = plan.steps[checkpoint.inFlight.ordinal];
  const expectedCommand =
    checkpoint.inFlight.phase === "rollback"
      ? step?.rollbackCommand
      : step?.command;
  if (
    step === undefined ||
    step.id !== checkpoint.inFlight.stepId ||
    expectedCommand === undefined ||
    expectedCommand.descriptorDigest !==
      checkpoint.inFlight.command.descriptorDigest ||
    expectedCommand.handlerDigest !== checkpoint.inFlight.command.handlerDigest
  ) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$request.checkpoint.inFlight.command",
      "in-flight command differs from the resolved plan",
    );
  }
  const started = appendInFlightCheckpoint(
    checkpoint,
    checkpoint.status,
    {
      ...checkpoint.inFlight,
      command: {
        ...checkpoint.inFlight.command,
        permissions: [...checkpoint.inFlight.command.permissions],
      },
      approvalIds: [...checkpoint.inFlight.approvalIds],
      sideEffect: "started",
    },
    currentTime,
  );
  checkpointAuthorizationLeases.set(started, lease);
  return started;
}

export function settleWorkflowStep(
  value: SettleWorkflowStepRequest,
): WorkflowCheckpointRecord {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["registry", "checkpoint", "receipt", "settlement", "now"],
    ["registry", "checkpoint", "receipt", "settlement"],
    "$request",
  );
  const currentTime = readClock(record["now"] ?? Date.now);
  const { checkpoint, plan } = resolveCheckpointPlan(
    value.registry,
    record["checkpoint"],
    currentTime,
  );
  if (
    (checkpoint.status !== "running" &&
      checkpoint.status !== "rolling-back") ||
    checkpoint.inFlight === undefined ||
    checkpoint.inFlight.sideEffect !== "started"
  ) {
    throw checkpointError(
      "workflow-checkpoint-transition-invalid",
      "$request.checkpoint",
      "only a dispatched workflow step can be settled",
    );
  }
  const receipt = validateReceipt(value.registry, record["receipt"]);
  assertReceiptBinding(value.registry, checkpoint, receipt);
  const settlement = assertSettlementBinding(
    checkpoint,
    receipt,
    record["settlement"],
    currentTime,
  );
  const step = plan.steps[checkpoint.inFlight.ordinal];
  if (step === undefined || step.id !== checkpoint.inFlight.stepId) {
    throw checkpointError(
      "workflow-checkpoint-plan-mismatch",
      "$request.checkpoint.inFlight.stepId",
      "settled step no longer exists in the resolved plan",
    );
  }

  const acceptedArtifacts =
    receipt.status === "succeeded" && settlement.status === "succeeded"
      ? receipt.artifacts.filter(({ complete }) => complete)
      : [];
  const evidenceKinds = mergeCanonical(
    checkpoint.evidenceKinds,
    acceptedArtifacts.map(({ kind }) => kind),
  );
  const artifactDigests = mergeCanonical(
    checkpoint.artifactDigests,
    acceptedArtifacts.map(({ digest: artifactDigest }) => artifactDigest),
  );
  const { usage, exceeded } = aggregateBudgetUsage(
    checkpoint,
    settlement,
    plan,
  );
  const reconciliationRequired =
    exceeded ||
    settlement.mutationUncertain ||
    settlement.status === "scope-violation" ||
    settlement.status === "uncertain" ||
    receipt.status === "uncertain" ||
    receipt.mutation.status === "uncertain";

  let status: WorkflowCheckpointStatus;
  let outcome: WorkflowCheckpointAttempt["outcome"];
  let nextOrdinal = checkpoint.nextOrdinal;
  let retainedInFlight: WorkflowCheckpointInFlight | undefined;
  if (reconciliationRequired) {
    status = "uncertain";
    outcome = "uncertain";
    retainedInFlight = {
      ...checkpoint.inFlight,
      command: {
        ...checkpoint.inFlight.command,
        permissions: [...checkpoint.inFlight.command.permissions],
      },
      approvalIds: [...checkpoint.inFlight.approvalIds],
      sideEffect: "uncertain",
    };
  } else if (checkpoint.inFlight.phase === "rollback") {
    if (receipt.status === "succeeded") {
      status = "failed";
      outcome = "rolled-back";
    } else {
      status = "uncertain";
      outcome = "uncertain";
      retainedInFlight = {
        ...checkpoint.inFlight,
        command: {
          ...checkpoint.inFlight.command,
          permissions: [...checkpoint.inFlight.command.permissions],
        },
        approvalIds: [...checkpoint.inFlight.approvalIds],
        sideEffect: "uncertain",
      };
    }
  } else if (receipt.status === "succeeded") {
    outcome = "succeeded";
    nextOrdinal += 1;
    status = nextReadyStatus(plan, nextOrdinal, evidenceKinds);
  } else if (receipt.status === "cancelled") {
    status = "cancelled";
    outcome = "cancelled";
  } else if (receipt.status === "blocked") {
    status = "blocked";
    outcome = "blocked";
  } else {
    switch (step.onFailure) {
      case "blocked":
        status = "blocked";
        outcome = "blocked";
        break;
      case "continue":
        outcome = "continued";
        nextOrdinal += 1;
        status = nextReadyStatus(plan, nextOrdinal, evidenceKinds);
        break;
      case "rollback":
        status = "waiting-rollback";
        outcome = "failed";
        break;
      case "stop":
        status = "failed";
        outcome = "failed";
        break;
    }
  }

  const child = appendSettledCheckpoint(
    checkpoint,
    {
      status,
      nextOrdinal,
      attempt: {
        stepId: checkpoint.inFlight.stepId,
        ordinal: checkpoint.inFlight.ordinal,
        attempt: checkpoint.inFlight.attempt,
        phase: checkpoint.inFlight.phase,
        outcome,
        receiptDigest: receipt.receiptDigest,
      },
      budgetUsage: usage,
      evidenceKinds,
      artifactDigests,
      receiptChainHead: receipt.receiptDigest,
      ...(retainedInFlight === undefined
        ? {}
        : { inFlight: retainedInFlight }),
    },
    currentTime,
  );
  checkpointAuthorizationLeases.delete(checkpoint);
  return child;
}
