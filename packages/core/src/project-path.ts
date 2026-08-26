import {
  digestCanonicalJson,
  parsePortableProjectPath,
  type PortableProjectPath,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  lstat,
  opendir,
  realpath,
  stat,
} from "node:fs/promises";
import type { BigIntStats, Dirent } from "node:fs";
import { homedir } from "node:os";
import {
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  sep,
} from "node:path";

import { CoreBoundaryError } from "./errors.js";

export interface FilesystemIdentity {
  readonly device: string;
  readonly inode: string;
}

export interface CanonicalProjectRoot extends FilesystemIdentity {
  readonly requestedPath: string;
  readonly canonicalPath: string;
  readonly platform: NodeJS.Platform;
  readonly identityDigest: Sha256Digest;
}

export type ResolvedProjectPathKind =
  | "absent"
  | "directory"
  | "file"
  | "other";

export interface ResolveProjectPathOptions {
  readonly expectedType: "any" | "directory" | "file";
  readonly existence: "forbidden" | "optional" | "required";
  readonly maxDirectoryEntries?: number;
}

export interface ResolvedProjectPath {
  readonly relativePath: PortableProjectPath;
  readonly absolutePath: string;
  readonly kind: ResolvedProjectPathKind;
  readonly parentIdentity: FilesystemIdentity;
  readonly targetIdentity?: FilesystemIdentity;
}

interface NormalizedResolveProjectPathOptions {
  readonly expectedType: ResolveProjectPathOptions["expectedType"];
  readonly existence: ResolveProjectPathOptions["existence"];
  readonly maxDirectoryEntries: number;
}

const boundProjectRoots = new WeakSet<object>();
const DEFAULT_MAX_DIRECTORY_ENTRIES = 10_000;
const MAX_DIRECTORY_ENTRIES = 100_000;

function filesystemIdentity(stats: BigIntStats): FilesystemIdentity {
  return Object.freeze({
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
  });
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function projectRootError(error: unknown): never {
  if (isMissing(error)) {
    throw new CoreBoundaryError(
      "project-root-not-found",
      "$projectRoot",
      "project root does not exist",
    );
  }
  throw new CoreBoundaryError(
    "filesystem-operation-failed",
    "$projectRoot",
    "project root could not be inspected",
  );
}

function pathError(
  error: unknown,
  path: PortableProjectPath,
  missingCode: "project-path-not-found" | "project-root-drift" =
    "project-path-not-found",
): never {
  if (isMissing(error)) {
    throw new CoreBoundaryError(
      missingCode,
      path,
      missingCode === "project-root-drift"
        ? "bound project root no longer has the same identity"
        : "project path does not exist",
    );
  }
  throw new CoreBoundaryError(
    "filesystem-operation-failed",
    path,
    "project path could not be inspected",
  );
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

async function realHomePath(): Promise<string | undefined> {
  try {
    return await realpath(homedir());
  } catch {
    return undefined;
  }
}

export async function canonicalizeProjectRoot(
  value: unknown,
): Promise<CanonicalProjectRoot> {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 32767 ||
    value.includes("\0") ||
    !isAbsolute(value)
  ) {
    throw new CoreBoundaryError(
      "invalid-project-root",
      "$projectRoot",
      "project root must be a bounded absolute path",
    );
  }

  const requestedPath = normalize(value);
  if (
    process.platform === "win32" &&
    (requestedPath.startsWith("\\\\") ||
      requestedPath.startsWith("\\?\\") ||
      requestedPath.startsWith("\\.\\"))
  ) {
    throw new CoreBoundaryError(
      "unsafe-project-root",
      "$projectRoot",
      "UNC and device roots are outside the initial safety boundary",
    );
  }

  try {
    await lstat(requestedPath, { bigint: true });
  } catch (error) {
    projectRootError(error);
  }

  let canonicalPath: string;
  let rootStats: BigIntStats;
  try {
    canonicalPath = await realpath(requestedPath);
    rootStats = await stat(canonicalPath, { bigint: true });
  } catch (error) {
    projectRootError(error);
  }
  if (!rootStats.isDirectory()) {
    throw new CoreBoundaryError(
      "project-root-not-directory",
      "$projectRoot",
      "project root must resolve to a directory",
    );
  }

  const homePath = await realHomePath();
  if (
    samePath(canonicalPath, parse(canonicalPath).root) ||
    (homePath !== undefined && samePath(canonicalPath, homePath))
  ) {
    throw new CoreBoundaryError(
      "unsafe-project-root",
      "$projectRoot",
      "broad filesystem and user-home roots are not project roots",
    );
  }

  const identity = filesystemIdentity(rootStats);
  const identityPath =
    process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath;
  const root: CanonicalProjectRoot = Object.freeze({
    requestedPath,
    canonicalPath,
    platform: process.platform,
    identityDigest: digestCanonicalJson({
      path: identityPath,
      platform: process.platform,
      device: identity.device,
      inode: identity.inode,
    }),
    ...identity,
  });
  boundProjectRoots.add(root);
  return root;
}

export async function assertProjectRootIdentity(
  root: CanonicalProjectRoot,
): Promise<void> {
  if (
    typeof root !== "object" ||
    root === null ||
    !boundProjectRoots.has(root)
  ) {
    throw new CoreBoundaryError(
      "invalid-project-root",
      "$projectRoot",
      "project root was not bound by this core runtime",
    );
  }
  let before: BigIntStats;
  let currentCanonicalPath: string;
  let after: BigIntStats;
  try {
    before = await lstat(root.canonicalPath, { bigint: true });
    currentCanonicalPath = await realpath(root.canonicalPath);
    after = await lstat(root.canonicalPath, { bigint: true });
  } catch (error) {
    if (isMissing(error)) {
      throw new CoreBoundaryError(
        "project-root-drift",
        "$projectRoot",
        "bound project root no longer has the same identity",
      );
    }
    throw new CoreBoundaryError(
      "filesystem-operation-failed",
      "$projectRoot",
      "bound project root could not be inspected",
    );
  }
  if (
    before.isSymbolicLink() ||
    after.isSymbolicLink() ||
    !before.isDirectory() ||
    !after.isDirectory() ||
    !samePath(currentCanonicalPath, root.canonicalPath) ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.dev.toString() !== root.device ||
    after.ino.toString() !== root.inode
  ) {
    throw new CoreBoundaryError(
      "project-root-drift",
      "$projectRoot",
      "bound project root no longer has the same identity",
    );
  }
}

function normalizeResolveOptions(
  value: ResolveProjectPathOptions,
): NormalizedResolveProjectPathOptions {
  const expectedType = value?.expectedType;
  const existence = value?.existence;
  const maxDirectoryEntries =
    value?.maxDirectoryEntries ?? DEFAULT_MAX_DIRECTORY_ENTRIES;
  if (
    !["any", "directory", "file"].includes(expectedType) ||
    !["forbidden", "optional", "required"].includes(existence) ||
    !Number.isSafeInteger(maxDirectoryEntries) ||
    maxDirectoryEntries < 1 ||
    maxDirectoryEntries > MAX_DIRECTORY_ENTRIES
  ) {
    throw new CoreBoundaryError(
      "invalid-project-path-options",
      "$options",
      "project path options are invalid or exceed runtime limits",
    );
  }
  return {
    expectedType,
    existence,
    maxDirectoryEntries,
  } as NormalizedResolveProjectPathOptions;
}

async function findDirectoryMatches(
  directoryPath: string,
  segment: string,
  maxDirectoryEntries: number,
  path: PortableProjectPath,
): Promise<Dirent[]> {
  const matches: Dirent[] = [];
  const folded = segment.toLowerCase();
  let count = 0;
  try {
    const directory = await opendir(directoryPath);
    for await (const entry of directory) {
      count += 1;
      if (count > maxDirectoryEntries) {
        throw new CoreBoundaryError(
          "project-path-budget-exceeded",
          path,
          "directory entry budget was exceeded during path resolution",
        );
      }
      if (entry.name.toLowerCase() === folded) {
        matches.push(entry);
      }
    }
  } catch (error) {
    if (error instanceof CoreBoundaryError) {
      throw error;
    }
    pathError(error, path);
  }
  return matches;
}

function kindOf(stats: BigIntStats): ResolvedProjectPathKind {
  if (stats.isFile()) {
    return "file";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  return "other";
}

async function checkedRealPath(
  root: CanonicalProjectRoot,
  candidate: string,
  path: PortableProjectPath,
): Promise<string> {
  let resolved: string;
  try {
    resolved = await realpath(candidate);
  } catch (error) {
    pathError(error, path);
  }
  if (!isContained(root.canonicalPath, resolved)) {
    throw new CoreBoundaryError(
      "project-path-escape",
      path,
      "resolved path escapes the bound project root",
    );
  }
  return resolved;
}

export async function resolveProjectPath(
  root: CanonicalProjectRoot,
  value: unknown,
  options: ResolveProjectPathOptions,
): Promise<ResolvedProjectPath> {
  const portablePath = parsePortableProjectPath(value, "$projectPath");
  const normalizedOptions = normalizeResolveOptions(options);
  await assertProjectRootIdentity(root);

  const segments = portablePath.split("/");
  let currentDirectory = root.canonicalPath;
  let parentStats: BigIntStats;
  try {
    parentStats = await stat(currentDirectory, { bigint: true });
  } catch (error) {
    pathError(error, portablePath, "project-root-drift");
  }

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) {
      throw new CoreBoundaryError(
        "project-path-not-found",
        portablePath,
        "project path segment is missing",
      );
    }
    const final = index === segments.length - 1;
    const matches = await findDirectoryMatches(
      currentDirectory,
      segment,
      normalizedOptions.maxDirectoryEntries,
      portablePath,
    );
    if (
      matches.length > 1 ||
      (matches.length === 1 && matches[0]?.name !== segment)
    ) {
      throw new CoreBoundaryError(
        "project-path-case-conflict",
        portablePath,
        "project path has a case-insensitive filesystem collision",
      );
    }

    const match = matches[0];
    const candidate = join(currentDirectory, segment);
    if (!isContained(root.canonicalPath, candidate)) {
      throw new CoreBoundaryError(
        "project-path-escape",
        portablePath,
        "project path escapes the bound project root",
      );
    }
    if (match === undefined) {
      if (!final || normalizedOptions.existence === "required") {
        throw new CoreBoundaryError(
          "project-path-not-found",
          portablePath,
          "project path does not exist",
        );
      }
      await assertProjectRootIdentity(root);
      return Object.freeze({
        relativePath: portablePath,
        absolutePath: candidate,
        kind: "absent",
        parentIdentity: filesystemIdentity(parentStats),
      });
    }

    let targetStats: BigIntStats;
    try {
      targetStats = await lstat(candidate, { bigint: true });
    } catch (error) {
      pathError(error, portablePath);
    }
    if (match.isSymbolicLink() || targetStats.isSymbolicLink()) {
      throw new CoreBoundaryError(
        "project-path-link",
        portablePath,
        "symbolic links and junctions are not writable project path components",
      );
    }

    const resolved = await checkedRealPath(root, candidate, portablePath);
    const kind = kindOf(targetStats);
    if (!final) {
      if (kind !== "directory") {
        throw new CoreBoundaryError(
          "project-path-type-mismatch",
          portablePath,
          "an intermediate project path component is not a directory",
        );
      }
      currentDirectory = resolved;
      parentStats = targetStats;
      continue;
    }

    if (normalizedOptions.existence === "forbidden") {
      throw new CoreBoundaryError(
        "project-path-exists",
        portablePath,
        "project path already exists",
      );
    }
    if (
      normalizedOptions.expectedType !== "any" &&
      kind !== normalizedOptions.expectedType
    ) {
      throw new CoreBoundaryError(
        "project-path-type-mismatch",
        portablePath,
        `project path is not a ${normalizedOptions.expectedType}`,
      );
    }
    await assertProjectRootIdentity(root);
    return Object.freeze({
      relativePath: portablePath,
      absolutePath: resolved,
      kind,
      parentIdentity: filesystemIdentity(parentStats),
      targetIdentity: filesystemIdentity(targetStats),
    });
  }

  throw new CoreBoundaryError(
    "project-path-not-found",
    portablePath,
    "project path could not be resolved",
  );
}
