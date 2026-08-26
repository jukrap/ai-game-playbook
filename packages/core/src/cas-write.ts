import {
  isSha256Digest,
  sha256Digest,
  type PortableProjectPath,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, join } from "node:path";

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

export const CAS_MAX_WRITE_BYTES: number = 64 * 1024 * 1024;

export type CasPrecondition =
  | { readonly mode: "absent" }
  | { readonly mode: "digest"; readonly digest: Sha256Digest };

export interface ProjectFileCasRequest {
  readonly root: CanonicalProjectRoot;
  readonly path: unknown;
  readonly content: string | Uint8Array;
  readonly expected: CasPrecondition;
  readonly maxBytes: number;
  readonly maxDirectoryEntries?: number;
}

export type StagedCasState =
  | "aborted"
  | "aborting"
  | "committed"
  | "committing"
  | "staged"
  | "uncertain";

export type ProjectFileCasStatus = "created" | "no-op" | "replaced";

export interface ProjectFileCasResult {
  readonly status: ProjectFileCasStatus;
  readonly path: PortableProjectPath;
  readonly beforeDigest?: Sha256Digest;
  readonly afterDigest: Sha256Digest;
  readonly bytes: number;
}

export interface StagedProjectFileCasWrite {
  readonly state: StagedCasState;
  readonly path: PortableProjectPath;
  readonly beforeDigest?: Sha256Digest;
  readonly afterDigest: Sha256Digest;
  readonly bytes: number;
  commit(): Promise<ProjectFileCasResult>;
  abort(): Promise<void>;
}

interface FileSnapshot extends FilesystemIdentity {
  readonly digest: Sha256Digest;
  readonly size: number;
  readonly mode: number;
  readonly modifiedNanoseconds: string;
  readonly changedNanoseconds: string;
}

interface StagedFile extends FilesystemIdentity {
  readonly absolutePath: string;
}

interface ValidatedCasRequest {
  readonly root: CanonicalProjectRoot;
  readonly path: unknown;
  readonly content: Buffer;
  readonly expected: CasPrecondition;
  readonly maxBytes: number;
  readonly maxDirectoryEntries?: number;
}

interface CasStageContext {
  readonly request: ValidatedCasRequest;
  readonly target: ResolvedProjectPath;
  readonly parentPath: string;
  readonly parentIdentity: FilesystemIdentity;
  readonly before?: FileSnapshot;
  readonly afterDigest: Sha256Digest;
  readonly stagedFile?: StagedFile;
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

function sameAbsolutePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function snapshotMatches(left: FileSnapshot, right: FileSnapshot): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.digest === right.digest &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.modifiedNanoseconds === right.modifiedNanoseconds &&
    left.changedNanoseconds === right.changedNanoseconds
  );
}

function objectHasExactKeys(
  value: object,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-cas-request",
    "$request",
    message,
  );
}

function validateCasRequest(value: ProjectFileCasRequest): ValidatedCasRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(
      value,
      value.maxDirectoryEntries === undefined
        ? ["root", "path", "content", "expected", "maxBytes"]
        : [
            "root",
            "path",
            "content",
            "expected",
            "maxBytes",
            "maxDirectoryEntries",
          ],
    )
  ) {
    invalidRequest("CAS request contains undeclared fields");
  }
  if (
    typeof value.content !== "string" &&
    !(value.content instanceof Uint8Array)
  ) {
    invalidRequest("CAS content must be a UTF-8 string or Uint8Array");
  }
  if (
    !Number.isSafeInteger(value.maxBytes) ||
    value.maxBytes < 1 ||
    value.maxBytes > CAS_MAX_WRITE_BYTES
  ) {
    invalidRequest("CAS byte budget is outside the runtime boundary");
  }
  if (
    typeof value.expected !== "object" ||
    value.expected === null ||
    !(
      (value.expected.mode === "absent" &&
        objectHasExactKeys(value.expected, ["mode"])) ||
      (value.expected.mode === "digest" &&
        objectHasExactKeys(value.expected, ["mode", "digest"]) &&
        isSha256Digest(value.expected.digest))
    )
  ) {
    invalidRequest("CAS precondition must be absent or an exact SHA-256 digest");
  }

  const contentBytes =
    typeof value.content === "string"
      ? Buffer.byteLength(value.content, "utf8")
      : value.content.byteLength;
  if (contentBytes > value.maxBytes) {
    throw new CoreBoundaryError(
      "cas-budget-exceeded",
      "$request.content",
      "new file content exceeds the declared byte budget",
    );
  }
  const content =
    typeof value.content === "string"
      ? Buffer.from(value.content, "utf8")
      : Buffer.from(value.content);

  return {
    root: value.root,
    path: value.path,
    content,
    expected: value.expected,
    maxBytes: value.maxBytes,
    ...(value.maxDirectoryEntries === undefined
      ? {}
      : { maxDirectoryEntries: value.maxDirectoryEntries }),
  };
}

async function assertDirectoryIdentity(
  absolutePath: string,
  identity: FilesystemIdentity,
  path: PortableProjectPath,
): Promise<void> {
  let before: BigIntStats;
  let canonicalPath: string;
  let after: BigIntStats;
  try {
    before = await lstat(absolutePath, { bigint: true });
    canonicalPath = await realpath(absolutePath);
    after = await lstat(absolutePath, { bigint: true });
  } catch {
    throw new CoreBoundaryError(
      "cas-precondition-failed",
      path,
      "target parent directory changed after path resolution",
    );
  }
  if (
    before.isSymbolicLink() ||
    after.isSymbolicLink() ||
    !before.isDirectory() ||
    !after.isDirectory() ||
    !sameAbsolutePath(canonicalPath, absolutePath) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    !identityMatches(identity, after)
  ) {
    throw new CoreBoundaryError(
      "cas-precondition-failed",
      path,
      "target parent directory changed after path resolution",
    );
  }
}

async function snapshotFile(
  target: ResolvedProjectPath,
  maxBytes: number,
): Promise<FileSnapshot> {
  if (target.targetIdentity === undefined) {
    throw new CoreBoundaryError(
      "cas-precondition-failed",
      target.relativePath,
      "target identity is missing",
    );
  }
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle: FileHandle;
  try {
    handle = await open(target.absolutePath, constants.O_RDONLY | noFollow);
  } catch (error) {
    if (isMissing(error)) {
      throw new CoreBoundaryError(
        "cas-precondition-failed",
        target.relativePath,
        "target disappeared before it could be read",
      );
    }
    throw new CoreBoundaryError(
      "filesystem-operation-failed",
      target.relativePath,
      "target could not be opened without following links",
    );
  }

  let snapshot: FileSnapshot | undefined;
  let operationError: unknown;
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      !identityMatches(target.targetIdentity, before) ||
      before.size > BigInt(maxBytes)
    ) {
      if (before.size > BigInt(maxBytes)) {
        throw new CoreBoundaryError(
          "cas-budget-exceeded",
          target.relativePath,
          "existing file exceeds the declared byte budget",
        );
      }
      throw new CoreBoundaryError(
        "cas-precondition-failed",
        target.relativePath,
        "target identity changed before it could be read",
      );
    }
    let content: Buffer;
    try {
      content = await readFileHandleBounded(handle, maxBytes);
    } catch (error) {
      if (error instanceof BoundedFileReadLimitError) {
        throw new CoreBoundaryError(
          "cas-budget-exceeded",
          target.relativePath,
          "existing file exceeded the declared byte budget while it was read",
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
      throw new CoreBoundaryError(
        "cas-precondition-failed",
        target.relativePath,
        "target changed while its preimage was read",
      );
    }
    snapshot = {
      ...identityOf(after),
      digest: sha256Digest(content),
      size: content.byteLength,
      mode: Number(after.mode & 0o777n),
      modifiedNanoseconds: after.mtimeNs.toString(),
      changedNanoseconds: after.ctimeNs.toString(),
    };
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
      "filesystem-operation-failed",
      target.relativePath,
      "target preimage could not be read and closed safely",
    );
  }
  if (snapshot === undefined) {
    throw new CoreBoundaryError(
      "filesystem-operation-failed",
      target.relativePath,
      "target preimage snapshot was not produced",
    );
  }
  return snapshot;
}

function preconditionFailure(
  path: PortableProjectPath,
  message: string,
): never {
  throw new CoreBoundaryError(
    "cas-precondition-failed",
    path,
    message,
  );
}

async function validatePrecondition(
  request: ValidatedCasRequest,
  target: ResolvedProjectPath,
  stagedBefore?: FileSnapshot,
): Promise<FileSnapshot | undefined> {
  if (request.expected.mode === "absent") {
    if (target.kind !== "absent") {
      preconditionFailure(target.relativePath, "target was expected to be absent");
    }
    return undefined;
  }
  if (target.kind === "absent") {
    preconditionFailure(target.relativePath, "target preimage is missing");
  }
  const current = await snapshotFile(target, request.maxBytes);
  if (current.digest !== request.expected.digest) {
    preconditionFailure(target.relativePath, "target digest does not match the CAS preimage");
  }
  if (stagedBefore !== undefined && !snapshotMatches(stagedBefore, current)) {
    preconditionFailure(target.relativePath, "target changed after the CAS stage was created");
  }
  return current;
}

async function resolveCasTarget(
  request: ValidatedCasRequest,
): Promise<ResolvedProjectPath> {
  return resolveProjectPath(request.root, request.path, {
    expectedType: "file",
    existence: "optional",
    ...(request.maxDirectoryEntries === undefined
      ? {}
      : { maxDirectoryEntries: request.maxDirectoryEntries }),
  });
}

async function safelyRemoveStagedFile(
  context: CasStageContext,
): Promise<void> {
  if (context.stagedFile === undefined) {
    return;
  }
  try {
    await assertProjectRootIdentity(context.request.root);
    await assertDirectoryIdentity(
      context.parentPath,
      context.parentIdentity,
      context.target.relativePath,
    );
    const current = await lstat(context.stagedFile.absolutePath, {
      bigint: true,
    });
    if (!current.isFile() || !identityMatches(context.stagedFile, current)) {
      throw new Error("staged file identity mismatch");
    }
    await unlink(context.stagedFile.absolutePath);
  } catch (error) {
    if (isMissing(error)) {
      return;
    }
    throw new CoreBoundaryError(
      "cas-cleanup-conflict",
      context.target.relativePath,
      "staged file could not be safely identified and removed",
      true,
    );
  }
}

async function createStagedFile(
  request: ValidatedCasRequest,
  target: ResolvedProjectPath,
  parentPath: string,
  parentIdentity: FilesystemIdentity,
  mode: number,
): Promise<StagedFile> {
  await assertProjectRootIdentity(request.root);
  await assertDirectoryIdentity(parentPath, parentIdentity, target.relativePath);
  const absolutePath = join(parentPath, `.agpb-cas-${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  let stagedFile: StagedFile | undefined;
  let stagePathCreated = false;
  let operationError: unknown;
  try {
    handle = await open(absolutePath, "wx", mode);
    stagePathCreated = true;
    const opened = await handle.stat({ bigint: true });
    stagedFile = { absolutePath, ...identityOf(opened) };
    await handle.writeFile(request.content);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (
      !written.isFile() ||
      !identityMatches(stagedFile, written) ||
      written.size !== BigInt(request.content.byteLength)
    ) {
      throw new CoreBoundaryError(
        "cas-stage-failed",
        target.relativePath,
        "staged file did not preserve its expected identity and size",
      );
    }
  } catch (error) {
    operationError = error;
  }
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch (error) {
      operationError ??= error;
    }
  }
  if (stagedFile === undefined) {
    operationError ??= new Error("staged file identity was not captured");
  }
  const cleanupContext: CasStageContext | undefined =
    stagedFile === undefined
      ? undefined
      : {
          request,
          target,
          parentPath,
          parentIdentity,
          afterDigest: sha256Digest(request.content),
          stagedFile,
        };
  if (operationError === undefined) {
    try {
      await assertProjectRootIdentity(request.root);
      await assertDirectoryIdentity(
        parentPath,
        parentIdentity,
        target.relativePath,
      );
    } catch (error) {
      operationError = error;
    }
  }
  if (operationError !== undefined) {
    if (cleanupContext !== undefined) {
      await safelyRemoveStagedFile(cleanupContext);
    } else if (stagePathCreated) {
      throw new CoreBoundaryError(
        "cas-cleanup-conflict",
        target.relativePath,
        "staged file was created but its identity could not be proven for cleanup",
        true,
      );
    }
    if (operationError instanceof CoreBoundaryError) {
      throw operationError;
    }
    throw new CoreBoundaryError(
      "cas-stage-failed",
      target.relativePath,
      "staged file could not be written, synchronized, and closed safely",
    );
  }
  if (stagedFile === undefined) {
    throw new CoreBoundaryError(
      "cas-stage-failed",
      target.relativePath,
      "staged file identity was not captured",
    );
  }
  return stagedFile;
}

async function syncDirectory(directoryPath: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const handle = await open(directoryPath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function resultFromContext(
  context: CasStageContext,
  status: ProjectFileCasStatus,
): ProjectFileCasResult {
  return Object.freeze({
    status,
    path: context.target.relativePath,
    ...(context.before === undefined
      ? {}
      : { beforeDigest: context.before.digest }),
    afterDigest: context.afterDigest,
    bytes: context.request.content.byteLength,
  });
}

async function commitStage(
  context: CasStageContext,
): Promise<ProjectFileCasResult> {
  await assertProjectRootIdentity(context.request.root);
  const currentTarget = await resolveCasTarget(context.request);
  if (
    currentTarget.parentIdentity.device !== context.parentIdentity.device ||
    currentTarget.parentIdentity.inode !== context.parentIdentity.inode
  ) {
    preconditionFailure(
      context.target.relativePath,
      "target parent changed after the CAS stage was created",
    );
  }
  await validatePrecondition(context.request, currentTarget, context.before);
  if (
    context.before !== undefined &&
    context.before.digest === context.afterDigest
  ) {
    return resultFromContext(context, "no-op");
  }
  if (context.stagedFile === undefined) {
    throw new CoreBoundaryError(
      "cas-stage-failed",
      context.target.relativePath,
      "CAS stage is missing its staged file",
    );
  }

  await assertProjectRootIdentity(context.request.root);
  await assertDirectoryIdentity(
    context.parentPath,
    context.parentIdentity,
    context.target.relativePath,
  );
  let stagedStats: BigIntStats;
  try {
    stagedStats = await lstat(context.stagedFile.absolutePath, {
      bigint: true,
    });
  } catch {
    preconditionFailure(
      context.target.relativePath,
      "staged file disappeared before commit",
    );
  }
  if (!stagedStats.isFile() || !identityMatches(context.stagedFile, stagedStats)) {
    preconditionFailure(
      context.target.relativePath,
      "staged file identity changed before commit",
    );
  }

  if (context.before === undefined) {
    try {
      await link(context.stagedFile.absolutePath, currentTarget.absolutePath);
    } catch (error) {
      if (isAlreadyPresent(error)) {
        preconditionFailure(
          context.target.relativePath,
          "target was claimed before the CAS create committed",
        );
      }
      throw new CoreBoundaryError(
        "cas-commit-failed",
        context.target.relativePath,
        "atomic create could not be completed",
        true,
      );
    }
    try {
      await unlink(context.stagedFile.absolutePath);
    } catch {
      throw new CoreBoundaryError(
        "cas-cleanup-conflict",
        context.target.relativePath,
        "created target is valid but its staged link could not be removed",
        true,
      );
    }
  } else {
    try {
      await rename(context.stagedFile.absolutePath, currentTarget.absolutePath);
    } catch {
      throw new CoreBoundaryError(
        "cas-commit-failed",
        context.target.relativePath,
        "atomic replacement outcome could not be proven",
        true,
      );
    }
  }

  try {
    await assertProjectRootIdentity(context.request.root);
    await assertDirectoryIdentity(
      context.parentPath,
      context.parentIdentity,
      context.target.relativePath,
    );
    const committedTarget = await resolveCasTarget(context.request);
    if (committedTarget.kind !== "file") {
      throw new Error("committed target is missing");
    }
    const committed = await snapshotFile(
      committedTarget,
      context.request.maxBytes,
    );
    if (
      committed.digest !== context.afterDigest ||
      committed.device !== context.stagedFile.device ||
      committed.inode !== context.stagedFile.inode
    ) {
      throw new Error("committed target failed its postcondition");
    }
    await syncDirectory(context.parentPath);
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "CAS commit occurred but its final identity or digest is uncertain",
      true,
    );
  }

  return resultFromContext(
    context,
    context.before === undefined ? "created" : "replaced",
  );
}

function createStagedWrite(
  context: CasStageContext,
): StagedProjectFileCasWrite {
  let state: StagedCasState = "staged";
  const commit = async (): Promise<ProjectFileCasResult> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `CAS stage cannot commit from ${state}`,
      );
    }
    state = "committing";
    try {
      const result = await commitStage(context);
      state = "committed";
      return result;
    } catch (error) {
      if (error instanceof CoreBoundaryError && error.mutationUncertain) {
        state = "uncertain";
      } else {
        state = "staged";
      }
      throw error;
    }
  };
  const abort = async (): Promise<void> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `CAS stage cannot abort from ${state}`,
        state === "uncertain",
      );
    }
    state = "aborting";
    try {
      await safelyRemoveStagedFile(context);
      state = "aborted";
    } catch (error) {
      state = "uncertain";
      throw error;
    }
  };

  return Object.freeze({
    get state(): StagedCasState {
      return state;
    },
    path: context.target.relativePath,
    ...(context.before === undefined
      ? {}
      : { beforeDigest: context.before.digest }),
    afterDigest: context.afterDigest,
    bytes: context.request.content.byteLength,
    commit,
    abort,
  });
}

export async function stageProjectFileCas(
  value: ProjectFileCasRequest,
): Promise<StagedProjectFileCasWrite> {
  const request = validateCasRequest(value);
  await assertProjectRootIdentity(request.root);
  const target = await resolveCasTarget(request);
  const parentPath = dirname(target.absolutePath);
  const parentIdentity = target.parentIdentity;
  await assertDirectoryIdentity(parentPath, parentIdentity, target.relativePath);
  const before = await validatePrecondition(request, target);
  const afterDigest = sha256Digest(request.content);
  const stagedFile =
    before !== undefined && before.digest === afterDigest
      ? undefined
      : await createStagedFile(
          request,
          target,
          parentPath,
          parentIdentity,
          before?.mode ?? 0o644,
        );
  const context: CasStageContext = {
    request,
    target,
    parentPath,
    parentIdentity,
    ...(before === undefined ? {} : { before }),
    afterDigest,
    ...(stagedFile === undefined ? {} : { stagedFile }),
  };
  return createStagedWrite(context);
}

export async function writeProjectFileCas(
  value: ProjectFileCasRequest,
): Promise<ProjectFileCasResult> {
  const staged = await stageProjectFileCas(value);
  try {
    return await staged.commit();
  } catch (error) {
    if (staged.state === "staged") {
      try {
        await staged.abort();
      } catch (cleanupError) {
        throw cleanupError;
      }
    }
    throw error;
  }
}
