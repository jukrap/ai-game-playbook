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
  closedObject,
  contractRoot,
  reference,
} from "./schema-fragments.js";

export interface ProcessContainmentRequirements {
  readonly filesystem: "deny-project-writes";
  readonly network: "deny";
  readonly childProcesses: "deny";
}

export const PROCESS_CONTAINMENT_REQUIREMENTS: ProcessContainmentRequirements =
  Object.freeze({
    filesystem: "deny-project-writes",
    network: "deny",
    childProcesses: "deny",
  });

export const PROCESS_CONTAINMENT_POLICY_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-policy",
    version: "1.0.0",
    workload: "engine-project-process",
    requirements: PROCESS_CONTAINMENT_REQUIREMENTS,
  });

export interface ProcessContainmentAssessmentRequest {
  readonly schemaVersion: "1.0.0";
  readonly workload: "engine-project-process";
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly requirements: ProcessContainmentRequirements;
}

export interface ProcessContainmentProviderUnavailable {
  readonly catalogDigest: Sha256Digest;
  readonly status: "unavailable";
  readonly code: "process-containment-provider-unavailable";
}

export interface ProcessContainmentUnavailableControl<
  TRequirement extends string,
> {
  readonly requirement: TRequirement;
  readonly status: "unavailable";
}

export interface ProcessContainmentUnavailableControls {
  readonly filesystem: ProcessContainmentUnavailableControl<"deny-project-writes">;
  readonly network: ProcessContainmentUnavailableControl<"deny">;
  readonly childProcesses: ProcessContainmentUnavailableControl<"deny">;
}

export interface ProcessContainmentAssessmentProbe {
  readonly status: "not-run";
  readonly externalProcessStarted: false;
  readonly mutationPerformed: false;
  readonly networkAccessPerformed: false;
}

export interface ProcessContainmentAssessmentDigestInput {
  readonly assessmentId: string;
  readonly requestDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly requirements: ProcessContainmentRequirements;
  readonly platform: "windows" | "linux" | "macos";
  readonly architecture: "x64" | "arm64";
  readonly provider: ProcessContainmentProviderUnavailable;
  readonly controls: ProcessContainmentUnavailableControls;
  readonly probe: ProcessContainmentAssessmentProbe;
  readonly decision: "block";
  readonly checkedAt: string;
  readonly evidenceGrade: "implemented";
}

export interface ProcessContainmentAssessmentReport
  extends ProcessContainmentAssessmentDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly assessmentDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function dataObject(
  value: unknown,
  required: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(message);
  }

  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== required.length ||
    !required.every((key) => names.includes(key))
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

function ownValue(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function validateRequirements(value: unknown): ProcessContainmentRequirements {
  const requirements = dataObject(
    value,
    ["filesystem", "network", "childProcesses"],
    "process containment requirements are outside the contract",
  );
  if (
    ownValue(requirements, "filesystem") !== "deny-project-writes" ||
    ownValue(requirements, "network") !== "deny" ||
    ownValue(requirements, "childProcesses") !== "deny"
  ) {
    throw new TypeError(
      "process containment requirements are outside the contract",
    );
  }
  return requirements as unknown as ProcessContainmentRequirements;
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

export function assertProcessContainmentAssessmentRequestSemantics(
  value: ProcessContainmentAssessmentRequest,
): void {
  const request = dataObject(
    value,
    [
      "schemaVersion",
      "workload",
      "projectRootIdentityDigest",
      "policyDigest",
      "requirements",
    ],
    "process containment assessment request is outside the contract",
  );
  if (
    ownValue(request, "schemaVersion") !== "1.0.0" ||
    ownValue(request, "workload") !== "engine-project-process" ||
    !isSha256Digest(ownValue(request, "projectRootIdentityDigest")) ||
    ownValue(request, "policyDigest") !==
      PROCESS_CONTAINMENT_POLICY_DIGEST
  ) {
    throw new TypeError(
      "process containment assessment request is outside the contract",
    );
  }
  validateRequirements(ownValue(request, "requirements"));
}

export function computeProcessContainmentRequestDigest(
  request: ProcessContainmentAssessmentRequest,
): Sha256Digest {
  assertProcessContainmentAssessmentRequestSemantics(request);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-assessment-request",
    version: "1.0.0",
    request,
  });
}

function validateProvider(value: unknown): ProcessContainmentProviderUnavailable {
  const provider = dataObject(
    value,
    ["catalogDigest", "status", "code"],
    "process containment provider is outside the contract",
  );
  if (
    !isSha256Digest(ownValue(provider, "catalogDigest")) ||
    ownValue(provider, "status") !== "unavailable" ||
    ownValue(provider, "code") !==
      "process-containment-provider-unavailable"
  ) {
    throw new TypeError("process containment provider is outside the contract");
  }
  return provider as unknown as ProcessContainmentProviderUnavailable;
}

function validateUnavailableControl<TRequirement extends string>(
  value: unknown,
  requirement: TRequirement,
): ProcessContainmentUnavailableControl<TRequirement> {
  const control = dataObject(
    value,
    ["requirement", "status"],
    "process containment controls are outside the contract",
  );
  if (
    ownValue(control, "requirement") !== requirement ||
    ownValue(control, "status") !== "unavailable"
  ) {
    throw new TypeError("process containment controls are outside the contract");
  }
  return control as unknown as ProcessContainmentUnavailableControl<TRequirement>;
}

function validateControls(value: unknown): ProcessContainmentUnavailableControls {
  const controls = dataObject(
    value,
    ["filesystem", "network", "childProcesses"],
    "process containment controls are outside the contract",
  );
  validateUnavailableControl(
    ownValue(controls, "filesystem"),
    "deny-project-writes",
  );
  validateUnavailableControl(ownValue(controls, "network"), "deny");
  validateUnavailableControl(ownValue(controls, "childProcesses"), "deny");
  return controls as unknown as ProcessContainmentUnavailableControls;
}

function validateProbe(value: unknown): ProcessContainmentAssessmentProbe {
  const probe = dataObject(
    value,
    [
      "status",
      "externalProcessStarted",
      "mutationPerformed",
      "networkAccessPerformed",
    ],
    "process containment probe is outside the contract",
  );
  if (
    ownValue(probe, "status") !== "not-run" ||
    ownValue(probe, "externalProcessStarted") !== false ||
    ownValue(probe, "mutationPerformed") !== false ||
    ownValue(probe, "networkAccessPerformed") !== false
  ) {
    throw new TypeError("process containment probe is outside the contract");
  }
  return probe as unknown as ProcessContainmentAssessmentProbe;
}

function validateDigestInput(
  input: ProcessContainmentAssessmentDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "assessmentId",
      "requestDigest",
      "projectRootIdentityDigest",
      "workload",
      "policyDigest",
      "requirements",
      "platform",
      "architecture",
      "provider",
      "controls",
      "probe",
      "decision",
      "checkedAt",
      "evidenceGrade",
    ],
    "process containment assessment is outside the contract",
  );

  const assessmentId = ownValue(value, "assessmentId");
  const requestDigest = ownValue(value, "requestDigest");
  const projectRootIdentityDigest = ownValue(
    value,
    "projectRootIdentityDigest",
  );
  const workload = ownValue(value, "workload");
  const policyDigest = ownValue(value, "policyDigest");
  const platform = ownValue(value, "platform");
  const architecture = ownValue(value, "architecture");
  const checkedAt = ownValue(value, "checkedAt");

  if (
    typeof assessmentId !== "string" ||
    !uuidPattern.test(assessmentId) ||
    !isSha256Digest(requestDigest) ||
    !isSha256Digest(projectRootIdentityDigest) ||
    workload !== "engine-project-process" ||
    policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    (platform !== "windows" &&
      platform !== "linux" &&
      platform !== "macos") ||
    (architecture !== "x64" && architecture !== "arm64") ||
    ownValue(value, "decision") !== "block" ||
    !canonicalTimestamp(checkedAt) ||
    ownValue(value, "evidenceGrade") !== "implemented"
  ) {
    throw new TypeError("process containment assessment is outside the contract");
  }

  const requirements = validateRequirements(ownValue(value, "requirements"));
  validateProvider(ownValue(value, "provider"));
  validateControls(ownValue(value, "controls"));
  validateProbe(ownValue(value, "probe"));

  const reboundRequest: ProcessContainmentAssessmentRequest = {
    schemaVersion: "1.0.0",
    workload,
    projectRootIdentityDigest,
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    requirements,
  };
  if (
    requestDigest !== computeProcessContainmentRequestDigest(reboundRequest)
  ) {
    throw new TypeError(
      "process containment request digest does not attest the assessment",
    );
  }
}

export function computeProcessContainmentAssessmentDigest(
  input: ProcessContainmentAssessmentDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-assessment",
    version: "1.0.0",
    ...input,
  });
}

export function assertProcessContainmentAssessmentReportSemantics(
  report: ProcessContainmentAssessmentReport,
): void {
  const value = dataObject(
    report,
    [
      "schemaVersion",
      "assessmentId",
      "requestDigest",
      "projectRootIdentityDigest",
      "workload",
      "policyDigest",
      "requirements",
      "platform",
      "architecture",
      "provider",
      "controls",
      "probe",
      "decision",
      "checkedAt",
      "evidenceGrade",
      "assessmentDigest",
    ],
    "process containment assessment report is outside the contract",
  );
  const assessmentDigest = ownValue(value, "assessmentDigest");
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(assessmentDigest)
  ) {
    throw new TypeError(
      "process containment assessment report is outside the contract",
    );
  }

  const {
    schemaVersion: _schemaVersion,
    assessmentDigest: _assessmentDigest,
    ...input
  } = value;
  if (
    assessmentDigest !==
    computeProcessContainmentAssessmentDigest(
      input as unknown as ProcessContainmentAssessmentDigestInput,
    )
  ) {
    throw new TypeError(
      "process containment assessment digest does not attest its report",
    );
  }
}

const requirementsSchema = closedObject(
  {
    filesystem: { const: "deny-project-writes" },
    network: { const: "deny" },
    childProcesses: { const: "deny" },
  },
  ["filesystem", "network", "childProcesses"],
);

const requestProperties = {
  schemaVersion: { const: "1.0.0" },
  workload: { const: "engine-project-process" },
  projectRootIdentityDigest: reference("sha256Digest"),
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  requirements: requirementsSchema,
} as const;

export const processContainmentAssessmentRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-assessment-request",
    version: "1.0.0",
    title: "Process Containment Assessment Request",
    description:
      "Binds one engine-project process workload to an exact project identity and deny-by-default containment policy.",
    schema: contractRoot(
      requestProperties,
      Object.freeze(Object.keys(requestProperties)),
    ),
  });

const providerSchema = closedObject(
  {
    catalogDigest: reference("sha256Digest"),
    status: { const: "unavailable" },
    code: { const: "process-containment-provider-unavailable" },
  },
  ["catalogDigest", "status", "code"],
);

function unavailableControlSchema(requirement: string): ReturnType<typeof closedObject> {
  return closedObject(
    {
      requirement: { const: requirement },
      status: { const: "unavailable" },
    },
    ["requirement", "status"],
  );
}

const controlsSchema = closedObject(
  {
    filesystem: unavailableControlSchema("deny-project-writes"),
    network: unavailableControlSchema("deny"),
    childProcesses: unavailableControlSchema("deny"),
  },
  ["filesystem", "network", "childProcesses"],
);

const probeSchema = closedObject(
  {
    status: { const: "not-run" },
    externalProcessStarted: { const: false },
    mutationPerformed: { const: false },
    networkAccessPerformed: { const: false },
  },
  [
    "status",
    "externalProcessStarted",
    "mutationPerformed",
    "networkAccessPerformed",
  ],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  assessmentId: reference("uuid"),
  requestDigest: reference("sha256Digest"),
  projectRootIdentityDigest: reference("sha256Digest"),
  workload: { const: "engine-project-process" },
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  requirements: requirementsSchema,
  platform: reference("operatingSystem"),
  architecture: reference("architecture"),
  provider: providerSchema,
  controls: controlsSchema,
  probe: probeSchema,
  decision: { const: "block" },
  checkedAt: reference("timestamp"),
  evidenceGrade: { const: "implemented" },
  assessmentDigest: reference("sha256Digest"),
} as const;

export const processContainmentAssessmentReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-assessment-report",
    version: "1.0.0",
    title: "Process Containment Assessment Report",
    description:
      "Records a path-free, no-probe, fail-closed result when no validated process-containment provider is available.",
    schema: contractRoot(
      reportProperties,
      Object.freeze(Object.keys(reportProperties)),
    ),
  });
