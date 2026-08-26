import {
  canonicalizeJson,
  isSha256Digest,
  sha256Digest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { writeProjectFileCas } from "./cas-write.js";
import { CoreBoundaryError } from "./errors.js";
import {
  BoundedFileReadLimitError,
  readFileHandleBounded,
} from "./bounded-file-read.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type FilesystemIdentity,
  type ResolvedProjectPath,
} from "./project-path.js";

export const PROJECT_LANE_LOCK_PATH: string =
  ".ai-game-playbook/locks/project-mutation.lock";
export const PROJECT_LANE_MAX_LEASE_MS: number = 5 * 60 * 1_000;
export const PROJECT_LANE_MAX_WAIT_MS: number = 60 * 1_000;
export const PROJECT_LANE_MIN_LEASE_MS: number = 500;
export const PROJECT_LANE_MIN_POLL_MS: number = 10;
export const PROJECT_LANE_MAX_POLL_MS: number = 1_000;

const PROJECT_LANE_LOCK_DIRECTORY = ".ai-game-playbook/locks";
const PROJECT_LANE_MAX_LOCK_BYTES = 16 * 1_024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CURRENT_PROCESS_STARTED_AT: string = new Date(
  Date.now() - Math.max(0, Math.round(process.uptime() * 1_000)),
).toISOString();
const CURRENT_PROCESS_INSTANCE_NONCE: string = randomUUID();
const projectLaneLeaseInstances = new WeakSet<object>();

class LaneSnapshotChangedError extends CoreBoundaryError {
  constructor() {
    super(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock changed while it was read",
    );
  }
}

export type ProjectMutationLane =
  | "build-bound"
  | "editor-bound"
  | "project-write";

export interface ProjectLaneOwnerProcess {
  readonly pid: number;
  readonly startedAt: string;
  readonly instanceNonce: string;
}

export interface ProjectLaneLeaseRecord {
  readonly schemaVersion: "1";
  readonly leaseNonce: string;
  readonly ownerRunId: string;
  readonly ownerProcess: ProjectLaneOwnerProcess;
  readonly rootIdentityDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly lane: ProjectMutationLane;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export type ProjectLaneOwnerStatus =
  | "alive-unverified"
  | "current-runtime"
  | "not-running"
  | "unknown";

export type ProjectLaneInspection =
  | { readonly status: "free" }
  | {
      readonly status:
        | "expired-owner-alive"
        | "expired-owner-unknown"
        | "held"
        | "recoverable-stale";
      readonly ownerStatus: ProjectLaneOwnerStatus;
      readonly lockDigest: Sha256Digest;
      readonly lease: ProjectLaneLeaseRecord;
    };

export interface AcquireProjectLaneRequest {
  readonly root: CanonicalProjectRoot;
  readonly projectIdentityDigest: Sha256Digest;
  readonly runId: string;
  readonly lane: ProjectMutationLane;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly leaseDurationMs: number;
  readonly waitTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly signal: AbortSignal | null;
}

export type ProjectLaneLeaseState =
  | "active"
  | "lost"
  | "released"
  | "releasing"
  | "renewing"
  | "uncertain";

export type ProjectLaneAcquisition = "fresh" | "recovered-stale";

export interface ProjectLaneLease {
  readonly state: ProjectLaneLeaseState;
  readonly acquisition: ProjectLaneAcquisition;
  readonly recoveredLeaseDigest?: Sha256Digest;
  readonly leaseNonce: string;
  readonly runId: string;
  readonly lane: ProjectMutationLane;
  readonly rootIdentityDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
  readonly renewAfterMs: number;
  assertOwned(): Promise<ProjectLaneLeaseRecord>;
  renew(): Promise<ProjectLaneLeaseRecord>;
  release(): Promise<void>;
}

export function assertProjectLaneLease(
  value: unknown,
): asserts value is ProjectLaneLease {
  if (
    value === null ||
    typeof value !== "object" ||
    !projectLaneLeaseInstances.has(value)
  ) {
    throw new CoreBoundaryError(
      "project-lane-state-invalid",
      "$projectLane",
      "project lane lease must be produced by this core runtime process",
    );
  }
}

interface ValidatedAcquireProjectLaneRequest {
  readonly root: CanonicalProjectRoot;
  readonly projectIdentityDigest: Sha256Digest;
  readonly runId: string;
  readonly lane: ProjectMutationLane;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly leaseDurationMs: number;
  readonly waitTimeoutMs: number;
  readonly pollIntervalMs: number;
  readonly signal: AbortSignal | null;
}

interface LaneFileSnapshot extends FilesystemIdentity {
  readonly absolutePath: string;
  readonly parentIdentity: FilesystemIdentity;
  readonly digest: Sha256Digest;
  readonly mode: number;
  readonly record: ProjectLaneLeaseRecord;
}

interface BoundLaneDirectory extends FilesystemIdentity {
  readonly absolutePath: string;
}

interface LaneLeaseContext {
  readonly request: ValidatedAcquireProjectLaneRequest;
  readonly directory: BoundLaneDirectory;
  readonly acquisition: ProjectLaneAcquisition;
  readonly recoveredLeaseDigest?: Sha256Digest;
}

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isAlreadyPresent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function sameIdentity(
  left: FilesystemIdentity,
  right: FilesystemIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function identityOf(stats: BigIntStats): FilesystemIdentity {
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  };
}

function identityMatches(
  identity: FilesystemIdentity,
  stats: BigIntStats,
): boolean {
  return (
    identity.device === stats.dev.toString() &&
    identity.inode === stats.ino.toString()
  );
}

function isCanonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isAborted(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

function invalidLaneRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-project-lane-request",
    "$projectLane",
    message,
  );
}

function validateAcquireRequest(
  value: AcquireProjectLaneRequest,
): ValidatedAcquireProjectLaneRequest {
  if (typeof value !== "object" || value === null) {
    invalidLaneRequest("project lane request must be an object");
  }
  const expectedKeys = [
    "root",
    "projectIdentityDigest",
    "runId",
    "lane",
    "leaseDurationMs",
    "waitTimeoutMs",
    "pollIntervalMs",
    "signal",
    ...(value.editorSessionIdentityDigest === undefined
      ? []
      : ["editorSessionIdentityDigest"]),
  ];
  if (!objectHasExactKeys(value, expectedKeys)) {
    invalidLaneRequest("project lane request contains undeclared fields");
  }
  if (!isSha256Digest(value.projectIdentityDigest)) {
    invalidLaneRequest("project identity must be an exact SHA-256 digest");
  }
  if (!isCanonicalUuid(value.runId)) {
    invalidLaneRequest("owner run ID must be a canonical UUID");
  }
  if (
    value.lane !== "project-write" &&
    value.lane !== "editor-bound" &&
    value.lane !== "build-bound"
  ) {
    invalidLaneRequest("only mutating project lanes can acquire this lock");
  }
  if (
    (value.lane === "editor-bound" &&
      !isSha256Digest(value.editorSessionIdentityDigest)) ||
    (value.lane !== "editor-bound" &&
      value.editorSessionIdentityDigest !== undefined)
  ) {
    invalidLaneRequest(
      "editor-bound lanes require one session digest and other lanes prohibit it",
    );
  }
  if (
    !Number.isSafeInteger(value.leaseDurationMs) ||
    value.leaseDurationMs < PROJECT_LANE_MIN_LEASE_MS ||
    value.leaseDurationMs > PROJECT_LANE_MAX_LEASE_MS
  ) {
    invalidLaneRequest("lease duration is outside the runtime boundary");
  }
  if (
    !Number.isSafeInteger(value.waitTimeoutMs) ||
    value.waitTimeoutMs < 0 ||
    value.waitTimeoutMs > PROJECT_LANE_MAX_WAIT_MS
  ) {
    invalidLaneRequest("lane wait timeout is outside the runtime boundary");
  }
  if (
    !Number.isSafeInteger(value.pollIntervalMs) ||
    value.pollIntervalMs < PROJECT_LANE_MIN_POLL_MS ||
    value.pollIntervalMs > PROJECT_LANE_MAX_POLL_MS
  ) {
    invalidLaneRequest("lane poll interval is outside the runtime boundary");
  }
  if (
    value.signal !== null &&
    !(value.signal instanceof AbortSignal)
  ) {
    invalidLaneRequest("lane cancellation signal is invalid");
  }
  return {
    root: value.root,
    projectIdentityDigest: value.projectIdentityDigest,
    runId: value.runId,
    lane: value.lane,
    ...(value.editorSessionIdentityDigest === undefined
      ? {}
      : { editorSessionIdentityDigest: value.editorSessionIdentityDigest }),
    leaseDurationMs: value.leaseDurationMs,
    waitTimeoutMs: value.waitTimeoutMs,
    pollIntervalMs: value.pollIntervalMs,
    signal: value.signal,
  };
}

function freezeRecord(
  record: ProjectLaneLeaseRecord,
): ProjectLaneLeaseRecord {
  return Object.freeze({
    ...record,
    ownerProcess: Object.freeze({ ...record.ownerProcess }),
  });
}

function validateLeaseRecord(value: unknown): ProjectLaneLeaseRecord {
  if (typeof value !== "object" || value === null) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock must contain an object record",
    );
  }
  const candidate = value as Record<string, unknown>;
  const expectedKeys = [
    "schemaVersion",
    "leaseNonce",
    "ownerRunId",
    "ownerProcess",
    "rootIdentityDigest",
    "projectIdentityDigest",
    "lane",
    "acquiredAt",
    "heartbeatAt",
    "expiresAt",
    ...(candidate["editorSessionIdentityDigest"] === undefined
      ? []
      : ["editorSessionIdentityDigest"]),
  ];
  const ownerValue = candidate["ownerProcess"];
  if (
    !objectHasExactKeys(candidate, expectedKeys) ||
    candidate["schemaVersion"] !== "1" ||
    !isCanonicalUuid(candidate["leaseNonce"]) ||
    !isCanonicalUuid(candidate["ownerRunId"]) ||
    typeof ownerValue !== "object" ||
    ownerValue === null ||
    !objectHasExactKeys(ownerValue, ["pid", "startedAt", "instanceNonce"])
  ) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock identity fields are invalid",
    );
  }
  const owner = ownerValue as Record<string, unknown>;
  if (
    !Number.isSafeInteger(owner["pid"]) ||
    (owner["pid"] as number) < 1 ||
    (owner["pid"] as number) > 2_147_483_647 ||
    !isCanonicalTimestamp(owner["startedAt"]) ||
    !isCanonicalUuid(owner["instanceNonce"]) ||
    !isSha256Digest(candidate["rootIdentityDigest"]) ||
    !isSha256Digest(candidate["projectIdentityDigest"]) ||
    (candidate["lane"] !== "project-write" &&
      candidate["lane"] !== "editor-bound" &&
      candidate["lane"] !== "build-bound") ||
    !isCanonicalTimestamp(candidate["acquiredAt"]) ||
    !isCanonicalTimestamp(candidate["heartbeatAt"]) ||
    !isCanonicalTimestamp(candidate["expiresAt"])
  ) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock values are invalid",
    );
  }
  const editorDigest = candidate["editorSessionIdentityDigest"];
  if (
    (candidate["lane"] === "editor-bound" &&
      !isSha256Digest(editorDigest)) ||
    (candidate["lane"] !== "editor-bound" && editorDigest !== undefined)
  ) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock has an invalid editor session binding",
    );
  }
  const acquiredMs = Date.parse(candidate["acquiredAt"] as string);
  const heartbeatMs = Date.parse(candidate["heartbeatAt"] as string);
  const expiresMs = Date.parse(candidate["expiresAt"] as string);
  if (
    heartbeatMs < acquiredMs ||
    expiresMs <= heartbeatMs ||
    expiresMs - heartbeatMs > PROJECT_LANE_MAX_LEASE_MS
  ) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock timestamps contradict the lease boundary",
    );
  }
  return freezeRecord({
    schemaVersion: "1",
    leaseNonce: candidate["leaseNonce"] as string,
    ownerRunId: candidate["ownerRunId"] as string,
    ownerProcess: {
      pid: owner["pid"] as number,
      startedAt: owner["startedAt"] as string,
      instanceNonce: owner["instanceNonce"] as string,
    },
    rootIdentityDigest: candidate["rootIdentityDigest"] as Sha256Digest,
    projectIdentityDigest: candidate[
      "projectIdentityDigest"
    ] as Sha256Digest,
    lane: candidate["lane"] as ProjectMutationLane,
    ...(editorDigest === undefined
      ? {}
      : { editorSessionIdentityDigest: editorDigest as Sha256Digest }),
    acquiredAt: candidate["acquiredAt"] as string,
    heartbeatAt: candidate["heartbeatAt"] as string,
    expiresAt: candidate["expiresAt"] as string,
  });
}

function serializeLeaseRecord(record: ProjectLaneLeaseRecord): Buffer {
  return Buffer.from(`${canonicalizeJson(record)}\n`, "utf8");
}

async function bindLaneDirectory(
  root: CanonicalProjectRoot,
): Promise<BoundLaneDirectory> {
  const resolved = await resolveProjectPath(root, PROJECT_LANE_LOCK_DIRECTORY, {
    expectedType: "directory",
    existence: "required",
  });
  if (resolved.targetIdentity === undefined) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.directory",
      "project lane directory has no stable filesystem identity",
    );
  }
  return Object.freeze({
    absolutePath: resolved.absolutePath,
    ...resolved.targetIdentity,
  });
}

async function assertLaneDirectory(
  root: CanonicalProjectRoot,
  directory: BoundLaneDirectory,
): Promise<void> {
  await assertProjectRootIdentity(root);
  const current = await bindLaneDirectory(root);
  if (
    current.absolutePath !== directory.absolutePath ||
    !sameIdentity(current, directory)
  ) {
    throw new CoreBoundaryError(
      "project-lane-ownership-lost",
      "$projectLane.directory",
      "project lane directory changed after it was bound",
    );
  }
}

async function readLockSnapshot(
  root: CanonicalProjectRoot,
  directory?: BoundLaneDirectory,
): Promise<LaneFileSnapshot | undefined> {
  await assertProjectRootIdentity(root);
  if (directory !== undefined) {
    await assertLaneDirectory(root, directory);
  }
  let resolved: ResolvedProjectPath;
  try {
    resolved = await resolveProjectPath(root, PROJECT_LANE_LOCK_PATH, {
      expectedType: "file",
      existence: "optional",
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      if (directory !== undefined) {
        await assertLaneDirectory(root, directory);
      } else {
        await assertProjectRootIdentity(root);
      }
      return undefined;
    }
    throw error;
  }
  if (resolved.kind === "absent") {
    return undefined;
  }
  if (resolved.targetIdentity === undefined) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock has no stable filesystem identity",
    );
  }
  if (
    directory !== undefined &&
    !sameIdentity(resolved.parentIdentity, directory)
  ) {
    throw new CoreBoundaryError(
      "project-lane-ownership-lost",
      "$projectLane.directory",
      "project lane lock parent changed after it was bound",
    );
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle: FileHandle;
  try {
    handle = await open(resolved.absolutePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock could not be opened without following links",
    );
  }
  let content: Buffer | undefined;
  let stats: BigIntStats | undefined;
  let operationError: unknown;
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      !identityMatches(resolved.targetIdentity, before) ||
      before.size > BigInt(PROJECT_LANE_MAX_LOCK_BYTES)
    ) {
      throw new CoreBoundaryError(
        "project-lane-lock-invalid",
        "$projectLane.lock",
        "project lane lock type, identity, or byte size is invalid",
      );
    }
    try {
      content = await readFileHandleBounded(
        handle,
        PROJECT_LANE_MAX_LOCK_BYTES,
      );
    } catch (error) {
      if (error instanceof BoundedFileReadLimitError) {
        throw new CoreBoundaryError(
          "project-lane-lock-invalid",
          "$projectLane.lock",
          "project lane lock exceeded its byte limit while it was read",
        );
      }
      throw error;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw new LaneSnapshotChangedError();
    }
    stats = after;
  } catch (error) {
    operationError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    operationError ??= error;
  }
  if (operationError !== undefined) {
    if (operationError instanceof CoreBoundaryError) {
      throw operationError;
    }
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock could not be read and closed safely",
    );
  }
  if (content === undefined || stats === undefined) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock snapshot was not produced",
    );
  }
  const mode = Number(stats.mode & 0o777n);
  if (process.platform !== "win32" && (mode & 0o077) !== 0) {
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock permissions expose owner metadata",
    );
  }
  let record: ProjectLaneLeaseRecord;
  try {
    const text = content.toString("utf8");
    record = validateLeaseRecord(JSON.parse(text) as unknown);
    if (text !== `${canonicalizeJson(record)}\n`) {
      throw new Error("non-canonical lock record");
    }
  } catch (error) {
    if (error instanceof CoreBoundaryError) {
      throw error;
    }
    throw new CoreBoundaryError(
      "project-lane-lock-invalid",
      "$projectLane.lock",
      "project lane lock is malformed or non-canonical",
    );
  }
  return Object.freeze({
    absolutePath: resolved.absolutePath,
    parentIdentity: Object.freeze({ ...resolved.parentIdentity }),
    digest: sha256Digest(content),
    mode,
    record,
    ...identityOf(stats),
  });
}

function ownerStatus(record: ProjectLaneLeaseRecord): ProjectLaneOwnerStatus {
  if (record.ownerProcess.pid === process.pid) {
    return record.ownerProcess.startedAt === CURRENT_PROCESS_STARTED_AT &&
      record.ownerProcess.instanceNonce === CURRENT_PROCESS_INSTANCE_NONCE
      ? "current-runtime"
      : "alive-unverified";
  }
  try {
    process.kill(record.ownerProcess.pid, 0);
    return "alive-unverified";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    ) {
      return "not-running";
    }
    return "unknown";
  }
}

function inspectionFromSnapshot(
  snapshot: LaneFileSnapshot,
): Exclude<ProjectLaneInspection, { readonly status: "free" }> {
  const status = ownerStatus(snapshot.record);
  const expired = Date.parse(snapshot.record.expiresAt) <= Date.now();
  return Object.freeze({
    status: !expired
      ? "held"
      : status === "not-running"
        ? "recoverable-stale"
        : status === "unknown"
          ? "expired-owner-unknown"
          : "expired-owner-alive",
    ownerStatus: status,
    lockDigest: snapshot.digest,
    lease: snapshot.record,
  });
}

async function inspectBoundProjectLane(
  root: CanonicalProjectRoot,
  directory?: BoundLaneDirectory,
): Promise<ProjectLaneInspection> {
  const boundDirectory = directory ?? (await bindLaneDirectory(root));
  const snapshot = await readLockSnapshot(root, boundDirectory);
  return snapshot === undefined
    ? Object.freeze({ status: "free" })
    : inspectionFromSnapshot(snapshot);
}

function validateInspectRequest(value: {
  readonly root: CanonicalProjectRoot;
}): CanonicalProjectRoot {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(value, ["root"])
  ) {
    invalidLaneRequest("project lane inspection contains undeclared fields");
  }
  return value.root;
}

export function inspectProjectLane(value: {
  readonly root: CanonicalProjectRoot;
}): Promise<ProjectLaneInspection> {
  try {
    const root = validateInspectRequest(value);
    return inspectBoundProjectLane(root);
  } catch (error) {
    return Promise.reject(error);
  }
}

function recordForAcquisition(
  request: ValidatedAcquireProjectLaneRequest,
  leaseNonce: string,
): ProjectLaneLeaseRecord {
  const now = Date.now();
  const timestamp = new Date(now).toISOString();
  return freezeRecord({
    schemaVersion: "1",
    leaseNonce,
    ownerRunId: request.runId,
    ownerProcess: {
      pid: process.pid,
      startedAt: CURRENT_PROCESS_STARTED_AT,
      instanceNonce: CURRENT_PROCESS_INSTANCE_NONCE,
    },
    rootIdentityDigest: request.root.identityDigest,
    projectIdentityDigest: request.projectIdentityDigest,
    lane: request.lane,
    ...(request.editorSessionIdentityDigest === undefined
      ? {}
      : {
          editorSessionIdentityDigest:
            request.editorSessionIdentityDigest,
        }),
    acquiredAt: timestamp,
    heartbeatAt: timestamp,
    expiresAt: new Date(now + request.leaseDurationMs).toISOString(),
  });
}

async function safelyRemoveTemporaryFile(
  path: string,
  identity: FilesystemIdentity,
): Promise<void> {
  const current = await lstat(path, { bigint: true });
  if (!current.isFile() || !identityMatches(identity, current)) {
    throw new CoreBoundaryError(
      "project-lane-lock-write-failed",
      "$projectLane.lock",
      "temporary lane file identity changed before cleanup",
      true,
    );
  }
  await unlink(path);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicCreateLock(
  request: ValidatedAcquireProjectLaneRequest,
  directory: BoundLaneDirectory,
  record: ProjectLaneLeaseRecord,
): Promise<LaneFileSnapshot | undefined> {
  await assertLaneDirectory(request.root, directory);
  let target: ResolvedProjectPath;
  try {
    target = await resolveProjectPath(request.root, PROJECT_LANE_LOCK_PATH, {
      expectedType: "file",
      existence: "optional",
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      await assertLaneDirectory(request.root, directory);
      return undefined;
    }
    throw error;
  }
  if (!sameIdentity(target.parentIdentity, directory)) {
    throw new CoreBoundaryError(
      "project-lane-ownership-lost",
      "$projectLane.directory",
      "project lane lock parent changed before acquisition",
    );
  }
  if (target.kind !== "absent") {
    return undefined;
  }

  const content = serializeLeaseRecord(record);
  const temporaryPath = join(
    directory.absolutePath,
    `.agpb-lane-${randomUUID()}.tmp`,
  );
  let handle: FileHandle | undefined;
  let temporaryIdentity: FilesystemIdentity | undefined;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    const opened = await handle.stat({ bigint: true });
    temporaryIdentity = identityOf(opened);
    await handle.writeFile(content);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (
      !written.isFile() ||
      !identityMatches(temporaryIdentity, written) ||
      written.size !== BigInt(content.byteLength)
    ) {
      throw new Error("temporary lane file postcondition failed");
    }
  } catch (error) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
    if (temporaryIdentity !== undefined) {
      await safelyRemoveTemporaryFile(
        temporaryPath,
        temporaryIdentity,
      ).catch(() => undefined);
    }
    throw new CoreBoundaryError(
      "project-lane-lock-write-failed",
      "$projectLane.lock",
      "project lane lock could not be staged safely",
      true,
    );
  }
  try {
    await handle.close();
  } catch {
    throw new CoreBoundaryError(
      "project-lane-lock-write-failed",
      "$projectLane.lock",
      "project lane staging handle could not be closed safely",
      true,
    );
  }
  if (temporaryIdentity === undefined) {
    throw new CoreBoundaryError(
      "project-lane-lock-write-failed",
      "$projectLane.lock",
      "project lane staging identity was not captured",
      true,
    );
  }

  await assertLaneDirectory(request.root, directory);
  let linked = false;
  try {
    await link(temporaryPath, target.absolutePath);
    linked = true;
  } catch (error) {
    if (!isAlreadyPresent(error)) {
      throw new CoreBoundaryError(
        "project-lane-lock-write-failed",
        "$projectLane.lock",
        "project lane lock atomic create failed",
        true,
      );
    }
  } finally {
    try {
      await safelyRemoveTemporaryFile(temporaryPath, temporaryIdentity);
    } catch {
      throw new CoreBoundaryError(
        "project-lane-lock-write-failed",
        "$projectLane.lock",
        "project lane staging file could not be cleaned safely",
        linked,
      );
    }
  }
  if (!linked) {
    return undefined;
  }
  let snapshot: LaneFileSnapshot;
  try {
    const observed = await readLockSnapshot(request.root, directory);
    if (
      observed === undefined ||
      observed.digest !== sha256Digest(content) ||
      !sameIdentity(observed, temporaryIdentity) ||
      observed.record.leaseNonce !== record.leaseNonce
    ) {
      throw new Error("lane lock postcondition mismatch");
    }
    await syncDirectory(directory.absolutePath);
    snapshot = observed;
  } catch {
    throw new CoreBoundaryError(
      "project-lane-lock-write-failed",
      "$projectLane.lock",
      "project lane lock atomic create postcondition failed",
      true,
    );
  }
  return snapshot;
}

function assertRecordBinding(
  snapshot: LaneFileSnapshot,
  request: ValidatedAcquireProjectLaneRequest,
  leaseNonce: string,
): void {
  const record = snapshot.record;
  if (
    record.leaseNonce !== leaseNonce ||
    record.ownerRunId !== request.runId ||
    record.ownerProcess.pid !== process.pid ||
    record.ownerProcess.startedAt !== CURRENT_PROCESS_STARTED_AT ||
    record.ownerProcess.instanceNonce !== CURRENT_PROCESS_INSTANCE_NONCE ||
    record.rootIdentityDigest !== request.root.identityDigest ||
    record.projectIdentityDigest !== request.projectIdentityDigest ||
    record.lane !== request.lane ||
    record.editorSessionIdentityDigest !==
      request.editorSessionIdentityDigest
  ) {
    throw new CoreBoundaryError(
      "project-lane-ownership-lost",
      "$projectLane.lock",
      "project lane lock no longer belongs to this run and runtime",
    );
  }
}

async function moveLockToTombstone(
  root: CanonicalProjectRoot,
  directory: BoundLaneDirectory,
  expected: LaneFileSnapshot,
  errorCode: "project-lane-recovery-failed" | "project-lane-release-failed",
): Promise<void> {
  await assertLaneDirectory(root, directory);
  const current = await readLockSnapshot(root, directory);
  if (
    current === undefined ||
    current.digest !== expected.digest ||
    !sameIdentity(current, expected)
  ) {
    throw new CoreBoundaryError(
      errorCode === "project-lane-release-failed"
        ? "project-lane-ownership-lost"
        : errorCode,
      "$projectLane.lock",
      "project lane lock changed before atomic removal",
    );
  }
  const tombstonePath = join(
    directory.absolutePath,
    `.agpb-lane-${randomUUID()}.released`,
  );
  try {
    await rename(current.absolutePath, tombstonePath);
  } catch {
    throw new CoreBoundaryError(
      errorCode,
      "$projectLane.lock",
      "project lane lock removal outcome is uncertain",
      true,
    );
  }
  try {
    await assertLaneDirectory(root, directory);
    const moved = await lstat(tombstonePath, { bigint: true });
    if (!moved.isFile() || !identityMatches(current, moved)) {
      throw new Error("moved lane lock identity mismatch");
    }
    await assertReleasedIdentityIsNotCurrent(root, directory, current);
    await unlink(tombstonePath);
    try {
      await lstat(tombstonePath, { bigint: true });
      throw new Error("released lane tombstone still exists after cleanup");
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
    await assertReleasedIdentityIsNotCurrent(root, directory, current);
    await syncDirectory(directory.absolutePath);
  } catch {
    throw new CoreBoundaryError(
      errorCode,
      "$projectLane.lock",
      "project lane lock moved but cleanup could not be proven",
      true,
    );
  }
}

async function assertReleasedIdentityIsNotCurrent(
  root: CanonicalProjectRoot,
  directory: BoundLaneDirectory,
  released: LaneFileSnapshot,
): Promise<void> {
  await assertLaneDirectory(root, directory);
  let target: ResolvedProjectPath;
  try {
    target = await resolveProjectPath(root, PROJECT_LANE_LOCK_PATH, {
      expectedType: "file",
      existence: "optional",
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      await assertLaneDirectory(root, directory);
      return;
    }
    throw error;
  }
  if (!sameIdentity(target.parentIdentity, directory)) {
    throw new Error("project lane lock parent changed during release cleanup");
  }
  if (
    target.kind !== "absent" &&
    target.targetIdentity !== undefined &&
    sameIdentity(target.targetIdentity, released)
  ) {
    throw new Error("released project lane identity returned to the lock path");
  }
}

async function waitForRetry(
  milliseconds: number,
  signal: AbortSignal | null,
): Promise<void> {
  if (isAborted(signal)) {
    throw new CoreBoundaryError(
      "project-lane-cancelled",
      "$projectLane.signal",
      "project lane acquisition was cancelled",
    );
  }
  await new Promise<void>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
      reject(
        new CoreBoundaryError(
          "project-lane-cancelled",
          "$projectLane.signal",
          "project lane acquisition was cancelled while waiting",
        ),
      );
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (isAborted(signal)) {
      onAbort();
    }
  });
}

function refreshedRecord(
  record: ProjectLaneLeaseRecord,
  leaseDurationMs: number,
): ProjectLaneLeaseRecord {
  const heartbeatMs = Math.max(
    Date.now(),
    Date.parse(record.heartbeatAt) + 1,
  );
  return freezeRecord({
    ...record,
    heartbeatAt: new Date(heartbeatMs).toISOString(),
    expiresAt: new Date(heartbeatMs + leaseDurationMs).toISOString(),
  });
}

function createLease(
  context: LaneLeaseContext,
  initial: LaneFileSnapshot,
): ProjectLaneLease {
  let state: ProjectLaneLeaseState = "active";
  let snapshot = initial;

  const assertOwned = async (): Promise<ProjectLaneLeaseRecord> => {
    if (state !== "active") {
      throw new CoreBoundaryError(
        "project-lane-state-invalid",
        "$projectLane.state",
        `project lane ownership cannot be checked from ${state}`,
        state === "uncertain",
      );
    }
    let current: LaneFileSnapshot | undefined;
    try {
      current = await readLockSnapshot(
        context.request.root,
        context.directory,
      );
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "lost";
      throw error;
    }
    if (current === undefined) {
      state = "lost";
      throw new CoreBoundaryError(
        "project-lane-ownership-lost",
        "$projectLane.lock",
        "project lane lock disappeared",
      );
    }
    try {
      assertRecordBinding(
        current,
        context.request,
        initial.record.leaseNonce,
      );
    } catch (error) {
      state = "lost";
      throw error;
    }
    snapshot = current;
    if (Date.parse(current.record.expiresAt) <= Date.now()) {
      throw new CoreBoundaryError(
        "project-lane-expired",
        "$projectLane.lock",
        "project lane lease expired and must be renewed or released",
      );
    }
    return current.record;
  };

  const renew = async (): Promise<ProjectLaneLeaseRecord> => {
    if (state !== "active") {
      throw new CoreBoundaryError(
        "project-lane-state-invalid",
        "$projectLane.state",
        `project lane lease cannot renew from ${state}`,
        state === "uncertain",
      );
    }
    state = "renewing";
    try {
      const current = await readLockSnapshot(
        context.request.root,
        context.directory,
      );
      if (current === undefined) {
        state = "lost";
        throw new CoreBoundaryError(
          "project-lane-ownership-lost",
          "$projectLane.lock",
          "project lane lock disappeared before renewal",
        );
      }
      assertRecordBinding(
        current,
        context.request,
        initial.record.leaseNonce,
      );
      if (Date.parse(current.record.expiresAt) <= Date.now()) {
        state = "active";
        throw new CoreBoundaryError(
          "project-lane-expired",
          "$projectLane.lock",
          "expired project lane leases cannot renew",
        );
      }
      const next = refreshedRecord(
        current.record,
        context.request.leaseDurationMs,
      );
      await writeProjectFileCas({
        root: context.request.root,
        path: PROJECT_LANE_LOCK_PATH,
        content: serializeLeaseRecord(next),
        expected: { mode: "digest", digest: current.digest },
        maxBytes: PROJECT_LANE_MAX_LOCK_BYTES,
      });
      const renewed = await readLockSnapshot(
        context.request.root,
        context.directory,
      );
      if (renewed === undefined) {
        state = "lost";
        throw new CoreBoundaryError(
          "project-lane-ownership-lost",
          "$projectLane.lock",
          "project lane lock disappeared after renewal",
        );
      }
      assertRecordBinding(
        renewed,
        context.request,
        initial.record.leaseNonce,
      );
      if (renewed.record.heartbeatAt !== next.heartbeatAt) {
        state = "uncertain";
        throw new CoreBoundaryError(
          "project-lane-lock-write-failed",
          "$projectLane.lock",
          "project lane renewal postcondition is uncertain",
          true,
        );
      }
      snapshot = renewed;
      state = "active";
      return renewed.record;
    } catch (error) {
      if (state === "renewing") {
        state =
          error instanceof CoreBoundaryError && error.mutationUncertain
            ? "uncertain"
            : "lost";
      }
      throw error;
    }
  };

  const release = async (): Promise<void> => {
    if (state !== "active") {
      throw new CoreBoundaryError(
        "project-lane-state-invalid",
        "$projectLane.state",
        `project lane lease cannot release from ${state}`,
        state === "uncertain",
      );
    }
    state = "releasing";
    try {
      const current = await readLockSnapshot(
        context.request.root,
        context.directory,
      );
      if (current === undefined) {
        state = "lost";
        throw new CoreBoundaryError(
          "project-lane-ownership-lost",
          "$projectLane.lock",
          "project lane lock disappeared before release",
        );
      }
      assertRecordBinding(
        current,
        context.request,
        initial.record.leaseNonce,
      );
      await moveLockToTombstone(
        context.request.root,
        context.directory,
        current,
        "project-lane-release-failed",
      );
      state = "released";
    } catch (error) {
      if (state === "releasing") {
        state =
          error instanceof CoreBoundaryError && error.mutationUncertain
            ? "uncertain"
            : "lost";
      }
      throw error;
    }
  };

  const lease: ProjectLaneLease = Object.freeze({
    get state(): ProjectLaneLeaseState {
      return state;
    },
    acquisition: context.acquisition,
    ...(context.recoveredLeaseDigest === undefined
      ? {}
      : { recoveredLeaseDigest: context.recoveredLeaseDigest }),
    leaseNonce: initial.record.leaseNonce,
    runId: context.request.runId,
    lane: context.request.lane,
    rootIdentityDigest: context.request.root.identityDigest,
    projectIdentityDigest: context.request.projectIdentityDigest,
    ...(context.request.editorSessionIdentityDigest === undefined
      ? {}
      : {
          editorSessionIdentityDigest:
            context.request.editorSessionIdentityDigest,
        }),
    acquiredAt: initial.record.acquiredAt,
    get heartbeatAt(): string {
      return snapshot.record.heartbeatAt;
    },
    get expiresAt(): string {
      return snapshot.record.expiresAt;
    },
    renewAfterMs: Math.max(
      PROJECT_LANE_MIN_POLL_MS,
      Math.floor(context.request.leaseDurationMs / 2),
    ),
    assertOwned,
    renew,
    release,
  });
  projectLaneLeaseInstances.add(lease);
  return lease;
}

async function acquireValidatedProjectLane(
  request: ValidatedAcquireProjectLaneRequest,
): Promise<ProjectLaneLease> {
  if (isAborted(request.signal)) {
    throw new CoreBoundaryError(
      "project-lane-cancelled",
      "$projectLane.signal",
      "project lane acquisition was cancelled before preflight",
    );
  }
  await assertProjectRootIdentity(request.root);
  const directory = await bindLaneDirectory(request.root);
  const leaseNonce = randomUUID();
  const deadline = performance.now() + request.waitTimeoutMs;
  let recoveredLeaseDigest: Sha256Digest | undefined;

  while (true) {
    if (isAborted(request.signal)) {
      throw new CoreBoundaryError(
        "project-lane-cancelled",
        "$projectLane.signal",
        "project lane acquisition was cancelled",
      );
    }
    const record = recordForAcquisition(request, leaseNonce);
    const created = await atomicCreateLock(request, directory, record);
    if (created !== undefined) {
      return createLease(
        {
          request,
          directory,
          acquisition:
            recoveredLeaseDigest === undefined
              ? "fresh"
              : "recovered-stale",
          ...(recoveredLeaseDigest === undefined
            ? {}
            : { recoveredLeaseDigest }),
        },
        created,
      );
    }

    let existing: LaneFileSnapshot | undefined;
    try {
      existing = await readLockSnapshot(request.root, directory);
    } catch (error) {
      if (!(error instanceof LaneSnapshotChangedError)) {
        throw error;
      }
      await assertLaneDirectory(request.root, directory);
      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        throw new CoreBoundaryError(
          "project-lane-busy",
          "$projectLane.lock",
          "project lane lock did not stabilize before the wait deadline",
        );
      }
      await waitForRetry(
        Math.max(1, Math.min(request.pollIntervalMs, Math.ceil(remainingMs))),
        request.signal,
      );
      continue;
    }
    if (existing === undefined) {
      continue;
    }
    if (
      existing.record.rootIdentityDigest !== request.root.identityDigest ||
      existing.record.projectIdentityDigest !== request.projectIdentityDigest
    ) {
      throw new CoreBoundaryError(
        "project-lane-identity-mismatch",
        "$projectLane.lock",
        "existing project lane lock belongs to another project identity",
      );
    }
    const inspection = inspectionFromSnapshot(existing);
    if (inspection.status === "recoverable-stale") {
      const currentOwnerStatus = ownerStatus(existing.record);
      if (currentOwnerStatus !== "not-running") {
        continue;
      }
      await moveLockToTombstone(
        request.root,
        directory,
        existing,
        "project-lane-recovery-failed",
      );
      recoveredLeaseDigest = existing.digest;
      continue;
    }

    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) {
      throw new CoreBoundaryError(
        "project-lane-busy",
        "$projectLane.lock",
        inspection.status === "expired-owner-alive"
          ? "expired project lane lock still has a live or reused PID"
          : inspection.status === "expired-owner-unknown"
            ? "expired project lane lock owner could not be verified"
            : "project mutation lane is already owned",
      );
    }
    await waitForRetry(
      Math.max(1, Math.min(request.pollIntervalMs, Math.ceil(remainingMs))),
      request.signal,
    );
  }
}

export function acquireProjectLane(
  value: AcquireProjectLaneRequest,
): Promise<ProjectLaneLease> {
  try {
    const request = validateAcquireRequest(value);
    return acquireValidatedProjectLane(request);
  } catch (error) {
    return Promise.reject(error);
  }
}
