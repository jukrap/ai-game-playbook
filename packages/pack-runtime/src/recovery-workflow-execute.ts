import {
  PACK_RECOVERY_COMMAND_ID,
  computeRunReceiptDigest,
  digestCanonicalJson,
  isStableId,
  packRecoveryCommandOutputSchema,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  sha256Digest,
  type PackRecoveryCommandOutput,
  type RunReceipt,
  type Sha256Digest,
  type WorkflowCheckpointRecord,
} from "@ai-game-playbook/contracts";
import {
  acquireProjectLane,
  assertProjectRootIdentity,
  bindWorkflowStepExecutor,
  createWorkflowCheckpoint,
  dispatchProjectWorkflowStep,
  EVIDENCE_ARTIFACT_MANIFESTS_PATH,
  EVIDENCE_ARTIFACT_OBJECTS_PATH,
  EVIDENCE_ARTIFACT_STORE_PATH,
  persistWorkflowCheckpoint,
  promoteRunReceiptArtifacts,
  resolveProjectPath,
  RUN_RECEIPT_STORE_PATH,
  WORKFLOW_CHECKPOINT_STORE_PATH,
  type AuthorizedPermissionDecision,
  type PermissionActualEffects,
  type PermissionSettlementOutcome,
  type ProjectLaneLease,
} from "@ai-game-playbook/core";
import { validateRegisteredContractValue } from "@ai-game-playbook/registry";
import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";

import { PACK_ACTIVE_TRANSACTION_PATH } from "./active-transaction.js";
import { assertPackAuthorizationActive } from "./authorization.js";
import { PackRuntimeError } from "./errors.js";
import {
  finalizePackTransactionRecovery,
  type PackRecoveryFinalizationResult,
} from "./finalize-recovery.js";
import {
  createPackRecoveryCommandInput,
  internalsForPreparedPackRecoveryFinalization,
  type PreparedPackRecoveryFinalization,
} from "./recovery-plan.js";
import { validatePackRecoveryAuthorization } from "./recovery-authorization.js";
import { inspectPackTransactionRecovery } from "./recovery.js";
import {
  loadPackTransactionJournal,
  packTransactionRecordPath,
  PACK_TRANSACTION_MAX_RECORD_BYTES,
  serializePackTransactionRecord,
  type PackTransactionRecord,
} from "./transaction-journal.js";

const PACK_RECOVERY_CHECKPOINT_TTL_MS = 5 * 60 * 1_000;
const PACK_RECOVERY_LANE_LEASE_MS = 35_000;
const PACK_RECOVERY_LANE_WAIT_MS = 5_000;
const PACK_RECOVERY_LANE_POLL_MS = 25;
const REQUIRED_DURABLE_STORE_PATHS = Object.freeze([
  EVIDENCE_ARTIFACT_STORE_PATH,
  EVIDENCE_ARTIFACT_MANIFESTS_PATH,
  EVIDENCE_ARTIFACT_OBJECTS_PATH,
  RUN_RECEIPT_STORE_PATH,
  WORKFLOW_CHECKPOINT_STORE_PATH,
]);

export interface DispatchPreparedPackRecoveryFinalizationRequest {
  readonly plan: PreparedPackRecoveryFinalization;
  readonly authorization: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

interface RecoveryClosureEvidence {
  readonly path: string;
  readonly recordDigest: Sha256Digest;
  readonly fileDigest: Sha256Digest;
  readonly bytes: number;
}

type DataRecord = Record<string, unknown>;

function recoveryError(
  code: ConstructorParameters<typeof PackRuntimeError>[0],
  path: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new PackRuntimeError(code, path, message, mutationUncertain);
}

function requestRecord(value: unknown): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    recoveryError(
      "invalid-pack-recovery-request",
      "$request",
      "durable recovery dispatch requires a plain data request",
    );
  }
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw new TypeError("request is not plain data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("request fields are not enumerable data properties");
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(descriptors).map(([key, descriptor]) => [
          key,
          descriptor.value,
        ]),
      ),
    );
  } catch (error) {
    if (error instanceof PackRuntimeError) throw error;
    recoveryError(
      "invalid-pack-recovery-request",
      "$request",
      "durable recovery request fields are invalid",
    );
  }
}

function exactKeys(record: DataRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertSignal(signal: unknown): asserts signal is AbortSignal | null {
  if (signal !== null && !(signal instanceof AbortSignal)) {
    recoveryError(
      "invalid-pack-recovery-request",
      "$request.signal",
      "signal must be a genuine AbortSignal or null",
    );
  }
}

function assertNotCancelled(signal: AbortSignal | null): void {
  if (signal?.aborted === true) {
    recoveryError(
      "pack-operation-cancelled",
      "$request.signal",
      "pack recovery was cancelled before the next durable boundary",
    );
  }
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

function settleBeforeMutation(
  authorization: AuthorizedPermissionDecision,
  outcome: PermissionSettlementOutcome,
  mutationUncertain: boolean,
  startedAt: number,
): void {
  if (authorization.lease.state !== "active") return;
  try {
    authorization.lease.settle({
      outcome,
      mutationUncertain,
      actual: emptyEffects(Math.max(0, Date.now() - startedAt)),
    });
  } catch {
    recoveryError(
      "pack-execution-uncertain",
      "$request.authorization",
      "pre-mutation recovery authority could not be settled safely",
      true,
    );
  }
}

async function assertDurableStoresReady(
  root: ReturnType<
    typeof internalsForPreparedPackRecoveryFinalization
  >["reportInternals"]["root"],
): Promise<void> {
  for (const path of REQUIRED_DURABLE_STORE_PATHS) {
    try {
      await resolveProjectPath(root, path, {
        expectedType: "directory",
        existence: "required",
      });
    } catch {
      recoveryError(
        "pack-plan-not-executable",
        path,
        "required durable recovery evidence storage is unavailable",
      );
    }
  }
}

async function revalidatePlan(
  plan: PreparedPackRecoveryFinalization,
): Promise<void> {
  const internals = internalsForPreparedPackRecoveryFinalization(plan);
  let report;
  try {
    report = await inspectPackTransactionRecovery({
      root: internals.reportInternals.root,
      runId: plan.transactionRunId,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      maxDirectoryEntries:
        internals.reportInternals.journal.started.limits.maxDirectoryEntries,
    });
  } catch {
    recoveryError(
      "pack-plan-not-executable",
      "$request.plan",
      "recovery report could not be revalidated before durable admission",
    );
  }
  if (
    report.reportDigest !== plan.reportDigest ||
    report.journalSnapshotDigest !== plan.journalSnapshotDigest ||
    report.finalizationAction !== plan.action ||
    report.finalizationOutcome !== plan.finalOutcome
  ) {
    recoveryError(
      "pack-recovery-stale",
      "$request.plan",
      "recovery state changed before durable admission",
    );
  }
}

function runtimePlatform(): "windows" | "linux" | "macos" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  recoveryError(
    "pack-execution-failed",
    "$environment.platform",
    "current platform cannot be represented in a run receipt",
  );
}

function runtimeArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  recoveryError(
    "pack-execution-failed",
    "$environment.architecture",
    "current architecture cannot be represented in a run receipt",
  );
}

function receiptStatus(
  result: PackRecoveryFinalizationResult,
): RunReceipt["status"] {
  if (result.status === "finalized") return "succeeded";
  if (
    result.status === "recovery-required" ||
    result.mutationUncertain ||
    result.effects.changedPaths.length > 0
  ) {
    return "uncertain";
  }
  return "failed";
}

function stableOutcomeCode(
  result: PackRecoveryFinalizationResult,
): ReturnType<typeof parseStableId> {
  const candidate =
    result.status === "finalized"
      ? "pack-recovery-finalized"
      : result.status === "recovery-required"
        ? "pack-recovery-required"
        : result.status === "stale"
          ? "pack-recovery-stale"
          : result.error?.code;
  return isStableId(candidate)
    ? candidate
    : parseStableId("pack-recovery-failed");
}

function selectedClosureRecord(
  plan: PreparedPackRecoveryFinalization,
  journal: Awaited<ReturnType<typeof loadPackTransactionJournal>>,
): PackTransactionRecord | undefined {
  if (plan.action === "append-reconciliation") {
    return journal.reconciliation;
  }
  return journal.reconciliation ?? journal.terminal;
}

async function loadClosureEvidence(
  plan: PreparedPackRecoveryFinalization,
  result: PackRecoveryFinalizationResult,
): Promise<RecoveryClosureEvidence | undefined> {
  if (result.status !== "finalized") return undefined;
  const internals = internalsForPreparedPackRecoveryFinalization(plan);
  const journal = await loadPackTransactionJournal({
    root: internals.reportInternals.root,
    runId: plan.transactionRunId,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
    },
    maxDirectoryEntries:
      internals.reportInternals.journal.started.limits.maxDirectoryEntries,
  });
  const record = selectedClosureRecord(plan, journal);
  if (record === undefined) {
    recoveryError(
      "pack-execution-uncertain",
      "$result.journal",
      "finalized recovery has no durable closure record",
      true,
    );
  }
  if (
    result.journalRecordDigest !== undefined &&
    result.journalRecordDigest !== record.recordDigest
  ) {
    recoveryError(
      "pack-execution-uncertain",
      "$result.journalRecordDigest",
      "recovery result and durable closure record disagree",
      true,
    );
  }
  const content = serializePackTransactionRecord(record);
  return Object.freeze({
    path: packTransactionRecordPath(plan.transactionRunId, record.sequence),
    recordDigest: record.recordDigest,
    fileDigest: sha256Digest(content),
    bytes: content.byteLength,
  });
}

function changedFiles(
  plan: PreparedPackRecoveryFinalization,
  result: PackRecoveryFinalizationResult,
  evidence: RecoveryClosureEvidence | undefined,
): RunReceipt["mutation"]["changedFiles"] {
  const internals = internalsForPreparedPackRecoveryFinalization(plan);
  const active = internals.reportInternals.active;
  return result.effects.changedPaths.map((path) => {
    if (path === PACK_ACTIVE_TRANSACTION_PATH && active !== undefined) {
      return Object.freeze({
        path,
        preimageDigest: active.fileDigest,
        bytesDelta: -active.bytes,
      });
    }
    if (path === evidence?.path) {
      return Object.freeze({
        path,
        postimageDigest: evidence.fileDigest,
        bytesDelta: evidence.bytes,
      });
    }
    return Object.freeze({ path, bytesDelta: 0 });
  });
}

function buildReceipt(
  plan: PreparedPackRecoveryFinalization,
  checkpoint: WorkflowCheckpointRecord,
  result: PackRecoveryFinalizationResult,
  evidence: RecoveryClosureEvidence | undefined,
): RunReceipt {
  const inFlight = checkpoint.inFlight;
  if (inFlight === undefined) {
    recoveryError(
      "pack-execution-uncertain",
      "$checkpoint.inFlight",
      "started recovery checkpoint lost its command binding",
      true,
    );
  }
  const status = receiptStatus(result);
  const settlement = result.settlement;
  const endedAtMs = Date.parse(settlement.settledAt);
  const startedAtMs = endedAtMs - settlement.actual.durationMs;
  const body: Omit<RunReceipt, "receiptDigest"> = {
    schemaVersion: parseSemanticVersion("1.0.0").value,
    receiptId: randomUUID(),
    ...(checkpoint.receiptChainHead === undefined
      ? {}
      : { previousReceiptDigest: checkpoint.receiptChainHead }),
    status,
    identity: {
      runId: checkpoint.identity.runId,
      workflowId: checkpoint.identity.workflow.id,
      stepId: inFlight.stepId,
      attempt: inFlight.attempt,
      phase: inFlight.phase,
      projectId: checkpoint.identity.projectId,
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: inFlight.command.id,
        version: inFlight.command.version,
        descriptorDigest: inFlight.command.descriptorDigest,
      },
      registryDigest: checkpoint.identity.registryDigest,
      handlerDigest: inFlight.command.handlerDigest,
      inputDigest: inFlight.inputDigest,
      authorizationId: inFlight.authorizationId,
      authorizationRequestDigest: inFlight.authorizationRequestDigest,
      packDigests: internalsForPreparedPackRecoveryFinalization(plan).registry.packs
        .filter(({ provides }) =>
          provides.commands.includes(inFlight.command.id),
        )
        .map(({ digest }) => digest)
        .sort(),
      approvalIds: [...inFlight.approvalIds].sort(),
    },
    environment: {
      platform: runtimePlatform(),
      architecture: runtimeArchitecture(),
      nodeVersion: parseSemanticVersion(process.versions.node).value,
      projectIdentityDigest: plan.project.rootIdentityDigest,
    },
    timing: {
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: settlement.actual.durationMs,
    },
    effects: settlement.actual,
    outcomes: {
      outer:
        status === "succeeded"
          ? { status: "passed", exitCode: 0, timedOut: false }
          : status === "uncertain"
            ? { status: "uncertain", timedOut: false }
            : { status: "failed", exitCode: 1, timedOut: false },
      inner: {
        status:
          status === "succeeded"
            ? "passed"
            : status === "uncertain"
              ? "uncertain"
              : "failed",
        code: stableOutcomeCode(result),
        message:
          result.status === "finalized"
            ? "Managed pack recovery closed the exact transaction and verified its final state."
            : result.status === "stale"
              ? "Managed pack recovery stopped because the approved transaction state changed."
              : result.status === "recovery-required"
                ? "Managed pack recovery retained an unresolved mutation state without retry."
                : "Managed pack recovery failed within its bounded closure.",
      },
    },
    mutation: {
      status:
        status === "succeeded"
          ? "committed"
          : status === "uncertain"
            ? "uncertain"
            : "none",
      changedFiles: changedFiles(plan, result, evidence),
      unexpectedDirtyFiles: [],
    },
    artifacts:
      evidence === undefined
        ? []
        : [
            {
              artifactId: parseStableId("pack-recovery-closure"),
              kind: parseStableId("pack-recovery"),
              path: evidence.path,
              digest: evidence.fileDigest,
              bytes: evidence.bytes,
              complete: true,
              createdAt: settlement.settledAt,
              commandId: PACK_RECOVERY_COMMAND_ID,
            },
          ],
    diagnostics:
      status === "succeeded"
        ? []
        : [
            {
              severity: status === "uncertain" ? "error" : "warning",
              code: stableOutcomeCode(result),
              message:
                "The managed pack recovery outcome requires the retained recovery evidence.",
              redacted: true,
            },
          ],
    recovery: {
      attempted: true,
      outcome:
        status === "succeeded"
          ? "passed"
          : status === "uncertain"
            ? "uncertain"
            : "failed",
      actions: [
        result.status === "finalized"
          ? "Closed the approved pack transaction without artifact repair."
          : "Stopped without automatic retry.",
      ],
    },
  };
  return Object.freeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
}

function expectedTerminalStatus(
  result: PackRecoveryFinalizationResult,
): "failed" | "succeeded" | "uncertain" {
  const status = receiptStatus(result);
  if (status === "succeeded") return "succeeded";
  if (status === "uncertain") return "uncertain";
  return "failed";
}

function commandOutput(
  plan: PreparedPackRecoveryFinalization,
  result: PackRecoveryFinalizationResult,
  evidence: RecoveryClosureEvidence | undefined,
  receiptDigest: Sha256Digest,
): PackRecoveryCommandOutput {
  if (result.status === "finalized" && evidence === undefined) {
    recoveryError(
      "pack-execution-uncertain",
      "$result.evidence",
      "finalized recovery cannot return without closure evidence",
      true,
    );
  }
  return Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    status: result.status,
    recoveryRunId: plan.runId,
    transactionRunId: plan.transactionRunId,
    action: plan.action,
    finalOutcome: plan.finalOutcome,
    reportDigest: result.reportDigest,
    ...(result.finalReportDigest === undefined
      ? {}
      : { finalReportDigest: result.finalReportDigest }),
    ...(evidence === undefined
      ? result.journalRecordDigest === undefined
        ? {}
        : { journalRecordDigest: result.journalRecordDigest }
      : { journalRecordDigest: evidence.recordDigest }),
    planDigest: plan.planDigest,
    receiptDigest,
    mutationUncertain: result.mutationUncertain,
  });
}

async function releaseLane(lane: ProjectLaneLease): Promise<void> {
  if (lane.state !== "active") return;
  try {
    await lane.release();
  } catch {
    recoveryError(
      "pack-execution-uncertain",
      "$lane.release",
      "pack recovery workflow could not release its project lane",
      true,
    );
  }
}

export async function dispatchPreparedPackRecoveryFinalization(
  value: DispatchPreparedPackRecoveryFinalizationRequest,
): Promise<PackRecoveryCommandOutput> {
  const startedAt = Date.now();
  const record = requestRecord(value);
  if (!exactKeys(record, ["plan", "authorization", "signal"])) {
    recoveryError(
      "invalid-pack-recovery-request",
      "$request",
      "durable recovery dispatch requires exact plan, authorization, and signal fields",
    );
  }
  let plan: PreparedPackRecoveryFinalization;
  try {
    internalsForPreparedPackRecoveryFinalization(record["plan"] as PreparedPackRecoveryFinalization);
    plan = record["plan"] as PreparedPackRecoveryFinalization;
  } catch {
    recoveryError(
      "pack-recovery-plan-untrusted",
      "$request.plan",
      "durable recovery dispatch requires a same-process prepared plan",
    );
  }
  assertSignal(record["signal"]);
  const signal = record["signal"];
  const validated = validatePackRecoveryAuthorization(
    plan,
    record["authorization"],
  );
  const internals = internalsForPreparedPackRecoveryFinalization(plan);
  try {
    assertNotCancelled(signal);
    await assertProjectRootIdentity(internals.reportInternals.root);
    await assertDurableStoresReady(internals.reportInternals.root);
    await revalidatePlan(plan);
    assertPackAuthorizationActive(validated.authorization);
    assertNotCancelled(signal);
  } catch (error) {
    settleBeforeMutation(validated.authorization, "failed", false, startedAt);
    throw error;
  }

  let lane: ProjectLaneLease;
  try {
    lane = await acquireProjectLane({
      root: internals.reportInternals.root,
      projectIdentityDigest: plan.project.identityDigest,
      runId: plan.runId,
      lane: "project-write",
      leaseDurationMs: PACK_RECOVERY_LANE_LEASE_MS,
      waitTimeoutMs: PACK_RECOVERY_LANE_WAIT_MS,
      pollIntervalMs: PACK_RECOVERY_LANE_POLL_MS,
      signal,
    });
  } catch (error) {
    settleBeforeMutation(validated.authorization, "failed", false, startedAt);
    throw error;
  }

  let output: PackRecoveryCommandOutput | undefined;
  let executionError: unknown;
  try {
    await lane.assertOwned();
    assertNotCancelled(signal);
    const initial = await persistWorkflowCheckpoint({
      root: internals.reportInternals.root,
      registry: internals.registry,
      checkpoint: createWorkflowCheckpoint({
        registry: internals.registry,
        workflowId: plan.workflow.id,
        project: {
          id: plan.project.id,
          identityDigest: plan.project.identityDigest,
          rootIdentityDigest: plan.project.rootIdentityDigest,
          stage: plan.workflow.projectStage,
        },
        runId: plan.runId,
        inputDigest: digestCanonicalJson(createPackRecoveryCommandInput(plan)),
        ttlMs: PACK_RECOVERY_CHECKPOINT_TTL_MS,
      }),
    });
    let execution: PackRecoveryFinalizationResult | undefined;
    let closureEvidence: RecoveryClosureEvidence | undefined;
    const executor = bindWorkflowStepExecutor({
      registry: internals.registry,
      commandId: PACK_RECOVERY_COMMAND_ID,
      invoke: async ({ authorization, checkpoint, lane: ownedLane }) => {
        const result = await finalizePackTransactionRecovery({
          plan,
          authorization,
          lane: ownedLane,
        });
        execution = result;
        closureEvidence = await loadClosureEvidence(plan, result);
        const draftReceipt = buildReceipt(
          plan,
          checkpoint,
          result,
          closureEvidence,
        );
        const promoted = await promoteRunReceiptArtifacts({
          root: internals.reportInternals.root,
          registry: internals.registry,
          receipt: draftReceipt,
          maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
        });
        validateRegisteredContractValue(
          internals.registry,
          { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
          promoted.receipt,
        );
        return { receipt: promoted.receipt, settlement: result.settlement };
      },
    });
    const dispatched = await dispatchProjectWorkflowStep({
      root: internals.reportInternals.root,
      registry: internals.registry,
      stored: initial,
      authorization: validated.authorization,
      lane,
      executor,
      signal,
      maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
    });
    if (execution === undefined) {
      recoveryError(
        "pack-execution-uncertain",
        "$dispatcher",
        "recovery dispatcher completed without its domain result",
        true,
      );
    }
    if (
      dispatched.terminal.checkpoint.status !==
      expectedTerminalStatus(execution)
    ) {
      recoveryError(
        "pack-execution-uncertain",
        "$dispatcher.terminal",
        "recovery outcome and durable workflow terminal state disagree",
        true,
      );
    }
    output = commandOutput(
      plan,
      execution,
      closureEvidence,
      dispatched.receipt.receipt.receiptDigest,
    );
    validateRegisteredContractValue(
      internals.registry,
      {
        schemaId: packRecoveryCommandOutputSchema.schemaId,
        digest: packRecoveryCommandOutputSchema.digest,
      },
      output,
    );
  } catch (error) {
    executionError = error;
    if (validated.authorization.lease.state === "active") {
      settleBeforeMutation(
        validated.authorization,
        "uncertain",
        true,
        startedAt,
      );
    }
  }

  await releaseLane(lane);
  if (executionError !== undefined) throw executionError;
  if (output === undefined) {
    recoveryError(
      "pack-execution-uncertain",
      "$dispatcher.output",
      "recovery dispatcher did not produce a validated output",
      true,
    );
  }
  return output;
}
