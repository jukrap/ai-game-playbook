import { Buffer } from "node:buffer";
import {
  createPublicKey,
  randomUUID,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import {
  approvalGrantSchema,
  canonicalizeJson,
  checkApprovalGrantSemantics,
  checkFeatureContractSemantics,
  compareCanonicalText,
  computeApprovalGrantSigningDigest,
  computeFeatureContractApprovalDigest,
  digestCanonicalJson,
  featureContractSchema,
  isCanonicalApprovalDestination,
  isSha256Digest,
  isStableId,
  parsePortableProjectPath,
  type ApprovalGrant,
  type ApprovalGrantScope,
  type ExecutionBudgets,
  type FeatureContract,
  type PermissionClass,
  type ProjectStage,
  type SemanticVersion,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { CoreBoundaryError } from "./errors.js";

const PERMISSION_REQUEST_MAX_BYTES = 1_048_576;
const APPROVAL_PUBLIC_KEY_MAX_BYTES = 16_384;
const MAX_SCOPE_PATHS = 256;
const MAX_SCOPE_OBJECTS = 256;
const MAX_SCOPE_DESTINATIONS = 32;
const MAX_SCOPE_DATA_CLASSES = 64;
const MAX_SCOPE_CHANGE_KINDS = 6;
const MAX_SCOPE_PUBLISH_TARGETS = 256;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const PROJECT_STAGES = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const CHANGE_KINDS = new Set<ApprovalGrantScope["changeKinds"][number]>([
  "metadata",
  "source",
  "config",
  "scene",
  "asset",
  "test",
]);
const AUTOMATIC_PERMISSIONS = new Set<PermissionClass>([
  "read-project",
  "write-project-source",
  "test-build",
]);
const MUTATION_PERMISSIONS = new Set<PermissionClass>([
  "write-project-metadata",
  "write-project-source",
  "editor-control",
  "test-build",
  "install",
  "destructive",
  "publish-release",
]);
const FILESYSTEM_MUTATION_PERMISSIONS = new Set<PermissionClass>([
  "write-project-metadata",
  "write-project-source",
  "install",
  "destructive",
]);
const OBJECT_MUTATION_PERMISSIONS = new Set<PermissionClass>([
  "destructive",
]);
const REMOTE_SCOPE_PERMISSIONS = new Set<PermissionClass>([
  "network",
  "external-transmission",
  "paid-call",
]);

type MutableRecord = Record<string, unknown>;

export interface PermissionBrokerProject {
  readonly id: StableId;
  readonly identityDigest: Sha256Digest;
  readonly stage: ProjectStage;
  readonly budgets: ExecutionBudgets;
}

export interface TrustedApprovalKey {
  readonly keyId: StableId;
  readonly publicKeyPem: string;
}

export interface PermissionBrokerOptions {
  readonly registry: ValidatedRegistry;
  readonly project: PermissionBrokerProject;
  readonly trustedApprovalKeys: readonly TrustedApprovalKey[];
  readonly now?: () => number;
}

export interface PermissionWorkflowBinding {
  readonly id: StableId;
  readonly stepId: StableId;
  readonly resolvedPlanDigest: Sha256Digest;
}

export interface PermissionAuthorizationRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly commandId: StableId;
  readonly input: unknown;
  readonly featureContract?: FeatureContract;
  readonly workflow?: PermissionWorkflowBinding;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly scope: ApprovalGrantScope;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
}

export interface PermissionChallengeEntry {
  readonly permission: PermissionClass;
  readonly mode: "automatic" | "approval-required";
}

export interface PermissionAuthorizationChallenge {
  readonly schemaVersion: "1.0.0";
  readonly requestDigest: Sha256Digest;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly command: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly handlerDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly feature?: {
    readonly id: StableId;
    readonly contractDigest: Sha256Digest;
  };
  readonly workflow?: PermissionWorkflowBinding;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly scope: ApprovalGrantScope;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
  readonly permissions: readonly PermissionChallengeEntry[];
}

export interface CreateApprovalGrantSubjectOptions {
  readonly grantId: StableId;
  readonly permission: PermissionClass;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export type UnsignedApprovalGrant = Omit<ApprovalGrant, "signature">;

export type PermissionSettlementOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain";

export interface PermissionActualEffects {
  readonly changedPaths: readonly string[];
  readonly changedBytes: number;
  readonly objectIds: readonly string[];
  readonly destinations: readonly string[];
  readonly dataClasses: readonly StableId[];
  readonly changeKinds: readonly ApprovalGrantScope["changeKinds"][number][];
  readonly provider?: string;
  readonly model?: string;
  readonly publishTargets: readonly string[];
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly repairCycles: number;
  readonly cost?: {
    readonly currency: string;
    readonly amount: string;
  };
}

export interface PermissionSettlementInput {
  readonly outcome: PermissionSettlementOutcome;
  readonly mutationUncertain: boolean;
  readonly actual: PermissionActualEffects;
}

export interface PermissionSettlement {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status:
    | "succeeded"
    | "failed"
    | "cancelled"
    | "uncertain"
    | "scope-violation";
  readonly mutationUncertain: boolean;
  readonly violations: readonly string[];
  readonly actual: PermissionActualEffects;
  readonly settledAt: string;
}

export interface PermissionAuthorizationLease {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly commandId: StableId;
  readonly projectId: StableId;
  readonly grantIds: readonly StableId[];
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly state: "active" | "settled";
  settle(input: PermissionSettlementInput): PermissionSettlement;
}

export type PermissionAuthorizationDecision =
  | {
      readonly status: "approval-required";
      readonly challenge: PermissionAuthorizationChallenge;
      readonly missingPermissions: readonly PermissionClass[];
    }
  | {
      readonly status: "authorized";
      readonly challenge: PermissionAuthorizationChallenge;
      readonly lease: PermissionAuthorizationLease;
    };

export type AuthorizedPermissionDecision = Extract<
  PermissionAuthorizationDecision,
  { readonly status: "authorized" }
>;

export interface PermissionBroker {
  prepare(
    request: PermissionAuthorizationRequest,
  ): PermissionAuthorizationChallenge;
  authorize(
    request: PermissionAuthorizationRequest,
    grants: readonly ApprovalGrant[],
  ): PermissionAuthorizationDecision;
}

interface BoundApprovalKey {
  readonly keyId: StableId;
  readonly publicKey: KeyObject;
}

interface NormalizedRequest {
  readonly challenge: PermissionAuthorizationChallenge;
  readonly mutationPotential: boolean;
}

interface GrantUsage {
  readonly signingDigest: Sha256Digest;
  uses: number;
}

const preparedChallenges = new WeakSet<object>();
const authorizationLeaseInstances = new WeakSet<object>();
const permissionSettlementInstances = new WeakSet<object>();

function boundaryError(
  code: ConstructorParameters<typeof CoreBoundaryError>[0],
  path: string,
  message: string,
  mutationUncertain = false,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message, mutationUncertain);
}

export function assertAuthorizedPermissionDecision(
  value: unknown,
): asserts value is AuthorizedPermissionDecision {
  const candidate =
    value !== null && typeof value === "object"
      ? (value as Partial<AuthorizedPermissionDecision>)
      : undefined;
  const challenge = candidate?.challenge;
  const lease = candidate?.lease;
  if (
    candidate?.status !== "authorized" ||
    challenge === undefined ||
    lease === undefined ||
    !preparedChallenges.has(challenge) ||
    !authorizationLeaseInstances.has(lease) ||
    lease.requestDigest !== challenge.requestDigest ||
    lease.commandId !== challenge.command.id ||
    lease.projectId !== challenge.project.id
  ) {
    throw boundaryError(
      "permission-lease-state-invalid",
      "$authorization",
      "authorization decision must be produced by a permission broker in this process",
    );
  }
}

export function assertPermissionSettlement(
  value: unknown,
): asserts value is PermissionSettlement {
  if (
    value === null ||
    typeof value !== "object" ||
    !permissionSettlementInstances.has(value)
  ) {
    throw boundaryError(
      "permission-lease-state-invalid",
      "$settlement",
      "permission settlement must be produced by a permission broker in this process",
      true,
    );
  }
}

function readClock(now: () => number): number {
  let value: number;
  try {
    value = now();
  } catch {
    throw boundaryError(
      "invalid-permission-broker-options",
      "$options.now",
      "clock failed",
    );
  }
  if (
    !Number.isSafeInteger(value) ||
    value < -8_640_000_000_000_000 ||
    value > 8_640_000_000_000_000
  ) {
    throw boundaryError(
      "invalid-permission-broker-options",
      "$options.now",
      "clock returned an invalid timestamp",
    );
  }
  return value;
}

function dataRecord(value: unknown, path: string): MutableRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected a plain object",
    );
  }
  return value as MutableRecord;
}

function exactKeys(
  record: MutableRecord,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw boundaryError(
        "invalid-permission-request",
        `${path}.${key}`,
        "undeclared field",
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw boundaryError(
        "invalid-permission-request",
        `${path}.${key}`,
        "required field is missing",
      );
    }
  }
}

function snapshotCanonical(value: unknown, path: string): unknown {
  let serialized: string;
  try {
    serialized = canonicalizeJson(value);
  } catch {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected bounded canonical JSON data",
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > PERMISSION_REQUEST_MAX_BYTES) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      `request exceeds ${PERMISSION_REQUEST_MAX_BYTES} UTF-8 bytes`,
    );
  }
  return JSON.parse(serialized) as unknown;
}

function boundedText(
  value: unknown,
  path: string,
  maximum: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      path,
      `expected 1-${maximum} printable characters`,
    );
  }
  return value;
}

function stableId(value: unknown, path: string): StableId {
  if (!isStableId(value)) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected a canonical stable ID",
    );
  }
  return value;
}

function digest(value: unknown, path: string): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected a canonical SHA-256 digest",
    );
  }
  return value;
}

function canonicalTimestamp(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected a UTC timestamp",
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      "expected a canonical UTC timestamp",
    );
  }
  return value;
}

function boundedInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw boundaryError(
      "invalid-permission-request",
      path,
      `expected an integer from ${minimum} through ${maximum}`,
    );
  }
  return value as number;
}

function money(
  value: unknown,
  path: string,
): NonNullable<ExecutionBudgets["maxCost"]> {
  const record = dataRecord(value, path);
  exactKeys(record, ["currency", "amount"], ["currency", "amount"], path);
  const currency = record["currency"];
  const amount = record["amount"];
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
    throw boundaryError(
      "invalid-permission-request",
      `${path}.currency`,
      "expected a three-letter uppercase currency",
    );
  }
  if (
    typeof amount !== "string" ||
    !/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(amount)
  ) {
    throw boundaryError(
      "invalid-permission-request",
      `${path}.amount`,
      "expected a bounded decimal amount",
    );
  }
  return Object.freeze({ currency, amount });
}

function normalizeBudgets(value: unknown, path: string): ExecutionBudgets {
  const record = dataRecord(value, path);
  const keys = [
    "maxChangedFiles",
    "maxChangedBytes",
    "maxDurationMs",
    "maxOutputBytes",
    "maxRepairCycles",
    "maxMemoryBytes",
    "maxCpuSeconds",
    "maxGpuSeconds",
    "maxCost",
  ];
  exactKeys(
    record,
    keys,
    ["maxDurationMs", "maxOutputBytes", "maxRepairCycles"],
    path,
  );
  const optionalInteger = (
    key: string,
    minimum: number,
    maximum: number,
  ): number | undefined =>
    record[key] === undefined
      ? undefined
      : boundedInteger(record[key], `${path}.${key}`, minimum, maximum);
  const maxCost =
    record["maxCost"] === undefined
      ? undefined
      : money(record["maxCost"], `${path}.maxCost`);
  const maxMemoryBytes = optionalInteger(
    "maxMemoryBytes",
    1,
    1_099_511_627_776,
  );
  const maxCpuSeconds = optionalInteger("maxCpuSeconds", 1, 604_800);
  const maxGpuSeconds = optionalInteger("maxGpuSeconds", 1, 604_800);
  return Object.freeze({
    ...(record["maxChangedFiles"] === undefined
      ? {}
      : {
          maxChangedFiles: boundedInteger(
            record["maxChangedFiles"],
            `${path}.maxChangedFiles`,
            0,
            100_000,
          ),
        }),
    ...(record["maxChangedBytes"] === undefined
      ? {}
      : {
          maxChangedBytes: boundedInteger(
            record["maxChangedBytes"],
            `${path}.maxChangedBytes`,
            0,
            1_099_511_627_776,
          ),
        }),
    maxDurationMs: boundedInteger(
      record["maxDurationMs"],
      `${path}.maxDurationMs`,
      1,
      604_800_000,
    ),
    maxOutputBytes: boundedInteger(
      record["maxOutputBytes"],
      `${path}.maxOutputBytes`,
      1,
      1_073_741_824,
    ),
    maxRepairCycles: boundedInteger(
      record["maxRepairCycles"],
      `${path}.maxRepairCycles`,
      0,
      3,
    ),
    ...(maxMemoryBytes === undefined
      ? {}
      : { maxMemoryBytes }),
    ...(maxCpuSeconds === undefined
      ? {}
      : { maxCpuSeconds }),
    ...(maxGpuSeconds === undefined
      ? {}
      : { maxGpuSeconds }),
    ...(maxCost === undefined ? {} : { maxCost }),
  });
}

function decimalMicros(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function budgetWithin(
  requested: ExecutionBudgets,
  ceiling: ExecutionBudgets,
): boolean {
  if (
    requested.maxDurationMs > ceiling.maxDurationMs ||
    requested.maxOutputBytes > ceiling.maxOutputBytes ||
    requested.maxRepairCycles > ceiling.maxRepairCycles
  ) {
    return false;
  }
  for (const key of [
    "maxChangedFiles",
    "maxChangedBytes",
    "maxMemoryBytes",
    "maxCpuSeconds",
    "maxGpuSeconds",
  ] as const) {
    const value = requested[key];
    if (value !== undefined && (ceiling[key] === undefined || value > ceiling[key])) {
      return false;
    }
  }
  if (requested.maxCost !== undefined) {
    if (
      ceiling.maxCost === undefined ||
      requested.maxCost.currency !== ceiling.maxCost.currency ||
      decimalMicros(requested.maxCost.amount) >
        decimalMicros(ceiling.maxCost.amount)
    ) {
      return false;
    }
  }
  return true;
}

function normalizeStringArray(
  value: unknown,
  path: string,
  maximumItems: number,
  normalize: (entry: unknown, path: string) => string,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw boundaryError(
      "permission-scope-invalid",
      path,
      `expected an array with at most ${maximumItems} entries`,
    );
  }
  const normalized = value.map((entry, index) =>
    normalize(entry, `${path}[${index}]`),
  );
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    throw boundaryError(
      "permission-scope-invalid",
      path,
      "duplicate entries are not allowed",
    );
  }
  return Object.freeze([...normalized].sort(compareCanonicalText));
}

function normalizeScope(value: unknown, path: string): ApprovalGrantScope {
  const record = dataRecord(value, path);
  const required = [
    "paths",
    "objectIds",
    "destinations",
    "dataClasses",
    "changeKinds",
    "publishTargets",
  ];
  exactKeys(
    record,
    [...required, "provider", "model"],
    required,
    path,
  );
  const paths = normalizeStringArray(
    record["paths"],
    `${path}.paths`,
    MAX_SCOPE_PATHS,
    (entry, entryPath) => parsePortableProjectPath(entry, entryPath),
  );
  const objectIds = normalizeStringArray(
    record["objectIds"],
    `${path}.objectIds`,
    MAX_SCOPE_OBJECTS,
    (entry, entryPath) => boundedText(entry, entryPath, 512),
  );
  const destinations = normalizeStringArray(
    record["destinations"],
    `${path}.destinations`,
    MAX_SCOPE_DESTINATIONS,
    (entry, entryPath) => {
      const destination = boundedText(entry, entryPath, 300);
      if (!isCanonicalApprovalDestination(destination)) {
        throw boundaryError(
          "permission-scope-invalid",
          entryPath,
          "expected a canonical HTTP or HTTPS origin",
        );
      }
      return destination;
    },
  );
  const dataClasses = normalizeStringArray(
    record["dataClasses"],
    `${path}.dataClasses`,
    MAX_SCOPE_DATA_CLASSES,
    (entry, entryPath) => stableId(entry, entryPath),
  ) as readonly StableId[];
  const changeKinds = normalizeStringArray(
    record["changeKinds"],
    `${path}.changeKinds`,
    MAX_SCOPE_CHANGE_KINDS,
    (entry, entryPath) => {
      if (
        typeof entry !== "string" ||
        !CHANGE_KINDS.has(entry as ApprovalGrantScope["changeKinds"][number])
      ) {
        throw boundaryError(
          "permission-scope-invalid",
          entryPath,
          "unknown feature change kind",
        );
      }
      return entry;
    },
  ) as ApprovalGrantScope["changeKinds"];
  const publishTargets = normalizeStringArray(
    record["publishTargets"],
    `${path}.publishTargets`,
    MAX_SCOPE_PUBLISH_TARGETS,
    (entry, entryPath) => boundedText(entry, entryPath, 512),
  );
  const provider =
    record["provider"] === undefined
      ? undefined
      : boundedText(record["provider"], `${path}.provider`, 200);
  const model =
    record["model"] === undefined
      ? undefined
      : boundedText(record["model"], `${path}.model`, 200);
  return Object.freeze({
    paths,
    objectIds,
    destinations,
    dataClasses,
    changeKinds,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    publishTargets,
  });
}

function featureAllowsPath(
  feature: FeatureContract,
  path: string,
): boolean {
  return feature.scope.allowedPaths.some(
    (allowed) =>
      allowed.access === "read-write" &&
      (allowed.path === path ||
        (allowed.recursive && path.startsWith(`${allowed.path}/`))),
  );
}

function validatePermissionScope(
  permissions: readonly PermissionClass[],
  scope: ApprovalGrantScope,
  budgets: ExecutionBudgets,
  feature: FeatureContract | undefined,
  workflow: PermissionWorkflowBinding | undefined,
  editorSessionIdentityDigest: Sha256Digest | undefined,
): void {
  const hasPermissionFrom = (allowed: ReadonlySet<PermissionClass>): boolean =>
    permissions.some((permission) => allowed.has(permission));
  if (
    budgets.maxMemoryBytes !== undefined ||
    budgets.maxCpuSeconds !== undefined ||
    budgets.maxGpuSeconds !== undefined
  ) {
    throw boundaryError(
      "permission-budget-exceeded",
      "$request.budgets",
      "memory, CPU, and GPU budgets remain closed until runtime enforcement and accounting exist",
    );
  }
  if (permissions.includes("read-project") && scope.paths.length === 0) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.paths",
      "project reads require at least one bounded path",
    );
  }
  if (permissions.includes("write-project-source")) {
    if (feature === undefined) {
      throw boundaryError(
        "permission-feature-invalid",
        "$request.featureContract",
        "source mutation requires a current approved feature contract",
      );
    }
    if (
      scope.paths.length === 0 ||
      scope.changeKinds.length === 0 ||
      scope.objectIds.length > 0 ||
      scope.paths.some((path) => !featureAllowsPath(feature, path)) ||
      scope.changeKinds.some(
        (kind) => !feature.scope.allowedChangeKinds.includes(kind),
      )
    ) {
      throw boundaryError(
        "permission-feature-scope-invalid",
        "$request.scope",
        "source mutation exceeds the approved feature path or change-kind scope, or requests an editor object operation that is not yet typed",
      );
    }
    if (
      budgets.maxChangedFiles === undefined ||
      budgets.maxChangedBytes === undefined
    ) {
      throw boundaryError(
        "permission-budget-exceeded",
        "$request.budgets",
        "source mutation requires changed-file and changed-byte budgets",
      );
    }
  }
  if (
    permissions.some((permission) =>
      [
        "write-project-metadata",
        "write-project-source",
        "install",
        "destructive",
      ].includes(permission),
    ) &&
    (budgets.maxChangedFiles === undefined ||
      budgets.maxChangedBytes === undefined)
  ) {
    throw boundaryError(
      "permission-budget-exceeded",
      "$request.budgets",
      "filesystem-affecting authority requires changed-file and changed-byte budgets",
    );
  }
  if (
    permissions.includes("write-project-metadata") &&
    (scope.paths.length === 0 || !scope.changeKinds.includes("metadata"))
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope",
      "project metadata writes require exact paths and the metadata change kind",
    );
  }
  if (permissions.includes("install") && scope.paths.length === 0) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.paths",
      "installation requires at least one exact target path",
    );
  }
  if (
    scope.objectIds.length > 0 &&
    !hasPermissionFrom(OBJECT_MUTATION_PERMISSIONS)
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.objectIds",
      "editor object effects remain closed unless exact destructive targets are approved",
    );
  }
  if (
    scope.changeKinds.length > 0 &&
    !hasPermissionFrom(FILESYSTEM_MUTATION_PERMISSIONS)
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.changeKinds",
      "change kinds require explicit filesystem mutation authority",
    );
  }
  if (
    scope.destinations.length > 0 &&
    !hasPermissionFrom(REMOTE_SCOPE_PERMISSIONS)
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.destinations",
      "remote destinations require remote authority",
    );
  }
  if (
    scope.dataClasses.length > 0 &&
    !permissions.includes("external-transmission") &&
    !permissions.includes("paid-call")
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.dataClasses",
      "data classes require external transmission or paid-call authority",
    );
  }
  if (
    (scope.provider !== undefined || scope.model !== undefined) &&
    !permissions.includes("paid-call")
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope",
      "provider and model scope require paid-call authority",
    );
  }
  if (
    scope.publishTargets.length > 0 &&
    !permissions.includes("publish-release")
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.publishTargets",
      "publish targets require publish authority",
    );
  }
  if (
    editorSessionIdentityDigest !== undefined &&
    !permissions.includes("editor-control")
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.editorSessionIdentityDigest",
      "an editor session may only be bound to editor-control authority",
    );
  }
  if (permissions.includes("test-build") && workflow === undefined) {
    throw boundaryError(
      "permission-workflow-invalid",
      "$request.workflow",
      "test and build execution requires a registered workflow step",
    );
  }
  if (
    permissions.includes("editor-control") &&
    editorSessionIdentityDigest === undefined
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.editorSessionIdentityDigest",
      "editor control requires an exact session identity digest",
    );
  }
  if (
    permissions.some((permission) =>
      ["network", "external-transmission", "paid-call"].includes(permission),
    ) &&
    scope.destinations.length === 0
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.destinations",
      "remote authority requires at least one canonical destination",
    );
  }
  if (
    permissions.some((permission) =>
      ["external-transmission", "paid-call"].includes(permission),
    ) &&
    scope.dataClasses.length === 0
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.dataClasses",
      "external authority requires declared transmitted data classes",
    );
  }
  if (
    permissions.includes("paid-call") &&
    (scope.provider === undefined ||
      scope.model === undefined ||
      budgets.maxCost === undefined)
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope",
      "paid calls require provider, model, and maximum cost",
    );
  }
  if (
    permissions.includes("destructive") &&
    scope.paths.length === 0 &&
    scope.objectIds.length === 0
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope",
      "destructive authority requires exact path or object targets",
    );
  }
  if (
    permissions.includes("publish-release") &&
    scope.publishTargets.length === 0
  ) {
    throw boundaryError(
      "permission-scope-invalid",
      "$request.scope.publishTargets",
      "publish authority requires exact targets",
    );
  }
}

function normalizeWorkflow(
  value: unknown,
  registry: ValidatedRegistry,
  commandId: StableId,
): PermissionWorkflowBinding | undefined {
  if (value === undefined) {
    return undefined;
  }
  const record = dataRecord(value, "$request.workflow");
  exactKeys(
    record,
    ["id", "stepId", "resolvedPlanDigest"],
    ["id", "stepId", "resolvedPlanDigest"],
    "$request.workflow",
  );
  const binding: PermissionWorkflowBinding = Object.freeze({
    id: stableId(record["id"], "$request.workflow.id"),
    stepId: stableId(record["stepId"], "$request.workflow.stepId"),
    resolvedPlanDigest: digest(
      record["resolvedPlanDigest"],
      "$request.workflow.resolvedPlanDigest",
    ),
  });
  const workflow = registry.workflows.find(({ id }) => id === binding.id);
  const step = workflow?.steps.find(({ id }) => id === binding.stepId);
  const matchesForwardCommand = step?.commandId === commandId;
  const matchesRollbackCommand =
    step?.onFailure === "rollback" && step.rollbackCommandId === commandId;
  if (
    workflow === undefined ||
    (!matchesForwardCommand && !matchesRollbackCommand)
  ) {
    throw boundaryError(
      "permission-workflow-invalid",
      "$request.workflow",
      "workflow and step do not resolve to the requested command",
    );
  }
  return binding;
}

function validateFeature(
  value: unknown,
  registry: ValidatedRegistry,
  projectId: StableId,
  now: number,
): FeatureContract | undefined {
  if (value === undefined) {
    return undefined;
  }
  let feature: FeatureContract;
  try {
    feature = validateRegisteredContractValue(
      registry,
      {
        schemaId: featureContractSchema.schemaId,
        digest: featureContractSchema.digest,
      },
      value,
    ) as unknown as FeatureContract;
  } catch {
    throw boundaryError(
      "permission-feature-invalid",
      "$request.featureContract",
      "feature contract does not satisfy the registered schema",
    );
  }
  const issues = checkFeatureContractSemantics(feature);
  if (
    issues.length > 0 ||
    (feature.status !== "approved" && feature.status !== "active") ||
    feature.projectId !== projectId ||
    feature.approval === undefined ||
    Date.parse(feature.approval.expiresAt) <= now
  ) {
    throw boundaryError(
      "permission-feature-invalid",
      "$request.featureContract",
      "feature contract is not a current approval for this project",
    );
  }
  return feature;
}

function bindApprovalKeys(
  values: readonly TrustedApprovalKey[],
): ReadonlyMap<StableId, BoundApprovalKey> {
  if (!Array.isArray(values) || values.length > 64) {
    throw boundaryError(
      "invalid-permission-broker-options",
      "$options.trustedApprovalKeys",
      "expected at most 64 trusted approval keys",
    );
  }
  const keys = new Map<StableId, BoundApprovalKey>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      continue;
    }
    const keyPath = `$options.trustedApprovalKeys[${index}]`;
    const record = dataRecord(value, keyPath);
    exactKeys(
      record,
      ["keyId", "publicKeyPem"],
      ["keyId", "publicKeyPem"],
      keyPath,
    );
    const keyId = stableId(record["keyId"], `${keyPath}.keyId`);
    if (
      typeof record["publicKeyPem"] !== "string" ||
      Buffer.byteLength(record["publicKeyPem"], "utf8") >
        APPROVAL_PUBLIC_KEY_MAX_BYTES
    ) {
      throw boundaryError(
        "invalid-permission-broker-options",
        `$options.trustedApprovalKeys[${index}].publicKeyPem`,
        "expected a bounded public key",
      );
    }
    if (keys.has(keyId)) {
      throw boundaryError(
        "invalid-permission-broker-options",
        `$options.trustedApprovalKeys[${index}].keyId`,
        "duplicate approval key ID",
      );
    }
    let publicKey: KeyObject;
    try {
      publicKey = createPublicKey(record["publicKeyPem"]);
    } catch {
      throw boundaryError(
        "invalid-permission-broker-options",
        `$options.trustedApprovalKeys[${index}].publicKeyPem`,
        "public key could not be parsed",
      );
    }
    if (publicKey.asymmetricKeyType !== "ed25519") {
      throw boundaryError(
        "invalid-permission-broker-options",
        `$options.trustedApprovalKeys[${index}].publicKeyPem`,
        "approval keys must use Ed25519",
      );
    }
    keys.set(keyId, Object.freeze({ keyId, publicKey }));
  }
  return keys;
}

function freezeChallenge(
  challenge: PermissionAuthorizationChallenge,
): PermissionAuthorizationChallenge {
  Object.freeze(challenge.project);
  Object.freeze(challenge.command);
  if (challenge.feature !== undefined) Object.freeze(challenge.feature);
  if (challenge.workflow !== undefined) Object.freeze(challenge.workflow);
  Object.freeze(challenge.permissions);
  Object.freeze(challenge);
  preparedChallenges.add(challenge);
  return challenge;
}

export function createApprovalGrantSubject(
  challenge: PermissionAuthorizationChallenge,
  options: CreateApprovalGrantSubjectOptions,
): UnsignedApprovalGrant {
  if (!preparedChallenges.has(challenge)) {
    throw boundaryError(
      "permission-grant-invalid",
      "$challenge",
      "challenge must be produced by a permission broker in this process",
    );
  }
  const optionSnapshot = snapshotCanonical(options, "$options");
  const optionRecord = dataRecord(optionSnapshot, "$options");
  exactKeys(
    optionRecord,
    ["grantId", "permission", "approvedAt", "expiresAt", "maxUses"],
    ["grantId", "permission", "approvedAt", "expiresAt", "maxUses"],
    "$options",
  );
  const permission = optionRecord["permission"] as PermissionClass;
  const matching = challenge.permissions.find(
    (entry) => entry.permission === permission,
  );
  if (matching?.mode !== "approval-required") {
    throw boundaryError(
      "permission-grant-invalid",
      "$options.permission",
      "permission is not awaiting explicit approval",
    );
  }
  const grantId = stableId(optionRecord["grantId"], "$options.grantId");
  const approvedAt = canonicalTimestamp(
    optionRecord["approvedAt"],
    "$options.approvedAt",
  );
  const expiresAt = canonicalTimestamp(
    optionRecord["expiresAt"],
    "$options.expiresAt",
  );
  const maxUses = boundedInteger(
    optionRecord["maxUses"],
    "$options.maxUses",
    1,
    10_000,
  );
  if (Date.parse(approvedAt) >= Date.parse(expiresAt)) {
    throw boundaryError(
      "permission-grant-invalid",
      "$options.expiresAt",
      "approval expiry must occur after approval time",
    );
  }
  if (permission !== "editor-control" && maxUses !== 1) {
    throw boundaryError(
      "permission-grant-invalid",
      "$options.maxUses",
      "only an exact editor-session grant may allow more than one use",
    );
  }
  const subject: UnsignedApprovalGrant = {
    schemaVersion: approvalGrantSchema.version,
    grantId,
    permission,
    projectId: challenge.project.id,
    projectIdentityDigest: challenge.project.identityDigest,
    ...(challenge.feature === undefined ? {} : { feature: challenge.feature }),
    ...(challenge.workflow === undefined
      ? {}
      : { workflow: challenge.workflow }),
    command: challenge.command,
    registryDigest: challenge.registryDigest,
    ...(challenge.editorSessionIdentityDigest === undefined
      ? {}
      : {
          editorSessionIdentityDigest:
            challenge.editorSessionIdentityDigest,
        }),
    scope: challenge.scope,
    budgets: Object.freeze({
      expiresAt,
      maxUses,
      execution: challenge.budgets,
    }),
    requestDigest: challenge.requestDigest,
    approvedBy: "user",
    approvedAt,
  };
  return Object.freeze(subject);
}

class PermissionAuthorizationLeaseImplementation
  implements PermissionAuthorizationLease
{
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly commandId: StableId;
  readonly projectId: StableId;
  readonly grantIds: readonly StableId[];
  readonly authorizedAt: string;
  readonly expiresAt: string;
  #state: "active" | "settled" = "active";
  readonly #challenge: PermissionAuthorizationChallenge;
  readonly #mutationPotential: boolean;
  readonly #now: () => number;
  readonly #onUncertain: (requestDigest: Sha256Digest) => void;
  readonly #onSettled: (authorizationId: string) => void;

  constructor(
    challenge: PermissionAuthorizationChallenge,
    grantIds: readonly StableId[],
    authorizedAt: string,
    expiresAt: string,
    mutationPotential: boolean,
    now: () => number,
    onUncertain: (requestDigest: Sha256Digest) => void,
    onSettled: (authorizationId: string) => void,
  ) {
    this.authorizationId = randomUUID();
    this.requestDigest = challenge.requestDigest;
    this.commandId = challenge.command.id;
    this.projectId = challenge.project.id;
    this.grantIds = Object.freeze([...grantIds]);
    this.authorizedAt = authorizedAt;
    this.expiresAt = expiresAt;
    this.#challenge = challenge;
    this.#mutationPotential = mutationPotential;
    this.#now = now;
    this.#onUncertain = onUncertain;
    this.#onSettled = onSettled;
    Object.freeze(this);
    authorizationLeaseInstances.add(this);
  }

  get state(): "active" | "settled" {
    return this.#state;
  }

  settle(input: PermissionSettlementInput): PermissionSettlement {
    if (this.#state !== "active") {
      throw boundaryError(
        "permission-lease-state-invalid",
        "$lease",
        "authorization lease is already settled",
      );
    }
    this.#state = "settled";
    this.#onSettled(this.authorizationId);
    try {
      const snapshot = snapshotCanonical(input, "$settlement");
      const record = dataRecord(snapshot, "$settlement");
      exactKeys(
        record,
        ["outcome", "mutationUncertain", "actual"],
        ["outcome", "mutationUncertain", "actual"],
        "$settlement",
      );
      const outcome = record["outcome"];
      if (
        outcome !== "succeeded" &&
        outcome !== "failed" &&
        outcome !== "cancelled" &&
        outcome !== "uncertain"
      ) {
        throw boundaryError(
          "invalid-permission-request",
          "$settlement.outcome",
          "unknown settlement outcome",
        );
      }
      if (typeof record["mutationUncertain"] !== "boolean") {
        throw boundaryError(
          "invalid-permission-request",
          "$settlement.mutationUncertain",
          "expected a boolean",
        );
      }
      const mutationUncertain = record["mutationUncertain"];
      if (outcome === "uncertain" && !mutationUncertain) {
        throw boundaryError(
          "invalid-permission-request",
          "$settlement",
          "uncertain outcome must retain mutation uncertainty",
        );
      }
      const actual = normalizeActualEffects(record["actual"]);
      const violations = compareActualEffects(
        actual,
        this.#challenge.scope,
        this.#challenge.budgets,
        this.#challenge.permissions.map(({ permission }) => permission),
      );
      const settledNow = readClock(this.#now);
      if (settledNow >= Date.parse(this.expiresAt)) {
        violations.push("authorization-expired");
        violations.sort(compareCanonicalText);
      }
      const scopeViolation = violations.length > 0;
      const effectiveUncertain = mutationUncertain || scopeViolation;
      if (effectiveUncertain) {
        this.#onUncertain(this.requestDigest);
      }
      const status = scopeViolation
        ? "scope-violation"
        : mutationUncertain
          ? "uncertain"
          : outcome;
      const settlement = Object.freeze({
        authorizationId: this.authorizationId,
        requestDigest: this.requestDigest,
        status,
        mutationUncertain: effectiveUncertain,
        violations: Object.freeze(violations),
        actual,
        settledAt: new Date(settledNow).toISOString(),
      });
      permissionSettlementInstances.add(settlement);
      return settlement;
    } catch (error) {
      if (this.#mutationPotential) {
        this.#onUncertain(this.requestDigest);
      }
      if (error instanceof CoreBoundaryError) {
        throw boundaryError(
          error.code,
          error.path,
          "settlement validation failed after authorization",
          this.#mutationPotential,
        );
      }
      throw boundaryError(
        "invalid-permission-request",
        "$settlement",
        "settlement validation failed after authorization",
        this.#mutationPotential,
      );
    }
  }
}

function normalizeActualEffects(value: unknown): PermissionActualEffects {
  const record = dataRecord(value, "$settlement.actual");
  const required = [
    "changedPaths",
    "changedBytes",
    "objectIds",
    "destinations",
    "dataClasses",
    "changeKinds",
    "publishTargets",
    "durationMs",
    "outputBytes",
    "repairCycles",
  ];
  exactKeys(
    record,
    [...required, "provider", "model", "cost"],
    required,
    "$settlement.actual",
  );
  const scope = normalizeScope(
    {
      paths: record["changedPaths"],
      objectIds: record["objectIds"],
      destinations: record["destinations"],
      dataClasses: record["dataClasses"],
      changeKinds: record["changeKinds"],
      publishTargets: record["publishTargets"],
      ...(record["provider"] === undefined ? {} : { provider: record["provider"] }),
      ...(record["model"] === undefined ? {} : { model: record["model"] }),
    },
    "$settlement.actual",
  );
  const cost =
    record["cost"] === undefined
      ? undefined
      : money(record["cost"], "$settlement.actual.cost");
  return Object.freeze({
    changedPaths: scope.paths,
    changedBytes: boundedInteger(
      record["changedBytes"],
      "$settlement.actual.changedBytes",
      0,
      1_099_511_627_776,
    ),
    objectIds: scope.objectIds,
    destinations: scope.destinations,
    dataClasses: scope.dataClasses,
    changeKinds: scope.changeKinds,
    ...(scope.provider === undefined ? {} : { provider: scope.provider }),
    ...(scope.model === undefined ? {} : { model: scope.model }),
    publishTargets: scope.publishTargets,
    durationMs: boundedInteger(
      record["durationMs"],
      "$settlement.actual.durationMs",
      0,
      604_800_000,
    ),
    outputBytes: boundedInteger(
      record["outputBytes"],
      "$settlement.actual.outputBytes",
      0,
      1_073_741_824,
    ),
    repairCycles: boundedInteger(
      record["repairCycles"],
      "$settlement.actual.repairCycles",
      0,
      3,
    ),
    ...(cost === undefined ? {} : { cost }),
  });
}

function subset(values: readonly string[], allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return values.every((value) => allowedSet.has(value));
}

function compareActualEffects(
  actual: PermissionActualEffects,
  scope: ApprovalGrantScope,
  budgets: ExecutionBudgets,
  permissions: readonly PermissionClass[],
): string[] {
  const violations: string[] = [];
  const hasPermission = (permission: PermissionClass): boolean =>
    permissions.includes(permission);
  const hasMutationAuthority = permissions.some((permission) =>
    MUTATION_PERMISSIONS.has(permission),
  );
  const hasFilesystemMutationAuthority = permissions.some((permission) =>
    FILESYSTEM_MUTATION_PERMISSIONS.has(permission),
  );
  const hasObjectMutationAuthority = permissions.some((permission) =>
    OBJECT_MUTATION_PERMISSIONS.has(permission),
  );
  const hasFilesystemEffects =
    actual.changedPaths.length > 0 ||
    actual.changedBytes > 0 ||
    actual.changeKinds.length > 0;
  const hasObjectEffects = actual.objectIds.length > 0;
  if (
    !hasMutationAuthority &&
    (hasFilesystemEffects || hasObjectEffects)
  ) {
    violations.push("undeclared-mutation");
  }
  if (hasFilesystemEffects && !hasFilesystemMutationAuthority) {
    violations.push("undeclared-filesystem-mutation");
  }
  if (hasObjectEffects && !hasObjectMutationAuthority) {
    violations.push("undeclared-editor-object-mutation");
  }
  if (!hasPermission("network") && actual.destinations.length > 0) {
    violations.push("undeclared-network");
  }
  if (
    !hasPermission("external-transmission") &&
    actual.dataClasses.length > 0
  ) {
    violations.push("undeclared-external-transmission");
  }
  if (
    !hasPermission("paid-call") &&
    (actual.provider !== undefined ||
      actual.model !== undefined ||
      actual.cost !== undefined)
  ) {
    violations.push("undeclared-paid-call");
  }
  if (!hasPermission("publish-release") && actual.publishTargets.length > 0) {
    violations.push("undeclared-publish");
  }
  if (!subset(actual.changedPaths, scope.paths)) violations.push("changed-path");
  if (!subset(actual.objectIds, scope.objectIds)) violations.push("object-id");
  if (!subset(actual.destinations, scope.destinations)) violations.push("destination");
  if (!subset(actual.dataClasses, scope.dataClasses)) violations.push("data-class");
  if (!subset(actual.changeKinds, scope.changeKinds)) violations.push("change-kind");
  if (!subset(actual.publishTargets, scope.publishTargets)) violations.push("publish-target");
  if (actual.provider !== undefined && actual.provider !== scope.provider) {
    violations.push("provider");
  }
  if (actual.model !== undefined && actual.model !== scope.model) {
    violations.push("model");
  }
  if (
    budgets.maxChangedFiles !== undefined &&
    actual.changedPaths.length > budgets.maxChangedFiles
  ) {
    violations.push("changed-file-budget");
  }
  if (
    budgets.maxChangedBytes !== undefined &&
    actual.changedBytes > budgets.maxChangedBytes
  ) {
    violations.push("changed-byte-budget");
  }
  if (actual.durationMs > budgets.maxDurationMs) violations.push("duration-budget");
  if (actual.outputBytes > budgets.maxOutputBytes) violations.push("output-budget");
  if (actual.repairCycles > budgets.maxRepairCycles) violations.push("repair-budget");
  if (actual.cost !== undefined) {
    if (
      budgets.maxCost === undefined ||
      actual.cost.currency !== budgets.maxCost.currency ||
      decimalMicros(actual.cost.amount) > decimalMicros(budgets.maxCost.amount)
    ) {
      violations.push("cost-budget");
    }
  }
  return violations.sort(compareCanonicalText);
}

class PermissionBrokerImplementation implements PermissionBroker {
  readonly #registry: ValidatedRegistry;
  readonly #project: PermissionBrokerProject;
  readonly #keys: ReadonlyMap<StableId, BoundApprovalKey>;
  readonly #now: () => number;
  readonly #grantUsage = new Map<StableId, GrantUsage>();
  readonly #uncertainRequests = new Set<Sha256Digest>();
  readonly #activeSideEffectAuthorizations = new Set<string>();

  constructor(options: PermissionBrokerOptions) {
    assertValidatedRegistry(options.registry);
    this.#registry = options.registry;
    const projectSnapshot = snapshotCanonical(options.project, "$options.project");
    const project = dataRecord(projectSnapshot, "$options.project");
    exactKeys(
      project,
      ["id", "identityDigest", "stage", "budgets"],
      ["id", "identityDigest", "stage", "budgets"],
      "$options.project",
    );
    if (
      typeof project["stage"] !== "string" ||
      !PROJECT_STAGES.has(project["stage"] as ProjectStage)
    ) {
      throw boundaryError(
        "invalid-permission-broker-options",
        "$options.project.stage",
        "unknown project stage",
      );
    }
    this.#project = Object.freeze({
      id: stableId(project["id"], "$options.project.id"),
      identityDigest: digest(
        project["identityDigest"],
        "$options.project.identityDigest",
      ),
      stage: project["stage"] as ProjectStage,
      budgets: normalizeBudgets(project["budgets"], "$options.project.budgets"),
    });
    const keySnapshot = snapshotCanonical(
      options.trustedApprovalKeys,
      "$options.trustedApprovalKeys",
    ) as readonly TrustedApprovalKey[];
    this.#keys = bindApprovalKeys(keySnapshot);
    if (options.now !== undefined && typeof options.now !== "function") {
      throw boundaryError(
        "invalid-permission-broker-options",
        "$options.now",
        "expected a clock function",
      );
    }
    this.#now = options.now ?? Date.now;
    const grantSchema = this.#registry.schemas.find(
      ({ schemaId }) => schemaId === approvalGrantSchema.schemaId,
    );
    if (grantSchema?.digest !== approvalGrantSchema.digest) {
      throw boundaryError(
        "invalid-permission-broker-options",
        "$options.registry",
        "approval grant schema is not registered with its exact digest",
      );
    }
  }

  prepare(
    request: PermissionAuthorizationRequest,
  ): PermissionAuthorizationChallenge {
    return this.#normalizeRequest(request).challenge;
  }

  authorize(
    request: PermissionAuthorizationRequest,
    grants: readonly ApprovalGrant[],
  ): PermissionAuthorizationDecision {
    const normalized = this.#normalizeRequest(request);
    if (
      normalized.mutationPotential &&
      this.#uncertainRequests.size > 0
    ) {
      throw boundaryError(
        "permission-reconciliation-required",
        "$request",
        "a prior mutation requires reconciliation before another mutation",
        true,
      );
    }
    if (
      normalized.mutationPotential &&
      this.#activeSideEffectAuthorizations.size > 0
    ) {
      throw boundaryError(
        "permission-lease-state-invalid",
        "$request",
        "a prior side-effect authorization has not been settled",
        true,
      );
    }
    let grantSnapshot: readonly ApprovalGrant[];
    try {
      grantSnapshot = snapshotCanonical(grants, "$grants") as readonly ApprovalGrant[];
    } catch {
      throw boundaryError(
        "permission-grant-invalid",
        "$grants",
        "expected canonical approval grant data",
      );
    }
    if (!Array.isArray(grantSnapshot) || grantSnapshot.length > 32) {
      throw boundaryError(
        "permission-grant-invalid",
        "$grants",
        "expected at most 32 approval grants",
      );
    }
    const required = normalized.challenge.permissions
      .filter(({ mode }) => mode === "approval-required")
      .map(({ permission }) => permission);
    const validated = grantSnapshot.map((grant, index) =>
      this.#validateGrant(grant, normalized.challenge, required, index),
    );
    const byPermission = new Map<PermissionClass, ApprovalGrant>();
    const ids = new Set<StableId>();
    const dispatchNow = readClock(this.#now);
    if (
      dispatchNow >= Date.parse(normalized.challenge.deadlineAt) ||
      validated.some(
        (grant) => Date.parse(grant.budgets.expiresAt) <= dispatchNow,
      )
    ) {
      throw boundaryError(
        "permission-grant-expired",
        "$grants",
        "request or approval expired during authorization",
      );
    }
    for (const grant of validated) {
      if (ids.has(grant.grantId) || byPermission.has(grant.permission)) {
        throw boundaryError(
          "permission-grant-ambiguous",
          "$grants",
          "grant IDs and permission bindings must be unique",
        );
      }
      ids.add(grant.grantId);
      byPermission.set(grant.permission, grant);
    }
    const missing = required.filter(
      (permission) => !byPermission.has(permission),
    );
    if (missing.length > 0) {
      return Object.freeze({
        status: "approval-required",
        challenge: normalized.challenge,
        missingPermissions: Object.freeze(missing),
      });
    }

    for (const grant of validated) {
      const signingDigest = computeApprovalGrantSigningDigest(grant);
      const usage = this.#grantUsage.get(grant.grantId);
      if (
        usage !== undefined &&
        usage.signingDigest !== signingDigest
      ) {
        throw boundaryError(
          "permission-grant-ambiguous",
          "$grants",
          "grant ID was already bound to a different signed body",
        );
      }
      if ((usage?.uses ?? 0) >= grant.budgets.maxUses) {
        throw boundaryError(
          "permission-grant-exhausted",
          "$grants",
          "approval grant use budget is exhausted",
        );
      }
    }
    for (const grant of validated) {
      const signingDigest = computeApprovalGrantSigningDigest(grant);
      const usage = this.#grantUsage.get(grant.grantId);
      this.#grantUsage.set(grant.grantId, {
        signingDigest,
        uses: (usage?.uses ?? 0) + 1,
      });
    }
    const now = dispatchNow;
    const grantExpiry = validated.reduce(
      (minimum, grant) => Math.min(minimum, Date.parse(grant.budgets.expiresAt)),
      Date.parse(normalized.challenge.deadlineAt),
    );
    const lease = new PermissionAuthorizationLeaseImplementation(
      normalized.challenge,
      validated.map(({ grantId }) => grantId).sort(compareCanonicalText),
      new Date(now).toISOString(),
      new Date(grantExpiry).toISOString(),
      normalized.mutationPotential,
      this.#now,
      (requestDigest) => this.#uncertainRequests.add(requestDigest),
      (authorizationId) =>
        this.#activeSideEffectAuthorizations.delete(authorizationId),
    );
    if (normalized.mutationPotential) {
      this.#activeSideEffectAuthorizations.add(lease.authorizationId);
    }
    return Object.freeze({
      status: "authorized",
      challenge: normalized.challenge,
      lease,
    });
  }

  #normalizeRequest(request: PermissionAuthorizationRequest): NormalizedRequest {
    const now = readClock(this.#now);
    const snapshot = snapshotCanonical(request, "$request");
    const record = dataRecord(snapshot, "$request");
    const required = [
      "runId",
      "projectId",
      "projectIdentityDigest",
      "commandId",
      "input",
      "scope",
      "budgets",
      "deadlineAt",
    ];
    exactKeys(
      record,
      [
        ...required,
        "featureContract",
        "workflow",
        "editorSessionIdentityDigest",
      ],
      required,
      "$request",
    );
    if (typeof record["runId"] !== "string" || !UUID_PATTERN.test(record["runId"])) {
      throw boundaryError(
        "invalid-permission-request",
        "$request.runId",
        "expected a canonical UUID",
      );
    }
    const projectId = stableId(record["projectId"], "$request.projectId");
    const projectIdentity = digest(
      record["projectIdentityDigest"],
      "$request.projectIdentityDigest",
    );
    if (
      projectId !== this.#project.id ||
      projectIdentity !== this.#project.identityDigest
    ) {
      throw boundaryError(
        "permission-project-mismatch",
        "$request.projectId",
        "request does not match the broker-bound project identity",
      );
    }
    const commandId = stableId(record["commandId"], "$request.commandId");
    const command = this.#registry.commands.find(({ id }) => id === commandId);
    if (command === undefined) {
      throw boundaryError(
        "permission-command-not-found",
        "$request.commandId",
        "command is not registered",
      );
    }
    if (!command.supportedStages.includes(this.#project.stage)) {
      throw boundaryError(
        "permission-stage-unsupported",
        "$request.commandId",
        "command does not support the current project stage",
      );
    }
    const workflow = normalizeWorkflow(record["workflow"], this.#registry, commandId);
    const feature = validateFeature(
      record["featureContract"],
      this.#registry,
      projectId,
      now,
    );
    const scope = normalizeScope(record["scope"], "$request.scope");
    const budgets = normalizeBudgets(record["budgets"], "$request.budgets");
    const editorSession =
      record["editorSessionIdentityDigest"] === undefined
        ? undefined
        : digest(
            record["editorSessionIdentityDigest"],
            "$request.editorSessionIdentityDigest",
          );
    validatePermissionScope(
      command.permissions,
      scope,
      budgets,
      feature,
      workflow,
      editorSession,
    );
    const ceilings = [this.#project.budgets, command.budgets];
    if (workflow !== undefined) {
      const descriptor = this.#registry.workflows.find(({ id }) => id === workflow.id);
      if (descriptor !== undefined) ceilings.push(descriptor.budgets);
    }
    if (feature !== undefined) ceilings.push(feature.budgets);
    if (ceilings.some((ceiling) => !budgetWithin(budgets, ceiling))) {
      throw boundaryError(
        "permission-budget-exceeded",
        "$request.budgets",
        "requested execution budget exceeds a project, command, workflow, or feature ceiling",
      );
    }
    if (budgets.maxDurationMs > command.timeoutMs) {
      throw boundaryError(
        "permission-budget-exceeded",
        "$request.budgets.maxDurationMs",
        "requested duration exceeds the command timeout",
      );
    }
    const deadlineAt = canonicalTimestamp(record["deadlineAt"], "$request.deadlineAt");
    const deadline = Date.parse(deadlineAt);
    if (deadline <= now || deadline - now > budgets.maxDurationMs) {
      throw boundaryError(
        "permission-budget-exceeded",
        "$request.deadlineAt",
        "deadline is expired or exceeds the requested duration budget",
      );
    }
    if (
      feature?.approval !== undefined &&
      deadline > Date.parse(feature.approval.expiresAt)
    ) {
      throw boundaryError(
        "permission-feature-invalid",
        "$request.deadlineAt",
        "request deadline exceeds feature approval expiry",
      );
    }
    let validatedInput: unknown;
    try {
      validatedInput = validateRegisteredContractValue(
        this.#registry,
        command.input,
        record["input"],
      );
    } catch {
      throw boundaryError(
        "permission-input-invalid",
        "$request.input",
        "command input does not satisfy its registered schema and digest",
      );
    }
    if (
      command.input.schemaId === featureContractSchema.schemaId &&
      command.input.digest === featureContractSchema.digest &&
      (feature === undefined ||
        canonicalizeJson(validatedInput) !== canonicalizeJson(feature))
    ) {
      throw boundaryError(
        "permission-feature-invalid",
        "$request.input",
        "feature-contract command input must equal the approved feature binding",
      );
    }
    const input = digestCanonicalJson(validatedInput);
    const featureBinding =
      feature === undefined
        ? undefined
        : Object.freeze({
            id: feature.featureId,
            contractDigest: computeFeatureContractApprovalDigest(feature),
          });
    const workflowStep =
      workflow === undefined
        ? undefined
        : this.#registry.workflows
            .find(({ id }) => id === workflow.id)
            ?.steps.find(({ id }) => id === workflow.stepId);
    const permissionEntries = Object.freeze(
      [...command.permissions]
        .sort(compareCanonicalText)
        .map((permission) =>
          Object.freeze({
            permission,
            mode:
              AUTOMATIC_PERMISSIONS.has(permission) &&
              !(permission === "test-build" && workflowStep?.approvalCheckpoint)
              ? ("automatic" as const)
              : ("approval-required" as const),
          }),
        ),
    );
    const digestSubject = {
      schemaVersion: "1.0.0",
      runId: record["runId"],
      project: { id: projectId, identityDigest: projectIdentity },
      command: {
        id: command.id,
        version: command.version,
        handlerDigest: command.handler.digest,
      },
      registryDigest: this.#registry.digest,
      inputDigest: input,
      ...(featureBinding === undefined ? {} : { feature: featureBinding }),
      ...(workflow === undefined ? {} : { workflow }),
      ...(editorSession === undefined
        ? {}
        : { editorSessionIdentityDigest: editorSession }),
      scope,
      budgets,
      deadlineAt,
    };
    const challenge = freezeChallenge({
      ...digestSubject,
      schemaVersion: "1.0.0",
      requestDigest: digestCanonicalJson(digestSubject),
      permissions: permissionEntries,
    } as PermissionAuthorizationChallenge);
    const mutationPotential =
      command.sideEffects.some(({ kind }) => kind !== "none") ||
      command.permissions.some((permission) => MUTATION_PERMISSIONS.has(permission));
    return { challenge, mutationPotential };
  }

  #validateGrant(
    value: ApprovalGrant,
    challenge: PermissionAuthorizationChallenge,
    required: readonly PermissionClass[],
    index: number,
  ): ApprovalGrant {
    let grant: ApprovalGrant;
    try {
      grant = validateRegisteredContractValue(
        this.#registry,
        {
          schemaId: approvalGrantSchema.schemaId,
          digest: approvalGrantSchema.digest,
        },
        value,
      ) as unknown as ApprovalGrant;
    } catch {
      throw boundaryError(
        "permission-grant-invalid",
        `$grants[${index}]`,
        "grant does not satisfy the registered approval schema",
      );
    }
    if (checkApprovalGrantSemantics(grant).length > 0) {
      throw boundaryError(
        "permission-grant-invalid",
        `$grants[${index}]`,
        "grant has invalid temporal or canonical semantics",
      );
    }
    if (!required.includes(grant.permission)) {
      throw boundaryError(
        "permission-grant-mismatch",
        `$grants[${index}].permission`,
        "grant permission is not required by this request",
      );
    }
    const key = this.#keys.get(grant.signature.keyId);
    const signature = Buffer.from(grant.signature.value, "base64url");
    if (
      key === undefined ||
      signature.length !== 64 ||
      signature.toString("base64url") !== grant.signature.value ||
      !verifySignature(
        null,
        Buffer.from(computeApprovalGrantSigningDigest(grant), "utf8"),
        key.publicKey,
        signature,
      )
    ) {
      throw boundaryError(
        "permission-grant-signature-invalid",
        `$grants[${index}].signature`,
        "approval signature is not valid for a trusted key",
      );
    }
    const now = readClock(this.#now);
    if (Date.parse(grant.approvedAt) > now || Date.parse(grant.budgets.expiresAt) <= now) {
      throw boundaryError(
        "permission-grant-expired",
        `$grants[${index}].budgets.expiresAt`,
        "approval is not currently valid",
      );
    }
    let expected: UnsignedApprovalGrant;
    try {
      expected = createApprovalGrantSubject(challenge, {
        grantId: grant.grantId,
        permission: grant.permission,
        approvedAt: grant.approvedAt,
        expiresAt: grant.budgets.expiresAt,
        maxUses: grant.budgets.maxUses,
      });
    } catch {
      throw boundaryError(
        "permission-grant-mismatch",
        `$grants[${index}]`,
        "grant cannot be bound to the current challenge",
      );
    }
    const { signature: _signature, ...actualSubject } = grant;
    if (canonicalizeJson(expected) !== canonicalizeJson(actualSubject)) {
      throw boundaryError(
        "permission-grant-mismatch",
        `$grants[${index}]`,
        "grant authority does not exactly match the current request",
      );
    }
    return grant;
  }
}

export function createPermissionBroker(
  options: PermissionBrokerOptions,
): PermissionBroker {
  if (options === null || typeof options !== "object") {
    throw boundaryError(
      "invalid-permission-broker-options",
      "$options",
      "expected permission broker options",
    );
  }
  return Object.freeze(new PermissionBrokerImplementation(options));
}
