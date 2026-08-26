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
  type ProjectDirectoryIdentity,
} from "@ai-game-playbook/core";

import { createPackDirectoryOwnershipMarker } from "./directory-ownership.js";
import { PackRuntimeError } from "./errors.js";
import type {
  PackChange,
  PackDirectoryChange,
  PackDirectoryOwnershipMarker,
  PackOperation,
  PackOperationLimits,
  PreparedPackOperation,
} from "./types.js";

export const PACK_TRANSACTION_DIRECTORY: string =
  ".ai-game-playbook/state/packs/transactions";
export const PACK_TRANSACTION_MAX_RECORD_BYTES: number = 512 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const MAX_TRANSACTION_PATHS = 512;
const MAX_TRANSACTION_CHANGES = 128;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 100_000;

type MutableRecord = Record<string, unknown>;

export type PackTransactionOutcome =
  | "committed"
  | "failed"
  | "recovery-required"
  | "rolled-back";

export type PackTransactionReconciliationOutcome = "committed" | "failed";

export type PackTransactionSchemaVersion = "1.0.0" | "1.1.0";

export interface PackTransactionStartedRecord {
  readonly schemaVersion: PackTransactionSchemaVersion;
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
  readonly installedStateAfter: {
    readonly revision: number;
    readonly digest: Sha256Digest;
    readonly fileDigest: Sha256Digest;
  };
  readonly limits: PackOperationLimits;
  readonly directoryChanges?: readonly PackDirectoryChange[];
  readonly changes: readonly PackChange[];
  readonly startedAt: string;
  readonly recordDigest: Sha256Digest;
}

export interface PackTransactionTerminalRecord {
  readonly schemaVersion: PackTransactionSchemaVersion;
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

export interface PackTransactionReconciliationRecord {
  readonly schemaVersion: PackTransactionSchemaVersion;
  readonly kind: "reconciliation";
  readonly sequence: 2;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly parentRecordDigest: Sha256Digest;
  readonly outcome: PackTransactionReconciliationOutcome;
  readonly observedState: "postimage" | "preimage";
  readonly authorization: {
    readonly authorizationId: string;
    readonly requestDigest: Sha256Digest;
  };
  readonly recoveryReportDigest: Sha256Digest;
  readonly touchedPaths: readonly string[];
  readonly reconciledAt: string;
  readonly recordDigest: Sha256Digest;
}

export type PackTransactionRecord =
  | PackTransactionStartedRecord
  | PackTransactionTerminalRecord
  | PackTransactionReconciliationRecord;

export interface LoadedPackTransactionJournal {
  readonly started: PackTransactionStartedRecord;
  readonly terminal?: PackTransactionTerminalRecord;
  readonly reconciliation?: PackTransactionReconciliationRecord;
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
  readonly installedStateAfter: {
    readonly revision: number;
    readonly digest: Sha256Digest;
    readonly fileDigest: Sha256Digest;
  };
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

export interface CreatePackTransactionReconciliationRequest {
  readonly started: PackTransactionStartedRecord;
  readonly terminal: PackTransactionTerminalRecord;
  readonly outcome: PackTransactionReconciliationOutcome;
  readonly observedState: "postimage" | "preimage";
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly recoveryReportDigest: Sha256Digest;
  readonly touchedPaths: readonly string[];
  readonly reconciledAt: string;
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
  sequence: 0 | 1 | 2,
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

function freezeDirectoryMarker(
  marker: PackDirectoryOwnershipMarker,
): PackDirectoryOwnershipMarker {
  return Object.freeze({ ...marker });
}

function freezeDirectoryIdentity(
  identity: ProjectDirectoryIdentity,
): ProjectDirectoryIdentity {
  return Object.freeze({ ...identity });
}

function freezeDirectoryChange(
  change: PackDirectoryChange,
): PackDirectoryChange {
  return change.kind === "create"
    ? Object.freeze({
        ...change,
        marker: freezeDirectoryMarker(change.marker),
      })
    : Object.freeze({
        ...change,
        marker: freezeDirectoryMarker(change.marker),
        expectedIdentity: freezeDirectoryIdentity(change.expectedIdentity),
      });
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
    installedStateAfter: Object.freeze({ ...record.installedStateAfter }),
    limits: Object.freeze({ ...record.limits }),
    ...(record.directoryChanges === undefined
      ? {}
      : {
          directoryChanges: Object.freeze(
            record.directoryChanges.map(freezeDirectoryChange),
          ),
        }),
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

function freezeReconciliation(
  record: PackTransactionReconciliationRecord,
): PackTransactionReconciliationRecord {
  return Object.freeze({
    ...record,
    project: Object.freeze({ ...record.project }),
    authorization: Object.freeze({ ...record.authorization }),
    touchedPaths: Object.freeze([...record.touchedPaths]),
  });
}

export function createStartedPackTransaction(
  request: CreateStartedPackTransactionRequest,
): PackTransactionStartedRecord {
  if (
    !UUID_PATTERN.test(request.authorizationId) ||
    !isSha256Digest(request.requestDigest) ||
    !Number.isSafeInteger(request.installedStateAfter?.revision) ||
    request.installedStateAfter.revision !==
      request.plan.installedState.revision + 1 ||
    !isSha256Digest(request.installedStateAfter.digest) ||
    !isSha256Digest(request.installedStateAfter.fileDigest) ||
    !canonicalTimestamp(request.startedAt)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$transaction.started",
      "started transaction authority or timestamp is invalid",
    );
  }
  const body = {
    schemaVersion: "1.1.0" as const,
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
    installedStateAfter: { ...request.installedStateAfter },
    limits: { ...request.plan.limits },
    directoryChanges: request.plan.directoryChanges.map(freezeDirectoryChange),
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
    (request.outcome === "committed" &&
      request.installedStateAfterDigest !==
        request.started.installedStateAfter.digest) ||
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
    schemaVersion: request.started.schemaVersion,
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

export function createPackTransactionReconciliation(
  request: CreatePackTransactionReconciliationRequest,
): PackTransactionReconciliationRecord {
  const touchedPaths = sortedUniquePaths(
    request.touchedPaths,
    "$transaction.reconciliation.touchedPaths",
  );
  const reconciliationPath = packTransactionRecordPath(
    request.started.runId,
    2,
  );
  if (
    request.terminal.schemaVersion !== request.started.schemaVersion ||
    request.terminal.runId !== request.started.runId ||
    request.terminal.parentRecordDigest !== request.started.recordDigest ||
    request.terminal.outcome !== "recovery-required" ||
    request.terminal.mutationUncertain !== true ||
    !["committed", "failed"].includes(request.outcome) ||
    request.observedState !==
      (request.outcome === "committed" ? "postimage" : "preimage") ||
    !UUID_PATTERN.test(request.authorizationId) ||
    !isSha256Digest(request.requestDigest) ||
    !isSha256Digest(request.recoveryReportDigest) ||
    !touchedPaths.includes(reconciliationPath) ||
    !canonicalTimestamp(request.reconciledAt) ||
    Date.parse(request.reconciledAt) < Date.parse(request.terminal.endedAt)
  ) {
    throw new PackRuntimeError(
      "invalid-pack-recovery-request",
      "$transaction.reconciliation",
      "reconciliation record is internally inconsistent",
    );
  }
  const body = {
    schemaVersion: request.started.schemaVersion,
    kind: "reconciliation" as const,
    sequence: 2 as const,
    runId: request.started.runId,
    project: { ...request.started.project },
    parentRecordDigest: request.terminal.recordDigest,
    outcome: request.outcome,
    observedState: request.observedState,
    authorization: {
      authorizationId: request.authorizationId,
      requestDigest: request.requestDigest,
    },
    recoveryReportDigest: request.recoveryReportDigest,
    touchedPaths,
    reconciledAt: request.reconciledAt,
  };
  return freezeReconciliation({
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

function portableParent(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function portableName(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? path : path.slice(separator + 1);
}

function parseDirectoryIdentity(
  value: unknown,
  directoryPath: string,
  rootIdentityDigest: Sha256Digest,
): ProjectDirectoryIdentity {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "path",
      "rootIdentityDigest",
      "identityDigest",
    ]) ||
    value["schemaVersion"] !== "1.0.0" ||
    value["path"] !== directoryPath ||
    value["rootIdentityDigest"] !== rootIdentityDigest ||
    !isSha256Digest(value["identityDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.directoryChanges[].expectedIdentity",
      "directory deletion identity is malformed or belongs to another target",
    );
  }
  return freezeDirectoryIdentity(
    value as unknown as ProjectDirectoryIdentity,
  );
}

function parseDirectoryMarker(
  value: unknown,
  directoryPath: string,
  pack: PackTransactionStartedRecord["pack"],
): PackDirectoryOwnershipMarker {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "directoryPath",
      "path",
      "digest",
      "bytes",
      "ownershipDigest",
      "ownerPackDigest",
    ]) ||
    value["directoryPath"] !== directoryPath ||
    !isPortableProjectPath(value["path"]) ||
    value["ownerPackDigest"] !== pack.digest ||
    !isSha256Digest(value["digest"]) ||
    !Number.isSafeInteger(value["bytes"]) ||
    (value["bytes"] as number) < 1 ||
    (value["bytes"] as number) > MAX_ARTIFACT_BYTES ||
    !isSha256Digest(value["ownershipDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.directoryChanges[].marker",
      "directory ownership marker is malformed or belongs to another pack",
    );
  }
  const expected = createPackDirectoryOwnershipMarker(
    { id: pack.id, digest: pack.digest },
    directoryPath,
  ).descriptor;
  if (canonicalizeJson(value) !== canonicalizeJson(expected)) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.directoryChanges[].marker",
      "directory ownership marker is not self-consistent",
    );
  }
  return freezeDirectoryMarker(expected);
}

function parseDirectoryChange(
  value: unknown,
  pack: PackTransactionStartedRecord["pack"],
  rootIdentityDigest: Sha256Digest,
): PackDirectoryChange {
  if (
    !isRecord(value) ||
    (value["kind"] !== "create" &&
      value["kind"] !== "retain" &&
      value["kind"] !== "delete") ||
    !exactKeys(
      value,
      value["kind"] === "create"
        ? ["kind", "path", "marker"]
        : value["kind"] === "retain"
          ? ["kind", "path", "marker", "expectedIdentity"]
          : [
            "kind",
            "path",
            "marker",
            "expectedIdentity",
            "tombstonePath",
          ],
    ) ||
    !isPortableProjectPath(value["path"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.directoryChanges[]",
      "transaction directory change is malformed",
    );
  }
  const directoryPath = value["path"];
  const marker = parseDirectoryMarker(value["marker"], directoryPath, pack);
  if (value["kind"] === "create") {
    return freezeDirectoryChange({
      kind: "create",
      path: directoryPath,
      marker,
    });
  }
  if (value["kind"] === "retain") {
    return freezeDirectoryChange({
      kind: "retain",
      path: directoryPath,
      marker,
      expectedIdentity: parseDirectoryIdentity(
        value["expectedIdentity"],
        directoryPath,
        rootIdentityDigest,
      ),
    });
  }
  if (
    !isPortableProjectPath(value["tombstonePath"]) ||
    portableParent(value["tombstonePath"]) !== portableParent(directoryPath) ||
    !/^\.agpb-cas-dir-[0-9a-f]{32}\.deleted$/.test(
      portableName(value["tombstonePath"]),
    )
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.directoryChanges[].tombstonePath",
      "directory removal tombstone is not a fixed-format direct sibling",
    );
  }
  return freezeDirectoryChange({
    kind: "delete",
    path: directoryPath,
    marker,
    expectedIdentity: parseDirectoryIdentity(
      value["expectedIdentity"],
      directoryPath,
      rootIdentityDigest,
    ),
    tombstonePath: value["tombstonePath"],
  });
}

function directoryChangeOrder(
  left: PackDirectoryChange,
  right: PackDirectoryChange,
): number {
  const depthOrder = left.path.split("/").length - right.path.split("/").length;
  return depthOrder !== 0
    ? depthOrder
    : compareCanonicalText(left.path, right.path);
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

export function parsePackTransactionStartedRecord(
  value: unknown,
  expectedRunId: string,
  expectedProject: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  },
): PackTransactionStartedRecord {
  if (!isRecord(value)) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started",
      "started transaction record is malformed",
    );
  }
  const schemaVersion = value["schemaVersion"];
  if (
    (schemaVersion !== "1.0.0" && schemaVersion !== "1.1.0") ||
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
      "installedStateAfter",
      "limits",
      ...(schemaVersion === "1.1.0" ? ["directoryChanges"] : []),
      "changes",
      "startedAt",
      "recordDigest",
    ]) ||
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
    !isRecord(value["installedStateAfter"]) ||
    !exactKeys(value["installedStateAfter"], [
      "revision",
      "digest",
      "fileDigest",
    ]) ||
    !Number.isSafeInteger(value["installedStateAfter"]["revision"]) ||
    value["installedStateAfter"]["revision"] !==
      (value["installedState"]["revision"] as number) + 1 ||
    !isSha256Digest(value["installedStateAfter"]["digest"]) ||
    !isSha256Digest(value["installedStateAfter"]["fileDigest"]) ||
    !isRecord(value["limits"]) ||
    !exactKeys(value["limits"], [
      "maxArtifactBytes",
      "maxTotalBytes",
      "maxDirectoryEntries",
    ]) ||
    !Number.isSafeInteger(value["limits"]["maxArtifactBytes"]) ||
    (value["limits"]["maxArtifactBytes"] as number) < 1 ||
    (value["limits"]["maxArtifactBytes"] as number) > MAX_ARTIFACT_BYTES ||
    !Number.isSafeInteger(value["limits"]["maxTotalBytes"]) ||
    (value["limits"]["maxTotalBytes"] as number) <
      (value["limits"]["maxArtifactBytes"] as number) ||
    (value["limits"]["maxTotalBytes"] as number) > MAX_TOTAL_BYTES ||
    !Number.isSafeInteger(value["limits"]["maxDirectoryEntries"]) ||
    (value["limits"]["maxDirectoryEntries"] as number) < 1 ||
    (value["limits"]["maxDirectoryEntries"] as number) >
      MAX_DIRECTORY_ENTRIES ||
    (schemaVersion === "1.1.0" &&
      (!Array.isArray(value["directoryChanges"]) ||
        value["directoryChanges"].length > 64)) ||
    !Array.isArray(value["changes"]) ||
    value["changes"].length > MAX_TRANSACTION_CHANGES ||
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
  const project = parseProject(value["project"], expectedProject);
  const pack = Object.freeze({
    id: value["pack"]["id"],
    version,
    digest: value["pack"]["digest"],
  });
  const maxArtifactBytes = value["limits"]["maxArtifactBytes"] as number;
  const maxTotalBytes = value["limits"]["maxTotalBytes"] as number;
  const changes = value["changes"].map(parseChange);
  const directoryChanges =
    schemaVersion === "1.1.0"
      ? (value["directoryChanges"] as unknown[]).map((change) =>
          parseDirectoryChange(change, pack, project.rootIdentityDigest),
        )
      : undefined;
  if (
    changes.some(
      (change, index) =>
        index > 0 &&
        compareCanonicalText(changes[index - 1]?.path ?? "", change.path) >= 0,
    ) ||
    changes.some((change) => change.bytes > maxArtifactBytes) ||
    directoryChanges?.some(
      (change, index) =>
        index > 0 &&
        directoryChangeOrder(directoryChanges[index - 1] as PackDirectoryChange, change) >= 0,
    ) ||
    directoryChanges?.some((directoryChange) => {
      const markerChange = changes.find(
        (change) => change.path === directoryChange.marker.path,
      );
      if (directoryChange.kind === "create") {
        return (
          markerChange?.kind !== "create" ||
          markerChange.afterDigest !== directoryChange.marker.digest ||
          markerChange.bytes !== directoryChange.marker.bytes
        );
      }
      if (directoryChange.kind === "retain") {
        return (
          (markerChange?.kind !== "replace" &&
            markerChange?.kind !== "unchanged") ||
          markerChange.afterDigest !== directoryChange.marker.digest ||
          markerChange.bytes !== directoryChange.marker.bytes
        );
      }
      return (
        markerChange?.kind !== "delete" ||
        markerChange.beforeDigest !== directoryChange.marker.digest ||
        markerChange.bytes !== directoryChange.marker.bytes
      );
    }) ||
    directoryChanges?.some(
      (directoryChange) =>
        !changes.some(
          (change) =>
            change.path !== directoryChange.marker.path &&
            portableParent(change.path).toLowerCase() ===
              directoryChange.path.toLowerCase(),
        ),
    ) ||
    directoryChanges?.some((directoryChange, index) =>
      directoryChanges.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index &&
          candidate.path
            .toLowerCase()
            .startsWith(`${directoryChange.path.toLowerCase()}/`),
      ),
    )
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started.changes",
      "transaction changes must be sorted, unique, bounded, and preserve direct nonnested directory ownership",
    );
  }
  const totalChangeBytes = changes.reduce(
    (total, change) => total + change.bytes,
    0,
  );
  if (
    !Number.isSafeInteger(totalChangeBytes) ||
    totalChangeBytes > maxTotalBytes
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.started.changes",
      "transaction change bytes exceed the declared total limit",
    );
  }
  const record = freezeStarted({
    schemaVersion,
    kind: "started",
    sequence: 0,
    runId: expectedRunId,
    project,
    registryDigest: value["registryDigest"],
    planDigest: value["planDigest"],
    authorization: Object.freeze({
      authorizationId: value["authorization"]["authorizationId"],
      requestDigest: value["authorization"]["requestDigest"],
    }),
    operation: value["operation"] as PackOperation,
    pack,
    installedState: Object.freeze({
      revision: value["installedState"]["revision"] as number,
      digest: value["installedState"]["digest"],
      ...(value["installedState"]["fileDigest"] === undefined
        ? {}
        : { fileDigest: value["installedState"]["fileDigest"] as Sha256Digest }),
    }),
    installedStateAfter: Object.freeze({
      revision: value["installedStateAfter"]["revision"] as number,
      digest: value["installedStateAfter"]["digest"],
      fileDigest: value["installedStateAfter"]["fileDigest"],
    }),
    limits: Object.freeze({
      maxArtifactBytes: value["limits"]["maxArtifactBytes"] as number,
      maxTotalBytes: value["limits"]["maxTotalBytes"] as number,
      maxDirectoryEntries: value["limits"]["maxDirectoryEntries"] as number,
    }),
    ...(directoryChanges === undefined
      ? {}
      : { directoryChanges: Object.freeze(directoryChanges) }),
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
    value["schemaVersion"] !== started.schemaVersion ||
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

function parseReconciliation(
  value: unknown,
  started: PackTransactionStartedRecord,
  terminal: PackTransactionTerminalRecord,
): PackTransactionReconciliationRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "kind",
      "sequence",
      "runId",
      "project",
      "parentRecordDigest",
      "outcome",
      "observedState",
      "authorization",
      "recoveryReportDigest",
      "touchedPaths",
      "reconciledAt",
      "recordDigest",
    ]) ||
    value["schemaVersion"] !== started.schemaVersion ||
    value["kind"] !== "reconciliation" ||
    value["sequence"] !== 2 ||
    value["runId"] !== started.runId ||
    value["parentRecordDigest"] !== terminal.recordDigest ||
    !isRecord(value["authorization"]) ||
    !exactKeys(value["authorization"], [
      "authorizationId",
      "requestDigest",
    ]) ||
    typeof value["authorization"]["authorizationId"] !== "string" ||
    !UUID_PATTERN.test(value["authorization"]["authorizationId"]) ||
    !isSha256Digest(value["authorization"]["requestDigest"]) ||
    !isSha256Digest(value["recoveryReportDigest"]) ||
    !canonicalTimestamp(value["reconciledAt"]) ||
    !isSha256Digest(value["recordDigest"])
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.reconciliation",
      "reconciliation transaction record is malformed",
    );
  }
  let candidate: PackTransactionReconciliationRecord;
  try {
    candidate = createPackTransactionReconciliation({
      started,
      terminal,
      outcome: value["outcome"] as PackTransactionReconciliationOutcome,
      observedState: value["observedState"] as "postimage" | "preimage",
      authorizationId: value["authorization"]["authorizationId"],
      requestDigest: value["authorization"]["requestDigest"],
      recoveryReportDigest: value["recoveryReportDigest"],
      touchedPaths: value["touchedPaths"] as readonly string[],
      reconciledAt: value["reconciledAt"],
    });
  } catch {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.reconciliation",
      "reconciliation transaction semantics are invalid",
    );
  }
  if (
    value["recordDigest"] !== candidate.recordDigest ||
    canonicalizeJson(value) !== canonicalizeJson(candidate)
  ) {
    transactionError(
      "pack-transaction-corrupt",
      "$transaction.reconciliation.recordDigest",
      "reconciliation record digest does not attest its canonical body",
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
  const reconciliationPath = packTransactionRecordPath(request.runId, 2);
  const startedValue = await readRecord(
    root,
    startedPath,
    request.maxDirectoryEntries,
  );
  if (startedValue === undefined) {
    const orphanedTerminal = await readRecord(
      root,
      terminalPath,
      request.maxDirectoryEntries,
    );
    if (orphanedTerminal !== undefined) {
      transactionError(
        "pack-transaction-corrupt",
        terminalPath,
        "pack transaction has a terminal record without its started record",
      );
    }
    const orphanedReconciliation = await readRecord(
      root,
      reconciliationPath,
      request.maxDirectoryEntries,
    );
    if (orphanedReconciliation !== undefined) {
      transactionError(
        "pack-transaction-corrupt",
        reconciliationPath,
        "pack transaction has a reconciliation record without its started record",
      );
    }
    transactionError(
      "pack-transaction-not-found",
      startedPath,
      "pack transaction has no started record",
    );
  }
  const started = parsePackTransactionStartedRecord(
    startedValue,
    request.runId,
    request.project,
  );
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
    const orphanedReconciliation = await readRecord(
      root,
      reconciliationPath,
      request.maxDirectoryEntries,
    );
    if (orphanedReconciliation !== undefined) {
      transactionError(
        "pack-transaction-corrupt",
        reconciliationPath,
        "pack transaction has a reconciliation record without its terminal record",
      );
    }
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
  const reconciliationValue = await readRecord(
    root,
    reconciliationPath,
    request.maxDirectoryEntries,
  );
  if (reconciliationValue === undefined) {
    return Object.freeze({ started, terminal });
  }
  const reconciliation = parseReconciliation(
    reconciliationValue,
    started,
    terminal,
  );
  return Object.freeze({ started, terminal, reconciliation });
}
