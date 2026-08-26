import type {
  PortableProjectPath,
  Sha256Digest,
} from "@ai-game-playbook/contracts";
import type { BigIntStats } from "node:fs";
import { lstat, mkdir, rmdir } from "node:fs/promises";

import { CoreBoundaryError } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type FilesystemIdentity,
  type ResolvedProjectPath,
} from "./project-path.js";

export const PROJECT_STATE_DIRECTORIES: readonly string[] = Object.freeze([
  ".ai-game-playbook",
  ".ai-game-playbook/locks",
  ".ai-game-playbook/state",
  ".ai-game-playbook/state/packs",
  ".ai-game-playbook/state/packs/transactions",
  ".ai-game-playbook/state/workflows",
]);

export interface InitializeProjectStateRequest {
  readonly root: CanonicalProjectRoot;
}

export interface ProjectStateInitializationResult {
  readonly schemaVersion: "1.0.0";
  readonly status: "created" | "ready";
  readonly rootIdentityDigest: Sha256Digest;
  readonly createdDirectories: readonly PortableProjectPath[];
  readonly existingDirectories: readonly PortableProjectPath[];
}

interface CreatedDirectory {
  readonly path: PortableProjectPath;
  readonly absolutePath: string;
  readonly parentIdentity: FilesystemIdentity;
  readonly targetIdentity: FilesystemIdentity;
}

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
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

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
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

function initializationError(
  code:
    | "invalid-project-state-request"
    | "project-state-initialization-failed"
    | "project-state-initialization-uncertain",
  path: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new CoreBoundaryError(code, path, message, mutationUncertain);
}

function validateRequest(
  value: InitializeProjectStateRequest,
): InitializeProjectStateRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(value, ["root"])
  ) {
    initializationError(
      "invalid-project-state-request",
      "$projectState",
      "project state initialization requires only a bound project root",
    );
  }
  return Object.freeze({ root: value.root });
}

async function resolveDirectory(
  root: CanonicalProjectRoot,
  path: string,
  existence: "optional" | "required",
): Promise<ResolvedProjectPath> {
  return resolveProjectPath(root, path, {
    expectedType: "directory",
    existence,
  });
}

async function captureCreatedDirectory(
  root: CanonicalProjectRoot,
  candidate: ResolvedProjectPath,
): Promise<CreatedDirectory> {
  let current: ResolvedProjectPath;
  try {
    current = await resolveDirectory(root, candidate.relativePath, "required");
  } catch {
    initializationError(
      "project-state-initialization-uncertain",
      candidate.relativePath,
      "a newly created runtime directory could not be attested",
      true,
    );
  }
  if (
    current.targetIdentity === undefined ||
    !sameIdentity(candidate.parentIdentity, current.parentIdentity)
  ) {
    initializationError(
      "project-state-initialization-uncertain",
      candidate.relativePath,
      "the runtime directory parent changed during initialization",
      true,
    );
  }
  return Object.freeze({
    path: candidate.relativePath,
    absolutePath: current.absolutePath,
    parentIdentity: current.parentIdentity,
    targetIdentity: current.targetIdentity,
  });
}

async function acceptConcurrentDirectory(
  root: CanonicalProjectRoot,
  candidate: ResolvedProjectPath,
): Promise<void> {
  const current = await resolveDirectory(
    root,
    candidate.relativePath,
    "required",
  );
  if (!sameIdentity(candidate.parentIdentity, current.parentIdentity)) {
    initializationError(
      "project-state-initialization-failed",
      candidate.relativePath,
      "the runtime directory parent changed during concurrent initialization",
    );
  }
}

async function verifyRollbackTarget(
  root: CanonicalProjectRoot,
  created: CreatedDirectory,
): Promise<ResolvedProjectPath | undefined> {
  let current: ResolvedProjectPath;
  try {
    current = await resolveDirectory(root, created.path, "optional");
  } catch (error) {
    if (error instanceof CoreBoundaryError) {
      initializationError(
        "project-state-initialization-uncertain",
        created.path,
        "a created runtime directory could not be inspected during rollback",
        true,
      );
    }
    throw error;
  }
  if (!sameIdentity(created.parentIdentity, current.parentIdentity)) {
    initializationError(
      "project-state-initialization-uncertain",
      created.path,
      "a runtime directory parent changed before rollback",
      true,
    );
  }
  if (current.kind === "absent") {
    return undefined;
  }
  if (
    current.targetIdentity === undefined ||
    !sameIdentity(created.targetIdentity, current.targetIdentity)
  ) {
    initializationError(
      "project-state-initialization-uncertain",
      created.path,
      "a runtime directory changed identity before rollback",
      true,
    );
  }
  return current;
}

async function rollbackCreatedDirectories(
  root: CanonicalProjectRoot,
  createdDirectories: readonly CreatedDirectory[],
): Promise<void> {
  for (const created of [...createdDirectories].reverse()) {
    const current = await verifyRollbackTarget(root, created);
    if (current === undefined) {
      continue;
    }

    try {
      const before = await lstat(current.absolutePath, { bigint: true });
      if (!sameIdentity(created.targetIdentity, identityOf(before))) {
        initializationError(
          "project-state-initialization-uncertain",
          created.path,
          "a runtime directory changed identity at rollback",
          true,
        );
      }
      await rmdir(current.absolutePath);
    } catch (error) {
      if (error instanceof CoreBoundaryError) {
        throw error;
      }
      if (!isMissing(error)) {
        initializationError(
          "project-state-initialization-uncertain",
          created.path,
          "a created runtime directory could not be removed safely",
          true,
        );
      }
    }

    const after = await verifyRollbackTarget(root, created);
    if (after !== undefined) {
      initializationError(
        "project-state-initialization-uncertain",
        created.path,
        "a created runtime directory remained after rollback",
        true,
      );
    }
  }
}

export async function initializeProjectState(
  value: InitializeProjectStateRequest,
): Promise<ProjectStateInitializationResult> {
  const request = validateRequest(value);
  await assertProjectRootIdentity(request.root);

  const createdDirectories: CreatedDirectory[] = [];
  const existingDirectories: PortableProjectPath[] = [];
  try {
    for (const path of PROJECT_STATE_DIRECTORIES) {
      const candidate = await resolveDirectory(request.root, path, "optional");
      if (candidate.kind === "directory") {
        existingDirectories.push(candidate.relativePath);
        continue;
      }

      try {
        await mkdir(candidate.absolutePath, { mode: 0o700 });
      } catch (error) {
        if (!isAlreadyPresent(error)) {
          initializationError(
            "project-state-initialization-failed",
            path,
            "the runtime directory could not be created",
          );
        }
        await acceptConcurrentDirectory(request.root, candidate);
        existingDirectories.push(candidate.relativePath);
        continue;
      }

      createdDirectories.push(
        await captureCreatedDirectory(request.root, candidate),
      );
    }
  } catch (error) {
    try {
      await rollbackCreatedDirectories(request.root, createdDirectories);
    } catch (rollbackError) {
      if (rollbackError instanceof CoreBoundaryError) {
        throw rollbackError;
      }
      initializationError(
        "project-state-initialization-uncertain",
        "$projectState",
        "project state rollback could not be verified",
        true,
      );
    }
    throw error;
  }

  const createdPaths = Object.freeze(
    createdDirectories.map((directory) => directory.path),
  );
  const existingPaths = Object.freeze([...existingDirectories]);
  return Object.freeze({
    schemaVersion: "1.0.0",
    status: createdPaths.length === 0 ? "ready" : "created",
    rootIdentityDigest: request.root.identityDigest,
    createdDirectories: createdPaths,
    existingDirectories: existingPaths,
  });
}
