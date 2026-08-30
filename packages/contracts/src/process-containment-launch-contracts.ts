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
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";

export const PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS = 15_000;
export const PROCESS_CONTAINMENT_LAUNCH_MAX_VALIDITY_MS = 30_000;
export const PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES: number = 64 * 1024;
export const PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS = 2_000;
export const PROCESS_CONTAINMENT_LAUNCH_MAX_PROJECT_BYTES: number = 64 * 1024;
export const PROCESS_CONTAINMENT_LAUNCH_MAX_ARTIFACT_BYTES: number =
  128 * 1024 * 1024;

export const PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-launch-invocation",
    version: "1.0.0",
    mode: "synthetic-read-only",
    workload: "engine-project-process",
    operation: "synthetic-workload",
    arguments: Object.freeze([
      "project-snapshot",
      "executable-snapshot",
      "challenge",
      "bounded-output",
    ]),
    environment: "provider-fixed",
  });

export interface ProcessContainmentLaunchProjectSnapshotDigestInput {
  readonly kind: "synthetic-read-only";
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly fileCount: 1;
  readonly totalBytes: number;
  readonly capturedAt: string;
}

export interface ProcessContainmentLaunchProjectSnapshot
  extends ProcessContainmentLaunchProjectSnapshotDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly snapshotDigest: Sha256Digest;
}

export interface ProcessContainmentLaunchExecutableSnapshotDigestInput {
  readonly kind: "provider-artifact-copy";
  readonly providerDescriptorDigest: Sha256Digest;
  readonly artifactDigest: Sha256Digest;
  readonly artifactBytes: number;
  readonly capturedAt: string;
}

export interface ProcessContainmentLaunchExecutableSnapshot
  extends ProcessContainmentLaunchExecutableSnapshotDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly snapshotDigest: Sha256Digest;
}

export interface ProcessContainmentLaunchSelfTestBinding {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly expiresAt: string;
}

export interface ProcessContainmentLaunchLimits {
  readonly timeoutMs: typeof PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS;
  readonly maxOutputBytes: typeof PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES;
  readonly terminationGraceMs: typeof PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS;
  readonly maxProcesses: 1;
}

export interface ProcessContainmentLaunchRequest {
  readonly schemaVersion: "1.0.0";
  readonly launchId: string;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly host: {
    readonly platform: "windows" | "linux";
    readonly architecture: "x64" | "arm64";
  };
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly selfTest: ProcessContainmentLaunchSelfTestBinding;
  readonly projectSnapshot: ProcessContainmentLaunchProjectSnapshot;
  readonly executableSnapshot: ProcessContainmentLaunchExecutableSnapshot;
  readonly invocationDigest: typeof PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST;
  readonly challengeDigest: Sha256Digest;
  readonly expectedOutputDigest: Sha256Digest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly limits: ProcessContainmentLaunchLimits;
}

export interface ProcessContainmentLaunchProcessObservation {
  readonly started: boolean;
  readonly exitCode: number | null;
  readonly totalProcesses: number | null;
  readonly activeProcesses: number | null;
}

export interface ProcessContainmentLaunchOutputObservation {
  readonly expectedDigest: Sha256Digest;
  readonly observedDigest: Sha256Digest;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface ProcessContainmentLaunchTermination {
  readonly requested: boolean;
  readonly confirmed: boolean;
}

export interface ProcessContainmentLaunchEffects {
  readonly projectSnapshotPreserved: boolean;
  readonly executableSnapshotPreserved: boolean;
  readonly projectMutationPerformed: boolean;
  readonly networkConnectionEstablished: boolean;
  readonly childProcessStarted: boolean;
  readonly cleanup: "complete" | "incomplete" | "uncertain";
}

export type ProcessContainmentLaunchOutcome =
  | "succeeded"
  | "failed"
  | "uncertain";

export interface ProcessContainmentLaunchReportDigestInput {
  readonly launchId: string;
  readonly request: ProcessContainmentLaunchRequest;
  readonly requestDigest: Sha256Digest;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly invocationDigest: typeof PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly process: ProcessContainmentLaunchProcessObservation;
  readonly output: ProcessContainmentLaunchOutputObservation;
  readonly termination: ProcessContainmentLaunchTermination;
  readonly effects: ProcessContainmentLaunchEffects;
  readonly outcome: ProcessContainmentLaunchOutcome;
  readonly mutationUncertain: boolean;
}

export interface ProcessContainmentLaunchReport
  extends ProcessContainmentLaunchReportDigestInput {
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

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validateProjectSnapshotInput(
  input: ProcessContainmentLaunchProjectSnapshotDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "kind",
      "projectRootIdentityDigest",
      "manifestDigest",
      "fileCount",
      "totalBytes",
      "capturedAt",
    ],
    "process containment launch project snapshot is outside the contract",
  );
  if (
    ownValue(value, "kind") !== "synthetic-read-only" ||
    !isSha256Digest(ownValue(value, "projectRootIdentityDigest")) ||
    !isSha256Digest(ownValue(value, "manifestDigest")) ||
    ownValue(value, "fileCount") !== 1 ||
    !boundedInteger(
      ownValue(value, "totalBytes"),
      1,
      PROCESS_CONTAINMENT_LAUNCH_MAX_PROJECT_BYTES,
    ) ||
    !canonicalTimestamp(ownValue(value, "capturedAt"))
  ) {
    throw new TypeError(
      "process containment launch project snapshot is outside the contract",
    );
  }
}

export function computeProcessContainmentLaunchProjectSnapshotDigest(
  input: ProcessContainmentLaunchProjectSnapshotDigestInput,
): Sha256Digest {
  validateProjectSnapshotInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-launch-project-snapshot",
    version: "1.0.0",
    snapshot: input,
  });
}

function assertProjectSnapshotSemantics(
  snapshot: ProcessContainmentLaunchProjectSnapshot,
): void {
  const value = dataObject(
    snapshot,
    [
      "schemaVersion",
      "kind",
      "projectRootIdentityDigest",
      "manifestDigest",
      "fileCount",
      "totalBytes",
      "capturedAt",
      "snapshotDigest",
    ],
    "process containment launch project snapshot is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "snapshotDigest"))
  ) {
    throw new TypeError(
      "process containment launch project snapshot is outside the contract",
    );
  }
  const input = {
    kind: ownValue(value, "kind"),
    projectRootIdentityDigest: ownValue(
      value,
      "projectRootIdentityDigest",
    ),
    manifestDigest: ownValue(value, "manifestDigest"),
    fileCount: ownValue(value, "fileCount"),
    totalBytes: ownValue(value, "totalBytes"),
    capturedAt: ownValue(value, "capturedAt"),
  } as ProcessContainmentLaunchProjectSnapshotDigestInput;
  if (
    ownValue(value, "snapshotDigest") !==
    computeProcessContainmentLaunchProjectSnapshotDigest(input)
  ) {
    throw new TypeError(
      "process containment launch project snapshot digest does not attest the snapshot",
    );
  }
}

function validateExecutableSnapshotInput(
  input: ProcessContainmentLaunchExecutableSnapshotDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "kind",
      "providerDescriptorDigest",
      "artifactDigest",
      "artifactBytes",
      "capturedAt",
    ],
    "process containment launch executable snapshot is outside the contract",
  );
  if (
    ownValue(value, "kind") !== "provider-artifact-copy" ||
    !isSha256Digest(ownValue(value, "providerDescriptorDigest")) ||
    !isSha256Digest(ownValue(value, "artifactDigest")) ||
    !boundedInteger(
      ownValue(value, "artifactBytes"),
      1,
      PROCESS_CONTAINMENT_LAUNCH_MAX_ARTIFACT_BYTES,
    ) ||
    !canonicalTimestamp(ownValue(value, "capturedAt"))
  ) {
    throw new TypeError(
      "process containment launch executable snapshot is outside the contract",
    );
  }
}

export function computeProcessContainmentLaunchExecutableSnapshotDigest(
  input: ProcessContainmentLaunchExecutableSnapshotDigestInput,
): Sha256Digest {
  validateExecutableSnapshotInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-launch-executable-snapshot",
    version: "1.0.0",
    snapshot: input,
  });
}

function assertExecutableSnapshotSemantics(
  snapshot: ProcessContainmentLaunchExecutableSnapshot,
): void {
  const value = dataObject(
    snapshot,
    [
      "schemaVersion",
      "kind",
      "providerDescriptorDigest",
      "artifactDigest",
      "artifactBytes",
      "capturedAt",
      "snapshotDigest",
    ],
    "process containment launch executable snapshot is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "snapshotDigest"))
  ) {
    throw new TypeError(
      "process containment launch executable snapshot is outside the contract",
    );
  }
  const input = {
    kind: ownValue(value, "kind"),
    providerDescriptorDigest: ownValue(
      value,
      "providerDescriptorDigest",
    ),
    artifactDigest: ownValue(value, "artifactDigest"),
    artifactBytes: ownValue(value, "artifactBytes"),
    capturedAt: ownValue(value, "capturedAt"),
  } as ProcessContainmentLaunchExecutableSnapshotDigestInput;
  if (
    ownValue(value, "snapshotDigest") !==
    computeProcessContainmentLaunchExecutableSnapshotDigest(input)
  ) {
    throw new TypeError(
      "process containment launch executable snapshot digest does not attest the snapshot",
    );
  }
}

function validateHost(value: unknown): ProcessContainmentLaunchRequest["host"] {
  const host = dataObject(
    value,
    ["platform", "architecture"],
    "process containment launch host is outside the contract",
  );
  const platform = ownValue(host, "platform");
  const architecture = ownValue(host, "architecture");
  if (
    (platform !== "windows" && platform !== "linux") ||
    (architecture !== "x64" && architecture !== "arm64")
  ) {
    throw new TypeError(
      "process containment launch host is outside the contract",
    );
  }
  return host as unknown as ProcessContainmentLaunchRequest["host"];
}

function validateSelfTest(
  value: unknown,
): ProcessContainmentLaunchSelfTestBinding {
  const selfTest = dataObject(
    value,
    ["requestDigest", "reportDigest", "expiresAt"],
    "process containment launch self-test binding is outside the contract",
  );
  if (
    !isSha256Digest(ownValue(selfTest, "requestDigest")) ||
    !isSha256Digest(ownValue(selfTest, "reportDigest")) ||
    !canonicalTimestamp(ownValue(selfTest, "expiresAt"))
  ) {
    throw new TypeError(
      "process containment launch self-test binding is outside the contract",
    );
  }
  return selfTest as unknown as ProcessContainmentLaunchSelfTestBinding;
}

function validateLimits(value: unknown): ProcessContainmentLaunchLimits {
  const limits = dataObject(
    value,
    ["timeoutMs", "maxOutputBytes", "terminationGraceMs", "maxProcesses"],
    "process containment launch limits are outside the contract",
  );
  if (
    ownValue(limits, "timeoutMs") !==
      PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS ||
    ownValue(limits, "maxOutputBytes") !==
      PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES ||
    ownValue(limits, "terminationGraceMs") !==
      PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS ||
    ownValue(limits, "maxProcesses") !== 1
  ) {
    throw new TypeError(
      "process containment launch limits are outside the contract",
    );
  }
  return limits as unknown as ProcessContainmentLaunchLimits;
}

export function assertProcessContainmentLaunchRequestSemantics(
  request: ProcessContainmentLaunchRequest,
): void {
  const value = dataObject(
    request,
    [
      "schemaVersion",
      "launchId",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "workload",
      "policyDigest",
      "selfTest",
      "projectSnapshot",
      "executableSnapshot",
      "invocationDigest",
      "challengeDigest",
      "expectedOutputDigest",
      "issuedAt",
      "expiresAt",
      "limits",
    ],
    "process containment launch request is outside the contract",
  );
  const launchId = ownValue(value, "launchId");
  const providerDescriptorDigest = ownValue(
    value,
    "providerDescriptorDigest",
  );
  const issuedAt = ownValue(value, "issuedAt");
  const expiresAt = ownValue(value, "expiresAt");
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    typeof launchId !== "string" ||
    !uuidPattern.test(launchId) ||
    !isSha256Digest(providerDescriptorDigest) ||
    !isSha256Digest(ownValue(value, "providerCatalogDigest")) ||
    ownValue(value, "workload") !== "engine-project-process" ||
    ownValue(value, "policyDigest") !==
      PROCESS_CONTAINMENT_POLICY_DIGEST ||
    ownValue(value, "invocationDigest") !==
      PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST ||
    !isSha256Digest(ownValue(value, "challengeDigest")) ||
    !isSha256Digest(ownValue(value, "expectedOutputDigest")) ||
    !canonicalTimestamp(issuedAt) ||
    !canonicalTimestamp(expiresAt)
  ) {
    throw new TypeError(
      "process containment launch request is outside the contract",
    );
  }
  validateHost(ownValue(value, "host"));
  const selfTest = validateSelfTest(ownValue(value, "selfTest"));
  const projectSnapshot = ownValue(
    value,
    "projectSnapshot",
  ) as ProcessContainmentLaunchProjectSnapshot;
  const executableSnapshot = ownValue(
    value,
    "executableSnapshot",
  ) as ProcessContainmentLaunchExecutableSnapshot;
  assertProjectSnapshotSemantics(projectSnapshot);
  assertExecutableSnapshotSemantics(executableSnapshot);
  validateLimits(ownValue(value, "limits"));
  const validityMs = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (
    validityMs <
      PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS +
        PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS ||
    validityMs > PROCESS_CONTAINMENT_LAUNCH_MAX_VALIDITY_MS ||
    projectSnapshot.capturedAt !== issuedAt ||
    executableSnapshot.capturedAt !== issuedAt ||
    executableSnapshot.providerDescriptorDigest !==
      providerDescriptorDigest ||
    Date.parse(selfTest.expiresAt) < Date.parse(expiresAt)
  ) {
    throw new TypeError(
      "process containment launch request freshness or identity is outside the contract",
    );
  }
}

export function computeProcessContainmentLaunchRequestDigest(
  request: ProcessContainmentLaunchRequest,
): Sha256Digest {
  assertProcessContainmentLaunchRequestSemantics(request);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-launch-request",
    version: "1.0.0",
    request,
  });
}

function validateProcess(
  value: unknown,
): ProcessContainmentLaunchProcessObservation {
  const process = dataObject(
    value,
    ["started", "exitCode", "totalProcesses", "activeProcesses"],
    "process containment launch process observation is outside the contract",
  );
  const started = ownValue(process, "started");
  const exitCode = ownValue(process, "exitCode");
  const totalProcesses = ownValue(process, "totalProcesses");
  const activeProcesses = ownValue(process, "activeProcesses");
  const validNullableExit =
    exitCode === null || boundedInteger(exitCode, -2_147_483_648, 4_294_967_295);
  const validNullableCount = (candidate: unknown): boolean =>
    candidate === null || boundedInteger(candidate, 0, 1_024);
  if (
    typeof started !== "boolean" ||
    !validNullableExit ||
    !validNullableCount(totalProcesses) ||
    !validNullableCount(activeProcesses) ||
    (typeof totalProcesses === "number" &&
      typeof activeProcesses === "number" &&
      activeProcesses > totalProcesses) ||
    (!started &&
      (exitCode !== null || totalProcesses !== null || activeProcesses !== null))
  ) {
    throw new TypeError(
      "process containment launch process observation is outside the contract",
    );
  }
  return process as unknown as ProcessContainmentLaunchProcessObservation;
}

function validateOutput(
  value: unknown,
  request: ProcessContainmentLaunchRequest,
): ProcessContainmentLaunchOutputObservation {
  const output = dataObject(
    value,
    [
      "expectedDigest",
      "observedDigest",
      "capturedBytes",
      "observedBytes",
      "truncated",
    ],
    "process containment launch output observation is outside the contract",
  );
  const capturedBytes = ownValue(output, "capturedBytes");
  const observedBytes = ownValue(output, "observedBytes");
  const truncated = ownValue(output, "truncated");
  if (
    ownValue(output, "expectedDigest") !== request.expectedOutputDigest ||
    !isSha256Digest(ownValue(output, "observedDigest")) ||
    !boundedInteger(
      capturedBytes,
      0,
      PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
    ) ||
    !boundedInteger(
      observedBytes,
      0,
      PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES + 1,
    ) ||
    typeof truncated !== "boolean" ||
    capturedBytes > observedBytes ||
    (truncated && observedBytes <= capturedBytes) ||
    (!truncated && observedBytes !== capturedBytes)
  ) {
    throw new TypeError(
      "process containment launch output observation is outside the contract",
    );
  }
  return output as unknown as ProcessContainmentLaunchOutputObservation;
}

function validateTermination(
  value: unknown,
): ProcessContainmentLaunchTermination {
  const termination = dataObject(
    value,
    ["requested", "confirmed"],
    "process containment launch termination is outside the contract",
  );
  if (
    typeof ownValue(termination, "requested") !== "boolean" ||
    typeof ownValue(termination, "confirmed") !== "boolean"
  ) {
    throw new TypeError(
      "process containment launch termination is outside the contract",
    );
  }
  return termination as unknown as ProcessContainmentLaunchTermination;
}

function validateEffects(value: unknown): ProcessContainmentLaunchEffects {
  const effects = dataObject(
    value,
    [
      "projectSnapshotPreserved",
      "executableSnapshotPreserved",
      "projectMutationPerformed",
      "networkConnectionEstablished",
      "childProcessStarted",
      "cleanup",
    ],
    "process containment launch effects are outside the contract",
  );
  if (
    typeof ownValue(effects, "projectSnapshotPreserved") !== "boolean" ||
    typeof ownValue(effects, "executableSnapshotPreserved") !== "boolean" ||
    typeof ownValue(effects, "projectMutationPerformed") !== "boolean" ||
    typeof ownValue(effects, "networkConnectionEstablished") !== "boolean" ||
    typeof ownValue(effects, "childProcessStarted") !== "boolean" ||
    (ownValue(effects, "cleanup") !== "complete" &&
      ownValue(effects, "cleanup") !== "incomplete" &&
      ownValue(effects, "cleanup") !== "uncertain")
  ) {
    throw new TypeError(
      "process containment launch effects are outside the contract",
    );
  }
  return effects as unknown as ProcessContainmentLaunchEffects;
}

function validateReportDigestInput(
  input: ProcessContainmentLaunchReportDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "launchId",
      "request",
      "requestDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "invocationDigest",
      "startedAt",
      "completedAt",
      "durationMs",
      "process",
      "output",
      "termination",
      "effects",
      "outcome",
      "mutationUncertain",
    ],
    "process containment launch report is outside the contract",
  );
  const request = ownValue(value, "request") as ProcessContainmentLaunchRequest;
  assertProcessContainmentLaunchRequestSemantics(request);
  const startedAt = ownValue(value, "startedAt");
  const completedAt = ownValue(value, "completedAt");
  const durationMs = ownValue(value, "durationMs");
  if (
    ownValue(value, "launchId") !== request.launchId ||
    ownValue(value, "requestDigest") !==
      computeProcessContainmentLaunchRequestDigest(request) ||
    ownValue(value, "providerDescriptorDigest") !==
      request.providerDescriptorDigest ||
    ownValue(value, "providerCatalogDigest") !==
      request.providerCatalogDigest ||
    ownValue(value, "projectSnapshotDigest") !==
      request.projectSnapshot.snapshotDigest ||
    ownValue(value, "executableSnapshotDigest") !==
      request.executableSnapshot.snapshotDigest ||
    ownValue(value, "invocationDigest") !== request.invocationDigest ||
    !canonicalTimestamp(startedAt) ||
    !canonicalTimestamp(completedAt) ||
    !boundedInteger(
      durationMs,
      1,
      PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
    ) ||
    typeof ownValue(value, "mutationUncertain") !== "boolean"
  ) {
    throw new TypeError(
      "process containment launch report binding is outside the contract",
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
      "process containment launch timing is outside the request window",
    );
  }
  const process = validateProcess(ownValue(value, "process"));
  const output = validateOutput(ownValue(value, "output"), request);
  const termination = validateTermination(ownValue(value, "termination"));
  const effects = validateEffects(ownValue(value, "effects"));
  const mutationUncertain = ownValue(value, "mutationUncertain") as boolean;
  const mustBeUncertain =
    !termination.confirmed ||
    effects.cleanup === "uncertain" ||
    (process.started && process.activeProcesses === null) ||
    (!effects.projectSnapshotPreserved &&
      !effects.projectMutationPerformed) ||
    !effects.executableSnapshotPreserved;
  if (
    (mustBeUncertain && !mutationUncertain) ||
    (effects.projectMutationPerformed && effects.projectSnapshotPreserved)
  ) {
    throw new TypeError(
      "process containment launch uncertainty contradicts its observations",
    );
  }
  const succeeded =
    process.started &&
    process.exitCode === 0 &&
    process.totalProcesses === 1 &&
    process.activeProcesses === 0 &&
    output.observedDigest === output.expectedDigest &&
    output.observedBytes > 0 &&
    !output.truncated &&
    !termination.requested &&
    termination.confirmed &&
    effects.projectSnapshotPreserved &&
    effects.executableSnapshotPreserved &&
    !effects.projectMutationPerformed &&
    !effects.networkConnectionEstablished &&
    !effects.childProcessStarted &&
    effects.cleanup === "complete" &&
    !mutationUncertain;
  const expectedOutcome: ProcessContainmentLaunchOutcome = mutationUncertain
    ? "uncertain"
    : succeeded
      ? "succeeded"
      : "failed";
  if (ownValue(value, "outcome") !== expectedOutcome) {
    throw new TypeError(
      "process containment launch outcome contradicts its observations",
    );
  }
}

export function computeProcessContainmentLaunchReportDigest(
  input: ProcessContainmentLaunchReportDigestInput,
): Sha256Digest {
  validateReportDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-launch-report",
    version: "1.0.0",
    report: input,
  });
}

export function assertProcessContainmentLaunchReportSemantics(
  report: ProcessContainmentLaunchReport,
): void {
  const value = dataObject(
    report,
    [
      "schemaVersion",
      "launchId",
      "request",
      "requestDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "invocationDigest",
      "startedAt",
      "completedAt",
      "durationMs",
      "process",
      "output",
      "termination",
      "effects",
      "outcome",
      "mutationUncertain",
      "reportDigest",
    ],
    "process containment launch report is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "reportDigest"))
  ) {
    throw new TypeError(
      "process containment launch report is outside the contract",
    );
  }
  const input = {
    launchId: ownValue(value, "launchId"),
    request: ownValue(value, "request"),
    requestDigest: ownValue(value, "requestDigest"),
    providerDescriptorDigest: ownValue(value, "providerDescriptorDigest"),
    providerCatalogDigest: ownValue(value, "providerCatalogDigest"),
    projectSnapshotDigest: ownValue(value, "projectSnapshotDigest"),
    executableSnapshotDigest: ownValue(value, "executableSnapshotDigest"),
    invocationDigest: ownValue(value, "invocationDigest"),
    startedAt: ownValue(value, "startedAt"),
    completedAt: ownValue(value, "completedAt"),
    durationMs: ownValue(value, "durationMs"),
    process: ownValue(value, "process"),
    output: ownValue(value, "output"),
    termination: ownValue(value, "termination"),
    effects: ownValue(value, "effects"),
    outcome: ownValue(value, "outcome"),
    mutationUncertain: ownValue(value, "mutationUncertain"),
  } as ProcessContainmentLaunchReportDigestInput;
  if (
    ownValue(value, "reportDigest") !==
    computeProcessContainmentLaunchReportDigest(input)
  ) {
    throw new TypeError(
      "process containment launch report digest does not attest the report",
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

const projectSnapshotSchema = closedObject(
  {
    schemaVersion: { const: "1.0.0" },
    kind: { const: "synthetic-read-only" },
    projectRootIdentityDigest: reference("sha256Digest"),
    manifestDigest: reference("sha256Digest"),
    fileCount: { const: 1 },
    totalBytes: {
      type: "integer",
      minimum: 1,
      maximum: PROCESS_CONTAINMENT_LAUNCH_MAX_PROJECT_BYTES,
    },
    capturedAt: reference("timestamp"),
    snapshotDigest: reference("sha256Digest"),
  },
  [
    "schemaVersion",
    "kind",
    "projectRootIdentityDigest",
    "manifestDigest",
    "fileCount",
    "totalBytes",
    "capturedAt",
    "snapshotDigest",
  ],
);

const executableSnapshotSchema = closedObject(
  {
    schemaVersion: { const: "1.0.0" },
    kind: { const: "provider-artifact-copy" },
    providerDescriptorDigest: reference("sha256Digest"),
    artifactDigest: reference("sha256Digest"),
    artifactBytes: {
      type: "integer",
      minimum: 1,
      maximum: PROCESS_CONTAINMENT_LAUNCH_MAX_ARTIFACT_BYTES,
    },
    capturedAt: reference("timestamp"),
    snapshotDigest: reference("sha256Digest"),
  },
  [
    "schemaVersion",
    "kind",
    "providerDescriptorDigest",
    "artifactDigest",
    "artifactBytes",
    "capturedAt",
    "snapshotDigest",
  ],
);

const selfTestSchema = closedObject(
  {
    requestDigest: reference("sha256Digest"),
    reportDigest: reference("sha256Digest"),
    expiresAt: reference("timestamp"),
  },
  ["requestDigest", "reportDigest", "expiresAt"],
);

const limitsSchema = closedObject(
  {
    timeoutMs: { const: PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS },
    maxOutputBytes: { const: PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES },
    terminationGraceMs: {
      const: PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS,
    },
    maxProcesses: { const: 1 },
  },
  ["timeoutMs", "maxOutputBytes", "terminationGraceMs", "maxProcesses"],
);

const requestProperties = {
  schemaVersion: { const: "1.0.0" },
  launchId: reference("uuid"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  host: hostSchema,
  workload: { const: "engine-project-process" },
  policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  selfTest: selfTestSchema,
  projectSnapshot: projectSnapshotSchema,
  executableSnapshot: executableSnapshotSchema,
  invocationDigest: {
    const: PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST,
  },
  challengeDigest: reference("sha256Digest"),
  expectedOutputDigest: reference("sha256Digest"),
  issuedAt: reference("timestamp"),
  expiresAt: reference("timestamp"),
  limits: limitsSchema,
} as const;

export const processContainmentLaunchRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-launch-request",
    version: "1.0.0",
    title: "Process Containment Launch Request",
    description:
      "Binds one short-lived synthetic process launch to fresh path-free project, executable, provider, self-test, invocation, output, and budget identities.",
    schema: contractRoot(
      requestProperties,
      Object.freeze(Object.keys(requestProperties)),
    ),
  });

const processSchema = closedObject(
  {
    started: { type: "boolean" },
    exitCode: {
      anyOf: [
        { type: "integer", minimum: -2_147_483_648, maximum: 4_294_967_295 },
        { type: "null" },
      ],
    },
    totalProcesses: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 1_024 },
        { type: "null" },
      ],
    },
    activeProcesses: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 1_024 },
        { type: "null" },
      ],
    },
  },
  ["started", "exitCode", "totalProcesses", "activeProcesses"],
);

const outputSchema = closedObject(
  {
    expectedDigest: reference("sha256Digest"),
    observedDigest: reference("sha256Digest"),
    capturedBytes: {
      type: "integer",
      minimum: 0,
      maximum: PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
    },
    observedBytes: {
      type: "integer",
      minimum: 0,
      maximum: PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES + 1,
    },
    truncated: { type: "boolean" },
  },
  [
    "expectedDigest",
    "observedDigest",
    "capturedBytes",
    "observedBytes",
    "truncated",
  ],
);

const terminationSchema = closedObject(
  {
    requested: { type: "boolean" },
    confirmed: { type: "boolean" },
  },
  ["requested", "confirmed"],
);

const effectsSchema = closedObject(
  {
    projectSnapshotPreserved: { type: "boolean" },
    executableSnapshotPreserved: { type: "boolean" },
    projectMutationPerformed: { type: "boolean" },
    networkConnectionEstablished: { type: "boolean" },
    childProcessStarted: { type: "boolean" },
    cleanup: { enum: ["complete", "incomplete", "uncertain"] },
  },
  [
    "projectSnapshotPreserved",
    "executableSnapshotPreserved",
    "projectMutationPerformed",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  launchId: reference("uuid"),
  request: closedObject(
    requestProperties,
    Object.freeze(Object.keys(requestProperties)),
  ),
  requestDigest: reference("sha256Digest"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  projectSnapshotDigest: reference("sha256Digest"),
  executableSnapshotDigest: reference("sha256Digest"),
  invocationDigest: {
    const: PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST,
  },
  startedAt: reference("timestamp"),
  completedAt: reference("timestamp"),
  durationMs: {
    type: "integer",
    minimum: 1,
    maximum: PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
  },
  process: processSchema,
  output: outputSchema,
  termination: terminationSchema,
  effects: effectsSchema,
  outcome: { enum: ["succeeded", "failed", "uncertain"] },
  mutationUncertain: { type: "boolean" },
  reportDigest: reference("sha256Digest"),
} as const;

export const processContainmentLaunchReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-launch-report",
    version: "1.0.0",
    title: "Process Containment Launch Report",
    description:
      "Records bounded synthetic launch settlement without paths and keeps failed, succeeded, and uncertain outcomes distinct.",
    schema: {
      ...contractRoot(
        reportProperties,
        Object.freeze(Object.keys(reportProperties)),
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: { outcome: { const: "uncertain" } },
            required: ["outcome"],
          },
          then: {
            type: "object",
            properties: { mutationUncertain: { const: true } },
            required: ["mutationUncertain"],
          },
        },
      ],
    },
  });
