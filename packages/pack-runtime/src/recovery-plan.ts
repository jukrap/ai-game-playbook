import {
  PACK_RECOVERY_COMMAND_ID,
  PACK_RECOVERY_WORKFLOW_ID,
  PACK_RECOVERY_WORKFLOW_STEP_ID,
  PROJECT_STAGES,
  compareCanonicalText,
  digestCanonicalJson,
  packRecoveryCommandInputSchema,
  packRecoveryCommandOutputSchema,
  parseSemanticVersion,
  type PackRecoveryCommandInput,
  type ProjectStage,
  type ResolvedWorkflowPlan,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  resolveWorkflowPlan,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { PACK_ACTIVE_TRANSACTION_PATH } from "./active-transaction.js";
import { PackRuntimeError } from "./errors.js";
import {
  internalsForPackTransactionRecoveryReport,
  type PackRecoveryFinalizationAction,
  type PackRecoveryFinalizationOutcome,
  type PackTransactionRecoveryReport,
} from "./recovery.js";
import { packTransactionRecordPath } from "./transaction-journal.js";

type MutableRecord = Record<string, unknown>;

export type ActionablePackRecoveryFinalization = Exclude<
  PackRecoveryFinalizationAction,
  "blocked" | "none"
>;

export interface PreparedPackRecoveryFinalization {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly transactionRunId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly journalSnapshotDigest: Sha256Digest;
  readonly workflow: {
    readonly id: typeof PACK_RECOVERY_WORKFLOW_ID;
    readonly stepId: typeof PACK_RECOVERY_WORKFLOW_STEP_ID;
    readonly projectStage: ProjectStage;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly action: ActionablePackRecoveryFinalization;
  readonly finalOutcome: PackRecoveryFinalizationOutcome;
  readonly paths: readonly string[];
  readonly planDigest: Sha256Digest;
}

export interface PreparePackRecoveryFinalizationRequest {
  readonly report: PackTransactionRecoveryReport;
  readonly registry: ValidatedRegistry;
  readonly runId: string;
  readonly projectStage: ProjectStage;
}

interface PackRecoveryFinalizationInternals {
  readonly report: PackTransactionRecoveryReport;
  readonly registry: ValidatedRegistry;
  readonly workflowPlan: ResolvedWorkflowPlan;
  readonly reportInternals: ReturnType<
    typeof internalsForPackTransactionRecoveryReport
  >;
}

const finalizationInternals = new WeakMap<
  PreparedPackRecoveryFinalization,
  PackRecoveryFinalizationInternals
>();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: MutableRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalid(path: string, message: string): never {
  throw new PackRuntimeError("invalid-pack-recovery-request", path, message);
}

function finalizationPaths(
  runId: string,
  action: ActionablePackRecoveryFinalization,
  report: PackTransactionRecoveryReport,
): readonly string[] {
  const paths = new Set<string>([PACK_ACTIVE_TRANSACTION_PATH]);
  if (action === "append-started-and-terminal") {
    paths.add(packTransactionRecordPath(runId, 0));
  }
  if (
    action === "append-started-and-terminal" ||
    action === "append-terminal"
  ) {
    paths.add(packTransactionRecordPath(runId, 1));
  }
  if (action === "append-reconciliation") {
    paths.add(packTransactionRecordPath(runId, 2));
  }
  for (const cleanup of report.directoryCleanup) {
    paths.add(cleanup.path);
    paths.add(cleanup.tombstonePath);
    paths.add(`${cleanup.tombstonePath}/owned`);
  }
  return Object.freeze([...paths].sort(compareCanonicalText));
}

function assertRecoveryCommand(registry: ValidatedRegistry): void {
  const command = registry.commands.find(
    ({ id }) => id === PACK_RECOVERY_COMMAND_ID,
  );
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "project-write" ||
    command.permissions.length !== 1 ||
    command.permissions[0] !== "install" ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "filesystem" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.input.schemaId !== packRecoveryCommandInputSchema.schemaId ||
    command.input.digest !== packRecoveryCommandInputSchema.digest ||
    command.output.schemaId !== packRecoveryCommandOutputSchema.schemaId ||
    command.output.digest !== packRecoveryCommandOutputSchema.digest ||
    command.handler.package !== "@ai-game-playbook/pack-runtime" ||
    command.handler.export !== "dispatchPreparedPackRecoveryFinalization"
  ) {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$registry.command",
      "registry does not expose the exact internal pack recovery authority",
    );
  }
}

function resolveRecoveryWorkflow(
  registry: ValidatedRegistry,
  projectStage: ProjectStage,
): ResolvedWorkflowPlan {
  let workflowPlan: ResolvedWorkflowPlan;
  try {
    workflowPlan = resolveWorkflowPlan(
      registry,
      PACK_RECOVERY_WORKFLOW_ID,
      projectStage,
    );
  } catch {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$registry.workflow",
      "registry does not expose an executable pack recovery workflow",
    );
  }
  const step = workflowPlan.steps[0];
  if (
    workflowPlan.steps.length !== 1 ||
    step === undefined ||
    step.id !== PACK_RECOVERY_WORKFLOW_STEP_ID ||
    step.command.id !== PACK_RECOVERY_COMMAND_ID ||
    step.command.lane !== "project-write" ||
    step.command.permissions.length !== 1 ||
    step.command.permissions[0] !== "install" ||
    step.approvalCheckpoint !== true ||
    step.onFailure !== "stop" ||
    step.rollbackCommand !== undefined ||
    workflowPlan.resumePolicy !== "never" ||
    !workflowPlan.requiredEvidence.includes("pack-recovery" as StableId) ||
    !workflowPlan.requiredEvidence.includes("run-receipt" as StableId)
  ) {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$registry.workflow",
      "pack recovery workflow does not match the finite execution contract",
    );
  }
  return workflowPlan;
}

export function computePackRecoveryFinalizationPlanDigest(
  plan: Omit<PreparedPackRecoveryFinalization, "planDigest"> &
    Partial<Pick<PreparedPackRecoveryFinalization, "planDigest">>,
): Sha256Digest {
  const { planDigest: _planDigest, ...body } = plan;
  return digestCanonicalJson({
    domain: "ai-game-playbook.pack-recovery-finalization-plan",
    version: "1",
    plan: body,
  });
}

export function preparePackTransactionRecoveryFinalization(
  value: PreparePackRecoveryFinalizationRequest,
): PreparedPackRecoveryFinalization {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["report", "registry", "runId", "projectStage"])
  ) {
    invalid("$request", "pack recovery preparation request is malformed");
  }
  let registry: ValidatedRegistry;
  try {
    assertValidatedRegistry(value.registry);
    registry = value.registry;
  } catch {
    throw new PackRuntimeError(
      "pack-registry-untrusted",
      "$request.registry",
      "pack recovery requires a same-process validated registry",
    );
  }
  const report = value.report;
  const reportInternals = internalsForPackTransactionRecoveryReport(report);
  if (
    typeof value.runId !== "string" ||
    !UUID_PATTERN.test(value.runId) ||
    value.runId === report.runId
  ) {
    invalid(
      "$request.runId",
      "recovery execution must use a canonical UUID distinct from the transaction",
    );
  }
  if (!PROJECT_STAGES.includes(value.projectStage)) {
    invalid("$request.projectStage", "recovery project stage is invalid");
  }
  const action = report.finalizationAction;
  if (
    !report.stable ||
    report.activeMarker !== "matching" ||
    report.activeMarkerFileDigest === undefined ||
    report.finalizationOutcome === undefined ||
    action === "blocked" ||
    action === "none" ||
    (action === "append-reconciliation" &&
      report.finalizationOutcome === "rolled-back")
  ) {
    throw new PackRuntimeError(
      "pack-recovery-not-actionable",
      "$request.report",
      "pack recovery report does not describe one stable approved closure",
      report.mutationUncertain,
    );
  }
  assertRecoveryCommand(registry);
  const workflowPlan = resolveRecoveryWorkflow(registry, value.projectStage);
  const body = {
    schemaVersion: "1.0.0" as const,
    runId: value.runId,
    transactionRunId: report.runId,
    project: Object.freeze({ ...report.project }),
    registryDigest: registry.digest,
    reportDigest: report.reportDigest,
    journalSnapshotDigest: report.journalSnapshotDigest,
    workflow: Object.freeze({
      id: PACK_RECOVERY_WORKFLOW_ID,
      stepId: PACK_RECOVERY_WORKFLOW_STEP_ID,
      projectStage: value.projectStage,
      resolvedPlanDigest: workflowPlan.resolvedPlanDigest,
    }),
    action,
    finalOutcome: report.finalizationOutcome,
    paths: finalizationPaths(report.runId, action, report),
  };
  const plan = Object.freeze({
    ...body,
    planDigest: computePackRecoveryFinalizationPlanDigest(body),
  });
  finalizationInternals.set(
    plan,
    Object.freeze({ report, registry, workflowPlan, reportInternals }),
  );
  return plan;
}

export function internalsForPreparedPackRecoveryFinalization(
  plan: PreparedPackRecoveryFinalization,
): PackRecoveryFinalizationInternals {
  const internals = finalizationInternals.get(plan);
  if (
    internals === undefined ||
    computePackRecoveryFinalizationPlanDigest(plan) !== plan.planDigest
  ) {
    throw new PackRuntimeError(
      "pack-recovery-plan-untrusted",
      "$request.plan",
      "pack recovery finalization requires a same-process prepared plan",
    );
  }
  return internals;
}

export function createPackRecoveryCommandInput(
  plan: PreparedPackRecoveryFinalization,
): Readonly<PackRecoveryCommandInput> {
  internalsForPreparedPackRecoveryFinalization(plan);
  return Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    recoveryRunId: plan.runId,
    transactionRunId: plan.transactionRunId,
    reportDigest: plan.reportDigest,
    journalSnapshotDigest: plan.journalSnapshotDigest,
    action: plan.action,
    finalOutcome: plan.finalOutcome,
    planDigest: plan.planDigest,
  });
}
