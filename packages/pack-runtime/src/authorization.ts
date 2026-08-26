import {
  canonicalizeJson,
  compareCanonicalText,
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

import { PackRuntimeError } from "./errors.js";
import {
  PACK_ACTIVE_TRANSACTION_MAX_BYTES,
  PACK_ACTIVE_TRANSACTION_PATH,
} from "./active-transaction.js";
import { internalsForPreparedPackOperation } from "./prepared-plan.js";
import {
  PACK_INSTALLED_STATE_MAX_BYTES,
  PACK_INSTALLED_STATE_PATH,
} from "./state.js";
import {
  PACK_TRANSACTION_MAX_RECORD_BYTES,
  packTransactionRecordPath,
} from "./transaction-journal.js";
import type {
  CreatePackOperationAuthorizationRequest,
  PackOperation,
  PreparedPackOperation,
} from "./types.js";

type MutableRecord = Record<string, unknown>;

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
  throw new PackRuntimeError(
    "invalid-pack-execution-request",
    path,
    message,
  );
}

export function packOperationCommandId(operation: PackOperation): StableId {
  return `pack.${operation}` as StableId;
}

export function createPackOperationCommandInput(
  plan: PreparedPackOperation,
): Readonly<{
  schemaVersion: "1.0.0";
  operation: PackOperation;
  packId: StableId;
  planDigest: PreparedPackOperation["planDigest"];
}> {
  return Object.freeze({
    schemaVersion: "1.0.0",
    operation: plan.operation,
    packId: plan.pack.id,
    planDigest: plan.planDigest,
  });
}

export function packOperationAuthorizationPaths(
  plan: PreparedPackOperation,
): readonly string[] {
  const paths = new Set<string>([
    PACK_ACTIVE_TRANSACTION_PATH,
    PACK_INSTALLED_STATE_PATH,
    packTransactionRecordPath(plan.runId, 0),
    packTransactionRecordPath(plan.runId, 1),
  ]);
  for (const change of plan.changes) {
    paths.add(change.path);
  }
  return Object.freeze([...paths].sort(compareCanonicalText));
}

function snapshotBudgets(value: unknown): ExecutionBudgets {
  if (
    !isRecord(value) ||
    !exactKeys(value, BUDGET_REQUIRED_KEYS, BUDGET_OPTIONAL_KEYS)
  ) {
    invalid("$request.budgets", "execution budgets are malformed");
  }
  let cloned: unknown;
  try {
    cloned = JSON.parse(canonicalizeJson(value)) as unknown;
  } catch {
    invalid("$request.budgets", "execution budgets are not canonical JSON");
  }
  return Object.freeze(cloned as ExecutionBudgets);
}

function requiredChangedByteBudget(plan: PreparedPackOperation): number {
  const internals = internalsForPreparedPackOperation(plan);
  const preimageBytes = new Map(
    internals.preimages.map(({ target, content }) => [
      target,
      content.byteLength,
    ]),
  );
  let artifactBytes = 0;
  for (const change of plan.changes) {
    if (change.kind === "unchanged") continue;
    if (change.kind === "create") {
      artifactBytes += change.bytes * 2;
      continue;
    }
    const beforeBytes = preimageBytes.get(change.path);
    if (beforeBytes === undefined) {
      throw new PackRuntimeError(
        "pack-plan-untrusted",
        change.path,
        "rollback budget requires the prepared file preimage",
      );
    }
    artifactBytes +=
      change.kind === "delete"
        ? beforeBytes * 2
        : change.bytes + beforeBytes;
  }
  const required =
    artifactBytes +
    PACK_ACTIVE_TRANSACTION_MAX_BYTES * 2 +
    PACK_INSTALLED_STATE_MAX_BYTES +
    PACK_TRANSACTION_MAX_RECORD_BYTES * 2;
  if (!Number.isSafeInteger(required)) {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$request.budgets.maxChangedBytes",
      "pack rollback budget exceeds safe integer accounting",
    );
  }
  return required;
}

export function createPackOperationAuthorizationRequest(
  value: CreatePackOperationAuthorizationRequest,
): PermissionAuthorizationRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["plan", "budgets", "deadlineAt"])
  ) {
    invalid("$request", "authorization request contains undeclared fields");
  }
  const plan = value.plan;
  try {
    internalsForPreparedPackOperation(plan as PreparedPackOperation);
  } catch {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      "$request.plan",
      "authorization requires a same-process prepared pack plan",
    );
  }
  if ((plan as PreparedPackOperation).disposition !== "ready") {
    throw new PackRuntimeError(
      "pack-plan-not-executable",
      "$request.plan",
      "only a ready pack plan can request installation authority",
    );
  }
  const readyPlan = plan as PreparedPackOperation;
  const budgets = snapshotBudgets(value.budgets);
  const paths = packOperationAuthorizationPaths(readyPlan);
  if (
    !Number.isSafeInteger(budgets.maxDurationMs) ||
    budgets.maxDurationMs < 1 ||
    !Number.isSafeInteger(budgets.maxOutputBytes) ||
    budgets.maxOutputBytes < 0 ||
    !Number.isSafeInteger(budgets.maxRepairCycles) ||
    !Number.isSafeInteger(budgets.maxChangedFiles) ||
    (budgets.maxChangedFiles as number) < paths.length ||
    !Number.isSafeInteger(budgets.maxChangedBytes) ||
    (budgets.maxChangedBytes as number) < requiredChangedByteBudget(readyPlan) ||
    budgets.maxRepairCycles !== 0 ||
    budgets.maxMemoryBytes !== undefined ||
    budgets.maxCpuSeconds !== undefined ||
    budgets.maxGpuSeconds !== undefined ||
    budgets.maxCost !== undefined
  ) {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$request.budgets",
      "pack authority must cover exact files, conservative rollback bytes, and zero repair cycles",
    );
  }
  if (typeof value.deadlineAt !== "string") {
    invalid("$request.deadlineAt", "authorization deadline is invalid");
  }
  const deadline = Date.parse(value.deadlineAt);
  if (
    !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== value.deadlineAt
  ) {
    invalid("$request.deadlineAt", "authorization deadline must be canonical");
  }
  return Object.freeze({
    runId: readyPlan.runId,
    projectId: readyPlan.project.id,
    projectIdentityDigest: readyPlan.project.identityDigest,
    commandId: packOperationCommandId(readyPlan.operation),
    input: createPackOperationCommandInput(readyPlan),
    scope: Object.freeze({
      paths,
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

export interface ValidatedPackExecutionAuthority {
  readonly authorization: AuthorizedPermissionDecision;
  readonly lane: ProjectLaneLease;
  readonly request: PermissionAuthorizationRequest;
}

function authorizationInvalid(path: string, message: string): never {
  throw new PackRuntimeError(
    "pack-authorization-invalid",
    path,
    message,
  );
}

export function assertPackAuthorizationActive(
  authorization: AuthorizedPermissionDecision,
): void {
  const expiresAt = Date.parse(authorization.lease.expiresAt);
  const deadlineAt = Date.parse(authorization.challenge.deadlineAt);
  if (
    authorization.lease.state !== "active" ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(deadlineAt) ||
    expiresAt > deadlineAt ||
    Date.now() >= expiresAt
  ) {
    authorizationInvalid(
      "$request.authorization",
      "pack authorization is no longer active within its approved deadline",
    );
  }
}

export async function validatePackExecutionAuthority(
  plan: PreparedPackOperation,
  authorizationValue: unknown,
  laneValue: unknown,
): Promise<ValidatedPackExecutionAuthority> {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(authorizationValue);
    authorization = authorizationValue;
  } catch {
    throw new PackRuntimeError(
      "pack-authorization-invalid",
      "$request.authorization",
      "pack authorization must be produced by the active broker process",
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
      "pack lane must be produced by the active core process",
    );
  }
  const internals = internalsForPreparedPackOperation(plan);
  const commandId = packOperationCommandId(plan.operation);
  const command = internals.registry.commands.find(({ id }) => id === commandId);
  if (
    command === undefined ||
    command.lane !== "project-write" ||
    command.permissions.length !== 1 ||
    command.permissions[0] !== "install" ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "filesystem" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/pack-runtime" ||
    command.handler.export !== "executePreparedPackOperation"
  ) {
    authorizationInvalid(
      "$registry.command",
      "pack command does not expose the exact initial lifecycle authority",
    );
  }
  const challenge = authorization.challenge;
  assertPackAuthorizationActive(authorization);
  const expected = createPackOperationAuthorizationRequest({
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
      digestCanonicalJson(createPackOperationCommandInput(plan)) ||
    challenge.permissions.length !== 1 ||
    challenge.permissions[0]?.permission !== "install" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.feature !== undefined ||
    challenge.workflow !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    authorization.lease.authorizationId.length === 0 ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.commandId !== commandId ||
    authorization.lease.projectId !== plan.project.id
  ) {
    authorizationInvalid(
      "$request.authorization",
      "authorization is not exactly bound to the prepared pack operation",
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
      "project lane identity does not match the prepared pack operation",
    );
  }
  try {
    await lane.assertOwned();
  } catch (error) {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "project lane ownership could not be proven before execution",
      error instanceof Error && "mutationUncertain" in error
        ? Boolean(error.mutationUncertain)
        : false,
    );
  }
  return Object.freeze({ authorization, lane, request: expected });
}
