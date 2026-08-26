import {
  canonicalizeJson,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  type SemanticVersion,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  deleteProjectFileCas,
  readProjectFileSnapshot,
  writeProjectFileCas,
  type CanonicalProjectRoot,
  type ProjectFileCasDeleteResult,
} from "@ai-game-playbook/core";

import { PackRuntimeError } from "./errors.js";
import {
  computePackTransactionRecordDigest,
  packTransactionRecordPath,
  parsePackTransactionStartedRecord,
  type PackTransactionStartedRecord,
} from "./transaction-journal.js";
import type { PackOperation } from "./types.js";

export const PACK_ACTIVE_TRANSACTION_PATH: string =
  ".ai-game-playbook/state/packs/active.json";
export const PACK_ACTIVE_TRANSACTION_MAX_BYTES: number = 640 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type MutableRecord = Record<string, unknown>;

export interface ActivePackTransactionRecord {
  readonly schemaVersion: "1.0.0";
  readonly kind: "active-pack-transaction";
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly planDigest: Sha256Digest;
  readonly operation: PackOperation;
  readonly pack: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly digest: Sha256Digest;
  };
  readonly startedRecordPath: string;
  readonly startedRecordDigest: Sha256Digest;
  readonly started: PackTransactionStartedRecord;
  readonly recordDigest: Sha256Digest;
}

export interface LoadedActivePackTransaction {
  readonly record: ActivePackTransactionRecord;
  readonly fileDigest: Sha256Digest;
  readonly bytes: number;
}

export interface LoadActivePackTransactionRequest {
  readonly root: unknown;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly maxDirectoryEntries: number;
}

export interface WriteActivePackTransactionRecordRequest {
  readonly root: CanonicalProjectRoot;
  readonly record: ActivePackTransactionRecord;
  readonly maxDirectoryEntries: number;
}

export interface ClearActivePackTransactionRecordRequest {
  readonly root: CanonicalProjectRoot;
  readonly active: LoadedActivePackTransaction;
  readonly maxDirectoryEntries: number;
}

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: MutableRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validDirectoryBudget(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 100_000;
}

function activeError(path: string, message: string): never {
  throw new PackRuntimeError("pack-transaction-corrupt", path, message);
}

function freezeRecord(
  record: ActivePackTransactionRecord,
): ActivePackTransactionRecord {
  return Object.freeze({
    ...record,
    project: Object.freeze({ ...record.project }),
    pack: Object.freeze({ ...record.pack }),
    started: record.started,
  });
}

export function computeActivePackTransactionRecordDigest(
  value: Omit<ActivePackTransactionRecord, "recordDigest"> &
    Partial<Pick<ActivePackTransactionRecord, "recordDigest">>,
): Sha256Digest {
  const { recordDigest: _recordDigest, ...body } = value;
  return digestCanonicalJson({
    domain: "ai-game-playbook.active-pack-transaction",
    version: "1",
    record: body,
  });
}

export function createActivePackTransactionRecord(
  started: PackTransactionStartedRecord,
): ActivePackTransactionRecord {
  if (
    computePackTransactionRecordDigest(started) !== started.recordDigest ||
    !UUID_PATTERN.test(started.runId)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$transaction.started",
      "active transaction requires an attested started record",
    );
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    kind: "active-pack-transaction" as const,
    runId: started.runId,
    project: Object.freeze({ ...started.project }),
    registryDigest: started.registryDigest,
    planDigest: started.planDigest,
    operation: started.operation,
    pack: Object.freeze({ ...started.pack }),
    startedRecordPath: packTransactionRecordPath(started.runId, 0),
    startedRecordDigest: started.recordDigest,
    started,
  };
  return freezeRecord({
    ...body,
    recordDigest: computeActivePackTransactionRecordDigest(body),
  });
}

function parseActivePackTransactionRecord(
  value: unknown,
  project: LoadActivePackTransactionRequest["project"],
  root: CanonicalProjectRoot,
): ActivePackTransactionRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "runId",
      "project",
      "registryDigest",
      "planDigest",
      "operation",
      "pack",
      "startedRecordPath",
      "startedRecordDigest",
      "started",
      "recordDigest",
    ]) ||
    value["schemaVersion"] !== "1.0.0" ||
    value["kind"] !== "active-pack-transaction" ||
    typeof value["runId"] !== "string" ||
    !UUID_PATTERN.test(value["runId"]) ||
    !isRecord(value["project"]) ||
    !exactKeys(value["project"], [
      "id",
      "identityDigest",
      "rootIdentityDigest",
    ]) ||
    value["project"]["id"] !== project.id ||
    value["project"]["identityDigest"] !== project.identityDigest ||
    value["project"]["rootIdentityDigest"] !== root.identityDigest ||
    !isSha256Digest(value["registryDigest"]) ||
    !isSha256Digest(value["planDigest"]) ||
    !["add", "remove", "update"].includes(value["operation"] as string) ||
    !isRecord(value["pack"]) ||
    !exactKeys(value["pack"], ["id", "version", "digest"]) ||
    !isStableId(value["pack"]["id"]) ||
    typeof value["pack"]["version"] !== "string" ||
    !isSha256Digest(value["pack"]["digest"]) ||
    value["startedRecordPath"] !==
      packTransactionRecordPath(value["runId"], 0) ||
    !isSha256Digest(value["startedRecordDigest"]) ||
    !isRecord(value["started"]) ||
    !isSha256Digest(value["recordDigest"])
  ) {
    activeError(
      PACK_ACTIVE_TRANSACTION_PATH,
      "active transaction marker is malformed or belongs to another project",
    );
  }
  const started = parsePackTransactionStartedRecord(
    value["started"],
    value["runId"],
    project,
  );
  if (
    started.project.rootIdentityDigest !== root.identityDigest ||
    started.registryDigest !== value["registryDigest"] ||
    started.planDigest !== value["planDigest"] ||
    started.operation !== value["operation"] ||
    canonicalizeJson(started.pack) !== canonicalizeJson(value["pack"]) ||
    started.recordDigest !== value["startedRecordDigest"]
  ) {
    activeError(
      PACK_ACTIVE_TRANSACTION_PATH,
      "active transaction summary does not match its started record",
    );
  }
  const candidate = freezeRecord({
    schemaVersion: "1.0.0",
    kind: "active-pack-transaction",
    runId: value["runId"],
    project: Object.freeze({
      id: project.id,
      identityDigest: project.identityDigest,
      rootIdentityDigest: root.identityDigest,
    }),
    registryDigest: value["registryDigest"],
    planDigest: value["planDigest"],
    operation: value["operation"] as PackOperation,
    pack: Object.freeze({
      id: value["pack"]["id"],
      version: value["pack"]["version"] as SemanticVersion,
      digest: value["pack"]["digest"],
    }),
    startedRecordPath: value["startedRecordPath"],
    startedRecordDigest: value["startedRecordDigest"],
    started,
    recordDigest: value["recordDigest"],
  });
  if (
    computeActivePackTransactionRecordDigest(candidate) !==
      candidate.recordDigest ||
    canonicalizeJson(value) !== canonicalizeJson(candidate)
  ) {
    activeError(
      PACK_ACTIVE_TRANSACTION_PATH,
      "active transaction marker digest or canonical body is invalid",
    );
  }
  return candidate;
}

function serializeActivePackTransactionRecord(
  record: ActivePackTransactionRecord,
): Uint8Array {
  const content = Buffer.from(`${canonicalizeJson(record)}\n`, "utf8");
  if (content.byteLength > PACK_ACTIVE_TRANSACTION_MAX_BYTES) {
    throw new PackRuntimeError(
      "pack-artifact-budget-exceeded",
      PACK_ACTIVE_TRANSACTION_PATH,
      "active transaction marker exceeds its fixed byte limit",
    );
  }
  return content;
}

export async function loadActivePackTransactionRecord(
  request: LoadActivePackTransactionRequest,
): Promise<LoadedActivePackTransaction | undefined> {
  if (
    !isRecord(request) ||
    !exactKeys(request, ["root", "project", "maxDirectoryEntries"]) ||
    !isRecord(request.project) ||
    !exactKeys(request.project, ["id", "identityDigest"]) ||
    !isStableId(request.project.id) ||
    !isSha256Digest(request.project.identityDigest) ||
    !validDirectoryBudget(request.maxDirectoryEntries)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-recovery-request",
      "$request",
      "active transaction load request is invalid",
    );
  }
  const root = request.root as CanonicalProjectRoot;
  try {
    const snapshot = await readProjectFileSnapshot({
      root,
      path: PACK_ACTIVE_TRANSACTION_PATH,
      maxBytes: PACK_ACTIVE_TRANSACTION_MAX_BYTES,
      maxDirectoryEntries: request.maxDirectoryEntries,
    });
    const text = Buffer.from(snapshot.content).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    if (text !== `${canonicalizeJson(parsed)}\n`) {
      activeError(
        PACK_ACTIVE_TRANSACTION_PATH,
        "active transaction marker is not canonical JSON",
      );
    }
    return Object.freeze({
      record: parseActivePackTransactionRecord(parsed, request.project, root),
      fileDigest: snapshot.digest,
      bytes: snapshot.bytes,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    if (error instanceof PackRuntimeError) throw error;
    activeError(
      PACK_ACTIVE_TRANSACTION_PATH,
      "active transaction marker could not be read safely",
    );
  }
}

export async function writeActivePackTransactionRecord(
  request: WriteActivePackTransactionRecordRequest,
): Promise<LoadedActivePackTransaction> {
  if (
    !isRecord(request) ||
    !exactKeys(request, ["root", "record", "maxDirectoryEntries"]) ||
    !validDirectoryBudget(request.maxDirectoryEntries) ||
    !isRecord(request.record) ||
    !isRecord(request.record["project"]) ||
    !isStableId(request.record["project"]["id"]) ||
    !isSha256Digest(request.record["project"]["identityDigest"])
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$activeTransaction",
      "active transaction write request is invalid",
    );
  }
  const record = parseActivePackTransactionRecord(
    request.record,
    {
      id: request.record["project"]["id"],
      identityDigest: request.record["project"]["identityDigest"],
    },
    request.root,
  );
  const content = serializeActivePackTransactionRecord(record);
  const result = await writeProjectFileCas({
    root: request.root,
    path: PACK_ACTIVE_TRANSACTION_PATH,
    content,
    expected: { mode: "absent" },
    maxBytes: PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    maxDirectoryEntries: request.maxDirectoryEntries,
  });
  return Object.freeze({
    record,
    fileDigest: result.afterDigest,
    bytes: result.bytes,
  });
}

export async function clearActivePackTransactionRecord(
  request: ClearActivePackTransactionRecordRequest,
): Promise<ProjectFileCasDeleteResult> {
  if (
    !isRecord(request) ||
    !exactKeys(request, ["root", "active", "maxDirectoryEntries"]) ||
    !validDirectoryBudget(request.maxDirectoryEntries) ||
    !isRecord(request.active) ||
    !exactKeys(request.active, ["record", "fileDigest", "bytes"]) ||
    !isSha256Digest(request.active.fileDigest)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$activeTransaction",
      "active transaction clear request is invalid",
    );
  }
  return deleteProjectFileCas({
    root: request.root,
    path: PACK_ACTIVE_TRANSACTION_PATH,
    expectedDigest: request.active.fileDigest,
    maxBytes: PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    maxDirectoryEntries: request.maxDirectoryEntries,
  });
}
