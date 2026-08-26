import { sha256Digest, type Sha256Digest } from "@ai-game-playbook/contracts";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";

import { CodexSetupBoundaryError } from "./errors.js";

export const CODEX_SKILL_MAX_BYTES: number = 64 * 1024;

export interface SkillArtifactSnapshot {
  readonly canonicalPath: string;
  readonly name: string;
  readonly content: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly device: string;
  readonly inode: string;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
}

export interface SnapshotSkillArtifactOptions {
  readonly path: string;
  readonly expectedName: string;
  readonly expectedDigest: Sha256Digest;
  readonly maxBytes: number;
}

function invalidSkillArtifact(): never {
  throw new CodexSetupBoundaryError(
    "codex-setup-skill-artifact-invalid",
    "Codex skill source does not satisfy its bounded artifact contract.",
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validateOptions(value: SnapshotSkillArtifactOptions): {
  readonly path: string;
  readonly expectedName: string;
  readonly expectedDigest: Sha256Digest;
  readonly maxBytes: number;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, ["expectedDigest", "expectedName", "maxBytes", "path"]) ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    value.path.length > 32_767 ||
    /[\u0000-\u001F\u007F]/u.test(value.path) ||
    !isAbsolute(value.path) ||
    typeof value.expectedName !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.expectedName) ||
    typeof value.expectedDigest !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value.expectedDigest) ||
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 ||
    value.maxBytes > CODEX_SKILL_MAX_BYTES
  ) {
    invalidSkillArtifact();
  }
  const path = normalize(value.path);
  if (
    process.platform === "win32" &&
    (path.startsWith("\\\\") ||
      path.startsWith("\\?\\") ||
      path.startsWith("\\.\\"))
  ) {
    invalidSkillArtifact();
  }
  return {
    path,
    expectedName: value.expectedName,
    expectedDigest: value.expectedDigest,
    maxBytes: value.maxBytes,
  };
}

function validateContent(content: string, expectedName: string): void {
  if (
    content.length === 0 ||
    !content.endsWith("\n") ||
    content.includes("\r") ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(content)
  ) {
    invalidSkillArtifact();
  }
  const lines = content.split("\n");
  if (
    lines[0] !== "---" ||
    lines[1] !== `name: ${expectedName}` ||
    lines[2] === undefined ||
    !lines[2].startsWith("description: Use when") ||
    lines[2].length > 513 ||
    lines[3] !== "---"
  ) {
    invalidSkillArtifact();
  }
}

async function closeHandle(handle: FileHandle, error: unknown): Promise<void> {
  let failure = error;
  try {
    await handle.close();
  } catch (closeError) {
    failure ??= closeError;
  }
  if (failure !== undefined) {
    if (failure instanceof CodexSetupBoundaryError) throw failure;
    invalidSkillArtifact();
  }
}

export async function snapshotSkillArtifact(
  value: SnapshotSkillArtifactOptions,
): Promise<SkillArtifactSnapshot> {
  const options = validateOptions(value);
  let before: BigIntStats;
  let canonicalPath: string;
  let middle: BigIntStats;
  try {
    before = await lstat(options.path, { bigint: true });
    canonicalPath = await realpath(options.path);
    middle = await lstat(options.path, { bigint: true });
  } catch {
    invalidSkillArtifact();
  }
  if (
    before.isSymbolicLink() ||
    middle.isSymbolicLink() ||
    !before.isFile() ||
    !middle.isFile() ||
    !sameIdentity(before, middle) ||
    !samePath(options.path, canonicalPath)
  ) {
    invalidSkillArtifact();
  }

  let handle: FileHandle;
  try {
    handle = await open(
      canonicalPath,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
  } catch {
    invalidSkillArtifact();
  }

  let snapshot: SkillArtifactSnapshot | undefined;
  let operationError: unknown;
  try {
    const openedBefore = await handle.stat({ bigint: true });
    if (
      !openedBefore.isFile() ||
      openedBefore.size < 1n ||
      openedBefore.size > BigInt(options.maxBytes)
    ) {
      invalidSkillArtifact();
    }
    const contentBytes = Buffer.alloc(Number(openedBefore.size));
    let position = 0;
    while (position < contentBytes.byteLength) {
      const { bytesRead } = await handle.read(
        contentBytes,
        position,
        contentBytes.byteLength - position,
        position,
      );
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    const openedAfter = await handle.stat({ bigint: true });
    if (
      !sameIdentity(openedBefore, openedAfter) ||
      openedBefore.size !== openedAfter.size ||
      openedBefore.mtimeNs !== openedAfter.mtimeNs ||
      openedBefore.ctimeNs !== openedAfter.ctimeNs ||
      position !== contentBytes.byteLength
    ) {
      invalidSkillArtifact();
    }
    if (
      contentBytes.length >= 3 &&
      contentBytes[0] === 0xef &&
      contentBytes[1] === 0xbb &&
      contentBytes[2] === 0xbf
    ) {
      invalidSkillArtifact();
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes);
    } catch {
      invalidSkillArtifact();
    }
    if (!Buffer.from(content, "utf8").equals(contentBytes)) {
      invalidSkillArtifact();
    }
    validateContent(content, options.expectedName);
    const digest = sha256Digest(content);
    if (digest !== options.expectedDigest) invalidSkillArtifact();
    snapshot = Object.freeze({
      canonicalPath,
      name: options.expectedName,
      content,
      digest,
      bytes: contentBytes.byteLength,
      device: openedAfter.dev.toString(),
      inode: openedAfter.ino.toString(),
      modifiedNanoseconds: openedAfter.mtimeNs.toString(),
      changedNanoseconds: openedAfter.ctimeNs.toString(),
    });
  } catch (error) {
    operationError = error;
  }
  await closeHandle(handle, operationError);
  if (snapshot === undefined) invalidSkillArtifact();

  let final: BigIntStats;
  try {
    final = await lstat(options.path, { bigint: true });
  } catch {
    invalidSkillArtifact();
  }
  if (
    final.isSymbolicLink() ||
    !final.isFile() ||
    final.dev.toString() !== snapshot.device ||
    final.ino.toString() !== snapshot.inode ||
    Number(final.size) !== snapshot.bytes ||
    final.mtimeNs.toString() !== snapshot.modifiedNanoseconds ||
    final.ctimeNs.toString() !== snapshot.changedNanoseconds
  ) {
    invalidSkillArtifact();
  }
  return snapshot;
}

export function skillArtifactMatches(
  expected: SkillArtifactSnapshot,
  actual: SkillArtifactSnapshot,
): boolean {
  return (
    samePath(expected.canonicalPath, actual.canonicalPath) &&
    expected.name === actual.name &&
    expected.content === actual.content &&
    expected.digest === actual.digest &&
    expected.bytes === actual.bytes &&
    expected.device === actual.device &&
    expected.inode === actual.inode &&
    expected.modifiedNanoseconds === actual.modifiedNanoseconds &&
    expected.changedNanoseconds === actual.changedNanoseconds
  );
}
