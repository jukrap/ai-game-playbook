import {
  digestCanonicalJson,
  parseSha256Digest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  access,
  lstat,
  open,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { CoreBoundaryError } from "./errors.js";
import {
  snapshotDenseDataArray,
  snapshotExactDataRecord,
} from "./plain-data.js";
import type { FilesystemIdentity } from "./project-path.js";

export const PROCESS_MAX_EXECUTABLE_BYTES: number = 2 * 1024 * 1024 * 1024;
export const PROCESS_MAX_ENVIRONMENT_KEYS: number = 128;

export interface BindProcessExecutableRequest {
  readonly path: unknown;
  readonly maxBytes: number;
  readonly allowedEnvironmentKeys: readonly unknown[];
}

export interface BoundProcessExecutable extends FilesystemIdentity {
  readonly requestedPath: string;
  readonly canonicalPath: string;
  readonly platform: NodeJS.Platform;
  readonly size: number;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
  readonly digest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
  readonly maxBytes: number;
  readonly allowedEnvironmentKeys: readonly string[];
}

interface ExecutableSnapshot extends FilesystemIdentity {
  readonly size: number;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
  readonly digest: Sha256Digest;
}

interface ValidatedBindRequest {
  readonly requestedPath: string;
  readonly maxBytes: number;
  readonly allowedEnvironmentKeys: readonly string[];
}

const boundProcessExecutables = new WeakSet<object>();
const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const blockedEnvironmentKeys = new Set(["__proto__", "constructor", "prototype"]);

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
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

function invalidExecutable(message: string): never {
  throw new CoreBoundaryError(
    "invalid-process-executable",
    "$executable",
    message,
  );
}

function validateEnvironmentKeys(value: unknown): readonly string[] {
  const values = snapshotDenseDataArray(value, PROCESS_MAX_ENVIRONMENT_KEYS);
  if (values === undefined) {
    invalidExecutable("environment allowlist exceeds the executable boundary");
  }
  const portableKeys = new Map<string, string>();
  for (const key of values) {
    if (
      typeof key !== "string" ||
      key.length > 128 ||
      !environmentKeyPattern.test(key) ||
      blockedEnvironmentKeys.has(key.toLowerCase())
    ) {
      invalidExecutable("environment allowlist contains an invalid key");
    }
    const folded = key.toLowerCase();
    if (portableKeys.has(folded)) {
      invalidExecutable("environment allowlist contains a portable key collision");
    }
    portableKeys.set(folded, key);
  }
  return Object.freeze([...portableKeys.values()].sort(compareText));
}

function validateBindRequest(
  value: BindProcessExecutableRequest,
): ValidatedBindRequest {
  const record = snapshotExactDataRecord(value, [
    "path",
    "maxBytes",
    "allowedEnvironmentKeys",
  ]);
  if (record === undefined) {
    invalidExecutable("executable request contains undeclared fields");
  }
  if (
    typeof record.path !== "string" ||
    record.path.length === 0 ||
    record.path.length > 32767 ||
    record.path.includes("\0") ||
    !isAbsolute(record.path)
  ) {
    invalidExecutable("executable path must be a bounded absolute path");
  }
  const requestedPath = normalize(record.path);
  if (
    process.platform === "win32" &&
    (requestedPath.startsWith("\\\\") ||
      requestedPath.startsWith("\\?\\") ||
      requestedPath.startsWith("\\.\\"))
  ) {
    invalidExecutable("UNC and device executable paths are outside the boundary");
  }
  const maxBytes = record.maxBytes;
  if (
    typeof maxBytes !== "number" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > PROCESS_MAX_EXECUTABLE_BYTES
  ) {
    invalidExecutable("executable byte budget is outside the runtime boundary");
  }
  return {
    requestedPath,
    maxBytes,
    allowedEnvironmentKeys: validateEnvironmentKeys(
      record.allowedEnvironmentKeys,
    ),
  };
}

function executableError(
  mode: "assert" | "bind",
  error: unknown,
  message: string,
): never {
  if (mode === "assert") {
    throw new CoreBoundaryError(
      "process-executable-drift",
      "$executable",
      message,
    );
  }
  if (isMissing(error)) {
    throw new CoreBoundaryError(
      "process-executable-not-found",
      "$executable",
      "executable does not exist",
    );
  }
  throw new CoreBoundaryError(
    "filesystem-operation-failed",
    "$executable",
    message,
  );
}

async function closeHandle(
  handle: FileHandle,
  mode: "assert" | "bind",
  operationError: unknown,
): Promise<void> {
  let finalError = operationError;
  try {
    await handle.close();
  } catch (error) {
    finalError ??= error;
  }
  if (finalError !== undefined) {
    if (finalError instanceof CoreBoundaryError) {
      throw finalError;
    }
    executableError(
      mode,
      finalError,
      "executable could not be read and closed safely",
    );
  }
}

async function snapshotExecutable(
  canonicalPath: string,
  maxBytes: number,
  mode: "assert" | "bind",
): Promise<ExecutableSnapshot> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle: FileHandle;
  try {
    handle = await open(canonicalPath, constants.O_RDONLY | noFollow);
  } catch (error) {
    executableError(
      mode,
      error,
      "executable could not be opened without following links",
    );
  }

  let snapshot: ExecutableSnapshot | undefined;
  let operationError: unknown;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new CoreBoundaryError(
        mode === "assert"
          ? "process-executable-drift"
          : "process-executable-not-file",
        "$executable",
        "executable target is not a regular file",
      );
    }
    if (before.size > BigInt(maxBytes)) {
      throw new CoreBoundaryError(
        mode === "assert"
          ? "process-executable-drift"
          : "process-executable-budget-exceeded",
        "$executable",
        "executable exceeds its declared byte budget",
      );
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < Number(before.size)) {
      const length = Math.min(buffer.byteLength, Number(before.size) - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      position !== Number(after.size)
    ) {
      throw new CoreBoundaryError(
        mode === "assert"
          ? "process-executable-drift"
          : "filesystem-operation-failed",
        "$executable",
        "executable changed while its digest was computed",
      );
    }
    snapshot = {
      ...identityOf(after),
      size: position,
      modifiedNanoseconds: after.mtimeNs.toString(),
      changedNanoseconds: after.ctimeNs.toString(),
      digest: parseSha256Digest(`sha256:${hash.digest("hex")}`),
    };
  } catch (error) {
    operationError = error;
  }
  await closeHandle(handle, mode, operationError);
  if (snapshot === undefined) {
    executableError(mode, undefined, "executable snapshot was not produced");
  }
  return snapshot;
}

export async function bindProcessExecutable(
  value: BindProcessExecutableRequest,
): Promise<BoundProcessExecutable> {
  const request = validateBindRequest(value);
  let requestedBefore: BigIntStats;
  let canonicalPath: string;
  let requestedAfter: BigIntStats;
  try {
    requestedBefore = await lstat(request.requestedPath, { bigint: true });
    canonicalPath = await realpath(request.requestedPath);
    requestedAfter = await lstat(request.requestedPath, { bigint: true });
  } catch (error) {
    executableError("bind", error, "executable path could not be inspected");
  }
  if (
    requestedBefore.isSymbolicLink() ||
    requestedAfter.isSymbolicLink() ||
    requestedBefore.dev !== requestedAfter.dev ||
    requestedBefore.ino !== requestedAfter.ino
  ) {
    throw new CoreBoundaryError(
      "process-executable-link",
      "$executable",
      "executable path must not be a symbolic link",
    );
  }
  if (
    process.platform === "win32" &&
    (canonicalPath.startsWith("\\\\") ||
      canonicalPath.startsWith("\\?\\") ||
      canonicalPath.startsWith("\\.\\"))
  ) {
    throw new CoreBoundaryError(
      "process-executable-link",
      "$executable",
      "executable path resolves outside the local drive boundary",
    );
  }
  try {
    await access(canonicalPath, constants.X_OK);
  } catch (error) {
    executableError("bind", error, "executable is not accessible for execution");
  }
  const snapshot = await snapshotExecutable(
    canonicalPath,
    request.maxBytes,
    "bind",
  );
  const executable: BoundProcessExecutable = Object.freeze({
    requestedPath: request.requestedPath,
    canonicalPath,
    platform: process.platform,
    size: snapshot.size,
    modifiedNanoseconds: snapshot.modifiedNanoseconds,
    changedNanoseconds: snapshot.changedNanoseconds,
    digest: snapshot.digest,
    identityDigest: digestCanonicalJson({
      path: process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath,
      platform: process.platform,
      device: snapshot.device,
      inode: snapshot.inode,
      size: snapshot.size,
      digest: snapshot.digest,
      allowedEnvironmentKeys: request.allowedEnvironmentKeys,
    }),
    maxBytes: request.maxBytes,
    allowedEnvironmentKeys: request.allowedEnvironmentKeys,
    device: snapshot.device,
    inode: snapshot.inode,
  });
  boundProcessExecutables.add(executable);
  return executable;
}

export async function assertProcessExecutableIdentity(
  executable: BoundProcessExecutable,
): Promise<void> {
  if (
    typeof executable !== "object" ||
    executable === null ||
    !boundProcessExecutables.has(executable)
  ) {
    invalidExecutable("executable was not bound by this core runtime");
  }
  let before: BigIntStats;
  let canonicalPath: string;
  let after: BigIntStats;
  try {
    before = await lstat(executable.canonicalPath, { bigint: true });
    canonicalPath = await realpath(executable.canonicalPath);
    after = await lstat(executable.canonicalPath, { bigint: true });
  } catch (error) {
    executableError("assert", error, "bound executable could not be inspected");
  }
  if (
    before.isSymbolicLink() ||
    after.isSymbolicLink() ||
    !before.isFile() ||
    !after.isFile() ||
    !samePath(canonicalPath, executable.canonicalPath) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    !identityMatches(executable, after) ||
    Number(after.size) !== executable.size ||
    after.mtimeNs.toString() !== executable.modifiedNanoseconds ||
    after.ctimeNs.toString() !== executable.changedNanoseconds
  ) {
    throw new CoreBoundaryError(
      "process-executable-drift",
      "$executable",
      "bound executable identity or metadata changed",
    );
  }
  const snapshot = await snapshotExecutable(
    executable.canonicalPath,
    executable.maxBytes,
    "assert",
  );
  if (
    snapshot.device !== executable.device ||
    snapshot.inode !== executable.inode ||
    snapshot.digest !== executable.digest ||
    snapshot.size !== executable.size ||
    snapshot.modifiedNanoseconds !== executable.modifiedNanoseconds ||
    snapshot.changedNanoseconds !== executable.changedNanoseconds
  ) {
    throw new CoreBoundaryError(
      "process-executable-drift",
      "$executable",
      "bound executable content changed",
    );
  }
  let finalBefore: BigIntStats;
  let finalCanonicalPath: string;
  let finalAfter: BigIntStats;
  try {
    finalBefore = await lstat(executable.canonicalPath, { bigint: true });
    finalCanonicalPath = await realpath(executable.canonicalPath);
    finalAfter = await lstat(executable.canonicalPath, { bigint: true });
  } catch (error) {
    executableError(
      "assert",
      error,
      "bound executable changed after digest verification",
    );
  }
  if (
    finalBefore.isSymbolicLink() ||
    finalAfter.isSymbolicLink() ||
    !finalBefore.isFile() ||
    !finalAfter.isFile() ||
    !samePath(finalCanonicalPath, executable.canonicalPath) ||
    finalBefore.dev !== finalAfter.dev ||
    finalBefore.ino !== finalAfter.ino ||
    !identityMatches(executable, finalAfter) ||
    Number(finalAfter.size) !== executable.size ||
    finalAfter.mtimeNs.toString() !== executable.modifiedNanoseconds ||
    finalAfter.ctimeNs.toString() !== executable.changedNanoseconds
  ) {
    throw new CoreBoundaryError(
      "process-executable-drift",
      "$executable",
      "bound executable changed after digest verification",
    );
  }
}
