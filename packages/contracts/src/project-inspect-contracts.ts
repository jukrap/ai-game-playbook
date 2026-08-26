import {
  defineContractSchema,
  type JsonSchemaObject,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type {
  EngineId,
} from "./contract-vocabulary.js";
import {
  compareCanonicalText,
} from "./canonical-json.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  isPortableProjectPath,
  type PortableProjectPath,
} from "./portable-path.js";
import {
  gameProjectProfileSchema,
  type GameProjectProfile,
} from "./project-engine-contracts.js";
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
import {
  isStableId,
  type StableId,
} from "./stable-id.js";

export const PROJECT_INSPECT_MAX_ENGINE_CANDIDATES = 16;
export const PROJECT_INSPECT_MAX_ENGINE_MARKERS = 16;
export const PROJECT_INSPECT_MAX_INSTANCE_SIGNALS = 16;
export const PROJECT_INSPECT_MAX_ISSUES = 64;

export type ProjectInspectStatus = "ready" | "attention" | "blocked";
export type ProjectEngineCandidateCompleteness = "complete" | "partial";
export type ProjectEngineVersionPrecision =
  | "exact"
  | "major-minor"
  | "unknown";
export type ProjectEngineAssessmentStatus =
  | "not-inspected"
  | "none"
  | "partial"
  | "detected"
  | "ambiguous";
export type ProjectProfileAssessmentStatus =
  | "not-inspected"
  | "missing"
  | "valid"
  | "invalid"
  | "mismatch";
export type ProjectDirtyStateStatus =
  | "not-inspected"
  | "not-versioned"
  | "unknown";
export type ProjectDirtyStateSource = "none" | "marker-only";
export type ProjectInstanceAssessmentStatus =
  | "not-inspected"
  | "not-observed"
  | "unbound-signal";
export type ProjectInspectIssueSeverity = "attention" | "blocked";

export interface ProjectInspectRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface ProjectEngineMarkerObservation {
  readonly path: PortableProjectPath;
  readonly kind: "directory" | "file";
  readonly digest?: Sha256Digest;
}

export interface ProjectEngineVersionObservation {
  readonly raw?: string;
  readonly normalized?: SemanticVersion;
  readonly precision: ProjectEngineVersionPrecision;
}

export interface ProjectEngineCandidateDigestInput {
  readonly engine: EngineId;
  readonly completeness: ProjectEngineCandidateCompleteness;
  readonly markers: readonly ProjectEngineMarkerObservation[];
  readonly version: ProjectEngineVersionObservation;
}

export interface ProjectEngineCandidate
  extends ProjectEngineCandidateDigestInput {
  readonly observationDigest: Sha256Digest;
}

export interface ProjectEngineAssessment {
  readonly status: ProjectEngineAssessmentStatus;
  readonly candidates: readonly ProjectEngineCandidate[];
}

export interface ProjectProfileAssessment {
  readonly status: ProjectProfileAssessmentStatus;
  readonly path: ".ai-game-playbook/profile.json";
  readonly fileDigest?: Sha256Digest;
  readonly candidateDigest?: Sha256Digest;
  readonly candidate?: GameProjectProfile;
  readonly reason: string;
}

export interface ProjectDirtyStateAssessment {
  readonly status: ProjectDirtyStateStatus;
  readonly source: ProjectDirtyStateSource;
  readonly markerPath?: ".git";
  readonly reason: string;
}

export interface ProjectInstanceSignal {
  readonly engine: EngineId;
  readonly path: PortableProjectPath;
  readonly kind: "editor-state" | "lock";
  readonly digest?: Sha256Digest;
}

export interface ProjectInstanceAssessment {
  readonly status: ProjectInstanceAssessmentStatus;
  readonly selectionAllowed: false;
  readonly signals: readonly ProjectInstanceSignal[];
  readonly reason: string;
}

export interface ProjectInspectIssue {
  readonly severity: ProjectInspectIssueSeverity;
  readonly code: StableId;
  readonly path?: string;
  readonly message: string;
  readonly nextAction: string;
}

export interface ProjectInspectProjectSummary {
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly rootIdentityDigest?: Sha256Digest;
}

export interface ProjectInspectionReportFields {
  readonly project: ProjectInspectProjectSummary;
  readonly engine: ProjectEngineAssessment;
  readonly profile: ProjectProfileAssessment;
  readonly dirtyState: ProjectDirtyStateAssessment;
  readonly instances: ProjectInstanceAssessment;
  readonly issues: readonly ProjectInspectIssue[];
}

export interface ProjectInspectionSummary {
  readonly engineCandidates: number;
  readonly completeEngineCandidates: number;
  readonly attentionIssues: number;
  readonly blockedIssues: number;
}

export interface ProjectInspectionDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly engine: ProjectEngineAssessment;
  readonly profile: ProjectProfileAssessment;
  readonly dirtyState: ProjectDirtyStateAssessment;
  readonly instances: ProjectInstanceAssessment;
  readonly issues: readonly ProjectInspectIssue[];
}

export interface ProjectInspectReport
  extends ProjectInspectionReportFields {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "project.inspect";
  readonly status: ProjectInspectStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly summary: ProjectInspectionSummary;
  readonly inspectionDigest?: Sha256Digest;
  readonly mutationReady: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
}

export interface GameProjectIdentityDigestInput {
  readonly projectId: StableId;
  readonly engine: {
    readonly id: EngineId;
    readonly version: SemanticVersion;
  };
}

const engineIds: readonly EngineId[] = Object.freeze([
  "godot",
  "unity",
  "unreal",
]);
const engineAssessmentStatuses: readonly ProjectEngineAssessmentStatus[] =
  Object.freeze([
    "not-inspected",
    "none",
    "partial",
    "detected",
    "ambiguous",
  ]);
const profileAssessmentStatuses: readonly ProjectProfileAssessmentStatus[] =
  Object.freeze([
    "not-inspected",
    "missing",
    "valid",
    "invalid",
    "mismatch",
  ]);
const dirtyStateStatuses: readonly ProjectDirtyStateStatus[] = Object.freeze([
  "not-inspected",
  "not-versioned",
  "unknown",
]);
const dirtyStateSources: readonly ProjectDirtyStateSource[] = Object.freeze([
  "none",
  "marker-only",
]);
const instanceAssessmentStatuses: readonly ProjectInstanceAssessmentStatus[] =
  Object.freeze(["not-inspected", "not-observed", "unbound-signal"]);
const issueSeverities: readonly ProjectInspectIssueSeverity[] = Object.freeze([
  "attention",
  "blocked",
]);

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function validateVersionObservation(
  value: ProjectEngineVersionObservation,
): void {
  if (!isPlainObject(value)) {
    throw new TypeError("engine version observation is not an object");
  }
  const expectedKeys = [
    ...(value.raw === undefined ? [] : ["raw"]),
    ...(value.normalized === undefined ? [] : ["normalized"]),
    "precision",
  ];
  if (
    !objectHasExactKeys(value, expectedKeys) ||
    !["exact", "major-minor", "unknown"].includes(value.precision) ||
    (value.raw !== undefined && !isBoundedText(value.raw, 128))
  ) {
    throw new TypeError("engine version observation is outside the contract");
  }
  if (value.normalized !== undefined) {
    parseSemanticVersion(value.normalized);
  }
  if (
    value.precision === "unknown" ? value.normalized !== undefined :
      value.raw === undefined || value.normalized === undefined
  ) {
    throw new TypeError("engine version precision contradicts its evidence");
  }
}

function validateMarkers(
  markers: readonly ProjectEngineMarkerObservation[],
): void {
  if (
    !Array.isArray(markers) ||
    markers.length === 0 ||
    markers.length > PROJECT_INSPECT_MAX_ENGINE_MARKERS
  ) {
    throw new TypeError("engine marker count is outside the contract");
  }
  let previous: string | undefined;
  const portableNames = new Set<string>();
  for (const marker of markers) {
    if (!isPlainObject(marker)) {
      throw new TypeError("engine marker is not an object");
    }
    const expectedKeys = [
      ...(marker.digest === undefined ? [] : ["digest"]),
      "kind",
      "path",
    ];
    if (
      !objectHasExactKeys(marker, expectedKeys) ||
      !isPortableProjectPath(marker.path) ||
      !["directory", "file"].includes(marker.kind) ||
      (marker.digest !== undefined && !isSha256Digest(marker.digest)) ||
      (marker.kind === "file") !== (marker.digest !== undefined)
    ) {
      throw new TypeError("engine marker is outside the contract");
    }
    const folded = marker.path.toLowerCase();
    if (
      portableNames.has(folded) ||
      (previous !== undefined && compareCanonicalText(previous, marker.path) >= 0)
    ) {
      throw new TypeError("engine markers must be portable, unique, and ordered");
    }
    portableNames.add(folded);
    previous = marker.path;
  }
}

function validateCandidateDigestInput(
  value: ProjectEngineCandidateDigestInput,
): void {
  if (
    !isPlainObject(value) ||
    !objectHasExactKeys(value, [
      "completeness",
      "engine",
      "markers",
      "version",
    ]) ||
    !engineIds.includes(value.engine) ||
    !["complete", "partial"].includes(value.completeness)
  ) {
    throw new TypeError("engine candidate digest input is outside the contract");
  }
  validateMarkers(value.markers);
  validateVersionObservation(value.version);
}

function validateEngineAssessment(value: ProjectEngineAssessment): void {
  if (
    !isPlainObject(value) ||
    !objectHasExactKeys(value, ["candidates", "status"]) ||
    !engineAssessmentStatuses.includes(value.status) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > PROJECT_INSPECT_MAX_ENGINE_CANDIDATES
  ) {
    throw new TypeError("engine assessment is outside the contract");
  }
  const seen = new Set<string>();
  let complete = 0;
  for (const candidate of value.candidates) {
    if (
      !isPlainObject(candidate) ||
      !objectHasExactKeys(candidate, [
        "completeness",
        "engine",
        "markers",
        "observationDigest",
        "version",
      ]) ||
      !isSha256Digest(candidate.observationDigest)
    ) {
      throw new TypeError("engine candidate is outside the contract");
    }
    const subject: ProjectEngineCandidateDigestInput = {
      engine: candidate.engine,
      completeness: candidate.completeness,
      markers: candidate.markers,
      version: candidate.version,
    };
    validateCandidateDigestInput(subject);
    if (
      candidate.observationDigest !==
      computeProjectEngineCandidateDigest(subject)
    ) {
      throw new TypeError("engine candidate digest is invalid");
    }
    if (seen.has(candidate.observationDigest)) {
      throw new TypeError("engine candidates must have unique observations");
    }
    seen.add(candidate.observationDigest);
    if (candidate.completeness === "complete") {
      complete += 1;
    }
  }
  const validShape =
    ((value.status === "not-inspected" || value.status === "none") &&
      value.candidates.length === 0) ||
    (value.status === "partial" &&
      value.candidates.length === 1 &&
      complete === 0) ||
    (value.status === "detected" &&
      value.candidates.length === 1 &&
      complete === 1) ||
    (value.status === "ambiguous" && value.candidates.length > 1);
  if (!validShape) {
    throw new TypeError("engine assessment status contradicts its candidates");
  }
}

function validateProfileAssessment(value: ProjectProfileAssessment): void {
  if (!isPlainObject(value)) {
    throw new TypeError("profile assessment is not an object");
  }
  const expectedKeys = [
    ...(value.candidate === undefined ? [] : ["candidate"]),
    ...(value.candidateDigest === undefined ? [] : ["candidateDigest"]),
    ...(value.fileDigest === undefined ? [] : ["fileDigest"]),
    "path",
    "reason",
    "status",
  ];
  if (
    !objectHasExactKeys(value, expectedKeys) ||
    !profileAssessmentStatuses.includes(value.status) ||
    value.path !== ".ai-game-playbook/profile.json" ||
    !isBoundedText(value.reason, 500) ||
    (value.fileDigest !== undefined && !isSha256Digest(value.fileDigest)) ||
    (value.candidateDigest !== undefined &&
      !isSha256Digest(value.candidateDigest))
  ) {
    throw new TypeError("profile assessment is outside the contract");
  }
  const hasCandidate = value.candidate !== undefined;
  if (
    hasCandidate !== (value.candidateDigest !== undefined) ||
    (["valid", "mismatch"].includes(value.status) !== hasCandidate) ||
    (["valid", "invalid", "mismatch"].includes(value.status) !==
      (value.fileDigest !== undefined))
  ) {
    throw new TypeError("profile assessment status contradicts its evidence");
  }
  if (value.candidate !== undefined) {
    if (value.candidateDigest !== digestCanonicalJson(value.candidate)) {
      throw new TypeError("profile candidate digest is invalid");
    }
    if (
      value.status === "valid" &&
      value.candidate.engine.projectIdentityDigest !==
        computeGameProjectIdentityDigest({
          projectId: value.candidate.projectId,
          engine: {
            id: value.candidate.engine.id,
            version: value.candidate.engine.version,
          },
        })
    ) {
      throw new TypeError("valid profile has an invalid project identity");
    }
  }
}

function validateDirtyState(value: ProjectDirtyStateAssessment): void {
  if (!isPlainObject(value)) {
    throw new TypeError("dirty-state assessment is not an object");
  }
  const expectedKeys = [
    ...(value.markerPath === undefined ? [] : ["markerPath"]),
    "reason",
    "source",
    "status",
  ];
  if (
    !objectHasExactKeys(value, expectedKeys) ||
    !dirtyStateStatuses.includes(value.status) ||
    !dirtyStateSources.includes(value.source) ||
    !isBoundedText(value.reason, 500)
  ) {
    throw new TypeError("dirty-state assessment is outside the contract");
  }
  const markerOnly =
    value.status === "unknown" &&
    value.source === "marker-only" &&
    value.markerPath === ".git";
  const noMarker =
    ["not-inspected", "not-versioned"].includes(value.status) &&
    value.source === "none" &&
    value.markerPath === undefined;
  if (!markerOnly && !noMarker) {
    throw new TypeError("dirty-state source contradicts its observation");
  }
}

function validateInstanceAssessment(value: ProjectInstanceAssessment): void {
  if (
    !isPlainObject(value) ||
    !objectHasExactKeys(value, [
      "reason",
      "selectionAllowed",
      "signals",
      "status",
    ]) ||
    !instanceAssessmentStatuses.includes(value.status) ||
    value.selectionAllowed !== false ||
    !Array.isArray(value.signals) ||
    value.signals.length > PROJECT_INSPECT_MAX_INSTANCE_SIGNALS ||
    !isBoundedText(value.reason, 500)
  ) {
    throw new TypeError("instance assessment is outside the contract");
  }
  for (const signal of value.signals) {
    if (!isPlainObject(signal)) {
      throw new TypeError("instance signal is not an object");
    }
    const expectedKeys = [
      ...(signal.digest === undefined ? [] : ["digest"]),
      "engine",
      "kind",
      "path",
    ];
    if (
      !objectHasExactKeys(signal, expectedKeys) ||
      !engineIds.includes(signal.engine) ||
      !isPortableProjectPath(signal.path) ||
      !["editor-state", "lock"].includes(signal.kind) ||
      (signal.digest !== undefined && !isSha256Digest(signal.digest))
    ) {
      throw new TypeError("instance signal is outside the contract");
    }
  }
  if (
    (value.status === "unbound-signal") !== (value.signals.length > 0)
  ) {
    throw new TypeError("instance status contradicts its static signals");
  }
}

function validateIssues(issues: readonly ProjectInspectIssue[]): void {
  if (!Array.isArray(issues) || issues.length > PROJECT_INSPECT_MAX_ISSUES) {
    throw new TypeError("inspection issue count is outside the contract");
  }
  for (const issue of issues) {
    if (!isPlainObject(issue)) {
      throw new TypeError("inspection issue is not an object");
    }
    const expectedKeys = [
      "code",
      "message",
      "nextAction",
      ...(issue.path === undefined ? [] : ["path"]),
      "severity",
    ];
    if (
      !objectHasExactKeys(issue, expectedKeys) ||
      !issueSeverities.includes(issue.severity) ||
      !isStableId(issue.code) ||
      (issue.path !== undefined && !isBoundedText(issue.path, 32767)) ||
      !isBoundedText(issue.message, 500) ||
      !isBoundedText(issue.nextAction, 500)
    ) {
      throw new TypeError("inspection issue is outside the contract");
    }
  }
}

function validateReportFields(value: ProjectInspectionReportFields): void {
  if (
    !isPlainObject(value) ||
    !objectHasExactKeys(value, [
      "dirtyState",
      "engine",
      "instances",
      "issues",
      "profile",
      "project",
    ]) ||
    !isPlainObject(value.project) ||
    !isBoundedText(value.project.requestedPath, 32767)
  ) {
    throw new TypeError("project inspection fields are outside the contract");
  }
  const projectKeys = [
    ...(value.project.canonicalPath === undefined ? [] : ["canonicalPath"]),
    "requestedPath",
    ...(value.project.rootIdentityDigest === undefined
      ? []
      : ["rootIdentityDigest"]),
  ];
  if (
    !objectHasExactKeys(value.project, projectKeys) ||
    (value.project.canonicalPath !== undefined &&
      !isBoundedText(value.project.canonicalPath, 32767)) ||
    (value.project.rootIdentityDigest !== undefined &&
      !isSha256Digest(value.project.rootIdentityDigest)) ||
    (value.project.canonicalPath === undefined) !==
      (value.project.rootIdentityDigest === undefined)
  ) {
    throw new TypeError("project inspection root identity is incomplete");
  }
  validateEngineAssessment(value.engine);
  validateProfileAssessment(value.profile);
  validateDirtyState(value.dirtyState);
  validateInstanceAssessment(value.instances);
  validateIssues(value.issues);
}

function validateSummary(value: ProjectInspectionSummary): void {
  if (
    !isPlainObject(value) ||
    !objectHasExactKeys(value, [
      "attentionIssues",
      "blockedIssues",
      "completeEngineCandidates",
      "engineCandidates",
    ])
  ) {
    throw new TypeError("project inspection summary is outside the contract");
  }
  for (const count of Object.values(value)) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > PROJECT_INSPECT_MAX_ISSUES
    ) {
      throw new TypeError("project inspection summary count is invalid");
    }
  }
  if (
    value.completeEngineCandidates > value.engineCandidates ||
    value.engineCandidates > PROJECT_INSPECT_MAX_ENGINE_CANDIDATES
  ) {
    throw new TypeError("project inspection engine summary is invalid");
  }
}

export function computeGameProjectIdentityDigest(
  input: GameProjectIdentityDigestInput,
): Sha256Digest {
  if (
    !isPlainObject(input) ||
    !objectHasExactKeys(input, ["engine", "projectId"]) ||
    !isStableId(input.projectId) ||
    !isPlainObject(input.engine) ||
    !objectHasExactKeys(input.engine, ["id", "version"]) ||
    !engineIds.includes(input.engine.id)
  ) {
    throw new TypeError("game project identity input is outside the contract");
  }
  parseSemanticVersion(input.engine.version);
  return digestCanonicalJson({
    domain: "ai-game-playbook/game-project-identity",
    version: "1.0.0",
    projectId: input.projectId,
    engine: input.engine,
  });
}

export function computeProjectEngineCandidateDigest(
  input: ProjectEngineCandidateDigestInput,
): Sha256Digest {
  validateCandidateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/project-engine-candidate",
    contractVersion: "1.0.0",
    ...input,
  });
}

export function summarizeProjectInspection(
  fields: ProjectInspectionReportFields,
): ProjectInspectionSummary {
  validateReportFields(fields);
  return Object.freeze({
    engineCandidates: fields.engine.candidates.length,
    completeEngineCandidates: fields.engine.candidates.filter(
      ({ completeness }) => completeness === "complete",
    ).length,
    attentionIssues: fields.issues.filter(
      ({ severity }) => severity === "attention",
    ).length,
    blockedIssues: fields.issues.filter(
      ({ severity }) => severity === "blocked",
    ).length,
  });
}

export function computeProjectInspectionStatus(
  summary: ProjectInspectionSummary,
): ProjectInspectStatus {
  validateSummary(summary);
  return summary.blockedIssues > 0
    ? "blocked"
    : summary.attentionIssues > 0
      ? "attention"
      : "ready";
}

export function computeProjectInspectionDigest(
  input: ProjectInspectionDigestInput,
): Sha256Digest {
  if (
    !isPlainObject(input) ||
    !objectHasExactKeys(input, [
      "dirtyState",
      "engine",
      "instances",
      "issues",
      "profile",
      "projectIdentityDigest",
      "registryDigest",
    ]) ||
    !isSha256Digest(input.registryDigest) ||
    !isSha256Digest(input.projectIdentityDigest)
  ) {
    throw new TypeError("project inspection digest input is outside the contract");
  }
  validateEngineAssessment(input.engine);
  validateProfileAssessment(input.profile);
  validateDirtyState(input.dirtyState);
  validateInstanceAssessment(input.instances);
  validateIssues(input.issues);
  return digestCanonicalJson({
    domain: "ai-game-playbook/project-inspection",
    version: "1.0.0",
    ...input,
  });
}

function versionsAreCompatible(
  profileVersion: SemanticVersion,
  observed: ProjectEngineVersionObservation,
): boolean {
  if (observed.normalized === undefined || observed.precision === "unknown") {
    return true;
  }
  if (observed.precision === "exact") {
    return profileVersion === observed.normalized;
  }
  const profile = parseSemanticVersion(profileVersion);
  const marker = parseSemanticVersion(observed.normalized);
  return profile.major === marker.major && profile.minor === marker.minor;
}

export function assertProjectInspectReportSemantics(
  report: ProjectInspectReport,
): void {
  if (!isPlainObject(report)) {
    throw new TypeError("project inspection report is not an object");
  }
  const fields: ProjectInspectionReportFields = {
    project: report.project,
    engine: report.engine,
    profile: report.profile,
    dirtyState: report.dirtyState,
    instances: report.instances,
    issues: report.issues,
  };
  const expectedSummary = summarizeProjectInspection(fields);
  if (
    report.summary.engineCandidates !== expectedSummary.engineCandidates ||
    report.summary.completeEngineCandidates !==
      expectedSummary.completeEngineCandidates ||
    report.summary.attentionIssues !== expectedSummary.attentionIssues ||
    report.summary.blockedIssues !== expectedSummary.blockedIssues
  ) {
    throw new TypeError("project inspection summary contradicts its observations");
  }
  if (report.status !== computeProjectInspectionStatus(report.summary)) {
    throw new TypeError("project inspection status contradicts its issues");
  }
  if (
    report.mutationReady !== false ||
    report.mutationPerformed !== false ||
    report.externalProcessStarted !== false ||
    report.networkAccessPerformed !== false ||
    !isSha256Digest(report.registryDigest)
  ) {
    throw new TypeError("project inspection report claims undeclared authority");
  }

  const bound = report.project.rootIdentityDigest !== undefined;
  if (!bound) {
    if (
      report.inspectionDigest !== undefined ||
      report.status !== "blocked" ||
      report.engine.status !== "not-inspected" ||
      report.profile.status !== "not-inspected" ||
      report.dirtyState.status !== "not-inspected" ||
      report.instances.status !== "not-inspected"
    ) {
      throw new TypeError("unbound project inspection carries observations");
    }
    return;
  }
  if (
    report.engine.status === "not-inspected" ||
    report.profile.status === "not-inspected" ||
    report.dirtyState.status === "not-inspected" ||
    report.instances.status === "not-inspected"
  ) {
    throw new TypeError("bound project inspection omitted required observations");
  }
  const expectedDigest = computeProjectInspectionDigest({
    registryDigest: report.registryDigest,
    projectIdentityDigest: report.project.rootIdentityDigest as Sha256Digest,
    engine: report.engine,
    profile: report.profile,
    dirtyState: report.dirtyState,
    instances: report.instances,
    issues: report.issues,
  });
  if (report.inspectionDigest !== expectedDigest) {
    throw new TypeError("project inspection digest is invalid");
  }
  if (
    report.profile.status === "valid" &&
    report.profile.candidate !== undefined &&
    report.engine.status === "detected"
  ) {
    const observed = report.engine.candidates[0];
    if (
      observed === undefined ||
      observed.engine !== report.profile.candidate.engine.id ||
      !versionsAreCompatible(
        report.profile.candidate.engine.version,
        observed.version,
      )
    ) {
      throw new TypeError("valid profile contradicts the detected engine");
    }
  }
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const markerObservation = closedObject(
  {
    path: reference("portablePath"),
    kind: enumSchema(["directory", "file"]),
    digest: reference("sha256Digest"),
  },
  ["path", "kind"],
);

const versionObservation = closedObject(
  {
    raw: textSchema(128),
    normalized: reference("semanticVersion"),
    precision: enumSchema(["exact", "major-minor", "unknown"]),
  },
  ["precision"],
);

const engineCandidate = closedObject(
  {
    engine: reference("engineId"),
    completeness: enumSchema(["complete", "partial"]),
    markers: boundedArray(markerObservation, {
      minimum: 1,
      maximum: PROJECT_INSPECT_MAX_ENGINE_MARKERS,
    }),
    version: versionObservation,
    observationDigest: reference("sha256Digest"),
  },
  ["engine", "completeness", "markers", "version", "observationDigest"],
);

const engineAssessment = closedObject(
  {
    status: enumSchema(engineAssessmentStatuses),
    candidates: boundedArray(engineCandidate, {
      maximum: PROJECT_INSPECT_MAX_ENGINE_CANDIDATES,
    }),
  },
  ["status", "candidates"],
);

const embeddedGameProjectProfile = Object.fromEntries(
  Object.entries(gameProjectProfileSchema.schema).filter(
    ([key]) => !["$schema", "$id", "title", "description"].includes(key),
  ),
) as JsonSchemaObject;

const profileAssessment = closedObject(
  {
    status: enumSchema(profileAssessmentStatuses),
    path: { const: ".ai-game-playbook/profile.json" },
    fileDigest: reference("sha256Digest"),
    candidateDigest: reference("sha256Digest"),
    candidate: embeddedGameProjectProfile,
    reason: textSchema(500),
  },
  ["status", "path", "reason"],
);

const dirtyStateAssessment = closedObject(
  {
    status: enumSchema(dirtyStateStatuses),
    source: enumSchema(dirtyStateSources),
    markerPath: { const: ".git" },
    reason: textSchema(500),
  },
  ["status", "source", "reason"],
);

const instanceSignal = closedObject(
  {
    engine: reference("engineId"),
    path: reference("portablePath"),
    kind: enumSchema(["editor-state", "lock"]),
    digest: reference("sha256Digest"),
  },
  ["engine", "path", "kind"],
);

const instanceAssessment = closedObject(
  {
    status: enumSchema(instanceAssessmentStatuses),
    selectionAllowed: { const: false },
    signals: boundedArray(instanceSignal, {
      maximum: PROJECT_INSPECT_MAX_INSTANCE_SIGNALS,
    }),
    reason: textSchema(500),
  },
  ["status", "selectionAllowed", "signals", "reason"],
);

const inspectionIssue = closedObject(
  {
    severity: enumSchema(issueSeverities),
    code: reference("stableId"),
    path: localPath,
    message: textSchema(500),
    nextAction: textSchema(500),
  },
  ["severity", "code", "message", "nextAction"],
);

const projectSummary = closedObject(
  {
    requestedPath: localPath,
    canonicalPath: localPath,
    rootIdentityDigest: reference("sha256Digest"),
  },
  ["requestedPath"],
);

const inspectionSummary = closedObject(
  {
    engineCandidates: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INSPECT_MAX_ENGINE_CANDIDATES,
    },
    completeEngineCandidates: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INSPECT_MAX_ENGINE_CANDIDATES,
    },
    attentionIssues: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INSPECT_MAX_ISSUES,
    },
    blockedIssues: {
      type: "integer",
      minimum: 0,
      maximum: PROJECT_INSPECT_MAX_ISSUES,
    },
  },
  [
    "engineCandidates",
    "completeEngineCandidates",
    "attentionIssues",
    "blockedIssues",
  ],
);

export const projectInspectRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-inspect-request",
    version: "1.0.0",
    title: "Project Inspection Request",
    description:
      "Selects one bounded local game project root for write-free static inspection.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
      },
      ["schemaVersion", "projectRoot"],
    ),
  });

export const projectInspectReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-inspect-report",
    version: "1.0.0",
    title: "Project Inspection Report",
    description:
      "Reports bounded engine, profile, dirty-state, and instance observations without mutation.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "project.inspect" },
        status: enumSchema(["ready", "attention", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        project: projectSummary,
        engine: engineAssessment,
        profile: profileAssessment,
        dirtyState: dirtyStateAssessment,
        instances: instanceAssessment,
        issues: boundedArray(inspectionIssue, {
          maximum: PROJECT_INSPECT_MAX_ISSUES,
        }),
        summary: inspectionSummary,
        inspectionDigest: reference("sha256Digest"),
        mutationReady: { const: false },
        mutationPerformed: { const: false },
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "project",
        "engine",
        "profile",
        "dirtyState",
        "instances",
        "issues",
        "summary",
        "mutationReady",
        "mutationPerformed",
        "externalProcessStarted",
        "networkAccessPerformed",
      ],
    ),
  });
