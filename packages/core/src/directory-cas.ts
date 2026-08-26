import {
  digestCanonicalJson,
  isSha256Digest,
  parsePortableProjectPath,
  type PortableProjectPath,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import type { BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  rename,
  rmdir,
} from "node:fs/promises";
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

export type ProjectDirectoryReadRequest = ProjectDirectoryCasCreateRequest;

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

export interface ProjectDirectoryCasRemovalRequest
  extends ProjectDirectoryCasDeleteRequest {
  readonly tombstonePath: unknown;
}

export type StagedProjectDirectoryRemovalState =
  | "aborted"
  | "detached"
  | "detaching"
  | "finalized"
  | "finalizing"
  | "restored"
  | "restoring"
  | "staged"
  | "uncertain";

export interface ProjectDirectoryCasDetachResult {
  readonly status: "detached";
  readonly path: PortableProjectPath;
  readonly tombstonePath: PortableProjectPath;
  readonly detachedPath: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

export interface ProjectDirectoryCasRestoreResult {
  readonly status: "restored";
  readonly path: PortableProjectPath;
  readonly tombstonePath: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

export interface ProjectDirectoryCasFinalizeResult {
  readonly status: "deleted";
  readonly path: PortableProjectPath;
  readonly tombstonePath: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

export interface StagedProjectDirectoryCasRemoval {
  readonly state: StagedProjectDirectoryRemovalState;
  readonly path: PortableProjectPath;
  readonly tombstonePath: PortableProjectPath;
  readonly detachedPath: PortableProjectPath;
  readonly expectedIdentity: ProjectDirectoryIdentity;
  detach(): Promise<ProjectDirectoryCasDetachResult>;
  restore(): Promise<ProjectDirectoryCasRestoreResult>;
  finalize(): Promise<ProjectDirectoryCasFinalizeResult>;
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

interface ValidatedRemovalRequest extends ValidatedDeleteRequest {
  readonly path: PortableProjectPath;
  readonly tombstonePath: PortableProjectPath;
  readonly detachedPath: PortableProjectPath;
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

interface DirectoryRemovalContext extends DirectoryDeleteContext {
  readonly request: ValidatedRemovalRequest;
  readonly targetIdentity: FilesystemIdentity;
  readonly tombstone: ResolvedProjectPath;
}

interface DetachedDirectorySnapshot {
  readonly containerIdentity: FilesystemIdentity;
  readonly targetIdentity: FilesystemIdentity;
}

const DIRECTORY_TOMBSTONE_NAME =
  /^\.agpb-cas-dir-[0-9a-f]{32}\.deleted$/;

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

function portableParent(path: PortableProjectPath): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function portableName(path: PortableProjectPath): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}

function validateRemovalRequest(
  value: ProjectDirectoryCasRemovalRequest,
): ValidatedRemovalRequest {
  const common = validateCommonRequest(value, [
    "root",
    "path",
    "expectedIdentity",
    "tombstonePath",
  ]);
  const expectedIdentity = validateExpectedIdentity(value.expectedIdentity);
  const targetPath = parsePortableProjectPath(
    value.path,
    "$request.path",
  );
  const tombstonePath = parsePortableProjectPath(
    value.tombstonePath,
    "$request.tombstonePath",
  );
  if (
    portableParent(targetPath) !== portableParent(tombstonePath) ||
    !DIRECTORY_TOMBSTONE_NAME.test(portableName(tombstonePath))
  ) {
    invalidRequest(
      "directory removal tombstone must be a fixed-format direct sibling",
    );
  }
  return Object.freeze({
    ...common,
    path: targetPath,
    expectedIdentity,
    tombstonePath,
    detachedPath: parsePortableProjectPath(
      `${tombstonePath}/owned`,
      "$request.tombstonePath",
    ),
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
  return createDirectoryIdentityFromParts(
    root,
    target.relativePath,
    target.parentIdentity,
    target.targetIdentity,
  );
}

function createDirectoryIdentityFromParts(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  parentIdentity: FilesystemIdentity,
  targetIdentity: FilesystemIdentity,
): ProjectDirectoryIdentity {
  return Object.freeze({
    schemaVersion: "1.0.0",
    path,
    rootIdentityDigest: root.identityDigest,
    identityDigest: digestCanonicalJson({
      domain: "ai-game-playbook.project-directory-identity.v1",
      path,
      rootIdentityDigest: root.identityDigest,
      parentIdentity,
      targetIdentity,
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

async function assertDirectoryEntries(
  target: ResolvedProjectPath,
  expectedNames: readonly string[],
): Promise<void> {
  const actual: string[] = [];
  let handle;
  try {
    handle = await opendir(target.absolutePath);
    while (actual.length <= expectedNames.length) {
      const entry = await handle.read();
      if (entry === null) break;
      actual.push(entry.name);
    }
  } catch {
    throw new CoreBoundaryError(
      "cas-stage-failed",
      target.relativePath,
      "directory entries could not be inspected",
    );
  } finally {
    await handle?.close();
  }
  const sortedActual = actual.sort();
  const sortedExpected = [...expectedNames].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((name, index) => name !== sortedExpected[index])
  ) {
    preconditionFailure(
      target.relativePath,
      "directory entries changed outside the removal stage",
    );
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

export async function readProjectDirectoryIdentity(
  value: ProjectDirectoryReadRequest,
): Promise<ProjectDirectoryIdentity> {
  const request = validateCreateRequest(value);
  await assertProjectRootIdentity(request.root);
  const first = await resolveDirectory(request, "required");
  const firstIdentity = createDirectoryIdentity(request.root, first);
  await assertProjectRootIdentity(request.root);
  const second = await resolveDirectory(request, "required");
  const secondIdentity = createDirectoryIdentity(request.root, second);
  if (!identitiesMatch(firstIdentity, secondIdentity)) {
    preconditionFailure(
      first.relativePath,
      "directory identity changed while its witness was read",
    );
  }
  return secondIdentity;
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

async function resolveRemovalDirectory(
  request: ValidatedRemovalRequest,
  path: PortableProjectPath,
  existence: "optional" | "required",
): Promise<ResolvedProjectPath> {
  return resolveProjectPath(
    request.root,
    path,
    resolveOptions(request, existence),
  );
}

function assertResolvedIdentity(
  target: ResolvedProjectPath,
  expected: FilesystemIdentity,
  message: string,
): void {
  if (!sameIdentity(expected, target.targetIdentity)) {
    preconditionFailure(target.relativePath, message);
  }
}

async function assertTombstoneAbsent(
  context: DirectoryRemovalContext,
): Promise<ResolvedProjectPath> {
  const tombstone = await resolveRemovalDirectory(
    context.request,
    context.request.tombstonePath,
    "optional",
  );
  if (
    tombstone.kind !== "absent" ||
    !sameIdentity(context.parentIdentity, tombstone.parentIdentity)
  ) {
    preconditionFailure(
      context.request.tombstonePath,
      "directory removal tombstone is no longer absent under the bound parent",
    );
  }
  return tombstone;
}

async function assertRemovalTarget(
  context: DirectoryRemovalContext,
): Promise<ResolvedProjectPath> {
  const current = await assertExpectedDirectory(context.request);
  if (
    !sameIdentity(context.parentIdentity, current.target.parentIdentity) ||
    !sameIdentity(context.targetIdentity, current.target.targetIdentity)
  ) {
    preconditionFailure(
      context.target.relativePath,
      "directory removal target changed after staging",
    );
  }
  await assertEmptyDirectory(current.target);
  return current.target;
}

async function assertTombstoneContainer(
  context: DirectoryRemovalContext,
  snapshot: DetachedDirectorySnapshot,
): Promise<ResolvedProjectPath> {
  const container = await resolveRemovalDirectory(
    context.request,
    context.request.tombstonePath,
    "required",
  );
  if (
    !sameIdentity(context.parentIdentity, container.parentIdentity) ||
    !sameIdentity(snapshot.containerIdentity, container.targetIdentity)
  ) {
    preconditionFailure(
      context.request.tombstonePath,
      "directory removal tombstone identity changed",
    );
  }
  return container;
}

async function inspectMoveState(
  context: DirectoryRemovalContext,
  snapshot: DetachedDirectorySnapshot,
): Promise<"ambiguous" | "detached" | "restored"> {
  try {
    await assertProjectRootIdentity(context.request.root);
    const container = await assertTombstoneContainer(context, snapshot);
    const original = await resolveRemovalDirectory(
      context.request,
      context.target.relativePath,
      "optional",
    );
    const detached = await resolveRemovalDirectory(
      context.request,
      context.request.detachedPath,
      "optional",
    );
    const originalMatches =
      original.kind === "directory" &&
      sameIdentity(snapshot.targetIdentity, original.targetIdentity) &&
      sameIdentity(context.parentIdentity, original.parentIdentity);
    const detachedMatches =
      detached.kind === "directory" &&
      sameIdentity(snapshot.targetIdentity, detached.targetIdentity) &&
      sameIdentity(container.targetIdentity!, detached.parentIdentity);
    if (original.kind === "absent" && detachedMatches) {
      return "detached";
    }
    if (originalMatches && detached.kind === "absent") {
      return "restored";
    }
    return "ambiguous";
  } catch {
    return "ambiguous";
  }
}

async function removeEmptyTombstoneContainer(
  context: DirectoryRemovalContext,
  snapshot: DetachedDirectorySnapshot,
): Promise<void> {
  const container = await assertTombstoneContainer(context, snapshot);
  await assertEmptyDirectory(container);
  try {
    await rmdir(container.absolutePath);
  } catch {
    throw new CoreBoundaryError(
      "cas-cleanup-conflict",
      context.request.tombstonePath,
      "empty directory removal tombstone could not be cleaned",
      true,
    );
  }
  const after = await resolveRemovalDirectory(
    context.request,
    context.request.tombstonePath,
    "optional",
  );
  if (
    after.kind !== "absent" ||
    !sameIdentity(context.parentIdentity, after.parentIdentity)
  ) {
    throw new CoreBoundaryError(
      "cas-cleanup-conflict",
      context.request.tombstonePath,
      "directory removal tombstone cleanup could not be verified",
      true,
    );
  }
  await syncDirectory(context.parentPath);
}

async function createTombstoneContainer(
  context: DirectoryRemovalContext,
): Promise<DetachedDirectorySnapshot> {
  const tombstone = await assertTombstoneAbsent(context);
  try {
    await mkdir(tombstone.absolutePath, { mode: 0o700 });
  } catch (error) {
    if (isFilesystemError(error, "EEXIST")) {
      preconditionFailure(
        context.request.tombstonePath,
        "directory removal tombstone was claimed before detach",
      );
    }
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.request.tombstonePath,
      "directory removal tombstone creation outcome could not be proven",
      true,
    );
  }
  let container: ResolvedProjectPath;
  try {
    container = await resolveRemovalDirectory(
      context.request,
      context.request.tombstonePath,
      "required",
    );
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.request.tombstonePath,
      "new directory removal tombstone could not be attested",
      true,
    );
  }
  if (
    container.targetIdentity === undefined ||
    !sameIdentity(context.parentIdentity, container.parentIdentity)
  ) {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.request.tombstonePath,
      "directory removal tombstone parent changed during creation",
      true,
    );
  }
  await assertEmptyDirectory(container);
  return Object.freeze({
    containerIdentity: container.targetIdentity,
    targetIdentity: context.targetIdentity,
  });
}

async function detachRemovalTarget(
  context: DirectoryRemovalContext,
): Promise<{
  readonly result: ProjectDirectoryCasDetachResult;
  readonly snapshot: DetachedDirectorySnapshot;
}> {
  await assertProjectRootIdentity(context.request.root);
  const target = await assertRemovalTarget(context);
  const snapshot = await createTombstoneContainer(context);
  const container = await assertTombstoneContainer(context, snapshot);
  await assertDirectoryEntries(container, []);
  const detached = await resolveRemovalDirectory(
    context.request,
    context.request.detachedPath,
    "optional",
  );
  if (
    detached.kind !== "absent" ||
    !sameIdentity(snapshot.containerIdentity, detached.parentIdentity)
  ) {
    await removeEmptyTombstoneContainer(context, snapshot);
    preconditionFailure(
      context.request.detachedPath,
      "directory removal destination was claimed before detach",
    );
  }

  let renameError: unknown;
  try {
    await rename(target.absolutePath, detached.absolutePath);
  } catch (error) {
    renameError = error;
  }
  const moveState = await inspectMoveState(context, snapshot);
  if (moveState === "restored") {
    await removeEmptyTombstoneContainer(context, snapshot);
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.target.relativePath,
      renameError === undefined
        ? "directory detach did not reach its postcondition"
        : "directory detach was not committed",
    );
  }
  if (moveState !== "detached") {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "directory detach outcome could not be reconciled",
      true,
    );
  }
  try {
    await syncDirectory(context.parentPath);
    await syncDirectory(container.absolutePath);
    await assertDirectoryEntries(container, ["owned"]);
  } catch {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "detached directory could not be durably attested",
      true,
    );
  }
  return Object.freeze({
    result: Object.freeze({
      status: "detached",
      path: context.target.relativePath,
      tombstonePath: context.request.tombstonePath,
      detachedPath: context.request.detachedPath,
      identity: context.identity,
    }),
    snapshot,
  });
}

async function restoreRemovalTarget(
  context: DirectoryRemovalContext,
  snapshot: DetachedDirectorySnapshot,
): Promise<ProjectDirectoryCasRestoreResult> {
  await assertProjectRootIdentity(context.request.root);
  const original = await resolveRemovalDirectory(
    context.request,
    context.target.relativePath,
    "optional",
  );
  if (
    original.kind !== "absent" ||
    !sameIdentity(context.parentIdentity, original.parentIdentity)
  ) {
    preconditionFailure(
      context.target.relativePath,
      "directory restore target is no longer absent",
    );
  }
  const container = await assertTombstoneContainer(context, snapshot);
  await assertDirectoryEntries(container, ["owned"]);
  const detached = await resolveRemovalDirectory(
    context.request,
    context.request.detachedPath,
    "required",
  );
  assertResolvedIdentity(
    detached,
    snapshot.targetIdentity,
    "detached directory identity changed before restore",
  );

  let renameError: unknown;
  try {
    await rename(detached.absolutePath, original.absolutePath);
  } catch (error) {
    renameError = error;
  }
  const moveState = await inspectMoveState(context, snapshot);
  if (moveState === "detached") {
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.target.relativePath,
      renameError === undefined
        ? "directory restore did not reach its postcondition"
        : "directory restore was not committed",
    );
  }
  if (moveState !== "restored") {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "directory restore outcome could not be reconciled",
      true,
    );
  }
  await removeEmptyTombstoneContainer(context, snapshot);
  const restored = await resolveRemovalDirectory(
    context.request,
    context.target.relativePath,
    "required",
  );
  const restoredIdentity = createDirectoryIdentity(context.request.root, restored);
  if (!identitiesMatch(context.identity, restoredIdentity)) {
    throw new CoreBoundaryError(
      "cas-postcondition-failed",
      context.target.relativePath,
      "restored directory no longer matches its original identity witness",
      true,
    );
  }
  return Object.freeze({
    status: "restored",
    path: context.target.relativePath,
    tombstonePath: context.request.tombstonePath,
    identity: context.identity,
  });
}

async function finalizeRemovalTarget(
  context: DirectoryRemovalContext,
  snapshot: DetachedDirectorySnapshot,
): Promise<ProjectDirectoryCasFinalizeResult> {
  await assertProjectRootIdentity(context.request.root);
  const original = await resolveRemovalDirectory(
    context.request,
    context.target.relativePath,
    "optional",
  );
  if (
    original.kind !== "absent" ||
    !sameIdentity(context.parentIdentity, original.parentIdentity)
  ) {
    preconditionFailure(
      context.target.relativePath,
      "directory removal target reappeared before finalization",
    );
  }
  const container = await assertTombstoneContainer(context, snapshot);
  await assertDirectoryEntries(container, ["owned"]);
  const detached = await resolveRemovalDirectory(
    context.request,
    context.request.detachedPath,
    "required",
  );
  assertResolvedIdentity(
    detached,
    snapshot.targetIdentity,
    "detached directory identity changed before finalization",
  );
  await assertEmptyDirectory(detached);
  try {
    await rmdir(detached.absolutePath);
  } catch (error) {
    if (
      isFilesystemError(error, "ENOTEMPTY") ||
      isFilesystemError(error, "EEXIST")
    ) {
      preconditionFailure(
        context.request.detachedPath,
        "detached directory received content before finalization",
      );
    }
    throw new CoreBoundaryError(
      "cas-commit-failed",
      context.request.detachedPath,
      "detached directory could not be finalized",
    );
  }
  try {
    const afterDetached = await resolveRemovalDirectory(
      context.request,
      context.request.detachedPath,
      "optional",
    );
    if (afterDetached.kind !== "absent") {
      throw new Error("detached directory remained after removal");
    }
    await removeEmptyTombstoneContainer(context, snapshot);
    const finalOriginal = await resolveRemovalDirectory(
      context.request,
      context.target.relativePath,
      "optional",
    );
    if (finalOriginal.kind !== "absent") {
      throw new Error("removed directory reappeared");
    }
  } catch {
    throw new CoreBoundaryError(
      "cas-cleanup-conflict",
      context.target.relativePath,
      "directory was deleted but tombstone cleanup could not be reconciled",
      true,
    );
  }
  return Object.freeze({
    status: "deleted",
    path: context.target.relativePath,
    tombstonePath: context.request.tombstonePath,
    identity: context.identity,
  });
}

function createStagedRemoval(
  context: DirectoryRemovalContext,
): StagedProjectDirectoryCasRemoval {
  let state: StagedProjectDirectoryRemovalState = "staged";
  let detachedSnapshot: DetachedDirectorySnapshot | undefined;
  const requireState = (
    expected: StagedProjectDirectoryRemovalState,
    operation: string,
  ): void => {
    if (state !== expected) {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        `directory removal cannot ${operation} from ${state}`,
        state === "uncertain",
      );
    }
  };
  const detach = async (): Promise<ProjectDirectoryCasDetachResult> => {
    requireState("staged", "detach");
    state = "detaching";
    try {
      const detached = await detachRemovalTarget(context);
      detachedSnapshot = detached.snapshot;
      state = "detached";
      return detached.result;
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "staged";
      throw error;
    }
  };
  const restore = async (): Promise<ProjectDirectoryCasRestoreResult> => {
    requireState("detached", "restore");
    if (detachedSnapshot === undefined) {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        "directory removal lost its detached identity",
        true,
      );
    }
    state = "restoring";
    try {
      const result = await restoreRemovalTarget(context, detachedSnapshot);
      state = "restored";
      return result;
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "detached";
      throw error;
    }
  };
  const finalize = async (): Promise<ProjectDirectoryCasFinalizeResult> => {
    requireState("detached", "finalize");
    if (detachedSnapshot === undefined) {
      throw new CoreBoundaryError(
        "cas-state-invalid",
        context.target.relativePath,
        "directory removal lost its detached identity",
        true,
      );
    }
    state = "finalizing";
    try {
      const result = await finalizeRemovalTarget(context, detachedSnapshot);
      state = "finalized";
      return result;
    } catch (error) {
      state =
        error instanceof CoreBoundaryError && error.mutationUncertain
          ? "uncertain"
          : "detached";
      throw error;
    }
  };
  const abort = async (): Promise<void> => {
    requireState("staged", "abort");
    state = "aborted";
  };
  return Object.freeze({
    get state(): StagedProjectDirectoryRemovalState {
      return state;
    },
    path: context.target.relativePath,
    tombstonePath: context.request.tombstonePath,
    detachedPath: context.request.detachedPath,
    expectedIdentity: context.identity,
    detach,
    restore,
    finalize,
    abort,
  });
}

export async function stageProjectDirectoryCasRemoval(
  value: ProjectDirectoryCasRemovalRequest,
): Promise<StagedProjectDirectoryCasRemoval> {
  const request = validateRemovalRequest(value);
  await assertProjectRootIdentity(request.root);
  const current = await assertExpectedDirectory(request);
  await assertEmptyDirectory(current.target);
  const tombstone = await resolveRemovalDirectory(
    request,
    request.tombstonePath,
    "optional",
  );
  if (
    tombstone.kind !== "absent" ||
    !sameIdentity(current.target.parentIdentity, tombstone.parentIdentity)
  ) {
    preconditionFailure(
      request.tombstonePath,
      "directory removal tombstone must be absent under the target parent",
    );
  }
  const confirmed = await assertExpectedDirectory(request);
  await assertEmptyDirectory(confirmed.target);
  if (
    confirmed.target.targetIdentity === undefined ||
    !sameIdentity(current.target.parentIdentity, confirmed.target.parentIdentity)
  ) {
    preconditionFailure(
      confirmed.target.relativePath,
      "directory identity changed while removal was staged",
    );
  }
  return createStagedRemoval({
    request,
    target: confirmed.target,
    parentPath: dirname(confirmed.target.absolutePath),
    parentIdentity: confirmed.target.parentIdentity,
    targetIdentity: confirmed.target.targetIdentity,
    identity: confirmed.identity,
    tombstone,
  });
}

export async function finalizeDetachedProjectDirectoryCasRemoval(
  value: ProjectDirectoryCasRemovalRequest,
): Promise<ProjectDirectoryCasFinalizeResult> {
  const request = validateRemovalRequest(value);
  await assertProjectRootIdentity(request.root);
  const original = await resolveRemovalDirectory(
    request,
    request.path,
    "optional",
  );
  if (original.kind !== "absent") {
    preconditionFailure(
      original.relativePath,
      "detached directory finalization requires an absent original target",
    );
  }
  const tombstone = await resolveRemovalDirectory(
    request,
    request.tombstonePath,
    "required",
  );
  const detached = await resolveRemovalDirectory(
    request,
    request.detachedPath,
    "required",
  );
  if (
    tombstone.targetIdentity === undefined ||
    detached.targetIdentity === undefined ||
    !sameIdentity(original.parentIdentity, tombstone.parentIdentity) ||
    !sameIdentity(tombstone.targetIdentity, detached.parentIdentity)
  ) {
    preconditionFailure(
      request.tombstonePath,
      "detached directory tombstone identity is inconsistent",
    );
  }
  const reconstructed = createDirectoryIdentityFromParts(
    request.root,
    original.relativePath,
    original.parentIdentity,
    detached.targetIdentity,
  );
  if (!identitiesMatch(request.expectedIdentity, reconstructed)) {
    preconditionFailure(
      original.relativePath,
      "detached directory does not match the original ownership witness",
    );
  }
  const snapshot: DetachedDirectorySnapshot = Object.freeze({
    containerIdentity: tombstone.targetIdentity,
    targetIdentity: detached.targetIdentity,
  });
  const context: DirectoryRemovalContext = {
    request,
    target: original,
    parentPath: dirname(original.absolutePath),
    parentIdentity: original.parentIdentity,
    targetIdentity: detached.targetIdentity,
    identity: request.expectedIdentity,
    tombstone,
  };
  return finalizeRemovalTarget(context, snapshot);
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
