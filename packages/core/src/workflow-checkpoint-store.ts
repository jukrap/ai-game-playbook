import {
  canonicalizeJson,
  checkWorkflowCheckpointSemantics,
  compareCanonicalText,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  sha256Digest,
  WORKFLOW_RECONCILIATION_COMMAND_ID,
  WORKFLOW_RECONCILIATION_STEP_ID,
  WORKFLOW_RECONCILIATION_WORKFLOW_ID,
  workflowCheckpointSchema,
  type ProjectStage,
  type ResolvedWorkflowCommand,
  type ResolvedWorkflowPlan,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointBudgetUsage,
  type WorkflowCheckpointInFlight,
  type WorkflowCheckpointRecord,
  type WorkflowCheckpointStatus,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  resolveWorkflowPlan,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";
import { constants, type BigIntStats } from "node:fs";
import { open, opendir, type FileHandle } from "node:fs/promises";

import { writeProjectFileCas } from "./cas-write.js";
import {
  BoundedFileReadLimitError,
  readFileHandleBounded,
} from "./bounded-file-read.js";
import { CoreBoundaryError, type CoreBoundaryErrorCode } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ResolvedProjectPath,
} from "./project-path.js";
import {
  assertWorkflowCheckpointRuntimeInstance,
  recoverHydratedWorkflowCheckpoint,
  retainHydratedWorkflowCheckpoint,
  type WorkflowCheckpointFeature,
  type WorkflowCheckpointProject,
} from "./workflow-state.js";

export const WORKFLOW_CHECKPOINT_STORE_PATH =
  ".ai-game-playbook/state/workflows" as const;
export const WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES: number = 1024 * 1024;
export const WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES: number = 16 * 1024;
export const WORKFLOW_CHECKPOINT_MAX_CHAIN_LENGTH = 4096;
export const WORKFLOW_CHECKPOINT_MAX_CHAIN_BYTES: number = 64 * 1024 * 1024;
export const WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES = 16_384;
export const WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS = 1_024;
export const WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES: number =
  16 * 1024 * 1024;

const HEAD_SCHEMA_VERSION = "1.0.0" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEAD_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.head\.json$/;
const RECORD_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(0|[1-9][0-9]{0,6})\.([0-9a-f]{64})\.checkpoint\.json$/;
const PROJECT_STAGES = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const TERMINAL_STATUSES = new Set<WorkflowCheckpointStatus>([
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "expired",
  "archived",
]);

type DataRecord = Record<string, unknown>;

interface WorkflowCheckpointHead {
  readonly schemaVersion: typeof HEAD_SCHEMA_VERSION;
  readonly runId: string;
  readonly checkpointId: string;
  readonly sequence: number;
  readonly checkpointDigest: Sha256Digest;
  readonly recordDigest: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly updatedAt: string;
  readonly headDigest: Sha256Digest;
}

type WorkflowCheckpointHeadBody = Omit<WorkflowCheckpointHead, "headDigest">;

interface SafeTextFile {
  readonly text: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

interface StoredMetadata {
  readonly root: CanonicalProjectRoot;
  readonly head: WorkflowCheckpointHead;
  readonly headFileDigest: Sha256Digest;
  readonly recordFileDigest: Sha256Digest;
  readonly checkpoints?: readonly WorkflowCheckpointRecord[];
}

interface NormalizedQueryRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly maxEntries: number;
  readonly maxHeads: number;
  readonly maxTotalHeadBytes: number;
}

interface WorkflowCheckpointStoreInventory {
  readonly entries: readonly string[];
  readonly headFiles: readonly string[];
  readonly recordFiles: readonly string[];
}

interface QueriedWorkflowCheckpointHeadWitness {
  readonly head: WorkflowCheckpointHead;
  readonly headFileDigest: Sha256Digest;
  readonly latestCheckpoint: WorkflowCheckpointRecord;
  readonly recordPath: string;
  readonly recordFileDigest: Sha256Digest;
}

interface WorkflowCheckpointHeadQueryMetadata {
  readonly request: NormalizedQueryRequest;
  readonly directory?: ResolvedProjectPath;
  readonly inventory: WorkflowCheckpointStoreInventory;
  readonly heads: ReadonlyMap<string, QueriedWorkflowCheckpointHeadWitness>;
}

export interface StoredWorkflowCheckpoint {
  readonly rootIdentityDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
  readonly checkpoint: WorkflowCheckpointRecord;
}

export interface LoadedWorkflowCheckpointChain {
  readonly stored: StoredWorkflowCheckpoint;
  readonly checkpoints: readonly WorkflowCheckpointRecord[];
}

export interface PersistWorkflowCheckpointRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly checkpoint: WorkflowCheckpointRecord;
  readonly previous?: StoredWorkflowCheckpoint;
}

export interface LoadWorkflowCheckpointRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly runId: string;
  readonly project: WorkflowCheckpointProject;
  readonly inputDigest: Sha256Digest;
  readonly feature?: WorkflowCheckpointFeature;
  readonly dirtyStateDigest?: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
  readonly now?: () => number;
}

export interface QueryWorkflowCheckpointHeadsRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly maxEntries: number;
  readonly maxHeads: number;
  readonly maxTotalHeadBytes: number;
}

export interface LoadQueriedWorkflowCheckpointRequest {
  readonly query: WorkflowCheckpointHeadQuery;
  readonly runId: string;
}

export type WorkflowCheckpointProjectAuthority =
  | "current"
  | "foreign"
  | "unbound";
export type WorkflowCheckpointRegistryAuthority = "current" | "stale";

export interface WorkflowCheckpointHeadSummary {
  readonly runId: string;
  readonly checkpointId: string;
  readonly sequence: number;
  readonly checkpointDigest: Sha256Digest;
  readonly status: WorkflowCheckpointStatus;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly projectRootIdentityDigest?: Sha256Digest;
  readonly projectAuthority: WorkflowCheckpointProjectAuthority;
  readonly projectStage: ProjectStage;
  readonly registryDigest: Sha256Digest;
  readonly registryAuthority: WorkflowCheckpointRegistryAuthority;
  readonly workflowId: StableId;
  readonly workflowVersion: string;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly featureId?: StableId;
  readonly featureContractDigest?: Sha256Digest;
  readonly receiptChainHead?: Sha256Digest;
  readonly inFlight?: {
    readonly phase: "command" | "rollback";
    readonly sideEffect:
      | "not-started"
      | "started"
      | "confirmed"
      | "rolled-back"
      | "uncertain";
  };
  readonly updatedAt: string;
  readonly headDigest: Sha256Digest;
}

export interface WorkflowCheckpointHeadQuery {
  readonly validationLevel: "head-and-latest-record-presence";
  readonly rootIdentityDigest: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly entriesObserved: number;
  readonly headFilesObserved: number;
  readonly recordFilesObserved: number;
  readonly heads: readonly WorkflowCheckpointHeadSummary[];
}

export type WorkflowCheckpointResumePolicy = "never" | "safe";
export type WorkflowCheckpointResumeDisposition =
  | "ready-for-authorization"
  | "restart-required"
  | "reconciliation-required"
  | "terminal";

export interface ResumeWorkflowCheckpointRequest {
  readonly registry: ValidatedRegistry;
  readonly stored: StoredWorkflowCheckpoint;
  readonly policy: WorkflowCheckpointResumePolicy;
  readonly now?: () => number;
}

export interface WorkflowCheckpointResumeResult {
  readonly disposition: WorkflowCheckpointResumeDisposition;
  readonly recoveryPersisted: boolean;
  readonly stored: StoredWorkflowCheckpoint;
  readonly checkpoint: WorkflowCheckpointRecord;
}

const storedMetadata = new WeakMap<object, StoredMetadata>();
const persistedSuccessors = new WeakMap<object, StoredWorkflowCheckpoint>();
const queriedHeadMetadata = new WeakMap<
  object,
  WorkflowCheckpointHeadQueryMetadata
>();

function storeError(
  code: Extract<
    CoreBoundaryErrorCode,
    | "invalid-workflow-checkpoint-store-request"
    | "workflow-checkpoint-resume-unsafe"
    | "workflow-checkpoint-store-budget-exceeded"
    | "workflow-checkpoint-store-conflict"
    | "workflow-checkpoint-store-corrupt"
    | "workflow-checkpoint-store-mismatch"
    | "workflow-checkpoint-store-not-found"
    | "workflow-checkpoint-store-write-failed"
  >,
  path: string,
  message: string,
  mutationUncertain = false,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message, mutationUncertain);
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "expected a plain data object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "object properties must be enumerable data fields",
    );
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const keys = Object.keys(record).sort(compareCanonicalText);
  const allowedSet = new Set(allowed);
  if (
    keys.some((key) => !allowedSet.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "request contains undeclared fields or omits required fields",
    );
  }
}

function assertRegistry(value: unknown): asserts value is ValidatedRegistry {
  try {
    assertValidatedRegistry(value as ValidatedRegistry);
  } catch {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.registry",
      "registry must be validated by this registry runtime",
    );
  }
}

function queryBudget(value: unknown, maximum: number, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > maximum
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "query budget is outside the fixed runtime boundary",
    );
  }
  return value as number;
}

function normalizeQueryRequest(
  value: QueryWorkflowCheckpointHeadsRequest,
): NormalizedQueryRequest {
  const request = dataRecord(value, "$request");
  exactKeys(
    request,
    ["root", "registry", "maxEntries", "maxHeads", "maxTotalHeadBytes"],
    ["root", "registry", "maxEntries", "maxHeads", "maxTotalHeadBytes"],
    "$request",
  );
  assertRegistry(request["registry"]);
  return Object.freeze({
    root: request["root"] as CanonicalProjectRoot,
    registry: request["registry"],
    maxEntries: queryBudget(
      request["maxEntries"],
      WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES,
      "$request.maxEntries",
    ),
    maxHeads: queryBudget(
      request["maxHeads"],
      WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS,
      "$request.maxHeads",
    ),
    maxTotalHeadBytes: queryBudget(
      request["maxTotalHeadBytes"],
      WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES,
      "$request.maxTotalHeadBytes",
    ),
  });
}

function readClock(value: unknown): number {
  if (typeof value !== "function") {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.now",
      "clock must be a function",
    );
  }
  let currentTime: unknown;
  try {
    currentTime = (value as () => unknown)();
  } catch {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.now",
      "clock failed while reading the current time",
    );
  }
  if (
    !Number.isSafeInteger(currentTime) ||
    (currentTime as number) < 0 ||
    (currentTime as number) > 8_640_000_000_000_000
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.now",
      "clock must return an epoch millisecond inside the supported date range",
    );
  }
  return currentTime as number;
}

function stableId(value: unknown, path: string): StableId {
  if (!isStableId(value)) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "expected a stable identifier",
    );
  }
  return value;
}

function digest(value: unknown, path: string): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      path,
      "expected a SHA-256 digest",
    );
  }
  return value;
}

function projectBinding(value: unknown): WorkflowCheckpointProject {
  const record = dataRecord(value, "$request.project");
  exactKeys(
    record,
    ["id", "identityDigest", "rootIdentityDigest", "stage"],
    ["id", "identityDigest", "stage"],
    "$request.project",
  );
  if (
    typeof record["stage"] !== "string" ||
    !PROJECT_STAGES.has(record["stage"] as ProjectStage)
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.project.stage",
      "expected a known project stage",
    );
  }
  return Object.freeze({
    id: stableId(record["id"], "$request.project.id"),
    identityDigest: digest(
      record["identityDigest"],
      "$request.project.identityDigest",
    ),
    ...(record["rootIdentityDigest"] === undefined
      ? {}
      : {
          rootIdentityDigest: digest(
            record["rootIdentityDigest"],
            "$request.project.rootIdentityDigest",
          ),
        }),
    stage: record["stage"] as ProjectStage,
  });
}

function featureBinding(
  value: unknown,
): WorkflowCheckpointFeature | undefined {
  if (value === undefined) return undefined;
  const record = dataRecord(value, "$request.feature");
  exactKeys(
    record,
    ["id", "contractDigest"],
    ["id", "contractDigest"],
    "$request.feature",
  );
  return Object.freeze({
    id: stableId(record["id"], "$request.feature.id"),
    contractDigest: digest(
      record["contractDigest"],
      "$request.feature.contractDigest",
    ),
  });
}

function identityMatches(stats: BigIntStats, target: ResolvedProjectPath): boolean {
  return (
    target.targetIdentity !== undefined &&
    target.targetIdentity.device === stats.dev.toString() &&
    target.targetIdentity.inode === stats.ino.toString()
  );
}

async function readProjectTextFile(
  root: CanonicalProjectRoot,
  path: string,
  maxBytes: number,
): Promise<SafeTextFile | undefined> {
  await assertProjectRootIdentity(root);
  const target = await resolveProjectPath(root, path, {
    expectedType: "file",
    existence: "optional",
  });
  if (target.kind === "absent") return undefined;

  const noFollow = constants.O_NOFOLLOW ?? 0;
  let handle: FileHandle | undefined;
  let content: Buffer | undefined;
  let operationError: unknown;
  try {
    handle = await open(target.absolutePath, constants.O_RDONLY | noFollow);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !identityMatches(before, target)) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "store file identity changed before read",
      );
    }
    if (before.size > BigInt(maxBytes)) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "store file exceeds its fixed byte limit",
      );
    }
    try {
      content = await readFileHandleBounded(handle, maxBytes);
    } catch (error) {
      if (error instanceof BoundedFileReadLimitError) {
        throw storeError(
          "workflow-checkpoint-store-corrupt",
          path,
          "store file exceeded its fixed byte limit while it was read",
        );
      }
      throw error;
    }
    const after = await handle.stat({ bigint: true });
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    ) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "store file changed while it was read",
      );
    }
  } catch (error) {
    operationError = error;
  }
  if (handle !== undefined) {
    try {
      await handle.close();
    } catch (error) {
      operationError ??= error;
    }
  }
  if (operationError !== undefined) {
    if (operationError instanceof CoreBoundaryError) throw operationError;
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file could not be read and closed safely",
    );
  }
  if (content === undefined) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file read produced no content",
    );
  }

  const current = await resolveProjectPath(root, path, {
    expectedType: "file",
    existence: "required",
  });
  if (
    current.targetIdentity === undefined ||
    target.targetIdentity === undefined ||
    current.targetIdentity.device !== target.targetIdentity.device ||
    current.targetIdentity.inode !== target.targetIdentity.inode
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file identity changed after read",
    );
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file is not valid UTF-8",
    );
  }
  return Object.freeze({
    text,
    digest: sha256Digest(content),
    bytes: content.byteLength,
  });
}

function parseCanonicalJson(text: string, path: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file is not valid JSON",
    );
  }
  let expected: string;
  try {
    expected = `${canonicalizeJson(parsed)}\n`;
  } catch {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file is not bounded canonical JSON",
    );
  }
  if (text !== expected) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "store file is not in the canonical persisted form",
    );
  }
  return parsed;
}

function computeHeadDigest(head: WorkflowCheckpointHeadBody): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook.workflow-checkpoint-head",
    version: "1",
    subject: head,
  });
}

function makeHead(
  checkpoint: WorkflowCheckpointRecord,
  recordDigest: Sha256Digest,
): WorkflowCheckpointHead {
  const body: WorkflowCheckpointHeadBody = {
    schemaVersion: HEAD_SCHEMA_VERSION,
    runId: checkpoint.identity.runId,
    checkpointId: checkpoint.checkpointId,
    sequence: checkpoint.sequence,
    checkpointDigest: checkpoint.checkpointDigest,
    recordDigest,
    registryDigest: checkpoint.identity.registryDigest,
    projectIdentityDigest: checkpoint.identity.projectIdentityDigest,
    updatedAt: checkpoint.updatedAt,
  };
  return Object.freeze({ ...body, headDigest: computeHeadDigest(body) });
}

function parseHead(value: unknown, path: string): WorkflowCheckpointHead {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "checkpoint head must be a plain object",
    );
  }
  const record = value as DataRecord;
  const expectedKeys = [
    "checkpointDigest",
    "checkpointId",
    "headDigest",
    "projectIdentityDigest",
    "recordDigest",
    "registryDigest",
    "runId",
    "schemaVersion",
    "sequence",
    "updatedAt",
  ].sort(compareCanonicalText);
  const actualKeys = Object.keys(record).sort(compareCanonicalText);
  const updatedAt = record["updatedAt"];
  if (
    actualKeys.length !== expectedKeys.length ||
    !actualKeys.every((key, index) => key === expectedKeys[index]) ||
    record["schemaVersion"] !== HEAD_SCHEMA_VERSION ||
    typeof record["runId"] !== "string" ||
    !UUID_PATTERN.test(record["runId"] as string) ||
    typeof record["checkpointId"] !== "string" ||
    !UUID_PATTERN.test(record["checkpointId"] as string) ||
    !Number.isSafeInteger(record["sequence"]) ||
    (record["sequence"] as number) < 0 ||
    (record["sequence"] as number) > 1_000_000 ||
    !isSha256Digest(record["checkpointDigest"]) ||
    !isSha256Digest(record["recordDigest"]) ||
    !isSha256Digest(record["registryDigest"]) ||
    !isSha256Digest(record["projectIdentityDigest"]) ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    new Date(Date.parse(updatedAt)).toISOString() !== updatedAt ||
    !isSha256Digest(record["headDigest"])
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "checkpoint head fields are invalid",
    );
  }
  const body: WorkflowCheckpointHeadBody = {
    schemaVersion: HEAD_SCHEMA_VERSION,
    runId: record["runId"] as string,
    checkpointId: record["checkpointId"] as string,
    sequence: record["sequence"] as number,
    checkpointDigest: record["checkpointDigest"] as Sha256Digest,
    recordDigest: record["recordDigest"] as Sha256Digest,
    registryDigest: record["registryDigest"] as Sha256Digest,
    projectIdentityDigest: record["projectIdentityDigest"] as Sha256Digest,
    updatedAt,
  };
  if (computeHeadDigest(body) !== record["headDigest"]) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "checkpoint head digest does not attest its body",
    );
  }
  return Object.freeze({
    ...body,
    headDigest: record["headDigest"] as Sha256Digest,
  });
}

function recordPath(checkpoint: {
  readonly identity: { readonly runId: string };
  readonly sequence: number;
  readonly checkpointDigest: Sha256Digest;
}): string {
  return `${WORKFLOW_CHECKPOINT_STORE_PATH}/${checkpoint.identity.runId}.${checkpoint.sequence}.${checkpoint.checkpointDigest.slice("sha256:".length)}.checkpoint.json`;
}

function headPath(runIdValue: string): string {
  return `${WORKFLOW_CHECKPOINT_STORE_PATH}/${runIdValue}.head.json`;
}

function checkpointFromFile(
  registry: ValidatedRegistry,
  file: SafeTextFile,
  path: string,
): WorkflowCheckpointRecord {
  const parsed = parseCanonicalJson(file.text, path);
  let checkpoint: WorkflowCheckpointRecord;
  try {
    checkpoint = validateRegisteredContractValue(
      registry,
      {
        schemaId: workflowCheckpointSchema.schemaId,
        digest: workflowCheckpointSchema.digest,
      },
      parsed,
    ) as unknown as WorkflowCheckpointRecord;
  } catch {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "checkpoint record failed its registered schema",
    );
  }
  const issues = checkWorkflowCheckpointSemantics(checkpoint);
  if (issues.length > 0) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      `checkpoint record violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return checkpoint;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function sameOptionalValue(left: unknown, right: unknown): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined && right !== undefined && sameValue(left, right))
  );
}

function sameCommand(
  left: ResolvedWorkflowCommand,
  right: ResolvedWorkflowCommand,
): boolean {
  return sameValue(left, right);
}

function assertPlanBinding(
  registry: ValidatedRegistry,
  checkpoint: WorkflowCheckpointRecord,
): ResolvedWorkflowPlan {
  if (checkpoint.identity.registryDigest !== registry.digest) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$checkpoint.identity.registryDigest",
      "checkpoint registry identity differs from the active registry",
    );
  }
  let plan: ResolvedWorkflowPlan;
  try {
    plan = resolveWorkflowPlan(
      registry,
      checkpoint.identity.workflow.id,
      checkpoint.identity.projectStage,
    );
  } catch {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$checkpoint.identity.workflow",
      "checkpoint workflow cannot be resolved by the active registry",
    );
  }
  if (
    plan.workflow.version !== checkpoint.identity.workflow.version ||
    plan.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest ||
    checkpoint.nextOrdinal > plan.steps.length
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$checkpoint.identity.workflow",
      "checkpoint workflow plan differs from the active registry",
    );
  }

  const inFlight = checkpoint.inFlight;
  if (inFlight !== undefined) {
    const step = plan.steps[inFlight.ordinal];
    const expected =
      inFlight.phase === "rollback" ? step?.rollbackCommand : step?.command;
    const matchingAttempts = checkpoint.attempts.filter(
      (attempt) =>
        attempt.ordinal === inFlight.ordinal &&
        attempt.phase === inFlight.phase,
    );
    const currentAttemptRecorded = matchingAttempts.some(
      (attempt) => attempt.attempt === inFlight.attempt,
    );
    const expectedAttempt = currentAttemptRecorded
      ? matchingAttempts.length
      : matchingAttempts.length + 1;
    if (
      step === undefined ||
      step.id !== inFlight.stepId ||
      expected === undefined ||
      !sameCommand(expected, inFlight.command) ||
      inFlight.attempt !== expectedAttempt ||
      (step.approvalCheckpoint &&
        inFlight.phase === "command" &&
        inFlight.approvalIds.length === 0)
    ) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        "$checkpoint.inFlight",
        "in-flight command does not match the resolved workflow step",
      );
    }
  }

  const attemptCounts = new Map<string, number>();
  for (const attempt of checkpoint.attempts) {
    const step = plan.steps[attempt.ordinal];
    const key = `${attempt.ordinal}\u0000${attempt.phase}`;
    const expectedAttempt = (attemptCounts.get(key) ?? 0) + 1;
    if (
      step === undefined ||
      step.id !== attempt.stepId ||
      attempt.attempt !== expectedAttempt ||
      (attempt.phase === "rollback" && step.rollbackCommand === undefined)
    ) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        "$checkpoint.attempts",
        "checkpoint attempts do not follow the resolved workflow",
      );
    }
    attemptCounts.set(key, expectedAttempt);
  }

  const currentStep = plan.steps[checkpoint.nextOrdinal];
  if (
    (checkpoint.status === "prepared" &&
      (currentStep === undefined || currentStep.approvalCheckpoint)) ||
    (checkpoint.status === "waiting-approval" &&
      (currentStep === undefined || !currentStep.approvalCheckpoint)) ||
    (checkpoint.status === "waiting-rollback" &&
      currentStep?.rollbackCommand === undefined) ||
    (checkpoint.status === "succeeded" &&
      (checkpoint.nextOrdinal !== plan.steps.length ||
        !plan.requiredEvidence.every((kind) =>
          checkpoint.evidenceKinds.includes(kind),
        )))
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpoint.status",
      "checkpoint status contradicts its workflow cursor or evidence",
    );
  }
  return plan;
}

function isSubset(left: readonly string[], right: readonly string[]): boolean {
  const rightSet = new Set(right);
  return left.every((entry) => rightSet.has(entry));
}

function decimalMicros(value: string): bigint | undefined {
  const match = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/.exec(value);
  if (match === null || match[1] === undefined) return undefined;
  return (
    BigInt(match[1]) * 1_000_000n +
    BigInt((match[2] ?? "").padEnd(6, "0"))
  );
}

function budgetNondecreasing(
  parent: WorkflowCheckpointBudgetUsage,
  child: WorkflowCheckpointBudgetUsage,
): boolean {
  const parentCost =
    parent.cost === undefined ? undefined : decimalMicros(parent.cost.amount);
  const childCost =
    child.cost === undefined ? undefined : decimalMicros(child.cost.amount);
  const costsCompatible =
    parent.cost === undefined
      ? true
      : child.cost !== undefined &&
        parent.cost.currency === child.cost.currency &&
        parentCost !== undefined &&
        childCost !== undefined &&
        childCost >= parentCost;
  return (
    child.durationMs >= parent.durationMs &&
    child.outputBytes >= parent.outputBytes &&
    child.changedFiles >= parent.changedFiles &&
    child.changedBytes >= parent.changedBytes &&
    child.repairCycles >= parent.repairCycles &&
    costsCompatible
  );
}

function inFlightWithSideEffect(
  parent: WorkflowCheckpointInFlight,
  child: WorkflowCheckpointInFlight | undefined,
  sideEffect: WorkflowCheckpointInFlight["sideEffect"],
): boolean {
  return (
    child !== undefined &&
    sameValue(
      { ...parent, sideEffect },
      child,
    )
  );
}

function expectedReadyStatus(
  plan: ResolvedWorkflowPlan,
  nextOrdinal: number,
  evidenceKinds: readonly StableId[],
): WorkflowCheckpointStatus {
  if (nextOrdinal < plan.steps.length) {
    return plan.steps[nextOrdinal]?.approvalCheckpoint
      ? "waiting-approval"
      : "prepared";
  }
  return plan.requiredEvidence.every((kind) => evidenceKinds.includes(kind))
    ? "succeeded"
    : "blocked";
}

function assertSuccessor(
  parent: WorkflowCheckpointRecord,
  child: WorkflowCheckpointRecord,
  plan: ResolvedWorkflowPlan,
  registry: ValidatedRegistry,
  parentHeadDigest: Sha256Digest,
): void {
  const immutableMatches =
    child.sequence === parent.sequence + 1 &&
    child.parentCheckpointDigest === parent.checkpointDigest &&
    child.schemaVersion === parent.schemaVersion &&
    child.checkpointId === parent.checkpointId &&
    sameValue(child.identity, parent.identity) &&
    child.createdAt === parent.createdAt &&
    child.expiresAt === parent.expiresAt &&
    child.dirtyStateDigest === parent.dirtyStateDigest &&
    child.sessionIdentityDigest === parent.sessionIdentityDigest &&
    Date.parse(child.updatedAt) >= Date.parse(parent.updatedAt) &&
    parent.attempts.every((attempt, index) =>
      sameValue(attempt, child.attempts[index]),
    );
  if (!immutableMatches) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpoint.parentCheckpointDigest",
      "checkpoint successor changed immutable identity or history",
    );
  }

  const appendedAttempts = child.attempts.length - parent.attempts.length;
  if (appendedAttempts === 0) {
    const reconciliation = child.reconciliation;
    let reconciliationPlan: ResolvedWorkflowPlan | undefined;
    if (reconciliation !== undefined) {
      try {
        reconciliationPlan = resolveWorkflowPlan(
          registry,
          WORKFLOW_RECONCILIATION_WORKFLOW_ID,
          parent.identity.projectStage,
        );
      } catch {
        reconciliationPlan = undefined;
      }
    }
    const reconciliationStep = reconciliationPlan?.steps[0];
    const targetStep = plan.steps[0];
    const reconciliationEvidence =
      reconciliation === undefined
        ? undefined
        : [...new Set([
            ...parent.evidenceKinds,
            reconciliation.proofKind,
            "run-receipt" as StableId,
            "workflow-reconciliation" as StableId,
          ])].sort(compareCanonicalText);
    const reconciliationArtifacts =
      reconciliation === undefined
        ? undefined
        : [...new Set([
            ...parent.artifactDigests,
            reconciliation.proofDigest,
          ])].sort(compareCanonicalText);
    const reconciliationOrdinal =
      reconciliation?.outcome === "succeeded"
        ? parent.nextOrdinal + 1
        : parent.nextOrdinal;
    const reconciliationStatus =
      reconciliation?.outcome === "succeeded"
        ? expectedReadyStatus(
            plan,
            reconciliationOrdinal,
            reconciliationEvidence ?? [],
          )
        : reconciliation?.outcome;
    const evidenceReconciliation =
      parent.status === "uncertain" &&
      parent.inFlight?.phase === "command" &&
      parent.inFlight.sideEffect === "uncertain" &&
      plan.steps.length === 1 &&
      parent.nextOrdinal === 0 &&
      parent.attempts.length === 0 &&
      parent.receiptChainHead === undefined &&
      parent.inFlight.ordinal === 0 &&
      parent.inFlight.stepId === targetStep?.id &&
      targetStep?.onFailure === "stop" &&
      targetStep.rollbackCommand === undefined &&
      parent.reconciliation === undefined &&
      reconciliation !== undefined &&
      reconciliation.workflowId === WORKFLOW_RECONCILIATION_WORKFLOW_ID &&
      reconciliation.targetCheckpointHeadDigest === parentHeadDigest &&
      reconciliation.resolvedPlanDigest ===
        reconciliationPlan?.resolvedPlanDigest &&
      reconciliationPlan?.steps.length === 1 &&
      reconciliationStep?.id === WORKFLOW_RECONCILIATION_STEP_ID &&
      reconciliationStep.command.id === WORKFLOW_RECONCILIATION_COMMAND_ID &&
      child.inFlight === undefined &&
      child.status === reconciliationStatus &&
      child.status === reconciliation.outcome &&
      child.nextOrdinal === reconciliationOrdinal &&
      sameValue(child.attempts, parent.attempts) &&
      sameValue(child.budgetUsage, parent.budgetUsage) &&
      sameValue(child.evidenceKinds, reconciliationEvidence) &&
      sameValue(child.artifactDigests, reconciliationArtifacts) &&
      child.receiptChainHead === parent.receiptChainHead;
    if (evidenceReconciliation) return;

    const stateDataUnchanged =
      child.nextOrdinal === parent.nextOrdinal &&
      sameValue(child.budgetUsage, parent.budgetUsage) &&
      sameValue(child.evidenceKinds, parent.evidenceKinds) &&
      sameValue(child.artifactDigests, parent.artifactDigests) &&
      child.receiptChainHead === parent.receiptChainHead &&
      sameOptionalValue(child.reconciliation, parent.reconciliation);
    const parentFlight = parent.inFlight;
    const childFlight = child.inFlight;
    const step = plan.steps[parent.nextOrdinal];
    const expectedAdmissionCommand =
      parent.status === "waiting-rollback"
        ? step?.rollbackCommand
        : step?.command;
    const admission =
      (parent.status === "prepared" ||
        parent.status === "waiting-approval" ||
        parent.status === "waiting-rollback") &&
      (child.status ===
        (parent.status === "waiting-rollback" ? "rolling-back" : "running")) &&
      childFlight !== undefined &&
      childFlight.sideEffect === "not-started" &&
      childFlight.ordinal === parent.nextOrdinal &&
      childFlight.stepId === step?.id &&
      expectedAdmissionCommand !== undefined &&
      sameCommand(childFlight.command, expectedAdmissionCommand);
    const dispatchStarted =
      (parent.status === "running" || parent.status === "rolling-back") &&
      child.status === parent.status &&
      parentFlight?.sideEffect === "not-started" &&
      inFlightWithSideEffect(parentFlight, childFlight, "started");
    const authorizationLost =
      parent.status === "running" &&
      parentFlight?.sideEffect === "not-started" &&
      child.status ===
        (step?.approvalCheckpoint ? "waiting-approval" : "prepared") &&
      childFlight === undefined;
    const rollbackAuthorizationLost =
      parent.status === "rolling-back" &&
      parentFlight?.sideEffect === "not-started" &&
      child.status === "waiting-rollback" &&
      childFlight === undefined;
    const dispatchUncertain =
      (parent.status === "running" || parent.status === "rolling-back") &&
      parentFlight?.sideEffect === "started" &&
      child.status === "uncertain" &&
      inFlightWithSideEffect(parentFlight, childFlight, "uncertain");
    const expiredWithoutStartedEffect =
      !TERMINAL_STATUSES.has(parent.status) &&
      parent.status !== "uncertain" &&
      parentFlight?.sideEffect !== "started" &&
      child.status === "expired" &&
      childFlight === undefined &&
      Date.parse(child.updatedAt) >= Date.parse(parent.expiresAt);
    if (
      !stateDataUnchanged ||
      !(
        admission ||
        dispatchStarted ||
        authorizationLost ||
        rollbackAuthorizationLost ||
        dispatchUncertain ||
        expiredWithoutStartedEffect
      )
    ) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        "$checkpoint.status",
        "checkpoint successor is not an allowed admission, dispatch, or recovery transition",
      );
    }
    return;
  }

  if (
    appendedAttempts !== 1 ||
    (parent.status !== "running" && parent.status !== "rolling-back") ||
    parent.inFlight?.sideEffect !== "started" ||
    !budgetNondecreasing(parent.budgetUsage, child.budgetUsage) ||
    !isSubset(parent.evidenceKinds, child.evidenceKinds) ||
    !isSubset(parent.artifactDigests, child.artifactDigests) ||
    !sameOptionalValue(child.reconciliation, parent.reconciliation)
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpoint.attempts",
      "settled checkpoint does not append one bounded attempt",
    );
  }
  const attempt = child.attempts.at(-1);
  const inFlight = parent.inFlight;
  if (
    attempt === undefined ||
    attempt.stepId !== inFlight.stepId ||
    attempt.ordinal !== inFlight.ordinal ||
    attempt.attempt !== inFlight.attempt ||
    attempt.phase !== inFlight.phase ||
    child.receiptChainHead !== attempt.receiptDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpoint.attempts",
      "settled attempt does not match the dispatched command",
    );
  }

  const step = plan.steps[parent.nextOrdinal];
  let expectedStatus: WorkflowCheckpointStatus;
  let expectedOrdinal = parent.nextOrdinal;
  if (attempt.outcome === "uncertain") {
    expectedStatus = "uncertain";
  } else if (attempt.phase === "rollback") {
    expectedStatus = attempt.outcome === "rolled-back" ? "failed" : "uncertain";
  } else if (
    attempt.outcome === "succeeded" ||
    attempt.outcome === "continued"
  ) {
    expectedOrdinal += 1;
    expectedStatus = expectedReadyStatus(
      plan,
      expectedOrdinal,
      child.evidenceKinds,
    );
  } else if (attempt.outcome === "cancelled") {
    expectedStatus = "cancelled";
  } else if (attempt.outcome === "blocked") {
    expectedStatus = "blocked";
  } else if (step?.onFailure === "rollback") {
    expectedStatus = "waiting-rollback";
  } else if (step?.onFailure === "blocked") {
    expectedStatus = "blocked";
  } else {
    expectedStatus = "failed";
  }
  const expectedInFlight =
    expectedStatus === "uncertain"
      ? inFlightWithSideEffect(inFlight, child.inFlight, "uncertain")
      : child.inFlight === undefined;
  if (
    child.status !== expectedStatus ||
    child.nextOrdinal !== expectedOrdinal ||
    !expectedInFlight ||
    (attempt.outcome !== "succeeded" &&
      attempt.outcome !== "rolled-back" &&
      (!sameValue(parent.evidenceKinds, child.evidenceKinds) ||
        !sameValue(parent.artifactDigests, child.artifactDigests)))
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpoint.status",
      "settled checkpoint outcome contradicts its workflow transition",
    );
  }
}

function serializePersisted(value: unknown): string {
  return `${canonicalizeJson(value)}\n`;
}

async function ensureStoreDirectory(root: CanonicalProjectRoot): Promise<void> {
  await resolveProjectPath(root, WORKFLOW_CHECKPOINT_STORE_PATH, {
    expectedType: "directory",
    existence: "required",
  });
}

async function resolveOptionalWorkflowStore(
  root: CanonicalProjectRoot,
): Promise<ResolvedProjectPath | undefined> {
  try {
    const directory = await resolveProjectPath(
      root,
      WORKFLOW_CHECKPOINT_STORE_PATH,
      { expectedType: "directory", existence: "optional" },
    );
    return directory.kind === "absent" ? undefined : directory;
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-root-drift"
    ) {
      throw storeError(
        "workflow-checkpoint-store-mismatch",
        WORKFLOW_CHECKPOINT_STORE_PATH,
        "project root changed before checkpoint storage was opened",
      );
    }
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      WORKFLOW_CHECKPOINT_STORE_PATH,
      "checkpoint storage is not an exact project-local directory",
    );
  }
}

function sameStoreDirectory(
  left: ResolvedProjectPath,
  right: ResolvedProjectPath,
): boolean {
  return (
    left.absolutePath === right.absolutePath &&
    left.targetIdentity !== undefined &&
    right.targetIdentity !== undefined &&
    left.targetIdentity.device === right.targetIdentity.device &&
    left.targetIdentity.inode === right.targetIdentity.inode
  );
}

function canonicalRecordFilename(value: string): boolean {
  const match = RECORD_FILE_PATTERN.exec(value);
  if (match === null) return false;
  const sequence = Number(match[2]);
  return Number.isSafeInteger(sequence) && sequence <= 1_000_000;
}

function queryStoreFailure(error: unknown): never {
  if (error instanceof CoreBoundaryError) throw error;
  throw storeError(
    "workflow-checkpoint-store-corrupt",
    WORKFLOW_CHECKPOINT_STORE_PATH,
    "checkpoint store inventory could not be read within its boundary",
  );
}

async function enumerateWorkflowCheckpointStore(
  absolutePath: string,
  request: NormalizedQueryRequest,
): Promise<WorkflowCheckpointStoreInventory> {
  const entries = new Set<string>();
  const headFiles: string[] = [];
  const recordFiles: string[] = [];
  let observed = 0;
  let directory: Awaited<ReturnType<typeof opendir>> | undefined;
  let failure: unknown;
  try {
    directory = await opendir(absolutePath);
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      observed += 1;
      if (observed > request.maxEntries) {
        throw storeError(
          "workflow-checkpoint-store-budget-exceeded",
          WORKFLOW_CHECKPOINT_STORE_PATH,
          "checkpoint store entry budget was exceeded",
        );
      }
      if (entries.has(entry.name)) {
        throw storeError(
          "workflow-checkpoint-store-conflict",
          WORKFLOW_CHECKPOINT_STORE_PATH,
          "checkpoint store returned a duplicate entry during inspection",
        );
      }
      entries.add(entry.name);
      if (!entry.isFile()) {
        throw storeError(
          "workflow-checkpoint-store-corrupt",
          WORKFLOW_CHECKPOINT_STORE_PATH,
          "checkpoint store entries must be regular files",
        );
      }
      if (HEAD_FILE_PATTERN.test(entry.name)) {
        headFiles.push(entry.name);
        if (headFiles.length > request.maxHeads) {
          throw storeError(
            "workflow-checkpoint-store-budget-exceeded",
            WORKFLOW_CHECKPOINT_STORE_PATH,
            "checkpoint head budget was exceeded",
          );
        }
      } else if (canonicalRecordFilename(entry.name)) {
        recordFiles.push(entry.name);
      } else {
        throw storeError(
          "workflow-checkpoint-store-corrupt",
          WORKFLOW_CHECKPOINT_STORE_PATH,
          "checkpoint store entry does not use a canonical filename",
        );
      }
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
  if (failure !== undefined) queryStoreFailure(failure);
  const sorted = (values: string[]): readonly string[] =>
    Object.freeze(values.sort(compareCanonicalText));
  return Object.freeze({
    entries: sorted([...entries]),
    headFiles: sorted(headFiles),
    recordFiles: sorted(recordFiles),
  });
}

function sameStringList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function sameInventory(
  left: WorkflowCheckpointStoreInventory,
  right: WorkflowCheckpointStoreInventory,
): boolean {
  return (
    sameStringList(left.entries, right.entries) &&
    sameStringList(left.headFiles, right.headFiles) &&
    sameStringList(left.recordFiles, right.recordFiles)
  );
}

function emptyWorkflowCheckpointQuery(
  request: NormalizedQueryRequest,
): WorkflowCheckpointHeadQuery {
  return Object.freeze({
    validationLevel: "head-and-latest-record-presence",
    rootIdentityDigest: request.root.identityDigest,
    registryDigest: request.registry.digest,
    entriesObserved: 0,
    headFilesObserved: 0,
    recordFilesObserved: 0,
    heads: Object.freeze([]),
  });
}

const EMPTY_WORKFLOW_CHECKPOINT_INVENTORY: WorkflowCheckpointStoreInventory =
  Object.freeze({
    entries: Object.freeze([]),
    headFiles: Object.freeze([]),
    recordFiles: Object.freeze([]),
  });

function retainWorkflowCheckpointQuery(
  query: WorkflowCheckpointHeadQuery,
  metadata: WorkflowCheckpointHeadQueryMetadata,
): WorkflowCheckpointHeadQuery {
  queriedHeadMetadata.set(query, Object.freeze(metadata));
  return query;
}

function assertHeadMatchesLatestCheckpoint(
  head: WorkflowCheckpointHead,
  checkpoint: WorkflowCheckpointRecord,
  recordFile: SafeTextFile,
  path: string,
): void {
  if (
    head.runId !== checkpoint.identity.runId ||
    head.checkpointId !== checkpoint.checkpointId ||
    head.sequence !== checkpoint.sequence ||
    head.checkpointDigest !== checkpoint.checkpointDigest ||
    head.recordDigest !== recordFile.digest ||
    head.registryDigest !== checkpoint.identity.registryDigest ||
    head.projectIdentityDigest !== checkpoint.identity.projectIdentityDigest ||
    head.updatedAt !== checkpoint.updatedAt
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      path,
      "checkpoint head contradicts its latest record",
    );
  }
}

function checkpointHeadSummary(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  head: WorkflowCheckpointHead,
  checkpoint: WorkflowCheckpointRecord,
): WorkflowCheckpointHeadSummary {
  const rootDigest = checkpoint.identity.projectRootIdentityDigest;
  const inFlight = checkpoint.inFlight;
  return Object.freeze({
    runId: head.runId,
    checkpointId: head.checkpointId,
    sequence: head.sequence,
    checkpointDigest: head.checkpointDigest,
    status: checkpoint.status,
    projectId: checkpoint.identity.projectId,
    projectIdentityDigest: checkpoint.identity.projectIdentityDigest,
    ...(rootDigest === undefined
      ? {}
      : { projectRootIdentityDigest: rootDigest }),
    projectAuthority:
      rootDigest === undefined
        ? "unbound"
        : rootDigest === root.identityDigest
          ? "current"
          : "foreign",
    projectStage: checkpoint.identity.projectStage,
    registryDigest: checkpoint.identity.registryDigest,
    registryAuthority:
      checkpoint.identity.registryDigest === registry.digest
        ? "current"
        : "stale",
    workflowId: checkpoint.identity.workflow.id,
    workflowVersion: checkpoint.identity.workflow.version,
    resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
    inputDigest: checkpoint.identity.inputDigest,
    ...(checkpoint.identity.featureId === undefined
      ? {}
      : {
          featureId: checkpoint.identity.featureId,
          featureContractDigest: checkpoint.identity.featureContractDigest,
        }),
    ...(checkpoint.receiptChainHead === undefined
      ? {}
      : { receiptChainHead: checkpoint.receiptChainHead }),
    ...(inFlight === undefined
      ? {}
      : {
          inFlight: Object.freeze({
            phase: inFlight.phase,
            sideEffect: inFlight.sideEffect,
          }),
        }),
    updatedAt: checkpoint.updatedAt,
    headDigest: head.headDigest,
  });
}

export async function queryWorkflowCheckpointHeads(
  value: QueryWorkflowCheckpointHeadsRequest,
): Promise<WorkflowCheckpointHeadQuery> {
  const request = normalizeQueryRequest(value);
  await assertProjectRootIdentity(request.root);
  const firstDirectory = await resolveOptionalWorkflowStore(request.root);
  if (firstDirectory === undefined) {
    const secondDirectory = await resolveOptionalWorkflowStore(request.root);
    if (secondDirectory !== undefined) {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        WORKFLOW_CHECKPOINT_STORE_PATH,
        "checkpoint store appeared during query",
      );
    }
    await assertProjectRootIdentity(request.root);
    return retainWorkflowCheckpointQuery(emptyWorkflowCheckpointQuery(request), {
      request,
      inventory: EMPTY_WORKFLOW_CHECKPOINT_INVENTORY,
      heads: new Map(),
    });
  }
  const firstInventory = await enumerateWorkflowCheckpointStore(
    firstDirectory.absolutePath,
    request,
  );
  const recordFiles = new Set(firstInventory.recordFiles);
  const summaries: WorkflowCheckpointHeadSummary[] = [];
  const witnesses = new Map<string, QueriedWorkflowCheckpointHeadWitness>();
  let totalHeadBytes = 0;
  for (const filename of firstInventory.headFiles) {
    const match = HEAD_FILE_PATTERN.exec(filename);
    const filenameRunId = match?.[1];
    if (filenameRunId === undefined) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        `${WORKFLOW_CHECKPOINT_STORE_PATH}/${filename}`,
        "checkpoint head filename is not canonical",
      );
    }
    const checkpointHeadPath = `${WORKFLOW_CHECKPOINT_STORE_PATH}/${filename}`;
    const headFile = await readProjectTextFile(
      request.root,
      checkpointHeadPath,
      WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
    );
    if (headFile === undefined) {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        checkpointHeadPath,
        "checkpoint head disappeared during query",
      );
    }
    totalHeadBytes += headFile.bytes;
    if (totalHeadBytes > request.maxTotalHeadBytes) {
      throw storeError(
        "workflow-checkpoint-store-budget-exceeded",
        WORKFLOW_CHECKPOINT_STORE_PATH,
        "aggregate checkpoint head byte budget was exceeded",
      );
    }
    const head = parseHead(
      parseCanonicalJson(headFile.text, checkpointHeadPath),
      checkpointHeadPath,
    );
    if (head.runId !== filenameRunId) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        checkpointHeadPath,
        "checkpoint head run identity differs from its filename",
      );
    }
    const latestRecordPath = recordPath({
      identity: { runId: head.runId },
      sequence: head.sequence,
      checkpointDigest: head.checkpointDigest,
    });
    const latestFilename = latestRecordPath.slice(
      `${WORKFLOW_CHECKPOINT_STORE_PATH}/`.length,
    );
    if (!recordFiles.has(latestFilename)) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        latestRecordPath,
        "checkpoint head latest record is missing from the store inventory",
      );
    }
    const recordFile = await readProjectTextFile(
      request.root,
      latestRecordPath,
      WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    );
    if (recordFile === undefined) {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        latestRecordPath,
        "checkpoint latest record disappeared during query",
      );
    }
    const checkpoint = checkpointFromFile(
      request.registry,
      recordFile,
      latestRecordPath,
    );
    assertHeadMatchesLatestCheckpoint(
      head,
      checkpoint,
      recordFile,
      checkpointHeadPath,
    );
    summaries.push(
      checkpointHeadSummary(request.root, request.registry, head, checkpoint),
    );
    witnesses.set(head.runId, {
      head,
      headFileDigest: headFile.digest,
      latestCheckpoint: checkpoint,
      recordPath: latestRecordPath,
      recordFileDigest: recordFile.digest,
    });
  }
  for (const [runId, witness] of witnesses) {
    const headFile = await readProjectTextFile(
      request.root,
      headPath(runId),
      WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
    );
    const recordFile = await readProjectTextFile(
      request.root,
      witness.recordPath,
      WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    );
    if (
      headFile?.digest !== witness.headFileDigest ||
      recordFile?.digest !== witness.recordFileDigest
    ) {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        headPath(runId),
        "checkpoint head or latest record changed during query",
      );
    }
  }
  const secondDirectory = await resolveOptionalWorkflowStore(request.root);
  if (
    secondDirectory === undefined ||
    !sameStoreDirectory(firstDirectory, secondDirectory)
  ) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      WORKFLOW_CHECKPOINT_STORE_PATH,
      "checkpoint store directory changed during query",
    );
  }
  const secondInventory = await enumerateWorkflowCheckpointStore(
    secondDirectory.absolutePath,
    request,
  );
  if (!sameInventory(firstInventory, secondInventory)) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      WORKFLOW_CHECKPOINT_STORE_PATH,
      "checkpoint store inventory changed during query",
    );
  }
  await assertProjectRootIdentity(request.root);
  const query: WorkflowCheckpointHeadQuery = Object.freeze({
    validationLevel: "head-and-latest-record-presence",
    rootIdentityDigest: request.root.identityDigest,
    registryDigest: request.registry.digest,
    entriesObserved: firstInventory.entries.length,
    headFilesObserved: firstInventory.headFiles.length,
    recordFilesObserved: firstInventory.recordFiles.length,
    heads: Object.freeze(
      summaries.sort((left, right) =>
        compareCanonicalText(left.runId, right.runId),
      ),
    ),
  });
  return retainWorkflowCheckpointQuery(query, {
    request,
    directory: firstDirectory,
    inventory: firstInventory,
    heads: witnesses,
  });
}

function normalizeQueriedLoadRequest(
  value: LoadQueriedWorkflowCheckpointRequest,
): {
  readonly metadata: WorkflowCheckpointHeadQueryMetadata;
  readonly witness: QueriedWorkflowCheckpointHeadWitness;
  readonly runId: string;
} {
  const request = dataRecord(value, "$request");
  exactKeys(request, ["query", "runId"], ["query", "runId"], "$request");
  const query = request["query"];
  if (query === null || typeof query !== "object") {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.query",
      "query must be issued by this runtime",
    );
  }
  const metadata = queriedHeadMetadata.get(query);
  if (metadata === undefined) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.query",
      "query must be issued by this runtime",
    );
  }
  const runId = request["runId"];
  if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.runId",
      "run ID must be a canonical UUID",
    );
  }
  const witness = metadata.heads.get(runId);
  if (witness === undefined) {
    throw storeError(
      "workflow-checkpoint-store-not-found",
      headPath(runId),
      "queried checkpoint run does not exist",
    );
  }
  return Object.freeze({ metadata, witness, runId });
}

async function assertWorkflowCheckpointQueryCurrent(
  metadata: WorkflowCheckpointHeadQueryMetadata,
): Promise<void> {
  const { request, directory, inventory } = metadata;
  await assertProjectRootIdentity(request.root);
  const currentDirectory = await resolveOptionalWorkflowStore(request.root);
  if (
    directory === undefined ||
    currentDirectory === undefined ||
    !sameStoreDirectory(directory, currentDirectory)
  ) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      WORKFLOW_CHECKPOINT_STORE_PATH,
      "checkpoint store directory changed after query",
    );
  }
  const currentInventory = await enumerateWorkflowCheckpointStore(
    currentDirectory.absolutePath,
    request,
  );
  if (!sameInventory(inventory, currentInventory)) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      WORKFLOW_CHECKPOINT_STORE_PATH,
      "checkpoint store inventory changed after query",
    );
  }
  for (const [runId, witness] of metadata.heads) {
    const currentHead = await readProjectTextFile(
      request.root,
      headPath(runId),
      WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
    );
    const currentRecord = await readProjectTextFile(
      request.root,
      witness.recordPath,
      WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    );
    if (
      currentHead?.digest !== witness.headFileDigest ||
      currentRecord?.digest !== witness.recordFileDigest
    ) {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        headPath(runId),
        "checkpoint query witness is stale",
      );
    }
  }
  await assertProjectRootIdentity(request.root);
}

export async function loadQueriedWorkflowCheckpoint(
  value: LoadQueriedWorkflowCheckpointRequest,
): Promise<StoredWorkflowCheckpoint> {
  const { metadata, witness, runId } = normalizeQueriedLoadRequest(value);
  const { request } = metadata;
  const checkpoint = witness.latestCheckpoint;
  if (
    witness.head.registryDigest !== request.registry.digest ||
    checkpoint.identity.registryDigest !== request.registry.digest ||
    checkpoint.identity.projectRootIdentityDigest === undefined ||
    checkpoint.identity.projectRootIdentityDigest !== request.root.identityDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      headPath(runId),
      "queried checkpoint is outside the current project or registry authority",
    );
  }
  await assertWorkflowCheckpointQueryCurrent(metadata);
  const loaded = await loadWorkflowCheckpoint({
    root: request.root,
    registry: request.registry,
    runId,
    project: {
      id: checkpoint.identity.projectId,
      identityDigest: checkpoint.identity.projectIdentityDigest,
      rootIdentityDigest: checkpoint.identity.projectRootIdentityDigest,
      stage: checkpoint.identity.projectStage,
    },
    inputDigest: checkpoint.identity.inputDigest,
    ...(checkpoint.identity.featureId === undefined
      ? {}
      : {
          feature: {
            id: checkpoint.identity.featureId,
            contractDigest:
              checkpoint.identity.featureContractDigest as Sha256Digest,
          },
        }),
    ...(checkpoint.dirtyStateDigest === undefined
      ? {}
      : { dirtyStateDigest: checkpoint.dirtyStateDigest }),
    ...(checkpoint.sessionIdentityDigest === undefined
      ? {}
      : { sessionIdentityDigest: checkpoint.sessionIdentityDigest }),
  });
  if (loaded.headDigest !== witness.head.headDigest) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      headPath(runId),
      "checkpoint head advanced beyond the queried witness",
    );
  }
  await assertWorkflowCheckpointQueryCurrent(metadata);
  return loaded;
}

export async function loadQueriedWorkflowCheckpointChain(
  value: LoadQueriedWorkflowCheckpointRequest,
): Promise<LoadedWorkflowCheckpointChain> {
  const stored = await loadQueriedWorkflowCheckpoint(value);
  const metadata = storedMetadata.get(stored);
  const checkpoints = metadata?.checkpoints;
  if (
    checkpoints === undefined ||
    checkpoints.length !== stored.chainLength ||
    checkpoints.at(-1)?.checkpointDigest !==
      stored.checkpoint.checkpointDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      "$checkpointChain",
      "validated checkpoint chain metadata is unavailable or inconsistent",
    );
  }
  return Object.freeze({ stored, checkpoints });
}

async function writeImmutableRecord(
  root: CanonicalProjectRoot,
  path: string,
  content: string,
): Promise<SafeTextFile> {
  const desiredDigest = sha256Digest(content);
  const existing = await readProjectTextFile(
    root,
    path,
    WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
  );
  if (existing !== undefined) {
    if (existing.digest === desiredDigest && existing.text === content) {
      return existing;
    }
    throw storeError(
      "workflow-checkpoint-store-conflict",
      path,
      "immutable checkpoint record path already contains different bytes",
    );
  }
  try {
    await writeProjectFileCas({
      root,
      path,
      content,
      expected: { mode: "absent" },
      maxBytes: WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    });
  } catch (error) {
    const current = await readProjectTextFile(
      root,
      path,
      WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    );
    if (
      current !== undefined &&
      current.digest === desiredDigest &&
      current.text === content
    ) {
      return current;
    }
    if (error instanceof CoreBoundaryError && error.code === "cas-precondition-failed") {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        path,
        "another writer claimed the immutable checkpoint record",
      );
    }
    throw storeError(
      "workflow-checkpoint-store-write-failed",
      path,
      "checkpoint record write could not be proven",
      error instanceof CoreBoundaryError && error.mutationUncertain,
    );
  }
  const written = await readProjectTextFile(
    root,
    path,
    WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
  );
  if (
    written === undefined ||
    written.digest !== desiredDigest ||
    written.text !== content
  ) {
    throw storeError(
      "workflow-checkpoint-store-write-failed",
      path,
      "checkpoint record postcondition is uncertain",
      true,
    );
  }
  return written;
}

async function writeHead(
  root: CanonicalProjectRoot,
  path: string,
  content: string,
  expected: { readonly mode: "absent" } | {
    readonly mode: "digest";
    readonly digest: Sha256Digest;
  },
): Promise<SafeTextFile> {
  const desiredDigest = sha256Digest(content);
  try {
    await writeProjectFileCas({
      root,
      path,
      content,
      expected,
      maxBytes: WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
    });
  } catch (error) {
    const current = await readProjectTextFile(
      root,
      path,
      WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
    );
    if (
      current !== undefined &&
      current.digest === desiredDigest &&
      current.text === content
    ) {
      return current;
    }
    if (error instanceof CoreBoundaryError && error.code === "cas-precondition-failed") {
      throw storeError(
        "workflow-checkpoint-store-conflict",
        path,
        "checkpoint head changed before the CAS update",
      );
    }
    throw storeError(
      "workflow-checkpoint-store-write-failed",
      path,
      "checkpoint head update could not be proven",
      error instanceof CoreBoundaryError && error.mutationUncertain,
    );
  }
  const written = await readProjectTextFile(
    root,
    path,
    WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
  );
  if (
    written === undefined ||
    written.digest !== desiredDigest ||
    written.text !== content
  ) {
    throw storeError(
      "workflow-checkpoint-store-write-failed",
      path,
      "checkpoint head postcondition is uncertain",
      true,
    );
  }
  return written;
}

function makeStored(
  root: CanonicalProjectRoot,
  checkpoint: WorkflowCheckpointRecord,
  head: WorkflowCheckpointHead,
  headFileDigest: Sha256Digest,
  recordFileDigest: Sha256Digest,
  checkpoints?: readonly WorkflowCheckpointRecord[],
): StoredWorkflowCheckpoint {
  const stored: StoredWorkflowCheckpoint = Object.freeze({
    rootIdentityDigest: root.identityDigest,
    headDigest: head.headDigest,
    chainLength: checkpoint.sequence + 1,
    checkpoint,
  });
  storedMetadata.set(stored, {
    root,
    head,
    headFileDigest,
    recordFileDigest,
    ...(checkpoints === undefined
      ? {}
      : { checkpoints: Object.freeze([...checkpoints]) }),
  });
  return stored;
}

function storedHandle(value: unknown): {
  readonly stored: StoredWorkflowCheckpoint;
  readonly metadata: StoredMetadata;
} {
  if (value === null || typeof value !== "object") {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.stored",
      "stored checkpoint must be a same-process handle",
    );
  }
  const metadata = storedMetadata.get(value);
  if (metadata === undefined) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.stored",
      "stored checkpoint must be a same-process handle",
    );
  }
  return { stored: value as StoredWorkflowCheckpoint, metadata };
}

export async function persistWorkflowCheckpoint(
  value: PersistWorkflowCheckpointRequest,
): Promise<StoredWorkflowCheckpoint> {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["root", "registry", "checkpoint", "previous"],
    ["root", "registry", "checkpoint"],
    "$request",
  );
  assertRegistry(record["registry"]);
  await assertProjectRootIdentity(value.root);
  await ensureStoreDirectory(value.root);
  const checkpoint = assertWorkflowCheckpointRuntimeInstance(
    record["checkpoint"],
  );
  if (
    checkpoint.identity.projectRootIdentityDigest !== undefined &&
    checkpoint.identity.projectRootIdentityDigest !== value.root.identityDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$request.checkpoint.identity.projectRootIdentityDigest",
      "checkpoint root identity differs from the bound project root",
    );
  }
  const plan = assertPlanBinding(value.registry, checkpoint);
  const checkpointText = serializePersisted(checkpoint);
  if (Buffer.byteLength(checkpointText, "utf8") > WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.checkpoint",
      "checkpoint exceeds the durable record byte limit",
    );
  }

  let previous: StoredWorkflowCheckpoint | undefined;
  let previousMetadata: StoredMetadata | undefined;
  if (record["previous"] !== undefined) {
    const bound = storedHandle(record["previous"]);
    previous = bound.stored;
    previousMetadata = bound.metadata;
    if (previousMetadata.root.identityDigest !== value.root.identityDigest) {
      throw storeError(
        "workflow-checkpoint-store-mismatch",
        "$request.previous.rootIdentityDigest",
        "previous checkpoint belongs to a different project root",
      );
    }
    const priorSuccessor = persistedSuccessors.get(previous);
    if (priorSuccessor !== undefined) {
      if (
        priorSuccessor.checkpoint.checkpointDigest ===
        checkpoint.checkpointDigest
      ) {
        return priorSuccessor;
      }
      throw storeError(
        "workflow-checkpoint-store-conflict",
        "$request.previous",
        "previous checkpoint already has a different persisted successor",
      );
    }
  }
  if (
    (checkpoint.sequence === 0 && previous !== undefined) ||
    (checkpoint.sequence > 0 && previous === undefined)
  ) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.previous",
      "only the initial checkpoint may omit its persisted parent handle",
    );
  }
  if (previous !== undefined) {
    assertSuccessor(
      previous.checkpoint,
      checkpoint,
      plan,
      value.registry,
      previous.headDigest,
    );
  }

  const checkpointPath = recordPath(checkpoint);
  const checkpointFile = await writeImmutableRecord(
    value.root,
    checkpointPath,
    checkpointText,
  );
  const head = makeHead(checkpoint, checkpointFile.digest);
  const headText = serializePersisted(head);
  const checkpointHeadPath = headPath(checkpoint.identity.runId);
  const currentHeadFile = await readProjectTextFile(
    value.root,
    checkpointHeadPath,
    WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
  );
  if (previousMetadata === undefined) {
    if (currentHeadFile !== undefined) {
      if (currentHeadFile.text === headText) {
        return makeStored(
          value.root,
          checkpoint,
          head,
          currentHeadFile.digest,
          checkpointFile.digest,
        );
      }
      throw storeError(
        "workflow-checkpoint-store-conflict",
        checkpointHeadPath,
        "run already has a different checkpoint head",
      );
    }
  } else if (
    currentHeadFile === undefined ||
    currentHeadFile.digest !== previousMetadata.headFileDigest
  ) {
    if (currentHeadFile?.text === headText) {
      const idempotent = makeStored(
        value.root,
        checkpoint,
        head,
        currentHeadFile.digest,
        checkpointFile.digest,
      );
      if (previous !== undefined) persistedSuccessors.set(previous, idempotent);
      return idempotent;
    }
    throw storeError(
      "workflow-checkpoint-store-conflict",
      checkpointHeadPath,
      "persisted parent is no longer the current checkpoint head",
    );
  }

  const writtenHead = await writeHead(
    value.root,
    checkpointHeadPath,
    headText,
    previousMetadata === undefined
      ? { mode: "absent" }
      : { mode: "digest", digest: previousMetadata.headFileDigest },
  );
  const stored = makeStored(
    value.root,
    checkpoint,
    head,
    writtenHead.digest,
    checkpointFile.digest,
  );
  if (previous !== undefined) persistedSuccessors.set(previous, stored);
  return stored;
}

interface NormalizedLoadRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly runId: string;
  readonly project: WorkflowCheckpointProject;
  readonly inputDigest: Sha256Digest;
  readonly feature?: WorkflowCheckpointFeature;
  readonly dirtyStateDigest?: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
}

function normalizeLoadRequest(
  value: LoadWorkflowCheckpointRequest,
): NormalizedLoadRequest {
  const record = dataRecord(value, "$request");
  const required = ["root", "registry", "runId", "project", "inputDigest"];
  exactKeys(
    record,
    [
      ...required,
      "feature",
      "dirtyStateDigest",
      "sessionIdentityDigest",
      "now",
    ],
    required,
    "$request",
  );
  assertRegistry(record["registry"]);
  if (typeof record["runId"] !== "string" || !UUID_PATTERN.test(record["runId"])) {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.runId",
      "expected a canonical UUID",
    );
  }
  if (record["now"] !== undefined) readClock(record["now"]);
  return {
    root: value.root,
    registry: value.registry,
    runId: record["runId"],
    project: projectBinding(record["project"]),
    inputDigest: digest(record["inputDigest"], "$request.inputDigest"),
    ...(record["feature"] === undefined
      ? {}
      : { feature: featureBinding(record["feature"]) as WorkflowCheckpointFeature }),
    ...(record["dirtyStateDigest"] === undefined
      ? {}
      : {
          dirtyStateDigest: digest(
            record["dirtyStateDigest"],
            "$request.dirtyStateDigest",
          ),
        }),
    ...(record["sessionIdentityDigest"] === undefined
      ? {}
      : {
          sessionIdentityDigest: digest(
            record["sessionIdentityDigest"],
            "$request.sessionIdentityDigest",
          ),
        }),
  };
}

function assertExpectedIdentity(
  request: NormalizedLoadRequest,
  checkpoint: WorkflowCheckpointRecord,
): void {
  const expectedFeatureId = request.feature?.id;
  const expectedFeatureDigest = request.feature?.contractDigest;
  if (
    checkpoint.identity.runId !== request.runId ||
    checkpoint.identity.projectId !== request.project.id ||
    checkpoint.identity.projectIdentityDigest !==
      request.project.identityDigest ||
    checkpoint.identity.projectRootIdentityDigest !==
      request.project.rootIdentityDigest ||
    checkpoint.identity.projectStage !== request.project.stage ||
    checkpoint.identity.inputDigest !== request.inputDigest ||
    checkpoint.identity.featureId !== expectedFeatureId ||
    checkpoint.identity.featureContractDigest !== expectedFeatureDigest ||
    checkpoint.dirtyStateDigest !== request.dirtyStateDigest ||
    checkpoint.sessionIdentityDigest !== request.sessionIdentityDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$request",
      "stored checkpoint identity differs from the requested run binding",
    );
  }
}

export async function loadWorkflowCheckpoint(
  value: LoadWorkflowCheckpointRequest,
): Promise<StoredWorkflowCheckpoint> {
  const request = normalizeLoadRequest(value);
  await assertProjectRootIdentity(request.root);
  await ensureStoreDirectory(request.root);
  const checkpointHeadPath = headPath(request.runId);
  const headFile = await readProjectTextFile(
    request.root,
    checkpointHeadPath,
    WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
  );
  if (headFile === undefined) {
    throw storeError(
      "workflow-checkpoint-store-not-found",
      checkpointHeadPath,
      "workflow checkpoint head does not exist",
    );
  }
  const head = parseHead(
    parseCanonicalJson(headFile.text, checkpointHeadPath),
    checkpointHeadPath,
  );
  if (
    head.runId !== request.runId ||
    head.registryDigest !== request.registry.digest ||
    head.projectIdentityDigest !== request.project.identityDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      checkpointHeadPath,
      "workflow checkpoint head differs from the requested run authority",
    );
  }
  if (head.sequence + 1 > WORKFLOW_CHECKPOINT_MAX_CHAIN_LENGTH) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      checkpointHeadPath,
      "checkpoint chain exceeds its fixed record count limit",
    );
  }

  let totalBytes = headFile.bytes;
  let expectedSequence = head.sequence;
  let expectedDigest = head.checkpointDigest;
  let child: WorkflowCheckpointRecord | undefined;
  let current: WorkflowCheckpointRecord | undefined;
  let headRecordFileDigest: Sha256Digest | undefined;
  const checkpointsNewestFirst: WorkflowCheckpointRecord[] = [];
  const visited = new Set<Sha256Digest>();
  while (expectedSequence >= 0) {
    if (visited.has(expectedDigest)) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        checkpointHeadPath,
        "checkpoint parent chain contains a digest cycle",
      );
    }
    visited.add(expectedDigest);
    const path = recordPath({
      identity: { runId: request.runId },
      sequence: expectedSequence,
      checkpointDigest: expectedDigest,
    });
    const file = await readProjectTextFile(
      request.root,
      path,
      WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
    );
    if (file === undefined) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "checkpoint parent-chain record is missing",
      );
    }
    totalBytes += file.bytes;
    if (totalBytes > WORKFLOW_CHECKPOINT_MAX_CHAIN_BYTES) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "checkpoint chain exceeds its fixed total byte limit",
      );
    }
    current = checkpointFromFile(request.registry, file, path);
    if (
      current.identity.runId !== request.runId ||
      current.sequence !== expectedSequence ||
      current.checkpointDigest !== expectedDigest
    ) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "checkpoint record identity differs from its immutable file name",
      );
    }
    const plan = assertPlanBinding(request.registry, current);
    checkpointsNewestFirst.push(current);
    if (child !== undefined) {
      assertSuccessor(
        current,
        child,
        plan,
        request.registry,
        makeHead(current, file.digest).headDigest,
      );
    }
    if (expectedSequence === head.sequence) {
      headRecordFileDigest = file.digest;
      if (
        current.checkpointId !== head.checkpointId ||
        current.updatedAt !== head.updatedAt ||
        file.digest !== head.recordDigest
      ) {
        throw storeError(
          "workflow-checkpoint-store-corrupt",
          path,
          "checkpoint head does not match its current record",
        );
      }
    }
    child = current;
    if (expectedSequence === 0) {
      if (current.parentCheckpointDigest !== undefined) {
        throw storeError(
          "workflow-checkpoint-store-corrupt",
          path,
          "initial checkpoint unexpectedly names a parent",
        );
      }
      break;
    }
    if (current.parentCheckpointDigest === undefined) {
      throw storeError(
        "workflow-checkpoint-store-corrupt",
        path,
        "checkpoint parent digest is missing",
      );
    }
    expectedDigest = current.parentCheckpointDigest;
    expectedSequence -= 1;
  }
  if (child === undefined || current === undefined || headRecordFileDigest === undefined) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      checkpointHeadPath,
      "checkpoint chain did not produce a current record",
    );
  }

  const currentRecordPath = recordPath({
    identity: { runId: request.runId },
    sequence: head.sequence,
    checkpointDigest: head.checkpointDigest,
  });
  const currentRecordFile = await readProjectTextFile(
    request.root,
    currentRecordPath,
    WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
  );
  const currentHeadFile = await readProjectTextFile(
    request.root,
    checkpointHeadPath,
    WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
  );
  if (
    currentRecordFile === undefined ||
    currentRecordFile.digest !== headRecordFileDigest ||
    currentHeadFile === undefined ||
    currentHeadFile.digest !== headFile.digest
  ) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      checkpointHeadPath,
      "checkpoint head or current record changed during chain validation",
    );
  }
  const headCheckpoint = checkpointFromFile(
    request.registry,
    currentRecordFile,
    currentRecordPath,
  );
  assertExpectedIdentity(request, headCheckpoint);
  const checkpoints = checkpointsNewestFirst.reverse();
  checkpoints[checkpoints.length - 1] = headCheckpoint;
  if (
    checkpoints.length !== head.sequence + 1 ||
    checkpoints.at(-1)?.checkpointDigest !== head.checkpointDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-corrupt",
      checkpointHeadPath,
      "validated checkpoint chain length or head is inconsistent",
    );
  }
  return makeStored(
    request.root,
    headCheckpoint,
    head,
    headFile.digest,
    currentRecordFile.digest,
    checkpoints,
  );
}

function resumeResult(
  disposition: WorkflowCheckpointResumeDisposition,
  recoveryPersisted: boolean,
  stored: StoredWorkflowCheckpoint,
): WorkflowCheckpointResumeResult {
  return Object.freeze({
    disposition,
    recoveryPersisted,
    stored,
    checkpoint: stored.checkpoint,
  });
}

export async function resumeWorkflowCheckpoint(
  value: ResumeWorkflowCheckpointRequest,
): Promise<WorkflowCheckpointResumeResult> {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    ["registry", "stored", "policy", "now"],
    ["registry", "stored", "policy"],
    "$request",
  );
  assertRegistry(record["registry"]);
  if (record["policy"] !== "never" && record["policy"] !== "safe") {
    throw storeError(
      "invalid-workflow-checkpoint-store-request",
      "$request.policy",
      "resume policy must be never or safe",
    );
  }
  const currentTime = readClock(record["now"] ?? Date.now);
  const { stored, metadata } = storedHandle(record["stored"]);
  if (
    stored.rootIdentityDigest !== metadata.root.identityDigest ||
    stored.headDigest !== metadata.head.headDigest ||
    stored.checkpoint.checkpointDigest !== metadata.head.checkpointDigest ||
    stored.checkpoint.identity.registryDigest !== value.registry.digest
  ) {
    throw storeError(
      "workflow-checkpoint-store-mismatch",
      "$request.stored",
      "stored checkpoint handle differs from its bound authority",
    );
  }
  const currentHead = await readProjectTextFile(
    metadata.root,
    headPath(stored.checkpoint.identity.runId),
    WORKFLOW_CHECKPOINT_MAX_HEAD_BYTES,
  );
  const currentRecord = await readProjectTextFile(
    metadata.root,
    recordPath(stored.checkpoint),
    WORKFLOW_CHECKPOINT_MAX_RECORD_BYTES,
  );
  if (
    currentHead === undefined ||
    currentHead.digest !== metadata.headFileDigest ||
    currentRecord === undefined ||
    currentRecord.digest !== metadata.recordFileDigest
  ) {
    throw storeError(
      "workflow-checkpoint-store-conflict",
      "$request.stored",
      "stored checkpoint is no longer the current durable head",
    );
  }
  assertPlanBinding(value.registry, stored.checkpoint);

  const checkpoint = stored.checkpoint;
  if (TERMINAL_STATUSES.has(checkpoint.status)) {
    return resumeResult("terminal", false, stored);
  }
  if (record["policy"] === "never") {
    throw storeError(
      "workflow-checkpoint-resume-unsafe",
      "$request.policy",
      "nonterminal checkpoint hydration is disabled by policy",
    );
  }
  if (checkpoint.status === "uncertain") {
    retainHydratedWorkflowCheckpoint(checkpoint);
    return resumeResult("reconciliation-required", false, stored);
  }

  const expired = currentTime >= Date.parse(checkpoint.expiresAt);
  const requiresRecovery =
    expired || checkpoint.status === "running" || checkpoint.status === "rolling-back";
  if (requiresRecovery) {
    const hydrated = retainHydratedWorkflowCheckpoint(checkpoint);
    const recovered = recoverHydratedWorkflowCheckpoint(
      value.registry,
      hydrated,
      currentTime,
    );
    const persisted = await persistWorkflowCheckpoint({
      root: metadata.root,
      registry: value.registry,
      checkpoint: recovered,
      previous: stored,
    });
    return resumeResult(
      recovered.status === "uncertain"
        ? "reconciliation-required"
        : TERMINAL_STATUSES.has(recovered.status)
          ? "terminal"
          : "ready-for-authorization",
      true,
      persisted,
    );
  }
  if (checkpoint.status === "waiting-restart") {
    return resumeResult("restart-required", false, stored);
  }
  retainHydratedWorkflowCheckpoint(checkpoint);
  return resumeResult("ready-for-authorization", false, stored);
}
