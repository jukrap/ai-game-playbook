import { compareCanonicalText } from "./canonical-json.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type {
  ExecutionBudgets,
  ProjectStage,
} from "./contract-vocabulary.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import type {
  InitPlanTargetAction,
  InitPlanTargetContent,
  InitPlanTargetKind,
  InitPlanTargetPolicy,
} from "./init-contracts.js";
import { PROJECT_INITIALIZATION_TARGET_DEFINITIONS } from "./init-contracts.js";
import {
  isPortableProjectPath,
  type PortableProjectPath,
} from "./portable-path.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const PROJECT_INITIALIZATION_COMMAND_ID = "project.initialize" as const;
export const PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT: number =
  PROJECT_INITIALIZATION_TARGET_DEFINITIONS.length;
export const PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES: number =
  1024 * 1024;
export const PROJECT_INITIALIZATION_COMMAND_MAX_PROJECT_BYTES: number =
  3 * PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES;
export const PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES: number =
  2 * PROJECT_INITIALIZATION_COMMAND_MAX_PROJECT_BYTES;
export const PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS: number = 30_000;
export const PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES: number =
  1024 * 1024;
export const PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES: number =
  32;
export const PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_BYTES: number =
  8 * 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PROJECT_STAGES = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const TARGET_KINDS = new Set<InitPlanTargetKind>(["directory", "file"]);
const TARGET_POLICIES = new Set<InitPlanTargetPolicy>([
  "committed",
  "local-only",
]);
const TARGET_CONTENTS = new Set<InitPlanTargetContent>([
  "none",
  "project-profile",
  "pack-lock",
  "ignore-policy",
]);
const TARGET_ACTIONS = new Set<InitPlanTargetAction>(["create", "retain"]);
const CONTROL_STATE_DIRECTORY_PATHS = new Set<string>([
  ".ai-game-playbook",
  ".ai-game-playbook/evidence",
  ".ai-game-playbook/evidence/artifacts",
  ".ai-game-playbook/evidence/artifacts/manifests",
  ".ai-game-playbook/evidence/artifacts/objects",
  ".ai-game-playbook/evidence/receipts",
  ".ai-game-playbook/locks",
  ".ai-game-playbook/state",
  ".ai-game-playbook/state/packs",
  ".ai-game-playbook/state/packs/transactions",
  ".ai-game-playbook/state/workflows",
]);

type DataRecord = Record<string, unknown>;

export interface ProjectInitializationCommandTarget {
  readonly path: PortableProjectPath;
  readonly kind: InitPlanTargetKind;
  readonly policy: InitPlanTargetPolicy;
  readonly content: InitPlanTargetContent;
  readonly action: Exclude<InitPlanTargetAction, "conflict">;
  readonly code: StableId;
  readonly desiredDigest?: Sha256Digest;
  readonly desiredBytes?: number;
}

export interface ProjectInitializationPreparedPlanDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "ready";
  readonly runId: string;
  readonly registryDigest: Sha256Digest;
  readonly initPlanDigest: Sha256Digest;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly stage: ProjectStage;
  };
  readonly profileDigest: Sha256Digest;
  readonly packLockDigest: Sha256Digest;
  readonly targets: readonly ProjectInitializationCommandTarget[];
  readonly conflicts: readonly [];
  readonly summary: {
    readonly create: number;
    readonly retain: number;
    readonly conflict: 0;
  };
  readonly budgets: ExecutionBudgets;
}

export interface ProjectInitializationCommandInput
  extends ProjectInitializationPreparedPlanDigestInput {
  readonly preparedPlanDigest: Sha256Digest;
}

export type ProjectInitializationExecutionStatus =
  | "failed"
  | "recovery-required"
  | "rolled-back"
  | "succeeded";

export interface ProjectInitializationExecutionEffects {
  readonly changedPaths: readonly PortableProjectPath[];
  readonly changedBytes: number;
  readonly appliedPaths: readonly PortableProjectPath[];
  readonly rolledBackPaths: readonly PortableProjectPath[];
  readonly controlPlaneState: {
    readonly changedPaths: readonly PortableProjectPath[];
    readonly changedFiles: number;
    readonly changedBytes: number;
  };
}

export interface ProjectInitializationAuthorizationSettlement {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status: "failed" | "succeeded" | "uncertain";
  readonly mutationUncertain: boolean;
  readonly violations: readonly StableId[];
  readonly approvalIds: readonly StableId[];
  readonly settledAt: string;
}

export interface ProjectInitializationReceiptPointer {
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
}

export interface ProjectInitializationCheckpointPointer {
  readonly checkpointId: string;
  readonly checkpointDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly sequence: number;
}

export interface ProjectInitializationReportError {
  readonly code: StableId;
  readonly at: StableId;
}

export interface ProjectInitializationReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: typeof PROJECT_INITIALIZATION_COMMAND_ID;
  readonly runId: string;
  readonly registryDigest: Sha256Digest;
  readonly project: ProjectInitializationPreparedPlanDigestInput["project"];
  readonly initPlanDigest: Sha256Digest;
  readonly preparedPlanDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly packLockDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly status: ProjectInitializationExecutionStatus;
  readonly code: StableId;
  readonly mutationAttempted: boolean;
  readonly mutationUncertain: boolean;
  readonly effects: ProjectInitializationExecutionEffects;
  readonly timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly authorization: ProjectInitializationAuthorizationSettlement;
  readonly evidence: {
    readonly receipt: ProjectInitializationReceiptPointer;
    readonly checkpoint: ProjectInitializationCheckpointPointer;
    readonly activeMarker:
      | { readonly status: "cleared" }
      | { readonly status: "retained"; readonly digest: Sha256Digest };
  };
  readonly error?: ProjectInitializationReportError;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly editorControlPerformed: false;
}

export interface ProjectInitializationReport
  extends ProjectInitializationReportDigestInput {
  readonly reportDigest: Sha256Digest;
}

function dataRecord(value: unknown, message: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
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

function dataArray(value: unknown, message: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);
  const expectedNames = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ];
  if (
    names.length !== expectedNames.length ||
    !expectedNames.every((name) => names.includes(name)) ||
    expectedNames.slice(0, -1).some((name) => {
      const descriptor = descriptors[name];
      return (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    })
  ) {
    throw new TypeError(message);
  }
  return value;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  message = "project initialization fields are not exact",
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new TypeError(message);
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function canonicalStableIds(
  value: unknown,
  minimum: number,
  maximum: number,
): readonly StableId[] {
  const values = dataArray(value, "project initialization stable IDs are invalid");
  if (
    values.length < minimum ||
    values.length > maximum ||
    values.some((entry) => !isStableId(entry)) ||
    values.some(
      (entry, index) =>
        index > 0 &&
        compareCanonicalText(values[index - 1] as string, entry as string) >= 0,
    )
  ) {
    throw new TypeError("project initialization stable IDs are not canonical");
  }
  return values as readonly StableId[];
}

function portablePaths(
  value: unknown,
  maximum: number,
  message: string,
): readonly PortableProjectPath[] {
  const values = dataArray(value, message);
  if (
    values.length > maximum ||
    values.some((entry) => !isPortableProjectPath(entry)) ||
    new Set(values).size !== values.length
  ) {
    throw new TypeError(message);
  }
  return values as readonly PortableProjectPath[];
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function isProjectInitializationControlStatePath(path: string): boolean {
  return (
    CONTROL_STATE_DIRECTORY_PATHS.has(path) ||
    path.startsWith(".ai-game-playbook/evidence/receipts/") ||
    path.startsWith(".ai-game-playbook/state/workflows/")
  );
}

function validateProject(value: unknown): ProjectInitializationPreparedPlanDigestInput["project"] {
  const project = dataRecord(value, "project initialization project binding is invalid");
  exactKeys(
    project,
    ["id", "identityDigest", "rootIdentityDigest", "stage"],
    [],
    "project initialization project binding is invalid",
  );
  if (
    !isStableId(project["id"]) ||
    !isSha256Digest(project["identityDigest"]) ||
    !isSha256Digest(project["rootIdentityDigest"]) ||
    !PROJECT_STAGES.has(project["stage"] as ProjectStage)
  ) {
    throw new TypeError("project initialization project binding is invalid");
  }
  return project as unknown as ProjectInitializationPreparedPlanDigestInput["project"];
}

function validateTarget(
  value: unknown,
  index: number,
): ProjectInitializationCommandTarget {
  const target = dataRecord(value, "project initialization target is invalid");
  exactKeys(
    target,
    ["path", "kind", "policy", "content", "action", "code"],
    ["desiredDigest", "desiredBytes"],
    "project initialization target fields are invalid",
  );
  const kind = target["kind"] as InitPlanTargetKind;
  const content = target["content"] as InitPlanTargetContent;
  if (
    !isPortableProjectPath(target["path"]) ||
    !TARGET_KINDS.has(kind) ||
    !TARGET_POLICIES.has(target["policy"] as InitPlanTargetPolicy) ||
    !TARGET_CONTENTS.has(content) ||
    !TARGET_ACTIONS.has(target["action"] as InitPlanTargetAction) ||
    !isStableId(target["code"])
  ) {
    throw new TypeError(`project initialization target ${index} is invalid`);
  }
  const hasDigest = Object.hasOwn(target, "desiredDigest");
  const hasBytes = Object.hasOwn(target, "desiredBytes");
  if (
    (kind === "directory" &&
      (content !== "none" || hasDigest || hasBytes)) ||
    (kind === "file" &&
      (content === "none" ||
        !hasDigest ||
        !hasBytes ||
        !isSha256Digest(target["desiredDigest"]) ||
        !boundedInteger(
          target["desiredBytes"],
          1,
          PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
        )))
  ) {
    throw new TypeError(`project initialization target ${index} content is invalid`);
  }
  return target as unknown as ProjectInitializationCommandTarget;
}

function validateBudgets(value: unknown, createCount: number, createBytes: number): ExecutionBudgets {
  const budgets = dataRecord(value, "project initialization budget is invalid");
  exactKeys(
    budgets,
    [
      "maxChangedFiles",
      "maxChangedBytes",
      "maxDurationMs",
      "maxOutputBytes",
      "maxRepairCycles",
    ],
    [],
    "project initialization budget is invalid",
  );
  if (
    budgets["maxChangedFiles"] !== createCount ||
    budgets["maxChangedBytes"] !== createBytes * 2 ||
    budgets["maxDurationMs"] !==
      PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS ||
    budgets["maxOutputBytes"] !==
      PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES ||
    budgets["maxRepairCycles"] !== 0
  ) {
    throw new TypeError("project initialization budget is not exact");
  }
  return budgets as unknown as ExecutionBudgets;
}

function validatePreparedPlanBody(
  value: unknown,
): ProjectInitializationPreparedPlanDigestInput {
  const body = dataRecord(value, "project initialization command input is invalid");
  exactKeys(body, [
    "schemaVersion",
    "disposition",
    "runId",
    "registryDigest",
    "initPlanDigest",
    "project",
    "profileDigest",
    "packLockDigest",
    "targets",
    "conflicts",
    "summary",
    "budgets",
  ]);
  if (
    body["schemaVersion"] !== "1.0.0" ||
    body["disposition"] !== "ready" ||
    typeof body["runId"] !== "string" ||
    !UUID_PATTERN.test(body["runId"]) ||
    !isSha256Digest(body["registryDigest"]) ||
    !isSha256Digest(body["initPlanDigest"]) ||
    !isSha256Digest(body["profileDigest"]) ||
    !isSha256Digest(body["packLockDigest"])
  ) {
    throw new TypeError("project initialization command input must be ready and identity-bound");
  }
  validateProject(body["project"]);
  const targetValues = dataArray(
    body["targets"],
    "project initialization target collection is invalid",
  );
  if (targetValues.length !== PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT) {
    throw new TypeError("project initialization target count is invalid");
  }
  const targets = targetValues.map(validateTarget);
  const paths = new Map<string, ProjectInitializationCommandTarget>();
  const contentCounts = new Map<InitPlanTargetContent, number>();
  for (const [index, target] of targets.entries()) {
    const expected = PROJECT_INITIALIZATION_TARGET_DEFINITIONS[index];
    if (paths.has(target.path)) {
      throw new TypeError("project initialization target path is duplicated");
    }
    if (
      expected === undefined ||
      target.path !== expected.path ||
      target.kind !== expected.kind ||
      target.policy !== expected.policy ||
      target.content !== expected.content
    ) {
      throw new TypeError("project initialization target layout is invalid");
    }
    const parentPathValue = parentPath(target.path);
    if (parentPathValue !== ".") {
      const parent = paths.get(parentPathValue);
      if (parent === undefined || parent.kind !== "directory") {
        throw new TypeError(
          "project initialization target parent must appear first",
        );
      }
    }
    paths.set(target.path, target);
    contentCounts.set(target.content, (contentCounts.get(target.content) ?? 0) + 1);
  }
  if (
    contentCounts.get("project-profile") !== 1 ||
    contentCounts.get("pack-lock") !== 1 ||
    contentCounts.get("ignore-policy") !== 1 ||
    (contentCounts.get("none") ?? 0) !==
      PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT - 3
  ) {
    throw new TypeError("project initialization metadata targets are invalid");
  }
  const conflicts = dataArray(
    body["conflicts"],
    "project initialization conflicts are invalid",
  );
  if (conflicts.length !== 0) {
    throw new TypeError("project initialization command input must be conflict-free");
  }
  const createCount = targets.filter(({ action }) => action === "create").length;
  const retainCount = targets.length - createCount;
  if (createCount < 1) {
    throw new TypeError("project initialization command input must contain a write");
  }
  const summary = dataRecord(
    body["summary"],
    "project initialization summary is invalid",
  );
  exactKeys(
    summary,
    ["create", "retain", "conflict"],
    [],
    "project initialization summary is invalid",
  );
  if (
    summary["create"] !== createCount ||
    summary["retain"] !== retainCount ||
    summary["conflict"] !== 0
  ) {
    throw new TypeError("project initialization summary is contradictory");
  }
  const createBytes = targets.reduce(
    (total, target) =>
      target.action === "create" ? total + (target.desiredBytes ?? 0) : total,
    0,
  );
  validateBudgets(body["budgets"], createCount, createBytes);
  return body as unknown as ProjectInitializationPreparedPlanDigestInput;
}

export function computeProjectInitializationPreparedPlanDigest(
  value: ProjectInitializationPreparedPlanDigestInput,
): Sha256Digest {
  const body = validatePreparedPlanBody(value);
  return digestCanonicalJson({
    domain: "ai-game-playbook/prepared-project-initialization",
    version: "1.0.0",
    ...body,
  });
}

export function assertProjectInitializationCommandInputSemantics(
  value: ProjectInitializationCommandInput,
): void {
  const input = dataRecord(value, "project initialization command input is invalid");
  exactKeys(input, [
    "schemaVersion",
    "disposition",
    "runId",
    "registryDigest",
    "initPlanDigest",
    "project",
    "profileDigest",
    "packLockDigest",
    "targets",
    "conflicts",
    "summary",
    "budgets",
    "preparedPlanDigest",
  ]);
  if (!isSha256Digest(input["preparedPlanDigest"])) {
    throw new TypeError("project initialization prepared plan digest is invalid");
  }
  const { preparedPlanDigest, ...body } = input;
  if (
    preparedPlanDigest !==
    computeProjectInitializationPreparedPlanDigest(
      body as unknown as ProjectInitializationPreparedPlanDigestInput,
    )
  ) {
    throw new TypeError("project initialization prepared plan digest does not match");
  }
}

function validatePointer(value: unknown, kind: "receipt" | "checkpoint"): void {
  const pointer = dataRecord(value, `project initialization ${kind} pointer is invalid`);
  if (kind === "receipt") {
    exactKeys(pointer, [
      "receiptId",
      "receiptDigest",
      "headDigest",
      "chainLength",
    ]);
    if (
      typeof pointer["receiptId"] !== "string" ||
      !UUID_PATTERN.test(pointer["receiptId"]) ||
      !isSha256Digest(pointer["receiptDigest"]) ||
      !isSha256Digest(pointer["headDigest"]) ||
      !boundedInteger(pointer["chainLength"], 1, 4096)
    ) {
      throw new TypeError("project initialization receipt pointer is invalid");
    }
    return;
  }
  exactKeys(pointer, [
    "checkpointId",
    "checkpointDigest",
    "headDigest",
    "sequence",
  ]);
  if (
    typeof pointer["checkpointId"] !== "string" ||
    !UUID_PATTERN.test(pointer["checkpointId"]) ||
    !isSha256Digest(pointer["checkpointDigest"]) ||
    !isSha256Digest(pointer["headDigest"]) ||
    !boundedInteger(pointer["sequence"], 0, 1_000_000)
  ) {
    throw new TypeError("project initialization checkpoint pointer is invalid");
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validateReportBody(
  value: unknown,
): ProjectInitializationReportDigestInput {
  const report = dataRecord(value, "project initialization report is invalid");
  exactKeys(
    report,
    [
      "schemaVersion",
      "commandId",
      "runId",
      "registryDigest",
      "project",
      "initPlanDigest",
      "preparedPlanDigest",
      "profileDigest",
      "packLockDigest",
      "inputDigest",
      "status",
      "code",
      "mutationAttempted",
      "mutationUncertain",
      "effects",
      "timing",
      "authorization",
      "evidence",
      "externalProcessStarted",
      "networkAccessPerformed",
      "editorControlPerformed",
    ],
    ["error"],
  );
  if (
    report["schemaVersion"] !== "1.0.0" ||
    report["commandId"] !== PROJECT_INITIALIZATION_COMMAND_ID ||
    typeof report["runId"] !== "string" ||
    !UUID_PATTERN.test(report["runId"]) ||
    !isSha256Digest(report["registryDigest"]) ||
    !isSha256Digest(report["initPlanDigest"]) ||
    !isSha256Digest(report["preparedPlanDigest"]) ||
    !isSha256Digest(report["profileDigest"]) ||
    !isSha256Digest(report["packLockDigest"]) ||
    !isSha256Digest(report["inputDigest"]) ||
    ![
      "failed",
      "recovery-required",
      "rolled-back",
      "succeeded",
    ].includes(report["status"] as string) ||
    !isStableId(report["code"]) ||
    typeof report["mutationAttempted"] !== "boolean" ||
    typeof report["mutationUncertain"] !== "boolean" ||
    report["externalProcessStarted"] !== false ||
    report["networkAccessPerformed"] !== false ||
    report["editorControlPerformed"] !== false
  ) {
    throw new TypeError("project initialization report identity is invalid");
  }
  validateProject(report["project"]);
  const effects = dataRecord(
    report["effects"],
    "project initialization effects are invalid",
  );
  exactKeys(effects, [
    "changedPaths",
    "changedBytes",
    "appliedPaths",
    "rolledBackPaths",
    "controlPlaneState",
  ]);
  const changedPaths = portablePaths(
    effects["changedPaths"],
    PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    "project initialization changed paths are invalid",
  );
  const appliedPaths = portablePaths(
    effects["appliedPaths"],
    PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    "project initialization applied paths are invalid",
  );
  const rolledBackPaths = portablePaths(
    effects["rolledBackPaths"],
    PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    "project initialization rollback paths are invalid",
  );
  if (
    !boundedInteger(
      effects["changedBytes"],
      0,
      PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES,
    ) ||
    appliedPaths.some((path) => !changedPaths.includes(path)) ||
    rolledBackPaths.some((path) => !appliedPaths.includes(path))
  ) {
    throw new TypeError("project initialization effects are contradictory");
  }
  const controlState = dataRecord(
    effects["controlPlaneState"],
    "project initialization control-plane effects are invalid",
  );
  exactKeys(controlState, ["changedPaths", "changedFiles", "changedBytes"]);
  const controlStatePaths = portablePaths(
    controlState["changedPaths"],
    PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES,
    "project initialization control-plane paths are invalid",
  );
  if (
    controlStatePaths.length < 1 ||
    controlStatePaths.some((path) => !isProjectInitializationControlStatePath(path)) ||
    !boundedInteger(
      controlState["changedFiles"],
      1,
      PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES,
    ) ||
    controlState["changedFiles"] !== controlStatePaths.length ||
    !boundedInteger(
      controlState["changedBytes"],
      1,
      PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_BYTES,
    )
  ) {
    throw new TypeError("project initialization control-plane effects exceed their budget");
  }
  const timing = dataRecord(
    report["timing"],
    "project initialization timing is invalid",
  );
  exactKeys(timing, ["startedAt", "endedAt", "durationMs"]);
  if (
    !canonicalTimestamp(timing["startedAt"]) ||
    !canonicalTimestamp(timing["endedAt"]) ||
    Date.parse(timing["endedAt"]) < Date.parse(timing["startedAt"]) ||
    timing["durationMs"] !==
      Date.parse(timing["endedAt"]) - Date.parse(timing["startedAt"]) ||
    !boundedInteger(
      timing["durationMs"],
      0,
      PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
    )
  ) {
    throw new TypeError("project initialization timing is contradictory");
  }
  const authorization = dataRecord(
    report["authorization"],
    "project initialization authorization settlement is invalid",
  );
  exactKeys(authorization, [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "approvalIds",
    "settledAt",
  ]);
  if (
    typeof authorization["authorizationId"] !== "string" ||
    !UUID_PATTERN.test(authorization["authorizationId"]) ||
    !isSha256Digest(authorization["requestDigest"]) ||
    !["failed", "succeeded", "uncertain"].includes(
      authorization["status"] as string,
    ) ||
    typeof authorization["mutationUncertain"] !== "boolean" ||
    !canonicalTimestamp(authorization["settledAt"]) ||
    Date.parse(authorization["settledAt"]) < Date.parse(timing["endedAt"])
  ) {
    throw new TypeError("project initialization authorization settlement is invalid");
  }
  canonicalStableIds(authorization["violations"], 0, 32);
  canonicalStableIds(authorization["approvalIds"], 1, 128);
  const evidence = dataRecord(
    report["evidence"],
    "project initialization evidence is invalid",
  );
  exactKeys(evidence, ["receipt", "checkpoint", "activeMarker"]);
  validatePointer(evidence["receipt"], "receipt");
  validatePointer(evidence["checkpoint"], "checkpoint");
  const marker = dataRecord(
    evidence["activeMarker"],
    "project initialization active marker is invalid",
  );
  exactKeys(marker, ["status"], ["digest"]);
  if (
    !["cleared", "retained"].includes(marker["status"] as string) ||
    (marker["status"] === "retained") !== Object.hasOwn(marker, "digest") ||
    (Object.hasOwn(marker, "digest") && !isSha256Digest(marker["digest"]))
  ) {
    throw new TypeError("project initialization active marker is contradictory");
  }
  const status = report["status"] as ProjectInitializationExecutionStatus;
  const uncertain = status === "recovery-required";
  const errorPresent = Object.hasOwn(report, "error");
  if (
    report["mutationUncertain"] !== uncertain ||
    authorization["mutationUncertain"] !== uncertain
  ) {
    throw new TypeError("project initialization uncertain outcome is contradictory");
  }
  if ((marker["status"] === "retained") !== uncertain) {
    throw new TypeError("project initialization active marker contradicts the outcome");
  }
  if ((authorization["status"] === "uncertain") !== uncertain) {
    throw new TypeError("project initialization authorization contradicts the outcome");
  }
  if (errorPresent !== (status !== "succeeded")) {
    throw new TypeError("project initialization error contradicts the outcome");
  }
  if (errorPresent) {
    const error = dataRecord(
      report["error"],
      "project initialization error is invalid",
    );
    exactKeys(error, ["code", "at"]);
    if (!isStableId(error["code"]) || !isStableId(error["at"])) {
      throw new TypeError("project initialization error is invalid");
    }
  }
  if (
    (status === "succeeded" &&
      (report["mutationAttempted"] !== true ||
        authorization["status"] !== "succeeded" ||
        !sameValues(changedPaths, appliedPaths) ||
        rolledBackPaths.length !== 0)) ||
    (status === "failed" &&
      (report["mutationAttempted"] !== false ||
        authorization["status"] !== "failed" ||
        changedPaths.length !== 0 ||
        appliedPaths.length !== 0 ||
        rolledBackPaths.length !== 0 ||
        effects["changedBytes"] !== 0)) ||
    (status === "rolled-back" &&
      (report["mutationAttempted"] !== true ||
        authorization["status"] !== "failed" ||
        appliedPaths.length < 1 ||
        !sameValues(changedPaths, appliedPaths) ||
        !sameValues(appliedPaths, rolledBackPaths))) ||
    (status === "recovery-required" &&
      report["mutationAttempted"] !== true)
  ) {
    throw new TypeError("project initialization status, effects, or authorization is contradictory");
  }
  return report as unknown as ProjectInitializationReportDigestInput;
}

export function computeProjectInitializationReportDigest(
  value: ProjectInitializationReportDigestInput,
): Sha256Digest {
  const body = validateReportBody(value);
  return digestCanonicalJson({
    domain: "ai-game-playbook/project-initialization-report",
    version: "1.0.0",
    ...body,
  });
}

export function assertProjectInitializationReportSemantics(
  value: ProjectInitializationReport,
): void {
  const report = dataRecord(value, "project initialization report is invalid");
  exactKeys(
    report,
    [
      "schemaVersion",
      "commandId",
      "runId",
      "registryDigest",
      "project",
      "initPlanDigest",
      "preparedPlanDigest",
      "profileDigest",
      "packLockDigest",
      "inputDigest",
      "status",
      "code",
      "mutationAttempted",
      "mutationUncertain",
      "effects",
      "timing",
      "authorization",
      "evidence",
      "externalProcessStarted",
      "networkAccessPerformed",
      "editorControlPerformed",
      "reportDigest",
    ],
    ["error"],
  );
  if (!isSha256Digest(report["reportDigest"])) {
    throw new TypeError("project initialization report digest is invalid");
  }
  const { reportDigest, ...body } = report;
  if (
    reportDigest !==
    computeProjectInitializationReportDigest(
      body as unknown as ProjectInitializationReportDigestInput,
    )
  ) {
    throw new TypeError("project initialization report digest does not match");
  }
}

const commandTarget = closedObject(
  {
    path: reference("portablePath"),
    kind: enumSchema(["directory", "file"]),
    policy: enumSchema(["committed", "local-only"]),
    content: enumSchema([
      "none",
      "project-profile",
      "pack-lock",
      "ignore-policy",
    ]),
    action: enumSchema(["create", "retain"]),
    code: reference("stableId"),
    desiredDigest: reference("sha256Digest"),
    desiredBytes: {
      type: "integer",
      minimum: 1,
      maximum: PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
    },
  },
  ["path", "kind", "policy", "content", "action", "code"],
);

const initializationProject = closedObject(
  {
    id: reference("stableId"),
    identityDigest: reference("sha256Digest"),
    rootIdentityDigest: reference("sha256Digest"),
    stage: reference("projectStage"),
  },
  ["id", "identityDigest", "rootIdentityDigest", "stage"],
);

const initializationSummary = closedObject(
  {
    create: {
      type: "integer",
      minimum: 1,
      maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    },
    retain: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT - 1,
    },
    conflict: { const: 0 },
  },
  ["create", "retain", "conflict"],
);

export const projectInitializationCommandInputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-initialization-command-input",
    version: "1.0.0",
    title: "Project Initialization Command Input",
    description:
      "Binds one ready fixed-layout initialization plan to exact project, registry, metadata, target, and budget authority without carrying content bytes or absolute paths.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        disposition: { const: "ready" },
        runId: reference("uuid"),
        registryDigest: reference("sha256Digest"),
        initPlanDigest: reference("sha256Digest"),
        project: initializationProject,
        profileDigest: reference("sha256Digest"),
        packLockDigest: reference("sha256Digest"),
        targets: boundedArray(commandTarget, {
          minimum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
          maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
        }),
        conflicts: boundedArray(
          closedObject(
            { code: reference("stableId"), path: reference("portablePath") },
            ["code", "path"],
          ),
          { maximum: 0 },
        ),
        summary: initializationSummary,
        budgets: reference("executionBudgets"),
        preparedPlanDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "disposition",
        "runId",
        "registryDigest",
        "initPlanDigest",
        "project",
        "profileDigest",
        "packLockDigest",
        "targets",
        "conflicts",
        "summary",
        "budgets",
        "preparedPlanDigest",
      ],
    ),
  });

const controlPlaneStateEffects = closedObject(
  {
    changedPaths: boundedArray(reference("portablePath"), {
      minimum: 1,
      maximum: PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES,
      unique: true,
    }),
    changedFiles: {
      type: "integer",
      minimum: 1,
      maximum: PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES,
    },
    changedBytes: {
      type: "integer",
      minimum: 1,
      maximum: PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_BYTES,
    },
  },
  ["changedPaths", "changedFiles", "changedBytes"],
);

const initializationEffects = closedObject(
  {
    changedPaths: boundedArray(reference("portablePath"), {
      maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
      unique: true,
    }),
    changedBytes: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES,
    },
    appliedPaths: boundedArray(reference("portablePath"), {
      maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
      unique: true,
    }),
    rolledBackPaths: boundedArray(reference("portablePath"), {
      maximum: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
      unique: true,
    }),
    controlPlaneState: controlPlaneStateEffects,
  },
  [
    "changedPaths",
    "changedBytes",
    "appliedPaths",
    "rolledBackPaths",
    "controlPlaneState",
  ],
);

const initializationTiming = closedObject(
  {
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
    durationMs: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
    },
  },
  ["startedAt", "endedAt", "durationMs"],
);

const authorizationSettlement = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    status: enumSchema(["failed", "succeeded", "uncertain"]),
    mutationUncertain: { type: "boolean" },
    violations: boundedArray(reference("stableId"), {
      maximum: 32,
      unique: true,
    }),
    approvalIds: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 128,
      unique: true,
    }),
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "approvalIds",
    "settledAt",
  ],
);

const receiptPointer = closedObject(
  {
    receiptId: reference("uuid"),
    receiptDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    chainLength: { type: "integer", minimum: 1, maximum: 4096 },
  },
  ["receiptId", "receiptDigest", "headDigest", "chainLength"],
);

const checkpointPointer = closedObject(
  {
    checkpointId: reference("uuid"),
    checkpointDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    sequence: { type: "integer", minimum: 0, maximum: 1_000_000 },
  },
  ["checkpointId", "checkpointDigest", "headDigest", "sequence"],
);

const activeMarker = closedObject(
  {
    status: enumSchema(["cleared", "retained"]),
    digest: reference("sha256Digest"),
  },
  ["status"],
);

const initializationEvidence = closedObject(
  {
    receipt: receiptPointer,
    checkpoint: checkpointPointer,
    activeMarker,
  },
  ["receipt", "checkpoint", "activeMarker"],
);

const initializationError = closedObject(
  { code: reference("stableId"), at: reference("stableId") },
  ["code", "at"],
);

export const projectInitializationReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-initialization-report",
    version: "1.0.0",
    title: "Project Initialization Report",
    description:
      "Attests one internal project initialization outcome, authorization settlement, bounded mutation and control-plane effects, rollback or uncertainty, and durable evidence pointers.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        commandId: { const: PROJECT_INITIALIZATION_COMMAND_ID },
        runId: reference("uuid"),
        registryDigest: reference("sha256Digest"),
        project: initializationProject,
        initPlanDigest: reference("sha256Digest"),
        preparedPlanDigest: reference("sha256Digest"),
        profileDigest: reference("sha256Digest"),
        packLockDigest: reference("sha256Digest"),
        inputDigest: reference("sha256Digest"),
        status: enumSchema([
          "failed",
          "recovery-required",
          "rolled-back",
          "succeeded",
        ]),
        code: reference("stableId"),
        mutationAttempted: { type: "boolean" },
        mutationUncertain: { type: "boolean" },
        effects: initializationEffects,
        timing: initializationTiming,
        authorization: authorizationSettlement,
        evidence: initializationEvidence,
        error: initializationError,
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
        editorControlPerformed: { const: false },
        reportDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "commandId",
        "runId",
        "registryDigest",
        "project",
        "initPlanDigest",
        "preparedPlanDigest",
        "profileDigest",
        "packLockDigest",
        "inputDigest",
        "status",
        "code",
        "mutationAttempted",
        "mutationUncertain",
        "effects",
        "timing",
        "authorization",
        "evidence",
        "externalProcessStarted",
        "networkAccessPerformed",
        "editorControlPerformed",
        "reportDigest",
      ],
    ),
  });
