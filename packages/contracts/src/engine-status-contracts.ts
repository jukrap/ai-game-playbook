import { compareCanonicalText } from "./canonical-json.js";
import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  EngineId,
  EvidenceGrade,
  OperatingSystem,
} from "./contract-vocabulary.js";
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

export const ENGINE_STATUS_MAX_ISSUES: number = 64;
export const ENGINE_STATUS_MAX_EXECUTABLE_BYTES: number = 512 * 1024 * 1024;

export type EngineStatus = "ready" | "attention" | "blocked";
export type EngineStatusIssueSeverity = "attention" | "blocked";
export type EngineStatusProjectState =
  | "not-inspected"
  | "not-detected"
  | "partial"
  | "detected"
  | "ambiguous"
  | "blocked";
export type EngineStatusExecutableState =
  | "not-inspected"
  | "not-provided"
  | "not-found"
  | "invalid"
  | "candidate";
export type EngineStatusCompatibilityState =
  | "not-assessed"
  | "unverified"
  | "major-minor-match"
  | "major-minor-mismatch";
export type EngineStatusVersionPrecision = "exact" | "major-minor" | "unknown";

export interface EngineStatusRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
  readonly engine: "godot";
}

export interface EngineStatusVersionObservation {
  readonly raw?: string;
  readonly normalized?: SemanticVersion;
  readonly precision: EngineStatusVersionPrecision;
}

export interface EngineStatusProjectCandidate {
  readonly completeness: "complete" | "partial";
  readonly observationDigest: Sha256Digest;
  readonly version: EngineStatusVersionObservation;
}

export interface EngineStatusProjectObservation {
  readonly status: EngineStatusProjectState;
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly rootIdentityDigest?: Sha256Digest;
  readonly inspectionDigest?: Sha256Digest;
  readonly candidate?: EngineStatusProjectCandidate;
}

export interface EngineStatusExecutableCandidate {
  readonly label: string;
  readonly platform: OperatingSystem;
  readonly bytes: number;
  readonly digest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
}

export interface EngineStatusExecutableObservation {
  readonly status: EngineStatusExecutableState;
  readonly source: "none" | "explicit";
  readonly candidate?: EngineStatusExecutableCandidate;
  readonly versionProbePerformed: false;
}

export interface EngineStatusCompatibility {
  readonly targetVersion: SemanticVersion;
  readonly status: EngineStatusCompatibilityState;
  readonly reason: string;
}

export interface EngineStatusSupport {
  readonly grade: "planned";
  readonly evidenceGrade: Extract<
    EvidenceGrade,
    "documented" | "implemented" | "test-witnessed"
  >;
  readonly reason: string;
}

export interface EngineStatusIssue {
  readonly severity: EngineStatusIssueSeverity;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction: string;
  readonly path?: string;
}

export interface EngineStatusDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly engine: EngineId;
  readonly project: EngineStatusProjectObservation;
  readonly executable: EngineStatusExecutableObservation;
  readonly compatibility: EngineStatusCompatibility;
  readonly support: EngineStatusSupport;
  readonly issues: readonly EngineStatusIssue[];
}

export interface EngineStatusReport extends EngineStatusDigestInput {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "engine.status";
  readonly status: EngineStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly statusDigest: Sha256Digest;
  readonly mutationReady: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly editorControlPerformed: false;
}

const engines: readonly EngineId[] = Object.freeze(["godot", "unity", "unreal"]);
const projectStates: readonly EngineStatusProjectState[] = Object.freeze([
  "not-inspected",
  "not-detected",
  "partial",
  "detected",
  "ambiguous",
  "blocked",
]);
const executableStates: readonly EngineStatusExecutableState[] = Object.freeze([
  "not-inspected",
  "not-provided",
  "not-found",
  "invalid",
  "candidate",
]);
const compatibilityStates: readonly EngineStatusCompatibilityState[] =
  Object.freeze([
    "not-assessed",
    "unverified",
    "major-minor-match",
    "major-minor-mismatch",
  ]);
const issueSeverities: readonly EngineStatusIssueSeverity[] = Object.freeze([
  "attention",
  "blocked",
]);
const versionPrecisions: readonly EngineStatusVersionPrecision[] = Object.freeze([
  "exact",
  "major-minor",
  "unknown",
]);
const platforms: readonly OperatingSystem[] = Object.freeze([
  "windows",
  "linux",
  "macos",
]);

function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value).sort(compareCanonicalText);
  const allowed = [...required, ...optional].sort(compareCanonicalText);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.length >= required.length &&
    keys.length <= allowed.length &&
    keys.every((key) => allowed.includes(key))
  );
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function validVersion(value: unknown): value is SemanticVersion {
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function validateVersionObservation(value: EngineStatusVersionObservation): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, ["precision"], ["normalized", "raw"]) ||
    !versionPrecisions.includes(value.precision) ||
    (value.raw !== undefined && !validText(value.raw, 128)) ||
    (value.normalized !== undefined && !validVersion(value.normalized))
  ) {
    throw new TypeError("engine status project version is outside the contract");
  }
  const observed = value.raw !== undefined && value.normalized !== undefined;
  if ((value.precision === "unknown") === observed) {
    throw new TypeError("engine status project version contradicts its precision");
  }
}

function validateProject(value: EngineStatusProjectObservation): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(
      value,
      ["requestedPath", "status"],
      ["candidate", "canonicalPath", "inspectionDigest", "rootIdentityDigest"],
    ) ||
    !projectStates.includes(value.status) ||
    !validText(value.requestedPath, 32767)
  ) {
    throw new TypeError("engine status project observation is outside the contract");
  }
  const identityParts = [
    value.canonicalPath,
    value.rootIdentityDigest,
    value.inspectionDigest,
  ];
  const hasIdentity = identityParts.every((part) => part !== undefined);
  if (
    identityParts.some((part) => part !== undefined) !== hasIdentity ||
    (value.canonicalPath !== undefined && !validText(value.canonicalPath, 32767)) ||
    (value.rootIdentityDigest !== undefined &&
      !isSha256Digest(value.rootIdentityDigest)) ||
    (value.inspectionDigest !== undefined && !isSha256Digest(value.inspectionDigest))
  ) {
    throw new TypeError("engine status project identity is incomplete");
  }
  if (value.candidate !== undefined) {
    if (
      typeof value.candidate !== "object" ||
      value.candidate === null ||
      !exactKeys(value.candidate, [
        "completeness",
        "observationDigest",
        "version",
      ]) ||
      !["complete", "partial"].includes(value.candidate.completeness) ||
      !isSha256Digest(value.candidate.observationDigest)
    ) {
      throw new TypeError("engine status project candidate is outside the contract");
    }
    validateVersionObservation(value.candidate.version);
  }
  const candidateExpected = value.status === "detected" || value.status === "partial";
  if (
    (value.status === "not-inspected" && (hasIdentity || value.candidate !== undefined)) ||
    (["not-detected", "ambiguous"].includes(value.status) &&
      (!hasIdentity || value.candidate !== undefined)) ||
    (candidateExpected && (!hasIdentity || value.candidate === undefined)) ||
    (value.status === "detected" && value.candidate?.completeness !== "complete") ||
    (value.status === "partial" && value.candidate?.completeness !== "partial") ||
    (value.status === "blocked" && value.candidate !== undefined)
  ) {
    throw new TypeError("engine status project state contradicts its evidence");
  }
}

function validateExecutable(value: EngineStatusExecutableObservation): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(
      value,
      ["source", "status", "versionProbePerformed"],
      ["candidate"],
    ) ||
    !executableStates.includes(value.status) ||
    !["none", "explicit"].includes(value.source) ||
    value.versionProbePerformed !== false
  ) {
    throw new TypeError("engine status executable observation is outside the contract");
  }
  if (value.candidate !== undefined) {
    const candidate = value.candidate;
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !exactKeys(candidate, [
        "bytes",
        "digest",
        "identityDigest",
        "label",
        "platform",
      ]) ||
      !validText(candidate.label, 255) ||
      /[\\/]/u.test(candidate.label) ||
      !platforms.includes(candidate.platform) ||
      !Number.isSafeInteger(candidate.bytes) ||
      candidate.bytes < 1 ||
      candidate.bytes > ENGINE_STATUS_MAX_EXECUTABLE_BYTES ||
      !isSha256Digest(candidate.digest) ||
      !isSha256Digest(candidate.identityDigest)
    ) {
      throw new TypeError("engine status executable candidate is outside the contract");
    }
  }
  const validShape =
    (value.source === "none" &&
      ["not-inspected", "not-provided"].includes(value.status) &&
      value.candidate === undefined) ||
    (value.source === "explicit" &&
      ["not-inspected", "not-found", "invalid"].includes(value.status) &&
      value.candidate === undefined) ||
    (value.source === "explicit" &&
      value.status === "candidate" &&
      value.candidate !== undefined);
  if (!validShape) {
    throw new TypeError("engine status executable state contradicts its evidence");
  }
}

function expectedCompatibility(
  project: EngineStatusProjectObservation,
  targetVersion: SemanticVersion,
): EngineStatusCompatibilityState {
  if (project.candidate === undefined) return "not-assessed";
  const normalized = project.candidate.version.normalized;
  if (normalized === undefined) return "unverified";
  const projectVersion = parseSemanticVersion(normalized);
  const target = parseSemanticVersion(targetVersion);
  return projectVersion.major === target.major && projectVersion.minor === target.minor
    ? "major-minor-match"
    : "major-minor-mismatch";
}

function validateCompatibility(
  value: EngineStatusCompatibility,
  project: EngineStatusProjectObservation,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, ["reason", "status", "targetVersion"]) ||
    !validVersion(value.targetVersion) ||
    !compatibilityStates.includes(value.status) ||
    !validText(value.reason, 500)
  ) {
    throw new TypeError("engine status compatibility is outside the contract");
  }
  if (value.status !== expectedCompatibility(project, value.targetVersion)) {
    throw new TypeError("engine status compatibility contradicts project evidence");
  }
}

function validateSupport(value: EngineStatusSupport): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, ["evidenceGrade", "grade", "reason"]) ||
    value.grade !== "planned" ||
    !["documented", "implemented", "test-witnessed"].includes(
      value.evidenceGrade,
    ) ||
    !validText(value.reason, 500)
  ) {
    throw new TypeError(
      "engine status support grade cannot exceed planned without engine evidence",
    );
  }
}

function validateIssues(value: readonly EngineStatusIssue[]): void {
  if (!Array.isArray(value) || value.length > ENGINE_STATUS_MAX_ISSUES) {
    throw new RangeError("engine status issue count exceeds the contract");
  }
  let previousKey: string | undefined;
  const codes = new Set<string>();
  for (const issue of value) {
    if (
      typeof issue !== "object" ||
      issue === null ||
      !exactKeys(
        issue,
        ["code", "message", "nextAction", "severity"],
        ["path"],
      ) ||
      !issueSeverities.includes(issue.severity) ||
      !isStableId(issue.code) ||
      !validText(issue.message, 500) ||
      !validText(issue.nextAction, 500) ||
      (issue.path !== undefined && !validText(issue.path, 32767)) ||
      codes.has(issue.code)
    ) {
      throw new TypeError("engine status issue is outside the contract");
    }
    const key = `${issue.severity}/${issue.code}/${issue.path ?? ""}`;
    if (previousKey !== undefined && compareCanonicalText(previousKey, key) >= 0) {
      throw new TypeError("engine status issues must be uniquely ordered");
    }
    codes.add(issue.code);
    previousKey = key;
  }
}

function validateDigestInput(input: EngineStatusDigestInput): void {
  if (
    typeof input !== "object" ||
    input === null ||
    !exactKeys(input, [
      "compatibility",
      "engine",
      "executable",
      "issues",
      "project",
      "registryDigest",
      "support",
    ]) ||
    !isSha256Digest(input.registryDigest) ||
    !engines.includes(input.engine)
  ) {
    throw new TypeError("engine status digest input has invalid authority");
  }
  validateProject(input.project);
  validateExecutable(input.executable);
  validateCompatibility(input.compatibility, input.project);
  validateSupport(input.support);
  validateIssues(input.issues);
}

export function computeEngineStatusStatus(
  issues: readonly EngineStatusIssue[],
): EngineStatus {
  validateIssues(issues);
  if (issues.some(({ severity }) => severity === "blocked")) return "blocked";
  if (issues.some(({ severity }) => severity === "attention")) return "attention";
  return "ready";
}

export function computeEngineStatusDigest(
  input: EngineStatusDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-status",
    version: "1.0.0",
    ...input,
  });
}

export function assertEngineStatusReportSemantics(
  report: EngineStatusReport,
): void {
  if (
    typeof report !== "object" ||
    report === null ||
    !exactKeys(report, [
      "commandId",
      "compatibility",
      "controlPlaneVersion",
      "editorControlPerformed",
      "engine",
      "executable",
      "externalProcessStarted",
      "issues",
      "mutationPerformed",
      "mutationReady",
      "networkAccessPerformed",
      "project",
      "registryDigest",
      "schemaVersion",
      "status",
      "statusDigest",
      "support",
    ]) ||
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.status" ||
    !validVersion(report.controlPlaneVersion) ||
    !["ready", "attention", "blocked"].includes(report.status) ||
    report.mutationReady !== false ||
    report.mutationPerformed !== false ||
    report.externalProcessStarted !== false ||
    report.networkAccessPerformed !== false ||
    report.editorControlPerformed !== false
  ) {
    throw new TypeError("engine status report is outside the read-only contract");
  }
  const input: EngineStatusDigestInput = {
    registryDigest: report.registryDigest,
    engine: report.engine,
    project: report.project,
    executable: report.executable,
    compatibility: report.compatibility,
    support: report.support,
    issues: report.issues,
  };
  validateDigestInput(input);
  if (report.status !== computeEngineStatusStatus(report.issues)) {
    throw new TypeError("engine status does not match its issues");
  }
  if (report.status === "ready") {
    if (
      report.project.status !== "detected" ||
      report.executable.status !== "candidate" ||
      report.compatibility.status !== "major-minor-match"
    ) {
      throw new TypeError("ready engine status lacks complete static identity");
    }
  } else if (report.issues.length === 0) {
    throw new TypeError("non-ready engine status must preserve an issue");
  }
  if (report.statusDigest !== computeEngineStatusDigest(input)) {
    throw new TypeError("engine status digest does not attest its observations");
  }
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const versionObservation = closedObject(
  {
    raw: textSchema(128),
    normalized: reference("semanticVersion"),
    precision: enumSchema(versionPrecisions),
  },
  ["precision"],
);

const projectCandidate = closedObject(
  {
    completeness: enumSchema(["complete", "partial"]),
    observationDigest: reference("sha256Digest"),
    version: versionObservation,
  },
  ["completeness", "observationDigest", "version"],
);

const projectObservation = closedObject(
  {
    status: enumSchema(projectStates),
    requestedPath: localPath,
    canonicalPath: localPath,
    rootIdentityDigest: reference("sha256Digest"),
    inspectionDigest: reference("sha256Digest"),
    candidate: projectCandidate,
  },
  ["status", "requestedPath"],
);

const executableCandidate = closedObject(
  {
    label: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      pattern: "^[^\\u0000-\\u001F\\u007F\\\\/]+$",
    },
    platform: enumSchema(platforms),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: ENGINE_STATUS_MAX_EXECUTABLE_BYTES,
    },
    digest: reference("sha256Digest"),
    identityDigest: reference("sha256Digest"),
  },
  ["label", "platform", "bytes", "digest", "identityDigest"],
);

const executableObservation = closedObject(
  {
    status: enumSchema(executableStates),
    source: enumSchema(["none", "explicit"]),
    candidate: executableCandidate,
    versionProbePerformed: { const: false },
  },
  ["status", "source", "versionProbePerformed"],
);

const compatibility = closedObject(
  {
    targetVersion: reference("semanticVersion"),
    status: enumSchema(compatibilityStates),
    reason: textSchema(500),
  },
  ["targetVersion", "status", "reason"],
);

const support = closedObject(
  {
    grade: { const: "planned" },
    evidenceGrade: enumSchema(["documented", "implemented", "test-witnessed"]),
    reason: textSchema(500),
  },
  ["grade", "evidenceGrade", "reason"],
);

const issue = closedObject(
  {
    severity: enumSchema(issueSeverities),
    code: reference("stableId"),
    message: textSchema(500),
    nextAction: textSchema(500),
    path: localPath,
  },
  ["severity", "code", "message", "nextAction"],
);

export const engineStatusRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-status-request",
    version: "1.0.0",
    title: "Engine Status Request",
    description:
      "Selects one project and the static Godot adapter for bounded status inspection without host-tool input.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
        engine: { const: "godot" },
      },
      ["schemaVersion", "projectRoot", "engine"],
    ),
  });

export const engineStatusReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-status-report",
    version: "1.0.0",
    title: "Engine Status Report",
    description:
      "Reports static project and executable-candidate identity without engine execution or support promotion.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "engine.status" },
        status: enumSchema(["ready", "attention", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        engine: reference("engineId"),
        project: projectObservation,
        executable: executableObservation,
        compatibility,
        support,
        issues: boundedArray(issue, { maximum: ENGINE_STATUS_MAX_ISSUES }),
        statusDigest: reference("sha256Digest"),
        mutationReady: { const: false },
        mutationPerformed: { const: false },
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
        editorControlPerformed: { const: false },
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "engine",
        "project",
        "executable",
        "compatibility",
        "support",
        "issues",
        "statusDigest",
        "mutationReady",
        "mutationPerformed",
        "externalProcessStarted",
        "networkAccessPerformed",
        "editorControlPerformed",
      ],
    ),
  });
