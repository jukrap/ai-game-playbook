import {
  canonicalizeJson,
  digestCanonicalJson,
  type ExecutionBudgets,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertAuthorizedPermissionDecision,
  assertProjectLaneLease,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationRequest,
  type ProjectLaneLease,
} from "@ai-game-playbook/core";

import {
  PACK_ACTIVE_TRANSACTION_MAX_BYTES,
  PACK_ACTIVE_TRANSACTION_PATH,
} from "./active-transaction.js";
import { assertPackAuthorizationActive } from "./authorization.js";
import { PackRuntimeError } from "./errors.js";
import {
  createPackRecoveryCommandInput,
  internalsForPreparedPackRecoveryFinalization,
  type PreparedPackRecoveryFinalization,
} from "./recovery-plan.js";
import { PACK_TRANSACTION_MAX_RECORD_BYTES } from "./transaction-journal.js";

type MutableRecord = Record<string, unknown>;

const PACK_RECOVERY_COMMAND_ID = "pack.recover" as StableId;

const BUDGET_REQUIRED_KEYS = Object.freeze([
  "maxDurationMs",
  "maxOutputBytes",
  "maxRepairCycles",
]);
const BUDGET_OPTIONAL_KEYS = Object.freeze([
  "maxChangedFiles",
  "maxChangedBytes",
  "maxMemoryBytes",
  "maxCpuSeconds",
  "maxGpuSeconds",
  "maxCost",
]);

export interface CreatePackRecoveryAuthorizationRequest {
  readonly plan: PreparedPackRecoveryFinalization;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
}

export interface ValidatedPackRecoveryAuthority {
  readonly authorization: AuthorizedPermissionDecision;
  readonly lane: ProjectLaneLease;
  readonly request: PermissionAuthorizationRequest;
}

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: MutableRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
}

function invalid(path: string, message: string): never {
  throw new PackRuntimeError("invalid-pack-recovery-request", path, message);
}

function snapshotBudgets(value: unknown): ExecutionBudgets {
  if (
    !isRecord(value) ||
    !exactKeys(value, BUDGET_REQUIRED_KEYS, BUDGET_OPTIONAL_KEYS)
  ) {
    invalid("$request.budgets", "recovery execution budgets are malformed");
  }
  let cloned: unknown;
  try {
    cloned = JSON.parse(canonicalizeJson(value)) as unknown;
  } catch {
    invalid(
      "$request.budgets",
      "recovery execution budgets are not canonical JSON",
    );
  }
  return Object.freeze(cloned as ExecutionBudgets);
}

function requiredChangedBytes(plan: PreparedPackRecoveryFinalization): number {
  const recordWrites = plan.paths.filter(
    (path) => path !== PACK_ACTIVE_TRANSACTION_PATH,
  ).length;
  return (
    PACK_ACTIVE_TRANSACTION_MAX_BYTES * 2 +
    recordWrites * PACK_TRANSACTION_MAX_RECORD_BYTES
  );
}

export function createPackRecoveryAuthorizationRequest(
  value: CreatePackRecoveryAuthorizationRequest,
): PermissionAuthorizationRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["plan", "budgets", "deadlineAt"])
  ) {
    invalid("$request", "recovery authorization request is malformed");
  }
  const plan = value.plan;
  internalsForPreparedPackRecoveryFinalization(plan);
  const budgets = snapshotBudgets(value.budgets);
  if (
    !Number.isSafeInteger(budgets.maxDurationMs) ||
    budgets.maxDurationMs < 1 ||
    !Number.isSafeInteger(budgets.maxOutputBytes) ||
    budgets.maxOutputBytes < 0 ||
    !Number.isSafeInteger(budgets.maxRepairCycles) ||
    budgets.maxRepairCycles !== 0 ||
    !Number.isSafeInteger(budgets.maxChangedFiles) ||
    (budgets.maxChangedFiles as number) < plan.paths.length ||
    !Number.isSafeInteger(budgets.maxChangedBytes) ||
    (budgets.maxChangedBytes as number) < requiredChangedBytes(plan) ||
    budgets.maxMemoryBytes !== undefined ||
    budgets.maxCpuSeconds !== undefined ||
    budgets.maxGpuSeconds !== undefined ||
    budgets.maxCost !== undefined
  ) {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$request.budgets",
      "recovery authority must cover exact journal and marker effects with zero repair cycles",
    );
  }
  if (typeof value.deadlineAt !== "string") {
    invalid("$request.deadlineAt", "recovery authorization deadline is invalid");
  }
  const deadline = Date.parse(value.deadlineAt);
  if (
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== value.deadlineAt
  ) {
    invalid(
      "$request.deadlineAt",
      "recovery authorization deadline must be canonical",
    );
  }
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: PACK_RECOVERY_COMMAND_ID,
    input: createPackRecoveryCommandInput(plan),
    scope: Object.freeze({
      paths: plan.paths,
      objectIds: Object.freeze([]),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze(["config"] as const),
      publishTargets: Object.freeze([]),
    }),
    budgets,
    deadlineAt: value.deadlineAt,
  });
}

function authorizationInvalid(path: string, message: string): never {
  throw new PackRuntimeError("pack-authorization-invalid", path, message);
}

export async function validatePackRecoveryAuthority(
  plan: PreparedPackRecoveryFinalization,
  authorizationValue: unknown,
  laneValue: unknown,
): Promise<ValidatedPackRecoveryAuthority> {
  const internals = internalsForPreparedPackRecoveryFinalization(plan);
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(authorizationValue);
    authorization = authorizationValue;
  } catch {
    authorizationInvalid(
      "$request.authorization",
      "recovery authorization must be produced by the active broker process",
    );
  }
  let lane: ProjectLaneLease;
  try {
    assertProjectLaneLease(laneValue);
    lane = laneValue;
  } catch {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "recovery lane must be produced by the active core process",
    );
  }
  const command = internals.registry.commands.find(
    ({ id }) => id === "pack.recover",
  );
  if (command === undefined) {
    authorizationInvalid(
      "$registry.command",
      "recovery command disappeared from the validated registry",
    );
  }
  assertPackAuthorizationActive(authorization);
  const challenge = authorization.challenge;
  const expected = createPackRecoveryAuthorizationRequest({
    plan,
    budgets: challenge.budgets,
    deadlineAt: challenge.deadlineAt,
  });
  if (
    challenge.runId !== plan.runId ||
    challenge.project.id !== plan.project.id ||
    challenge.project.identityDigest !== plan.project.identityDigest ||
    challenge.registryDigest !== plan.registryDigest ||
    challenge.command.id !== command.id ||
    challenge.command.version !== command.version ||
    challenge.command.handlerDigest !== command.handler.digest ||
    challenge.inputDigest !==
      digestCanonicalJson(createPackRecoveryCommandInput(plan)) ||
    challenge.permissions.length !== 1 ||
    challenge.permissions[0]?.permission !== "install" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.feature !== undefined ||
    challenge.workflow !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.commandId !== PACK_RECOVERY_COMMAND_ID ||
    authorization.lease.projectId !== plan.project.id
  ) {
    authorizationInvalid(
      "$request.authorization",
      "authorization is not exactly bound to the recovery finalization plan",
    );
  }
  if (
    lane.state !== "active" ||
    lane.runId !== plan.runId ||
    lane.lane !== "project-write" ||
    lane.rootIdentityDigest !== plan.project.rootIdentityDigest ||
    lane.projectIdentityDigest !== plan.project.identityDigest ||
    lane.editorSessionIdentityDigest !== undefined
  ) {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "project lane identity does not match the recovery transaction",
    );
  }
  try {
    await lane.assertOwned();
  } catch (error) {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "project lane ownership could not be proven before recovery",
      error instanceof Error && "mutationUncertain" in error
        ? Boolean(error.mutationUncertain)
        : false,
    );
  }
  return Object.freeze({ authorization, lane, request: expected });
}
