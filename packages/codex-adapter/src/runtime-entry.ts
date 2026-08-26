import { parseSha256Digest, type Sha256Digest } from "@ai-game-playbook/contracts";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { CodexSetupBoundaryError } from "./errors.js";

export const CODEX_MCP_ENTRY_MAX_BYTES: number = 4 * 1024 * 1024;

export interface RuntimeEntrySnapshot {
  readonly canonicalPath: string;
  readonly device: string;
  readonly inode: string;
  readonly size: number;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
  readonly digest: Sha256Digest;
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function invalidEntryPoint(): never {
  throw new CodexSetupBoundaryError(
    "codex-setup-entrypoint-invalid",
    "Codex MCP entrypoint does not satisfy the bounded regular-file contract.",
  );
}

async function closeHandle(handle: FileHandle, error: unknown): Promise<void> {
  let failure = error;
  try {
    await handle.close();
  } catch (closeError) {
    failure ??= closeError;
  }
  if (failure !== undefined) {
    if (failure instanceof CodexSetupBoundaryError) {
      throw failure;
    }
    invalidEntryPoint();
  }
}

async function hashOpenFile(
  handle: FileHandle,
  maxBytes: number,
): Promise<Omit<RuntimeEntrySnapshot, "canonicalPath">> {
  const before = await handle.stat({ bigint: true });
  if (
    !before.isFile() ||
    before.size < 1n ||
    before.size > BigInt(maxBytes)
  ) {
    invalidEntryPoint();
  }

  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < Number(before.size)) {
    const length = Math.min(buffer.byteLength, Number(before.size) - position);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  const after = await handle.stat({ bigint: true });
  if (
    !sameIdentity(before, after) ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    position !== Number(after.size)
  ) {
    invalidEntryPoint();
  }
  return {
    device: after.dev.toString(),
    inode: after.ino.toString(),
    size: position,
    modifiedNanoseconds: after.mtimeNs.toString(),
    changedNanoseconds: after.ctimeNs.toString(),
    digest: parseSha256Digest(`sha256:${hash.digest("hex")}`),
  };
}

export async function snapshotRuntimeEntry(
  value: string,
  maxBytes: number = CODEX_MCP_ENTRY_MAX_BYTES,
): Promise<RuntimeEntrySnapshot> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32_767 ||
    /[\u0000-\u001F\u007F]/u.test(value) ||
    !isAbsolute(value) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > CODEX_MCP_ENTRY_MAX_BYTES
  ) {
    invalidEntryPoint();
  }
  const requestedPath = normalize(value);
  if (
    process.platform === "win32" &&
    (requestedPath.startsWith("\\\\") ||
      requestedPath.startsWith("\\?\\") ||
      requestedPath.startsWith("\\.\\"))
  ) {
    invalidEntryPoint();
  }

  let before: BigIntStats;
  let canonicalPath: string;
  let middle: BigIntStats;
  try {
    before = await lstat(requestedPath, { bigint: true });
    canonicalPath = await realpath(requestedPath);
    middle = await lstat(requestedPath, { bigint: true });
  } catch {
    invalidEntryPoint();
  }
  if (
    before.isSymbolicLink() ||
    middle.isSymbolicLink() ||
    !sameIdentity(before, middle) ||
    !samePath(requestedPath, canonicalPath)
  ) {
    invalidEntryPoint();
  }

  let handle: FileHandle;
  try {
    handle = await open(
      canonicalPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch {
    invalidEntryPoint();
  }
  let hashed: Omit<RuntimeEntrySnapshot, "canonicalPath"> | undefined;
  let operationError: unknown;
  try {
    hashed = await hashOpenFile(handle, maxBytes);
  } catch (error) {
    operationError = error;
  }
  await closeHandle(handle, operationError);
  if (hashed === undefined) invalidEntryPoint();

  let final: BigIntStats;
  try {
    final = await lstat(requestedPath, { bigint: true });
  } catch {
    invalidEntryPoint();
  }
  if (
    final.isSymbolicLink() ||
    !final.isFile() ||
    !sameIdentity(middle, final) ||
    final.dev.toString() !== hashed.device ||
    final.ino.toString() !== hashed.inode ||
    Number(final.size) !== hashed.size ||
    final.mtimeNs.toString() !== hashed.modifiedNanoseconds ||
    final.ctimeNs.toString() !== hashed.changedNanoseconds
  ) {
    invalidEntryPoint();
  }
  return Object.freeze({ canonicalPath, ...hashed });
}

export function runtimeEntryMatches(
  expected: RuntimeEntrySnapshot,
  actual: RuntimeEntrySnapshot,
): boolean {
  return (
    samePath(expected.canonicalPath, actual.canonicalPath) &&
    expected.device === actual.device &&
    expected.inode === actual.inode &&
    expected.size === actual.size &&
    expected.modifiedNanoseconds === actual.modifiedNanoseconds &&
    expected.changedNanoseconds === actual.changedNanoseconds &&
    expected.digest === actual.digest
  );
}
