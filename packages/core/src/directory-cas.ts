import {
  digestCanonicalJson,
  isSha256Digest,
  parsePortableProjectPath,
  type PortableProjectPath,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, open, opendir, rmdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { StagedCasState } from "./cas-write.js";
import { CoreBoundaryError } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type FilesystemIdentity,
  type ResolvedProjectPath,
} from "./project-path.js";

export interface ProjectDirectoryIdentity {
  readonly schemaVersion: "1.0.0";
  readonly path: PortableProjectPath;
  readonly rootIdentityDigest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
}

export interface ProjectDirectoryCasCreateRequest {
  readonly root: CanonicalProjectRoot;
  readonly path: unknown;
  readonly maxDirectoryEntries?: number;
}

export interface ProjectDirectoryCasCreateResult {
  readonly status: "created";
  readonly path: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

export interface StagedProjectDirectoryCasCreate {
  readonly state: StagedCasState;
  readonly path: PortableProjectPath;
  commit(): Promise<ProjectDirectoryCasCreateResult>;
  abort(): Promise<void>;
}

export interface ProjectDirectoryCasDeleteRequest {
  readonly root: CanonicalProjectRoot;
  readonly path: unknown;
  readonly expectedIdentity: ProjectDirectoryIdentity;
  readonly maxDirectoryEntries?: number;
}

export interface ProjectDirectoryCasDeleteResult {
  readonly status: "deleted";
  readonly path: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

export interface StagedProjectDirectoryCasDelete {
  readonly state: StagedCasState;
  readonly path: PortableProjectPath;
  readonly expectedIdentity: ProjectDirectoryIdentity;
  commit(): Promise<ProjectDirectoryCasDeleteResult>;
  abort(): Promise<void>;
}

interface ValidatedCreateRequest {
  readonly root: CanonicalProjectRoot;
  readonly path: unknown;
  readonly maxDirectoryEntries?: number;
}

interface ValidatedDeleteRequest extends ValidatedCreateRequest {
  readonly expectedIdentity: ProjectDirectoryIdentity;
}

interface DirectoryCreateContext {
  readonly request: ValidatedCreateRequest;
  readonly target: ResolvedProjectPath;
  readonly parentPath: string;
  readonly parentIdentity: FilesystemIdentity;
}

interface DirectoryDeleteContext {
  readonly request: ValidatedDeleteRequest;
  readonly target: ResolvedProjectPath;
  readonly parentPath: string;
  readonly parentIdentity: FilesystemIdentity;
  readonly identity: ProjectDirectoryIdentity;
}

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFilesystemError(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function sameIdentity(
  left: FilesystemIdentity,
  right: FilesystemIdentity | undefined,
): boolean {
  return (
    right !== undefined &&
    left.device === right.device &&
    left.inode === right.inode
  );
}

function identityOf(stats: BigIntStats): FilesystemIdentity {
  return Object.freeze({
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  });
}

function invalidRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-cas-request",
    "$request",
    message,
  );
}

function preconditionFailure(path: string, message: string): never {
  throw new CoreBoundaryError(
    "cas-precondition-failed",
    path,
    message,
  );
}

function validateCommonRequest(
  value: ProjectDirectoryCasCreateRequest,
  requiredKeys: readonly string[],
): ValidatedCreateRequest {
  if (!isRecord(value)) {
    invalidRequest("directory CAS request must be an object");
  }
  const expectedKeys =
    value.maxDirectoryEntries === undefined
      ? requiredKeys
      : [...requiredKeys, "maxDirectoryEntries"];
  if (!objectHasExactKeys(value, expectedKeys)) {
    invalidRequest("directory CAS request contains undeclared authority");
  }
  if (
    value.maxDirectoryEntries !== undefined &&
    (!Number.isSafeInteger(value.maxDirectoryEntries) ||
      value.maxDirectoryEntries < 1)
  ) {
    invalidRequest("directory CAS entry budget must be a positive safe integer");
  }
  return Object.freeze({
    root: value.root,
    path: value.path,
    ...(value.maxDirectoryEntries === undefined
      ? {}
      : { maxDirectoryEntries: value.maxDirectoryEntries }),
  });
}

function validateCreateRequest(
  value: ProjectDirectoryCasCreateRequest,
): ValidatedCreateRequest {
  return validateCommonRequest(value, ["root", "path"]);
}

function validateExpectedIdentity(value: unknown): ProjectDirectoryIdentity {
  if (
    !isRecord(value) ||
    !objectHasExactKeys(value, [
      "schemaVersion",
      "path",
      "rootIdentityDigest",
      "identityDigest",
    ]) ||
    value["schemaVersion"] !== "1.0.0" ||
    !isSha256Digest(value["rootIdentityDigest"]) ||
    !isSha256Digest(value["identityDigest"])
  ) {
    invalidRequest("directory identity witness is malformed");
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    path: parsePortableProjectPath(
      value["path"],
      "$request.expectedIdentity.path",
    ),
    rootIdentityDigest: value["rootIdentityDigest"],
    identityDigest: value["identityDigest"],
  });
}

function validateDeleteRequest(
  value: ProjectDirectoryCasDeleteRequest,
): ValidatedDeleteRequest {
  const common = validateCommonRequest(value, [
    "root",
    "path",
    "expectedIdentity",
  ]);
  return Object.freeze({
    ...common,
    expectedIdentity: validateExpectedIdentity(value.expectedIdentity),
  });
}

function resolveOptions(
  request: ValidatedCreateRequest,
  existence: "optional" | "required",
): {
  readonly expectedType: "directory";
  readonly existence: "optional" | "required";
  readonly maxDirectoryEntries?: number;
} {
  return {
    expectedType: "directory",
    existence,
    ...(request.maxDirectoryEntries === undefined
      ? {}
      : { maxDirectoryEntries: request.maxDirectoryEntries }),
  };
}

async function resolveDirectory(
  request: ValidatedCreateRequest,
  existence: "optional" | "required",
): Promise<ResolvedProjectPath> {
  return resolveProjectPath(
    request.root,
    request.path,
    resolveOptions(request, existence),
  );
}

function createDirectoryIdentity(
  root: CanonicalProjectRoot,
  target: ResolvedProjectPath,
): ProjectDirectoryIdentity {
  if (target.kind !== "directory" || target.targetIdentity === undefined) {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      target.relativePath,
      "directory identity could not be attested",
      true,
    );
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    path: target.relativePath,
    rootIdentityDigest: root.identityDigest,
    identityDigest: digestCanonicalJson({
      domain: "ai-game-playbook.project-directory-identity.v1",
      path: target.relativePath,
      rootIdentityDigest: root.identityDigest,
      parentIdentity: target.parentIdentity,
      targetIdentity: target.targetIdentity,
    }),
  });
}

function identitiesMatch(
  left: ProjectDirectoryIdentity,
  right: ProjectDirectoryIdentity,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.path === right.path &&
    left.rootIdentityDigest === right.rootIdentityDigest &&
    left.identityDigest === right.identityDigest
  );
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

async function assertEmptyDirectory(
  target: ResolvedProjectPath,
): Promise<void> {
  let handle;
  try {
    handle = await opendir(target.absolutePath);
    const entry = await handle.read();
    if (entry !== null) {
      preconditionFailure(
        target.relativePath,
        "owned directory is not empty",
      );
    }
  } catch (error) {
    if (error instanceof CoreBoundaryError) {
      throw error;
    }
    throw new CoreBoundaryError(
      "cas-stage-failed",
      target.relativePath,
      "directory emptiness could not be inspected",
    );
  } finally {
    await handle?.close();
  }
}

async function verifyCreatedDirectory(
  context: DirectoryCreateContext,
): Promise<ProjectDirectoryIdentity> {
  let immediate: BigIntStats;
  try {
    immediate = await lstat(context.target.absolutePath, { bigint: true });
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "created directory could not be inspected",
      true,
    );
  }
  if (immediate.isSymbolicLink() || !immediate.isDirectory()) {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "created directory changed type before attestation",
      true,
    );
  }

  let current: ResolvedProjectPath;
  try {
    current = await resolveDirectory(context.request, "required");
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "created directory could not be resolved safely",
      true,
    );
  }
  if (
    !sameIdentity(context.parentIdentity, current.parentIdentity) ||
    !sameIdentity(identityOf(immediate), current.targetIdentity)
  ) {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "created directory identity changed during attestation",
      true,
    );
  }
  return createDirectoryIdentity(context.request.root, current);
}

async function commitCreate(
  context: DirectoryCreateContext,
): Promise<ProjectDirectoryCasCreateResult> {
  await assertProjectRootIdentity(context.request.root);
  const current = await resolveDirectory(context.request, "optional");
  if (
    current.kind !== "absent" ||
    !sameIdentity(context.parentIdentity, current.parentIdentity)
  ) {
    preconditionFailure(
      context.target.relativePath,
      "directory create precondition changed after staging",
    );
  }

  try {
    await mkdir(current.absolutePath, { mode: 0o700 });
  } catch (error) {
    if (isFilesystemError(error, "EEXIST")) {
      preconditionFailure(
        context.target.relativePath,
        "directory target was claimed before commit",
      );
    }
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.target.relativePath,
      "directory create outcome could not be proven",
      true,
    );
  }

  const identity = await verifyCreatedDirectory(context);
  try {
    await syncDirectory(context.parentPath);
    const finalTarget = await resolveDirectory(context.request, "required");
    const finalIdentity = createDirectoryIdentity(context.request.root, finalTarget);
    if (!identitiesMatch(identity, finalIdentity)) {
      throw new Error("directory identity changed after create");
    }
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "created directory could not be durably re-attested",
      true,
    );
  }

  return Object.freeze({
    status: "created",
    path: context.target.relativePath,
    identity,
  });
}

function createStagedCreate(
  context: DirectoryCreateContext,
): StagedProjectDirectoryCasCreate {
  let state: StagedCasState = "staged";
  const commit = async (): Promise<ProjectDirectoryCasCreateResult> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `directory create stage cannot commit from ${state}`,
        state === "uncertain",
      );
    }
    state = "committing";
    try {
      const result = await commitCreate(context);
      state = "committed";
      return result;
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "staged";
      throw error;
    }
  };
  const abort = async (): Promise<void> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `directory create stage cannot abort from ${state}`,
        state === "uncertain",
      );
    }
    state = "aborting";
    state = "aborted";
  };
  return Object.freeze({
    get state(): StagedCasState {
      return state;
    },
    path: context.target.relativePath,
    commit,
    abort,
  });
}

export async function stageProjectDirectoryCasCreate(
  value: ProjectDirectoryCasCreateRequest,
): Promise<StagedProjectDirectoryCasCreate> {
  const request = validateCreateRequest(value);
  await assertProjectRootIdentity(request.root);
  const target = await resolveDirectory(request, "optional");
  if (target.kind !== "absent") {
    preconditionFailure(
      target.relativePath,
      "directory create requires an absent target",
    );
  }
  return createStagedCreate({
    request,
    target,
    parentPath: dirname(target.absolutePath),
    parentIdentity: target.parentIdentity,
  });
}

export async function createProjectDirectoryCas(
  value: ProjectDirectoryCasCreateRequest,
): Promise<ProjectDirectoryCasCreateResult> {
  const staged = await stageProjectDirectoryCasCreate(value);
  try {
    return await staged.commit();
  } catch (error) {
    if (staged.state === "staged") {
      await staged.abort();
    }
    throw error;
  }
}

async function assertExpectedDirectory(
  request: ValidatedDeleteRequest,
): Promise<{
  readonly target: ResolvedProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}> {
  const target = await resolveDirectory(request, "required");
  const identity = createDirectoryIdentity(request.root, target);
  if (
    request.expectedIdentity.path !== target.relativePath ||
    request.expectedIdentity.rootIdentityDigest !== request.root.identityDigest ||
    !identitiesMatch(request.expectedIdentity, identity)
  ) {
    preconditionFailure(
      target.relativePath,
      "directory identity does not match the owned witness",
    );
  }
  return { target, identity };
}

async function commitDelete(
  context: DirectoryDeleteContext,
): Promise<ProjectDirectoryCasDeleteResult> {
  await assertProjectRootIdentity(context.request.root);
  const current = await assertExpectedDirectory(context.request);
  if (!sameIdentity(context.parentIdentity, current.target.parentIdentity)) {
    preconditionFailure(
      context.target.relativePath,
      "directory parent changed after delete staging",
    );
  }
  await assertEmptyDirectory(current.target);

  try {
    await rmdir(current.target.absolutePath);
  } catch (error) {
    if (
      isFilesystemError(error, "ENOENT") ||
      isFilesystemError(error, "ENOTEMPTY") ||
      isFilesystemError(error, "EEXIST")
    ) {
      preconditionFailure(
        context.target.relativePath,
        "directory changed before exact deletion",
      );
    }
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.target.relativePath,
      "directory delete could not be committed",
    );
  }

  try {
    await assertProjectRootIdentity(context.request.root);
    const finalTarget = await resolveDirectory(context.request, "optional");
    if (
      finalTarget.kind !== "absent" ||
      !sameIdentity(context.parentIdentity, finalTarget.parentIdentity)
    ) {
      throw new Error("deleted directory reappeared or its parent changed");
    }
    await syncDirectory(context.parentPath);
    const durableTarget = await resolveDirectory(context.request, "optional");
    if (
      durableTarget.kind !== "absent" ||
      !sameIdentity(context.parentIdentity, durableTarget.parentIdentity)
    ) {
      throw new Error("deleted directory postcondition changed");
    }
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "directory deletion committed but could not be durably verified",
      true,
    );
  }

  return Object.freeze({
    status: "deleted",
    path: context.target.relativePath,
    identity: context.identity,
  });
}

function createStagedDelete(
  context: DirectoryDeleteContext,
): StagedProjectDirectoryCasDelete {
  let state: StagedCasState = "staged";
  const commit = async (): Promise<ProjectDirectoryCasDeleteResult> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `directory delete stage cannot commit from ${state}`,
        state === "uncertain",
      );
    }
    state = "committing";
    try {
      const result = await commitDelete(context);
      state = "committed";
      return result;
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "staged";
      throw error;
    }
  };
  const abort = async (): Promise<void> => {
    if (state !== "staged") {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `directory delete stage cannot abort from ${state}`,
        state === "uncertain",
      );
    }
    state = "aborting";
    state = "aborted";
  };
  return Object.freeze({
    get state(): StagedCasState {
      return state;
    },
    path: context.target.relativePath,
    expectedIdentity: context.identity,
    commit,
    abort,
  });
}

export async function stageProjectDirectoryCasDelete(
  value: ProjectDirectoryCasDeleteRequest,
): Promise<StagedProjectDirectoryCasDelete> {
  const request = validateDeleteRequest(value);
  await assertProjectRootIdentity(request.root);
  const current = await assertExpectedDirectory(request);
  await assertEmptyDirectory(current.target);
  const confirmed = await assertExpectedDirectory(request);
  if (!sameIdentity(current.target.parentIdentity, confirmed.target.parentIdentity)) {
    preconditionFailure(
      current.target.relativePath,
      "directory parent changed while delete was staged",
    );
  }
  await assertEmptyDirectory(confirmed.target);
  return createStagedDelete({
    request,
    target: confirmed.target,
    parentPath: dirname(confirmed.target.absolutePath),
    parentIdentity: confirmed.target.parentIdentity,
    identity: confirmed.identity,
  });
}

export async function deleteProjectDirectoryCas(
  value: ProjectDirectoryCasDeleteRequest,
): Promise<ProjectDirectoryCasDeleteResult> {
  const staged = await stageProjectDirectoryCasDelete(value);
  try {
    return await staged.commit();
  } catch (error) {
    if (staged.state === "staged") {
      await staged.abort();
    }
    throw error;
  }
}
