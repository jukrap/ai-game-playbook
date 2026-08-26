import {
  canonicalizeJson,
  checkRunReceiptSemantics,
  compareCanonicalText,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  runReceiptSchema,
  sha256Digest,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import {
  CAS_MAX_WRITE_BYTES,
  readProjectFileSnapshot,
  writeProjectFileCas,
} from "./cas-write.js";
import { verifyRunReceiptArtifacts } from "./evidence-artifact-store.js";
import { CoreBoundaryError, type CoreBoundaryErrorCode } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
} from "./project-path.js";

export const RUN_RECEIPT_STORE_PATH =
  ".ai-game-playbook/evidence/receipts" as const;
export const RUN_RECEIPT_MAX_RECORD_BYTES: number = 1024 * 1024;
export const RUN_RECEIPT_MAX_HEAD_BYTES: number = 16 * 1024;
export const RUN_RECEIPT_MAX_CHAIN_LENGTH = 4096;
export const RUN_RECEIPT_MAX_CHAIN_BYTES: number = 64 * 1024 * 1024;
export const RUN_RECEIPT_MAX_ARTIFACTS = 256;
export const RUN_RECEIPT_MAX_ARTIFACT_BYTES: number = CAS_MAX_WRITE_BYTES;

const HEAD_SCHEMA_VERSION = "1.0.0" as const;
const HEAD_KIND = "run-receipt-head" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LOCAL_DETAIL_PATTERN =
  /(?:[a-zA-Z]:[\\/]|\\\\[^\\\r\n]+\\|(?:^|[\s"'(=])\/(?:bin|boot|dev|etc|home|media|mnt|opt|private|proc|root|run|srv|sys|tmp|usr|var|workspace|workspaces)(?:\/|\b))/u;
const SECRET_DETAIL_PATTERN =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~+/=-]+|(?:api[-_ ]?key|access[-_ ]?token|password|secret)\s*[:=]\s*\S+|(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/iu;

type DataRecord = Record<string, unknown>;

interface RunReceiptChainIdentity {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly workflowId: StableId;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly featureId?: StableId;
  readonly featureContractDigest?: Sha256Digest;
}

interface RunReceiptHead extends RunReceiptChainIdentity {
  readonly schemaVersion: typeof HEAD_SCHEMA_VERSION;
  readonly kind: typeof HEAD_KIND;
  readonly receiptId: string;
  readonly sequence: number;
  readonly receiptDigest: Sha256Digest;
  readonly recordDigest: Sha256Digest;
  readonly endedAt: string;
  readonly headDigest: Sha256Digest;
}

type RunReceiptHeadBody = Omit<RunReceiptHead, "headDigest">;

interface SafeTextFile {
  readonly text: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

interface StoredMetadata {
  readonly root: CanonicalProjectRoot;
  readonly head: RunReceiptHead;
  readonly headFileDigest: Sha256Digest;
  readonly recordFileDigest: Sha256Digest;
  readonly receipts: readonly RunReceipt[];
  readonly receiptIds: ReadonlySet<string>;
  readonly attemptKeys: ReadonlySet<string>;
}

export interface StoredRunReceipt {
  readonly rootIdentityDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
  readonly receipt: RunReceipt;
}

export interface LoadedRunReceiptChain {
  readonly stored: StoredRunReceipt;
  readonly receipts: readonly RunReceipt[];
}

export interface PersistRunReceiptRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly previous?: StoredRunReceipt;
  readonly maxArtifactBytes: number;
}

export interface LoadRunReceiptChainRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly workflowId: StableId;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly featureId?: StableId;
  readonly featureContractDigest?: Sha256Digest;
  readonly maxArtifactBytes: number;
}

interface NormalizedLoadRequest extends RunReceiptChainIdentity {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly maxArtifactBytes: number;
}

interface NormalizedPersistRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly previous?: StoredRunReceipt;
  readonly previousMetadata?: StoredMetadata;
  readonly maxArtifactBytes: number;
}

const storedMetadata = new WeakMap<object, StoredMetadata>();
const persistedSuccessors = new WeakMap<object, StoredRunReceipt>();

function storeError(
  code: Extract<
    CoreBoundaryErrorCode,
    | "invalid-run-receipt-store-request"
    | "run-receipt-store-artifact-invalid"
    | "run-receipt-store-budget-exceeded"
    | "run-receipt-store-conflict"
    | "run-receipt-store-corrupt"
    | "run-receipt-store-mismatch"
    | "run-receipt-store-not-found"
    | "run-receipt-store-receipt-invalid"
    | "run-receipt-store-redaction-required"
    | "run-receipt-store-write-failed"
  >,
  path: string,
  message: string,
  mutationUncertain = false,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message, mutationUncertain);
}

function plainRecord(
  value: unknown,
  code:
    | "invalid-run-receipt-store-request"
    | "run-receipt-store-corrupt",
  path: string,
): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw storeError(code, path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw storeError(code, path, "object properties must be enumerable data fields");
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  allowed: readonly string[],
  required: readonly string[],
  code:
    | "invalid-run-receipt-store-request"
    | "run-receipt-store-corrupt",
  path: string,
): void {
  const keys = Object.keys(record).sort(compareCanonicalText);
  const allowedSet = new Set(allowed);
  if (
    keys.some((key) => !allowedSet.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw storeError(
      code,
      path,
      "record contains undeclared fields or omits required fields",
    );
  }
}

function assertRegistry(value: unknown): asserts value is ValidatedRegistry {
  try {
    assertValidatedRegistry(value as ValidatedRegistry);
  } catch {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request.registry",
      "registry must be validated by this registry runtime",
    );
  }
}

function artifactBudget(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > RUN_RECEIPT_MAX_ARTIFACT_BYTES
  ) {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request.maxArtifactBytes",
      "artifact verification budget is outside the fixed runtime boundary",
    );
  }
  return value as number;
}

function unsafeDurableText(value: string): boolean {
  return LOCAL_DETAIL_PATTERN.test(value) || SECRET_DETAIL_PATTERN.test(value);
}

function isReceiptStorePath(value: string): boolean {
  const path = value.toLowerCase();
  const store = RUN_RECEIPT_STORE_PATH.toLowerCase();
  return path === store || path.startsWith(`${store}/`);
}

function receiptAttemptKey(receipt: RunReceipt): string {
  return `${receipt.identity.phase}\u0000${receipt.identity.stepId}\u0000${receipt.identity.attempt}`;
}

function receiptIdentity(receipt: RunReceipt): RunReceiptChainIdentity {
  return Object.freeze({
    runId: receipt.identity.runId,
    projectId: receipt.identity.projectId,
    projectIdentityDigest: receipt.environment.projectIdentityDigest,
    workflowId: receipt.identity.workflowId,
    resolvedPlanDigest: receipt.identity.resolvedPlanDigest,
    registryDigest: receipt.authority.registryDigest,
    ...(receipt.identity.featureId === undefined
      ? {}
      : {
          featureId: receipt.identity.featureId,
          featureContractDigest: receipt.identity.featureContractDigest,
        }),
  });
}

function sameIdentity(
  left: RunReceiptChainIdentity,
  right: RunReceiptChainIdentity,
): boolean {
  return (
    left.runId === right.runId &&
    left.projectId === right.projectId &&
    left.projectIdentityDigest === right.projectIdentityDigest &&
    left.workflowId === right.workflowId &&
    left.resolvedPlanDigest === right.resolvedPlanDigest &&
    left.registryDigest === right.registryDigest &&
    left.featureId === right.featureId &&
    left.featureContractDigest === right.featureContractDigest
  );
}

function assertCurrentReceiptEnvironment(
  root: CanonicalProjectRoot,
  receipt: RunReceipt,
): void {
  const platform =
    root.platform === "win32"
      ? "windows"
      : root.platform === "darwin"
        ? "macos"
        : root.platform === "linux"
          ? "linux"
          : undefined;
  const architecture =
    process.arch === "x64" || process.arch === "arm64"
      ? process.arch
      : undefined;
  if (
    platform === undefined ||
    architecture === undefined ||
    receipt.environment.platform !== platform ||
    receipt.environment.architecture !== architecture ||
    receipt.environment.nodeVersion !== process.versions.node
  ) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.receipt.environment",
      "receipt runtime environment differs from the current control plane",
    );
  }
}

function assertReceiptAuthority(
  registry: ValidatedRegistry,
  receipt: RunReceipt,
  stored: boolean,
): void {
  const command = registry.commands.find(
    (candidate) =>
      candidate.id === receipt.authority.command.id &&
      candidate.version === receipt.authority.command.version,
  );
  if (
    receipt.authority.registryDigest !== registry.digest ||
    command === undefined ||
    digestCanonicalJson(command) !== receipt.authority.command.descriptorDigest ||
    command.handler.digest !== receipt.authority.handlerDigest
  ) {
    throw storeError(
      stored ? "run-receipt-store-corrupt" : "run-receipt-store-mismatch",
      stored ? "$storedReceipt.authority" : "$request.receipt.authority",
      "receipt command authority differs from the bound registry",
    );
  }
}

function assertReceiptStorageSafety(
  receipt: RunReceipt,
  stored: boolean,
): void {
  const invalidCode = stored
    ? "run-receipt-store-corrupt"
    : "run-receipt-store-receipt-invalid";
  if (
    !UUID_PATTERN.test(receipt.identity.runId) ||
    !UUID_PATTERN.test(receipt.receiptId)
  ) {
    throw storeError(
      invalidCode,
      stored ? "$storedReceipt.identity" : "$request.receipt.identity",
      "receipt storage requires lowercase path-safe RFC UUID identities",
    );
  }
  if (receipt.artifacts.length > RUN_RECEIPT_MAX_ARTIFACTS) {
    throw storeError(
      stored ? "run-receipt-store-corrupt" : "run-receipt-store-budget-exceeded",
      stored ? "$storedReceipt.artifacts" : "$request.receipt.artifacts",
      "receipt artifact count exceeds the durable store boundary",
    );
  }
  const artifactIds = new Set<string>();
  const startedAt = Date.parse(receipt.timing.startedAt);
  const endedAt = Date.parse(receipt.timing.endedAt);
  for (const artifact of receipt.artifacts) {
    const createdAt = Date.parse(artifact.createdAt);
    if (
      artifactIds.has(artifact.artifactId) ||
      artifact.commandId !== receipt.authority.command.id ||
      createdAt < startedAt ||
      createdAt > endedAt ||
      isReceiptStorePath(artifact.path)
    ) {
      throw storeError(
        invalidCode,
        stored ? "$storedReceipt.artifacts" : "$request.receipt.artifacts",
        "receipt artifacts contain duplicate, circular, or contradictory locators",
      );
    }
    artifactIds.add(artifact.artifactId);
  }

  if (receipt.diagnostics.some((diagnostic) => !diagnostic.redacted)) {
    throw storeError(
      stored
        ? "run-receipt-store-corrupt"
        : "run-receipt-store-redaction-required",
      stored ? "$storedReceipt.diagnostics" : "$request.receipt.diagnostics",
      "durable diagnostics require an explicit redaction pass",
    );
  }
  const durableText = [
    ...receipt.effects.objectIds,
    ...receipt.effects.destinations,
    ...(receipt.effects.provider === undefined
      ? []
      : [receipt.effects.provider]),
    ...(receipt.effects.model === undefined ? [] : [receipt.effects.model]),
    ...receipt.effects.publishTargets,
    receipt.outcomes.inner.message,
    ...receipt.diagnostics.map((diagnostic) => diagnostic.message),
    ...receipt.recovery.actions,
  ];
  if (durableText.some(unsafeDurableText)) {
    throw storeError(
      stored
        ? "run-receipt-store-corrupt"
        : "run-receipt-store-redaction-required",
      stored ? "$storedReceipt" : "$request.receipt",
      "receipt text contains local-path or credential-shaped material",
    );
  }
}

function validateReceipt(
  registry: ValidatedRegistry,
  value: unknown,
  stored: boolean,
): RunReceipt {
  let receipt: RunReceipt;
  try {
    receipt = validateRegisteredContractValue(
      registry,
      {
        schemaId: runReceiptSchema.schemaId,
        digest: runReceiptSchema.digest,
      },
      value,
    ) as unknown as RunReceipt;
  } catch (error) {
    const detail =
      error instanceof Error ? ` (${error.message.slice(0, 500)})` : "";
    throw storeError(
      stored
        ? "run-receipt-store-corrupt"
        : "run-receipt-store-receipt-invalid",
      stored ? "$storedReceipt" : "$request.receipt",
      `receipt does not satisfy the registered contract${detail}`,
    );
  }
  if (checkRunReceiptSemantics(receipt).length > 0) {
    throw storeError(
      stored
        ? "run-receipt-store-corrupt"
        : "run-receipt-store-receipt-invalid",
      stored ? "$storedReceipt" : "$request.receipt",
      "receipt semantic invariants are invalid",
    );
  }
  assertReceiptAuthority(registry, receipt, stored);
  assertReceiptStorageSafety(receipt, stored);
  return receipt;
}

function mapReadFailure(path: string, error: unknown): never {
  if (error instanceof CoreBoundaryError) {
    if (error.code === "project-root-drift") {
      throw storeError(
        "run-receipt-store-mismatch",
        path,
        "project root identity changed while evidence was read",
      );
    }
    if (
      error.code === "cas-precondition-failed" ||
      error.code === "project-path-not-found"
    ) {
      throw storeError(
        "run-receipt-store-conflict",
        path,
        "evidence file changed while it was read",
      );
    }
  }
  throw storeError(
    "run-receipt-store-corrupt",
    path,
    "evidence file cannot be reopened within the bounded store",
  );
}

async function readTextFile(
  root: CanonicalProjectRoot,
  path: string,
  maxBytes: number,
): Promise<SafeTextFile | undefined> {
  let target;
  try {
    target = await resolveProjectPath(root, path, {
      expectedType: "file",
      existence: "optional",
    });
  } catch (error) {
    mapReadFailure(path, error);
  }
  if (target.kind === "absent") return undefined;

  let snapshot;
  try {
    snapshot = await readProjectFileSnapshot({ root, path, maxBytes });
  } catch (error) {
    mapReadFailure(path, error);
  }
  const bytes = snapshot.content;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "evidence JSON must not contain a byte-order mark",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "evidence JSON is not bounded UTF-8 text",
    );
  }
  return Object.freeze({ text, digest: snapshot.digest, bytes: snapshot.bytes });
}

function parseCanonicalJson(text: string, path: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "evidence JSON could not be parsed",
    );
  }
  let canonical: string;
  try {
    canonical = `${canonicalizeJson(parsed)}\n`;
  } catch {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "evidence JSON cannot be represented canonically",
    );
  }
  if (canonical !== text) {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "evidence JSON bytes are not canonical",
    );
  }
  return parsed;
}

async function ensureStoreDirectory(root: CanonicalProjectRoot): Promise<void> {
  try {
    await resolveProjectPath(root, RUN_RECEIPT_STORE_PATH, {
      expectedType: "directory",
      existence: "required",
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      throw storeError(
        "run-receipt-store-not-found",
        RUN_RECEIPT_STORE_PATH,
        "receipt storage has not been initialized",
      );
    }
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-root-drift"
    ) {
      throw storeError(
        "run-receipt-store-mismatch",
        RUN_RECEIPT_STORE_PATH,
        "project root changed before receipt storage was opened",
      );
    }
    throw storeError(
      "run-receipt-store-corrupt",
      RUN_RECEIPT_STORE_PATH,
      "receipt storage is not an exact project-local directory",
    );
  }
}

function computeHeadDigest(head: RunReceiptHeadBody): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook.run-receipt-head",
    version: "1",
    subject: head,
  });
}

function makeHead(
  receipt: RunReceipt,
  sequence: number,
  recordDigest: Sha256Digest,
): RunReceiptHead {
  const identity = receiptIdentity(receipt);
  const body: RunReceiptHeadBody = {
    schemaVersion: HEAD_SCHEMA_VERSION,
    kind: HEAD_KIND,
    ...identity,
    receiptId: receipt.receiptId,
    sequence,
    receiptDigest: receipt.receiptDigest,
    recordDigest,
    endedAt: receipt.timing.endedAt,
  };
  return Object.freeze({ ...body, headDigest: computeHeadDigest(body) });
}

function parseHead(value: unknown, path: string): RunReceiptHead {
  const record = plainRecord(value, "run-receipt-store-corrupt", path);
  const required = [
    "schemaVersion",
    "kind",
    "runId",
    "projectId",
    "projectIdentityDigest",
    "workflowId",
    "resolvedPlanDigest",
    "registryDigest",
    "receiptId",
    "sequence",
    "receiptDigest",
    "recordDigest",
    "endedAt",
    "headDigest",
  ];
  exactKeys(
    record,
    [...required, "featureId", "featureContractDigest"],
    required,
    "run-receipt-store-corrupt",
    path,
  );
  const featureId = record["featureId"];
  const featureContractDigest = record["featureContractDigest"];
  if (
    record["schemaVersion"] !== HEAD_SCHEMA_VERSION ||
    record["kind"] !== HEAD_KIND ||
    typeof record["runId"] !== "string" ||
    !UUID_PATTERN.test(record["runId"]) ||
    typeof record["projectId"] !== "string" ||
    !isStableId(record["projectId"]) ||
    typeof record["workflowId"] !== "string" ||
    !isStableId(record["workflowId"]) ||
    typeof record["receiptId"] !== "string" ||
    !UUID_PATTERN.test(record["receiptId"]) ||
    !Number.isSafeInteger(record["sequence"]) ||
    (record["sequence"] as number) < 0 ||
    (record["sequence"] as number) >= RUN_RECEIPT_MAX_CHAIN_LENGTH ||
    !isSha256Digest(record["projectIdentityDigest"]) ||
    !isSha256Digest(record["resolvedPlanDigest"]) ||
    !isSha256Digest(record["registryDigest"]) ||
    !isSha256Digest(record["receiptDigest"]) ||
    !isSha256Digest(record["recordDigest"]) ||
    !isSha256Digest(record["headDigest"]) ||
    typeof record["endedAt"] !== "string" ||
    !Number.isFinite(Date.parse(record["endedAt"])) ||
    (featureId === undefined) !== (featureContractDigest === undefined) ||
    (featureId !== undefined &&
      (typeof featureId !== "string" || !isStableId(featureId))) ||
    (featureContractDigest !== undefined &&
      !isSha256Digest(featureContractDigest))
  ) {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "receipt head fields are invalid",
    );
  }
  const body: RunReceiptHeadBody = {
    schemaVersion: HEAD_SCHEMA_VERSION,
    kind: HEAD_KIND,
    runId: record["runId"],
    projectId: record["projectId"],
    projectIdentityDigest: record["projectIdentityDigest"],
    workflowId: record["workflowId"],
    resolvedPlanDigest: record["resolvedPlanDigest"],
    registryDigest: record["registryDigest"],
    ...(featureId === undefined
      ? {}
      : {
          featureId,
          featureContractDigest: featureContractDigest as Sha256Digest,
        }),
    receiptId: record["receiptId"],
    sequence: record["sequence"] as number,
    receiptDigest: record["receiptDigest"],
    recordDigest: record["recordDigest"],
    endedAt: record["endedAt"],
  };
  if (computeHeadDigest(body) !== record["headDigest"]) {
    throw storeError(
      "run-receipt-store-corrupt",
      path,
      "receipt head digest does not attest its canonical body",
    );
  }
  return Object.freeze({ ...body, headDigest: record["headDigest"] });
}

function serializePersisted(value: unknown): string {
  return `${canonicalizeJson(value)}\n`;
}

function recordPath(runId: string, receiptDigest: Sha256Digest): string {
  return `${RUN_RECEIPT_STORE_PATH}/${runId}.${receiptDigest.slice("sha256:".length)}.receipt.json`;
}

function headPath(runId: string): string {
  return `${RUN_RECEIPT_STORE_PATH}/${runId}.head.json`;
}

async function writeImmutableRecord(
  root: CanonicalProjectRoot,
  path: string,
  content: string,
): Promise<SafeTextFile> {
  const desiredDigest = sha256Digest(content);
  const existing = await readTextFile(root, path, RUN_RECEIPT_MAX_RECORD_BYTES);
  if (existing !== undefined) {
    if (existing.digest === desiredDigest && existing.text === content) {
      return existing;
    }
    throw storeError(
      "run-receipt-store-conflict",
      path,
      "immutable receipt path already contains different bytes",
    );
  }
  try {
    await writeProjectFileCas({
      root,
      path,
      content,
      expected: { mode: "absent" },
      maxBytes: RUN_RECEIPT_MAX_RECORD_BYTES,
    });
  } catch (error) {
    const current = await readTextFile(root, path, RUN_RECEIPT_MAX_RECORD_BYTES);
    if (
      current !== undefined &&
      current.digest === desiredDigest &&
      current.text === content
    ) {
      return current;
    }
    if (
      error instanceof CoreBoundaryError &&
      error.code === "cas-precondition-failed"
    ) {
      throw storeError(
        "run-receipt-store-conflict",
        path,
        "another writer claimed the immutable receipt path",
      );
    }
    throw storeError(
      "run-receipt-store-write-failed",
      path,
      "receipt record write could not be proven",
      error instanceof CoreBoundaryError && error.mutationUncertain,
    );
  }
  const written = await readTextFile(root, path, RUN_RECEIPT_MAX_RECORD_BYTES);
  if (
    written === undefined ||
    written.digest !== desiredDigest ||
    written.text !== content
  ) {
    throw storeError(
      "run-receipt-store-write-failed",
      path,
      "receipt record postcondition is uncertain",
      true,
    );
  }
  return written;
}

async function writeHead(
  root: CanonicalProjectRoot,
  path: string,
  content: string,
  expected:
    | { readonly mode: "absent" }
    | { readonly mode: "digest"; readonly digest: Sha256Digest },
): Promise<SafeTextFile> {
  const desiredDigest = sha256Digest(content);
  try {
    await writeProjectFileCas({
      root,
      path,
      content,
      expected,
      maxBytes: RUN_RECEIPT_MAX_HEAD_BYTES,
    });
  } catch (error) {
    const current = await readTextFile(root, path, RUN_RECEIPT_MAX_HEAD_BYTES);
    if (
      current !== undefined &&
      current.digest === desiredDigest &&
      current.text === content
    ) {
      return current;
    }
    if (
      error instanceof CoreBoundaryError &&
      (error.code === "cas-precondition-failed" ||
        (current !== undefined &&
          (error.code === "cas-commit-failed" ||
            error.code === "cas-postcondition-failed" ||
            error.code === "cas-cleanup-conflict")))
    ) {
      throw storeError(
        "run-receipt-store-conflict",
        path,
        "receipt head changed before the CAS update",
        error.mutationUncertain,
      );
    }
    throw storeError(
      "run-receipt-store-write-failed",
      path,
      "receipt head update could not be proven",
      error instanceof CoreBoundaryError && error.mutationUncertain,
    );
  }
  const written = await readTextFile(root, path, RUN_RECEIPT_MAX_HEAD_BYTES);
  if (
    written === undefined ||
    written.digest !== desiredDigest ||
    written.text !== content
  ) {
    throw storeError(
      "run-receipt-store-write-failed",
      path,
      "receipt head postcondition is uncertain",
      true,
    );
  }
  return written;
}

function makeStored(
  root: CanonicalProjectRoot,
  head: RunReceiptHead,
  headFileDigest: Sha256Digest,
  recordFileDigest: Sha256Digest,
  receipts: readonly RunReceipt[],
): StoredRunReceipt {
  const frozenReceipts = Object.freeze([...receipts]);
  const latest = frozenReceipts.at(-1);
  if (latest === undefined) {
    throw storeError(
      "run-receipt-store-corrupt",
      "$receiptChain",
      "receipt chain cannot be empty",
    );
  }
  const stored = Object.freeze({
    rootIdentityDigest: root.identityDigest,
    headDigest: head.headDigest,
    chainLength: frozenReceipts.length,
    receipt: latest,
  });
  storedMetadata.set(stored, {
    root,
    head,
    headFileDigest,
    recordFileDigest,
    receipts: frozenReceipts,
    receiptIds: new Set(frozenReceipts.map((receipt) => receipt.receiptId)),
    attemptKeys: new Set(frozenReceipts.map(receiptAttemptKey)),
  });
  return stored;
}

function storedHandle(value: unknown): {
  readonly stored: StoredRunReceipt;
  readonly metadata: StoredMetadata;
} {
  if (value === null || typeof value !== "object") {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request.previous",
      "previous receipt must be a same-process stored handle",
    );
  }
  const metadata = storedMetadata.get(value);
  if (metadata === undefined) {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request.previous",
      "previous receipt must be a same-process stored handle",
    );
  }
  const stored = value as StoredRunReceipt;
  if (
    stored.rootIdentityDigest !== metadata.root.identityDigest ||
    stored.headDigest !== metadata.head.headDigest ||
    stored.chainLength !== metadata.receipts.length ||
    stored.receipt.receiptDigest !== metadata.head.receiptDigest
  ) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.previous",
      "stored receipt handle differs from its bound authority",
    );
  }
  return { stored, metadata };
}

function normalizeLoadRequest(value: LoadRunReceiptChainRequest): NormalizedLoadRequest {
  const record = plainRecord(
    value,
    "invalid-run-receipt-store-request",
    "$request",
  );
  const required = [
    "root",
    "registry",
    "runId",
    "projectId",
    "projectIdentityDigest",
    "workflowId",
    "resolvedPlanDigest",
    "maxArtifactBytes",
  ];
  exactKeys(
    record,
    [...required, "featureId", "featureContractDigest"],
    required,
    "invalid-run-receipt-store-request",
    "$request",
  );
  assertRegistry(record["registry"]);
  if (
    typeof record["runId"] !== "string" ||
    !UUID_PATTERN.test(record["runId"]) ||
    typeof record["projectId"] !== "string" ||
    !isStableId(record["projectId"]) ||
    typeof record["workflowId"] !== "string" ||
    !isStableId(record["workflowId"]) ||
    !isSha256Digest(record["projectIdentityDigest"]) ||
    !isSha256Digest(record["resolvedPlanDigest"])
  ) {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request",
      "load identity fields are invalid",
    );
  }
  const featureId = record["featureId"];
  const featureContractDigest = record["featureContractDigest"];
  if (
    (featureId === undefined) !== (featureContractDigest === undefined) ||
    (featureId !== undefined &&
      (typeof featureId !== "string" || !isStableId(featureId))) ||
    (featureContractDigest !== undefined &&
      !isSha256Digest(featureContractDigest))
  ) {
    throw storeError(
      "invalid-run-receipt-store-request",
      "$request.featureId",
      "feature identity must be absent or carry an exact contract digest",
    );
  }
  return Object.freeze({
    root: value.root,
    registry: value.registry,
    runId: record["runId"],
    projectId: record["projectId"],
    projectIdentityDigest: record["projectIdentityDigest"],
    workflowId: record["workflowId"],
    resolvedPlanDigest: record["resolvedPlanDigest"],
    registryDigest: value.registry.digest,
    ...(featureId === undefined
      ? {}
      : {
          featureId,
          featureContractDigest: featureContractDigest as Sha256Digest,
        }),
    maxArtifactBytes: artifactBudget(record["maxArtifactBytes"]),
  });
}

function normalizePersistRequest(
  value: PersistRunReceiptRequest,
): NormalizedPersistRequest {
  const record = plainRecord(
    value,
    "invalid-run-receipt-store-request",
    "$request",
  );
  exactKeys(
    record,
    ["root", "registry", "receipt", "previous", "maxArtifactBytes"],
    ["root", "registry", "receipt", "maxArtifactBytes"],
    "invalid-run-receipt-store-request",
    "$request",
  );
  assertRegistry(record["registry"]);
  const receipt = validateReceipt(value.registry, record["receipt"], false);
  const previous =
    record["previous"] === undefined
      ? undefined
      : storedHandle(record["previous"]);
  if (
    previous !== undefined &&
    previous.metadata.head.registryDigest !== value.registry.digest
  ) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.previous",
      "previous receipt belongs to different project or registry authority",
    );
  }
  return Object.freeze({
    root: value.root,
    registry: value.registry,
    receipt,
    ...(previous === undefined
      ? {}
      : { previous: previous.stored, previousMetadata: previous.metadata }),
    maxArtifactBytes: artifactBudget(record["maxArtifactBytes"]),
  });
}

async function verifyArtifacts(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  receipts: readonly RunReceipt[],
  maxArtifactBytes: number,
): Promise<void> {
  try {
    await verifyRunReceiptArtifacts({
      root,
      registry,
      receipts,
      maxArtifactBytes,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "evidence-artifact-budget-exceeded"
    ) {
      throw storeError(
        "run-receipt-store-budget-exceeded",
        "$request.maxArtifactBytes",
        "complete artifacts exceed the verification budget",
      );
    }
    throw storeError(
      "run-receipt-store-artifact-invalid",
      error instanceof CoreBoundaryError ? error.path : "$receipt.artifacts",
      "complete artifact bytes or manifest are not valid durable evidence",
    );
  }
}

function assertHeadMatchesRequest(
  head: RunReceiptHead,
  request: NormalizedLoadRequest,
): void {
  if (!sameIdentity(head, request)) {
    throw storeError(
      "run-receipt-store-mismatch",
      headPath(request.runId),
      "receipt head differs from the requested run identity",
    );
  }
}

function assertReceiptMatchesIdentity(
  receipt: RunReceipt,
  identity: RunReceiptChainIdentity,
  stored: boolean,
): void {
  if (!sameIdentity(receiptIdentity(receipt), identity)) {
    throw storeError(
      stored ? "run-receipt-store-corrupt" : "run-receipt-store-mismatch",
      stored ? "$storedReceipt.identity" : "$request.receipt.identity",
      "receipt identity differs from its run chain",
    );
  }
}

async function loadRunReceiptChainInternal(
  request: NormalizedLoadRequest,
): Promise<LoadedRunReceiptChain> {
  await assertProjectRootIdentity(request.root);
  if (request.projectIdentityDigest !== request.root.identityDigest) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.projectIdentityDigest",
      "receipt chain identity differs from the bound project root",
    );
  }
  await ensureStoreDirectory(request.root);
  const currentHeadPath = headPath(request.runId);
  const headFile = await readTextFile(
    request.root,
    currentHeadPath,
    RUN_RECEIPT_MAX_HEAD_BYTES,
  );
  if (headFile === undefined) {
    throw storeError(
      "run-receipt-store-not-found",
      currentHeadPath,
      "receipt head does not exist",
    );
  }
  const head = parseHead(
    parseCanonicalJson(headFile.text, currentHeadPath),
    currentHeadPath,
  );
  assertHeadMatchesRequest(head, request);

  let totalBytes = headFile.bytes;
  let expectedDigest = head.receiptDigest;
  let child: RunReceipt | undefined;
  const newestFirst: RunReceipt[] = [];
  const receiptIds = new Set<string>();
  const attemptKeys = new Set<string>();
  const recordFiles: Array<{
    readonly path: string;
    readonly digest: Sha256Digest;
  }> = [];
  let latestRecordDigest: Sha256Digest | undefined;
  for (let sequence = head.sequence; sequence >= 0; sequence -= 1) {
    const path = recordPath(request.runId, expectedDigest);
    const file = await readTextFile(
      request.root,
      path,
      RUN_RECEIPT_MAX_RECORD_BYTES,
    );
    if (file === undefined) {
      throw storeError(
        "run-receipt-store-corrupt",
        path,
        "receipt chain record is missing",
      );
    }
    totalBytes += file.bytes;
    if (totalBytes > RUN_RECEIPT_MAX_CHAIN_BYTES) {
      throw storeError(
        "run-receipt-store-corrupt",
        path,
        "receipt chain exceeds its fixed total byte limit",
      );
    }
    const receipt = validateReceipt(
      request.registry,
      parseCanonicalJson(file.text, path),
      true,
    );
    assertReceiptMatchesIdentity(receipt, head, true);
    const attemptKey = receiptAttemptKey(receipt);
    if (
      receipt.receiptDigest !== expectedDigest ||
      receiptIds.has(receipt.receiptId) ||
      attemptKeys.has(attemptKey)
    ) {
      throw storeError(
        "run-receipt-store-corrupt",
        path,
        "receipt record identity, digest, or attempt is duplicated",
      );
    }
    if (
      child !== undefined &&
      child.previousReceiptDigest !== receipt.receiptDigest
    ) {
      throw storeError(
        "run-receipt-store-corrupt",
        path,
        "receipt predecessor link is broken",
      );
    }
    if (
      (sequence === 0 && receipt.previousReceiptDigest !== undefined) ||
      (sequence > 0 && receipt.previousReceiptDigest === undefined)
    ) {
      throw storeError(
        "run-receipt-store-corrupt",
        path,
        "receipt predecessor presence contradicts its chain position",
      );
    }
    if (sequence === head.sequence) {
      latestRecordDigest = file.digest;
      if (
        receipt.receiptId !== head.receiptId ||
        receipt.timing.endedAt !== head.endedAt ||
        file.digest !== head.recordDigest
      ) {
        throw storeError(
          "run-receipt-store-corrupt",
          path,
          "receipt head does not match its current record",
        );
      }
    }
    receiptIds.add(receipt.receiptId);
    attemptKeys.add(attemptKey);
    newestFirst.push(receipt);
    recordFiles.push({ path, digest: file.digest });
    child = receipt;
    if (receipt.previousReceiptDigest !== undefined) {
      expectedDigest = receipt.previousReceiptDigest;
    }
  }
  if (
    newestFirst.length !== head.sequence + 1 ||
    latestRecordDigest === undefined
  ) {
    throw storeError(
      "run-receipt-store-corrupt",
      currentHeadPath,
      "receipt chain length does not match its head",
    );
  }
  const receipts = Object.freeze(newestFirst.reverse());
  await verifyArtifacts(
    request.root,
    request.registry,
    receipts,
    request.maxArtifactBytes,
  );

  for (const recordFile of recordFiles) {
    const current = await readTextFile(
      request.root,
      recordFile.path,
      RUN_RECEIPT_MAX_RECORD_BYTES,
    );
    if (current === undefined || current.digest !== recordFile.digest) {
      throw storeError(
        "run-receipt-store-conflict",
        recordFile.path,
        "receipt record changed during chain validation",
      );
    }
  }
  const currentHead = await readTextFile(
    request.root,
    currentHeadPath,
    RUN_RECEIPT_MAX_HEAD_BYTES,
  );
  if (currentHead === undefined || currentHead.digest !== headFile.digest) {
    throw storeError(
      "run-receipt-store-conflict",
      currentHeadPath,
      "receipt head changed during chain validation",
    );
  }
  const stored = makeStored(
    request.root,
    head,
    headFile.digest,
    latestRecordDigest,
    receipts,
  );
  return Object.freeze({ stored, receipts });
}

export async function loadRunReceiptChain(
  value: LoadRunReceiptChainRequest,
): Promise<LoadedRunReceiptChain> {
  return loadRunReceiptChainInternal(normalizeLoadRequest(value));
}

function loadRequestFromReceipt(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  receipt: RunReceipt,
  maxArtifactBytes: number,
): NormalizedLoadRequest {
  return loadRequestFromIdentity(
    root,
    registry,
    receiptIdentity(receipt),
    maxArtifactBytes,
  );
}

function loadRequestFromIdentity(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  identity: RunReceiptChainIdentity,
  maxArtifactBytes: number,
): NormalizedLoadRequest {
  return Object.freeze({
    root,
    registry,
    runId: identity.runId,
    projectId: identity.projectId,
    projectIdentityDigest: identity.projectIdentityDigest,
    workflowId: identity.workflowId,
    resolvedPlanDigest: identity.resolvedPlanDigest,
    registryDigest: identity.registryDigest,
    ...(identity.featureId === undefined
      ? {}
      : {
          featureId: identity.featureId,
          featureContractDigest: identity.featureContractDigest,
        }),
    maxArtifactBytes,
  });
}

function sameReceipt(left: RunReceipt, right: RunReceipt): boolean {
  return (
    left.receiptDigest === right.receiptDigest &&
    canonicalizeJson(left) === canonicalizeJson(right)
  );
}

export async function persistRunReceipt(
  value: PersistRunReceiptRequest,
): Promise<StoredRunReceipt> {
  const request = normalizePersistRequest(value);
  await assertProjectRootIdentity(request.root);
  if (
    request.receipt.environment.projectIdentityDigest !==
    request.root.identityDigest
  ) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.receipt.environment.projectIdentityDigest",
      "receipt project identity differs from the bound project root",
    );
  }
  assertCurrentReceiptEnvironment(request.root, request.receipt);
  if (
    request.previousMetadata !== undefined &&
    request.previousMetadata.root.identityDigest !== request.root.identityDigest
  ) {
    throw storeError(
      "run-receipt-store-mismatch",
      "$request.previous",
      "previous receipt belongs to a different project root",
    );
  }
  await ensureStoreDirectory(request.root);

  let previousMetadata: StoredMetadata | undefined;
  if (request.previous !== undefined && request.previousMetadata !== undefined) {
    const knownSuccessor = persistedSuccessors.get(request.previous);
    if (knownSuccessor !== undefined) {
      if (sameReceipt(knownSuccessor.receipt, request.receipt)) {
        const current = await loadRunReceiptChainInternal(
          loadRequestFromReceipt(
            request.root,
            request.registry,
            request.receipt,
            request.maxArtifactBytes,
          ),
        );
        if (current.stored.headDigest !== knownSuccessor.headDigest) {
          throw storeError(
            "run-receipt-store-conflict",
            "$request.previous",
            "persisted successor is no longer the durable receipt head",
          );
        }
        persistedSuccessors.set(request.previous, current.stored);
        return current.stored;
      }
      throw storeError(
        "run-receipt-store-conflict",
        "$request.previous",
        "previous receipt already has a different persisted successor",
      );
    }
    if (
      request.receipt.previousReceiptDigest !==
      request.previous.receipt.receiptDigest
    ) {
      throw storeError(
        "run-receipt-store-mismatch",
        "$request.receipt.previousReceiptDigest",
        "receipt predecessor does not match the supplied stored head",
      );
    }
    assertReceiptMatchesIdentity(
      request.receipt,
      request.previousMetadata.head,
      false,
    );
    const current = await loadRunReceiptChainInternal(
      loadRequestFromIdentity(
        request.root,
        request.registry,
        request.previousMetadata.head,
        request.maxArtifactBytes,
      ),
    );
    if (
      current.stored.headDigest !== request.previous.headDigest ||
      current.stored.receipt.receiptDigest !==
        request.previous.receipt.receiptDigest
    ) {
      throw storeError(
        "run-receipt-store-conflict",
        "$request.previous",
        "supplied receipt is no longer the durable head",
      );
    }
    previousMetadata = storedMetadata.get(current.stored);
    if (previousMetadata === undefined) {
      throw storeError(
        "run-receipt-store-corrupt",
        "$request.previous",
        "reloaded receipt head lost its runtime provenance",
      );
    }
    if (
      previousMetadata.receiptIds.has(request.receipt.receiptId) ||
      previousMetadata.attemptKeys.has(receiptAttemptKey(request.receipt))
    ) {
      throw storeError(
        "run-receipt-store-mismatch",
        "$request.receipt.identity",
        "receipt ID or step attempt already exists in the run chain",
      );
    }
  } else {
    if (request.receipt.previousReceiptDigest !== undefined) {
      throw storeError(
        "run-receipt-store-mismatch",
        "$request.receipt.previousReceiptDigest",
        "initial receipt cannot name a predecessor",
      );
    }
    const currentHeadFile = await readTextFile(
      request.root,
      headPath(request.receipt.identity.runId),
      RUN_RECEIPT_MAX_HEAD_BYTES,
    );
    if (currentHeadFile !== undefined) {
      const current = await loadRunReceiptChainInternal(
        loadRequestFromReceipt(
          request.root,
          request.registry,
          request.receipt,
          request.maxArtifactBytes,
        ),
      );
      const onlyReceipt = current.receipts[0];
      if (
        current.receipts.length === 1 &&
        onlyReceipt !== undefined &&
        sameReceipt(onlyReceipt, request.receipt)
      ) {
        return current.stored;
      }
      throw storeError(
        "run-receipt-store-conflict",
        headPath(request.receipt.identity.runId),
        "run already has a different receipt head",
      );
    }
  }

  const receipts = Object.freeze([
    ...(previousMetadata?.receipts ?? []),
    request.receipt,
  ]);
  const sequence =
    previousMetadata?.head.sequence === undefined
      ? 0
      : previousMetadata.head.sequence + 1;
  if (sequence >= RUN_RECEIPT_MAX_CHAIN_LENGTH) {
    throw storeError(
      "run-receipt-store-budget-exceeded",
      "$request.receipt",
      "receipt chain exceeds the fixed record count limit",
    );
  }
  const receiptText = serializePersisted(request.receipt);
  if (Buffer.byteLength(receiptText, "utf8") > RUN_RECEIPT_MAX_RECORD_BYTES) {
    throw storeError(
      "run-receipt-store-budget-exceeded",
      "$request.receipt",
      "receipt record exceeds the fixed byte limit",
    );
  }
  const totalRecordBytes = receipts.reduce(
    (total, receipt) =>
      total + Buffer.byteLength(serializePersisted(receipt), "utf8"),
    0,
  );
  if (totalRecordBytes > RUN_RECEIPT_MAX_CHAIN_BYTES) {
    throw storeError(
      "run-receipt-store-budget-exceeded",
      "$request.receipt",
      "receipt chain exceeds the fixed total byte limit",
    );
  }
  await verifyArtifacts(
    request.root,
    request.registry,
    receipts,
    request.maxArtifactBytes,
  );

  const receiptPath = recordPath(
    request.receipt.identity.runId,
    request.receipt.receiptDigest,
  );
  const recordFile = await writeImmutableRecord(
    request.root,
    receiptPath,
    receiptText,
  );
  await verifyArtifacts(
    request.root,
    request.registry,
    receipts,
    request.maxArtifactBytes,
  );
  const head = makeHead(request.receipt, sequence, recordFile.digest);
  const headText = serializePersisted(head);
  const writtenHead = await writeHead(
    request.root,
    headPath(request.receipt.identity.runId),
    headText,
    previousMetadata === undefined
      ? { mode: "absent" }
      : { mode: "digest", digest: previousMetadata.headFileDigest },
  );
  const stored = makeStored(
    request.root,
    head,
    writtenHead.digest,
    recordFile.digest,
    receipts,
  );
  if (request.previous !== undefined) {
    persistedSuccessors.set(request.previous, stored);
  }
  return stored;
}
