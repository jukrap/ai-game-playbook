import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";

import {
  approvalPromptSchema,
  approvalSessionChallengeSchema,
  approvalSessionResponseSchema,
  compareCanonicalText,
  computeApprovalGrantSigningDigest,
  computeApprovalPromptDigest,
  computeApprovalSessionChallengeDigest,
  isStableId,
  type ApprovalGrant,
  type ApprovalPrompt,
  type ApprovalSessionChallenge,
  type ApprovalSessionGrantTerm,
  type ApprovalSessionResponse,
  type PermissionClass,
  type Sha256Digest,
  type StableId,
  type VersionedContractSchema,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { CoreBoundaryError } from "./errors.js";
import {
  assertAuthorizedPermissionDecision,
  assertPermissionBroker,
  createApprovalGrantSubjectFromPrompt,
  createPermissionApprovalPrompt,
  type AuthorizedPermissionDecision,
  type PermissionAuthorizationRequest,
  type PermissionBroker,
} from "./permission-broker.js";

const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const MAX_APPROVAL_TERMS = 32;

export interface PermissionApprovalGrantTermOptions {
  readonly permission: PermissionClass;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export interface CreatePermissionApprovalSessionOptions {
  readonly broker: PermissionBroker;
  readonly registry: ValidatedRegistry;
  readonly request: PermissionAuthorizationRequest;
  readonly hostId: StableId;
  readonly expiresAt: string;
  readonly grantTerms: readonly PermissionApprovalGrantTermOptions[];
  readonly now?: () => number;
}

export interface PermissionApprovalSessionPresentation {
  readonly prompt: ApprovalPrompt;
  readonly session: ApprovalSessionChallenge;
}

export interface PermissionApprovalSession {
  readonly presentation: PermissionApprovalSessionPresentation;
}

export interface ApprovalGrantSigner {
  readonly keyId: StableId;
  sign(
    signingDigest: Sha256Digest,
    signal: AbortSignal,
  ): Promise<string> | string;
}

export type PermissionApprovalSessionStatus =
  | "pending"
  | "resolving"
  | "authorized"
  | "denied"
  | "cancelled"
  | "expired"
  | "failed";

export type PermissionApprovalSessionFailure =
  | "signing-failed"
  | "authorization-failed";

export interface PermissionApprovalSessionSnapshot {
  readonly sessionId: string;
  readonly promptDigest: Sha256Digest;
  readonly sessionDigest: Sha256Digest;
  readonly status: PermissionApprovalSessionStatus;
  readonly terminalAt?: string;
  readonly failure?: PermissionApprovalSessionFailure;
}

export type PermissionApprovalSessionResolution =
  | {
      readonly status: "authorized";
      readonly session: PermissionApprovalSessionSnapshot;
      readonly authorization: AuthorizedPermissionDecision;
    }
  | {
      readonly status: "denied" | "cancelled" | "expired";
      readonly session: PermissionApprovalSessionSnapshot;
    };

interface ApprovalSessionState {
  readonly broker: PermissionBroker;
  readonly registry: ValidatedRegistry;
  readonly request: PermissionAuthorizationRequest;
  readonly prompt: ApprovalPrompt;
  readonly challenge: ApprovalSessionChallenge;
  readonly now: () => number;
  status: PermissionApprovalSessionStatus;
  terminalAt?: string;
  failure?: PermissionApprovalSessionFailure;
}

interface ValidatedSigner {
  readonly keyId: StableId;
  readonly sign: ApprovalGrantSigner["sign"];
}

type DataRecord = Record<string, unknown>;

const approvalSessionStates = new WeakMap<object, ApprovalSessionState>();

function sessionError(
  code: ConstructorParameters<typeof CoreBoundaryError>[0],
  path: string,
  message: string,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message);
}

function readClock(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.now",
      "approval session clock failed",
    );
  }
  if (
    !Number.isSafeInteger(value) ||
    value < -8_640_000_000_000_000 ||
    value > 8_640_000_000_000_000
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.now",
      "approval session clock returned an invalid timestamp",
    );
  }
  return value;
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw sessionError(
      "permission-approval-session-invalid",
      path,
      "expected a canonical UTC timestamp",
    );
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      path,
      "expected a canonical UTC timestamp",
    );
  }
  return value;
}

function exactDataRecord(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      path,
      "expected a plain data object",
    );
  }
  const names = Object.getOwnPropertyNames(value);
  const allowedSet = new Set(allowed);
  if (
    names.some((name) => !allowedSet.has(name)) ||
    required.some((name) => !names.includes(name))
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      path,
      "approval session data contains missing or undeclared fields",
    );
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw sessionError(
        "permission-approval-session-invalid",
        `${path}.${name}`,
        "approval session entries must be enumerable data properties",
      );
    }
  }
  return value as DataRecord;
}

function ownDataValue(record: DataRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function assertExactSchema(
  registry: ValidatedRegistry,
  schema: VersionedContractSchema,
): void {
  const registered = registry.schemas.find(
    ({ schemaId }) => schemaId === schema.schemaId,
  );
  if (registered?.digest !== schema.digest) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.registry",
      `${schema.id} schema is not registered with its exact digest`,
    );
  }
}

function validateContractValue<T>(
  registry: ValidatedRegistry,
  schema: VersionedContractSchema,
  value: unknown,
  path: string,
): T {
  try {
    return validateRegisteredContractValue(
      registry,
      { schemaId: schema.schemaId, digest: schema.digest },
      value,
    ) as T;
  } catch {
    throw sessionError(
      "permission-approval-session-invalid",
      path,
      `value does not satisfy the registered ${schema.id} schema`,
    );
  }
}

function grantIdFor(
  sessionId: string,
  permission: PermissionClass,
): StableId {
  const value = `approval.session.${sessionId.replaceAll("-", "")}.${permission.replaceAll("-", ".")}`;
  if (!isStableId(value)) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$session.grantTerms",
      "generated approval grant ID is invalid",
    );
  }
  return value;
}

function normalizeGrantTerms(
  input: unknown,
  missingPermissions: readonly PermissionClass[],
  sessionId: string,
  sessionExpiry: number,
  requestDeadline: number,
): readonly ApprovalSessionGrantTerm[] {
  if (
    isProxy(input) ||
    !Array.isArray(input) ||
    input.length === 0 ||
    input.length > MAX_APPROVAL_TERMS
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.grantTerms",
      "expected a bounded dense approval term array",
    );
  }
  const missing = new Set<PermissionClass>(missingPermissions);
  const seen = new Set<PermissionClass>();
  const normalized: ApprovalSessionGrantTerm[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.hasOwn(input, index)) {
      throw sessionError(
        "permission-approval-session-invalid",
        `$options.grantTerms[${index}]`,
        "approval term array must be dense",
      );
    }
    const record = exactDataRecord(
      input[index],
      ["permission", "expiresAt", "maxUses"],
      ["permission", "expiresAt", "maxUses"],
      `$options.grantTerms[${index}]`,
    );
    const permission = ownDataValue(record, "permission");
    if (
      typeof permission !== "string" ||
      !missing.has(permission as PermissionClass) ||
      seen.has(permission as PermissionClass)
    ) {
      throw sessionError(
        "permission-approval-session-invalid",
        `$options.grantTerms[${index}].permission`,
        "approval term must bind one missing permission exactly once",
      );
    }
    const typedPermission = permission as PermissionClass;
    const expiresAt = canonicalTimestamp(
      ownDataValue(record, "expiresAt"),
      `$options.grantTerms[${index}].expiresAt`,
    );
    const expires = Date.parse(expiresAt);
    if (expires <= sessionExpiry || expires > requestDeadline) {
      throw sessionError(
        "permission-approval-session-invalid",
        `$options.grantTerms[${index}].expiresAt`,
        "grant expiry must follow the session and not exceed the request deadline",
      );
    }
    const maxUses = ownDataValue(record, "maxUses");
    if (
      !Number.isSafeInteger(maxUses) ||
      (maxUses as number) < 1 ||
      (maxUses as number) > 10_000 ||
      (typedPermission !== "editor-control" && maxUses !== 1)
    ) {
      throw sessionError(
        "permission-approval-session-invalid",
        `$options.grantTerms[${index}].maxUses`,
        "only an editor-session approval may allow more than one use",
      );
    }
    seen.add(typedPermission);
    normalized.push(
      Object.freeze({
        grantId: grantIdFor(sessionId, typedPermission),
        permission: typedPermission,
        expiresAt,
        maxUses: maxUses as number,
      }),
    );
  }
  if (
    normalized.length !== missingPermissions.length ||
    missingPermissions.some((permission) => !seen.has(permission))
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.grantTerms",
      "approval terms must cover every missing permission exactly once",
    );
  }
  normalized.sort((left, right) =>
    compareCanonicalText(left.permission, right.permission),
  );
  return Object.freeze(normalized);
}

function sessionState(
  session: PermissionApprovalSession,
): ApprovalSessionState {
  if (session === null || typeof session !== "object" || isProxy(session)) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$session",
      "approval session must be produced by this process",
    );
  }
  const state = approvalSessionStates.get(session);
  if (state === undefined) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$session",
      "approval session must be produced by this process",
    );
  }
  return state;
}

function expirePendingSession(state: ApprovalSessionState, now: number): boolean {
  if (
    state.status === "pending" &&
    now >= Date.parse(state.challenge.expiresAt)
  ) {
    state.status = "expired";
    state.terminalAt = state.challenge.expiresAt;
    return true;
  }
  return state.status === "expired";
}

function snapshotState(
  state: ApprovalSessionState,
): PermissionApprovalSessionSnapshot {
  return Object.freeze({
    sessionId: state.challenge.sessionId,
    promptDigest: state.challenge.promptDigest,
    sessionDigest: state.challenge.sessionDigest,
    status: state.status,
    ...(state.terminalAt === undefined
      ? {}
      : { terminalAt: state.terminalAt }),
    ...(state.failure === undefined ? {} : { failure: state.failure }),
  });
}

function validatedSigner(value: unknown): ValidatedSigner {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signer must be a plain in-process capability",
    );
  }
  const names = Object.getOwnPropertyNames(value).sort(compareCanonicalText);
  if (names.length !== 2 || names[0] !== "keyId" || names[1] !== "sign") {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signer has missing or undeclared fields",
    );
  }
  const keyDescriptor = Object.getOwnPropertyDescriptor(value, "keyId");
  const signDescriptor = Object.getOwnPropertyDescriptor(value, "sign");
  if (
    keyDescriptor === undefined ||
    !("value" in keyDescriptor) ||
    keyDescriptor.enumerable !== true ||
    !isStableId(keyDescriptor.value) ||
    signDescriptor === undefined ||
    !("value" in signDescriptor) ||
    signDescriptor.enumerable !== true ||
    typeof signDescriptor.value !== "function"
  ) {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signer must expose one stable key ID and sign function",
    );
  }
  return Object.freeze({
    keyId: keyDescriptor.value,
    sign: signDescriptor.value as ApprovalGrantSigner["sign"],
  });
}

async function signWithinSession(
  state: ApprovalSessionState,
  signer: ValidatedSigner,
  digest: Sha256Digest,
): Promise<string> {
  const remaining = Date.parse(state.challenge.expiresAt) - readClock(state.now);
  if (remaining <= 0) {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval session expired before signing settled",
    );
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        sessionError(
          "permission-approval-session-signing-failed",
          "$signer",
          "approval signing did not settle before the session deadline",
        ),
      );
    }, remaining);
  });
  let signature: unknown;
  try {
    signature = await Promise.race([
      Promise.resolve().then(() => signer.sign(digest, controller.signal)),
      timedOut,
    ]);
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "permission-approval-session-signing-failed"
    ) {
      throw error;
    }
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signer failed",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  if (readClock(state.now) >= Date.parse(state.challenge.expiresAt)) {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signing settled after the session deadline",
    );
  }
  if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signer returned an invalid Ed25519 signature",
    );
  }
  return signature;
}

export function createPermissionApprovalSession(
  options: CreatePermissionApprovalSessionOptions,
): PermissionApprovalSession {
  const record = exactDataRecord(
    options,
    [
      "broker",
      "registry",
      "request",
      "hostId",
      "expiresAt",
      "grantTerms",
      "now",
    ],
    ["broker", "registry", "request", "hostId", "expiresAt", "grantTerms"],
    "$options",
  );
  const broker = ownDataValue(record, "broker");
  assertPermissionBroker(broker);
  const registry = ownDataValue(record, "registry");
  try {
    assertValidatedRegistry(registry);
  } catch {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.registry",
      "registry must be validated in this process",
    );
  }
  const typedRegistry = registry as ValidatedRegistry;
  for (const schema of [
    approvalPromptSchema,
    approvalSessionChallengeSchema,
    approvalSessionResponseSchema,
  ]) {
    assertExactSchema(typedRegistry, schema);
  }
  const request = ownDataValue(record, "request") as PermissionAuthorizationRequest;
  const prepared = broker.prepare(request);
  const requiredPermissions = prepared.permissions
    .filter(({ mode }) => mode === "approval-required")
    .map(({ permission }) => permission)
    .sort(compareCanonicalText);
  if (requiredPermissions.length === 0) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.request",
      "request does not require an approval session",
    );
  }
  const pending = broker.authorize(request, []);
  if (pending.status !== "approval-required") {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.request",
      "permission broker did not return an approval challenge",
    );
  }
  if (
    pending.challenge.requestDigest !== prepared.requestDigest ||
    pending.challenge.registryDigest !== typedRegistry.digest
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.registry",
      "approval session registry or request identity does not match the broker",
    );
  }
  const hostId = ownDataValue(record, "hostId");
  if (!isStableId(hostId)) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.hostId",
      "expected a canonical host ID",
    );
  }
  const nowValue = ownDataValue(record, "now");
  if (nowValue !== undefined && typeof nowValue !== "function") {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.now",
      "expected a clock function",
    );
  }
  const now = (nowValue as (() => number) | undefined) ?? Date.now;
  const created = readClock(now);
  const expiresAt = canonicalTimestamp(
    ownDataValue(record, "expiresAt"),
    "$options.expiresAt",
  );
  const sessionExpiry = Date.parse(expiresAt);
  const requestDeadline = Date.parse(pending.challenge.deadlineAt);
  if (sessionExpiry <= created || sessionExpiry >= requestDeadline) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$options.expiresAt",
      "session expiry must follow creation and precede the request deadline",
    );
  }
  const sessionId = randomUUID();
  const grantTerms = normalizeGrantTerms(
    ownDataValue(record, "grantTerms"),
    pending.missingPermissions,
    sessionId,
    sessionExpiry,
    requestDeadline,
  );
  const prompt = createPermissionApprovalPrompt(pending.challenge);
  const presentationPrompt = validateContractValue<ApprovalPrompt>(
    typedRegistry,
    approvalPromptSchema,
    prompt,
    "$presentation.prompt",
  );
  if (computeApprovalPromptDigest(presentationPrompt) !== prompt.promptDigest) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$presentation.prompt.promptDigest",
      "approval prompt digest does not match its presentation body",
    );
  }
  const challengeBody: Omit<ApprovalSessionChallenge, "sessionDigest"> = {
    schemaVersion: approvalSessionChallengeSchema.version,
    sessionId,
    hostId,
    promptDigest: prompt.promptDigest,
    requestDigest: pending.challenge.requestDigest,
    createdAt: new Date(created).toISOString(),
    expiresAt,
    grantTerms,
  };
  const challenge = validateContractValue<ApprovalSessionChallenge>(
    typedRegistry,
    approvalSessionChallengeSchema,
    {
      ...challengeBody,
      sessionDigest: computeApprovalSessionChallengeDigest(challengeBody),
    },
    "$presentation.session",
  );
  if (
    computeApprovalSessionChallengeDigest(challenge) !== challenge.sessionDigest
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$presentation.session.sessionDigest",
      "approval session digest does not match its challenge body",
    );
  }
  const presentation = Object.freeze({
    prompt: presentationPrompt,
    session: challenge,
  });
  const session = Object.freeze({ presentation });
  approvalSessionStates.set(session, {
    broker,
    registry: typedRegistry,
    request,
    prompt,
    challenge,
    now,
    status: "pending",
  });
  return session;
}

export function inspectPermissionApprovalSession(
  session: PermissionApprovalSession,
): PermissionApprovalSessionSnapshot {
  const state = sessionState(session);
  if (state.status === "pending") {
    expirePendingSession(state, readClock(state.now));
  }
  return snapshotState(state);
}

export async function resolvePermissionApprovalSession(
  session: PermissionApprovalSession,
  response: ApprovalSessionResponse,
  signer?: ApprovalGrantSigner,
): Promise<PermissionApprovalSessionResolution> {
  const state = sessionState(session);
  if (state.status !== "pending") {
    throw sessionError(
      "permission-approval-session-settled",
      "$session",
      "approval session is no longer pending",
    );
  }
  const responseTime = readClock(state.now);
  if (expirePendingSession(state, responseTime)) {
    const snapshot = snapshotState(state);
    return Object.freeze({ status: "expired", session: snapshot });
  }
  const value = validateContractValue<ApprovalSessionResponse>(
    state.registry,
    approvalSessionResponseSchema,
    response,
    "$response",
  );
  if (
    value.sessionId !== state.challenge.sessionId ||
    value.sessionDigest !== state.challenge.sessionDigest ||
    value.promptDigest !== state.challenge.promptDigest ||
    computeApprovalSessionChallengeDigest(state.challenge) !==
      state.challenge.sessionDigest ||
    computeApprovalPromptDigest(state.prompt) !== state.prompt.promptDigest
  ) {
    throw sessionError(
      "permission-approval-session-invalid",
      "$response",
      "approval response does not match the pending session",
    );
  }
  const responseAt = new Date(responseTime).toISOString();
  if (value.decision === "denied" || value.decision === "cancelled") {
    state.status = value.decision;
    state.terminalAt = responseAt;
    const snapshot = snapshotState(state);
    return Object.freeze({ status: value.decision, session: snapshot });
  }

  state.status = "resolving";
  let grants: readonly ApprovalGrant[];
  try {
    const boundSigner = validatedSigner(signer);
    const signed: ApprovalGrant[] = [];
    for (const term of state.challenge.grantTerms) {
      const subject = createApprovalGrantSubjectFromPrompt(state.prompt, {
        grantId: term.grantId,
        permission: term.permission,
        approvedAt: responseAt,
        expiresAt: term.expiresAt,
        maxUses: term.maxUses,
      });
      const signature = await signWithinSession(
        state,
        boundSigner,
        computeApprovalGrantSigningDigest(subject),
      );
      signed.push(
        Object.freeze({
          ...subject,
          signature: Object.freeze({
            algorithm: "ed25519" as const,
            keyId: boundSigner.keyId,
            value: signature,
          }),
        }),
      );
    }
    grants = Object.freeze(signed);
  } catch (error) {
    state.status = "failed";
    state.terminalAt = responseAt;
    state.failure = "signing-failed";
    if (error instanceof CoreBoundaryError) throw error;
    throw sessionError(
      "permission-approval-session-signing-failed",
      "$signer",
      "approval signing failed",
    );
  }

  try {
    const authorization = state.broker.authorize(state.request, grants);
    if (
      authorization.status !== "authorized" ||
      authorization.challenge.requestDigest !== state.challenge.requestDigest
    ) {
      throw sessionError(
        "permission-approval-session-invalid",
        "$authorization",
        "permission broker did not authorize the exact session request",
      );
    }
    assertAuthorizedPermissionDecision(authorization);
    state.status = "authorized";
    state.terminalAt = responseAt;
    const snapshot = snapshotState(state);
    return Object.freeze({
      status: "authorized",
      session: snapshot,
      authorization,
    });
  } catch (error) {
    state.status = "failed";
    state.terminalAt = responseAt;
    state.failure = "authorization-failed";
    if (error instanceof CoreBoundaryError) throw error;
    throw sessionError(
      "permission-approval-session-invalid",
      "$authorization",
      "permission broker rejected the signed approval session",
    );
  }
}
