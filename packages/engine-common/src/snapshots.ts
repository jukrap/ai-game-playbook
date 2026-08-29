import {
  ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES,
  ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST,
  ENGINE_SNAPSHOT_MAX_DIRECTORIES,
  ENGINE_SNAPSHOT_MAX_FILES,
  ENGINE_SNAPSHOT_MAX_FILE_BYTES,
  ENGINE_SNAPSHOT_MAX_TOTAL_BYTES,
  assertEngineExecutionSnapshotBindingSemantics,
  compareCanonicalText,
  computeEngineExecutableSnapshotDigest,
  computeEngineExecutionSnapshotBindingDigest,
  computeEngineProjectSnapshotDigest,
  digestCanonicalJson,
  isSha256Digest,
  type EngineExecutableSnapshot,
  type EngineExecutableSnapshotDigestInput,
  type EngineExecutionSnapshotBinding,
  type EngineExecutionSnapshotBindingDigestInput,
  type EngineId,
  type EngineProjectSnapshot,
  type EngineProjectSnapshotDigestInput,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  assertProcessExecutableIdentity,
  assertProjectRootIdentity,
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import { createHash } from "node:crypto";
import type { BigIntStats, Dirent } from "node:fs";
import {
  lstat,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { join, normalize } from "node:path";

import {
  EngineCommonBoundaryError,
  type EngineCommonBoundaryErrorCode,
} from "./errors.js";

export interface CaptureEngineExecutionSnapshotsRequest {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly engine: EngineId;
  readonly projectInspectionDigest: Sha256Digest;
}

export interface AssertEngineExecutionSnapshotAuthorityRequest {
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
}

interface FileManifestEntry {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

interface ProjectManifest {
  readonly directories: readonly string[];
  readonly files: readonly FileManifestEntry[];
  readonly manifestDigest: Sha256Digest;
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly totalBytes: number;
}

interface SnapshotAuthority {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly engine: EngineId;
  readonly projectInspectionDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly bindingDigest: Sha256Digest;
}

interface PendingDirectory {
  readonly absolutePath: string;
  readonly segments: readonly string[];
}

const snapshotAuthorities = new WeakMap<object, SnapshotAuthority>();
const fileReadChunkBytes = 64 * 1024;
const excludedTopLevel = new Set(
  ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES.map((entry) => entry.toLowerCase()),
);
const windowsReservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

function fail(code: EngineCommonBoundaryErrorCode, message: string): never {
  throw new EngineCommonBoundaryError(code, message);
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return undefined;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function engineId(value: unknown): value is EngineId {
  return value === "godot" || value === "unity" || value === "unreal";
}

function captureRequest(value: unknown): CaptureEngineExecutionSnapshotsRequest {
  const record = exactDataRecord(value, [
    "root",
    "executable",
    "engine",
    "projectInspectionDigest",
  ]);
  if (
    record === undefined ||
    !engineId(record["engine"]) ||
    !isSha256Digest(record["projectInspectionDigest"])
  ) {
    return fail(
      "engine-snapshot-request-invalid",
      "Engine snapshot capture requires one exact plain request.",
    );
  }
  return Object.freeze({
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
    engine: record["engine"],
    projectInspectionDigest: record["projectInspectionDigest"],
  });
}

function assertionRequest(
  value: unknown,
): AssertEngineExecutionSnapshotAuthorityRequest {
  const record = exactDataRecord(value, ["binding", "root", "executable"]);
  if (record === undefined) {
    return fail(
      "engine-snapshot-authority-invalid",
      "Engine snapshot assertion requires one exact plain request.",
    );
  }
  return Object.freeze({
    binding: record["binding"] as EngineExecutionSnapshotBinding,
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
  });
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? normalize(left).toLowerCase() === normalize(right).toLowerCase()
    : normalize(left) === normalize(right);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function validSegment(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 255 &&
    name === name.normalize("NFC") &&
    name !== "." &&
    name !== ".." &&
    !/[\u0000-\u001f\u007f]/u.test(name) &&
    !/[\\/:]/u.test(name) &&
    !/[. ]$/u.test(name) &&
    !windowsReservedName.test(name)
  );
}

function relativePath(segments: readonly string[]): string {
  const value = segments.join("/");
  if (
    segments.length === 0 ||
    !segments.every(validSegment) ||
    value.length > 32_767 ||
    Buffer.byteLength(value, "utf8") > 32_767
  ) {
    return fail(
      "engine-snapshot-path-invalid",
      "Project snapshot contains a non-portable or overlong path.",
    );
  }
  return value;
}

async function inspectPath(
  absolutePath: string,
): Promise<{ readonly before: BigIntStats; readonly after: BigIntStats }> {
  let before: BigIntStats;
  let canonicalPath: string;
  let after: BigIntStats;
  try {
    before = await lstat(absolutePath, { bigint: true });
    canonicalPath = await realpath(absolutePath);
    after = await lstat(absolutePath, { bigint: true });
  } catch {
    return fail(
      "engine-snapshot-project-drift",
      "Project entry changed while its identity was inspected.",
    );
  }
  if (before.isSymbolicLink() || after.isSymbolicLink()) {
    return fail(
      "engine-snapshot-link-rejected",
      "Project snapshot does not follow symbolic links or reparse points.",
    );
  }
  if (
    !samePath(canonicalPath, absolutePath) ||
    before.dev !== after.dev ||
    before.ino !== after.ino
  ) {
    return fail(
      "engine-snapshot-link-rejected",
      "Project entry resolves outside its exact lexical path.",
    );
  }
  return Object.freeze({ before, after });
}

async function readBoundedDirectory(
  absolutePath: string,
  maxEntries: number,
): Promise<Dirent[]> {
  let directory;
  try {
    directory = await opendir(absolutePath);
  } catch {
    return fail(
      "engine-snapshot-project-drift",
      "Project directory changed while it was opened for enumeration.",
    );
  }
  const entries: Dirent[] = [];
  try {
    for await (const entry of directory) {
      if (entries.length >= maxEntries) {
        return fail(
          "engine-snapshot-project-budget-exceeded",
          "Project directory exceeds the remaining snapshot entry budget.",
        );
      }
      entries.push(entry);
    }
  } catch (error) {
    if (error instanceof EngineCommonBoundaryError) throw error;
    return fail(
      "engine-snapshot-project-drift",
      "Project directory changed while it was enumerated.",
    );
  }
  return entries;
}

async function hashFileBytes(
  handle: FileHandle,
  expectedBytes: number,
): Promise<Sha256Digest> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(fileReadChunkBytes);
  let offset = 0;
  while (offset < expectedBytes) {
    const requestedBytes = Math.min(buffer.byteLength, expectedBytes - offset);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      requestedBytes,
      offset,
    );
    if (bytesRead < 1) {
      return fail(
        "engine-snapshot-project-drift",
        "Project file ended before its stable identity size was captured.",
      );
    }
    hash.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
  }
  return `sha256:${hash.digest("hex")}` as Sha256Digest;
}

async function snapshotFile(
  absolutePath: string,
  path: string,
  expected: BigIntStats,
): Promise<FileManifestEntry> {
  let handle: FileHandle;
  try {
    handle = await open(absolutePath, "r");
  } catch {
    return fail(
      "engine-snapshot-project-drift",
      "Project file became unavailable during snapshot capture.",
    );
  }
  let result: FileManifestEntry | undefined;
  let operationError: unknown;
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      !sameIdentity(expected, before) ||
      before.size < 0n ||
      before.size > BigInt(ENGINE_SNAPSHOT_MAX_FILE_BYTES)
    ) {
      return fail(
        before.size > BigInt(ENGINE_SNAPSHOT_MAX_FILE_BYTES)
          ? "engine-snapshot-project-budget-exceeded"
          : "engine-snapshot-file-invalid",
        "Project file is outside the regular bounded file contract.",
      );
    }
    const expectedBytes = Number(before.size);
    const digest = await hashFileBytes(handle, expectedBytes);
    const after = await handle.stat({ bigint: true });
    if (
      !sameIdentity(before, after) ||
      expectedBytes !== Number(after.size) ||
      expectedBytes > ENGINE_SNAPSHOT_MAX_FILE_BYTES
    ) {
      return fail(
        "engine-snapshot-project-drift",
        "Project file changed while its bytes were captured.",
      );
    }
    result = Object.freeze({
      path,
      digest,
      bytes: expectedBytes,
    });
  } catch (error) {
    operationError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    operationError ??= error;
  }
  if (operationError !== undefined) {
    if (operationError instanceof EngineCommonBoundaryError) {
      throw operationError;
    }
    return fail(
      "engine-snapshot-project-drift",
      "Project file could not be read and closed as one stable snapshot.",
    );
  }
  if (result === undefined) {
    return fail(
      "engine-snapshot-project-drift",
      "Project file did not produce a complete stable snapshot.",
    );
  }
  return result;
}

function manifestDigest(
  directories: readonly string[],
  files: readonly FileManifestEntry[],
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-project-source-manifest",
    version: "1.0.0",
    exclusionPolicyDigest: ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST,
    directories,
    files,
  });
}

async function scanProject(root: CanonicalProjectRoot): Promise<ProjectManifest> {
  const directories: string[] = [""];
  const files: FileManifestEntry[] = [];
  const portableNames = new Set<string>();
  const pending: PendingDirectory[] = [
    Object.freeze({ absolutePath: root.canonicalPath, segments: Object.freeze([]) }),
  ];
  let totalBytes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    const directoryIdentity = await inspectPath(current.absolutePath);
    if (!directoryIdentity.after.isDirectory()) {
      return fail(
        "engine-snapshot-project-invalid",
        "Project snapshot encountered a non-directory traversal root.",
      );
    }
    const remainingEntryBudget =
      ENGINE_SNAPSHOT_MAX_FILES -
      files.length +
      (ENGINE_SNAPSHOT_MAX_DIRECTORIES - directories.length) +
      (current.segments.length === 0
        ? ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES.length
        : 0);
    const entries = await readBoundedDirectory(
      current.absolutePath,
      remainingEntryBudget,
    );
    entries.sort((left, right) => compareCanonicalText(left.name, right.name));
    for (const entry of entries) {
      if (
        current.segments.length === 0 &&
        excludedTopLevel.has(entry.name.toLowerCase())
      ) {
        continue;
      }
      const segments = Object.freeze([...current.segments, entry.name]);
      const path = relativePath(segments);
      const folded = path.toLowerCase();
      if (portableNames.has(folded)) {
        return fail(
          "engine-snapshot-path-invalid",
          "Project snapshot contains a portable path collision.",
        );
      }
      portableNames.add(folded);
      const absolutePath = join(root.canonicalPath, ...segments);
      const identity = await inspectPath(absolutePath);
      if (identity.after.isDirectory()) {
        if (directories.length >= ENGINE_SNAPSHOT_MAX_DIRECTORIES) {
          return fail(
            "engine-snapshot-project-budget-exceeded",
            "Project snapshot exceeds its directory budget.",
          );
        }
        directories.push(path);
        pending.push(Object.freeze({ absolutePath, segments }));
        continue;
      }
      if (!identity.after.isFile()) {
        return fail(
          "engine-snapshot-file-invalid",
          "Project snapshot accepts regular files and directories only.",
        );
      }
      if (files.length >= ENGINE_SNAPSHOT_MAX_FILES) {
        return fail(
          "engine-snapshot-project-budget-exceeded",
          "Project snapshot exceeds its file-count budget.",
        );
      }
      const file = await snapshotFile(absolutePath, path, identity.after);
      totalBytes += file.bytes;
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > ENGINE_SNAPSHOT_MAX_TOTAL_BYTES
      ) {
        return fail(
          "engine-snapshot-project-budget-exceeded",
          "Project snapshot exceeds its aggregate byte budget.",
        );
      }
      files.push(file);
    }
    const finalDirectoryIdentity = await inspectPath(current.absolutePath);
    if (
      !finalDirectoryIdentity.after.isDirectory() ||
      directoryIdentity.after.dev !== finalDirectoryIdentity.after.dev ||
      directoryIdentity.after.ino !== finalDirectoryIdentity.after.ino
    ) {
      return fail(
        "engine-snapshot-project-drift",
        "Project directory identity changed during enumeration.",
      );
    }
  }

  directories.sort(compareCanonicalText);
  files.sort((left, right) => compareCanonicalText(left.path, right.path));
  if (files.length === 0 || totalBytes < 1) {
    return fail(
      "engine-snapshot-project-invalid",
      "Project snapshot must contain at least one non-empty aggregate file set.",
    );
  }
  const frozenDirectories = Object.freeze([...directories]);
  const frozenFiles = Object.freeze([...files]);
  return Object.freeze({
    directories: frozenDirectories,
    files: frozenFiles,
    manifestDigest: manifestDigest(frozenDirectories, frozenFiles),
    fileCount: frozenFiles.length,
    directoryCount: frozenDirectories.length,
    totalBytes,
  });
}

function sameManifest(left: ProjectManifest, right: ProjectManifest): boolean {
  return (
    left.manifestDigest === right.manifestDigest &&
    left.fileCount === right.fileCount &&
    left.directoryCount === right.directoryCount &&
    left.totalBytes === right.totalBytes
  );
}

async function stableProjectManifest(
  root: CanonicalProjectRoot,
): Promise<ProjectManifest> {
  await assertProjectRootIdentity(root);
  const first = await scanProject(root);
  await assertProjectRootIdentity(root);
  const second = await scanProject(root);
  await assertProjectRootIdentity(root);
  if (!sameManifest(first, second)) {
    return fail(
      "engine-snapshot-project-drift",
      "Project manifest changed across the required stable observations.",
    );
  }
  return second;
}

function snapshotMismatch(
  binding: EngineExecutionSnapshotBinding,
  authority: SnapshotAuthority,
): boolean {
  return (
    binding.engine !== authority.engine ||
    binding.project.projectRootIdentityDigest !== authority.root.identityDigest ||
    binding.project.projectInspectionDigest !== authority.projectInspectionDigest ||
    binding.project.manifestDigest !== authority.manifestDigest ||
    binding.project.snapshotDigest !== authority.projectSnapshotDigest ||
    binding.executable.executableDigest !== authority.executable.digest ||
    binding.executable.executableIdentityDigest !== authority.executable.identityDigest ||
    binding.executable.snapshotDigest !== authority.executableSnapshotDigest ||
    binding.bindingDigest !== authority.bindingDigest
  );
}

export async function captureEngineExecutionSnapshots(
  value: unknown,
): Promise<EngineExecutionSnapshotBinding> {
  const request = captureRequest(value);
  try {
    await assertProjectRootIdentity(request.root);
  } catch {
    return fail(
      "engine-snapshot-project-invalid",
      "Project root lacks current same-process identity.",
    );
  }
  try {
    await assertProcessExecutableIdentity(request.executable);
  } catch {
    return fail(
      "engine-snapshot-executable-invalid",
      "Executable lacks current same-process identity.",
    );
  }
  if (
    request.root.platform !== request.executable.platform ||
    request.executable.size > ENGINE_SNAPSHOT_MAX_FILE_BYTES
  ) {
    return fail(
      "engine-snapshot-executable-invalid",
      "Executable is outside the host or byte boundary for engine snapshots.",
    );
  }
  let manifest: ProjectManifest;
  try {
    manifest = await stableProjectManifest(request.root);
  } catch (error) {
    if (error instanceof EngineCommonBoundaryError) throw error;
    return fail(
      "engine-snapshot-project-drift",
      "Project identity changed during snapshot capture.",
    );
  }
  try {
    await assertProcessExecutableIdentity(request.executable);
  } catch {
    return fail(
      "engine-snapshot-executable-invalid",
      "Executable identity changed during snapshot capture.",
    );
  }
  const capturedAt = new Date().toISOString();
  const projectInput: EngineProjectSnapshotDigestInput = Object.freeze({
    kind: "bounded-read-only-source",
    engine: request.engine,
    projectRootIdentityDigest: request.root.identityDigest,
    projectInspectionDigest: request.projectInspectionDigest,
    manifestDigest: manifest.manifestDigest,
    exclusionPolicyDigest: ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST,
    fileCount: manifest.fileCount,
    directoryCount: manifest.directoryCount,
    totalBytes: manifest.totalBytes,
    capturedAt,
  });
  const project: EngineProjectSnapshot = Object.freeze({
    schemaVersion: "1.0.0",
    ...projectInput,
    snapshotDigest: computeEngineProjectSnapshotDigest(projectInput),
  });
  const executableInput: EngineExecutableSnapshotDigestInput = Object.freeze({
    kind: "identity-bound-executable",
    engine: request.engine,
    executableDigest: request.executable.digest,
    executableIdentityDigest: request.executable.identityDigest,
    bytes: request.executable.size,
    capturedAt,
  });
  const executable: EngineExecutableSnapshot = Object.freeze({
    schemaVersion: "1.0.0",
    ...executableInput,
    snapshotDigest: computeEngineExecutableSnapshotDigest(executableInput),
  });
  const bindingInput: EngineExecutionSnapshotBindingDigestInput = Object.freeze({
    engine: request.engine,
    project,
    executable,
  });
  const binding: EngineExecutionSnapshotBinding = Object.freeze({
    schemaVersion: "1.0.0",
    ...bindingInput,
    bindingDigest: computeEngineExecutionSnapshotBindingDigest(bindingInput),
  });
  assertEngineExecutionSnapshotBindingSemantics(binding);
  snapshotAuthorities.set(
    binding,
    Object.freeze({
      root: request.root,
      executable: request.executable,
      engine: request.engine,
      projectInspectionDigest: request.projectInspectionDigest,
      manifestDigest: manifest.manifestDigest,
      projectSnapshotDigest: project.snapshotDigest,
      executableSnapshotDigest: executable.snapshotDigest,
      bindingDigest: binding.bindingDigest,
    }),
  );
  return binding;
}

export async function assertEngineExecutionSnapshotAuthority(
  value: unknown,
): Promise<void> {
  const request = assertionRequest(value);
  const authority =
    request.binding !== null && typeof request.binding === "object"
      ? snapshotAuthorities.get(request.binding)
      : undefined;
  if (
    authority === undefined ||
    authority.root !== request.root ||
    authority.executable !== request.executable
  ) {
    return fail(
      "engine-snapshot-authority-invalid",
      "Snapshot binding was not created for these exact runtime identities.",
    );
  }
  try {
    assertEngineExecutionSnapshotBindingSemantics(request.binding);
  } catch {
    return fail(
      "engine-snapshot-authority-invalid",
      "Snapshot binding no longer matches its contract digest.",
    );
  }
  if (snapshotMismatch(request.binding, authority)) {
    return fail(
      "engine-snapshot-authority-invalid",
      "Snapshot binding no longer matches its same-process authority.",
    );
  }
  let manifest: ProjectManifest;
  try {
    await assertProcessExecutableIdentity(request.executable);
  } catch {
    return fail(
      "engine-snapshot-executable-invalid",
      "Executable identity changed after snapshot capture.",
    );
  }
  try {
    manifest = await stableProjectManifest(request.root);
  } catch (error) {
    if (error instanceof EngineCommonBoundaryError) throw error;
    return fail(
      "engine-snapshot-project-drift",
      "Project identity changed after snapshot capture.",
    );
  }
  try {
    await assertProcessExecutableIdentity(request.executable);
  } catch {
    return fail(
      "engine-snapshot-executable-invalid",
      "Executable identity changed after project snapshot verification.",
    );
  }
  if (
    manifest.manifestDigest !== request.binding.project.manifestDigest ||
    manifest.fileCount !== request.binding.project.fileCount ||
    manifest.directoryCount !== request.binding.project.directoryCount ||
    manifest.totalBytes !== request.binding.project.totalBytes
  ) {
    return fail(
      "engine-snapshot-project-drift",
      "Project manifest no longer matches the captured snapshot.",
    );
  }
}
