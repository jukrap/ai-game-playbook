import {
  canonicalizeJson,
  compareCanonicalText,
  digestCanonicalJson,
  isPortableProjectPath,
  isSha256Digest,
  isStableId,
  parseSemanticVersion,
  type SemanticVersion,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  readProjectFileSnapshot,
  writeProjectFileCas,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";

import { PackRuntimeError } from "./errors.js";
import type { PackChange, PackOperation, PreparedPackOperation } from "./types.js";

export const PACK_TRANSACTION_DIRECTORY: string =
  ".ai-game-playbook/state/packs/transactions";
export const PACK_TRANSACTION_MAX_RECORD_BYTES: number = 512 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const MAX_TRANSACTION_PATHS = 256;

type MutableRecord = Record<string, unknown>;

export type PackTransactionOutcome =
  | "committed"
  | "failed"
  | "recovery-required"
  | "rolled-back";

export interface PackTransactionStartedRecord {
  readonly schemaVersion: "1.0.0";
  readonly kind: "started";
  readonly sequence: 0;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly planDigest: Sha256Digest;
  readonly authorization: {
    readonly authorizationId: string;
    readonly requestDigest: Sha256Digest;
  };
  readonly operation: PackOperation;
  readonly pack: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly digest: Sha256Digest;
  };
  readonly installedState: {
    readonly revision: number;
    readonly digest: Sha256Digest;
    readonly fileDigest?: Sha256Digest;
  };
  readonly changes: readonly PackChange[];
  readonly startedAt: string;
  readonly recordDigest: Sha256Digest;
}

export interface PackTransactionTerminalRecord {
  readonly schemaVersion: "1.0.0";
  readonly kind: "terminal";
  readonly sequence: 1;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly parentRecordDigest: Sha256Digest;
  readonly outcome: PackTransactionOutcome;
  readonly mutationUncertain: boolean;
  readonly touchedPaths: readonly string[];
  readonly appliedPaths: readonly string[];
  readonly rolledBackPaths: readonly string[];
  readonly installedStateAfterDigest?: Sha256Digest;
  readonly error?: {
    readonly code: string;
    readonly path: string;
  };
  readonly endedAt: string;
  readonly recordDigest: Sha256Digest;
}

export type PackTransactionRecord =
  | PackTransactionStartedRecord
  | PackTransactionTerminalRecord;

export interface LoadedPackTransactionJournal {
  readonly started: PackTransactionStartedRecord;
  readonly terminal?: PackTransactionTerminalRecord;
}

export interface LoadPackTransactionJournalRequest {
  readonly root: unknown;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly maxDirectoryEntries: number;
}

export interface CreateStartedPackTransactionRequest {
  readonly plan: PreparedPackOperation;
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly startedAt: string;
}

export interface CreateTerminalPackTransactionRequest {
  readonly started: PackTransactionStartedRecord;
  readonly outcome: PackTransactionOutcome;
  readonly mutationUncertain: boolean;
  readonly touchedPaths: readonly string[];
  readonly appliedPaths: readonly string[];
  readonly rolledBackPaths: readonly string[];
  readonly installedStateAfterDigest?: Sha256Digest;
  readonly error?: {
    readonly code: string;
    readonly path: string;
  };
  readonly endedAt: string;
}

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: MutableRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const requiredSet = new Set(required);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key)) &&
    actual.length >= requiredSet.size &&
    actual.length <= allowed.size
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function boundedLocator(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function transactionError(
  code: "pack-transaction-corrupt" | "pack-transaction-not-found",
  path: string,
  message: string,
): never {
  throw new PackRuntimeError(code, path, message);
}

function validateRunId(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      path,
      "transaction run identity must be a canonical UUID",
    );
  }
}

export function packTransactionRecordPath(
  runId: string,
  sequence: 0 | 1,
): string {
  validateRunId(runId, "$runId");
  return `${PACK_TRANSACTION_DIRECTORY}/${runId}-${sequence.toString().padStart(4, "0")}.json`;
}

export function computePackTransactionRecordDigest(
  record: Omit<PackTransactionRecord, "recordDigest"> &
    Partial<Pick<PackTransactionRecord, "recordDigest">>,
): Sha256Digest {
  const { recordDigest: _recordDigest, ...body } = record;
  return digestCanonicalJson({
    domain: "ai-game-playbook.pack-transaction-record",
    version: "1",
    record: body,
  });
}

function freezeChange(change: PackChange): PackChange {
  return Object.freeze({ ...change });
}

function freezeStarted(
  record: PackTransactionStartedRecord,
): PackTransactionStartedRecord {
  return Object.freeze({
    ...record,
    project: Object.freeze({ ...record.project }),
    authorization: Object.freeze({ ...record.authorization }),
    pack: Object.freeze({ ...record.pack }),
    installedState: Object.freeze({ ...record.installedState }),
    changes: Object.freeze(record.changes.map(freezeChange)),
  });
}

function sortedUniquePaths(
  values: readonly string[],
  path: string,
): readonly string[] {
  if (!Array.isArray(values) || values.length > MAX_TRANSACTION_PATHS) {
    transactionError(
      "pack-transaction-corrupt",
      path,
      "transaction path list exceeds its fixed bound",
    );
  }
  const result = values.map((value) => {
    if (!isPortableProjectPath(value)) {
      transactionError(
        "pack-transaction-corrupt",
        path,
        "transaction contains an invalid project path",
      );
    }
    return value;
  });
  result.sort(compareCanonicalText);
  if (
    result.some(
      (value, index) => index > 0 && result[index - 1] === value,
    ) ||
    result.some((value, index) => value !== values[index])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      path,
      "transaction paths must be sorted and unique",
    );
  }
  return Object.freeze(result);
}

function freezeTerminal(
  record: PackTransactionTerminalRecord,
): PackTransactionTerminalRecord {
  return Object.freeze({
    ...record,
    project: Object.freeze({ ...record.project }),
    touchedPaths: Object.freeze([...record.touchedPaths]),
    appliedPaths: Object.freeze([...record.appliedPaths]),
    rolledBackPaths: Object.freeze([...record.rolledBackPaths]),
    ...(record.error === undefined
      ? {}
      : { error: Object.freeze({ ...record.error }) }),
  });
}

export function createStartedPackTransaction(
  request: CreateStartedPackTransactionRequest,
): PackTransactionStartedRecord {
  if (
    !UUID_PATTERN.test(request.authorizationId) ||
    !isSha256Digest(request.requestDigest) ||
    !canonicalTimestamp(request.startedAt)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$transaction.started",
      "started transaction authority or timestamp is invalid",
    );
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    kind: "started" as const,
    sequence: 0 as const,
    runId: request.plan.runId,
    project: { ...request.plan.project },
    registryDigest: request.plan.registryDigest,
    planDigest: request.plan.planDigest,
    authorization: {
      authorizationId: request.authorizationId,
      requestDigest: request.requestDigest,
    },
    operation: request.plan.operation,
    pack: { ...request.plan.pack },
    installedState: { ...request.plan.installedState },
    changes: request.plan.changes.map(freezeChange),
    startedAt: request.startedAt,
  };
  return freezeStarted({
    ...body,
    recordDigest: computePackTransactionRecordDigest(body),
  });
}

function exactPathArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function createTerminalPackTransaction(
  request: CreateTerminalPackTransactionRequest,
): PackTransactionTerminalRecord {
  const touchedPaths = sortedUniquePaths(
    request.touchedPaths,
    "$transaction.terminal.touchedPaths",
  );
  const appliedPaths = sortedUniquePaths(
    request.appliedPaths,
    "$transaction.terminal.appliedPaths",
  );
  const rolledBackPaths = sortedUniquePaths(
    request.rolledBackPaths,
    "$transaction.terminal.rolledBackPaths",
  );
  const touched = new Set(touchedPaths);
  const applied = new Set(appliedPaths);
  if (
    !["committed", "failed", "recovery-required", "rolled-back"].includes(
      request.outcome,
    ) ||
    request.mutationUncertain !== (request.outcome === "recovery-required") ||
    !canonicalTimestamp(request.endedAt) ||
    Date.parse(request.endedAt) < Date.parse(request.started.startedAt) ||
    appliedPaths.some((path) => !touched.has(path)) ||
    rolledBackPaths.some((path) => !applied.has(path)) ||
    (request.outcome === "committed" &&
      request.installedStateAfterDigest === undefined) ||
    ((request.outcome === "failed" || request.outcome === "rolled-back") &&
      request.installedStateAfterDigest !== undefined) ||
    (request.outcome === "failed" && appliedPaths.length > 0) ||
    (request.outcome === "rolled-back" &&
      (appliedPaths.length === 0 ||
        !exactPathArray(appliedPaths, rolledBackPaths))) ||
    (request.installedStateAfterDigest !== undefined &&
      !isSha256Digest(request.installedStateAfterDigest)) ||
    (request.error !== undefined &&
      (!ERROR_CODE_PATTERN.test(request.error.code) ||
        !boundedLocator(request.error.path)))
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$transaction.terminal",
      "terminal transaction outcome is internally inconsistent",
      request.mutationUncertain,
    );
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    kind: "terminal" as const,
    sequence: 1 as const,
    runId: request.started.runId,
    project: { ...request.started.project },
    parentRecordDigest: request.started.recordDigest,
    outcome: request.outcome,
    mutationUncertain: request.mutationUncertain,
    touchedPaths,
    appliedPaths,
    rolledBackPaths,
    ...(request.installedStateAfterDigest === undefined
      ? {}
      : { installedStateAfterDigest: request.installedStateAfterDigest }),
    ...(request.error === undefined
      ? {}
      : { error: { ...request.error } }),
    endedAt: request.endedAt,
  };
  return freezeTerminal({
    ...body,
    recordDigest: computePackTransactionRecordDigest(body),
  });
}

export function serializePackTransactionRecord(
  record: PackTransactionRecord,
): Uint8Array {
  const content = Buffer.from(`${canonicalizeJson(record)}\n`, "utf8");
  if (content.byteLength > PACK_TRANSACTION_MAX_RECORD_BYTES) {
    throw new PackRuntimeError(
      "pack-artifact-budget-exceeded",
      "$transaction",
      "transaction record exceeds its fixed byte limit",
    );
  }
  return content;
}

export async function writePackTransactionRecord(
  root: CanonicalProjectRoot,
  record: PackTransactionRecord,
  maxDirectoryEntries: number,
): Promise<{ readonly path: string; readonly fileDigest: Sha256Digest; readonly bytes: number }> {
  const path = packTransactionRecordPath(record.runId, record.sequence);
  const content = serializePackTransactionRecord(record);
  const result = await writeProjectFileCas({
    root,
    path,
    content,
    expected: { mode: "absent" },
    maxBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
    maxDirectoryEntries,
  });
  return Object.freeze({
    path,
    fileDigest: result.afterDigest,
    bytes: result.bytes,
  });
}

function parseChange(value: unknown): PackChange {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.changes[]",
      "transaction change is malformed",
    );
  }
  const kind = value["kind"];
  const keys =
    kind === "create"
      ? ["kind", "path", "afterDigest", "bytes"]
      : kind === "delete"
        ? ["kind", "path", "beforeDigest", "bytes"]
        : kind === "replace" || kind === "unchanged"
          ? ["kind", "path", "beforeDigest", "afterDigest", "bytes"]
          : [];
  if (
    keys.length === 0 ||
    !exactKeys(value, keys) ||
    !isPortableProjectPath(value["path"]) ||
    !Number.isSafeInteger(value["bytes"]) ||
    (value["bytes"] as number) < 0 ||
    ("beforeDigest" in value && !isSha256Digest(value["beforeDigest"])) ||
    ("afterDigest" in value && !isSha256Digest(value["afterDigest"]))
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.changes[]",
      "transaction change fields are invalid",
    );
  }
  return freezeChange(value as unknown as PackChange);
}

function parseProject(
  value: unknown,
  expected: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  },
): PackTransactionStartedRecord["project"] {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "identityDigest", "rootIdentityDigest"]) ||
    value["id"] !== expected.id ||
    value["identityDigest"] !== expected.identityDigest ||
    !isSha256Digest(value["rootIdentityDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.project",
      "transaction belongs to another or malformed project",
    );
  }
  return Object.freeze({
    id: expected.id,
    identityDigest: expected.identityDigest,
    rootIdentityDigest: value["rootIdentityDigest"],
  });
}

function parseStarted(
  value: unknown,
  expectedRunId: string,
  expectedProject: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  },
): PackTransactionStartedRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "sequence",
      "runId",
      "project",
      "registryDigest",
      "planDigest",
      "authorization",
      "operation",
      "pack",
      "installedState",
      "changes",
      "startedAt",
      "recordDigest",
    ]) ||
    value["schemaVersion"] !== "1.0.0" ||
    value["kind"] !== "started" ||
    value["sequence"] !== 0 ||
    value["runId"] !== expectedRunId ||
    !isSha256Digest(value["registryDigest"]) ||
    !isSha256Digest(value["planDigest"]) ||
    !isRecord(value["authorization"]) ||
    !exactKeys(value["authorization"], ["authorizationId", "requestDigest"]) ||
    typeof value["authorization"]["authorizationId"] !== "string" ||
    !UUID_PATTERN.test(value["authorization"]["authorizationId"]) ||
    !isSha256Digest(value["authorization"]["requestDigest"]) ||
    !["add", "remove", "update"].includes(value["operation"] as string) ||
    !isRecord(value["pack"]) ||
    !exactKeys(value["pack"], ["id", "version", "digest"]) ||
    !isStableId(value["pack"]["id"]) ||
    !isSha256Digest(value["pack"]["digest"]) ||
    !isRecord(value["installedState"]) ||
    !exactKeys(
      value["installedState"],
      ["revision", "digest"],
      ["fileDigest"],
    ) ||
    !Number.isSafeInteger(value["installedState"]["revision"]) ||
    (value["installedState"]["revision"] as number) < 0 ||
    !isSha256Digest(value["installedState"]["digest"]) ||
    (value["installedState"]["fileDigest"] !== undefined &&
      !isSha256Digest(value["installedState"]["fileDigest"])) ||
    !Array.isArray(value["changes"]) ||
    value["changes"].length > 64 ||
    !canonicalTimestamp(value["startedAt"]) ||
    !isSha256Digest(value["recordDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started",
      "started transaction record is malformed",
    );
  }
  let version: SemanticVersion;
  try {
    parseSemanticVersion(value["pack"]["version"]);
    version = value["pack"]["version"] as SemanticVersion;
  } catch {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started.pack.version",
      "transaction pack version is invalid",
    );
  }
  const changes = value["changes"].map(parseChange);
  if (
    changes.some(
      (change, index) =>
        index > 0 &&
        compareCanonicalText(changes[index - 1]?.path ?? "", change.path) >= 0,
    )
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started.changes",
      "transaction changes must be sorted and unique",
    );
  }
  const record = freezeStarted({
    schemaVersion: "1.0.0",
    kind: "started",
    sequence: 0,
    runId: expectedRunId,
    project: parseProject(value["project"], expectedProject),
    registryDigest: value["registryDigest"],
    planDigest: value["planDigest"],
    authorization: Object.freeze({
      authorizationId: value["authorization"]["authorizationId"],
      requestDigest: value["authorization"]["requestDigest"],
    }),
    operation: value["operation"] as PackOperation,
    pack: Object.freeze({
      id: value["pack"]["id"],
      version,
      digest: value["pack"]["digest"],
    }),
    installedState: Object.freeze({
      revision: value["installedState"]["revision"] as number,
      digest: value["installedState"]["digest"],
      ...(value["installedState"]["fileDigest"] === undefined
        ? {}
        : { fileDigest: value["installedState"]["fileDigest"] as Sha256Digest }),
    }),
    changes: Object.freeze(changes),
    startedAt: value["startedAt"],
    recordDigest: value["recordDigest"],
  });
  if (computePackTransactionRecordDigest(record) !== record.recordDigest) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started.recordDigest",
      "started record digest does not attest its body",
    );
  }
  return record;
}

function parseTerminal(
  value: unknown,
  started: PackTransactionStartedRecord,
): PackTransactionTerminalRecord {
  if (
    !isRecord(value) ||
    !exactKeys(
      value,
      [
        "schemaVersion",
        "kind",
        "sequence",
        "runId",
        "project",
        "parentRecordDigest",
        "outcome",
        "mutationUncertain",
        "touchedPaths",
        "appliedPaths",
        "rolledBackPaths",
        "endedAt",
        "recordDigest",
      ],
      ["installedStateAfterDigest", "error"],
    ) ||
    value["schemaVersion"] !== "1.0.0" ||
    value["kind"] !== "terminal" ||
    value["sequence"] !== 1 ||
    value["runId"] !== started.runId ||
    value["parentRecordDigest"] !== started.recordDigest ||
    typeof value["mutationUncertain"] !== "boolean" ||
    !canonicalTimestamp(value["endedAt"]) ||
    !isSha256Digest(value["recordDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.terminal",
      "terminal transaction record is malformed",
    );
  }
  const error = value["error"];
  if (
    error !== undefined &&
    (!isRecord(error) ||
      !exactKeys(error, ["code", "path"]) ||
      typeof error["code"] !== "string" ||
      !ERROR_CODE_PATTERN.test(error["code"]) ||
      !boundedLocator(error["path"]))
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.terminal.error",
      "terminal transaction error is malformed",
    );
  }
  let candidate: PackTransactionTerminalRecord;
  try {
    candidate = createTerminalPackTransaction({
      started,
      outcome: value["outcome"] as PackTransactionOutcome,
      mutationUncertain: value["mutationUncertain"],
      touchedPaths: value["touchedPaths"] as readonly string[],
      appliedPaths: value["appliedPaths"] as readonly string[],
      rolledBackPaths: value["rolledBackPaths"] as readonly string[],
      ...(value["installedStateAfterDigest"] === undefined
        ? {}
        : { installedStateAfterDigest: value["installedStateAfterDigest"] as Sha256Digest }),
      ...(error === undefined
        ? {}
        : { error: { code: error["code"] as string, path: error["path"] as string } }),
      endedAt: value["endedAt"],
    });
  } catch {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.terminal",
      "terminal transaction semantics are invalid",
    );
  }
  if (
    value["recordDigest"] !== candidate.recordDigest ||
    canonicalizeJson(value) !== canonicalizeJson(candidate)
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.terminal.recordDigest",
      "terminal record digest does not attest its canonical body",
    );
  }
  return candidate;
}

async function readRecord(
  root: CanonicalProjectRoot,
  path: string,
  maxDirectoryEntries: number,
): Promise<unknown | undefined> {
  try {
    const snapshot = await readProjectFileSnapshot({
      root,
      path,
      maxBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
      maxDirectoryEntries,
    });
    const text = Buffer.from(snapshot.content).toString("utf8");
    const parsed = JSON.parse(text) as unknown;
    if (text !== `${canonicalizeJson(parsed)}\n`) {
      transactionError(
        "pack-transaction-corrupt",
        path,
        "transaction record is not canonical JSON",
      );
    }
    return parsed;
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    if (error instanceof PackRuntimeError) throw error;
    transactionError(
      "pack-transaction-corrupt",
      path,
      "transaction record could not be read safely",
    );
  }
}

export async function loadPackTransactionJournal(
  request: LoadPackTransactionJournalRequest,
): Promise<LoadedPackTransactionJournal> {
  if (
    !isRecord(request) ||
    !exactKeys(request, ["root", "runId", "project", "maxDirectoryEntries"]) ||
    !UUID_PATTERN.test(request.runId) ||
    !isRecord(request.project) ||
    !exactKeys(request.project, ["id", "identityDigest"]) ||
    !isStableId(request.project.id) ||
    !isSha256Digest(request.project.identityDigest) ||
    !Number.isSafeInteger(request.maxDirectoryEntries) ||
    request.maxDirectoryEntries < 1 ||
    request.maxDirectoryEntries > 100_000
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$request",
      "pack transaction load request is invalid",
    );
  }
  const root = request.root as CanonicalProjectRoot;
  const startedPath = packTransactionRecordPath(request.runId, 0);
  const terminalPath = packTransactionRecordPath(request.runId, 1);
  const startedValue = await readRecord(
    root,
    startedPath,
    request.maxDirectoryEntries,
  );
  if (startedValue === undefined) {
    transactionError(
      "pack-transaction-not-found",
      startedPath,
      "pack transaction has no started record",
    );
  }
  const started = parseStarted(startedValue, request.runId, request.project);
  if (started.project.rootIdentityDigest !== root.identityDigest) {
    transactionError(
      "pack-transaction-corrupt",
      startedPath,
      "pack transaction root identity no longer matches",
    );
  }
  const terminalValue = await readRecord(
    root,
    terminalPath,
    request.maxDirectoryEntries,
  );
  if (terminalValue === undefined) {
    return Object.freeze({ started });
  }
  const terminal = parseTerminal(terminalValue, started);
  if (
    !terminal.touchedPaths.includes(startedPath) ||
    !terminal.touchedPaths.includes(terminalPath)
  ) {
    transactionError(
      "pack-transaction-corrupt",
      terminalPath,
      "terminal transaction omits its append-only journal paths",
    );
  }
  return Object.freeze({ started, terminal });
}
