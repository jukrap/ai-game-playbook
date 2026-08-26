import type { ComponentOutcome } from "./contract-vocabulary.js";
import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import { compareCanonicalText } from "./canonical-json.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import {
  parseSemanticVersion,
  type SemanticVersion,
} from "./semantic-version.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES: number = 16 * 1024;
export const GODOT_VERSION_PROBE_TARGET_VERSION: SemanticVersion =
  parseSemanticVersion("4.7.2").value;
export const GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS: "stable" = "stable";

export const GODOT_VERSION_PROBE_STATUSES: readonly [
  "cancelled",
  "invalid-output",
  "matched",
  "mismatched",
  "process-failed",
  "uncertain",
] = Object.freeze([
  "cancelled",
  "invalid-output",
  "matched",
  "mismatched",
  "process-failed",
  "uncertain",
] as const);

export const GODOT_VERSION_PROCESS_CODES: readonly [
  "process.exited-zero",
  "process.exit-nonzero",
  "process.signalled",
  "process.spawn-failed",
  "process.timed-out",
  "process.idle-timed-out",
  "process.output-limit",
  "process.cancelled",
  "process.termination-uncertain",
] = Object.freeze([
  "process.exited-zero",
  "process.exit-nonzero",
  "process.signalled",
  "process.spawn-failed",
  "process.timed-out",
  "process.idle-timed-out",
  "process.output-limit",
  "process.cancelled",
  "process.termination-uncertain",
] as const);

export const GODOT_VERSION_PROBE_CODES: readonly [
  ...typeof GODOT_VERSION_PROCESS_CODES,
  "godot-version-output-byte-limit",
  "godot-version-output-control-invalid",
  "godot-version-output-format-invalid",
  "godot-version-output-framing-invalid",
  "godot-version-diagnostic-output",
  "godot-version-target-match",
  "godot-version-target-mismatch",
] = Object.freeze([
  ...GODOT_VERSION_PROCESS_CODES,
  "godot-version-output-byte-limit",
  "godot-version-output-control-invalid",
  "godot-version-output-format-invalid",
  "godot-version-output-framing-invalid",
  "godot-version-diagnostic-output",
  "godot-version-target-match",
  "godot-version-target-mismatch",
] as const);

export type GodotVersionProbeStatus =
  (typeof GODOT_VERSION_PROBE_STATUSES)[number];
export type GodotVersionProcessCode =
  (typeof GODOT_VERSION_PROCESS_CODES)[number];
export type GodotVersionProbeCode =
  (typeof GODOT_VERSION_PROBE_CODES)[number];

export interface GodotVersionProbeCommandInput {
  readonly schemaVersion: "1.0.0";
  readonly engine: "godot";
  readonly statusDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectInspectionDigest: Sha256Digest;
  readonly executableDigest: Sha256Digest;
  readonly executableIdentityDigest: Sha256Digest;
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
}

export interface GodotVersionProbeProcessResult {
  readonly component: "process";
  readonly status: ComponentOutcome;
  readonly code: GodotVersionProcessCode;
  readonly message: string;
  readonly outer: {
    readonly status: ComponentOutcome;
    readonly exitCode?: number;
    readonly timedOut: boolean;
  };
  readonly mutationUncertain: boolean;
  readonly outputTruncated: boolean;
  readonly terminationConfirmed: boolean;
}

export interface GodotVersionProbeOutputAttestation {
  readonly stdoutDigest: Sha256Digest;
  readonly stderrDigest: Sha256Digest;
  readonly stdoutObservedBytes: number;
  readonly stderrObservedBytes: number;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface ParsedGodotVersionProbeOutput {
  readonly status: "parsed";
  readonly version: SemanticVersion;
  readonly releaseStatus: string;
  readonly qualifiers: readonly string[];
  readonly outputDigest: Sha256Digest;
  readonly exactTargetMatch: boolean;
}

export interface GodotVersionProbeExecution {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly processStarted: boolean;
}

export interface GodotVersionProbeAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status:
    | "succeeded"
    | "failed"
    | "cancelled"
    | "uncertain"
    | "scope-violation";
  readonly mutationUncertain: boolean;
  readonly violations: readonly StableId[];
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly settledAt: string;
}

export interface GodotVersionProbeDigestInput {
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
  readonly status: GodotVersionProbeStatus;
  readonly code: GodotVersionProbeCode;
  readonly process: GodotVersionProbeProcessResult;
  readonly output: GodotVersionProbeOutputAttestation;
  readonly version?: ParsedGodotVersionProbeOutput;
  readonly execution: GodotVersionProbeExecution;
  readonly isolation: {
    readonly filesystem: "not-enforced";
    readonly network: "not-enforced";
  };
  readonly authorization: GodotVersionProbeAuthorization;
}

export interface GodotVersionProbeReport extends GodotVersionProbeDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: "engine.version-probe";
  readonly probeDigest: Sha256Digest;
}

const componentOutcomes: readonly ComponentOutcome[] = Object.freeze([
  "not-run",
  "passed",
  "failed",
  "cancelled",
  "uncertain",
]);
const authorizationStatuses = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
  "scope-violation",
] as const);
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const outputFailureCodes = new Set<GodotVersionProbeCode>([
  "godot-version-output-byte-limit",
  "godot-version-output-control-invalid",
  "godot-version-output-format-invalid",
  "godot-version-output-framing-invalid",
  "godot-version-diagnostic-output",
]);
const processCodes = new Set<GodotVersionProbeCode>(GODOT_VERSION_PROCESS_CODES);

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

function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
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

function nonnegativeInteger(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
  );
}

function validateProcess(value: GodotVersionProbeProcessResult): void {
  if (
    !record(value) ||
    !exactKeys(value, [
      "code",
      "component",
      "message",
      "mutationUncertain",
      "outer",
      "outputTruncated",
      "status",
      "terminationConfirmed",
    ]) ||
    value.component !== "process" ||
    !componentOutcomes.includes(value.status) ||
    !GODOT_VERSION_PROCESS_CODES.includes(value.code) ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 500 ||
    typeof value.mutationUncertain !== "boolean" ||
    typeof value.outputTruncated !== "boolean" ||
    typeof value.terminationConfirmed !== "boolean" ||
    !record(value.outer) ||
    !exactKeys(value.outer, ["status", "timedOut"], ["exitCode"]) ||
    !componentOutcomes.includes(value.outer.status) ||
    value.outer.status !== value.status ||
    typeof value.outer.timedOut !== "boolean" ||
    (value.outer.exitCode !== undefined &&
      (!Number.isInteger(value.outer.exitCode) ||
        value.outer.exitCode < -2_147_483_648 ||
        value.outer.exitCode > 2_147_483_647))
  ) {
    throw new TypeError("Godot version probe process result is outside the contract");
  }
  const timedOut =
    value.code === "process.timed-out" ||
    value.code === "process.idle-timed-out";
  if (
    value.outer.timedOut !== timedOut ||
    (value.code === "process.exited-zero" &&
      (value.status !== "passed" || value.outer.exitCode !== 0)) ||
    (value.code === "process.exit-nonzero" &&
      (value.status !== "failed" ||
        value.outer.exitCode === undefined ||
        value.outer.exitCode === 0)) ||
    (value.code === "process.cancelled" && value.status !== "cancelled") ||
    (value.code === "process.termination-uncertain" &&
      value.status !== "uncertain") ||
    (["process.spawn-failed", "process.signalled", "process.timed-out",
      "process.idle-timed-out", "process.output-limit"].includes(value.code) &&
      value.status !== "failed") ||
    value.outputTruncated !== (value.code === "process.output-limit") ||
    value.terminationConfirmed !==
      (value.code !== "process.termination-uncertain") ||
    value.mutationUncertain !==
      ([
        "process.cancelled",
        "process.idle-timed-out",
        "process.output-limit",
        "process.termination-uncertain",
        "process.timed-out",
      ].includes(value.code))
  ) {
    throw new TypeError("Godot version probe process status contradicts its code");
  }
}

function validateOutput(value: GodotVersionProbeOutputAttestation): void {
  if (
    !record(value) ||
    !exactKeys(value, [
      "capturedBytes",
      "observedBytes",
      "stderrDigest",
      "stderrObservedBytes",
      "stdoutDigest",
      "stdoutObservedBytes",
      "truncated",
    ]) ||
    !isSha256Digest(value.stdoutDigest) ||
    !isSha256Digest(value.stderrDigest) ||
    !nonnegativeInteger(value.stdoutObservedBytes, Number.MAX_SAFE_INTEGER) ||
    !nonnegativeInteger(value.stderrObservedBytes, Number.MAX_SAFE_INTEGER) ||
    !nonnegativeInteger(value.capturedBytes, GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES) ||
    !nonnegativeInteger(value.observedBytes, Number.MAX_SAFE_INTEGER) ||
    typeof value.truncated !== "boolean" ||
    value.stdoutObservedBytes + value.stderrObservedBytes !== value.observedBytes ||
    value.capturedBytes > value.observedBytes ||
    (!value.truncated && value.capturedBytes !== value.observedBytes)
  ) {
    throw new TypeError("Godot version probe output attestation is contradictory");
  }
}

function validateVersion(
  value: ParsedGodotVersionProbeOutput,
  targetVersion: SemanticVersion,
  targetReleaseStatus: string,
  stdoutDigest: Sha256Digest,
): void {
  if (
    !record(value) ||
    !exactKeys(value, [
      "exactTargetMatch",
      "outputDigest",
      "qualifiers",
      "releaseStatus",
      "status",
      "version",
    ]) ||
    value.status !== "parsed" ||
    !semanticVersion(value.version) ||
    typeof value.releaseStatus !== "string" ||
    !/^[a-z][a-z0-9_]{0,31}$/u.test(value.releaseStatus) ||
    !Array.isArray(value.qualifiers) ||
    value.qualifiers.length < 1 ||
    value.qualifiers.length > 16 ||
    value.qualifiers.some(
      (qualifier) =>
        typeof qualifier !== "string" ||
        !/^[a-z0-9_+-]{1,64}$/u.test(qualifier),
    ) ||
    !isSha256Digest(value.outputDigest) ||
    value.outputDigest !== stdoutDigest ||
    typeof value.exactTargetMatch !== "boolean" ||
    value.exactTargetMatch !==
      (value.version === targetVersion &&
        value.releaseStatus === targetReleaseStatus)
  ) {
    throw new TypeError("Godot parsed version output is outside the contract");
  }
}

function validateDigestInput(input: GodotVersionProbeDigestInput): void {
  if (
    !record(input) ||
    !exactKeys(
      input,
      [
        "authorization",
        "code",
        "controlPlaneVersion",
        "executable",
        "execution",
        "isolation",
        "output",
        "process",
        "project",
        "registryDigest",
        "runId",
        "status",
        "targetReleaseStatus",
        "targetVersion",
      ],
      ["version"],
    ) ||
    !semanticVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    !uuidPattern.test(input.runId) ||
    !GODOT_VERSION_PROBE_STATUSES.includes(input.status) ||
    !GODOT_VERSION_PROBE_CODES.includes(input.code) ||
    input.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    input.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    !record(input.project) ||
    !exactKeys(input.project, [
      "id",
      "identityDigest",
      "inspectionDigest",
      "rootIdentityDigest",
    ]) ||
    !isStableId(input.project.id) ||
    !isSha256Digest(input.project.identityDigest) ||
    !isSha256Digest(input.project.rootIdentityDigest) ||
    !isSha256Digest(input.project.inspectionDigest) ||
    !record(input.executable) ||
    !exactKeys(input.executable, ["digest", "identityDigest"]) ||
    !isSha256Digest(input.executable.digest) ||
    !isSha256Digest(input.executable.identityDigest)
  ) {
    throw new TypeError("Godot version probe digest input has invalid identity");
  }
  validateProcess(input.process);
  validateOutput(input.output);
  if (input.output.truncated !== input.process.outputTruncated) {
    throw new TypeError("Godot version probe process and output truncation disagree");
  }
  if (
    !record(input.execution) ||
    !exactKeys(input.execution, [
      "durationMs",
      "endedAt",
      "processStarted",
      "startedAt",
    ]) ||
    !canonicalTimestamp(input.execution.startedAt) ||
    !canonicalTimestamp(input.execution.endedAt) ||
    Date.parse(input.execution.endedAt) < Date.parse(input.execution.startedAt) ||
    !nonnegativeInteger(input.execution.durationMs, 604_800_000) ||
    typeof input.execution.processStarted !== "boolean" ||
    input.execution.processStarted !== (input.process.code !== "process.spawn-failed") ||
    !record(input.isolation) ||
    !exactKeys(input.isolation, ["filesystem", "network"]) ||
    input.isolation.filesystem !== "not-enforced" ||
    input.isolation.network !== "not-enforced"
  ) {
    throw new TypeError("Godot version probe execution boundary is contradictory");
  }
  const authorization = input.authorization;
  if (
    !record(authorization) ||
    !exactKeys(authorization, [
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
    !authorizationStatuses.includes(authorization.status) ||
    typeof authorization.mutationUncertain !== "boolean" ||
    !Array.isArray(authorization.violations) ||
    authorization.violations.length > 32 ||
    authorization.violations.some((violation) => !isStableId(violation)) ||
    new Set(authorization.violations).size !== authorization.violations.length ||
    authorization.violations.some(
      (violation, index) =>
        index > 0 &&
        compareCanonicalText(authorization.violations[index - 1] as string, violation) >=
          0,
    ) ||
    !nonnegativeInteger(authorization.durationMs, 604_800_000) ||
    !nonnegativeInteger(authorization.outputBytes, Number.MAX_SAFE_INTEGER) ||
    authorization.durationMs < input.execution.durationMs ||
    authorization.outputBytes !== input.output.observedBytes ||
    !canonicalTimestamp(authorization.settledAt) ||
    Date.parse(authorization.settledAt) < Date.parse(input.execution.endedAt) ||
    (authorization.status === "scope-violation") !==
      (authorization.violations.length > 0) ||
    authorization.mutationUncertain !==
      (input.process.mutationUncertain ||
        authorization.status === "scope-violation" ||
        authorization.status === "uncertain")
  ) {
    throw new TypeError("Godot version probe authorization settlement is contradictory");
  }

  const versionExpected = input.status === "matched" || input.status === "mismatched";
  if (versionExpected !== (input.version !== undefined)) {
    throw new TypeError("Godot version probe status contradicts parsed version evidence");
  }
  if (input.version !== undefined) {
    validateVersion(
      input.version,
      input.targetVersion,
      input.targetReleaseStatus,
      input.output.stdoutDigest,
    );
  }
  const outcomeValid =
    (input.status === "matched" &&
      input.code === "godot-version-target-match" &&
      input.process.status === "passed" &&
      input.version?.exactTargetMatch === true) ||
    (input.status === "mismatched" &&
      input.code === "godot-version-target-mismatch" &&
      input.process.status === "passed" &&
      input.version?.exactTargetMatch === false) ||
    (input.status === "invalid-output" &&
      outputFailureCodes.has(input.code) &&
      input.process.status === "passed") ||
    (input.status === "process-failed" &&
      processCodes.has(input.code) &&
      input.process.status === "failed") ||
    (input.status === "cancelled" &&
      input.code === "process.cancelled" &&
      input.process.status === "cancelled") ||
    (input.status === "uncertain" &&
      input.code === "process.termination-uncertain" &&
      input.process.status === "uncertain");
  if (!outcomeValid) {
    throw new TypeError("Godot version probe status contradicts process evidence");
  }
  const expectedSettlement =
    input.process.mutationUncertain
      ? "uncertain"
      : input.status === "matched"
        ? "succeeded"
        : input.status === "cancelled"
          ? "cancelled"
          : input.status === "uncertain"
            ? "uncertain"
            : "failed";
  if (
    authorization.status !== expectedSettlement &&
    authorization.status !== "scope-violation"
  ) {
    throw new TypeError("Godot version probe settlement contradicts its outcome");
  }
}

export function computeGodotVersionProbeDigest(
  input: GodotVersionProbeDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-version-probe",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotVersionProbeReportSemantics(
  report: GodotVersionProbeReport,
): void {
  if (
    !record(report) ||
    !exactKeys(
      report,
      [
        "authorization",
        "code",
        "commandId",
        "controlPlaneVersion",
        "executable",
        "execution",
        "isolation",
        "output",
        "probeDigest",
        "process",
        "project",
        "registryDigest",
        "runId",
        "schemaVersion",
        "status",
        "targetReleaseStatus",
        "targetVersion",
      ],
      ["version"],
    ) ||
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.version-probe" ||
    !isSha256Digest(report.probeDigest)
  ) {
    throw new TypeError("Godot version probe report is outside the contract");
  }
  const { schemaVersion: _schemaVersion, commandId: _commandId, probeDigest, ...input } =
    report;
  if (
    probeDigest !== computeGodotVersionProbeDigest(input as GodotVersionProbeDigestInput)
  ) {
    throw new TypeError("Godot version probe digest does not attest its report");
  }
}

const commandInputProperties = {
  schemaVersion: reference("semanticVersion"),
  engine: { const: "godot" },
  statusDigest: reference("sha256Digest"),
  projectRootIdentityDigest: reference("sha256Digest"),
  projectInspectionDigest: reference("sha256Digest"),
  executableDigest: reference("sha256Digest"),
  executableIdentityDigest: reference("sha256Digest"),
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
} as const;

export const godotVersionProbeRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-version-probe-request",
    version: "1.0.0",
    title: "Godot Version Probe Request",
    description:
      "Binds one internal Godot version probe to prior project and executable identities without exposing local paths.",
    schema: contractRoot(commandInputProperties, Object.keys(commandInputProperties)),
  });

const processOuter = closedObject(
  {
    status: reference("componentOutcome"),
    exitCode: {
      type: "integer",
      minimum: -2_147_483_648,
      maximum: 2_147_483_647,
    },
    timedOut: { type: "boolean" },
  },
  ["status", "timedOut"],
);
const processResult = closedObject(
  {
    component: { const: "process" },
    status: reference("componentOutcome"),
    code: enumSchema(GODOT_VERSION_PROCESS_CODES),
    message: textSchema(500),
    outer: processOuter,
    mutationUncertain: { type: "boolean" },
    outputTruncated: { type: "boolean" },
    terminationConfirmed: { type: "boolean" },
  },
  [
    "component",
    "status",
    "code",
    "message",
    "outer",
    "mutationUncertain",
    "outputTruncated",
    "terminationConfirmed",
  ],
);
const outputAttestation = closedObject(
  {
    stdoutDigest: reference("sha256Digest"),
    stderrDigest: reference("sha256Digest"),
    stdoutObservedBytes: { type: "integer", minimum: 0 },
    stderrObservedBytes: { type: "integer", minimum: 0 },
    capturedBytes: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
    },
    observedBytes: { type: "integer", minimum: 0 },
    truncated: { type: "boolean" },
  },
  [
    "stdoutDigest",
    "stderrDigest",
    "stdoutObservedBytes",
    "stderrObservedBytes",
    "capturedBytes",
    "observedBytes",
    "truncated",
  ],
);
const parsedVersion = closedObject(
  {
    status: { const: "parsed" },
    version: reference("semanticVersion"),
    releaseStatus: {
      type: "string",
      pattern: "^[a-z][a-z0-9_]{0,31}$",
    },
    qualifiers: boundedArray(
      { type: "string", pattern: "^[a-z0-9_+-]{1,64}$" },
      { minimum: 1, maximum: 16 },
    ),
    outputDigest: reference("sha256Digest"),
    exactTargetMatch: { type: "boolean" },
  },
  [
    "status",
    "version",
    "releaseStatus",
    "qualifiers",
    "outputDigest",
    "exactTargetMatch",
  ],
);
const execution = closedObject(
  {
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
    durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
    processStarted: { type: "boolean" },
  },
  ["startedAt", "endedAt", "durationMs", "processStarted"],
);
const isolation = closedObject(
  {
    filesystem: { const: "not-enforced" },
    network: { const: "not-enforced" },
  },
  ["filesystem", "network"],
);
const authorization = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    status: enumSchema(authorizationStatuses),
    mutationUncertain: { type: "boolean" },
    violations: boundedArray(reference("stableId"), {
      maximum: 32,
      unique: true,
    }),
    durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
    outputBytes: { type: "integer", minimum: 0 },
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "durationMs",
    "outputBytes",
    "settledAt",
  ],
);
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
const reportProperties = {
  schemaVersion: reference("semanticVersion"),
  commandId: { const: "engine.version-probe" },
  controlPlaneVersion: reference("semanticVersion"),
  registryDigest: reference("sha256Digest"),
  runId: reference("uuid"),
  project,
  executable,
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  status: enumSchema(GODOT_VERSION_PROBE_STATUSES),
  code: enumSchema(GODOT_VERSION_PROBE_CODES),
  process: processResult,
  output: outputAttestation,
  version: parsedVersion,
  execution,
  isolation,
  authorization,
  probeDigest: reference("sha256Digest"),
} as const;

export const godotVersionProbeReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-version-probe-report",
    version: "1.0.0",
    title: "Godot Version Probe Report",
    description:
      "Reports one bounded Godot version process with output attestations, permission settlement, and explicit missing isolation.",
    schema: contractRoot(
      reportProperties,
      Object.keys(reportProperties).filter((key) => key !== "version"),
    ),
  });
