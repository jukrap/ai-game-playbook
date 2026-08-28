import { Buffer } from "node:buffer";
import {
  createPrivateKey,
  createPublicKey,
  sign as signDigest,
  type KeyObject,
} from "node:crypto";
import { isProxy } from "node:util/types";

import {
  isSha256Digest,
  isStableId,
  sha256Digest,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";

import { CoreBoundaryError } from "./errors.js";
import type { ApprovalGrantSigner } from "./permission-approval-session.js";
import type { TrustedApprovalKey } from "./permission-broker.js";
import {
  snapshotEnumerableDataRecord,
  snapshotExactDataRecord,
} from "./plain-data.js";

export const LOCAL_APPROVAL_KEY_MAX_PEM_BYTES = 16_384;
export const LOCAL_APPROVAL_SIGNER_MAX_LIFETIME_MS = 300_000;
export const LOCAL_APPROVAL_SIGNER_MAX_SIGNATURES = 32;

export interface CreateLocalApprovalSigningKeyOptions {
  readonly keyId: StableId;
  readonly privateKeyPem: string;
}

export interface LocalApprovalSigningKey {
  readonly keyId: StableId;
}

export type LocalApprovalSigningKeyStatus = "active" | "closed";

export interface LocalApprovalSigningKeySnapshot {
  readonly keyId: StableId;
  readonly publicKeyFingerprint: Sha256Digest;
  readonly status: LocalApprovalSigningKeyStatus;
}

export interface CreateLocalApprovalGrantSignerOptions {
  readonly expiresAt: string;
  readonly maxSignatures: number;
  readonly now?: () => number;
}

export interface LocalApprovalGrantSigner extends ApprovalGrantSigner {}

export type LocalApprovalGrantSignerStatus =
  | "active"
  | "closed"
  | "exhausted"
  | "expired"
  | "key-closed";

export interface LocalApprovalGrantSignerSnapshot {
  readonly keyId: StableId;
  readonly publicKeyFingerprint: Sha256Digest;
  readonly status: LocalApprovalGrantSignerStatus;
  readonly expiresAt: string;
  readonly maxSignatures: number;
  readonly usedSignatures: number;
  readonly remainingSignatures: number;
}

interface LocalApprovalSigningKeyState {
  readonly keyId: StableId;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: Sha256Digest;
  privateKey: KeyObject | undefined;
  closed: boolean;
}

interface LocalApprovalGrantSignerState {
  readonly key: LocalApprovalSigningKeyState;
  readonly expiresAt: string;
  readonly expiresAtMs: number;
  readonly maxSignatures: number;
  readonly now: () => number;
  lastObservedAt: number;
  usedSignatures: number;
  closed: boolean;
}

const keyStates = new WeakMap<object, LocalApprovalSigningKeyState>();
const signerStates = new WeakMap<object, LocalApprovalGrantSignerState>();

function localApprovalError(
  code: ConstructorParameters<typeof CoreBoundaryError>[0],
  path: string,
  message: string,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message);
}

function readClock(now: () => number, path: string): number {
  let value: number;
  try {
    value = now();
  } catch {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      path,
      "local approval signer clock failed",
    );
  }
  if (
    !Number.isSafeInteger(value) ||
    value < -8_640_000_000_000_000 ||
    value > 8_640_000_000_000_000
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      path,
      "local approval signer clock returned an invalid timestamp",
    );
  }
  return value;
}

function canonicalTimestamp(value: unknown, path: string): {
  readonly text: string;
  readonly milliseconds: number;
} {
  if (typeof value !== "string") {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      path,
      "expected a canonical UTC timestamp",
    );
  }
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      path,
      "expected a canonical UTC timestamp",
    );
  }
  return Object.freeze({ text: value, milliseconds });
}

function readSignerClock(state: LocalApprovalGrantSignerState): number {
  const value = readClock(state.now, "$signer.now");
  if (value < state.lastObservedAt) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$signer.now",
      "local approval signer clock moved backwards",
    );
  }
  state.lastObservedAt = value;
  return value;
}

function signingKeyState(value: unknown): LocalApprovalSigningKeyState {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value)
  ) {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$key",
      "local approval key must be created in this process",
    );
  }
  const state = keyStates.get(value);
  if (state === undefined) {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$key",
      "local approval key must be created in this process",
    );
  }
  return state;
}

function approvalSignerState(value: unknown): LocalApprovalGrantSignerState {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value)
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$signer",
      "local approval signer must be created in this process",
    );
  }
  const state = signerStates.get(value);
  if (state === undefined) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$signer",
      "local approval signer must be created in this process",
    );
  }
  return state;
}

function keySnapshot(
  state: LocalApprovalSigningKeyState,
): LocalApprovalSigningKeySnapshot {
  return Object.freeze({
    keyId: state.keyId,
    publicKeyFingerprint: state.publicKeyFingerprint,
    status: state.closed ? "closed" : "active",
  });
}

function signerStatus(
  state: LocalApprovalGrantSignerState,
): LocalApprovalGrantSignerStatus {
  if (state.closed) return "closed";
  if (state.key.closed || state.key.privateKey === undefined) return "key-closed";
  if (readSignerClock(state) >= state.expiresAtMs) {
    return "expired";
  }
  if (state.usedSignatures >= state.maxSignatures) return "exhausted";
  return "active";
}

function signerSnapshot(
  state: LocalApprovalGrantSignerState,
): LocalApprovalGrantSignerSnapshot {
  return Object.freeze({
    keyId: state.key.keyId,
    publicKeyFingerprint: state.key.publicKeyFingerprint,
    status: signerStatus(state),
    expiresAt: state.expiresAt,
    maxSignatures: state.maxSignatures,
    usedSignatures: state.usedSignatures,
    remainingSignatures: Math.max(
      0,
      state.maxSignatures - state.usedSignatures,
    ),
  });
}

function signWithLocalApprovalKey(
  signer: unknown,
  signingDigest: Sha256Digest,
  signal: AbortSignal,
): string {
  const state = approvalSignerState(signer);
  if (!isSha256Digest(signingDigest)) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$signingDigest",
      "expected a canonical SHA-256 signing digest",
    );
  }
  if (!(signal instanceof AbortSignal) || isProxy(signal)) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$signal",
      "expected a genuine non-proxied AbortSignal",
    );
  }
  if (state.closed) {
    throw localApprovalError(
      "permission-approval-signer-closed",
      "$signer",
      "local approval signer is closed",
    );
  }
  if (state.key.closed || state.key.privateKey === undefined) {
    throw localApprovalError(
      "permission-approval-key-closed",
      "$key",
      "local approval key is closed",
    );
  }
  const startedAt = readSignerClock(state);
  if (startedAt >= state.expiresAtMs) {
    throw localApprovalError(
      "permission-approval-signer-expired",
      "$signer.expiresAt",
      "local approval signer has expired",
    );
  }
  if (signal.aborted) {
    throw localApprovalError(
      "permission-approval-signing-cancelled",
      "$signal",
      "local approval signing was cancelled before it started",
    );
  }
  if (state.usedSignatures >= state.maxSignatures) {
    throw localApprovalError(
      "permission-approval-signer-exhausted",
      "$signer",
      "local approval signer use limit is exhausted",
    );
  }

  state.usedSignatures += 1;
  let signature: Buffer;
  try {
    signature = signDigest(
      null,
      Buffer.from(signingDigest, "utf8"),
      state.key.privateKey,
    );
  } catch {
    throw localApprovalError(
      "permission-approval-signing-failed",
      "$signer",
      "local approval signing failed",
    );
  }
  if (signature.length !== 64) {
    throw localApprovalError(
      "permission-approval-signing-failed",
      "$signer",
      "local approval signing returned an invalid signature",
    );
  }
  if (signal.aborted) {
    throw localApprovalError(
      "permission-approval-signing-cancelled",
      "$signal",
      "local approval signing was cancelled before settlement",
    );
  }
  if (readSignerClock(state) >= state.expiresAtMs) {
    throw localApprovalError(
      "permission-approval-signer-expired",
      "$signer.expiresAt",
      "local approval signer expired before settlement",
    );
  }
  if (state.key.closed || state.key.privateKey === undefined) {
    throw localApprovalError(
      "permission-approval-key-closed",
      "$key",
      "local approval key closed before settlement",
    );
  }
  return signature.toString("base64url");
}

export function createLocalApprovalSigningKey(
  options: CreateLocalApprovalSigningKeyOptions,
): LocalApprovalSigningKey {
  const record = snapshotExactDataRecord(options, ["keyId", "privateKeyPem"]);
  if (record === undefined || !isStableId(record.keyId)) {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options",
      "expected exact local approval key options",
    );
  }
  const privateKeyPem = record.privateKeyPem;
  if (
    typeof privateKeyPem !== "string" ||
    privateKeyPem.length === 0 ||
    Buffer.byteLength(privateKeyPem, "utf8") >
      LOCAL_APPROVAL_KEY_MAX_PEM_BYTES
  ) {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "expected a bounded canonical PKCS#8 private key",
    );
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({
      key: privateKeyPem,
      format: "pem",
      type: "pkcs8",
    });
  } catch {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "private key import failed",
    );
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "local approval keys must use Ed25519",
    );
  }
  let canonicalPrivateKey: string | Buffer;
  let publicKeyPem: string | Buffer;
  let publicKeyDer: Buffer;
  try {
    canonicalPrivateKey = privateKey.export({
      type: "pkcs8",
      format: "pem",
    });
    const publicKey = createPublicKey(privateKey);
    publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    publicKeyDer = publicKey.export({ type: "spki", format: "der" });
  } catch {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "approval key derivation failed",
    );
  }
  if (
    typeof canonicalPrivateKey !== "string" ||
    canonicalPrivateKey !== privateKeyPem
  ) {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "private key must use canonical unencrypted PKCS#8 PEM",
    );
  }
  if (typeof publicKeyPem !== "string") {
    throw localApprovalError(
      "permission-approval-key-invalid",
      "$options.privateKeyPem",
      "public key derivation failed",
    );
  }
  const state: LocalApprovalSigningKeyState = {
    keyId: record.keyId,
    publicKeyPem,
    publicKeyFingerprint: sha256Digest(publicKeyDer),
    privateKey,
    closed: false,
  };
  const key: LocalApprovalSigningKey = Object.freeze({ keyId: state.keyId });
  keyStates.set(key, state);
  return key;
}

export function inspectLocalApprovalSigningKey(
  key: LocalApprovalSigningKey,
): LocalApprovalSigningKeySnapshot {
  return keySnapshot(signingKeyState(key));
}

export function getLocalApprovalTrustedKey(
  key: LocalApprovalSigningKey,
): TrustedApprovalKey {
  const state = signingKeyState(key);
  return Object.freeze({
    keyId: state.keyId,
    publicKeyPem: state.publicKeyPem,
  });
}

export function closeLocalApprovalSigningKey(
  key: LocalApprovalSigningKey,
): LocalApprovalSigningKeySnapshot {
  const state = signingKeyState(key);
  state.closed = true;
  state.privateKey = undefined;
  return keySnapshot(state);
}

export function createLocalApprovalGrantSigner(
  key: LocalApprovalSigningKey,
  options: CreateLocalApprovalGrantSignerOptions,
): LocalApprovalGrantSigner {
  const keyState = signingKeyState(key);
  if (keyState.closed || keyState.privateKey === undefined) {
    throw localApprovalError(
      "permission-approval-key-closed",
      "$key",
      "local approval key is closed",
    );
  }
  const record = snapshotEnumerableDataRecord(options);
  const names = record === undefined ? [] : Object.keys(record).sort();
  if (
    record === undefined ||
    (names.length !== 2 && names.length !== 3) ||
    names[0] !== "expiresAt" ||
    names[1] !== "maxSignatures" ||
    (names.length === 3 && names[2] !== "now")
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$options",
      "expected exact local approval signer options",
    );
  }
  const nowValue = record["now"];
  if (nowValue !== undefined && typeof nowValue !== "function") {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$options.now",
      "expected a clock function",
    );
  }
  const now = (nowValue as (() => number) | undefined) ?? Date.now;
  const createdAt = readClock(now, "$options.now");
  const expiresAt = canonicalTimestamp(
    record["expiresAt"],
    "$options.expiresAt",
  );
  if (
    expiresAt.milliseconds <= createdAt ||
    expiresAt.milliseconds - createdAt >
      LOCAL_APPROVAL_SIGNER_MAX_LIFETIME_MS
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$options.expiresAt",
      "signer expiry must be in the future and within the lifetime limit",
    );
  }
  const maxSignatures = record["maxSignatures"];
  if (
    typeof maxSignatures !== "number" ||
    !Number.isSafeInteger(maxSignatures) ||
    maxSignatures < 1 ||
    maxSignatures > LOCAL_APPROVAL_SIGNER_MAX_SIGNATURES
  ) {
    throw localApprovalError(
      "permission-approval-signer-invalid",
      "$options.maxSignatures",
      "signer signature limit is outside the supported range",
    );
  }

  const state: LocalApprovalGrantSignerState = {
    key: keyState,
    expiresAt: expiresAt.text,
    expiresAtMs: expiresAt.milliseconds,
    maxSignatures,
    now,
    lastObservedAt: createdAt,
    usedSignatures: 0,
    closed: false,
  };
  function sign(
    this: LocalApprovalGrantSigner,
    signingDigest: Sha256Digest,
    signal: AbortSignal,
  ): string {
    return signWithLocalApprovalKey(this, signingDigest, signal);
  }
  const signer: LocalApprovalGrantSigner = Object.freeze({
    keyId: keyState.keyId,
    sign,
  });
  signerStates.set(signer, state);
  return signer;
}

export function inspectLocalApprovalGrantSigner(
  signer: LocalApprovalGrantSigner,
): LocalApprovalGrantSignerSnapshot {
  return signerSnapshot(approvalSignerState(signer));
}

export function closeLocalApprovalGrantSigner(
  signer: LocalApprovalGrantSigner,
): LocalApprovalGrantSignerSnapshot {
  const state = approvalSignerState(signer);
  state.closed = true;
  return signerSnapshot(state);
}
