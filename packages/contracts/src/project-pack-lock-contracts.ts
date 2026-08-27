import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import type { SemanticVersion } from "./semantic-version.js";
import { parseSemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  reference,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const PROJECT_PACK_LOCK_MAX_PACKS = 1_024;
export const PROJECT_PACK_LOCK_MAX_DEPENDENCIES = 256;

export interface ProjectPackLockDependency {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly manifestDigest: Sha256Digest;
}

export interface ProjectPackLockEntry {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly manifestDigest: Sha256Digest;
  readonly dependencies: readonly ProjectPackLockDependency[];
}

export interface ProjectPackLock {
  readonly schemaVersion: "1.0.0";
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly packs: readonly ProjectPackLockEntry[];
  readonly lockDigest: Sha256Digest;
}

export type ProjectPackLockDigestInput = Omit<ProjectPackLock, "lockDigest"> &
  Partial<Pick<ProjectPackLock, "lockDigest">>;

interface EmptyProjectPackLockInput {
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
}

type DataRecord = Record<string, unknown>;

function dataRecord(value: unknown, message: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw new TypeError(message);
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new TypeError("project pack lock fields are not exact");
  }
}

function semanticVersion(value: unknown): SemanticVersion {
  if (typeof value !== "string") {
    throw new TypeError("project pack lock version is invalid");
  }
  try {
    return parseSemanticVersion(value).value;
  } catch {
    throw new TypeError("project pack lock version is invalid");
  }
}

function stableId(value: unknown): StableId {
  if (!isStableId(value)) {
    throw new TypeError("project pack lock ID is invalid");
  }
  return value;
}

function digest(value: unknown): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw new TypeError("project pack lock digest is invalid");
  }
  return value;
}

function canonicalIds<T extends { readonly id: string }>(
  values: readonly T[],
): boolean {
  return values.every(
    ({ id }, index) => index === 0 || values[index - 1]!.id < id,
  );
}

function validateDependency(value: unknown): ProjectPackLockDependency {
  const record = dataRecord(
    value,
    "project pack lock dependency is invalid",
  );
  exactKeys(record, ["id", "version", "manifestDigest"]);
  return {
    id: stableId(record["id"]),
    version: semanticVersion(record["version"]),
    manifestDigest: digest(record["manifestDigest"]),
  };
}

function validateEntry(value: unknown): ProjectPackLockEntry {
  const record = dataRecord(value, "project pack lock entry is invalid");
  exactKeys(record, ["id", "version", "manifestDigest", "dependencies"]);
  if (
    !Array.isArray(record["dependencies"]) ||
    record["dependencies"].length > PROJECT_PACK_LOCK_MAX_DEPENDENCIES
  ) {
    throw new RangeError("project pack lock dependency count is invalid");
  }
  const dependencies = record["dependencies"].map(validateDependency);
  if (!canonicalIds(dependencies)) {
    throw new TypeError("project pack lock dependencies are not canonical");
  }
  return {
    id: stableId(record["id"]),
    version: semanticVersion(record["version"]),
    manifestDigest: digest(record["manifestDigest"]),
    dependencies,
  };
}

function validateDigestInput(value: unknown): {
  readonly schemaVersion: "1.0.0";
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly packs: readonly ProjectPackLockEntry[];
} {
  const record = dataRecord(value, "project pack lock body is invalid");
  exactKeys(
    record,
    ["schemaVersion", "projectId", "projectIdentityDigest", "packs"],
    ["lockDigest"],
  );
  if (record["schemaVersion"] !== "1.0.0") {
    throw new TypeError("project pack lock schema version is unsupported");
  }
  if (
    !Array.isArray(record["packs"]) ||
    record["packs"].length > PROJECT_PACK_LOCK_MAX_PACKS
  ) {
    throw new RangeError("project pack lock pack count is invalid");
  }
  const packs = record["packs"].map(validateEntry);
  if (!canonicalIds(packs)) {
    throw new TypeError("project pack lock packs are not canonical");
  }
  return {
    schemaVersion: "1.0.0",
    projectId: stableId(record["projectId"]),
    projectIdentityDigest: digest(record["projectIdentityDigest"]),
    packs,
  };
}

export function computeProjectPackLockDigest(
  value: ProjectPackLockDigestInput,
): Sha256Digest {
  const body = validateDigestInput(value);
  return digestCanonicalJson({
    domain: "ai-game-playbook/project-pack-lock",
    version: "1.0.0",
    ...body,
  });
}

export function assertProjectPackLockSemantics(
  value: ProjectPackLock,
): void {
  const record = dataRecord(value, "project pack lock is invalid");
  exactKeys(record, [
    "schemaVersion",
    "projectId",
    "projectIdentityDigest",
    "packs",
    "lockDigest",
  ]);
  const body = validateDigestInput(value);
  const byId = new Map(body.packs.map((entry) => [entry.id, entry]));
  for (const entry of body.packs) {
    for (const dependency of entry.dependencies) {
      const resolved = byId.get(dependency.id);
      if (
        dependency.id === entry.id ||
        resolved === undefined ||
        resolved.version !== dependency.version ||
        resolved.manifestDigest !== dependency.manifestDigest
      ) {
        throw new TypeError(
          "project pack lock dependency does not resolve exactly",
        );
      }
    }
  }
  const remainingDependencies = new Map(
    body.packs.map((entry) => [entry.id, entry.dependencies.length]),
  );
  const dependents = new Map<StableId, StableId[]>();
  for (const entry of body.packs) {
    for (const dependency of entry.dependencies) {
      const existing = dependents.get(dependency.id);
      if (existing === undefined) dependents.set(dependency.id, [entry.id]);
      else existing.push(entry.id);
    }
  }
  const ready = body.packs
    .filter((entry) => entry.dependencies.length === 0)
    .map((entry) => entry.id);
  let resolvedCount = 0;
  for (let index = 0; index < ready.length; index += 1) {
    const resolvedId = ready[index]!;
    resolvedCount += 1;
    for (const dependentId of dependents.get(resolvedId) ?? []) {
      const remaining = remainingDependencies.get(dependentId)! - 1;
      remainingDependencies.set(dependentId, remaining);
      if (remaining === 0) ready.push(dependentId);
    }
  }
  if (resolvedCount !== body.packs.length) {
    throw new TypeError("project pack lock dependency graph contains a cycle");
  }
  if (
    !isSha256Digest(record["lockDigest"]) ||
    record["lockDigest"] !== computeProjectPackLockDigest(body)
  ) {
    throw new TypeError("project pack lock digest does not attest its body");
  }
}

export function createEmptyProjectPackLock(
  value: EmptyProjectPackLockInput,
): ProjectPackLock {
  const record = dataRecord(value, "empty project pack lock input is invalid");
  exactKeys(record, ["projectId", "projectIdentityDigest"]);
  const body = {
    schemaVersion: "1.0.0" as const,
    projectId: stableId(record["projectId"]),
    projectIdentityDigest: digest(record["projectIdentityDigest"]),
    packs: Object.freeze([]) as readonly ProjectPackLockEntry[],
  };
  return Object.freeze({
    ...body,
    lockDigest: computeProjectPackLockDigest(body),
  });
}

const lockDependency = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    manifestDigest: reference("sha256Digest"),
  },
  ["id", "version", "manifestDigest"],
);

const lockEntry = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    manifestDigest: reference("sha256Digest"),
    dependencies: boundedArray(lockDependency, {
      maximum: PROJECT_PACK_LOCK_MAX_DEPENDENCIES,
    }),
  },
  ["id", "version", "manifestDigest", "dependencies"],
);

export const projectPackLockSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-pack-lock",
    version: "1.0.0",
    title: "Project Pack Lock",
    description:
      "Records portable, exact managed-pack identities for one game project.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        projectId: reference("stableId"),
        projectIdentityDigest: reference("sha256Digest"),
        packs: boundedArray(lockEntry, {
          maximum: PROJECT_PACK_LOCK_MAX_PACKS,
        }),
        lockDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "projectId",
        "projectIdentityDigest",
        "packs",
        "lockDigest",
      ],
    ),
  });
