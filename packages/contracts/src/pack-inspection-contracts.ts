import { canonicalizeJson, compareCanonicalText } from "./canonical-json.js";
import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
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

export const PACK_INSPECTION_MAX_PACKS: number = 1_024;
export const PACK_INSPECTION_MAX_FINDINGS: number = 256;
export const PACK_INSPECTION_MAX_OWNED_PATHS: number = 4_096;
export const PACK_INSPECTION_MAX_DECLARED_BYTES: number = 64 * 1_024 * 1_024;

export type PackInspectionProjectState =
  | "unavailable"
  | "uninitialized"
  | "incomplete"
  | "ready";
export type PackInspectionIssueSeverity = "attention" | "blocked";
export type PackInspectionStatus = "ready" | "attention" | "blocked";
export type PackDoctorStatus = "healthy" | "attention" | "blocked";
export type PackInstalledStateStatus =
  | "not-inspected"
  | "empty"
  | "present"
  | "invalid";
export type PackRegistryStatus = "current" | "different" | "unavailable";
export type PackIntegrityStatus =
  | "not-inspected"
  | "current"
  | "drifted"
  | "unsafe";
export type PackDoctorTransactionStatus =
  | "not-inspected"
  | "clear"
  | "recovery-required"
  | "invalid";

export interface PackListRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface PackDoctorRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface PackInspectionProjectSummary {
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly identityDigest?: Sha256Digest;
  readonly state: PackInspectionProjectState;
}

export interface PackInstalledStateSummary {
  readonly status: PackInstalledStateStatus;
  readonly formatVersion?: "1.0.0" | "1.1.0";
  readonly projectId?: StableId;
  readonly revision?: number;
  readonly stateDigest?: Sha256Digest;
  readonly fileDigest?: Sha256Digest;
}

export interface PackInspectionIssue {
  readonly severity: PackInspectionIssueSeverity;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction: string;
  readonly packId?: StableId;
  readonly path?: PortableProjectPath;
  readonly expectedDigest?: Sha256Digest;
  readonly actualDigest?: Sha256Digest;
}

export interface PackListEntry {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly digest: Sha256Digest;
  readonly dependencyCount: number;
  readonly artifactCount: number;
  readonly artifactBytes: number;
  readonly ownedDirectoryCount: number;
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface PackListSummary {
  readonly installedPacks: number;
  readonly dependencies: number;
  readonly artifacts: number;
  readonly artifactBytes: number;
  readonly ownedDirectories: number;
}

export interface PackListDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly projectState: PackInspectionProjectState;
  readonly installedState: PackInstalledStateSummary;
  readonly entries: readonly PackListEntry[];
  readonly issues: readonly PackInspectionIssue[];
}

export interface PackListReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "pack.list";
  readonly status: PackInspectionStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: PackInspectionProjectSummary;
  readonly installedState: PackInstalledStateSummary;
  readonly entries: readonly PackListEntry[];
  readonly issues: readonly PackInspectionIssue[];
  readonly summary: PackListSummary;
  readonly listDigest?: Sha256Digest;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly artifactContentExposed: false;
  readonly sourceLocationExposed: false;
}

export interface PackDoctorPathSummary {
  readonly declared: number;
  readonly current: number;
  readonly missing: number;
  readonly modified: number;
  readonly unreadable: number;
}

export interface PackDoctorObservation {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly digest: Sha256Digest;
  readonly registryStatus: PackRegistryStatus;
  readonly integrityStatus: PackIntegrityStatus;
  readonly artifacts: PackDoctorPathSummary;
  readonly directories: PackDoctorPathSummary;
}

export interface PackDoctorRecoverySummary {
  readonly stable: boolean;
  readonly consistency:
    | "consistent"
    | "contradictory"
    | "incomplete"
    | "unresolved";
  readonly observedState: "mixed" | "postimage" | "preimage";
  readonly mutationUncertain: boolean;
  readonly finalizationAction:
    | "append-reconciliation"
    | "append-started-and-terminal"
    | "append-terminal"
    | "blocked"
    | "clear-marker"
    | "none";
  readonly reportDigest: Sha256Digest;
}

export interface PackDoctorTransactionSummary {
  readonly status: PackDoctorTransactionStatus;
  readonly runId?: string;
  readonly operation?: "add" | "remove" | "update";
  readonly pack?: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly digest: Sha256Digest;
  };
  readonly markerFileDigest?: Sha256Digest;
  readonly recovery?: PackDoctorRecoverySummary;
}

export interface PackDoctorSummary {
  readonly installedPacks: number;
  readonly registryCurrent: number;
  readonly registryDifferent: number;
  readonly registryUnavailable: number;
  readonly declaredArtifacts: number;
  readonly currentArtifacts: number;
  readonly missingArtifacts: number;
  readonly modifiedArtifacts: number;
  readonly unreadableArtifacts: number;
  readonly declaredDirectories: number;
  readonly currentDirectories: number;
  readonly missingDirectories: number;
  readonly modifiedDirectories: number;
  readonly unreadableDirectories: number;
}

export interface PackDoctorDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly projectState: PackInspectionProjectState;
  readonly installedState: PackInstalledStateSummary;
  readonly transaction: PackDoctorTransactionSummary;
  readonly packs: readonly PackDoctorObservation[];
  readonly findings: readonly PackInspectionIssue[];
}

export interface PackDoctorReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "pack.doctor";
  readonly status: PackDoctorStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: PackInspectionProjectSummary;
  readonly installedState: PackInstalledStateSummary;
  readonly transaction: PackDoctorTransactionSummary;
  readonly packs: readonly PackDoctorObservation[];
  readonly findings: readonly PackInspectionIssue[];
  readonly summary: PackDoctorSummary;
  readonly reportDigest?: Sha256Digest;
  readonly repairPerformed: false;
  readonly recoveryFinalizationPerformed: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly artifactContentExposed: false;
  readonly sourceLocationExposed: false;
}

const projectStates: readonly PackInspectionProjectState[] = Object.freeze([
  "unavailable",
  "uninitialized",
  "incomplete",
  "ready",
]);
const issueSeverities: readonly PackInspectionIssueSeverity[] = Object.freeze([
  "attention",
  "blocked",
]);
const installedStateStatuses: readonly PackInstalledStateStatus[] = Object.freeze([
  "not-inspected",
  "empty",
  "present",
  "invalid",
]);
const registryStatuses: readonly PackRegistryStatus[] = Object.freeze([
  "current",
  "different",
  "unavailable",
]);
const integrityStatuses: readonly PackIntegrityStatus[] = Object.freeze([
  "not-inspected",
  "current",
  "drifted",
  "unsafe",
]);
const transactionStatuses: readonly PackDoctorTransactionStatus[] = Object.freeze([
  "not-inspected",
  "clear",
  "recovery-required",
  "invalid",
]);
const recoveryConsistencies = Object.freeze([
  "consistent",
  "contradictory",
  "incomplete",
  "unresolved",
] as const);
const recoveryObservedStates = Object.freeze([
  "mixed",
  "postimage",
  "preimage",
] as const);
const recoveryFinalizationActions = Object.freeze([
  "append-reconciliation",
  "append-started-and-terminal",
  "append-terminal",
  "blocked",
  "clear-marker",
  "none",
] as const);
const packOperations = Object.freeze(["add", "remove", "update"] as const);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function isRecord(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.getOwnPropertyNames(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        "value" in descriptor &&
        descriptor.enumerable === true
      );
    })
  );
}

function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = Object.freeze([]),
): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const allowed = [...required, ...optional].sort(compareCanonicalText);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.length >= required.length &&
    actual.length <= allowed.length &&
    actual.every((key) => allowed.includes(key))
  );
}

function validText(value: unknown, maximum: number): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    return false;
  }
  try {
    canonicalizeJson(value);
    return true;
  } catch {
    return false;
  }
}

function validLocalPath(value: unknown): value is string {
  return validText(value, 32_767);
}

function validCount(value: unknown, maximum = MAX_SAFE_INTEGER): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
  );
}

function canonicalVersion(value: unknown): value is SemanticVersion {
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function validateProject(
  project: PackInspectionProjectSummary,
): boolean {
  if (
    !isRecord(project) ||
    !exactKeys(project, ["requestedPath", "state"], [
      "canonicalPath",
      "identityDigest",
    ]) ||
    !validLocalPath(project.requestedPath) ||
    !projectStates.includes(project.state)
  ) {
    return false;
  }
  const hasPath = project.canonicalPath !== undefined;
  const hasIdentity = project.identityDigest !== undefined;
  return (
    hasPath === hasIdentity &&
    (project.state === "unavailable"
      ? !hasPath
      : hasPath &&
        validLocalPath(project.canonicalPath) &&
        isSha256Digest(project.identityDigest))
  );
}

function validateInstalledState(
  state: PackInstalledStateSummary,
): PackInstalledStateSummary {
  if (
    !isRecord(state) ||
    !installedStateStatuses.includes(state.status)
  ) {
    throw new TypeError("installed pack state summary is invalid");
  }
  if (state.status !== "present") {
    if (!exactKeys(state, ["status"])) {
      throw new TypeError("non-present pack state cannot carry state identity");
    }
    return state;
  }
  if (
    !exactKeys(state, [
      "status",
      "formatVersion",
      "projectId",
      "revision",
      "stateDigest",
      "fileDigest",
    ]) ||
    !["1.0.0", "1.1.0"].includes(state.formatVersion ?? "") ||
    !isStableId(state.projectId) ||
    !Number.isSafeInteger(state.revision) ||
    (state.revision ?? 0) < 1 ||
    !isSha256Digest(state.stateDigest) ||
    !isSha256Digest(state.fileDigest)
  ) {
    throw new TypeError("present pack state identity is incomplete");
  }
  return state;
}

function validateIssues(
  issues: readonly PackInspectionIssue[],
): readonly PackInspectionIssue[] {
  if (!Array.isArray(issues) || issues.length > PACK_INSPECTION_MAX_FINDINGS) {
    throw new RangeError("pack inspection finding count exceeds the contract");
  }
  for (const issue of issues) {
    if (
      !isRecord(issue) ||
      !exactKeys(
        issue,
        ["severity", "code", "message", "nextAction"],
        ["packId", "path", "expectedDigest", "actualDigest"],
      ) ||
      !issueSeverities.includes(issue.severity) ||
      !isStableId(issue.code) ||
      !validText(issue.message, 500) ||
      !validText(issue.nextAction, 500) ||
      (issue.packId !== undefined && !isStableId(issue.packId)) ||
      (issue.path !== undefined && !isPortableProjectPath(issue.path)) ||
      (issue.expectedDigest !== undefined &&
        !isSha256Digest(issue.expectedDigest)) ||
      (issue.actualDigest !== undefined && !isSha256Digest(issue.actualDigest))
    ) {
      throw new TypeError("pack inspection finding is outside the contract");
    }
  }
  return issues;
}

function validateListEntries(
  entries: readonly PackListEntry[],
): readonly PackListEntry[] {
  if (!Array.isArray(entries) || entries.length > PACK_INSPECTION_MAX_PACKS) {
    throw new RangeError("installed pack entry count exceeds the contract");
  }
  let previousId: string | undefined;
  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      !exactKeys(entry, [
        "id",
        "version",
        "digest",
        "dependencyCount",
        "artifactCount",
        "artifactBytes",
        "ownedDirectoryCount",
        "installedAt",
        "updatedAt",
      ]) ||
      !isStableId(entry.id) ||
      !canonicalVersion(entry.version) ||
      !isSha256Digest(entry.digest) ||
      !validCount(entry.dependencyCount, PACK_INSPECTION_MAX_PACKS) ||
      !validCount(entry.artifactCount, 64) ||
      !validCount(entry.artifactBytes) ||
      !validCount(entry.ownedDirectoryCount, 64) ||
      !canonicalTimestamp(entry.installedAt) ||
      !canonicalTimestamp(entry.updatedAt) ||
      Date.parse(entry.installedAt) > Date.parse(entry.updatedAt) ||
      (previousId !== undefined &&
        compareCanonicalText(previousId, entry.id) >= 0)
    ) {
      throw new TypeError(
        "installed pack entries must be canonical, uniquely ordered records",
      );
    }
    previousId = entry.id;
  }
  return entries;
}

function addCount(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("pack inspection aggregate exceeds safe integer bounds");
  }
  return result;
}

export function summarizePackListEntries(
  entries: readonly PackListEntry[],
): PackListSummary {
  validateListEntries(entries);
  let dependencies = 0;
  let artifacts = 0;
  let artifactBytes = 0;
  let ownedDirectories = 0;
  for (const entry of entries) {
    dependencies = addCount(dependencies, entry.dependencyCount);
    artifacts = addCount(artifacts, entry.artifactCount);
    artifactBytes = addCount(artifactBytes, entry.artifactBytes);
    ownedDirectories = addCount(
      ownedDirectories,
      entry.ownedDirectoryCount,
    );
  }
  return Object.freeze({
    installedPacks: entries.length,
    dependencies,
    artifacts,
    artifactBytes,
    ownedDirectories,
  });
}

export function computePackListStatus(
  issues: readonly Pick<PackInspectionIssue, "severity">[],
): PackInspectionStatus {
  if (!Array.isArray(issues) || issues.length > PACK_INSPECTION_MAX_FINDINGS) {
    throw new RangeError("pack inspection finding count exceeds the contract");
  }
  let attention = false;
  for (const issue of issues) {
    if (!isRecord(issue) || !issueSeverities.includes(issue.severity)) {
      throw new TypeError("pack inspection severity is invalid");
    }
    if (issue.severity === "blocked") return "blocked";
    attention = true;
  }
  return attention ? "attention" : "ready";
}

function validateListDigestInput(
  input: PackListDigestInput,
): PackListDigestInput {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "registryDigest",
      "projectIdentityDigest",
      "projectState",
      "installedState",
      "entries",
      "issues",
    ]) ||
    !isSha256Digest(input.registryDigest) ||
    !isSha256Digest(input.projectIdentityDigest) ||
    !projectStates.includes(input.projectState)
  ) {
    throw new TypeError("pack list digest input has invalid authority");
  }
  validateInstalledState(input.installedState);
  validateListEntries(input.entries);
  validateIssues(input.issues);
  return input;
}

export function computePackListDigest(
  input: PackListDigestInput,
): Sha256Digest {
  const validated = validateListDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/pack-list",
    version: "1.0.0",
    ...validated,
  });
}

function sameNumberRecord(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const leftKeys = Object.keys(left).sort(compareCanonicalText);
  const rightKeys = Object.keys(right).sort(compareCanonicalText);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && left[key] === right[key],
    )
  );
}

function assertProjectStateBoundary(
  project: PackInspectionProjectSummary,
  installedState: PackInstalledStateSummary,
  entryCount: number,
  issues: readonly PackInspectionIssue[],
): void {
  if (!validateProject(project)) {
    throw new TypeError("pack inspection project identity is invalid");
  }
  validateInstalledState(installedState);
  if (project.state !== "ready") {
    if (installedState.status !== "not-inspected" || entryCount !== 0) {
      throw new TypeError("unready projects cannot carry installed pack data");
    }
  } else if (installedState.status === "not-inspected") {
    throw new TypeError("ready projects must classify installed pack state");
  }
  if (
    (installedState.status === "empty" ||
      installedState.status === "invalid") &&
    entryCount !== 0
  ) {
    throw new TypeError("empty or invalid installed state cannot carry packs");
  }
  const hasBlocked = issues.some(({ severity }) => severity === "blocked");
  const hasAttention = issues.some(({ severity }) => severity === "attention");
  if (
    (project.state === "unavailable" || project.state === "incomplete") &&
    !hasBlocked
  ) {
    throw new TypeError("unavailable or incomplete projects must be blocked");
  }
  if (project.state === "uninitialized" && !hasAttention && !hasBlocked) {
    throw new TypeError("uninitialized projects must preserve attention");
  }
  if (installedState.status === "invalid" && !hasBlocked) {
    throw new TypeError("invalid installed state must be blocked");
  }
}

function assertReadOnlyFlags(
  report: Pick<
    PackListReport,
    | "mutationPerformed"
    | "externalProcessStarted"
    | "networkAccessPerformed"
    | "artifactContentExposed"
    | "sourceLocationExposed"
  >,
): void {
  if (
    report.mutationPerformed !== false ||
    report.externalProcessStarted !== false ||
    report.networkAccessPerformed !== false ||
    report.artifactContentExposed !== false ||
    report.sourceLocationExposed !== false
  ) {
    throw new TypeError("pack inspection report claims a forbidden effect");
  }
}

export function assertPackListReportSemantics(report: PackListReport): void {
  if (!isRecord(report)) {
    throw new TypeError("pack list report is not a plain object");
  }
  const entries = validateListEntries(report.entries);
  const issues = validateIssues(report.issues);
  assertProjectStateBoundary(
    report.project,
    report.installedState,
    entries.length,
    issues,
  );
  const expectedSummary = summarizePackListEntries(entries);
  if (
    !isRecord(report.summary) ||
    !sameNumberRecord(
      report.summary as unknown as Readonly<Record<string, number>>,
      expectedSummary as unknown as Readonly<Record<string, number>>,
    )
  ) {
    throw new TypeError("pack list summary does not match its entries");
  }
  if (report.status !== computePackListStatus(issues)) {
    throw new TypeError("pack list status does not match its findings");
  }
  const bound = report.project.identityDigest !== undefined;
  if (!bound) {
    if (report.listDigest !== undefined) {
      throw new TypeError("unbound pack list cannot carry a digest");
    }
  } else {
    const expectedDigest = computePackListDigest({
      registryDigest: report.registryDigest,
      projectIdentityDigest: report.project.identityDigest as Sha256Digest,
      projectState: report.project.state,
      installedState: report.installedState,
      entries,
      issues,
    });
    if (report.listDigest !== expectedDigest) {
      throw new TypeError("pack list digest does not attest the report body");
    }
  }
  assertReadOnlyFlags(report);
}

function validatePathSummary(
  value: PackDoctorPathSummary,
  integrityStatus: PackIntegrityStatus,
): PackDoctorPathSummary {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "declared",
      "current",
      "missing",
      "modified",
      "unreadable",
    ]) ||
    !validCount(value.declared, PACK_INSPECTION_MAX_OWNED_PATHS) ||
    !validCount(value.current, PACK_INSPECTION_MAX_OWNED_PATHS) ||
    !validCount(value.missing, PACK_INSPECTION_MAX_OWNED_PATHS) ||
    !validCount(value.modified, PACK_INSPECTION_MAX_OWNED_PATHS) ||
    !validCount(value.unreadable, PACK_INSPECTION_MAX_OWNED_PATHS)
  ) {
    throw new TypeError("pack doctor path summary is invalid");
  }
  const observed =
    value.current + value.missing + value.modified + value.unreadable;
  if (
    integrityStatus === "not-inspected"
      ? observed !== 0
      : observed !== value.declared
  ) {
    throw new TypeError("pack doctor path counts do not match inspection state");
  }
  return value;
}

function validateDoctorObservations(
  packs: readonly PackDoctorObservation[],
): readonly PackDoctorObservation[] {
  if (!Array.isArray(packs) || packs.length > PACK_INSPECTION_MAX_PACKS) {
    throw new RangeError("pack doctor observation count exceeds the contract");
  }
  let previousId: string | undefined;
  for (const pack of packs) {
    if (
      !isRecord(pack) ||
      !exactKeys(pack, [
        "id",
        "version",
        "digest",
        "registryStatus",
        "integrityStatus",
        "artifacts",
        "directories",
      ]) ||
      !isStableId(pack.id) ||
      !canonicalVersion(pack.version) ||
      !isSha256Digest(pack.digest) ||
      !registryStatuses.includes(pack.registryStatus) ||
      !integrityStatuses.includes(pack.integrityStatus) ||
      (previousId !== undefined && compareCanonicalText(previousId, pack.id) >= 0)
    ) {
      throw new TypeError("pack doctor observations must be canonical and ordered");
    }
    validatePathSummary(pack.artifacts, pack.integrityStatus);
    validatePathSummary(pack.directories, pack.integrityStatus);
    const missing = pack.artifacts.missing + pack.directories.missing;
    const modified = pack.artifacts.modified + pack.directories.modified;
    const unreadable = pack.artifacts.unreadable + pack.directories.unreadable;
    if (
      (pack.integrityStatus === "current" &&
        (missing !== 0 || modified !== 0 || unreadable !== 0)) ||
      (pack.integrityStatus === "drifted" &&
        (missing + modified === 0 || unreadable !== 0)) ||
      (pack.integrityStatus === "unsafe" && unreadable === 0)
    ) {
      throw new TypeError("pack integrity status does not match path counts");
    }
    previousId = pack.id;
  }
  return packs;
}

export function summarizePackDoctorObservations(
  packs: readonly PackDoctorObservation[],
): PackDoctorSummary {
  validateDoctorObservations(packs);
  const summary: Record<keyof PackDoctorSummary, number> = {
    installedPacks: packs.length,
    registryCurrent: 0,
    registryDifferent: 0,
    registryUnavailable: 0,
    declaredArtifacts: 0,
    currentArtifacts: 0,
    missingArtifacts: 0,
    modifiedArtifacts: 0,
    unreadableArtifacts: 0,
    declaredDirectories: 0,
    currentDirectories: 0,
    missingDirectories: 0,
    modifiedDirectories: 0,
    unreadableDirectories: 0,
  };
  for (const pack of packs) {
    if (pack.registryStatus === "current") summary.registryCurrent += 1;
    else if (pack.registryStatus === "different") summary.registryDifferent += 1;
    else summary.registryUnavailable += 1;
    summary.declaredArtifacts = addCount(
      summary.declaredArtifacts,
      pack.artifacts.declared,
    );
    summary.currentArtifacts = addCount(
      summary.currentArtifacts,
      pack.artifacts.current,
    );
    summary.missingArtifacts = addCount(
      summary.missingArtifacts,
      pack.artifacts.missing,
    );
    summary.modifiedArtifacts = addCount(
      summary.modifiedArtifacts,
      pack.artifacts.modified,
    );
    summary.unreadableArtifacts = addCount(
      summary.unreadableArtifacts,
      pack.artifacts.unreadable,
    );
    summary.declaredDirectories = addCount(
      summary.declaredDirectories,
      pack.directories.declared,
    );
    summary.currentDirectories = addCount(
      summary.currentDirectories,
      pack.directories.current,
    );
    summary.missingDirectories = addCount(
      summary.missingDirectories,
      pack.directories.missing,
    );
    summary.modifiedDirectories = addCount(
      summary.modifiedDirectories,
      pack.directories.modified,
    );
    summary.unreadableDirectories = addCount(
      summary.unreadableDirectories,
      pack.directories.unreadable,
    );
  }
  return Object.freeze({ ...summary });
}

function validateRecoverySummary(
  recovery: PackDoctorRecoverySummary,
): PackDoctorRecoverySummary {
  if (
    !isRecord(recovery) ||
    !exactKeys(recovery, [
      "stable",
      "consistency",
      "observedState",
      "mutationUncertain",
      "finalizationAction",
      "reportDigest",
    ]) ||
    typeof recovery.stable !== "boolean" ||
    !recoveryConsistencies.includes(recovery.consistency) ||
    !recoveryObservedStates.includes(recovery.observedState) ||
    typeof recovery.mutationUncertain !== "boolean" ||
    !recoveryFinalizationActions.includes(recovery.finalizationAction) ||
    !isSha256Digest(recovery.reportDigest)
  ) {
    throw new TypeError("pack recovery summary is invalid");
  }
  return recovery;
}

function validateTransaction(
  transaction: PackDoctorTransactionSummary,
): PackDoctorTransactionSummary {
  if (
    !isRecord(transaction) ||
    !transactionStatuses.includes(transaction.status)
  ) {
    throw new TypeError("pack doctor transaction summary is invalid");
  }
  if (transaction.status !== "recovery-required") {
    if (!exactKeys(transaction, ["status"])) {
      throw new TypeError("inactive transaction summary cannot carry recovery data");
    }
    return transaction;
  }
  if (
    !exactKeys(transaction, [
      "status",
      "runId",
      "operation",
      "pack",
      "markerFileDigest",
      "recovery",
    ]) ||
    typeof transaction.runId !== "string" ||
    !UUID_PATTERN.test(transaction.runId) ||
    !packOperations.includes(transaction.operation as (typeof packOperations)[number]) ||
    transaction.pack === undefined ||
    !isRecord(transaction.pack) ||
    !exactKeys(transaction.pack, ["id", "version", "digest"]) ||
    !isStableId(transaction.pack.id) ||
    !canonicalVersion(transaction.pack.version) ||
    !isSha256Digest(transaction.pack.digest) ||
    !isSha256Digest(transaction.markerFileDigest)
  ) {
    throw new TypeError("recovery-required transaction identity is incomplete");
  }
  validateRecoverySummary(transaction.recovery as PackDoctorRecoverySummary);
  return transaction;
}

export function computePackDoctorStatus(
  findings: readonly Pick<PackInspectionIssue, "severity">[],
): PackDoctorStatus {
  const status = computePackListStatus(findings);
  return status === "ready" ? "healthy" : status;
}

function validateDoctorDigestInput(
  input: PackDoctorDigestInput,
): PackDoctorDigestInput {
  if (
    !isRecord(input) ||
    !exactKeys(input, [
      "registryDigest",
      "projectIdentityDigest",
      "projectState",
      "installedState",
      "transaction",
      "packs",
      "findings",
    ]) ||
    !isSha256Digest(input.registryDigest) ||
    !isSha256Digest(input.projectIdentityDigest) ||
    !projectStates.includes(input.projectState)
  ) {
    throw new TypeError("pack doctor digest input has invalid authority");
  }
  validateInstalledState(input.installedState);
  validateTransaction(input.transaction);
  validateDoctorObservations(input.packs);
  validateIssues(input.findings);
  return input;
}

export function computePackDoctorDigest(
  input: PackDoctorDigestInput,
): Sha256Digest {
  const validated = validateDoctorDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/pack-doctor",
    version: "1.0.0",
    ...validated,
  });
}

export function assertPackDoctorReportSemantics(
  report: PackDoctorReport,
): void {
  if (!isRecord(report)) {
    throw new TypeError("pack doctor report is not a plain object");
  }
  const packs = validateDoctorObservations(report.packs);
  const findings = validateIssues(report.findings);
  assertProjectStateBoundary(
    report.project,
    report.installedState,
    packs.length,
    findings,
  );
  const transaction = validateTransaction(report.transaction);
  if (report.project.state !== "ready" && transaction.status !== "not-inspected") {
    throw new TypeError("unready projects cannot carry transaction observations");
  }
  if (
    (report.installedState.status === "empty" ||
      report.installedState.status === "invalid" ||
      report.installedState.status === "not-inspected") &&
    packs.length !== 0
  ) {
    throw new TypeError("unavailable installed state cannot carry pack checks");
  }
  if (
    transaction.status !== "clear" &&
    packs.some(({ integrityStatus }) => integrityStatus !== "not-inspected")
  ) {
    throw new TypeError("unsettled transactions prevent settled integrity claims");
  }
  const expectedSummary = summarizePackDoctorObservations(packs);
  if (
    !isRecord(report.summary) ||
    !sameNumberRecord(
      report.summary as unknown as Readonly<Record<string, number>>,
      expectedSummary as unknown as Readonly<Record<string, number>>,
    )
  ) {
    throw new TypeError("pack doctor summary does not match observations");
  }
  if (report.status !== computePackDoctorStatus(findings)) {
    throw new TypeError("pack doctor status does not match findings");
  }
  const hasBlocked = findings.some(({ severity }) => severity === "blocked");
  const hasAttention = findings.some(({ severity }) => severity === "attention");
  if (
    ["recovery-required", "invalid"].includes(transaction.status) &&
    !hasBlocked
  ) {
    throw new TypeError("unsafe transaction state must be blocked");
  }
  if (
    packs.some(
      ({ integrityStatus }) =>
        integrityStatus === "drifted" || integrityStatus === "unsafe",
    ) &&
    !hasBlocked
  ) {
    throw new TypeError("owned path drift must be blocked");
  }
  if (
    packs.some(
      ({ registryStatus }) => registryStatus !== "current",
    ) &&
    !hasAttention &&
    !hasBlocked
  ) {
    throw new TypeError("registry gaps must preserve attention");
  }
  const bound = report.project.identityDigest !== undefined;
  if (!bound) {
    if (report.reportDigest !== undefined) {
      throw new TypeError("unbound pack doctor cannot carry a digest");
    }
  } else {
    const expectedDigest = computePackDoctorDigest({
      registryDigest: report.registryDigest,
      projectIdentityDigest: report.project.identityDigest as Sha256Digest,
      projectState: report.project.state,
      installedState: report.installedState,
      transaction,
      packs,
      findings,
    });
    if (report.reportDigest !== expectedDigest) {
      throw new TypeError("pack doctor digest does not attest the report body");
    }
  }
  if (
    report.repairPerformed !== false ||
    report.recoveryFinalizationPerformed !== false
  ) {
    throw new TypeError("pack doctor cannot claim repair or finalization");
  }
  assertReadOnlyFlags(report);
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32_767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;
const safeCount = {
  type: "integer",
  minimum: 0,
  maximum: MAX_SAFE_INTEGER,
} as const;
const boundedPackCount = {
  type: "integer",
  minimum: 0,
  maximum: PACK_INSPECTION_MAX_PACKS,
} as const;
const boundedOwnedCount = {
  type: "integer",
  minimum: 0,
  maximum: PACK_INSPECTION_MAX_OWNED_PATHS,
} as const;

const packInspectionProject = closedObject(
  {
    requestedPath: localPath,
    canonicalPath: localPath,
    identityDigest: reference("sha256Digest"),
    state: enumSchema(projectStates),
  },
  ["requestedPath", "state"],
);

const installedStateSummary = closedObject(
  {
    status: enumSchema(installedStateStatuses),
    formatVersion: enumSchema(["1.0.0", "1.1.0"]),
    projectId: reference("stableId"),
    revision: { type: "integer", minimum: 1, maximum: MAX_SAFE_INTEGER },
    stateDigest: reference("sha256Digest"),
    fileDigest: reference("sha256Digest"),
  },
  ["status"],
);

const packInspectionIssue = closedObject(
  {
    severity: enumSchema(issueSeverities),
    code: reference("stableId"),
    message: textSchema(500),
    nextAction: textSchema(500),
    packId: reference("stableId"),
    path: reference("portablePath"),
    expectedDigest: reference("sha256Digest"),
    actualDigest: reference("sha256Digest"),
  },
  ["severity", "code", "message", "nextAction"],
);

const listEntrySchema = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    digest: reference("sha256Digest"),
    dependencyCount: boundedPackCount,
    artifactCount: { type: "integer", minimum: 0, maximum: 64 },
    artifactBytes: safeCount,
    ownedDirectoryCount: { type: "integer", minimum: 0, maximum: 64 },
    installedAt: reference("timestamp"),
    updatedAt: reference("timestamp"),
  },
  [
    "id",
    "version",
    "digest",
    "dependencyCount",
    "artifactCount",
    "artifactBytes",
    "ownedDirectoryCount",
    "installedAt",
    "updatedAt",
  ],
);

const listSummarySchema = closedObject(
  {
    installedPacks: boundedPackCount,
    dependencies: safeCount,
    artifacts: safeCount,
    artifactBytes: safeCount,
    ownedDirectories: safeCount,
  },
  [
    "installedPacks",
    "dependencies",
    "artifacts",
    "artifactBytes",
    "ownedDirectories",
  ],
);

const pathSummarySchema = closedObject(
  {
    declared: boundedOwnedCount,
    current: boundedOwnedCount,
    missing: boundedOwnedCount,
    modified: boundedOwnedCount,
    unreadable: boundedOwnedCount,
  },
  ["declared", "current", "missing", "modified", "unreadable"],
);

const doctorObservationSchema = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    digest: reference("sha256Digest"),
    registryStatus: enumSchema(registryStatuses),
    integrityStatus: enumSchema(integrityStatuses),
    artifacts: pathSummarySchema,
    directories: pathSummarySchema,
  },
  [
    "id",
    "version",
    "digest",
    "registryStatus",
    "integrityStatus",
    "artifacts",
    "directories",
  ],
);

const recoverySummarySchema = closedObject(
  {
    stable: { type: "boolean" },
    consistency: enumSchema(recoveryConsistencies),
    observedState: enumSchema(recoveryObservedStates),
    mutationUncertain: { type: "boolean" },
    finalizationAction: enumSchema(recoveryFinalizationActions),
    reportDigest: reference("sha256Digest"),
  },
  [
    "stable",
    "consistency",
    "observedState",
    "mutationUncertain",
    "finalizationAction",
    "reportDigest",
  ],
);

const transactionPackSchema = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    digest: reference("sha256Digest"),
  },
  ["id", "version", "digest"],
);

const transactionSummarySchema = closedObject(
  {
    status: enumSchema(transactionStatuses),
    runId: reference("uuid"),
    operation: enumSchema(packOperations),
    pack: transactionPackSchema,
    markerFileDigest: reference("sha256Digest"),
    recovery: recoverySummarySchema,
  },
  ["status"],
);

const doctorSummarySchema = closedObject(
  {
    installedPacks: boundedPackCount,
    registryCurrent: boundedPackCount,
    registryDifferent: boundedPackCount,
    registryUnavailable: boundedPackCount,
    declaredArtifacts: boundedOwnedCount,
    currentArtifacts: boundedOwnedCount,
    missingArtifacts: boundedOwnedCount,
    modifiedArtifacts: boundedOwnedCount,
    unreadableArtifacts: boundedOwnedCount,
    declaredDirectories: boundedOwnedCount,
    currentDirectories: boundedOwnedCount,
    missingDirectories: boundedOwnedCount,
    modifiedDirectories: boundedOwnedCount,
    unreadableDirectories: boundedOwnedCount,
  },
  [
    "installedPacks",
    "registryCurrent",
    "registryDifferent",
    "registryUnavailable",
    "declaredArtifacts",
    "currentArtifacts",
    "missingArtifacts",
    "modifiedArtifacts",
    "unreadableArtifacts",
    "declaredDirectories",
    "currentDirectories",
    "missingDirectories",
    "modifiedDirectories",
    "unreadableDirectories",
  ],
);

export const packListRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-list-request",
    version: "1.0.0",
    title: "Pack List Request",
    description:
      "Selects one bounded local project for write-free installed pack listing.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
      },
      ["schemaVersion", "projectRoot"],
    ),
  });

export const packDoctorRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-doctor-request",
    version: "1.0.0",
    title: "Pack Doctor Request",
    description:
      "Selects one bounded local project for write-free managed pack diagnostics.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
      },
      ["schemaVersion", "projectRoot"],
    ),
  });

export const packListReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-list-report",
    version: "1.0.0",
    title: "Pack List Report",
    description:
      "Reports bounded installed pack identities and counts without artifact content or source locations.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "pack.list" },
        status: enumSchema(["ready", "attention", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        project: packInspectionProject,
        installedState: installedStateSummary,
        entries: boundedArray(listEntrySchema, {
          maximum: PACK_INSPECTION_MAX_PACKS,
        }),
        issues: boundedArray(packInspectionIssue, {
          maximum: PACK_INSPECTION_MAX_FINDINGS,
        }),
        summary: listSummarySchema,
        listDigest: reference("sha256Digest"),
        mutationPerformed: { const: false },
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
        artifactContentExposed: { const: false },
        sourceLocationExposed: { const: false },
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "project",
        "installedState",
        "entries",
        "issues",
        "summary",
        "mutationPerformed",
        "externalProcessStarted",
        "networkAccessPerformed",
        "artifactContentExposed",
        "sourceLocationExposed",
      ],
    ),
  });

export const packDoctorReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-doctor-report",
    version: "1.0.0",
    title: "Pack Doctor Report",
    description:
      "Reports bounded managed ownership, registry, and recovery diagnostics without mutation or artifact disclosure.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "pack.doctor" },
        status: enumSchema(["healthy", "attention", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        project: packInspectionProject,
        installedState: installedStateSummary,
        transaction: transactionSummarySchema,
        packs: boundedArray(doctorObservationSchema, {
          maximum: PACK_INSPECTION_MAX_PACKS,
        }),
        findings: boundedArray(packInspectionIssue, {
          maximum: PACK_INSPECTION_MAX_FINDINGS,
        }),
        summary: doctorSummarySchema,
        reportDigest: reference("sha256Digest"),
        repairPerformed: { const: false },
        recoveryFinalizationPerformed: { const: false },
        mutationPerformed: { const: false },
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
        artifactContentExposed: { const: false },
        sourceLocationExposed: { const: false },
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "project",
        "installedState",
        "transaction",
        "packs",
        "findings",
        "summary",
        "repairPerformed",
        "recoveryFinalizationPerformed",
        "mutationPerformed",
        "externalProcessStarted",
        "networkAccessPerformed",
        "artifactContentExposed",
        "sourceLocationExposed",
      ],
    ),
  });
