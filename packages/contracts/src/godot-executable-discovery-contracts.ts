import { compareCanonicalText } from "./canonical-json.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type { OperatingSystem } from "./contract-vocabulary.js";
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

export const GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS = 8;
export const GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES = 32;
export const GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES = 16;
export const GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS: number =
  GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS +
  GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES * 2;

export type GodotExecutableDiscoveryStatus =
  | "ready"
  | "attention"
  | "blocked";
export type GodotExecutableDiscoveryIssueSeverity = "attention" | "blocked";
export type GodotExecutableDiscoveryCandidateSource = "configured" | "path";

export interface GodotExecutableDiscoveryRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
  readonly engine: "godot";
  readonly sources: {
    readonly configuredPaths: readonly string[];
    readonly pathDirectories: readonly string[];
  };
}

export interface GodotExecutableDiscoveryProject {
  readonly requestedPath: string;
  readonly ready: boolean;
  readonly canonicalPath?: string;
  readonly rootIdentityDigest?: Sha256Digest;
  readonly inspectionDigest?: Sha256Digest;
  readonly statusDigest: Sha256Digest;
}

export interface GodotExecutableDiscoverySourceSummary {
  readonly configuredPathCount: number;
  readonly pathDirectoryCount: number;
  readonly consideredPathCount: number;
  readonly acceptedPathCount: number;
  readonly missingPathCount: number;
  readonly rejectedPathCount: number;
  readonly acceptedCandidateCount: number;
  readonly sourceDigest: Sha256Digest;
}

export interface GodotExecutableDiscoveryCandidate {
  readonly label: string;
  readonly platform: OperatingSystem;
  readonly sources: readonly GodotExecutableDiscoveryCandidateSource[];
  readonly bytes: number;
  readonly digest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
}

export interface GodotExecutableDiscoveryIssue {
  readonly severity: GodotExecutableDiscoveryIssueSeverity;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction: string;
}

export interface GodotExecutableDiscoveryAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly permission: "host-tool-inspection";
  readonly grantIds: readonly StableId[];
  readonly status: "succeeded";
  readonly durationMs: number;
  readonly settledAt: string;
}

export interface GodotExecutableDiscoveryDigestInput {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly engine: "godot";
  readonly project: GodotExecutableDiscoveryProject;
  readonly sources: GodotExecutableDiscoverySourceSummary;
  readonly candidates: readonly GodotExecutableDiscoveryCandidate[];
  readonly issues: readonly GodotExecutableDiscoveryIssue[];
  readonly authorization: GodotExecutableDiscoveryAuthorization;
}

export interface GodotExecutableDiscoveryReport
  extends GodotExecutableDiscoveryDigestInput {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "engine.executable-discovery";
  readonly status: GodotExecutableDiscoveryStatus;
  readonly discoveryDigest: Sha256Digest;
  readonly candidateSelectionAvailable: boolean;
  readonly executionAuthorityGranted: false;
  readonly rawPathsDisclosed: false;
  readonly recursiveSearchPerformed: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly installPerformed: false;
}

const statuses: readonly GodotExecutableDiscoveryStatus[] = Object.freeze([
  "ready",
  "attention",
  "blocked",
]);
const severities: readonly GodotExecutableDiscoveryIssueSeverity[] =
  Object.freeze(["attention", "blocked"]);
const platforms: readonly OperatingSystem[] = Object.freeze([
  "windows",
  "linux",
  "macos",
]);
const sourceOrder: readonly GodotExecutableDiscoveryCandidateSource[] =
  Object.freeze(["configured", "path"]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validVersion(value: unknown): value is SemanticVersion {
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function dataObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) &&
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      (descriptor) => "value" in descriptor && descriptor.enumerable === true,
    )
  );
}

function validBoundedPathArray(
  value: unknown,
  maximum: number,
): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => validText(entry, 32_767)) &&
    new Set(value).size === value.length
  );
}

export function assertGodotExecutableDiscoveryRequestSemantics(
  value: GodotExecutableDiscoveryRequest,
): void {
  if (
    !dataObject(value) ||
    !exactKeys(value, ["engine", "projectRoot", "schemaVersion", "sources"]) ||
    value.schemaVersion !== "1.0.0" ||
    value.engine !== "godot" ||
    !validText(value.projectRoot, 32_767) ||
    !dataObject(value.sources) ||
    !exactKeys(value.sources, ["configuredPaths", "pathDirectories"]) ||
    !validBoundedPathArray(
      value.sources.configuredPaths,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS,
    ) ||
    !validBoundedPathArray(
      value.sources.pathDirectories,
      GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES,
    )
  ) {
    throw new TypeError("Godot executable discovery request is outside the contract");
  }
}

function validateProject(value: GodotExecutableDiscoveryProject): void {
  if (
    !dataObject(value) ||
    !exactKeys(
      value,
      ["ready", "requestedPath", "statusDigest"],
      ["canonicalPath", "inspectionDigest", "rootIdentityDigest"],
    ) ||
    typeof value.ready !== "boolean" ||
    !validText(value.requestedPath, 32_767) ||
    !isSha256Digest(value.statusDigest) ||
    (value.canonicalPath !== undefined &&
      !validText(value.canonicalPath, 32_767)) ||
    (value.rootIdentityDigest !== undefined &&
      !isSha256Digest(value.rootIdentityDigest)) ||
    (value.inspectionDigest !== undefined &&
      !isSha256Digest(value.inspectionDigest)) ||
    (value.ready &&
      (value.canonicalPath === undefined ||
        value.rootIdentityDigest === undefined ||
        value.inspectionDigest === undefined))
  ) {
    throw new TypeError("Godot executable discovery project is contradictory");
  }
}

function validCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function validateSources(value: GodotExecutableDiscoverySourceSummary): void {
  if (
    !dataObject(value) ||
    !exactKeys(value, [
      "acceptedCandidateCount",
      "acceptedPathCount",
      "configuredPathCount",
      "consideredPathCount",
      "missingPathCount",
      "pathDirectoryCount",
      "rejectedPathCount",
      "sourceDigest",
    ]) ||
    !validCount(
      value.configuredPathCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS,
    ) ||
    !validCount(
      value.pathDirectoryCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES,
    ) ||
    !validCount(
      value.consideredPathCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    ) ||
    !validCount(
      value.acceptedPathCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    ) ||
    !validCount(
      value.missingPathCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    ) ||
    !validCount(
      value.rejectedPathCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    ) ||
    !validCount(
      value.acceptedCandidateCount,
      GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES,
    ) ||
    value.consideredPathCount !==
      value.acceptedPathCount +
        value.missingPathCount +
        value.rejectedPathCount ||
    value.acceptedCandidateCount > value.acceptedPathCount ||
    !isSha256Digest(value.sourceDigest)
  ) {
    throw new TypeError("Godot executable discovery source summary is contradictory");
  }
}

function validateCandidate(value: GodotExecutableDiscoveryCandidate): void {
  if (
    !dataObject(value) ||
    !exactKeys(value, [
      "bytes",
      "digest",
      "identityDigest",
      "label",
      "platform",
      "sources",
    ]) ||
    !validText(value.label, 256) ||
    !platforms.includes(value.platform) ||
    !Array.isArray(value.sources) ||
    value.sources.length < 1 ||
    value.sources.length > sourceOrder.length ||
    value.sources.some((source) => !sourceOrder.includes(source)) ||
    new Set(value.sources).size !== value.sources.length ||
    !Number.isSafeInteger(value.bytes) ||
    value.bytes < 1 ||
    value.bytes > 512 * 1024 * 1024 ||
    !isSha256Digest(value.digest) ||
    !isSha256Digest(value.identityDigest)
  ) {
    throw new TypeError("Godot executable discovery candidate is outside the contract");
  }
  for (let index = 1; index < value.sources.length; index += 1) {
    const previous = value.sources[index - 1];
    const current = value.sources[index];
    if (
      previous === undefined ||
      current === undefined ||
      sourceOrder.indexOf(previous) >= sourceOrder.indexOf(current)
    ) {
      throw new TypeError("Godot executable discovery candidate sources are not canonical");
    }
  }
}

function issueKey(issue: GodotExecutableDiscoveryIssue): string {
  return `${issue.severity}/${issue.code}`;
}

function validateIssues(value: readonly GodotExecutableDiscoveryIssue[]): void {
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("Godot executable discovery issues exceed the contract");
  }
  let previous: string | undefined;
  for (const issueValue of value as readonly unknown[]) {
    if (
      !dataObject(issueValue) ||
      !exactKeys(issueValue, ["code", "message", "nextAction", "severity"]) ||
      !severities.includes(
        issueValue["severity"] as GodotExecutableDiscoveryIssueSeverity,
      ) ||
      !isStableId(issueValue["code"]) ||
      !validText(issueValue["message"], 1_000) ||
      !validText(issueValue["nextAction"], 1_000)
    ) {
      throw new TypeError("Godot executable discovery issue is outside the contract");
    }
    const issue = issueValue as unknown as GodotExecutableDiscoveryIssue;
    const key = issueKey(issue);
    if (previous !== undefined && compareCanonicalText(previous, key) >= 0) {
      throw new TypeError("Godot executable discovery issues are not canonical");
    }
    previous = key;
  }
}

function validateAuthorization(
  value: GodotExecutableDiscoveryAuthorization,
): void {
  if (
    !dataObject(value) ||
    !exactKeys(value, [
      "authorizationId",
      "durationMs",
      "grantIds",
      "permission",
      "requestDigest",
      "settledAt",
      "status",
    ]) ||
    typeof value.authorizationId !== "string" ||
    !uuidPattern.test(value.authorizationId) ||
    !isSha256Digest(value.requestDigest) ||
    value.permission !== "host-tool-inspection" ||
    !Array.isArray(value.grantIds) ||
    value.grantIds.length !== 1 ||
    !isStableId(value.grantIds[0]) ||
    value.status !== "succeeded" ||
    !Number.isSafeInteger(value.durationMs) ||
    value.durationMs < 0 ||
    value.durationMs > 10_000 ||
    typeof value.settledAt !== "string" ||
    !timestampPattern.test(value.settledAt) ||
    Number.isNaN(Date.parse(value.settledAt)) ||
    new Date(Date.parse(value.settledAt)).toISOString() !== value.settledAt
  ) {
    throw new TypeError("Godot executable discovery authorization is contradictory");
  }
}

function validateDigestInput(input: GodotExecutableDiscoveryDigestInput): void {
  if (
    !dataObject(input) ||
    !exactKeys(input, [
      "authorization",
      "candidates",
      "controlPlaneVersion",
      "engine",
      "issues",
      "project",
      "registryDigest",
      "sources",
    ]) ||
    !validVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    input.engine !== "godot"
  ) {
    throw new TypeError("Godot executable discovery digest input is invalid");
  }
  validateProject(input.project);
  validateSources(input.sources);
  validateAuthorization(input.authorization);
  if (
    !Array.isArray(input.candidates) ||
    input.candidates.length > GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES
  ) {
    throw new TypeError("Godot executable discovery candidates exceed the contract");
  }
  let previousIdentity: string | undefined;
  const identities = new Set<string>();
  for (const candidate of input.candidates) {
    validateCandidate(candidate);
    if (
      previousIdentity !== undefined &&
      compareCanonicalText(previousIdentity, candidate.identityDigest) >= 0
    ) {
      throw new TypeError("Godot executable discovery candidates are not canonical");
    }
    if (identities.has(candidate.identityDigest)) {
      throw new TypeError("Godot executable discovery candidate identity is duplicated");
    }
    identities.add(candidate.identityDigest);
    previousIdentity = candidate.identityDigest;
  }
  if (input.sources.acceptedCandidateCount !== input.candidates.length) {
    throw new TypeError("Godot executable discovery candidate count is contradictory");
  }
  if (!input.project.ready) {
    if (
      input.sources.consideredPathCount !== 0 ||
      input.candidates.length !== 0 ||
      !input.issues.some(({ severity }) => severity === "blocked")
    ) {
      throw new TypeError("Blocked Godot project must not produce discovery candidates");
    }
  }
  validateIssues(input.issues);
}

export function computeGodotExecutableDiscoveryStatus(
  issues: readonly GodotExecutableDiscoveryIssue[],
): GodotExecutableDiscoveryStatus {
  if (issues.some(({ severity }) => severity === "blocked")) return "blocked";
  if (issues.some(({ severity }) => severity === "attention")) return "attention";
  return "ready";
}

export function computeGodotExecutableDiscoveryDigest(
  input: GodotExecutableDiscoveryDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-executable-discovery",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotExecutableDiscoveryReportSemantics(
  report: GodotExecutableDiscoveryReport,
): void {
  if (
    !dataObject(report) ||
    !exactKeys(report, [
      "authorization",
      "candidateSelectionAvailable",
      "candidates",
      "commandId",
      "controlPlaneVersion",
      "discoveryDigest",
      "engine",
      "executionAuthorityGranted",
      "externalProcessStarted",
      "installPerformed",
      "issues",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "rawPathsDisclosed",
      "recursiveSearchPerformed",
      "registryDigest",
      "schemaVersion",
      "sources",
      "status",
    ]) ||
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.executable-discovery" ||
    !statuses.includes(report.status) ||
    typeof report.candidateSelectionAvailable !== "boolean" ||
    report.executionAuthorityGranted !== false ||
    report.rawPathsDisclosed !== false ||
    report.recursiveSearchPerformed !== false ||
    report.mutationPerformed !== false ||
    report.externalProcessStarted !== false ||
    report.networkAccessPerformed !== false ||
    report.installPerformed !== false ||
    !isSha256Digest(report.discoveryDigest)
  ) {
    throw new TypeError("Godot executable discovery report is outside the contract");
  }
  const {
    schemaVersion: _,
    commandId: __,
    status: ___,
    discoveryDigest,
    candidateSelectionAvailable,
    executionAuthorityGranted: ____,
    rawPathsDisclosed: _____,
    recursiveSearchPerformed: ______,
    mutationPerformed: _______,
    externalProcessStarted: ________,
    networkAccessPerformed: _________,
    installPerformed: __________,
    ...input
  } = report;
  validateDigestInput(input as GodotExecutableDiscoveryDigestInput);
  if (report.status !== computeGodotExecutableDiscoveryStatus(report.issues)) {
    throw new TypeError("Godot executable discovery status is contradictory");
  }
  const expectedSelection =
    report.project.ready && report.status !== "blocked" && report.candidates.length > 0;
  if (candidateSelectionAvailable !== expectedSelection) {
    throw new TypeError("Godot executable discovery selection state is contradictory");
  }
  if (
    discoveryDigest !==
    computeGodotExecutableDiscoveryDigest(
      input as GodotExecutableDiscoveryDigestInput,
    )
  ) {
    throw new TypeError("Godot executable discovery digest does not attest its report");
  }
}

const pathText = {
  type: "string",
  minLength: 1,
  maxLength: 32_767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const discoverySourcesRequest = closedObject(
  {
    configuredPaths: boundedArray(pathText, {
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS,
      unique: true,
    }),
    pathDirectories: boundedArray(pathText, {
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES,
      unique: true,
    }),
  },
  ["configuredPaths", "pathDirectories"],
);

export const godotExecutableDiscoveryRequestSchema: VersionedContractSchema =
  defineContractSchema({
  id: "godot-executable-discovery-request",
  version: "1.0.0",
  title: "Godot Executable Discovery Request",
  description:
    "Selects bounded explicit executable paths and PATH directories for one internal read-only Godot discovery pass.",
  schema: contractRoot(
    {
      schemaVersion: reference("semanticVersion"),
      projectRoot: pathText,
      engine: { const: "godot" },
      sources: discoverySourcesRequest,
    },
    ["schemaVersion", "projectRoot", "engine", "sources"],
  ),
  });

const project = closedObject(
  {
    requestedPath: pathText,
    ready: { type: "boolean" },
    canonicalPath: pathText,
    rootIdentityDigest: reference("sha256Digest"),
    inspectionDigest: reference("sha256Digest"),
    statusDigest: reference("sha256Digest"),
  },
  ["requestedPath", "ready", "statusDigest"],
);

const sourceSummary = closedObject(
  {
    configuredPathCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONFIGURED_PATHS,
    },
    pathDirectoryCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_PATH_DIRECTORIES,
    },
    consideredPathCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    },
    acceptedPathCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    },
    missingPathCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    },
    rejectedPathCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CONSIDERED_PATHS,
    },
    acceptedCandidateCount: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES,
    },
    sourceDigest: reference("sha256Digest"),
  },
  [
    "configuredPathCount",
    "pathDirectoryCount",
    "consideredPathCount",
    "acceptedPathCount",
    "missingPathCount",
    "rejectedPathCount",
    "acceptedCandidateCount",
    "sourceDigest",
  ],
);

const candidate = closedObject(
  {
    label: textSchema(256),
    platform: reference("operatingSystem"),
    sources: boundedArray(enumSchema(sourceOrder), {
      minimum: 1,
      maximum: sourceOrder.length,
      unique: true,
    }),
    bytes: { type: "integer", minimum: 1, maximum: 512 * 1024 * 1024 },
    digest: reference("sha256Digest"),
    identityDigest: reference("sha256Digest"),
  },
  ["label", "platform", "sources", "bytes", "digest", "identityDigest"],
);

const issue = closedObject(
  {
    severity: enumSchema(severities),
    code: reference("stableId"),
    message: textSchema(1_000),
    nextAction: textSchema(1_000),
  },
  ["severity", "code", "message", "nextAction"],
);

const authorization = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    permission: { const: "host-tool-inspection" },
    grantIds: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 1,
      unique: true,
    }),
    status: { const: "succeeded" },
    durationMs: { type: "integer", minimum: 0, maximum: 10_000 },
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "permission",
    "grantIds",
    "status",
    "durationMs",
    "settledAt",
  ],
);

export const godotExecutableDiscoveryReportSchema: VersionedContractSchema =
  defineContractSchema({
  id: "godot-executable-discovery-report",
  version: "1.0.0",
  title: "Godot Executable Discovery Report",
  description:
    "Reports bounded executable identities without raw host paths, process execution, installation, or transferable execution authority.",
  schema: contractRoot(
    {
      schemaVersion: reference("semanticVersion"),
      commandId: { const: "engine.executable-discovery" },
      controlPlaneVersion: reference("semanticVersion"),
      registryDigest: reference("sha256Digest"),
      engine: { const: "godot" },
      project,
      sources: sourceSummary,
      candidates: boundedArray(candidate, {
        maximum: GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES,
      }),
      issues: boundedArray(issue, { maximum: 64 }),
      authorization,
      status: enumSchema(statuses),
      discoveryDigest: reference("sha256Digest"),
      candidateSelectionAvailable: { type: "boolean" },
      executionAuthorityGranted: { const: false },
      rawPathsDisclosed: { const: false },
      recursiveSearchPerformed: { const: false },
      mutationPerformed: { const: false },
      externalProcessStarted: { const: false },
      networkAccessPerformed: { const: false },
      installPerformed: { const: false },
    },
    [
      "schemaVersion",
      "commandId",
      "controlPlaneVersion",
      "registryDigest",
      "engine",
      "project",
      "sources",
      "candidates",
      "issues",
      "authorization",
      "status",
      "discoveryDigest",
      "candidateSelectionAvailable",
      "executionAuthorityGranted",
      "rawPathsDisclosed",
      "recursiveSearchPerformed",
      "mutationPerformed",
      "externalProcessStarted",
      "networkAccessPerformed",
      "installPerformed",
    ],
  ),
  });
