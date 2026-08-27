import { compareCanonicalText } from "./canonical-json.js";
import {
  defineContractSchema,
  type JsonSchemaObject,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  ENGINE_OPERATION_KINDS,
  PERMISSION_CLASSES,
  type EngineId,
  type EngineOperationKind,
  type PermissionClass,
} from "./contract-vocabulary.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import type { EngineStatusProjectState } from "./engine-status-contracts.js";
import {
  PROCESS_CONTAINMENT_REQUIREMENTS,
  type ProcessContainmentRequirements,
} from "./process-containment-assessment-contracts.js";
import {
  engineCapabilityReportSchema,
  type EngineCapability,
  type EngineCapabilityReport,
} from "./project-engine-contracts.js";
import { computeGameProjectIdentityDigest } from "./project-inspect-contracts.js";
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
import { isStableId, parseStableId, type StableId } from "./stable-id.js";
import { checkEngineCapabilityReportSemantics } from "./semantic-validation.js";

export const ENGINE_CAPABILITIES_MAX_ISSUES: number = 64;

export type EngineCapabilitiesStatus = "attention" | "blocked";
export type EngineCapabilitiesIssueSeverity = "attention" | "blocked";

export interface EngineCapabilitiesRequest {
  readonly schemaVersion: "1.0.0";
  readonly projectRoot: string;
  readonly engine: "godot";
}

export interface EngineCapabilitiesProjectObservation {
  readonly status: EngineStatusProjectState;
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly rootIdentityDigest?: Sha256Digest;
  readonly inspectionDigest?: Sha256Digest;
  readonly identitySource?: "derived-static";
  readonly projectId?: StableId;
  readonly projectIdentityDigest?: Sha256Digest;
  readonly observedVersion?: SemanticVersion;
}

export interface EngineCapabilitiesContainmentSummary {
  readonly registration: "compiled";
  readonly dynamicRegistration: false;
  readonly providerCount: 0;
  readonly catalogDigest: Sha256Digest;
  readonly status: "unavailable";
  readonly selfTestPerformed: false;
  readonly launchAvailable: false;
  readonly decision: "block";
  readonly requirements: ProcessContainmentRequirements;
  readonly reason: string;
}

export interface EngineCapabilitiesIssue {
  readonly severity: EngineCapabilitiesIssueSeverity;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction: string;
  readonly path?: string;
}

export interface EngineCapabilitiesEnvironmentDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly engine: "godot";
  readonly engineStatusDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly supportGradeCeiling: "planned";
}

export interface EngineCapabilitiesReportIdInput {
  readonly environmentDigest: Sha256Digest;
  readonly generatedAt: string;
}

export interface EngineCapabilitiesDigestInput {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly engine: "godot";
  readonly engineStatusDigest: Sha256Digest;
  readonly project: EngineCapabilitiesProjectObservation;
  readonly containment: EngineCapabilitiesContainmentSummary;
  readonly capabilityReport?: EngineCapabilityReport;
  readonly supportGradeCeiling: "planned";
  readonly issues: readonly EngineCapabilitiesIssue[];
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly editorControlPerformed: false;
  readonly selfTestPerformed: false;
}

export interface EngineCapabilitiesReport extends EngineCapabilitiesDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: "engine.capabilities";
  readonly status: EngineCapabilitiesStatus;
  readonly reportDigest: Sha256Digest;
}

const projectStates: readonly EngineStatusProjectState[] = Object.freeze([
  "not-inspected",
  "not-detected",
  "partial",
  "detected",
  "ambiguous",
  "blocked",
]);

function dataObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  message: string,
): Record<string, unknown> {
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
  const names = Object.getOwnPropertyNames(value);
  const allowed = [...required, ...optional];
  if (
    names.length < required.length ||
    names.length > allowed.length ||
    !required.every((name) => names.includes(name)) ||
    !names.every((name) => allowed.includes(name))
  ) {
    throw new TypeError(message);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(message);
    }
  }
  return value as Record<string, unknown>;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function dataArray(
  value: unknown,
  minimum: number,
  maximum: number,
  message: string,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length < minimum ||
    value.length > maximum
  ) {
    throw new TypeError(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    !names.includes("length") ||
    !Array.from({ length: value.length }, (_, index) => String(index)).every(
      (name) => names.includes(name),
    )
  ) {
    throw new TypeError(message);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(message);
    }
  }
  return value;
}

function validText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximum &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
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

function uniqueTextArray(
  value: unknown,
  minimum: number,
  maximum: number,
  itemMaximum: number,
  message: string,
): readonly string[] {
  const values = dataArray(value, minimum, maximum, message);
  if (
    !values.every((item) => validText(item, itemMaximum)) ||
    new Set(values).size !== values.length
  ) {
    throw new TypeError(message);
  }
  return values as readonly string[];
}

function stableIdArray(
  value: unknown,
  minimum: number,
  maximum: number,
  message: string,
): readonly StableId[] {
  const values = dataArray(value, minimum, maximum, message);
  if (
    !values.every((item) => isStableId(item)) ||
    new Set(values).size !== values.length
  ) {
    throw new TypeError(message);
  }
  return values as readonly StableId[];
}

function permissionArray(
  value: unknown,
  message: string,
): readonly PermissionClass[] {
  const values = dataArray(value, 1, PERMISSION_CLASSES.length, message);
  if (
    !values.every(
      (item) =>
        typeof item === "string" &&
        PERMISSION_CLASSES.includes(item as PermissionClass),
    ) ||
    new Set(values).size !== values.length
  ) {
    throw new TypeError(message);
  }
  return values as readonly PermissionClass[];
}

function validateRequirements(value: unknown): ProcessContainmentRequirements {
  const requirements = dataObject(
    value,
    ["filesystem", "network", "childProcesses"],
    [],
    "engine capabilities containment requirements are outside the contract",
  );
  if (
    ownValue(requirements, "filesystem") !==
      PROCESS_CONTAINMENT_REQUIREMENTS.filesystem ||
    ownValue(requirements, "network") !==
      PROCESS_CONTAINMENT_REQUIREMENTS.network ||
    ownValue(requirements, "childProcesses") !==
      PROCESS_CONTAINMENT_REQUIREMENTS.childProcesses
  ) {
    throw new TypeError(
      "engine capabilities containment requirements are outside the contract",
    );
  }
  return requirements as unknown as ProcessContainmentRequirements;
}

function validateProject(
  value: unknown,
): EngineCapabilitiesProjectObservation {
  const project = dataObject(
    value,
    ["status", "requestedPath"],
    [
      "canonicalPath",
      "rootIdentityDigest",
      "inspectionDigest",
      "identitySource",
      "projectId",
      "projectIdentityDigest",
      "observedVersion",
    ],
    "engine capabilities project is outside the contract",
  );
  const status = ownValue(project, "status");
  if (
    typeof status !== "string" ||
    !projectStates.includes(status as EngineStatusProjectState) ||
    !validText(ownValue(project, "requestedPath"), 32_767)
  ) {
    throw new TypeError("engine capabilities project is outside the contract");
  }
  const canonicalPath = ownValue(project, "canonicalPath");
  const rootIdentityDigest = ownValue(project, "rootIdentityDigest");
  const inspectionDigest = ownValue(project, "inspectionDigest");
  const baseParts = [canonicalPath, rootIdentityDigest, inspectionDigest];
  const hasBase = baseParts.every((part) => part !== undefined);
  if (
    baseParts.some((part) => part !== undefined) !== hasBase ||
    (canonicalPath !== undefined && !validText(canonicalPath, 32_767)) ||
    (rootIdentityDigest !== undefined &&
      !isSha256Digest(rootIdentityDigest)) ||
    (inspectionDigest !== undefined && !isSha256Digest(inspectionDigest)) ||
    (status === "not-inspected" && hasBase)
  ) {
    throw new TypeError(
      "engine capabilities project identity is incomplete or contradictory",
    );
  }

  const identitySource = ownValue(project, "identitySource");
  const projectId = ownValue(project, "projectId");
  const projectIdentityDigest = ownValue(project, "projectIdentityDigest");
  const observedVersion = ownValue(project, "observedVersion");
  const derivedParts = [
    identitySource,
    projectId,
    projectIdentityDigest,
    observedVersion,
  ];
  const hasDerived = derivedParts.every((part) => part !== undefined);
  if (
    derivedParts.some((part) => part !== undefined) !== hasDerived ||
    (hasDerived &&
      (status !== "detected" ||
        !hasBase ||
        identitySource !== "derived-static" ||
        !isStableId(projectId) ||
        !isSha256Digest(projectIdentityDigest) ||
        !semanticVersion(observedVersion)))
  ) {
    throw new TypeError(
      "engine capabilities derived project identity is outside the contract",
    );
  }
  if (hasDerived) {
    const boundRootIdentityDigest = rootIdentityDigest as Sha256Digest;
    const boundProjectId = projectId as StableId;
    const boundProjectIdentityDigest = projectIdentityDigest as Sha256Digest;
    const boundObservedVersion = observedVersion as SemanticVersion;
    if (
      boundProjectId !==
      computeStaticEngineCapabilitiesProjectId(boundRootIdentityDigest)
    ) {
      throw new TypeError(
        "engine capabilities derived project identity does not match its root",
      );
    }
    if (
      boundProjectIdentityDigest !==
      computeGameProjectIdentityDigest({
        projectId: boundProjectId,
        engine: { id: "godot", version: boundObservedVersion },
      })
    ) {
      throw new TypeError(
        "engine capabilities project identity digest is invalid",
      );
    }
  }
  return project as unknown as EngineCapabilitiesProjectObservation;
}

function validateContainment(
  value: unknown,
): EngineCapabilitiesContainmentSummary {
  const containment = dataObject(
    value,
    [
      "registration",
      "dynamicRegistration",
      "providerCount",
      "catalogDigest",
      "status",
      "selfTestPerformed",
      "launchAvailable",
      "decision",
      "requirements",
      "reason",
    ],
    [],
    "engine capabilities containment is outside the contract",
  );
  if (
    ownValue(containment, "registration") !== "compiled" ||
    ownValue(containment, "dynamicRegistration") !== false ||
    ownValue(containment, "providerCount") !== 0 ||
    !isSha256Digest(ownValue(containment, "catalogDigest")) ||
    ownValue(containment, "status") !== "unavailable" ||
    ownValue(containment, "selfTestPerformed") !== false ||
    ownValue(containment, "launchAvailable") !== false ||
    ownValue(containment, "decision") !== "block" ||
    !validText(ownValue(containment, "reason"), 500)
  ) {
    throw new TypeError(
      "engine capabilities containment is outside the contract",
    );
  }
  validateRequirements(ownValue(containment, "requirements"));
  return containment as unknown as EngineCapabilitiesContainmentSummary;
}

function validateIssues(value: unknown): readonly EngineCapabilitiesIssue[] {
  const issues = dataArray(
    value,
    1,
    ENGINE_CAPABILITIES_MAX_ISSUES,
    "engine capabilities issues are outside the contract",
  );
  const keys: string[] = [];
  for (const issueValue of issues) {
    const issue = dataObject(
      issueValue,
      ["severity", "code", "message", "nextAction"],
      ["path"],
      "engine capabilities issue is outside the contract",
    );
    const severity = ownValue(issue, "severity");
    const code = ownValue(issue, "code");
    const path = ownValue(issue, "path");
    if (
      (severity !== "attention" && severity !== "blocked") ||
      !isStableId(code) ||
      !validText(ownValue(issue, "message"), 500) ||
      !validText(ownValue(issue, "nextAction"), 500) ||
      (path !== undefined && !validText(path, 32_767))
    ) {
      throw new TypeError("engine capabilities issue is outside the contract");
    }
    keys.push(`${code}/${path ?? ""}`);
  }
  if (
    new Set(keys).size !== keys.length ||
    keys.some(
      (key, index) =>
        index > 0 && compareCanonicalText(keys[index - 1] as string, key) > 0,
    )
  ) {
    throw new TypeError(
      "engine capabilities issues must be unique and canonically ordered",
    );
  }
  return issues as readonly EngineCapabilitiesIssue[];
}

function validateCapability(
  value: unknown,
  operation: EngineOperationKind,
  generatedAt: string,
): EngineCapability {
  const capability = dataObject(
    value,
    [
      "id",
      "operation",
      "operationVersion",
      "support",
      "execution",
      "requiredComponents",
      "limitations",
      "degradeReason",
      "permissions",
      "requiredEvidence",
      "evidenceGrade",
      "checkedAt",
    ],
    ["budgetStatus"],
    "engine capability support inventory is outside the planned contract",
  );
  const expectedId = `godot.${operation}`;
  const execution = ownValue(capability, "execution");
  const budgetStatus = ownValue(capability, "budgetStatus");
  if (
    ownValue(capability, "id") !== expectedId ||
    ownValue(capability, "operation") !== operation ||
    ownValue(capability, "operationVersion") !== "1.0.0" ||
    ownValue(capability, "support") !== "planned" ||
    ![
      "static",
      "headless",
      "editor-preview",
      "runtime",
      "packaged",
    ].includes(execution as string) ||
    !validText(ownValue(capability, "degradeReason"), 500) ||
    ownValue(capability, "evidenceGrade") !== "documented" ||
    ownValue(capability, "checkedAt") !== generatedAt ||
    (budgetStatus !== undefined &&
      !["declared", "missing", "exceeded"].includes(budgetStatus as string))
  ) {
    throw new TypeError(
      "engine capability support inventory is outside the planned contract",
    );
  }
  stableIdArray(
    ownValue(capability, "requiredComponents"),
    1,
    64,
    "engine capability required components are outside the contract",
  );
  uniqueTextArray(
    ownValue(capability, "limitations"),
    1,
    64,
    500,
    "engine capability limitations are outside the contract",
  );
  permissionArray(
    ownValue(capability, "permissions"),
    "engine capability permissions are outside the contract",
  );
  stableIdArray(
    ownValue(capability, "requiredEvidence"),
    1,
    64,
    "engine capability evidence is outside the contract",
  );
  return capability as unknown as EngineCapability;
}

function validateCapabilityReport(
  value: unknown,
  project: EngineCapabilitiesProjectObservation,
  input: Pick<
    EngineCapabilitiesDigestInput,
    "registryDigest" | "engineStatusDigest" | "containment"
  >,
): EngineCapabilityReport {
  const report = dataObject(
    value,
    [
      "schemaVersion",
      "reportId",
      "projectId",
      "generatedAt",
      "engineIdentity",
      "environmentDigest",
      "capabilities",
    ],
    [],
    "engine capability report is outside the command contract",
  );
  const generatedAt = ownValue(report, "generatedAt");
  const reportId = ownValue(report, "reportId");
  const projectId = ownValue(report, "projectId");
  const environmentDigest = ownValue(report, "environmentDigest");
  if (
    ownValue(report, "schemaVersion") !== "1.0.0" ||
    !isStableId(reportId) ||
    !isStableId(projectId) ||
    !canonicalTimestamp(generatedAt) ||
    !isSha256Digest(environmentDigest)
  ) {
    throw new TypeError(
      "engine capability report is outside the command contract",
    );
  }
  const engineIdentity = dataObject(
    ownValue(report, "engineIdentity"),
    ["engine", "version", "projectIdentityDigest"],
    [],
    "engine capability identity is outside the command contract",
  );
  if (
    ownValue(engineIdentity, "engine") !== "godot" ||
    !semanticVersion(ownValue(engineIdentity, "version")) ||
    !isSha256Digest(ownValue(engineIdentity, "projectIdentityDigest"))
  ) {
    throw new TypeError(
      "engine capability identity is outside the command contract",
    );
  }
  const capabilities = dataArray(
    ownValue(report, "capabilities"),
    ENGINE_OPERATION_KINDS.length,
    ENGINE_OPERATION_KINDS.length,
    "engine capability inventory must contain every common operation",
  );
  capabilities.forEach((capability, index) =>
    validateCapability(
      capability,
      ENGINE_OPERATION_KINDS[index] as EngineOperationKind,
      generatedAt,
    ),
  );

  if (
    project.identitySource !== "derived-static" ||
    project.rootIdentityDigest === undefined ||
    project.projectId !== projectId ||
    project.projectIdentityDigest !==
      ownValue(engineIdentity, "projectIdentityDigest") ||
    project.observedVersion !== ownValue(engineIdentity, "version")
  ) {
    throw new TypeError(
      "engine capability report does not match the derived project identity",
    );
  }
  const expectedEnvironment = computeEngineCapabilitiesEnvironmentDigest({
    registryDigest: input.registryDigest,
    engine: "godot",
    engineStatusDigest: input.engineStatusDigest,
    projectRootIdentityDigest: project.rootIdentityDigest,
    providerCatalogDigest: input.containment.catalogDigest,
    supportGradeCeiling: "planned",
  });
  if (
    environmentDigest !== expectedEnvironment ||
    reportId !==
      computeEngineCapabilitiesReportId({
        environmentDigest,
        generatedAt,
      })
  ) {
    throw new TypeError(
      "engine capability report environment or report identity digest is invalid",
    );
  }
  const semanticIssues = checkEngineCapabilityReportSemantics(
    report as unknown as EngineCapabilityReport,
  );
  if (semanticIssues.length !== 0) {
    throw new TypeError(
      "engine capability report violates core support semantics",
    );
  }
  return report as unknown as EngineCapabilityReport;
}

export function assertEngineCapabilitiesRequestSemantics(
  value: EngineCapabilitiesRequest,
): void {
  const request = dataObject(
    value,
    ["schemaVersion", "projectRoot", "engine"],
    [],
    "engine capabilities request is outside the contract",
  );
  if (
    ownValue(request, "schemaVersion") !== "1.0.0" ||
    !validText(ownValue(request, "projectRoot"), 32_767) ||
    ownValue(request, "engine") !== "godot"
  ) {
    throw new TypeError("engine capabilities request is outside the contract");
  }
}

export function computeStaticEngineCapabilitiesProjectId(
  rootIdentityDigest: Sha256Digest,
): StableId {
  if (!isSha256Digest(rootIdentityDigest)) {
    throw new TypeError(
      "engine capabilities project ID requires a root identity digest",
    );
  }
  return parseStableId(`project.${rootIdentityDigest.slice(7, 47)}`);
}

export function computeEngineCapabilitiesEnvironmentDigest(
  input: EngineCapabilitiesEnvironmentDigestInput,
): Sha256Digest {
  const value = dataObject(
    input,
    [
      "registryDigest",
      "engine",
      "engineStatusDigest",
      "projectRootIdentityDigest",
      "providerCatalogDigest",
      "supportGradeCeiling",
    ],
    [],
    "engine capabilities environment digest input is outside the contract",
  );
  if (
    !isSha256Digest(ownValue(value, "registryDigest")) ||
    ownValue(value, "engine") !== "godot" ||
    !isSha256Digest(ownValue(value, "engineStatusDigest")) ||
    !isSha256Digest(ownValue(value, "projectRootIdentityDigest")) ||
    !isSha256Digest(ownValue(value, "providerCatalogDigest")) ||
    ownValue(value, "supportGradeCeiling") !== "planned"
  ) {
    throw new TypeError(
      "engine capabilities environment digest input is outside the contract",
    );
  }
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-capabilities-environment",
    version: "1.0.0",
    ...input,
  });
}

export function computeEngineCapabilitiesReportId(
  input: EngineCapabilitiesReportIdInput,
): StableId {
  const value = dataObject(
    input,
    ["environmentDigest", "generatedAt"],
    [],
    "engine capabilities report ID input is outside the contract",
  );
  if (
    !isSha256Digest(ownValue(value, "environmentDigest")) ||
    !canonicalTimestamp(ownValue(value, "generatedAt"))
  ) {
    throw new TypeError(
      "engine capabilities report ID input is outside the contract",
    );
  }
  const digest = digestCanonicalJson({
    domain: "ai-game-playbook/engine-capabilities-report-id",
    version: "1.0.0",
    ...input,
  });
  return parseStableId(`engine-capabilities.${digest.slice(7, 47)}`);
}

export function computeEngineCapabilitiesStatus(
  issues: readonly EngineCapabilitiesIssue[],
): EngineCapabilitiesStatus {
  const validated = validateIssues(issues);
  return validated.some(({ severity }) => severity === "blocked")
    ? "blocked"
    : "attention";
}

function validateDigestInput(input: EngineCapabilitiesDigestInput): void {
  const value = dataObject(
    input,
    [
      "controlPlaneVersion",
      "registryDigest",
      "engine",
      "engineStatusDigest",
      "project",
      "containment",
      "supportGradeCeiling",
      "issues",
      "mutationPerformed",
      "externalProcessStarted",
      "networkAccessPerformed",
      "editorControlPerformed",
      "selfTestPerformed",
    ],
    ["capabilityReport"],
    "engine capabilities digest input is outside the contract",
  );
  if (
    !semanticVersion(ownValue(value, "controlPlaneVersion")) ||
    !isSha256Digest(ownValue(value, "registryDigest")) ||
    ownValue(value, "engine") !== "godot" ||
    !isSha256Digest(ownValue(value, "engineStatusDigest")) ||
    ownValue(value, "supportGradeCeiling") !== "planned" ||
    ownValue(value, "mutationPerformed") !== false ||
    ownValue(value, "externalProcessStarted") !== false ||
    ownValue(value, "networkAccessPerformed") !== false ||
    ownValue(value, "editorControlPerformed") !== false ||
    ownValue(value, "selfTestPerformed") !== false
  ) {
    throw new TypeError(
      "engine capabilities digest input claims unavailable authority or effects",
    );
  }
  const project = validateProject(ownValue(value, "project"));
  const containment = validateContainment(ownValue(value, "containment"));
  validateIssues(ownValue(value, "issues"));
  const capabilityReport = ownValue(value, "capabilityReport");
  const hasDerivedIdentity = project.identitySource === "derived-static";
  if ((capabilityReport !== undefined) !== hasDerivedIdentity) {
    throw new TypeError(
      "engine capabilities report availability contradicts project identity",
    );
  }
  if (capabilityReport !== undefined) {
    validateCapabilityReport(capabilityReport, project, {
      registryDigest: ownValue(value, "registryDigest") as Sha256Digest,
      engineStatusDigest: ownValue(value, "engineStatusDigest") as Sha256Digest,
      containment,
    });
  }
}

export function computeEngineCapabilitiesReportDigest(
  input: EngineCapabilitiesDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-capabilities-report",
    version: "1.0.0",
    ...input,
  });
}

export function assertEngineCapabilitiesReportSemantics(
  report: EngineCapabilitiesReport,
): void {
  const value = dataObject(
    report,
    [
      "schemaVersion",
      "commandId",
      "status",
      "controlPlaneVersion",
      "registryDigest",
      "engine",
      "engineStatusDigest",
      "project",
      "containment",
      "supportGradeCeiling",
      "issues",
      "mutationPerformed",
      "externalProcessStarted",
      "networkAccessPerformed",
      "editorControlPerformed",
      "selfTestPerformed",
      "reportDigest",
    ],
    ["capabilityReport"],
    "engine capabilities report is outside the contract",
  );
  const status = ownValue(value, "status");
  const reportDigest = ownValue(value, "reportDigest");
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    ownValue(value, "commandId") !== "engine.capabilities" ||
    (status !== "attention" && status !== "blocked") ||
    !isSha256Digest(reportDigest)
  ) {
    throw new TypeError("engine capabilities report is outside the contract");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    status: _status,
    reportDigest: _reportDigest,
    ...input
  } = value;
  validateDigestInput(input as unknown as EngineCapabilitiesDigestInput);
  const issues = ownValue(value, "issues") as readonly EngineCapabilitiesIssue[];
  if (status !== computeEngineCapabilitiesStatus(issues)) {
    throw new TypeError("engine capabilities status contradicts its issues");
  }
  if (
    reportDigest !==
    computeEngineCapabilitiesReportDigest(
      input as unknown as EngineCapabilitiesDigestInput,
    )
  ) {
    throw new TypeError("engine capabilities report digest is invalid");
  }
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32_767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

export const engineCapabilitiesRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-capabilities-request",
    version: "1.0.0",
    title: "Engine Capabilities Request",
    description:
      "Selects one Godot project for static capability reporting without host execution authority.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        projectRoot: localPath,
        engine: { const: "godot" },
      },
      ["schemaVersion", "projectRoot", "engine"],
    ),
  });

const requirementsSchema = closedObject(
  {
    filesystem: { const: "deny-project-writes" },
    network: { const: "deny" },
    childProcesses: { const: "deny" },
  },
  ["filesystem", "network", "childProcesses"],
);

const projectSchema = closedObject(
  {
    status: enumSchema(projectStates),
    requestedPath: localPath,
    canonicalPath: localPath,
    rootIdentityDigest: reference("sha256Digest"),
    inspectionDigest: reference("sha256Digest"),
    identitySource: { const: "derived-static" },
    projectId: reference("stableId"),
    projectIdentityDigest: reference("sha256Digest"),
    observedVersion: reference("semanticVersion"),
  },
  ["status", "requestedPath"],
);

const containmentSchema = closedObject(
  {
    registration: { const: "compiled" },
    dynamicRegistration: { const: false },
    providerCount: { const: 0 },
    catalogDigest: reference("sha256Digest"),
    status: { const: "unavailable" },
    selfTestPerformed: { const: false },
    launchAvailable: { const: false },
    decision: { const: "block" },
    requirements: requirementsSchema,
    reason: textSchema(500),
  },
  [
    "registration",
    "dynamicRegistration",
    "providerCount",
    "catalogDigest",
    "status",
    "selfTestPerformed",
    "launchAvailable",
    "decision",
    "requirements",
    "reason",
  ],
);

const issueSchema = closedObject(
  {
    severity: enumSchema(["attention", "blocked"]),
    code: reference("stableId"),
    message: textSchema(500),
    nextAction: textSchema(500),
    path: localPath,
  },
  ["severity", "code", "message", "nextAction"],
);

const embeddedEngineCapabilityReport = Object.fromEntries(
  Object.entries(engineCapabilityReportSchema.schema).filter(
    ([key]) => !["$schema", "$id", "title", "description"].includes(key),
  ),
) as JsonSchemaObject;

const plannedCapabilityConstraints = {
  type: "object",
  properties: {
    engineIdentity: {
      type: "object",
      properties: {
        engine: { const: "godot" },
        executableDigest: false,
      },
    },
    sessionIdentity: false,
    capabilities: {
      type: "array",
      minItems: ENGINE_OPERATION_KINDS.length,
      maxItems: ENGINE_OPERATION_KINDS.length,
      prefixItems: ENGINE_OPERATION_KINDS.map((operation) => ({
        type: "object",
        properties: {
          id: { const: `godot.${operation}` },
          operation: { const: operation },
          operationVersion: { const: "1.0.0" },
          support: { const: "planned" },
          evidenceGrade: { const: "documented" },
          latestReceiptDigest: false,
        },
      })),
      items: false,
    },
  },
} as const;

const commandCapabilityReport = {
  allOf: [embeddedEngineCapabilityReport, plannedCapabilityConstraints],
} as const;

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: "engine.capabilities" },
  status: enumSchema(["attention", "blocked"]),
  controlPlaneVersion: reference("semanticVersion"),
  registryDigest: reference("sha256Digest"),
  engine: { const: "godot" },
  engineStatusDigest: reference("sha256Digest"),
  project: projectSchema,
  containment: containmentSchema,
  capabilityReport: commandCapabilityReport,
  supportGradeCeiling: { const: "planned" },
  issues: boundedArray(issueSchema, {
    minimum: 1,
    maximum: ENGINE_CAPABILITIES_MAX_ISSUES,
  }),
  mutationPerformed: { const: false },
  externalProcessStarted: { const: false },
  networkAccessPerformed: { const: false },
  editorControlPerformed: { const: false },
  selfTestPerformed: { const: false },
  reportDigest: reference("sha256Digest"),
} as const;

const engineCapabilitiesReportRoot = contractRoot(
  reportProperties,
  [
    "schemaVersion",
    "commandId",
    "status",
    "controlPlaneVersion",
    "registryDigest",
    "engine",
    "engineStatusDigest",
    "project",
    "containment",
    "supportGradeCeiling",
    "issues",
    "mutationPerformed",
    "externalProcessStarted",
    "networkAccessPerformed",
    "editorControlPerformed",
    "selfTestPerformed",
    "reportDigest",
  ],
);

export const engineCapabilitiesReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-capabilities-report",
    version: "1.0.0",
    title: "Engine Capabilities Report",
    description:
      "Reports identity-bound planned Godot operations and the current unavailable containment boundary without executing the engine.",
    schema: {
      ...engineCapabilitiesReportRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: { capabilityReport: {} },
            required: ["capabilityReport"],
          },
          then: {
            properties: {
              project: {
                type: "object",
                properties: {
                  status: { const: "detected" },
                  canonicalPath: {},
                  rootIdentityDigest: {},
                  inspectionDigest: {},
                  identitySource: {},
                  projectId: {},
                  projectIdentityDigest: {},
                  observedVersion: {},
                },
                required: [
                  "canonicalPath",
                  "rootIdentityDigest",
                  "inspectionDigest",
                  "identitySource",
                  "projectId",
                  "projectIdentityDigest",
                  "observedVersion",
                ],
              },
            },
          },
        },
      ],
    },
  });
