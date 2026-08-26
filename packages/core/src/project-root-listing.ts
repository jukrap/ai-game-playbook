import { compareCanonicalText } from "@ai-game-playbook/contracts";
import { opendir } from "node:fs/promises";
import type { Dirent } from "node:fs";

import { CoreBoundaryError } from "./errors.js";
import {
  assertProjectRootIdentity,
  type CanonicalProjectRoot,
} from "./project-path.js";

export type ProjectRootEntryKindHint =
  | "directory"
  | "file"
  | "link"
  | "other";

export interface ListProjectRootEntriesRequest {
  readonly root: CanonicalProjectRoot;
  readonly maxEntries: number;
}

export interface ProjectRootEntry {
  readonly name: string;
  readonly kindHint: ProjectRootEntryKindHint;
}

interface ValidatedListProjectRootEntriesRequest {
  readonly root: CanonicalProjectRoot;
  readonly maxEntries: number;
}

export const PROJECT_ROOT_LISTING_MAX_ENTRIES = 100_000;
export const PROJECT_ROOT_ENTRY_MAX_CODE_UNITS = 255;

function invalidRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-project-root-listing-request",
    "$projectRootListing",
    message,
  );
}

function hasExactRequestKeys(value: object): boolean {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return false;
  }
  return (
    keys.length === 2 &&
    keys.every((key) => key === "root" || key === "maxEntries") &&
    keys.includes("root") &&
    keys.includes("maxEntries")
  );
}

function validateRequest(
  value: ListProjectRootEntriesRequest,
): ValidatedListProjectRootEntriesRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !hasExactRequestKeys(value)
  ) {
    invalidRequest("root listing requires exactly root and maxEntries");
  }

  let root: CanonicalProjectRoot;
  let maxEntries: number;
  try {
    root = value.root;
    maxEntries = value.maxEntries;
  } catch {
    invalidRequest("root listing request properties could not be read");
  }
  if (
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1 ||
    maxEntries > PROJECT_ROOT_LISTING_MAX_ENTRIES
  ) {
    invalidRequest("maxEntries must be an integer within the runtime limit");
  }

  return Object.freeze({ root, maxEntries });
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function assertRepresentableEntryName(name: string): void {
  if (
    name.length === 0 ||
    name.length > PROJECT_ROOT_ENTRY_MAX_CODE_UNITS ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\uFFFD") ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    hasLoneSurrogate(name)
  ) {
    throw new CoreBoundaryError(
      "project-root-entry-unrepresentable",
      "$projectRootEntry",
      "project root contains an entry name outside the inspection boundary",
    );
  }
}

function kindHint(entry: Dirent): ProjectRootEntryKindHint {
  if (entry.isSymbolicLink()) {
    return "link";
  }
  if (entry.isDirectory()) {
    return "directory";
  }
  if (entry.isFile()) {
    return "file";
  }
  return "other";
}

function listingFailure(error: unknown): never {
  if (error instanceof CoreBoundaryError) {
    throw error;
  }
  throw new CoreBoundaryError(
    "filesystem-operation-failed",
    "$projectRoot",
    "project root entries could not be inspected",
  );
}

async function enumerateRootEntries(
  request: ValidatedListProjectRootEntriesRequest,
): Promise<readonly ProjectRootEntry[]> {
  const entries = new Map<string, ProjectRootEntry>();
  let observed = 0;
  let directory: Awaited<ReturnType<typeof opendir>> | undefined;
  let failure: unknown;

  try {
    directory = await opendir(request.root.canonicalPath);
    while (true) {
      const entry = await directory.read();
      if (entry === null) {
        break;
      }
      observed += 1;
      if (observed > request.maxEntries) {
        throw new CoreBoundaryError(
          "project-root-listing-budget-exceeded",
          "$projectRoot",
          "project root entry budget was exceeded",
        );
      }
      assertRepresentableEntryName(entry.name);
      entries.set(
        entry.name,
        Object.freeze({ name: entry.name, kindHint: kindHint(entry) }),
      );
    }
  } catch (error) {
    failure = error;
  }

  if (directory !== undefined) {
    try {
      await directory.close();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== undefined) {
    listingFailure(failure);
  }

  return Object.freeze(
    [...entries.values()].sort((left, right) =>
      compareCanonicalText(left.name, right.name),
    ),
  );
}

export async function listProjectRootEntries(
  value: ListProjectRootEntriesRequest,
): Promise<readonly ProjectRootEntry[]> {
  const request = validateRequest(value);
  await assertProjectRootIdentity(request.root);

  let entries: readonly ProjectRootEntry[] | undefined;
  let listingError: unknown;
  try {
    entries = await enumerateRootEntries(request);
  } catch (error) {
    listingError = error;
  }

  await assertProjectRootIdentity(request.root);
  if (listingError !== undefined) {
    listingFailure(listingError);
  }
  if (entries === undefined) {
    throw new CoreBoundaryError(
      "filesystem-operation-failed",
      "$projectRoot",
      "project root listing ended without a result",
    );
  }
  return entries;
}
