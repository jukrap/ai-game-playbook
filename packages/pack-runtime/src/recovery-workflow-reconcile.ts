import {
  PACK_RECOVERY_COMMAND_ID,
  PACK_RECOVERY_WORKFLOW_ID,
  PACK_RECOVERY_WORKFLOW_STEP_ID,
  WORKFLOW_RECONCILIATION_COMMAND_ID,
  WORKFLOW_RECONCILIATION_STEP_ID,
  WORKFLOW_RECONCILIATION_WORKFLOW_ID,
  canonicalizeJson,
  compareCanonicalText,
  computeRunReceiptDigest,
  digestCanonicalJson,
  packRecoveryCommandInputSchema,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  sha256Digest,
  workflowReconciliationCommandInputSchema,
  workflowReconciliationCommandOutputSchema,
  type ExecutionBudgets,
  type PackRecoveryCommandInput,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
  type WorkflowReconciliationCommandInput,
  type WorkflowReconciliationCommandOutput,
} from "@ai-game-playbook/contracts";
import {
  RUN_RECEIPT_QUERY_MAX_ENTRIES,
  RUN_RECEIPT_QUERY_MAX_HEADS,
  RUN_RECEIPT_QUERY_MAX_TOTAL_HEAD_BYTES,
  RUN_RECEIPT_STORE_PATH,
  WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES,
  WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS,
  WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES,
  WORKFLOW_CHECKPOINT_STORE_PATH,
  acquireProjectLane,
  assertAuthorizedPermissionDecision,
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  loadQueriedRunReceiptChain,
  loadQueriedWorkflowCheckpointChain,
  persistRunReceipt,
  persistWorkflowCheckpoint,
  promoteRunReceiptArtifacts,
  queryRunReceiptHeads,
  queryWorkflowCheckpointHeads,
  reconcileWorkflowEvidence,
  resumeWorkflowCheckpoint,
  type AuthorizedPermissionDecision,
  type CanonicalProjectRoot,
  type PermissionActualEffects,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
  type ProjectLaneLease,
  type StoredRunReceipt,
  type StoredWorkflowCheckpoint,
} from "@ai-game-playbook/core";
import {
  assertValidatedRegistry,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";
import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";

import { PackRuntimeError } from "./errors.js";
import {
  inspectPackTransactionRecovery,
  internalsForPackTransactionRecoveryReport,
  type PackTransactionRecoveryReport,
} from "./recovery.js";
import {
  PACK_TRANSACTION_MAX_RECORD_BYTES,
  serializePackTransactionRecord,
  packTransactionRecordPath,
  type LoadedPackTransactionJournal,
  type PackTransactionRecord,
} from "./transaction-journal.js";

const MAX_DIRECTORY_ENTRIES = 100_000;
const RECONCILIATION_LANE_LEASE_MS = 35_000;
const RECONCILIATION_LANE_WAIT_MS = 5_000;
const RECONCILIATION_LANE_POLL_MS = 25;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DataRecord = Record<string, unknown>;

export interface PreparePackRecoveryWorkflowReconciliationRequest {
  readonly projectRoot: string;
  readonly registry: ValidatedRegistry;
  readonly targetRunId: string;
  readonly reconciliationRunId: string;
  readonly originalInput: PackRecoveryCommandInput;
}

export interface PreparedPackRecoveryWorkflowReconciliation {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly targetRunId: string;
  readonly transactionRunId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly stage: StoredWorkflowCheckpoint["checkpoint"]["identity"]["projectStage"];
  };
  readonly registryDigest: Sha256Digest;
  readonly target: {
    readonly checkpointId: string;
    readonly checkpointDigest: Sha256Digest;
    readonly checkpointHeadDigest: Sha256Digest;
    readonly workflowId: typeof PACK_RECOVERY_WORKFLOW_ID;
    readonly resolvedPlanDigest: Sha256Digest;
    readonly commandId: typeof PACK_RECOVERY_COMMAND_ID;
    readonly inputDigest: Sha256Digest;
    readonly receiptState: "missing" | "present";
    readonly receiptDigest?: Sha256Digest;
  };
  readonly proof: {
    readonly kind: "pack-recovery";
    readonly path: string;
    readonly digest: Sha256Digest;
    readonly recordDigest: Sha256Digest;
    readonly bytes: number;
  };
  readonly workflow: {
    readonly id: typeof WORKFLOW_RECONCILIATION_WORKFLOW_ID;
    readonly stepId: typeof WORKFLOW_RECONCILIATION_STEP_ID;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly targetOutcome: "succeeded";
  readonly paths: readonly string[];
  readonly planDigest: Sha256Digest;
}

export interface CreatePackRecoveryWorkflowReconciliationAuthorizationRequest {
  readonly plan: PreparedPackRecoveryWorkflowReconciliation;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
}

export interface DispatchPreparedPackRecoveryWorkflowReconciliationRequest {
  readonly plan: PreparedPackRecoveryWorkflowReconciliation;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface ClosureProof {
  readonly report: PackTransactionRecoveryReport;
  readonly journal: LoadedPackTransactionJournal;
  readonly record: PackTransactionRecord;
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly recordDigest: Sha256Digest;
  readonly bytes: number;
}

interface TargetReceiptObservation {
  readonly state: "missing" | "present";
  readonly digest?: Sha256Digest;
  readonly stored?: StoredRunReceipt;
}

interface ReconciliationInternals {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly targetStored: StoredWorkflowCheckpoint;
  readonly originalInput: PackRecoveryCommandInput;
  readonly proof: ClosureProof;
}

const reconciliationInternals = new WeakMap<
  PreparedPackRecoveryWorkflowReconciliation,
  ReconciliationInternals
>();

function reconciliationError(
  code: ConstructorParameters<typeof PackRuntimeError>[0],
  path: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new PackRuntimeError(code, path, message, mutationUncertain);
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    reconciliationError(
      "invalid-pack-recovery-request",
      path,
      "expected a plain data object",
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
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("not plain data fields");
    }
    return value as DataRecord;
  } catch {
    reconciliationError(
      "invalid-pack-recovery-request",
      path,
      "object fields could not be inspected safely",
    );
  }
}

function exactKeys(
  record: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  path = "$request",
): void {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !allowed.has(key))
  ) {
    reconciliationError(
      "invalid-pack-recovery-request",
      path,
      "request contains missing or undeclared fields",
    );
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function validateUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    reconciliationError(
      "invalid-pack-recovery-request",
      path,
      "expected a canonical UUID",
    );
  }
  return value;
}

function validateOriginalInput(
  registry: ValidatedRegistry,
  value: unknown,
): PackRecoveryCommandInput {
  try {
    return validateRegisteredContractValue(
      registry,
      {
        schemaId: packRecoveryCommandInputSchema.schemaId,
        digest: packRecoveryCommandInputSchema.digest,
      },
      value,
    ) as unknown as PackRecoveryCommandInput;
  } catch {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.originalInput",
      "original pack recovery input failed strict registry validation",
    );
  }
}

function closureOutcome(record: PackTransactionRecord): string | undefined {
  return record.kind === "started" ? undefined : record.outcome;
}

function selectClosureRecord(
  input: PackRecoveryCommandInput,
  journal: LoadedPackTransactionJournal,
): PackTransactionRecord | undefined {
  if (input.action === "append-reconciliation") return journal.reconciliation;
  if (input.action === "clear-marker") {
    return journal.reconciliation ?? journal.terminal;
  }
  return journal.terminal;
}

function expectedJournalOutcome(input: PackRecoveryCommandInput): string {
  return input.finalOutcome;
}

function closureMatchesInput(
  input: PackRecoveryCommandInput,
  report: PackTransactionRecoveryReport,
  journal: LoadedPackTransactionJournal,
  record: PackTransactionRecord,
): boolean {
  const outcomeMatches = closureOutcome(record) === expectedJournalOutcome(input);
  const actionMatches =
    input.action === "append-reconciliation"
      ? record.kind === "reconciliation" &&
        record.recoveryReportDigest === input.reportDigest
      : input.action === "append-started-and-terminal" ||
          input.action === "append-terminal"
        ? record.kind === "terminal"
        : input.action === "clear-marker" &&
          report.journalSnapshotDigest === input.journalSnapshotDigest;
  return outcomeMatches && actionMatches;
}

async function observeClosure(
  root: CanonicalProjectRoot,
  checkpoint: StoredWorkflowCheckpoint["checkpoint"],
  input: PackRecoveryCommandInput,
): Promise<ClosureProof> {
  let report: PackTransactionRecoveryReport;
  try {
    report = await inspectPackTransactionRecovery({
      root,
      runId: input.transactionRunId,
      project: {
        id: checkpoint.identity.projectId,
        identityDigest: checkpoint.identity.projectIdentityDigest,
      },
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
  } catch {
    reconciliationError(
      "pack-workflow-reconciliation-stale",
      "$closure",
      "pack closure could not be inspected within the fixed boundary",
    );
  }
  const internals = internalsForPackTransactionRecoveryReport(report);
  const record = selectClosureRecord(input, internals.journal);
  if (
    !report.stable ||
    report.consistency !== "consistent" ||
    report.activeMarker !== "absent" ||
    report.finalizationAction !== "none" ||
    report.mutationUncertain ||
    report.finalizationOutcome !== input.finalOutcome ||
    record === undefined ||
    !closureMatchesInput(input, report, internals.journal, record)
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-not-actionable",
      "$closure",
      "current pack state does not prove the exact completed recovery outcome",
      report.mutationUncertain,
    );
  }
  const content = serializePackTransactionRecord(record);
  return Object.freeze({
    report,
    journal: internals.journal,
    record,
    path: packTransactionRecordPath(input.transactionRunId, record.sequence),
    digest: sha256Digest(content),
    recordDigest: record.recordDigest,
    bytes: content.byteLength,
  });
}

function assertTargetReceiptBinding(
  checkpoint: StoredWorkflowCheckpoint["checkpoint"],
  stored: StoredRunReceipt,
  proof: ClosureProof,
): void {
  const receipt = stored.receipt;
  const inFlight = checkpoint.inFlight;
  const proofArtifact = receipt.artifacts[0];
  const projectIdentityDigest =
    checkpoint.identity.projectRootIdentityDigest ??
    checkpoint.identity.projectIdentityDigest;
  if (
    inFlight === undefined ||
    receipt.identity.runId !== checkpoint.identity.runId ||
    receipt.identity.workflowId !== checkpoint.identity.workflow.id ||
    receipt.identity.stepId !== inFlight.stepId ||
    receipt.identity.attempt !== inFlight.attempt ||
    receipt.identity.phase !== inFlight.phase ||
    receipt.identity.projectId !== checkpoint.identity.projectId ||
    receipt.identity.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest ||
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
    receipt.environment.projectIdentityDigest !== projectIdentityDigest ||
    receipt.previousReceiptDigest !== checkpoint.receiptChainHead ||
    receipt.status !== "succeeded" ||
    receipt.outcomes.outer.status !== "passed" ||
    receipt.outcomes.outer.exitCode !== 0 ||
    receipt.outcomes.outer.timedOut ||
    receipt.outcomes.inner.status !== "passed" ||
    receipt.outcomes.inner.code !== "pack-recovery-finalized" ||
    receipt.mutation.status !== "committed" ||
    receipt.recovery.attempted !== true ||
    receipt.recovery.outcome !== "passed" ||
    receipt.artifacts.length !== 1 ||
    proofArtifact?.artifactId !== "pack-recovery-closure" ||
    proofArtifact.kind !== "pack-recovery" ||
    proofArtifact.commandId !== PACK_RECOVERY_COMMAND_ID ||
    proofArtifact.complete !== true ||
    proofArtifact.sourcePath !== proof.path ||
    proofArtifact.digest !== proof.digest ||
    proofArtifact.bytes !== proof.bytes
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-stale",
      "$targetReceipt",
      "target receipt does not bind the uncertain command and its exact successful closure proof",
    );
  }
}

async function observeTargetReceipt(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  checkpoint: StoredWorkflowCheckpoint["checkpoint"],
  proof: ClosureProof,
): Promise<TargetReceiptObservation> {
  const query = await queryRunReceiptHeads({
    root,
    registry,
    maxEntries: RUN_RECEIPT_QUERY_MAX_ENTRIES,
    maxHeads: RUN_RECEIPT_QUERY_MAX_HEADS,
    maxTotalHeadBytes: RUN_RECEIPT_QUERY_MAX_TOTAL_HEAD_BYTES,
  });
  const head = query.heads.find(
    ({ runId }) => runId === checkpoint.identity.runId,
  );
  if (head === undefined) {
    if (checkpoint.receiptChainHead !== undefined) {
      reconciliationError(
        "pack-workflow-reconciliation-stale",
        "$targetReceipt",
        "target checkpoint declares a missing receipt head",
      );
    }
    return Object.freeze({ state: "missing" as const });
  }
  if (
    head.projectAuthority !== "current" ||
    head.registryAuthority !== "current" ||
    head.projectId !== checkpoint.identity.projectId ||
    head.workflowId !== checkpoint.identity.workflow.id ||
    head.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-stale",
      "$targetReceipt",
      "target receipt head is outside current project or registry authority",
    );
  }
  const loaded = await loadQueriedRunReceiptChain({
    query,
    runId: checkpoint.identity.runId,
    maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
  });
  if (
    checkpoint.receiptChainHead !== undefined ||
    loaded.receipts.length !== 1 ||
    loaded.stored.receipt.previousReceiptDigest !== undefined
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-stale",
      "$targetReceipt",
      "v1 reconciliation requires one detached first receipt for the uncertain command",
    );
  }
  assertTargetReceiptBinding(checkpoint, loaded.stored, proof);
  return Object.freeze({
    state: "present" as const,
    digest: loaded.stored.receipt.receiptDigest,
    stored: loaded.stored,
  });
}

async function loadTargetCheckpoint(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  runId: string,
  allowRestartRecovery: boolean,
): Promise<StoredWorkflowCheckpoint> {
  const query = await queryWorkflowCheckpointHeads({
    root,
    registry,
    maxEntries: WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES,
    maxHeads: WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS,
    maxTotalHeadBytes: WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES,
  });
  const head = query.heads.find((candidate) => candidate.runId === runId);
  if (
    head === undefined ||
    head.projectAuthority !== "current" ||
    head.registryAuthority !== "current" ||
    head.workflowId !== PACK_RECOVERY_WORKFLOW_ID
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-not-actionable",
      "$targetCheckpoint",
      "target pack recovery checkpoint is missing or outside current authority",
    );
  }
  const loaded = await loadQueriedWorkflowCheckpointChain({ query, runId });
  let stored = loaded.stored;
  const checkpoint = stored.checkpoint;
  if (
    allowRestartRecovery &&
    checkpoint.status === "running" &&
    checkpoint.inFlight?.phase === "command" &&
    checkpoint.inFlight.sideEffect === "started"
  ) {
    const resumed = await resumeWorkflowCheckpoint({
      registry,
      stored,
      policy: "safe",
    });
    stored = resumed.stored;
  } else if (checkpoint.status === "uncertain") {
    const resumed = await resumeWorkflowCheckpoint({
      registry,
      stored,
      policy: "safe",
    });
    stored = resumed.stored;
  }
  if (
    stored.checkpoint.status !== "uncertain" ||
    stored.checkpoint.inFlight?.phase !== "command" ||
    stored.checkpoint.inFlight.sideEffect !== "uncertain" ||
    stored.checkpoint.reconciliation !== undefined
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-not-actionable",
      "$targetCheckpoint",
      "target checkpoint is not one unreconciled uncertain command",
    );
  }
  return stored;
}

function assertTargetCommand(
  registry: ValidatedRegistry,
  stored: StoredWorkflowCheckpoint,
  input: PackRecoveryCommandInput,
): void {
  const checkpoint = stored.checkpoint;
  const inFlight = checkpoint.inFlight;
  const targetPlan = resolveWorkflowPlan(
    registry,
    PACK_RECOVERY_WORKFLOW_ID,
    checkpoint.identity.projectStage,
  );
  const step = targetPlan.steps[0];
  if (
    input.recoveryRunId !== checkpoint.identity.runId ||
    digestCanonicalJson(input) !== inFlight?.inputDigest ||
    checkpoint.identity.workflow.id !== PACK_RECOVERY_WORKFLOW_ID ||
    checkpoint.identity.workflow.resolvedPlanDigest !==
      targetPlan.resolvedPlanDigest ||
    targetPlan.steps.length !== 1 ||
    step?.id !== PACK_RECOVERY_WORKFLOW_STEP_ID ||
    inFlight?.stepId !== PACK_RECOVERY_WORKFLOW_STEP_ID ||
    inFlight.command.id !== PACK_RECOVERY_COMMAND_ID ||
    step.command.descriptorDigest !== inFlight.command.descriptorDigest ||
    step.command.handlerDigest !== inFlight.command.handlerDigest
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-not-actionable",
      "$request.originalInput",
      "original input does not bind the exact uncertain pack recovery command",
    );
  }
}

function sortedPaths(paths: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(paths)].sort(compareCanonicalText));
}

export function computePackRecoveryWorkflowReconciliationPlanDigest(
  plan: Omit<PreparedPackRecoveryWorkflowReconciliation, "planDigest"> &
    Partial<Pick<PreparedPackRecoveryWorkflowReconciliation, "planDigest">>,
): Sha256Digest {
  const { planDigest: _planDigest, ...body } = plan;
  return digestCanonicalJson({
    domain: "ai-game-playbook.pack-recovery-workflow-reconciliation-plan",
    version: "1",
    plan: body,
  });
}

export async function preparePackRecoveryWorkflowReconciliation(
  value: PreparePackRecoveryWorkflowReconciliationRequest,
): Promise<PreparedPackRecoveryWorkflowReconciliation> {
  const request = dataRecord(value, "$request");
  exactKeys(request, [
    "projectRoot",
    "registry",
    "targetRunId",
    "reconciliationRunId",
    "originalInput",
  ]);
  try {
    assertValidatedRegistry(value.registry);
  } catch {
    reconciliationError(
      "pack-registry-untrusted",
      "$request.registry",
      "workflow reconciliation requires the current same-process registry",
    );
  }
  const targetRunId = validateUuid(value.targetRunId, "$request.targetRunId");
  const reconciliationRunId = validateUuid(
    value.reconciliationRunId,
    "$request.reconciliationRunId",
  );
  if (targetRunId === reconciliationRunId) {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.reconciliationRunId",
      "reconciliation execution must use a run identity separate from its target",
    );
  }
  if (typeof value.projectRoot !== "string") {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.projectRoot",
      "project root must be a string path",
    );
  }
  const root = await canonicalizeProjectRoot(value.projectRoot);
  const targetStored = await loadTargetCheckpoint(
    root,
    value.registry,
    targetRunId,
    true,
  );
  const originalInput = validateOriginalInput(
    value.registry,
    value.originalInput,
  );
  assertTargetCommand(value.registry, targetStored, originalInput);
  const proof = await observeClosure(root, targetStored.checkpoint, originalInput);
  const receipt = await observeTargetReceipt(
    root,
    value.registry,
    targetStored.checkpoint,
    proof,
  );
  const reconciliationPlan = resolveWorkflowPlan(
    value.registry,
    WORKFLOW_RECONCILIATION_WORKFLOW_ID,
    targetStored.checkpoint.identity.projectStage,
  );
  const reconciliationStep = reconciliationPlan.steps[0];
  if (
    reconciliationPlan.steps.length !== 1 ||
    reconciliationStep?.id !== WORKFLOW_RECONCILIATION_STEP_ID ||
    reconciliationStep.command.id !== WORKFLOW_RECONCILIATION_COMMAND_ID
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-not-actionable",
      "$registry.workflow",
      "registry reconciliation workflow does not match the finite provider contract",
    );
  }
  const target = Object.freeze({
    checkpointId: targetStored.checkpoint.checkpointId,
    checkpointDigest: targetStored.checkpoint.checkpointDigest,
    checkpointHeadDigest: targetStored.headDigest,
    workflowId: PACK_RECOVERY_WORKFLOW_ID,
    resolvedPlanDigest:
      targetStored.checkpoint.identity.workflow.resolvedPlanDigest,
    commandId: PACK_RECOVERY_COMMAND_ID,
    inputDigest: targetStored.checkpoint.inFlight!.inputDigest,
    receiptState: receipt.state,
    ...(receipt.digest === undefined ? {} : { receiptDigest: receipt.digest }),
  });
  const body = {
    schemaVersion: "1.0.0" as const,
    runId: reconciliationRunId,
    targetRunId,
    transactionRunId: originalInput.transactionRunId,
    project: Object.freeze({
      id: targetStored.checkpoint.identity.projectId,
      identityDigest: targetStored.checkpoint.identity.projectIdentityDigest,
      rootIdentityDigest: root.identityDigest,
      stage: targetStored.checkpoint.identity.projectStage,
    }),
    registryDigest: value.registry.digest,
    target,
    proof: Object.freeze({
      kind: "pack-recovery" as const,
      path: proof.path,
      digest: proof.digest,
      recordDigest: proof.recordDigest,
      bytes: proof.bytes,
    }),
    workflow: Object.freeze({
      id: WORKFLOW_RECONCILIATION_WORKFLOW_ID,
      stepId: WORKFLOW_RECONCILIATION_STEP_ID,
      resolvedPlanDigest: reconciliationPlan.resolvedPlanDigest,
    }),
    targetOutcome: "succeeded" as const,
    paths: sortedPaths([
      proof.path,
      `${RUN_RECEIPT_STORE_PATH}/${reconciliationRunId}.head.json`,
      `${WORKFLOW_CHECKPOINT_STORE_PATH}/${targetRunId}.head.json`,
    ]),
  };
  const plan = Object.freeze({
    ...body,
    planDigest: computePackRecoveryWorkflowReconciliationPlanDigest(body),
  });
  reconciliationInternals.set(
    plan,
    Object.freeze({
      root,
      registry: value.registry,
      targetStored,
      originalInput,
      proof,
    }),
  );
  return plan;
}

export function internalsForPreparedPackRecoveryWorkflowReconciliation(
  plan: PreparedPackRecoveryWorkflowReconciliation,
): ReconciliationInternals {
  const internals = reconciliationInternals.get(plan);
  if (
    internals === undefined ||
    computePackRecoveryWorkflowReconciliationPlanDigest(plan) !== plan.planDigest
  ) {
    reconciliationError(
      "pack-workflow-reconciliation-plan-untrusted",
      "$request.plan",
      "workflow reconciliation requires an original same-process prepared plan",
    );
  }
  return internals;
}

export function createWorkflowReconciliationCommandInput(
  plan: PreparedPackRecoveryWorkflowReconciliation,
): Readonly<WorkflowReconciliationCommandInput> {
  const internals = internalsForPreparedPackRecoveryWorkflowReconciliation(plan);
  const input = Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    reconciliationRunId: plan.runId,
    targetRunId: plan.targetRunId,
    targetCheckpointDigest: plan.target.checkpointDigest,
    targetCheckpointHeadDigest: plan.target.checkpointHeadDigest,
    targetWorkflowId: plan.target.workflowId,
    targetResolvedPlanDigest: plan.target.resolvedPlanDigest,
    targetCommandId: plan.target.commandId,
    targetInputDigest: plan.target.inputDigest,
    targetReceiptState: plan.target.receiptState,
    ...(plan.target.receiptDigest === undefined
      ? {}
      : { targetReceiptDigest: plan.target.receiptDigest }),
    proofKind: parseStableId(plan.proof.kind),
    proofDigest: plan.proof.digest,
    targetOutcome: plan.targetOutcome,
    planDigest: plan.planDigest,
  });
  try {
    validateRegisteredContractValue(
      internals.registry,
      {
        schemaId: workflowReconciliationCommandInputSchema.schemaId,
        digest: workflowReconciliationCommandInputSchema.digest,
      },
      input,
    );
  } catch {
    reconciliationError(
      "pack-workflow-reconciliation-plan-untrusted",
      "$request.plan",
      "prepared reconciliation plan cannot produce its registered command input",
    );
  }
  return input;
}

function snapshotBudgets(value: unknown): ExecutionBudgets {
  const record = dataRecord(value, "$request.budgets");
  exactKeys(
    record,
    ["maxDurationMs", "maxOutputBytes", "maxRepairCycles"],
    [
      "maxChangedFiles",
      "maxChangedBytes",
      "maxMemoryBytes",
      "maxCpuSeconds",
      "maxGpuSeconds",
      "maxCost",
    ],
    "$request.budgets",
  );
  let clone: unknown;
  try {
    clone = JSON.parse(canonicalizeJson(value)) as unknown;
  } catch {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.budgets",
      "budgets must be canonical JSON data",
    );
  }
  return Object.freeze(clone as ExecutionBudgets);
}

export function createPackRecoveryWorkflowReconciliationAuthorizationRequest(
  value: CreatePackRecoveryWorkflowReconciliationAuthorizationRequest,
): PermissionAuthorizationRequest {
  const request = dataRecord(value, "$request");
  exactKeys(request, ["plan", "budgets", "deadlineAt"]);
  const plan = value.plan;
  const internals = internalsForPreparedPackRecoveryWorkflowReconciliation(plan);
  const budgets = snapshotBudgets(value.budgets);
  const command = internals.registry.commands.find(
    ({ id }) => id === WORKFLOW_RECONCILIATION_COMMAND_ID,
  );
  if (
    command === undefined ||
    !Number.isSafeInteger(budgets.maxDurationMs) ||
    budgets.maxDurationMs < 1 ||
    budgets.maxDurationMs > command.budgets.maxDurationMs ||
    !Number.isSafeInteger(budgets.maxOutputBytes) ||
    budgets.maxOutputBytes < 0 ||
    budgets.maxOutputBytes > command.budgets.maxOutputBytes ||
    budgets.maxRepairCycles !== 0 ||
    budgets.maxChangedFiles !== 0 ||
    budgets.maxChangedBytes !== 0 ||
    budgets.maxMemoryBytes !== undefined ||
    budgets.maxCpuSeconds !== undefined ||
    budgets.maxGpuSeconds !== undefined ||
    budgets.maxCost !== undefined
  ) {
    reconciliationError(
      "pack-authorization-invalid",
      "$request.budgets",
      "reconciliation authority permits no target mutation and uses bounded metadata evidence budgets",
    );
  }
  if (!canonicalTimestamp(value.deadlineAt)) {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.deadlineAt",
      "authorization deadline must be a canonical timestamp",
    );
  }
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: WORKFLOW_RECONCILIATION_COMMAND_ID,
    input: createWorkflowReconciliationCommandInput(plan),
    workflow: Object.freeze({
      id: plan.workflow.id,
      stepId: plan.workflow.stepId,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    }),
    scope: Object.freeze({
      paths: plan.paths,
      objectIds: Object.freeze([]),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze(["metadata"] as const),
      publishTargets: Object.freeze([]),
    }),
    budgets,
    deadlineAt: value.deadlineAt,
  });
}

function validateAuthorization(
  plan: PreparedPackRecoveryWorkflowReconciliation,
  value: unknown,
): AuthorizedPermissionDecision {
  const internals = internalsForPreparedPackRecoveryWorkflowReconciliation(plan);
  try {
    assertAuthorizedPermissionDecision(value);
  } catch {
    reconciliationError(
      "pack-authorization-invalid",
      "$request.authorization",
      "reconciliation requires an active same-process broker decision",
    );
  }
  const authorization = value as AuthorizedPermissionDecision;
  const command = internals.registry.commands.find(
    ({ id }) => id === WORKFLOW_RECONCILIATION_COMMAND_ID,
  );
  const expected = createPackRecoveryWorkflowReconciliationAuthorizationRequest({
    plan,
    budgets: authorization.challenge.budgets,
    deadlineAt: authorization.challenge.deadlineAt,
  });
  if (
    command === undefined ||
    authorization.lease.state !== "active" ||
    authorization.lease.grantIds.length === 0 ||
    authorization.challenge.runId !== plan.runId ||
    authorization.challenge.project.id !== plan.project.id ||
    authorization.challenge.project.identityDigest !==
      plan.project.identityDigest ||
    authorization.challenge.registryDigest !== plan.registryDigest ||
    authorization.challenge.command.id !== WORKFLOW_RECONCILIATION_COMMAND_ID ||
    authorization.challenge.command.version !== command.version ||
    authorization.challenge.command.handlerDigest !== command.handler.digest ||
    authorization.challenge.inputDigest !==
      digestCanonicalJson(createWorkflowReconciliationCommandInput(plan)) ||
    authorization.challenge.permissions.length !== 1 ||
    authorization.challenge.permissions[0]?.permission !==
      "write-project-metadata" ||
    authorization.challenge.permissions[0]?.mode !== "approval-required" ||
    canonicalizeJson(authorization.challenge.workflow) !==
      canonicalizeJson(expected.workflow) ||
    canonicalizeJson(authorization.challenge.scope) !==
      canonicalizeJson(expected.scope) ||
    authorization.challenge.feature !== undefined ||
    authorization.challenge.editorSessionIdentityDigest !== undefined ||
    authorization.lease.requestDigest !==
      authorization.challenge.requestDigest ||
    authorization.lease.commandId !== WORKFLOW_RECONCILIATION_COMMAND_ID ||
    authorization.lease.projectId !== plan.project.id
  ) {
    reconciliationError(
      "pack-authorization-invalid",
      "$request.authorization",
      "authorization is not exactly bound to the reconciliation plan",
    );
  }
  return authorization;
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

function settleBeforeEvidence(
  authorization: AuthorizedPermissionDecision,
  outcome: "cancelled" | "failed" | "succeeded" | "uncertain",
  mutationUncertain: boolean,
  startedAt: number,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome,
      mutationUncertain,
      actual: emptyEffects(Math.max(0, Date.now() - startedAt)),
    });
  } catch {
    reconciliationError(
      "pack-workflow-reconciliation-evidence-uncertain",
      "$authorization.settlement",
      "reconciliation authority could not be settled",
      mutationUncertain,
    );
  }
}

function assertNotCancelled(
  signal: AbortSignal | null,
  authorization: AuthorizedPermissionDecision,
  startedAt: number,
): void {
  if (signal?.aborted !== true) return;
  settleBeforeEvidence(authorization, "cancelled", false, startedAt);
  reconciliationError(
    "pack-operation-cancelled",
    "$request.signal",
    "workflow reconciliation was cancelled before evidence acceptance",
  );
}

function sameReceiptObservation(
  plan: PreparedPackRecoveryWorkflowReconciliation,
  observation: TargetReceiptObservation,
): boolean {
  return (
    plan.target.receiptState === observation.state &&
    plan.target.receiptDigest === observation.digest
  );
}

function sameProof(
  plan: PreparedPackRecoveryWorkflowReconciliation,
  proof: ClosureProof,
): boolean {
  return (
    proof.path === plan.proof.path &&
    proof.digest === plan.proof.digest &&
    proof.recordDigest === plan.proof.recordDigest &&
    proof.bytes === plan.proof.bytes
  );
}

function runtimePlatform(): "windows" | "linux" | "macos" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  reconciliationError(
    "pack-execution-failed",
    "$environment.platform",
    "runtime platform cannot be represented in a receipt",
  );
}

function runtimeArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  reconciliationError(
    "pack-execution-failed",
    "$environment.architecture",
    "runtime architecture cannot be represented in a receipt",
  );
}

function buildReconciliationReceipt(
  plan: PreparedPackRecoveryWorkflowReconciliation,
  authorization: AuthorizedPermissionDecision,
  settlement: PermissionSettlement,
): RunReceipt {
  const internals = internalsForPreparedPackRecoveryWorkflowReconciliation(plan);
  const command = internals.registry.commands.find(
    ({ id }) => id === WORKFLOW_RECONCILIATION_COMMAND_ID,
  );
  if (command === undefined || settlement.status !== "succeeded") {
    reconciliationError(
      "pack-workflow-reconciliation-evidence-uncertain",
      "$receipt",
      "successful reconciliation receipt requires a settled registered command",
      true,
    );
  }
  const endedAtMs = Date.parse(settlement.settledAt);
  const startedAtMs = endedAtMs - settlement.actual.durationMs;
  const body: Omit<RunReceipt, "receiptDigest"> = {
    schemaVersion: parseSemanticVersion("1.0.0").value,
    receiptId: randomUUID(),
    status: "succeeded",
    identity: {
      runId: plan.runId,
      workflowId: plan.workflow.id,
      stepId: plan.workflow.stepId,
      attempt: 1,
      phase: "command",
      projectId: plan.project.id,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: command.id,
        version: command.version,
        descriptorDigest: digestCanonicalJson(command),
      },
      registryDigest: plan.registryDigest,
      handlerDigest: command.handler.digest,
      inputDigest: digestCanonicalJson(createWorkflowReconciliationCommandInput(plan)),
      authorizationId: settlement.authorizationId,
      authorizationRequestDigest: settlement.requestDigest,
      packDigests: internals.registry.packs
        .filter(({ provides }) => provides.commands.includes(command.id))
        .map(({ digest }) => digest)
        .sort(compareCanonicalText),
      approvalIds: [...authorization.lease.grantIds].sort(compareCanonicalText),
    },
    environment: {
      platform: runtimePlatform(),
      architecture: runtimeArchitecture(),
      nodeVersion: parseSemanticVersion(process.versions.node).value,
      projectIdentityDigest: plan.project.rootIdentityDigest,
    },
    timing: {
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: settlement.settledAt,
      durationMs: settlement.actual.durationMs,
    },
    effects: settlement.actual,
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: {
        status: "passed",
        code: parseStableId("workflow-evidence-reconciled"),
        message:
          "Complete domain evidence was accepted without replaying the uncertain target command.",
      },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts: [
      {
        artifactId: parseStableId("workflow-reconciliation-proof"),
        kind: parseStableId(plan.proof.kind),
        path: plan.proof.path,
        digest: plan.proof.digest,
        bytes: plan.proof.bytes,
        complete: true,
        createdAt: settlement.settledAt,
        commandId: WORKFLOW_RECONCILIATION_COMMAND_ID,
      },
    ],
    diagnostics: [],
    recovery: {
      attempted: true,
      outcome: "passed",
      actions: [
        "Accepted the exact stable closure proof without replaying the target mutation.",
      ],
    },
  };
  return Object.freeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
}

async function releaseLane(lane: ProjectLaneLease): Promise<void> {
  if (lane.state !== "active") return;
  try {
    await lane.release();
  } catch {
    reconciliationError(
      "pack-workflow-reconciliation-evidence-uncertain",
      "$lane.release",
      "reconciliation lane release could not be proven",
      true,
    );
  }
}

export async function dispatchPreparedPackRecoveryWorkflowReconciliation(
  value: DispatchPreparedPackRecoveryWorkflowReconciliationRequest,
): Promise<WorkflowReconciliationCommandOutput> {
  const startedAt = Date.now();
  const request = dataRecord(value, "$request");
  exactKeys(request, ["plan", "authorization", "signal"]);
  let plan: PreparedPackRecoveryWorkflowReconciliation;
  try {
    internalsForPreparedPackRecoveryWorkflowReconciliation(value.plan);
    plan = value.plan;
  } catch {
    reconciliationError(
      "pack-workflow-reconciliation-plan-untrusted",
      "$request.plan",
      "dispatch requires an original same-process reconciliation plan",
    );
  }
  if (value.signal !== null && !(value.signal instanceof AbortSignal)) {
    reconciliationError(
      "invalid-pack-recovery-request",
      "$request.signal",
      "signal must be a genuine AbortSignal or null",
    );
  }
  const authorization = validateAuthorization(plan, value.authorization);
  const internals = internalsForPreparedPackRecoveryWorkflowReconciliation(plan);
  try {
    assertNotCancelled(value.signal, authorization, startedAt);
    await assertProjectRootIdentity(internals.root);
  } catch (error) {
    if (authorization.lease.state === "active") {
      settleBeforeEvidence(authorization, "failed", false, startedAt);
    }
    throw error;
  }

  let lane: ProjectLaneLease;
  try {
    lane = await acquireProjectLane({
      root: internals.root,
      projectIdentityDigest: plan.project.identityDigest,
      runId: plan.runId,
      lane: "project-write",
      leaseDurationMs: RECONCILIATION_LANE_LEASE_MS,
      waitTimeoutMs: RECONCILIATION_LANE_WAIT_MS,
      pollIntervalMs: RECONCILIATION_LANE_POLL_MS,
      signal: value.signal,
    });
  } catch (error) {
    if (authorization.lease.state === "active") {
      settleBeforeEvidence(authorization, "failed", false, startedAt);
    }
    throw error;
  }

  let output: WorkflowReconciliationCommandOutput | undefined;
  let executionError: unknown;
  try {
    await lane.assertOwned();
    assertNotCancelled(value.signal, authorization, startedAt);
    const currentTarget = await loadTargetCheckpoint(
      internals.root,
      internals.registry,
      plan.targetRunId,
      false,
    );
    if (
      currentTarget.headDigest !== plan.target.checkpointHeadDigest ||
      currentTarget.checkpoint.checkpointDigest !==
        plan.target.checkpointDigest ||
      currentTarget.checkpoint.checkpointId !== plan.target.checkpointId
    ) {
      reconciliationError(
        "pack-workflow-reconciliation-stale",
        "$targetCheckpoint",
        "target checkpoint advanced after reconciliation preparation",
      );
    }
    const currentProof = await observeClosure(
      internals.root,
      currentTarget.checkpoint,
      internals.originalInput,
    );
    if (!sameProof(plan, currentProof)) {
      reconciliationError(
        "pack-workflow-reconciliation-stale",
        "$proof",
        "domain closure proof changed after reconciliation preparation",
      );
    }
    const currentReceipt = await observeTargetReceipt(
      internals.root,
      internals.registry,
      currentTarget.checkpoint,
      currentProof,
    );
    if (!sameReceiptObservation(plan, currentReceipt)) {
      reconciliationError(
        "pack-workflow-reconciliation-stale",
        "$targetReceipt",
        "target receipt head changed after reconciliation preparation",
      );
    }
    await lane.assertOwned();
    assertNotCancelled(value.signal, authorization, startedAt);
    const settlement = settleBeforeEvidence(
      authorization,
      "succeeded",
      false,
      startedAt,
    );
    const draftReceipt = buildReconciliationReceipt(
      plan,
      authorization,
      settlement,
    );
    const promoted = await promoteRunReceiptArtifacts({
      root: internals.root,
      registry: internals.registry,
      receipt: draftReceipt,
      maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
    });
    validateRegisteredContractValue(
      internals.registry,
      { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
      promoted.receipt,
    );
    const storedReceipt = await persistRunReceipt({
      root: internals.root,
      registry: internals.registry,
      receipt: promoted.receipt,
      maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
    });
    const commandInput = createWorkflowReconciliationCommandInput(plan);
    const reconciledCheckpoint = reconcileWorkflowEvidence({
      registry: internals.registry,
      checkpoint: currentTarget.checkpoint,
      input: commandInput,
      receipt: storedReceipt.receipt,
    });
    const targetTerminal = await persistWorkflowCheckpoint({
      root: internals.root,
      registry: internals.registry,
      checkpoint: reconciledCheckpoint,
      previous: currentTarget,
    });
    if (
      targetTerminal.checkpoint.status !== plan.targetOutcome ||
      targetTerminal.checkpoint.reconciliation?.receiptDigest !==
        storedReceipt.receipt.receiptDigest ||
      targetTerminal.checkpoint.reconciliation?.proofDigest !== plan.proof.digest
    ) {
      reconciliationError(
        "pack-workflow-reconciliation-evidence-uncertain",
        "$targetCheckpoint",
        "persisted target terminal does not agree with reconciliation evidence",
        true,
      );
    }
    const result: WorkflowReconciliationCommandOutput = Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      status: "reconciled",
      reconciliationRunId: plan.runId,
      targetRunId: plan.targetRunId,
      targetOutcome: plan.targetOutcome,
      proofKind: parseStableId(plan.proof.kind),
      proofDigest: plan.proof.digest,
      reconciliationReceiptDigest: storedReceipt.receipt.receiptDigest,
      targetCheckpointDigest: targetTerminal.checkpoint.checkpointDigest,
      targetCheckpointHeadDigest: targetTerminal.headDigest,
      mutationReplayed: false,
    });
    validateRegisteredContractValue(
      internals.registry,
      {
        schemaId: workflowReconciliationCommandOutputSchema.schemaId,
        digest: workflowReconciliationCommandOutputSchema.digest,
      },
      result,
    );
    output = result;
  } catch (error) {
    if (authorization.lease.state === "active") {
      settleBeforeEvidence(authorization, "failed", false, startedAt);
    }
    executionError =
      authorization.lease.state === "settled"
        ? error instanceof PackRuntimeError && error.mutationUncertain
          ? error
          : new PackRuntimeError(
              "pack-workflow-reconciliation-evidence-uncertain",
              "$reconciliation",
              "reconciliation stopped after authority settlement; target mutation was not replayed",
              true,
            )
        : error;
  }
  try {
    await releaseLane(lane);
  } catch (error) {
    executionError = error;
  }
  if (executionError !== undefined) throw executionError;
  if (output === undefined) {
    reconciliationError(
      "pack-workflow-reconciliation-evidence-uncertain",
      "$reconciliation",
      "reconciliation completed without a bounded output",
      true,
    );
  }
  return output;
}
