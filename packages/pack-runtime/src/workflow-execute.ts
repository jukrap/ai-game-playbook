import {
  compareCanonicalText,
  computeRunReceiptDigest,
  digestCanonicalJson,
  isStableId,
  packOperationCommandOutputSchema,
  parseSemanticVersion,
  parseStableId,
  runReceiptSchema,
  type PackOperationCommandOutput,
  type RunReceipt,
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
  type PermissionSettlement,
  type PermissionSettlementOutcome,
  type ProjectLaneLease,
} from "@ai-game-playbook/core";
import { validateRegisteredContractValue } from "@ai-game-playbook/registry";
import { randomUUID } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  createPackOperationCommandInput,
  packOperationCommandId,
  validatePackAuthorization,
} from "./authorization.js";
import { PackRuntimeError } from "./errors.js";
import { executePreparedPackOperation } from "./execute.js";
import {
  assertPreparedPackOperation,
  internalsForPreparedPackOperation,
} from "./prepared-plan.js";
import { preparePackOperation } from "./prepare.js";
import { PACK_TRANSACTION_MAX_RECORD_BYTES } from "./transaction-journal.js";
import type {
  PackChange,
  PackExecutionResult,
  PreparedPackOperation,
} from "./types.js";

const PACK_WORKFLOW_CHECKPOINT_TTL_MS = 5 * 60 * 1_000;
const PACK_LANE_LEASE_MS = 35_000;
const PACK_LANE_WAIT_MS = 5_000;
const PACK_LANE_POLL_MS = 25;
const REQUIRED_DURABLE_STORE_PATHS = Object.freeze([
  EVIDENCE_ARTIFACT_STORE_PATH,
  EVIDENCE_ARTIFACT_MANIFESTS_PATH,
  EVIDENCE_ARTIFACT_OBJECTS_PATH,
  RUN_RECEIPT_STORE_PATH,
  WORKFLOW_CHECKPOINT_STORE_PATH,
]);

export interface DispatchPreparedPackOperationRequest {
  readonly plan: PreparedPackOperation;
  readonly authorization?: AuthorizedPermissionDecision;
  readonly signal: AbortSignal | null;
}

type DataRecord = Record<string, unknown>;

function operationError(
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
    operationError(
      "invalid-pack-execution-request",
      "$request",
      "durable pack dispatch requires a plain data request",
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
    operationError(
      "invalid-pack-execution-request",
      "$request",
      "durable pack dispatch request fields are invalid",
    );
  }
}

function exactKeys(record: DataRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertSignal(signal: unknown): asserts signal is AbortSignal | null {
  if (signal !== null && !(signal instanceof AbortSignal)) {
    operationError(
      "invalid-pack-execution-request",
      "$request.signal",
      "signal must be a genuine AbortSignal or null",
    );
  }
}

function assertNotCancelled(signal: AbortSignal | null): void {
  if (signal?.aborted === true) {
    operationError(
      "pack-operation-cancelled",
      "$request.signal",
      "pack operation was cancelled before the next durable boundary",
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
    operationError(
      "pack-execution-uncertain",
      "$request.authorization",
      "pre-mutation authorization could not be settled safely",
      true,
    );
  }
}

async function revalidatePlan(plan: PreparedPackOperation): Promise<void> {
  const internals = internalsForPreparedPackOperation(plan);
  let refreshed: PreparedPackOperation;
  try {
    refreshed = await preparePackOperation({
      operation: plan.operation,
      registry: internals.registry,
      targetRoot: internals.targetRoot,
      ...(internals.sourceRoot === undefined
        ? {}
        : { sourceRoot: internals.sourceRoot }),
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      ...(plan.workflow === undefined
        ? {}
        : {
            workflow: {
              id: plan.workflow.id,
              stepId: plan.workflow.stepId,
              projectStage: plan.workflow.projectStage,
            },
          }),
      runId: plan.runId,
      packId: plan.pack.id,
      limits: plan.limits,
    });
  } catch {
    operationError(
      "pack-plan-not-executable",
      "$request.plan",
      "prepared pack plan could not be revalidated",
    );
  }
  if (refreshed.planDigest !== plan.planDigest) {
    operationError(
      "pack-plan-not-executable",
      "$request.plan",
      "prepared pack plan changed before durable admission",
    );
  }
}

async function assertDurableStoresReady(
  root: ReturnType<typeof internalsForPreparedPackOperation>["targetRoot"],
): Promise<void> {
  for (const path of REQUIRED_DURABLE_STORE_PATHS) {
    try {
      await resolveProjectPath(root, path, {
        expectedType: "directory",
        existence: "required",
      });
    } catch {
      operationError(
        "pack-plan-not-executable",
        path,
        "required durable pack evidence storage is unavailable",
      );
    }
  }
}

function runtimePlatform(): "windows" | "linux" | "macos" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  operationError(
    "pack-execution-failed",
    "$environment.platform",
    "current platform cannot be represented in a run receipt",
  );
}

function runtimeArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  operationError(
    "pack-execution-failed",
    "$environment.architecture",
    "current architecture cannot be represented in a run receipt",
  );
}

function resultStatus(result: PackExecutionResult): RunReceipt["status"] {
  if (result.status === "succeeded") return "succeeded";
  if (result.status === "recovery-required") return "uncertain";
  return "failed";
}

function mutationStatus(
  result: PackExecutionResult,
): RunReceipt["mutation"]["status"] {
  if (result.status === "succeeded") {
    return result.effects.changedPaths.length === 0 ? "none" : "committed";
  }
  if (result.status === "rolled-back") return "rolled-back";
  if (result.status === "recovery-required") return "uncertain";
  return "none";
}

function stableOutcomeCode(result: PackExecutionResult): ReturnType<typeof parseStableId> {
  const candidate =
    result.status === "succeeded"
      ? "pack-add-succeeded"
      : result.status === "rolled-back"
        ? "pack-add-rolled-back"
        : result.status === "recovery-required"
          ? "pack-add-recovery-required"
          : result.status === "no-op"
            ? "pack-add-no-op"
            : result.error?.code;
  return isStableId(candidate) ? candidate : parseStableId("pack-add-failed");
}

function changedFiles(
  plan: PreparedPackOperation,
  result: PackExecutionResult,
): RunReceipt["mutation"]["changedFiles"] {
  const byPath = new Map<string, PackChange>(
    plan.changes.map((change) => [change.path, change]),
  );
  return result.effects.changedPaths.map((path) => {
    const change = byPath.get(path);
    const committed = result.status === "succeeded";
    return Object.freeze({
      path,
      ...(change?.kind === "replace" || change?.kind === "delete"
        ? { preimageDigest: change.beforeDigest }
        : {}),
      ...(committed &&
      change !== undefined &&
      (change.kind === "create" || change.kind === "replace")
        ? { postimageDigest: change.afterDigest }
        : {}),
      bytesDelta:
        committed &&
        change !== undefined &&
        (change.kind === "create" || change.kind === "replace")
          ? change.bytes
          : 0,
    });
  });
}

function transactionArtifacts(
  result: Exclude<PackExecutionResult, { readonly status: "no-op" }>,
  settlement: PermissionSettlement,
  commandId: ReturnType<typeof parseStableId>,
): RunReceipt["artifacts"] {
  const digest = result.transaction.terminalRecordFileDigest;
  const bytes = result.transaction.terminalRecordBytes;
  if ((digest === undefined) !== (bytes === undefined)) {
    operationError(
      "pack-execution-uncertain",
      "$result.transaction",
      "terminal pack evidence is only partially attested",
      true,
    );
  }
  if (digest === undefined || bytes === undefined) return [];
  return Object.freeze([
    Object.freeze({
      artifactId: parseStableId("pack-transaction-terminal"),
      kind: parseStableId("pack-transaction"),
      path: result.transaction.terminalRecordPath,
      digest,
      bytes,
      complete: true,
      createdAt: settlement.settledAt,
      commandId,
    }),
  ]);
}

function buildReceipt(
  plan: PreparedPackOperation,
  checkpoint: WorkflowCheckpointRecord,
  result: Exclude<PackExecutionResult, { readonly status: "no-op" }>,
  settlement: PermissionSettlement,
): RunReceipt {
  const inFlight = checkpoint.inFlight;
  if (inFlight === undefined) {
    operationError(
      "pack-execution-uncertain",
      "$checkpoint.inFlight",
      "started pack checkpoint lost its command binding",
      true,
    );
  }
  const endedAtMs = Date.parse(settlement.settledAt);
  const startedAtMs = endedAtMs - settlement.actual.durationMs;
  const status = resultStatus(result);
  const innerStatus =
    status === "succeeded" ? "passed" : status === "uncertain" ? "uncertain" : "failed";
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
      packDigests: internalsForPreparedPackOperation(plan).registry.packs
        .filter(({ provides }) => provides.commands.includes(inFlight.command.id))
        .map(({ digest }) => digest)
        .sort(compareCanonicalText),
      approvalIds: [...inFlight.approvalIds].sort(compareCanonicalText),
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
        status: innerStatus,
        code: stableOutcomeCode(result),
        message:
          status === "succeeded"
            ? "Managed pack installation completed and was verified."
            : status === "uncertain"
              ? "Managed pack installation stopped with unresolved mutation state."
              : result.status === "rolled-back"
                ? "Managed pack installation failed and confirmed mutations were rolled back."
                : "Managed pack installation failed within its bounded transaction.",
      },
    },
    mutation: {
      status: mutationStatus(result),
      changedFiles: changedFiles(plan, result),
      unexpectedDirtyFiles: [],
    },
    artifacts: transactionArtifacts(result, settlement, inFlight.command.id),
    diagnostics:
      status === "succeeded"
        ? []
        : [
            {
              severity: status === "uncertain" ? "error" : "warning",
              code: stableOutcomeCode(result),
              message:
                "The managed pack outcome requires the recorded terminal handling.",
              redacted: true,
            },
          ],
    recovery:
      result.status === "rolled-back"
        ? {
            attempted: true,
            outcome: "passed",
            actions: ["Reversed every confirmed managed pack mutation."],
          }
        : result.status === "recovery-required"
          ? {
              attempted: true,
              outcome: "uncertain",
              actions: ["Retained the pack and workflow recovery barriers."],
            }
          : { attempted: false, outcome: "not-run", actions: [] },
  };
  return Object.freeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
}

function commandOutput(result: PackExecutionResult): PackOperationCommandOutput {
  return Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    status: result.status,
    planDigest: result.planDigest,
  });
}

function expectedTerminalStatus(
  result: Exclude<PackExecutionResult, { readonly status: "no-op" }>,
): "failed" | "succeeded" | "uncertain" {
  if (result.status === "succeeded") return "succeeded";
  if (result.status === "recovery-required") return "uncertain";
  return "failed";
}

async function releaseLane(lane: ProjectLaneLease): Promise<void> {
  if (lane.state !== "active") return;
  try {
    await lane.release();
  } catch {
    operationError(
      "pack-execution-uncertain",
      "$lane.release",
      "pack workflow could not release its project lane",
      true,
    );
  }
}

export async function dispatchPreparedPackOperation(
  value: DispatchPreparedPackOperationRequest,
): Promise<PackOperationCommandOutput> {
  const startedAt = Date.now();
  const record = requestRecord(value);
  if (!Object.hasOwn(record, "plan")) {
    operationError(
      "invalid-pack-execution-request",
      "$request.plan",
      "durable pack dispatch requires a prepared plan",
    );
  }
  let plan: PreparedPackOperation;
  try {
    assertPreparedPackOperation(record["plan"]);
    plan = record["plan"] as PreparedPackOperation;
  } catch {
    operationError(
      "pack-plan-untrusted",
      "$request.plan",
      "durable pack dispatch requires a same-process prepared plan",
    );
  }
  const noOp = plan.disposition === "no-op";
  const expectedKeys = noOp
    ? ["plan", "signal"]
    : ["plan", "authorization", "signal"];
  if (!exactKeys(record, expectedKeys)) {
    operationError(
      "invalid-pack-execution-request",
      "$request",
      noOp
        ? "no-op pack dispatch accepts no mutation authority"
        : "ready pack dispatch requires exact authorization fields",
    );
  }
  assertSignal(record["signal"]);
  const signal = record["signal"];
  if (plan.disposition === "conflicted") {
    operationError(
      "pack-plan-conflicted",
      "$request.plan",
      "a conflicted pack plan cannot enter durable dispatch",
    );
  }
  const { registry, targetRoot } = internalsForPreparedPackOperation(plan);
  if (noOp) {
    assertNotCancelled(signal);
    const result = await executePreparedPackOperation({ plan, signal });
    const output = commandOutput(result);
    validateRegisteredContractValue(
      registry,
      {
        schemaId: packOperationCommandOutputSchema.schemaId,
        digest: packOperationCommandOutputSchema.digest,
      },
      output,
    );
    return output;
  }
  if (plan.workflow === undefined) {
    operationError(
      "pack-plan-not-executable",
      "$request.plan",
      "durable pack dispatch requires a workflow-bound project stage",
    );
  }
  const validated = validatePackAuthorization(plan, record["authorization"]);
  try {
    assertNotCancelled(signal);
    await assertProjectRootIdentity(targetRoot);
    await assertDurableStoresReady(targetRoot);
    await revalidatePlan(plan);
    assertNotCancelled(signal);
  } catch (error) {
    settleBeforeMutation(validated.authorization, "failed", false, startedAt);
    throw error;
  }

  let lane: ProjectLaneLease;
  try {
    lane = await acquireProjectLane({
      root: targetRoot,
      projectIdentityDigest: plan.project.identityDigest,
      runId: plan.runId,
      lane: "project-write",
      leaseDurationMs: PACK_LANE_LEASE_MS,
      waitTimeoutMs: PACK_LANE_WAIT_MS,
      pollIntervalMs: PACK_LANE_POLL_MS,
      signal,
    });
  } catch (error) {
    settleBeforeMutation(validated.authorization, "failed", false, startedAt);
    throw error;
  }

  let output: PackOperationCommandOutput | undefined;
  let executionError: unknown;
  try {
    await lane.assertOwned();
    assertNotCancelled(signal);
    const initial = await persistWorkflowCheckpoint({
      root: targetRoot,
      registry,
      checkpoint: createWorkflowCheckpoint({
        registry,
        workflowId: plan.workflow.id,
        project: {
          id: plan.project.id,
          identityDigest: plan.project.identityDigest,
          rootIdentityDigest: plan.project.rootIdentityDigest,
          stage: plan.workflow.projectStage,
        },
        runId: plan.runId,
        inputDigest: digestCanonicalJson(createPackOperationCommandInput(plan)),
        ttlMs: PACK_WORKFLOW_CHECKPOINT_TTL_MS,
      }),
    });
    let execution: Exclude<PackExecutionResult, { readonly status: "no-op" }> | undefined;
    const executor = bindWorkflowStepExecutor({
      registry,
      commandId: packOperationCommandId(plan.operation),
      invoke: async ({ authorization, checkpoint, lane: ownedLane, signal: dispatchSignal }) => {
        const result = await executePreparedPackOperation({
          plan,
          authorization,
          lane: ownedLane,
          signal: dispatchSignal,
        });
        if (result.status === "no-op") {
          operationError(
            "pack-execution-uncertain",
            "$executor",
            "a ready durable pack plan produced an unexpected no-op",
            true,
          );
        }
        execution = result;
        const draftReceipt = buildReceipt(
          plan,
          checkpoint,
          result,
          result.settlement,
        );
        const promoted = await promoteRunReceiptArtifacts({
          root: targetRoot,
          registry,
          receipt: draftReceipt,
          maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
        });
        const receipt = promoted.receipt;
        validateRegisteredContractValue(
          registry,
          { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
          receipt,
        );
        return { receipt, settlement: result.settlement };
      },
    });
    const dispatched = await dispatchProjectWorkflowStep({
      root: targetRoot,
      registry,
      stored: initial,
      authorization: validated.authorization,
      lane,
      executor,
      signal,
      maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
    });
    if (execution === undefined) {
      operationError(
        "pack-execution-uncertain",
        "$dispatcher",
        "pack dispatcher completed without its domain result",
        true,
      );
    }
    if (
      dispatched.terminal.checkpoint.status !==
      expectedTerminalStatus(execution)
    ) {
      operationError(
        "pack-execution-uncertain",
        "$dispatcher.terminal",
        "pack outcome and durable workflow terminal state disagree",
        true,
      );
    }
    output = commandOutput(execution);
    validateRegisteredContractValue(
      registry,
      {
        schemaId: packOperationCommandOutputSchema.schemaId,
        digest: packOperationCommandOutputSchema.digest,
      },
      output,
    );
  } catch (error) {
    executionError = error;
    if (validated.authorization.lease.state === "active") {
      settleBeforeMutation(validated.authorization, "uncertain", true, startedAt);
    }
  }

  await releaseLane(lane);
  if (executionError !== undefined) throw executionError;
  return output!;
}
