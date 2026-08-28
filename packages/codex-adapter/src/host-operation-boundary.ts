import type {
  ExecutionBudgets,
  ProjectStage,
  Sha256Digest,
  StableId,
} from "@ai-game-playbook/contracts";
import {
  createPermissionApprovalSession,
  createPermissionBroker,
  getLocalApprovalTrustedKey,
  inspectLocalApprovalSigningKey,
  type AuthorizedPermissionDecision,
  type LocalApprovalSigningKey,
  type LocalApprovalSigningKeySnapshot,
  type PermissionApprovalSession,
  type PermissionAuthorizationRequest,
} from "@ai-game-playbook/core";
import type { ValidatedRegistry } from "@ai-game-playbook/registry";
import { isProxy } from "node:util/types";

import {
  CODEX_APPROVAL_HOST_ID,
  CODEX_APPROVAL_MAX_WAIT_MS,
} from "./approval.js";

export const HOST_OPERATION_APPROVAL_MIN_WAIT_MS: number = 1_000;
export const HOST_OPERATION_APPROVAL_MAX_WAIT_MS: number =
  CODEX_APPROVAL_MAX_WAIT_MS;

export type HostOperationFailureKind = "invalid" | "signing-key-mismatch";

export type HostOperationFailure = (
  kind: HostOperationFailureKind,
  message: string,
) => never;

export type HostOperationDataRecord = Readonly<Record<string, unknown>>;

export interface BoundHostApproval {
  readonly session: PermissionApprovalSession;
  readonly signingKeyId: StableId;
  readonly signingKeyFingerprint: Sha256Digest;
}

export interface CreateBoundHostApprovalRequest {
  readonly registry: ValidatedRegistry;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly stage: ProjectStage;
    readonly budgets: ExecutionBudgets;
  };
  readonly signingKey: LocalApprovalSigningKey;
  readonly approvalWaitMs: number;
  readonly createAuthorizationRequest: (
    deadlineAt: string,
  ) => PermissionAuthorizationRequest;
  readonly fail: HostOperationFailure;
}

export function exactHostOperationDataRecord(
  value: unknown,
  keys: readonly string[],
  fail: HostOperationFailure,
): HostOperationDataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    fail("invalid", "Host operation requires one plain data request.");
  }
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw new TypeError("not plain data");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index]) ||
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("request fields are not exact data properties");
    }
    return Object.freeze(
      Object.fromEntries(
        keys.map((key) => [key, descriptors[key]?.value]),
      ),
    );
  } catch {
    fail("invalid", "Host operation request fields are invalid.");
  }
}

export function isHostOperationSignal(
  value: unknown,
): value is AbortSignal | null {
  return (
    value === null ||
    (typeof value === "object" &&
      value !== null &&
      !isProxy(value) &&
      value instanceof AbortSignal)
  );
}

export function assertHostApprovalWait(
  value: unknown,
  fail: HostOperationFailure,
): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < HOST_OPERATION_APPROVAL_MIN_WAIT_MS ||
    (value as number) > HOST_OPERATION_APPROVAL_MAX_WAIT_MS
  ) {
    fail("invalid", "Host operation requires a bounded approval wait.");
  }
}

function activeSigningKey(
  value: unknown,
  fail: HostOperationFailure,
): LocalApprovalSigningKeySnapshot {
  let snapshot: LocalApprovalSigningKeySnapshot;
  try {
    snapshot = inspectLocalApprovalSigningKey(
      value as LocalApprovalSigningKey,
    );
  } catch {
    fail("signing-key-mismatch", "Host operation requires one active local approval key.");
  }
  if (snapshot.status !== "active") {
    fail("signing-key-mismatch", "Host operation requires one active local approval key.");
  }
  return snapshot;
}

export function createBoundHostApproval(
  value: CreateBoundHostApprovalRequest,
): BoundHostApproval {
  assertHostApprovalWait(value.approvalWaitMs, value.fail);
  const key = activeSigningKey(value.signingKey, value.fail);
  const createdAt = Date.now();
  const sessionExpiresAt = new Date(
    createdAt + value.approvalWaitMs,
  ).toISOString();
  const requestDeadline = new Date(
    createdAt + value.approvalWaitMs + value.project.budgets.maxDurationMs,
  ).toISOString();
  const broker = createPermissionBroker({
    registry: value.registry,
    project: value.project,
    trustedApprovalKeys: [getLocalApprovalTrustedKey(value.signingKey)],
    now: Date.now,
  });
  const authorizationRequest =
    value.createAuthorizationRequest(requestDeadline);
  const pending = broker.authorize(authorizationRequest, []);
  if (pending.status !== "approval-required") {
    value.fail(
      "invalid",
      "Host operation did not produce an approval challenge.",
    );
  }
  const session = createPermissionApprovalSession({
    broker,
    registry: value.registry,
    request: authorizationRequest,
    hostId: CODEX_APPROVAL_HOST_ID as StableId,
    expiresAt: sessionExpiresAt,
    grantTerms: pending.missingPermissions.map((permission) =>
      Object.freeze({
        permission,
        expiresAt: requestDeadline,
        maxUses: 1,
      }),
    ),
    now: Date.now,
  });
  return Object.freeze({
    session,
    signingKeyId: key.keyId,
    signingKeyFingerprint: key.publicKeyFingerprint,
  });
}

export function assertBoundHostSigningKey(
  value: unknown,
  binding: BoundHostApproval,
  fail: HostOperationFailure,
): asserts value is LocalApprovalSigningKey {
  const key = activeSigningKey(value, fail);
  if (
    key.keyId !== binding.signingKeyId ||
    key.publicKeyFingerprint !== binding.signingKeyFingerprint
  ) {
    fail(
      "signing-key-mismatch",
      "Host execution requires the bound active approval key.",
    );
  }
}

export function settleHostAuthorizationUncertain(
  authorization: AuthorizedPermissionDecision,
  startedAt: number,
): void {
  if (authorization.lease.state !== "active") return;
  authorization.lease.settle({
    outcome: "uncertain",
    mutationUncertain: true,
    actual: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: Math.max(0, Date.now() - startedAt),
      outputBytes: 0,
      repairCycles: 0,
    },
  });
}
