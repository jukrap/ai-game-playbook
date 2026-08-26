import { compareCanonicalText } from "./canonical-json.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  GODOT_VERSION_PROBE_STATUSES,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  type GodotVersionProbeStatus,
} from "./godot-version-probe-contracts.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { SemanticVersion } from "./semantic-version.js";
import { parseSemanticVersion } from "./semantic-version.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET = 2 as const;
export const GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES: number = 1024 * 1024;
export const GODOT_HEADLESS_PREFLIGHT_PROCESS_TIMEOUT_MS: number = 5_000;
export const GODOT_HEADLESS_PREFLIGHT_IDLE_TIMEOUT_MS: number = 3_000;
export const GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS: number = 1_000;
export const GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS: number = 10_000;

const invocationSubject = Object.freeze({
  workingDirectory: "bound-project-root" as const,
  arguments: Object.freeze([
    "--headless",
    "--no-header",
    "--quit-after",
    String(GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET),
  ]),
  environment: Object.freeze({}),
  limits: Object.freeze({
    timeoutMs: GODOT_HEADLESS_PREFLIGHT_PROCESS_TIMEOUT_MS,
    idleTimeoutMs: GODOT_HEADLESS_PREFLIGHT_IDLE_TIMEOUT_MS,
    maxOutputBytes: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    terminationGraceMs: GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  }),
});

export const GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-headless-preflight-invocation",
    version: "1.0.0",
    ...invocationSubject,
  });

export type GodotHeadlessPreflightBlocker =
  | "godot-headless-containment-unavailable"
  | "godot-headless-version-unverified";

export interface GodotHeadlessPreflightCommandInput {
  readonly schemaVersion: "1.0.0";
  readonly engine: "godot";
  readonly versionProbeDigest: Sha256Digest;
  readonly versionProbeStatus: GodotVersionProbeStatus;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectInspectionDigest: Sha256Digest;
  readonly executableDigest: Sha256Digest;
  readonly executableIdentityDigest: Sha256Digest;
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly mode: "dynamic-main-scene";
  readonly frameBudget: typeof GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET;
  readonly invocationDigest: Sha256Digest;
  readonly requirements: {
    readonly filesystem: "deny-project-writes";
    readonly network: "deny";
    readonly childProcesses: "deny";
  };
}

export interface GodotHeadlessPreflightAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status: "failed";
  readonly mutationUncertain: false;
  readonly violations: readonly StableId[];
  readonly approvalIds: readonly StableId[];
  readonly durationMs: number;
  readonly outputBytes: 0;
  readonly settledAt: string;
}

export interface GodotHeadlessPreflightReceiptPointer {
  readonly status: "retained";
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
}

export interface GodotHeadlessPreflightDigestInput {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
  };
  readonly executable: {
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
  };
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly versionProbe: {
    readonly digest: Sha256Digest;
    readonly status: GodotVersionProbeStatus;
    readonly exactTargetMatch: boolean;
  };
  readonly mode: "dynamic-main-scene";
  readonly frameBudget: typeof GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET;
  readonly invocationDigest: Sha256Digest;
  readonly status: "blocked";
  readonly code: GodotHeadlessPreflightBlocker;
  readonly blockers: readonly GodotHeadlessPreflightBlocker[];
  readonly preconditions: {
    readonly version: "passed" | "blocked";
    readonly containment: "blocked";
  };
  readonly isolation: {
    readonly filesystem: "unavailable";
    readonly network: "unavailable";
    readonly childProcesses: "unavailable";
    readonly writablePaths: readonly string[];
  };
  readonly execution: {
    readonly processStarted: false;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly authorization: GodotHeadlessPreflightAuthorization;
  readonly receipt: GodotHeadlessPreflightReceiptPointer;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "implemented";
    readonly reason: string;
  };
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
}

export interface GodotHeadlessPreflightReport
  extends GodotHeadlessPreflightDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: "engine.headless-preflight";
  readonly preflightDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function semanticVersion(value: unknown): value is SemanticVersion {
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function canonicalStableIds(value: unknown, maximum: number): value is StableId[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => isStableId(entry)) &&
    value.every(
      (entry, index) =>
        index === 0 ||
        compareCanonicalText(value[index - 1] as string, entry) < 0,
    )
  );
}

export function assertGodotHeadlessPreflightRequestSemantics(
  value: GodotHeadlessPreflightCommandInput,
): void {
  if (
    !record(value) ||
    !exactKeys(value, [
      "engine",
      "executableDigest",
      "executableIdentityDigest",
      "frameBudget",
      "invocationDigest",
      "mode",
      "projectInspectionDigest",
      "projectRootIdentityDigest",
      "requirements",
      "schemaVersion",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbeDigest",
      "versionProbeStatus",
    ]) ||
    value.schemaVersion !== "1.0.0" ||
    value.engine !== "godot" ||
    !isSha256Digest(value.versionProbeDigest) ||
    !GODOT_VERSION_PROBE_STATUSES.includes(value.versionProbeStatus) ||
    !isSha256Digest(value.projectRootIdentityDigest) ||
    !isSha256Digest(value.projectInspectionDigest) ||
    !isSha256Digest(value.executableDigest) ||
    !isSha256Digest(value.executableIdentityDigest) ||
    value.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    value.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    value.mode !== "dynamic-main-scene" ||
    value.frameBudget !== GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET ||
    value.invocationDigest !== GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    !record(value.requirements) ||
    !exactKeys(value.requirements, [
      "childProcesses",
      "filesystem",
      "network",
    ]) ||
    value.requirements.filesystem !== "deny-project-writes" ||
    value.requirements.network !== "deny" ||
    value.requirements.childProcesses !== "deny"
  ) {
    throw new TypeError("Godot headless preflight request is outside the contract");
  }
}

function validateDigestInput(input: GodotHeadlessPreflightDigestInput): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "authorization",
      "blockers",
      "code",
      "controlPlaneVersion",
      "executable",
      "execution",
      "externalProcessStarted",
      "frameBudget",
      "invocationDigest",
      "isolation",
      "mode",
      "mutationPerformed",
      "networkAccessPerformed",
      "preconditions",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
    ]) ||
    !semanticVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    !uuidPattern.test(input.runId) ||
    input.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    input.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    input.mode !== "dynamic-main-scene" ||
    input.frameBudget !== GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET ||
    input.invocationDigest !== GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    input.status !== "blocked" ||
    input.mutationPerformed ||
    input.externalProcessStarted ||
    input.networkAccessPerformed
  ) {
    throw new TypeError("Godot headless preflight report identity is invalid");
  }
  if (
    !record(input.project) ||
    !exactKeys(input.project, [
      "id",
      "identityDigest",
      "inspectionDigest",
      "rootIdentityDigest",
    ]) ||
    !isStableId(input.project.id) ||
    !isSha256Digest(input.project.identityDigest) ||
    input.project.identityDigest !== input.project.rootIdentityDigest ||
    !isSha256Digest(input.project.inspectionDigest) ||
    !record(input.executable) ||
    !exactKeys(input.executable, ["digest", "identityDigest"]) ||
    !isSha256Digest(input.executable.digest) ||
    !isSha256Digest(input.executable.identityDigest)
  ) {
    throw new TypeError("Godot headless preflight bindings are invalid");
  }
  if (
    !record(input.versionProbe) ||
    !exactKeys(input.versionProbe, ["digest", "exactTargetMatch", "status"]) ||
    !isSha256Digest(input.versionProbe.digest) ||
    !GODOT_VERSION_PROBE_STATUSES.includes(input.versionProbe.status) ||
    typeof input.versionProbe.exactTargetMatch !== "boolean"
  ) {
    throw new TypeError("Godot headless preflight blockers are contradictory");
  }
  const versionMatched =
    input.versionProbe.status === "matched" &&
    input.versionProbe.exactTargetMatch;
  if (
    input.versionProbe.exactTargetMatch !==
      (input.versionProbe.status === "matched") ||
    !canonicalStableIds(input.blockers, 2) ||
    input.blockers.length < 1 ||
    input.code !== input.blockers[0] ||
    !input.blockers.includes("godot-headless-containment-unavailable") ||
    input.blockers.includes("godot-headless-version-unverified") ===
      versionMatched
  ) {
    throw new TypeError("Godot headless preflight blockers are contradictory");
  }
  if (
    !record(input.preconditions) ||
    !exactKeys(input.preconditions, ["containment", "version"]) ||
    input.preconditions.version !== (versionMatched ? "passed" : "blocked") ||
    input.preconditions.containment !== "blocked" ||
    !record(input.isolation) ||
    !exactKeys(input.isolation, [
      "childProcesses",
      "filesystem",
      "network",
      "writablePaths",
    ]) ||
    input.isolation.filesystem !== "unavailable" ||
    input.isolation.network !== "unavailable" ||
    input.isolation.childProcesses !== "unavailable" ||
    !Array.isArray(input.isolation.writablePaths) ||
    input.isolation.writablePaths.length !== 0
  ) {
    throw new TypeError("Godot headless preflight containment is not fail-closed");
  }
  const execution = input.execution;
  if (
    !record(execution) ||
    !exactKeys(execution, [
      "durationMs",
      "endedAt",
      "processStarted",
      "startedAt",
    ]) ||
    execution.processStarted !== false ||
    !canonicalTimestamp(execution.startedAt) ||
    !canonicalTimestamp(execution.endedAt) ||
    Date.parse(execution.endedAt) < Date.parse(execution.startedAt) ||
    !boundedInteger(execution.durationMs, 0, 604_800_000) ||
    Date.parse(execution.endedAt) - Date.parse(execution.startedAt) !==
      execution.durationMs
  ) {
    throw new TypeError("Godot headless preflight timing is contradictory");
  }
  const authorization = input.authorization;
  if (
    !record(authorization) ||
    !exactKeys(authorization, [
      "approvalIds",
      "authorizationId",
      "durationMs",
      "mutationUncertain",
      "outputBytes",
      "requestDigest",
      "settledAt",
      "status",
      "violations",
    ]) ||
    !uuidPattern.test(authorization.authorizationId) ||
    !isSha256Digest(authorization.requestDigest) ||
    authorization.status !== "failed" ||
    authorization.mutationUncertain !== false ||
    !canonicalStableIds(authorization.violations, 32) ||
    authorization.violations.length !== 0 ||
    !canonicalStableIds(authorization.approvalIds, 128) ||
    authorization.approvalIds.length < 1 ||
    !boundedInteger(authorization.durationMs, 0, 604_800_000) ||
    authorization.durationMs !== execution.durationMs ||
    authorization.outputBytes !== 0 ||
    !canonicalTimestamp(authorization.settledAt) ||
    Date.parse(authorization.settledAt) < Date.parse(execution.endedAt)
  ) {
    throw new TypeError("Godot headless preflight authorization is contradictory");
  }
  const receipt = input.receipt;
  if (
    !record(receipt) ||
    !exactKeys(receipt, [
      "chainLength",
      "headDigest",
      "receiptDigest",
      "receiptId",
      "status",
    ]) ||
    receipt.status !== "retained" ||
    !uuidPattern.test(receipt.receiptId) ||
    !isSha256Digest(receipt.receiptDigest) ||
    !isSha256Digest(receipt.headDigest) ||
    !boundedInteger(receipt.chainLength, 1, 4096) ||
    !record(input.support) ||
    !exactKeys(input.support, ["evidenceGrade", "grade", "reason"]) ||
    input.support.grade !== "planned" ||
    input.support.evidenceGrade !== "implemented" ||
    typeof input.support.reason !== "string" ||
    input.support.reason.length < 1 ||
    input.support.reason.length > 500
  ) {
    throw new TypeError("Godot headless preflight retention or support is invalid");
  }
}

export function computeGodotHeadlessPreflightDigest(
  input: GodotHeadlessPreflightDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-headless-preflight",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotHeadlessPreflightReportSemantics(
  report: GodotHeadlessPreflightReport,
): void {
  if (
    !record(report) ||
    !exactKeys(report, [
      "authorization",
      "blockers",
      "code",
      "commandId",
      "controlPlaneVersion",
      "executable",
      "execution",
      "externalProcessStarted",
      "frameBudget",
      "invocationDigest",
      "isolation",
      "mode",
      "mutationPerformed",
      "networkAccessPerformed",
      "preconditions",
      "preflightDigest",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "schemaVersion",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
    ]) ||
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.headless-preflight" ||
    !isSha256Digest(report.preflightDigest)
  ) {
    throw new TypeError("Godot headless preflight report is outside the contract");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    preflightDigest,
    ...input
  } = report;
  if (
    preflightDigest !==
    computeGodotHeadlessPreflightDigest(
      input as GodotHeadlessPreflightDigestInput,
    )
  ) {
    throw new TypeError("Godot headless preflight digest does not attest its report");
  }
}

const requirements = closedObject(
  {
    filesystem: { const: "deny-project-writes" },
    network: { const: "deny" },
    childProcesses: { const: "deny" },
  },
  ["filesystem", "network", "childProcesses"],
);

const requestProperties = {
  schemaVersion: { const: "1.0.0" },
  engine: { const: "godot" },
  versionProbeDigest: reference("sha256Digest"),
  versionProbeStatus: enumSchema(GODOT_VERSION_PROBE_STATUSES),
  projectRootIdentityDigest: reference("sha256Digest"),
  projectInspectionDigest: reference("sha256Digest"),
  executableDigest: reference("sha256Digest"),
  executableIdentityDigest: reference("sha256Digest"),
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  mode: { const: "dynamic-main-scene" },
  frameBudget: { const: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET },
  invocationDigest: { const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST },
  requirements,
} as const;

const requestRequired = Object.freeze(Object.keys(requestProperties));

export const godotHeadlessPreflightRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-headless-preflight-request",
    version: "1.0.0",
    title: "Godot Headless Preflight Request",
    description:
      "Binds one internal Godot main-scene preflight admission to exact project, executable, version, invocation, and deny-by-default containment requirements.",
    schema: contractRoot(requestProperties, requestRequired),
  });

const project = closedObject(
  {
    id: reference("stableId"),
    identityDigest: reference("sha256Digest"),
    rootIdentityDigest: reference("sha256Digest"),
    inspectionDigest: reference("sha256Digest"),
  },
  ["id", "identityDigest", "rootIdentityDigest", "inspectionDigest"],
);

const executable = closedObject(
  {
    digest: reference("sha256Digest"),
    identityDigest: reference("sha256Digest"),
  },
  ["digest", "identityDigest"],
);

const versionProbe = closedObject(
  {
    digest: reference("sha256Digest"),
    status: enumSchema(GODOT_VERSION_PROBE_STATUSES),
    exactTargetMatch: { type: "boolean" },
  },
  ["digest", "status", "exactTargetMatch"],
);

const blocker = enumSchema([
  "godot-headless-containment-unavailable",
  "godot-headless-version-unverified",
]);

const preconditions = closedObject(
  {
    version: enumSchema(["passed", "blocked"]),
    containment: { const: "blocked" },
  },
  ["version", "containment"],
);

const isolation = closedObject(
  {
    filesystem: { const: "unavailable" },
    network: { const: "unavailable" },
    childProcesses: { const: "unavailable" },
    writablePaths: boundedArray(reference("portablePath"), { maximum: 0 }),
  },
  ["filesystem", "network", "childProcesses", "writablePaths"],
);

const execution = closedObject(
  {
    processStarted: { const: false },
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
  },
  ["processStarted", "startedAt", "endedAt", "durationMs"],
);

const authorization = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    status: { const: "failed" },
    mutationUncertain: { const: false },
    violations: boundedArray(reference("stableId"), {
      maximum: 0,
      unique: true,
    }),
    approvalIds: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 128,
      unique: true,
    }),
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
    outputBytes: { const: 0 },
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "approvalIds",
    "durationMs",
    "outputBytes",
    "settledAt",
  ],
);

const receipt = closedObject(
  {
    status: { const: "retained" },
    receiptId: reference("uuid"),
    receiptDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    chainLength: { type: "integer", minimum: 1, maximum: 4096 },
  },
  ["status", "receiptId", "receiptDigest", "headDigest", "chainLength"],
);

const support = closedObject(
  {
    grade: { const: "planned" },
    evidenceGrade: { const: "implemented" },
    reason: textSchema(500),
  },
  ["grade", "evidenceGrade", "reason"],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: "engine.headless-preflight" },
  controlPlaneVersion: reference("semanticVersion"),
  registryDigest: reference("sha256Digest"),
  runId: reference("uuid"),
  project,
  executable,
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  versionProbe,
  mode: { const: "dynamic-main-scene" },
  frameBudget: { const: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET },
  invocationDigest: { const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST },
  status: { const: "blocked" },
  code: blocker,
  blockers: boundedArray(blocker, { minimum: 1, maximum: 2, unique: true }),
  preconditions,
  isolation,
  execution,
  authorization,
  receipt,
  support,
  mutationPerformed: { const: false },
  externalProcessStarted: { const: false },
  networkAccessPerformed: { const: false },
  preflightDigest: reference("sha256Digest"),
} as const;

const reportRequired = Object.freeze(Object.keys(reportProperties));

export const godotHeadlessPreflightReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-headless-preflight-report",
    version: "1.0.0",
    title: "Godot Headless Preflight Report",
    description:
      "Retains a permission-bound blocked receipt when required Godot project-process containment is unavailable, without launching the engine or promoting support.",
    schema: contractRoot(reportProperties, reportRequired),
  });
