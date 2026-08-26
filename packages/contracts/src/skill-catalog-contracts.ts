import { compareCanonicalText } from "./canonical-json.js";
import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import {
  PERMISSION_CLASSES,
  type PermissionClass,
} from "./contract-vocabulary.js";
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

export const SKILL_CATALOG_MAX_ENTRIES: number = 64;
export const SKILL_REPORT_MAX_ISSUES: number = 32;
export const SKILL_TARGET_MAX_BYTES: number = 64 * 1024;

export type SkillInvocation = "user" | "model" | "both";
export type SkillListStatus = "ready" | "blocked";
export type SkillCheckStatus = "ready" | "attention" | "blocked";
export type SkillTargetStatus = "missing" | "current" | "conflict" | "unsafe";
export type SkillReportIssueSeverity = "attention" | "blocked";

export interface SkillListRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface SkillCheckRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface SkillReportProjectSummary {
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly identityDigest?: Sha256Digest;
}

export interface SkillReportIssue {
  readonly severity: SkillReportIssueSeverity;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction: string;
  readonly path?: PortableProjectPath;
}

export interface SkillCatalogEntry {
  readonly id: StableId;
  readonly name: string;
  readonly version: SemanticVersion;
  readonly invocation: SkillInvocation;
  readonly summary: string;
  readonly capabilities: readonly StableId[];
  readonly requiredPermissions: readonly PermissionClass[];
  readonly artifactPath: PortableProjectPath;
  readonly artifactDigest: Sha256Digest;
  readonly maxTokens: number;
  readonly targetPath: PortableProjectPath;
}

export interface SkillCatalogSummary {
  readonly registered: number;
  readonly modelInvoked: number;
  readonly userInvoked: number;
}

export interface SkillListReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "skill.list";
  readonly status: SkillListStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: SkillReportProjectSummary;
  readonly entries: readonly SkillCatalogEntry[];
  readonly issues: readonly SkillReportIssue[];
  readonly summary: SkillCatalogSummary;
  readonly catalogDigest?: Sha256Digest;
  readonly materializationAvailable: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
}

export interface SkillCheckObservation {
  readonly id: StableId;
  readonly name: string;
  readonly artifactPath: PortableProjectPath;
  readonly artifactDigest: Sha256Digest;
  readonly targetPath: PortableProjectPath;
  readonly targetStatus: SkillTargetStatus;
  readonly code: StableId;
  readonly actualDigest?: Sha256Digest;
  readonly bytes?: number;
}

export interface SkillCheckSummary {
  readonly total: number;
  readonly missing: number;
  readonly current: number;
  readonly conflict: number;
  readonly unsafe: number;
}

export interface SkillCheckReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "skill.check";
  readonly status: SkillCheckStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: SkillReportProjectSummary;
  readonly checks: readonly SkillCheckObservation[];
  readonly issues: readonly SkillReportIssue[];
  readonly summary: SkillCheckSummary;
  readonly checkDigest?: Sha256Digest;
  readonly materializationPerformed: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
}

export interface SkillCatalogDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly entries: readonly SkillCatalogEntry[];
}

export interface SkillCheckDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly checks: readonly SkillCheckObservation[];
}

const skillInvocations: readonly SkillInvocation[] = Object.freeze([
  "user",
  "model",
  "both",
]);
const skillTargetStatuses: readonly SkillTargetStatus[] = Object.freeze([
  "missing",
  "current",
  "conflict",
  "unsafe",
]);
const issueSeverities: readonly SkillReportIssueSeverity[] = Object.freeze([
  "attention",
  "blocked",
]);
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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

function validStableIds(
  value: unknown,
  minimum: number,
): value is readonly StableId[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= 64 &&
    value.every((entry) => isStableId(entry)) &&
    new Set(value).size === value.length
  );
}

function validPermissions(value: unknown): value is readonly PermissionClass[] {
  return (
    Array.isArray(value) &&
    value.length <= PERMISSION_CLASSES.length &&
    value.every((permission) => PERMISSION_CLASSES.includes(permission)) &&
    new Set(value).size === value.length
  );
}

function validateArtifactPaths(
  name: string,
  artifactPath: unknown,
  targetPath: unknown,
): boolean {
  return (
    isPortableProjectPath(artifactPath) &&
    isPortableProjectPath(targetPath) &&
    artifactPath === `skills/${name}/SKILL.md` &&
    targetPath === `.agents/skills/${name}/SKILL.md`
  );
}

function validateCatalogEntries(
  entries: readonly SkillCatalogEntry[],
): readonly SkillCatalogEntry[] {
  if (!Array.isArray(entries) || entries.length > SKILL_CATALOG_MAX_ENTRIES) {
    throw new RangeError("skill catalog entry count exceeds the report contract");
  }
  let previousId: string | undefined;
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !exactKeys(entry, [
        "artifactDigest",
        "artifactPath",
        "capabilities",
        "id",
        "invocation",
        "maxTokens",
        "name",
        "requiredPermissions",
        "summary",
        "targetPath",
        "version",
      ]) ||
      !isStableId(entry.id) ||
      !skillNamePattern.test(entry.name) ||
      !skillInvocations.includes(entry.invocation) ||
      !validText(entry.summary, 240) ||
      !validStableIds(entry.capabilities, 1) ||
      !validPermissions(entry.requiredPermissions) ||
      !isSha256Digest(entry.artifactDigest) ||
      !Number.isSafeInteger(entry.maxTokens) ||
      entry.maxTokens < 1 ||
      entry.maxTokens > 100_000 ||
      !validateArtifactPaths(entry.name, entry.artifactPath, entry.targetPath)
    ) {
      throw new TypeError("skill catalog entry is outside the report contract");
    }
    try {
      if (parseSemanticVersion(entry.version).value !== entry.version) {
        throw new TypeError();
      }
    } catch {
      throw new TypeError("skill catalog version is not canonical");
    }
    if (
      previousId !== undefined &&
      compareCanonicalText(previousId, entry.id) >= 0
    ) {
      throw new TypeError("skill catalog entries must be uniquely ordered");
    }
    previousId = entry.id;
  }
  return entries;
}

function validateIssueArray(
  issues: readonly SkillReportIssue[],
): readonly SkillReportIssue[] {
  if (!Array.isArray(issues) || issues.length > SKILL_REPORT_MAX_ISSUES) {
    throw new RangeError("skill report issue count exceeds the contract");
  }
  for (const issue of issues) {
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
      (issue.path !== undefined && !isPortableProjectPath(issue.path))
    ) {
      throw new TypeError("skill report issue is outside the contract");
    }
  }
  return issues;
}

function validateCheckCode(check: SkillCheckObservation): boolean {
  if (check.targetStatus === "missing") {
    return (
      check.code === "skill-target-missing" &&
      check.actualDigest === undefined &&
      check.bytes === undefined
    );
  }
  if (check.targetStatus === "current") {
    return (
      check.code === "skill-target-current" &&
      check.actualDigest === check.artifactDigest &&
      Number.isSafeInteger(check.bytes) &&
      (check.bytes ?? 0) >= 1 &&
      (check.bytes ?? 0) <= SKILL_TARGET_MAX_BYTES
    );
  }
  if (check.targetStatus === "unsafe") {
    return (
      check.code === "skill-target-unsafe" &&
      check.actualDigest === undefined &&
      check.bytes === undefined
    );
  }
  if (check.code === "skill-target-byte-budget-exceeded") {
    return check.actualDigest === undefined && check.bytes === undefined;
  }
  return (
    check.code === "skill-target-content-conflict" &&
    isSha256Digest(check.actualDigest) &&
    check.actualDigest !== check.artifactDigest &&
    Number.isSafeInteger(check.bytes) &&
    (check.bytes ?? 0) >= 1 &&
    (check.bytes ?? 0) <= SKILL_TARGET_MAX_BYTES
  );
}

function validateSkillChecks(
  checks: readonly SkillCheckObservation[],
): readonly SkillCheckObservation[] {
  if (!Array.isArray(checks) || checks.length > SKILL_CATALOG_MAX_ENTRIES) {
    throw new RangeError("skill check count exceeds the report contract");
  }
  let previousId: string | undefined;
  for (const check of checks) {
    if (
      typeof check !== "object" ||
      check === null ||
      !exactKeys(
        check,
        [
          "artifactDigest",
          "artifactPath",
          "code",
          "id",
          "name",
          "targetPath",
          "targetStatus",
        ],
        ["actualDigest", "bytes"],
      ) ||
      !isStableId(check.id) ||
      !skillNamePattern.test(check.name) ||
      !isSha256Digest(check.artifactDigest) ||
      !isStableId(check.code) ||
      !skillTargetStatuses.includes(check.targetStatus) ||
      !validateArtifactPaths(check.name, check.artifactPath, check.targetPath) ||
      !validateCheckCode(check)
    ) {
      throw new TypeError("skill check observation is outside the contract");
    }
    if (
      previousId !== undefined &&
      compareCanonicalText(previousId, check.id) >= 0
    ) {
      throw new TypeError("skill checks must be uniquely ordered");
    }
    previousId = check.id;
  }
  return checks;
}

export function summarizeSkillCatalogEntries(
  entries: readonly SkillCatalogEntry[],
): SkillCatalogSummary {
  validateCatalogEntries(entries);
  let modelInvoked = 0;
  let userInvoked = 0;
  for (const entry of entries) {
    modelInvoked += entry.invocation === "model" || entry.invocation === "both" ? 1 : 0;
    userInvoked += entry.invocation === "user" || entry.invocation === "both" ? 1 : 0;
  }
  return Object.freeze({
    registered: entries.length,
    modelInvoked,
    userInvoked,
  });
}

export function computeSkillCatalogDigest(
  input: SkillCatalogDigestInput,
): Sha256Digest {
  if (
    typeof input !== "object" ||
    input === null ||
    !exactKeys(input, ["entries", "registryDigest"]) ||
    !isSha256Digest(input.registryDigest)
  ) {
    throw new TypeError("skill catalog digest input has invalid authority");
  }
  validateCatalogEntries(input.entries);
  return digestCanonicalJson({
    domain: "ai-game-playbook/skill-catalog",
    version: "1.0.0",
    registryDigest: input.registryDigest,
    entries: input.entries,
  });
}

export function summarizeSkillChecks(
  checks: readonly SkillCheckObservation[],
): SkillCheckSummary {
  validateSkillChecks(checks);
  let missing = 0;
  let current = 0;
  let conflict = 0;
  let unsafe = 0;
  for (const check of checks) {
    if (check.targetStatus === "missing") missing += 1;
    else if (check.targetStatus === "current") current += 1;
    else if (check.targetStatus === "conflict") conflict += 1;
    else unsafe += 1;
  }
  return Object.freeze({
    total: checks.length,
    missing,
    current,
    conflict,
    unsafe,
  });
}

export function computeSkillCheckStatus(
  checks: readonly SkillCheckObservation[],
  issues: readonly SkillReportIssue[] = Object.freeze([]),
): SkillCheckStatus {
  const summary = summarizeSkillChecks(checks);
  validateIssueArray(issues);
  if (
    summary.conflict > 0 ||
    summary.unsafe > 0 ||
    issues.some(({ severity }) => severity === "blocked")
  ) {
    return "blocked";
  }
  if (
    summary.missing > 0 ||
    issues.some(({ severity }) => severity === "attention")
  ) {
    return "attention";
  }
  return "ready";
}

export function computeSkillCheckDigest(
  input: SkillCheckDigestInput,
): Sha256Digest {
  if (
    typeof input !== "object" ||
    input === null ||
    !exactKeys(input, ["checks", "projectIdentityDigest", "registryDigest"]) ||
    !isSha256Digest(input.registryDigest) ||
    !isSha256Digest(input.projectIdentityDigest)
  ) {
    throw new TypeError("skill check digest input has invalid authority");
  }
  validateSkillChecks(input.checks);
  return digestCanonicalJson({
    domain: "ai-game-playbook/skill-check",
    version: "1.0.0",
    registryDigest: input.registryDigest,
    projectIdentityDigest: input.projectIdentityDigest,
    checks: input.checks,
  });
}

function sameSummary(
  left: SkillCatalogSummary | SkillCheckSummary,
  right: SkillCatalogSummary | SkillCheckSummary,
): boolean {
  const leftKeys = Object.keys(left).sort(compareCanonicalText);
  const rightKeys = Object.keys(right).sort(compareCanonicalText);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        (left as unknown as Record<string, number>)[key] ===
          (right as unknown as Record<string, number>)[key],
    )
  );
}

function projectIsBound(project: SkillReportProjectSummary): boolean {
  const hasPath = project.canonicalPath !== undefined;
  const hasIdentity = project.identityDigest !== undefined;
  if (hasPath !== hasIdentity) {
    throw new TypeError("skill report project identity is incomplete");
  }
  return hasPath;
}

export function assertSkillListReportSemantics(report: SkillListReport): void {
  if (typeof report !== "object" || report === null) {
    throw new TypeError("skill list report is not an object");
  }
  validateIssueArray(report.issues);
  const summary = summarizeSkillCatalogEntries(report.entries);
  if (!sameSummary(report.summary, summary)) {
    throw new TypeError("skill list summary does not match its entries");
  }
  const bound = projectIsBound(report.project);
  if (!bound) {
    if (
      report.status !== "blocked" ||
      report.entries.length !== 0 ||
      report.catalogDigest !== undefined ||
      !report.issues.some(({ severity }) => severity === "blocked")
    ) {
      throw new TypeError("unbound skill list reports cannot carry a catalog");
    }
    return;
  }
  if (report.status !== "ready" || report.issues.length !== 0) {
    throw new TypeError("bound skill list reports must be ready and issue-free");
  }
  const digest = computeSkillCatalogDigest({
    registryDigest: report.registryDigest,
    entries: report.entries,
  });
  if (report.catalogDigest !== digest) {
    throw new TypeError("skill catalog digest does not attest its entries");
  }
}

export function assertSkillCheckReportSemantics(report: SkillCheckReport): void {
  if (typeof report !== "object" || report === null) {
    throw new TypeError("skill check report is not an object");
  }
  validateIssueArray(report.issues);
  const summary = summarizeSkillChecks(report.checks);
  if (!sameSummary(report.summary, summary)) {
    throw new TypeError("skill check summary does not match its observations");
  }
  const bound = projectIsBound(report.project);
  if (!bound) {
    if (
      report.status !== "blocked" ||
      report.checks.length !== 0 ||
      report.checkDigest !== undefined ||
      !report.issues.some(({ severity }) => severity === "blocked")
    ) {
      throw new TypeError("unbound skill check reports cannot carry observations");
    }
    return;
  }
  if (report.status !== computeSkillCheckStatus(report.checks, report.issues)) {
    throw new TypeError("skill check status does not match its observations");
  }
  const digest = computeSkillCheckDigest({
    registryDigest: report.registryDigest,
    projectIdentityDigest: report.project.identityDigest as Sha256Digest,
    checks: report.checks,
  });
  if (report.checkDigest !== digest) {
    throw new TypeError("skill check digest does not attest its observations");
  }
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const skillProject = closedObject(
  {
    requestedPath: localPath,
    canonicalPath: localPath,
    identityDigest: reference("sha256Digest"),
  },
  ["requestedPath"],
);

const skillIssue = closedObject(
  {
    severity: enumSchema(issueSeverities),
    code: reference("stableId"),
    message: textSchema(500),
    nextAction: textSchema(500),
    path: reference("portablePath"),
  },
  ["severity", "code", "message", "nextAction"],
);

const skillCatalogEntry = closedObject(
  {
    id: reference("stableId"),
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    version: reference("semanticVersion"),
    invocation: enumSchema(skillInvocations),
    summary: textSchema(240),
    capabilities: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 64,
      unique: true,
    }),
    requiredPermissions: boundedArray(reference("permissionClass"), {
      maximum: PERMISSION_CLASSES.length,
      unique: true,
    }),
    artifactPath: reference("portablePath"),
    artifactDigest: reference("sha256Digest"),
    maxTokens: { type: "integer", minimum: 1, maximum: 100_000 },
    targetPath: reference("portablePath"),
  },
  [
    "id",
    "name",
    "version",
    "invocation",
    "summary",
    "capabilities",
    "requiredPermissions",
    "artifactPath",
    "artifactDigest",
    "maxTokens",
    "targetPath",
  ],
);

const skillCatalogSummary = closedObject(
  {
    registered: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    modelInvoked: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    userInvoked: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
  },
  ["registered", "modelInvoked", "userInvoked"],
);

const skillCheckObservation = closedObject(
  {
    id: reference("stableId"),
    name: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    },
    artifactPath: reference("portablePath"),
    artifactDigest: reference("sha256Digest"),
    targetPath: reference("portablePath"),
    targetStatus: enumSchema(skillTargetStatuses),
    code: reference("stableId"),
    actualDigest: reference("sha256Digest"),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: SKILL_TARGET_MAX_BYTES,
    },
  },
  [
    "id",
    "name",
    "artifactPath",
    "artifactDigest",
    "targetPath",
    "targetStatus",
    "code",
  ],
);

const skillCheckSummary = closedObject(
  {
    total: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    missing: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    current: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    conflict: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
    unsafe: { type: "integer", minimum: 0, maximum: SKILL_CATALOG_MAX_ENTRIES },
  },
  ["total", "missing", "current", "conflict", "unsafe"],
);

function requestSchema(id: "skill-list-request" | "skill-check-request", title: string) {
  return defineContractSchema({
    id,
    version: "1.0.0",
    title,
    description: "Selects one bounded local project for read-only skill inspection.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
      },
      ["schemaVersion", "projectRoot"],
    ),
  });
}

export const skillListRequestSchema: VersionedContractSchema = requestSchema(
  "skill-list-request",
  "Skill List Request",
);

export const skillCheckRequestSchema: VersionedContractSchema = requestSchema(
  "skill-check-request",
  "Skill Check Request",
);

export const skillListReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "skill-list-report",
    version: "1.0.0",
    title: "Skill List Report",
    description:
      "Lists bounded stable registry skills for one project without materialization.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          commandId: { const: "skill.list" },
          status: enumSchema(["ready", "blocked"]),
          controlPlaneVersion: reference("semanticVersion"),
          registryDigest: reference("sha256Digest"),
          project: skillProject,
          entries: boundedArray(skillCatalogEntry, {
            maximum: SKILL_CATALOG_MAX_ENTRIES,
          }),
          issues: boundedArray(skillIssue, {
            maximum: SKILL_REPORT_MAX_ISSUES,
          }),
          summary: skillCatalogSummary,
          catalogDigest: reference("sha256Digest"),
          materializationAvailable: { const: false },
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
          "entries",
          "issues",
          "summary",
          "materializationAvailable",
          "mutationPerformed",
          "externalProcessStarted",
          "networkAccessPerformed",
        ],
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: { status: { const: "ready" } },
            required: ["status"],
          },
          then: {
            type: "object",
            required: ["catalogDigest"],
            properties: {
              catalogDigest: reference("sha256Digest"),
              project: {
                type: "object",
                properties: {
                  canonicalPath: localPath,
                  identityDigest: reference("sha256Digest"),
                },
                required: ["canonicalPath", "identityDigest"],
              },
            },
          },
        },
      ],
    },
  });

export const skillCheckReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "skill-check-report",
    version: "1.0.0",
    title: "Skill Check Report",
    description:
      "Reports bounded packaged-artifact and project-target skill state without mutation.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          commandId: { const: "skill.check" },
          status: enumSchema(["ready", "attention", "blocked"]),
          controlPlaneVersion: reference("semanticVersion"),
          registryDigest: reference("sha256Digest"),
          project: skillProject,
          checks: boundedArray(skillCheckObservation, {
            maximum: SKILL_CATALOG_MAX_ENTRIES,
          }),
          issues: boundedArray(skillIssue, {
            maximum: SKILL_REPORT_MAX_ISSUES,
          }),
          summary: skillCheckSummary,
          checkDigest: reference("sha256Digest"),
          materializationPerformed: { const: false },
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
          "checks",
          "issues",
          "summary",
          "materializationPerformed",
          "mutationPerformed",
          "externalProcessStarted",
          "networkAccessPerformed",
        ],
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: {
              status: { enum: ["ready", "attention"] },
            },
            required: ["status"],
          },
          then: {
            type: "object",
            required: ["checkDigest"],
            properties: {
              checkDigest: reference("sha256Digest"),
              project: {
                type: "object",
                properties: {
                  canonicalPath: localPath,
                  identityDigest: reference("sha256Digest"),
                },
                required: ["canonicalPath", "identityDigest"],
              },
            },
          },
        },
      ],
    },
  });
