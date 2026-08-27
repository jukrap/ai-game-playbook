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
import { isStableId } from "./stable-id.js";
import { parseSemanticVersion } from "./semantic-version.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";

export const PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS = 30_000;
export const PROCESS_CONTAINMENT_SELF_TEST_MAX_VALIDITY_MS = 60_000;

export type ProcessContainmentSelfTestProbeId =
  | "workload-start"
  | "project-create"
  | "project-replace"
  | "project-remove"
  | "project-rename"
  | "project-alias-write"
  | "network-ipv4-connect"
  | "network-ipv6-connect"
  | "network-name-resolution"
  | "child-process-spawn"
  | "detached-child-process-spawn"
  | "termination-cleanup";
export type ProcessContainmentSelfTestProbeExpectation =
  | "allowed"
  | "denied"
  | "complete";

export interface ProcessContainmentSelfTestProbeDefinition {
  readonly id: ProcessContainmentSelfTestProbeId;
  readonly expected: ProcessContainmentSelfTestProbeExpectation;
}

export const PROCESS_CONTAINMENT_SELF_TEST_PROBES: readonly ProcessContainmentSelfTestProbeDefinition[] = Object.freeze([
  Object.freeze({ id: "workload-start", expected: "allowed" }),
  Object.freeze({ id: "project-create", expected: "denied" }),
  Object.freeze({ id: "project-replace", expected: "denied" }),
  Object.freeze({ id: "project-remove", expected: "denied" }),
  Object.freeze({ id: "project-rename", expected: "denied" }),
  Object.freeze({ id: "project-alias-write", expected: "denied" }),
  Object.freeze({ id: "network-ipv4-connect", expected: "denied" }),
  Object.freeze({ id: "network-ipv6-connect", expected: "denied" }),
  Object.freeze({ id: "network-name-resolution", expected: "denied" }),
  Object.freeze({ id: "child-process-spawn", expected: "denied" }),
  Object.freeze({
    id: "detached-child-process-spawn",
    expected: "denied",
  }),
  Object.freeze({ id: "termination-cleanup", expected: "complete" }),
]);

export const PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-self-test-suite",
    version: "1.0.0",
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    probes: PROCESS_CONTAINMENT_SELF_TEST_PROBES,
  });

export type ProcessContainmentProviderPlatform = "windows" | "linux";
export type ProcessContainmentProviderArchitecture = "x64" | "arm64";

export interface ProcessContainmentProviderHost {
  readonly platform: ProcessContainmentProviderPlatform;
  readonly architecture: ProcessContainmentProviderArchitecture;
}

export interface ProcessContainmentProviderImplementation {
  readonly entryArtifactDigest: Sha256Digest;
  readonly closureManifestDigest: Sha256Digest;
  readonly selfTestArtifactDigest: Sha256Digest;
}

export interface ProcessContainmentProviderProtocols {
  readonly selfTest: "1.0.0";
  readonly launch: "1.0.0";
}

export interface ProcessContainmentProviderControl<
  TRequirement extends string,
> {
  readonly requirement: TRequirement;
  readonly enforcement: "os-enforced";
  readonly selfTest: "required";
}

export interface ProcessContainmentProviderControls {
  readonly filesystem: ProcessContainmentProviderControl<"deny-project-writes">;
  readonly network: ProcessContainmentProviderControl<"deny">;
  readonly childProcesses: ProcessContainmentProviderControl<"deny">;
}

export interface ProcessContainmentProviderDescriptorDigestInput {
  readonly providerId: string;
  readonly providerVersion: string;
  readonly host: ProcessContainmentProviderHost;
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly implementation: ProcessContainmentProviderImplementation;
  readonly protocols: ProcessContainmentProviderProtocols;
  readonly controls: ProcessContainmentProviderControls;
  readonly selfTestSuiteDigest: typeof PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST;
}

export interface ProcessContainmentProviderDescriptor
  extends ProcessContainmentProviderDescriptorDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly descriptorDigest: Sha256Digest;
}

export type ProcessContainmentSelfTestProbeOutcome =
  | "passed"
  | "failed"
  | "unavailable"
  | "cancelled"
  | "uncertain";

export interface ProcessContainmentSelfTestProbeResult {
  readonly id: ProcessContainmentSelfTestProbeId;
  readonly expected: ProcessContainmentSelfTestProbeExpectation;
  readonly outcome: ProcessContainmentSelfTestProbeOutcome;
  readonly observationDigest: Sha256Digest;
}

export interface ProcessContainmentSelfTestRequest {
  readonly schemaVersion: "1.0.0";
  readonly selfTestId: string;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly host: ProcessContainmentProviderHost;
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly selfTestSuiteDigest: typeof PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST;
  readonly challengeDigest: Sha256Digest;
  readonly fixtureIdentityDigest: Sha256Digest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly maxDurationMs: typeof PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS;
}

export interface ProcessContainmentSelfTestEffects {
  readonly containedProcessStarted: boolean;
  readonly projectMutationPerformed: boolean;
  readonly networkConnectionEstablished: boolean;
  readonly childProcessStarted: boolean;
  readonly cleanup: "complete" | "incomplete" | "uncertain";
}

export interface ProcessContainmentSelfTestReportDigestInput {
  readonly selfTestId: string;
  readonly request: ProcessContainmentSelfTestRequest;
  readonly requestDigest: Sha256Digest;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly host: ProcessContainmentProviderHost;
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly selfTestSuiteDigest: typeof PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly probes: readonly ProcessContainmentSelfTestProbeResult[];
  readonly effects: ProcessContainmentSelfTestEffects;
  readonly outcome: "verified" | "rejected";
}

export interface ProcessContainmentSelfTestReport
  extends ProcessContainmentSelfTestReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly reportDigest: Sha256Digest;
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

function dataArray(
  value: unknown,
  maximum: number,
  message: string,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0 ||
    value.length > maximum
  ) {
    throw new TypeError(message);
  }
  const names = Object.getOwnPropertyNames(value);
  const expectedNames = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ];
  if (
    names.length !== expectedNames.length ||
    !expectedNames.every((name) => names.includes(name))
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

function ownValue(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function validateHost(value: unknown): ProcessContainmentProviderHost {
  const host = dataObject(
    value,
    ["platform", "architecture"],
    "process containment provider host is outside the contract",
  );
  const platform = ownValue(host, "platform");
  const architecture = ownValue(host, "architecture");
  if (
    (platform !== "windows" && platform !== "linux") ||
    (architecture !== "x64" && architecture !== "arm64")
  ) {
    throw new TypeError(
      "process containment provider host is outside the contract",
    );
  }
  return host as unknown as ProcessContainmentProviderHost;
}

function validateImplementation(
  value: unknown,
): ProcessContainmentProviderImplementation {
  const implementation = dataObject(
    value,
    [
      "entryArtifactDigest",
      "closureManifestDigest",
      "selfTestArtifactDigest",
    ],
    "process containment provider implementation is outside the contract",
  );
  if (
    !isSha256Digest(ownValue(implementation, "entryArtifactDigest")) ||
    !isSha256Digest(ownValue(implementation, "closureManifestDigest")) ||
    !isSha256Digest(ownValue(implementation, "selfTestArtifactDigest"))
  ) {
    throw new TypeError(
      "process containment provider implementation is outside the contract",
    );
  }
  return implementation as unknown as ProcessContainmentProviderImplementation;
}

function validateProtocols(
  value: unknown,
): ProcessContainmentProviderProtocols {
  const protocols = dataObject(
    value,
    ["selfTest", "launch"],
    "process containment provider protocols are outside the contract",
  );
  if (
    ownValue(protocols, "selfTest") !== "1.0.0" ||
    ownValue(protocols, "launch") !== "1.0.0"
  ) {
    throw new TypeError(
      "process containment provider protocols are outside the contract",
    );
  }
  return protocols as unknown as ProcessContainmentProviderProtocols;
}

function validateControl<TRequirement extends string>(
  value: unknown,
  requirement: TRequirement,
): ProcessContainmentProviderControl<TRequirement> {
  const control = dataObject(
    value,
    ["requirement", "enforcement", "selfTest"],
    "process containment provider control is outside the contract",
  );
  if (
    ownValue(control, "requirement") !== requirement ||
    ownValue(control, "enforcement") !== "os-enforced" ||
    ownValue(control, "selfTest") !== "required"
  ) {
    throw new TypeError(
      "process containment provider control is outside the contract",
    );
  }
  return control as unknown as ProcessContainmentProviderControl<TRequirement>;
}

function validateControls(
  value: unknown,
): ProcessContainmentProviderControls {
  const controls = dataObject(
    value,
    ["filesystem", "network", "childProcesses"],
    "process containment provider controls are outside the contract",
  );
  validateControl(ownValue(controls, "filesystem"), "deny-project-writes");
  validateControl(ownValue(controls, "network"), "deny");
  validateControl(ownValue(controls, "childProcesses"), "deny");
  return controls as unknown as ProcessContainmentProviderControls;
}

function validateDescriptorDigestInput(
  input: ProcessContainmentProviderDescriptorDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "providerId",
      "providerVersion",
      "host",
      "workload",
      "policyDigest",
      "implementation",
      "protocols",
      "controls",
      "selfTestSuiteDigest",
    ],
    "process containment provider descriptor is outside the contract",
  );
  const providerId = ownValue(value, "providerId");
  const providerVersion = ownValue(value, "providerVersion");
  const host = validateHost(ownValue(value, "host"));
  if (
    !isStableId(providerId) ||
    !providerId.startsWith(`process-containment.${host.platform}.`) ||
    typeof providerVersion !== "string" ||
    ownValue(value, "workload") !== "engine-project-process" ||
    ownValue(value, "policyDigest") !==
      PROCESS_CONTAINMENT_POLICY_DIGEST ||
    ownValue(value, "selfTestSuiteDigest") !==
      PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST
  ) {
    throw new TypeError(
      "process containment provider descriptor is outside the contract",
    );
  }
  parseSemanticVersion(providerVersion, "$provider.providerVersion");
  validateImplementation(ownValue(value, "implementation"));
  validateProtocols(ownValue(value, "protocols"));
  validateControls(ownValue(value, "controls"));
}

export function computeProcessContainmentProviderDescriptorDigest(
  input: ProcessContainmentProviderDescriptorDigestInput,
): Sha256Digest {
  validateDescriptorDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-provider-descriptor",
    version: "1.0.0",
    descriptor: input,
  });
}

export function assertProcessContainmentProviderDescriptorSemantics(
  descriptor: ProcessContainmentProviderDescriptor,
): void {
  const value = dataObject(
    descriptor,
    [
      "schemaVersion",
      "providerId",
      "providerVersion",
      "host",
      "workload",
      "policyDigest",
      "implementation",
      "protocols",
      "controls",
      "selfTestSuiteDigest",
      "descriptorDigest",
    ],
    "process containment provider descriptor is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "descriptorDigest"))
  ) {
    throw new TypeError(
      "process containment provider descriptor is outside the contract",
    );
  }
  const input = {
    providerId: ownValue(value, "providerId"),
    providerVersion: ownValue(value, "providerVersion"),
    host: ownValue(value, "host"),
    workload: ownValue(value, "workload"),
    policyDigest: ownValue(value, "policyDigest"),
    implementation: ownValue(value, "implementation"),
    protocols: ownValue(value, "protocols"),
    controls: ownValue(value, "controls"),
    selfTestSuiteDigest: ownValue(value, "selfTestSuiteDigest"),
  } as ProcessContainmentProviderDescriptorDigestInput;
  if (
    ownValue(value, "descriptorDigest") !==
    computeProcessContainmentProviderDescriptorDigest(input)
  ) {
    throw new TypeError(
      "process containment provider descriptor digest does not attest the descriptor",
    );
  }
}

export function computeProcessContainmentProviderCatalogDigest(
  descriptors: readonly ProcessContainmentProviderDescriptor[],
): Sha256Digest {
  const values = dataArray(
    descriptors,
    32,
    "process containment provider catalog is outside the contract",
  ) as readonly ProcessContainmentProviderDescriptor[];
  const normalized = values.map((descriptor) => {
    assertProcessContainmentProviderDescriptorSemantics(descriptor);
    return {
      providerId: descriptor.providerId,
      descriptorDigest: descriptor.descriptorDigest,
    };
  });
  normalized.sort((left, right) => {
    const leftKey = `${left.providerId}\u0000${left.descriptorDigest}`;
    const rightKey = `${right.providerId}\u0000${right.descriptorDigest}`;
    return leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
  });
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (
      previous === undefined ||
      current === undefined ||
      previous.providerId === current.providerId ||
      previous.descriptorDigest === current.descriptorDigest
    ) {
      throw new TypeError(
        "process containment provider catalog contains duplicate identity",
      );
    }
  }
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-provider-catalog",
    version: "1.0.0",
    providers: normalized,
  });
}

export function assertProcessContainmentSelfTestRequestSemantics(
  request: ProcessContainmentSelfTestRequest,
): void {
  const value = dataObject(
    request,
    [
      "schemaVersion",
      "selfTestId",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "workload",
      "policyDigest",
      "selfTestSuiteDigest",
      "challengeDigest",
      "fixtureIdentityDigest",
      "issuedAt",
      "expiresAt",
      "maxDurationMs",
    ],
    "process containment self-test request is outside the contract",
  );
  const selfTestId = ownValue(value, "selfTestId");
  const issuedAt = ownValue(value, "issuedAt");
  const expiresAt = ownValue(value, "expiresAt");
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    typeof selfTestId !== "string" ||
    !uuidPattern.test(selfTestId) ||
    !isSha256Digest(ownValue(value, "providerDescriptorDigest")) ||
    !isSha256Digest(ownValue(value, "providerCatalogDigest")) ||
    ownValue(value, "workload") !== "engine-project-process" ||
    ownValue(value, "policyDigest") !==
      PROCESS_CONTAINMENT_POLICY_DIGEST ||
    ownValue(value, "selfTestSuiteDigest") !==
      PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST ||
    !isSha256Digest(ownValue(value, "challengeDigest")) ||
    !isSha256Digest(ownValue(value, "fixtureIdentityDigest")) ||
    !canonicalTimestamp(issuedAt) ||
    !canonicalTimestamp(expiresAt) ||
    ownValue(value, "maxDurationMs") !==
      PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS
  ) {
    throw new TypeError(
      "process containment self-test request is outside the contract",
    );
  }
  validateHost(ownValue(value, "host"));
  const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (
    validityMs < PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS ||
    validityMs > PROCESS_CONTAINMENT_SELF_TEST_MAX_VALIDITY_MS
  ) {
    throw new TypeError(
      "process containment self-test request validity is outside the contract",
    );
  }
}

export function computeProcessContainmentSelfTestRequestDigest(
  request: ProcessContainmentSelfTestRequest,
): Sha256Digest {
  assertProcessContainmentSelfTestRequestSemantics(request);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-self-test-request",
    version: "1.0.0",
    request,
  });
}

function validateProbeResults(
  value: unknown,
): readonly ProcessContainmentSelfTestProbeResult[] {
  const probes = dataArray(
    value,
    PROCESS_CONTAINMENT_SELF_TEST_PROBES.length,
    "process containment self-test probes are outside the contract",
  );
  if (probes.length !== PROCESS_CONTAINMENT_SELF_TEST_PROBES.length) {
    throw new TypeError(
      "process containment self-test probes are outside the contract",
    );
  }
  return probes.map((probe, index) => {
    const expectedProbe = PROCESS_CONTAINMENT_SELF_TEST_PROBES[index];
    const result = dataObject(
      probe,
      ["id", "expected", "outcome", "observationDigest"],
      "process containment self-test probe is outside the contract",
    );
    const outcome = ownValue(result, "outcome");
    if (
      expectedProbe === undefined ||
      ownValue(result, "id") !== expectedProbe.id ||
      ownValue(result, "expected") !== expectedProbe.expected ||
      (outcome !== "passed" &&
        outcome !== "failed" &&
        outcome !== "unavailable" &&
        outcome !== "cancelled" &&
        outcome !== "uncertain") ||
      !isSha256Digest(ownValue(result, "observationDigest"))
    ) {
      throw new TypeError(
        "process containment self-test probe is outside the contract",
      );
    }
    return result as unknown as ProcessContainmentSelfTestProbeResult;
  });
}

function validateEffects(
  value: unknown,
): ProcessContainmentSelfTestEffects {
  const effects = dataObject(
    value,
    [
      "containedProcessStarted",
      "projectMutationPerformed",
      "networkConnectionEstablished",
      "childProcessStarted",
      "cleanup",
    ],
    "process containment self-test effects are outside the contract",
  );
  if (
    typeof ownValue(effects, "containedProcessStarted") !== "boolean" ||
    typeof ownValue(effects, "projectMutationPerformed") !== "boolean" ||
    typeof ownValue(effects, "networkConnectionEstablished") !== "boolean" ||
    typeof ownValue(effects, "childProcessStarted") !== "boolean" ||
    (ownValue(effects, "cleanup") !== "complete" &&
      ownValue(effects, "cleanup") !== "incomplete" &&
      ownValue(effects, "cleanup") !== "uncertain")
  ) {
    throw new TypeError(
      "process containment self-test effects are outside the contract",
    );
  }
  return effects as unknown as ProcessContainmentSelfTestEffects;
}

function validateReportDigestInput(
  input: ProcessContainmentSelfTestReportDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "selfTestId",
      "request",
      "requestDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "workload",
      "policyDigest",
      "selfTestSuiteDigest",
      "startedAt",
      "completedAt",
      "durationMs",
      "probes",
      "effects",
      "outcome",
    ],
    "process containment self-test report is outside the contract",
  );
  const request = ownValue(value, "request") as ProcessContainmentSelfTestRequest;
  assertProcessContainmentSelfTestRequestSemantics(request);
  const host = validateHost(ownValue(value, "host"));
  const startedAt = ownValue(value, "startedAt");
  const completedAt = ownValue(value, "completedAt");
  const durationMs = ownValue(value, "durationMs");
  if (
    ownValue(value, "selfTestId") !== request.selfTestId ||
    ownValue(value, "requestDigest") !==
      computeProcessContainmentSelfTestRequestDigest(request) ||
    ownValue(value, "providerDescriptorDigest") !==
      request.providerDescriptorDigest ||
    ownValue(value, "providerCatalogDigest") !==
      request.providerCatalogDigest ||
    host.platform !== request.host.platform ||
    host.architecture !== request.host.architecture ||
    ownValue(value, "workload") !== request.workload ||
    ownValue(value, "policyDigest") !== request.policyDigest ||
    ownValue(value, "selfTestSuiteDigest") !== request.selfTestSuiteDigest ||
    !canonicalTimestamp(startedAt) ||
    !canonicalTimestamp(completedAt) ||
    typeof durationMs !== "number" ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < 1 ||
    durationMs > request.maxDurationMs
  ) {
    throw new TypeError(
      "process containment self-test report is outside the contract",
    );
  }
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (
    startedMs < Date.parse(request.issuedAt) ||
    completedMs > Date.parse(request.expiresAt) ||
    completedMs < startedMs ||
    completedMs - startedMs !== durationMs
  ) {
    throw new TypeError(
      "process containment self-test timing is outside the request window",
    );
  }

  const probes = validateProbeResults(ownValue(value, "probes"));
  const effects = validateEffects(ownValue(value, "effects"));
  const qualifiesAsVerified =
    probes.every((probe) => probe.outcome === "passed") &&
    effects.containedProcessStarted === true &&
    effects.projectMutationPerformed === false &&
    effects.networkConnectionEstablished === false &&
    effects.childProcessStarted === false &&
    effects.cleanup === "complete";
  const expectedOutcome = qualifiesAsVerified ? "verified" : "rejected";
  if (ownValue(value, "outcome") !== expectedOutcome) {
    throw new TypeError(
      "process containment self-test outcome contradicts its probes or effects",
    );
  }
}

export function computeProcessContainmentSelfTestReportDigest(
  input: ProcessContainmentSelfTestReportDigestInput,
): Sha256Digest {
  validateReportDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-self-test-report",
    version: "1.0.0",
    report: input,
  });
}

export function assertProcessContainmentSelfTestReportSemantics(
  report: ProcessContainmentSelfTestReport,
): void {
  const value = dataObject(
    report,
    [
      "schemaVersion",
      "selfTestId",
      "request",
      "requestDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "workload",
      "policyDigest",
      "selfTestSuiteDigest",
      "startedAt",
      "completedAt",
      "durationMs",
      "probes",
      "effects",
      "outcome",
      "reportDigest",
    ],
    "process containment self-test report is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "reportDigest"))
  ) {
    throw new TypeError(
      "process containment self-test report is outside the contract",
    );
  }
  const input = {
    selfTestId: ownValue(value, "selfTestId"),
    request: ownValue(value, "request"),
    requestDigest: ownValue(value, "requestDigest"),
    providerDescriptorDigest: ownValue(value, "providerDescriptorDigest"),
    providerCatalogDigest: ownValue(value, "providerCatalogDigest"),
    host: ownValue(value, "host"),
    workload: ownValue(value, "workload"),
    policyDigest: ownValue(value, "policyDigest"),
    selfTestSuiteDigest: ownValue(value, "selfTestSuiteDigest"),
    startedAt: ownValue(value, "startedAt"),
    completedAt: ownValue(value, "completedAt"),
    durationMs: ownValue(value, "durationMs"),
    probes: ownValue(value, "probes"),
    effects: ownValue(value, "effects"),
    outcome: ownValue(value, "outcome"),
  } as ProcessContainmentSelfTestReportDigestInput;
  if (
    ownValue(value, "reportDigest") !==
    computeProcessContainmentSelfTestReportDigest(input)
  ) {
    throw new TypeError(
      "process containment self-test report digest does not attest the report",
    );
  }
}

const hostSchema = closedObject(
  {
    platform: { enum: ["windows", "linux"] },
    architecture: { enum: ["x64", "arm64"] },
  },
  ["platform", "architecture"],
);

const implementationSchema = closedObject(
  {
    entryArtifactDigest: reference("sha256Digest"),
    closureManifestDigest: reference("sha256Digest"),
    selfTestArtifactDigest: reference("sha256Digest"),
  },
  [
    "entryArtifactDigest",
    "closureManifestDigest",
    "selfTestArtifactDigest",
  ],
);

const protocolsSchema = closedObject(
  {
    selfTest: { const: "1.0.0" },
    launch: { const: "1.0.0" },
  },
  ["selfTest", "launch"],
);

function controlSchema(requirement: string): ReturnType<typeof closedObject> {
  return closedObject(
    {
      requirement: { const: requirement },
      enforcement: { const: "os-enforced" },
      selfTest: { const: "required" },
    },
    ["requirement", "enforcement", "selfTest"],
  );
}

const controlsSchema = closedObject(
  {
    filesystem: controlSchema("deny-project-writes"),
    network: controlSchema("deny"),
    childProcesses: controlSchema("deny"),
  },
  ["filesystem", "network", "childProcesses"],
);

const descriptorProperties = {
  schemaVersion: { const: "1.0.0" },
  providerId: reference("stableId"),
  providerVersion: reference("semanticVersion"),
  host: hostSchema,
  workload: { const: "engine-project-process" },
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  implementation: implementationSchema,
  protocols: protocolsSchema,
  controls: controlsSchema,
  selfTestSuiteDigest: {
    const: PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  },
  descriptorDigest: reference("sha256Digest"),
} as const;

export const processContainmentProviderDescriptorSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-provider-descriptor",
    version: "1.0.0",
    title: "Process Containment Provider Descriptor",
    description:
      "Binds one path-free OS containment implementation identity to the fixed engine-process policy and self-test protocol without granting launch authority.",
    schema: contractRoot(
      descriptorProperties,
      Object.freeze(Object.keys(descriptorProperties)),
    ),
  });

const requestProperties = {
  schemaVersion: { const: "1.0.0" },
  selfTestId: reference("uuid"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  host: hostSchema,
  workload: { const: "engine-project-process" },
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  selfTestSuiteDigest: {
    const: PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  },
  challengeDigest: reference("sha256Digest"),
  fixtureIdentityDigest: reference("sha256Digest"),
  issuedAt: reference("timestamp"),
  expiresAt: reference("timestamp"),
  maxDurationMs: {
    const: PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS,
  },
} as const;

export const processContainmentSelfTestRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-self-test-request",
    version: "1.0.0",
    title: "Process Containment Self-Test Request",
    description:
      "Binds one bounded disposable containment challenge to exact provider, catalog, host, policy, fixture, and probe-suite identities.",
    schema: contractRoot(
      requestProperties,
      Object.freeze(Object.keys(requestProperties)),
    ),
  });

function probeSchema(
  probe: (typeof PROCESS_CONTAINMENT_SELF_TEST_PROBES)[number],
): ReturnType<typeof closedObject> {
  return closedObject(
    {
      id: { const: probe.id },
      expected: { const: probe.expected },
      outcome: {
        enum: [
          "passed",
          "failed",
          "unavailable",
          "cancelled",
          "uncertain",
        ],
      },
      observationDigest: reference("sha256Digest"),
    },
    ["id", "expected", "outcome", "observationDigest"],
  );
}

const probesSchema = {
  type: "array",
  prefixItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.map(probeSchema),
  items: false,
  minItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.length,
  maxItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.length,
} as const;

const effectsSchema = closedObject(
  {
    containedProcessStarted: { type: "boolean" },
    projectMutationPerformed: { type: "boolean" },
    networkConnectionEstablished: { type: "boolean" },
    childProcessStarted: { type: "boolean" },
    cleanup: { enum: ["complete", "incomplete", "uncertain"] },
  },
  [
    "containedProcessStarted",
    "projectMutationPerformed",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ],
);

function verifiedProbeSchema(
  probe: ProcessContainmentSelfTestProbeDefinition,
): ReturnType<typeof closedObject> {
  return closedObject(
    {
      id: { const: probe.id },
      expected: { const: probe.expected },
      outcome: { const: "passed" },
      observationDigest: reference("sha256Digest"),
    },
    ["id", "expected", "outcome", "observationDigest"],
  );
}

const verifiedProbesSchema = {
  type: "array",
  prefixItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.map(
    verifiedProbeSchema,
  ),
  items: false,
  minItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.length,
  maxItems: PROCESS_CONTAINMENT_SELF_TEST_PROBES.length,
} as const;

const verifiedEffectsSchema = closedObject(
  {
    containedProcessStarted: { const: true },
    projectMutationPerformed: { const: false },
    networkConnectionEstablished: { const: false },
    childProcessStarted: { const: false },
    cleanup: { const: "complete" },
  },
  [
    "containedProcessStarted",
    "projectMutationPerformed",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  selfTestId: reference("uuid"),
  request: closedObject(
    requestProperties,
    Object.freeze(Object.keys(requestProperties)),
  ),
  requestDigest: reference("sha256Digest"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  host: hostSchema,
  workload: { const: "engine-project-process" },
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  selfTestSuiteDigest: {
    const: PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  },
  startedAt: reference("timestamp"),
  completedAt: reference("timestamp"),
  durationMs: {
    type: "integer",
    minimum: 1,
    maximum: PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS,
  },
  probes: probesSchema,
  effects: effectsSchema,
  outcome: { enum: ["verified", "rejected"] },
  reportDigest: reference("sha256Digest"),
} as const;

export const processContainmentSelfTestReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-self-test-report",
    version: "1.0.0",
    title: "Process Containment Self-Test Report",
    description:
      "Records strict bounded probe results and effects; a serialized verified value is evidence data and never launch authority.",
    schema: {
      ...contractRoot(
        reportProperties,
        Object.freeze(Object.keys(reportProperties)),
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: { outcome: { const: "verified" } },
            required: ["outcome"],
          },
          then: {
            type: "object",
            properties: {
              probes: verifiedProbesSchema,
              effects: verifiedEffectsSchema,
            },
            required: ["probes", "effects"],
          },
        },
      ],
    },
  });
