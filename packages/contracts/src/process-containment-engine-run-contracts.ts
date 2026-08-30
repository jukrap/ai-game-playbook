import {
  defineContractSchema,
  type JsonSchemaObject,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  canonicalizeJson,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import { ENGINE_SNAPSHOT_MAX_FILE_BYTES } from "./engine-execution-snapshot-contracts.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";
import {
  GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
  assertProcessContainmentEngineExecutionProfileSemantics,
  getProcessContainmentEngineExecutionProfile,
  type ProcessContainmentEngineExecutionOperationId,
  type ProcessContainmentEngineExecutionProfile,
  type ProcessContainmentEngineExecutionProfileId,
  type ProcessContainmentEngineExecutionProfileLimits,
} from "./process-containment-engine-execution-profile-contracts.js";
import { closedObject, contractRoot, reference } from "./schema-fragments.js";
import { isStableId } from "./stable-id.js";
import { isProxy } from "node:util/types";

export {
  PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
};

export type ProcessContainmentEngineRunLimits =
  ProcessContainmentEngineExecutionProfileLimits;

export interface ProcessContainmentEngineRunProfileBinding {
  readonly id: ProcessContainmentEngineExecutionProfileId;
  readonly digest: Sha256Digest;
  readonly contractDigest: Sha256Digest;
  readonly catalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
}

export interface ProcessContainmentEngineRunRequest {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly admissionDigest: Sha256Digest;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly host: {
    readonly platform: "windows";
    readonly architecture: "x64";
  };
  readonly engine: "godot";
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly profile: ProcessContainmentEngineRunProfileBinding;
  readonly operationId: ProcessContainmentEngineExecutionOperationId;
  readonly invocationDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest | null;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly project: {
    readonly rootIdentityDigest: Sha256Digest;
    readonly snapshotDigest: Sha256Digest;
    readonly manifestDigest: Sha256Digest;
    readonly fileCount: number;
    readonly directoryCount: number;
    readonly totalBytes: number;
  };
  readonly executable: {
    readonly snapshotDigest: Sha256Digest;
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
    readonly bytes: number;
  };
  readonly issuedAt: string;
  readonly startDeadline: string;
  readonly limits: ProcessContainmentEngineRunLimits;
}

export type ProcessContainmentEngineRunOutcome =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain";

export type ProcessContainmentEngineRunTerminationCause =
  | "none"
  | "engine-timeout"
  | "idle-timeout"
  | "caller-cancelled"
  | "safety-boundary";

export interface ProcessContainmentEngineRunProcessObservation {
  readonly started: boolean;
  readonly startedAt: string | null;
  readonly exitCode: number | null;
  readonly totalProcesses: number | null;
  readonly activeProcesses: number | null;
}

export interface ProcessContainmentEngineRunOutputObservation {
  readonly logDigest: Sha256Digest;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface ProcessContainmentEngineRunTermination {
  readonly requested: boolean;
  readonly confirmed: boolean;
  readonly cause: ProcessContainmentEngineRunTerminationCause;
}

export interface ProcessContainmentEngineRunEffects {
  readonly sourceProjectPreserved: boolean;
  readonly sourceExecutablePreserved: boolean;
  readonly stagedProjectBaselinePreserved: boolean;
  readonly stagedExecutableBaselinePreserved: boolean;
  readonly profileBudgetPreserved: boolean;
  readonly networkConnectionEstablished: boolean;
  readonly childProcessStarted: boolean;
  readonly cleanup: "complete" | "incomplete" | "uncertain";
}

export interface ProcessContainmentEngineRunReportDigestInput {
  readonly runId: string;
  readonly request: ProcessContainmentEngineRunRequest;
  readonly requestDigest: Sha256Digest;
  readonly admissionDigest: Sha256Digest;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly engine: "godot";
  readonly profileDigest: Sha256Digest;
  readonly profileContractDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly operationId: ProcessContainmentEngineExecutionOperationId;
  readonly invocationDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest | null;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly process: ProcessContainmentEngineRunProcessObservation;
  readonly output: ProcessContainmentEngineRunOutputObservation;
  readonly termination: ProcessContainmentEngineRunTermination;
  readonly effects: ProcessContainmentEngineRunEffects;
  readonly outcome: ProcessContainmentEngineRunOutcome;
  readonly mutationUncertain: boolean;
}

export interface ProcessContainmentEngineRunReport
  extends ProcessContainmentEngineRunReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly reportDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function dataObject(
  value: unknown,
  keys: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    throw new TypeError(message);
  }
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
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

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validateLimits(
  value: unknown,
  profile: ProcessContainmentEngineExecutionProfile,
): ProcessContainmentEngineRunLimits {
  const limits = dataObject(
    value,
    [
      "startValidityMs",
      "processTimeoutMs",
      "idleTimeoutMs",
      "terminationGraceMs",
      "maxOutputBytes",
      "maxProcesses",
      "maxProjectFiles",
      "maxProjectDirectories",
      "maxProjectFileBytes",
      "maxProjectBytes",
      "maxProfileBytes",
      "maxReportDurationMs",
    ],
    "process containment engine run limits are outside the contract",
  );
  if (canonicalizeJson(limits) !== canonicalizeJson(profile.limits)) {
    throw new TypeError(
      "process containment engine run limits are outside the contract",
    );
  }
  return limits as unknown as ProcessContainmentEngineRunLimits;
}

export function assertProcessContainmentEngineRunRequestSemantics(
  request: ProcessContainmentEngineRunRequest,
): void {
  const value = dataObject(
    request,
    [
      "schemaVersion",
      "runId",
      "admissionDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "engine",
      "workload",
      "policyDigest",
      "profile",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
      "snapshotBindingDigest",
      "project",
      "executable",
      "issuedAt",
      "startDeadline",
      "limits",
    ],
    "process containment engine run request is outside the contract",
  );
  const host = dataObject(
    ownValue(value, "host"),
    ["platform", "architecture"],
    "process containment engine run host is outside the contract",
  );
  const profile = dataObject(
    ownValue(value, "profile"),
    ["id", "digest", "contractDigest", "catalogDigest"],
    "process containment engine run profile is outside the contract",
  );
  const executionProfile = getProcessContainmentEngineExecutionProfile(
    ownValue(profile, "id"),
  );
  assertProcessContainmentEngineExecutionProfileSemantics(executionProfile);
  const project = dataObject(
    ownValue(value, "project"),
    [
      "rootIdentityDigest",
      "snapshotDigest",
      "manifestDigest",
      "fileCount",
      "directoryCount",
      "totalBytes",
    ],
    "process containment engine run project is outside the contract",
  );
  const executable = dataObject(
    ownValue(value, "executable"),
    ["snapshotDigest", "digest", "identityDigest", "bytes"],
    "process containment engine run executable is outside the contract",
  );
  validateLimits(ownValue(value, "limits"), executionProfile);
  const runId = ownValue(value, "runId");
  const issuedAt = ownValue(value, "issuedAt");
  const startDeadline = ownValue(value, "startDeadline");
  const inputBindingDigest = ownValue(value, "inputBindingDigest");
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    typeof runId !== "string" ||
    !uuidPattern.test(runId) ||
    !isSha256Digest(ownValue(value, "admissionDigest")) ||
    !isSha256Digest(ownValue(value, "providerDescriptorDigest")) ||
    !isSha256Digest(ownValue(value, "providerCatalogDigest")) ||
    ownValue(host, "platform") !== "windows" ||
    ownValue(host, "architecture") !== "x64" ||
    ownValue(value, "engine") !== "godot" ||
    ownValue(value, "workload") !== "engine-project-process" ||
    ownValue(value, "policyDigest") !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    ownValue(profile, "digest") !== executionProfile.profileDigest ||
    ownValue(profile, "contractDigest") !== executionProfile.contractDigest ||
    ownValue(profile, "catalogDigest") !==
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    ownValue(value, "operationId") !== executionProfile.operationId ||
    !isStableId(ownValue(value, "operationId")) ||
    ownValue(value, "invocationDigest") !==
      executionProfile.invocationDigest ||
    (executionProfile.operationId === "engine.headless-preflight"
      ? inputBindingDigest !== null
      : !isSha256Digest(inputBindingDigest)) ||
    !isSha256Digest(ownValue(value, "snapshotBindingDigest")) ||
    !isSha256Digest(ownValue(project, "rootIdentityDigest")) ||
    !isSha256Digest(ownValue(project, "snapshotDigest")) ||
    !isSha256Digest(ownValue(project, "manifestDigest")) ||
    !integer(
      ownValue(project, "fileCount"),
      1,
      executionProfile.limits.maxProjectFiles,
    ) ||
    !integer(
      ownValue(project, "directoryCount"),
      1,
      executionProfile.limits.maxProjectDirectories,
    ) ||
    !integer(
      ownValue(project, "totalBytes"),
      1,
      executionProfile.limits.maxProjectBytes,
    ) ||
    !isSha256Digest(ownValue(executable, "snapshotDigest")) ||
    !isSha256Digest(ownValue(executable, "digest")) ||
    !isSha256Digest(ownValue(executable, "identityDigest")) ||
    !integer(
      ownValue(executable, "bytes"),
      1,
      ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    ) ||
    !timestamp(issuedAt) ||
    !timestamp(startDeadline)
  ) {
    throw new TypeError(
      "process containment engine run request is outside the contract",
    );
  }
  const validity = Date.parse(startDeadline) - Date.parse(issuedAt);
  if (
    validity < 1 ||
    validity > executionProfile.limits.startValidityMs
  ) {
    throw new TypeError(
      "process containment engine run start window is outside the contract",
    );
  }
}

export function computeProcessContainmentEngineRunRequestDigest(
  request: ProcessContainmentEngineRunRequest,
): Sha256Digest {
  assertProcessContainmentEngineRunRequestSemantics(request);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-run-request",
    version: "1.0.0",
    request,
  });
}

function validateProcess(
  value: unknown,
): ProcessContainmentEngineRunProcessObservation {
  const process = dataObject(
    value,
    ["started", "startedAt", "exitCode", "totalProcesses", "activeProcesses"],
    "process containment engine run process observation is outside the contract",
  );
  const started = ownValue(process, "started");
  const startedAt = ownValue(process, "startedAt");
  const exitCode = ownValue(process, "exitCode");
  const totalProcesses = ownValue(process, "totalProcesses");
  const activeProcesses = ownValue(process, "activeProcesses");
  if (
    typeof started !== "boolean" ||
    (startedAt !== null && !timestamp(startedAt)) ||
    (exitCode !== null && !integer(exitCode, -2_147_483_648, 2_147_483_647)) ||
    (totalProcesses !== null && !integer(totalProcesses, 0, 1_024)) ||
    (activeProcesses !== null && !integer(activeProcesses, 0, 1_024)) ||
    (totalProcesses === null) !== (activeProcesses === null) ||
    (typeof totalProcesses === "number" &&
      typeof activeProcesses === "number" &&
      activeProcesses > totalProcesses) ||
    (started &&
      (startedAt === null ||
        (typeof totalProcesses === "number" && totalProcesses < 1))) ||
    (!started &&
      (startedAt !== null ||
        exitCode !== null ||
        totalProcesses !== 0 ||
        activeProcesses !== 0))
  ) {
    throw new TypeError(
      "process containment engine run process observation is outside the contract",
    );
  }
  return process as unknown as ProcessContainmentEngineRunProcessObservation;
}

function validateOutput(
  value: unknown,
  limits: ProcessContainmentEngineRunLimits,
): ProcessContainmentEngineRunOutputObservation {
  const output = dataObject(
    value,
    ["logDigest", "capturedBytes", "observedBytes", "truncated"],
    "process containment engine run output observation is outside the contract",
  );
  const capturedBytes = ownValue(output, "capturedBytes");
  const observedBytes = ownValue(output, "observedBytes");
  const truncated = ownValue(output, "truncated");
  if (
    !isSha256Digest(ownValue(output, "logDigest")) ||
    !integer(
      capturedBytes,
      0,
      limits.maxOutputBytes,
    ) ||
    !integer(
      observedBytes,
      0,
      limits.maxProfileBytes,
    ) ||
    typeof truncated !== "boolean" ||
    (typeof capturedBytes === "number" &&
      typeof observedBytes === "number" &&
      (capturedBytes > observedBytes ||
        truncated !== (observedBytes > capturedBytes)))
  ) {
    throw new TypeError(
      "process containment engine run output observation is outside the contract",
    );
  }
  return output as unknown as ProcessContainmentEngineRunOutputObservation;
}

function validateTermination(
  value: unknown,
): ProcessContainmentEngineRunTermination {
  const termination = dataObject(
    value,
    ["requested", "confirmed", "cause"],
    "process containment engine run termination is outside the contract",
  );
  if (
    typeof ownValue(termination, "requested") !== "boolean" ||
    typeof ownValue(termination, "confirmed") !== "boolean" ||
    (ownValue(termination, "cause") !== "none" &&
      ownValue(termination, "cause") !== "engine-timeout" &&
      ownValue(termination, "cause") !== "idle-timeout" &&
      ownValue(termination, "cause") !== "caller-cancelled" &&
      ownValue(termination, "cause") !== "safety-boundary")
  ) {
    throw new TypeError(
      "process containment engine run termination is outside the contract",
    );
  }
  return termination as unknown as ProcessContainmentEngineRunTermination;
}

function validateEffects(value: unknown): ProcessContainmentEngineRunEffects {
  const effects = dataObject(
    value,
    [
      "sourceProjectPreserved",
      "sourceExecutablePreserved",
      "stagedProjectBaselinePreserved",
      "stagedExecutableBaselinePreserved",
      "profileBudgetPreserved",
      "networkConnectionEstablished",
      "childProcessStarted",
      "cleanup",
    ],
    "process containment engine run effects are outside the contract",
  );
  if (
    typeof ownValue(effects, "sourceProjectPreserved") !== "boolean" ||
    typeof ownValue(effects, "sourceExecutablePreserved") !== "boolean" ||
    typeof ownValue(effects, "stagedProjectBaselinePreserved") !== "boolean" ||
    typeof ownValue(effects, "stagedExecutableBaselinePreserved") !==
      "boolean" ||
    typeof ownValue(effects, "profileBudgetPreserved") !== "boolean" ||
    typeof ownValue(effects, "networkConnectionEstablished") !== "boolean" ||
    typeof ownValue(effects, "childProcessStarted") !== "boolean" ||
    (ownValue(effects, "cleanup") !== "complete" &&
      ownValue(effects, "cleanup") !== "incomplete" &&
      ownValue(effects, "cleanup") !== "uncertain")
  ) {
    throw new TypeError(
      "process containment engine run effects are outside the contract",
    );
  }
  return effects as unknown as ProcessContainmentEngineRunEffects;
}

function validateReportInput(
  input: ProcessContainmentEngineRunReportDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "runId",
      "request",
      "requestDigest",
      "admissionDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "engine",
      "profileDigest",
      "profileContractDigest",
      "profileCatalogDigest",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
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
    "process containment engine run report is outside the contract",
  );
  const request = ownValue(value, "request") as ProcessContainmentEngineRunRequest;
  assertProcessContainmentEngineRunRequestSemantics(request);
  const process = validateProcess(ownValue(value, "process"));
  const output = validateOutput(ownValue(value, "output"), request.limits);
  const termination = validateTermination(ownValue(value, "termination"));
  const effects = validateEffects(ownValue(value, "effects"));
  const startedAt = ownValue(value, "startedAt");
  const completedAt = ownValue(value, "completedAt");
  const durationMs = ownValue(value, "durationMs");
  const outcome = ownValue(value, "outcome");
  const mutationUncertain = ownValue(value, "mutationUncertain");
  if (
    ownValue(value, "runId") !== request.runId ||
    ownValue(value, "requestDigest") !==
      computeProcessContainmentEngineRunRequestDigest(request) ||
    ownValue(value, "admissionDigest") !== request.admissionDigest ||
    ownValue(value, "providerDescriptorDigest") !==
      request.providerDescriptorDigest ||
    ownValue(value, "providerCatalogDigest") !==
      request.providerCatalogDigest ||
    ownValue(value, "engine") !== request.engine ||
    ownValue(value, "profileDigest") !== request.profile.digest ||
    ownValue(value, "profileContractDigest") !==
      request.profile.contractDigest ||
    ownValue(value, "profileCatalogDigest") !==
      request.profile.catalogDigest ||
    ownValue(value, "operationId") !== request.operationId ||
    ownValue(value, "invocationDigest") !== request.invocationDigest ||
    ownValue(value, "inputBindingDigest") !== request.inputBindingDigest ||
    ownValue(value, "snapshotBindingDigest") !==
      request.snapshotBindingDigest ||
    ownValue(value, "projectSnapshotDigest") !== request.project.snapshotDigest ||
    ownValue(value, "executableSnapshotDigest") !==
      request.executable.snapshotDigest ||
    !timestamp(startedAt) ||
    !timestamp(completedAt) ||
    !integer(
      durationMs,
      0,
      request.limits.maxReportDurationMs,
    ) ||
    (outcome !== "succeeded" &&
      outcome !== "failed" &&
      outcome !== "cancelled" &&
      outcome !== "uncertain") ||
    typeof mutationUncertain !== "boolean"
  ) {
    throw new TypeError(
      "process containment engine run report is outside the contract",
    );
  }
  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);
  if (
    completedMs - startedMs !== durationMs ||
    startedMs < Date.parse(request.issuedAt) ||
    startedMs > Date.parse(request.startDeadline) ||
    (process.startedAt !== null &&
      (Date.parse(process.startedAt) < startedMs ||
        Date.parse(process.startedAt) > completedMs ||
        Date.parse(process.startedAt) > Date.parse(request.startDeadline))) ||
    (!process.started && (termination.requested || !termination.confirmed)) ||
    (termination.requested && termination.cause === "none") ||
    (!termination.requested &&
      termination.cause !== "none" &&
      !(termination.cause === "caller-cancelled" && !process.started)) ||
    ((termination.cause === "engine-timeout" ||
      termination.cause === "idle-timeout" ||
      termination.cause === "safety-boundary") &&
      !process.started) ||
    (termination.cause === "idle-timeout" &&
      getProcessContainmentEngineExecutionProfile(request.profile.id).output
        .kind !== "prefixed-json-lines") ||
    (termination.cause === "caller-cancelled" &&
      process.started !== termination.requested)
  ) {
    throw new TypeError(
      "process containment engine run timing is outside the contract",
    );
  }

  const uncertaintySignal =
    !effects.sourceProjectPreserved ||
    !effects.sourceExecutablePreserved ||
    effects.networkConnectionEstablished ||
    effects.childProcessStarted ||
    effects.cleanup !== "complete" ||
    (process.started && !termination.confirmed) ||
    (process.started && process.exitCode === null) ||
    (process.started && process.totalProcesses === null) ||
    (process.totalProcesses !== null &&
      process.totalProcesses > request.limits.maxProcesses) ||
    (process.activeProcesses !== null && process.activeProcesses > 0);
  const success =
    process.started &&
    process.exitCode === 0 &&
    process.totalProcesses === request.limits.maxProcesses &&
    process.activeProcesses === 0 &&
    !output.truncated &&
    !termination.requested &&
    termination.cause === "none" &&
    termination.confirmed &&
    effects.sourceProjectPreserved &&
    effects.sourceExecutablePreserved &&
    effects.stagedProjectBaselinePreserved &&
    effects.stagedExecutableBaselinePreserved &&
    effects.profileBudgetPreserved &&
    !effects.networkConnectionEstablished &&
    !effects.childProcessStarted &&
    effects.cleanup === "complete";
  const cancelled =
    termination.cause === "caller-cancelled" &&
    termination.confirmed &&
    effects.sourceProjectPreserved &&
    effects.sourceExecutablePreserved &&
    effects.profileBudgetPreserved &&
    !effects.networkConnectionEstablished &&
    !effects.childProcessStarted &&
    effects.cleanup === "complete" &&
    !output.truncated &&
    (process.started
      ? process.exitCode !== null &&
        process.totalProcesses !== null &&
        process.totalProcesses >= 1 &&
        process.totalProcesses <= request.limits.maxProcesses &&
        process.activeProcesses === 0 &&
        effects.stagedProjectBaselinePreserved &&
        effects.stagedExecutableBaselinePreserved
      : process.exitCode === null &&
        process.totalProcesses === 0 &&
        process.activeProcesses === 0);
  const failureSignal =
    !process.started ||
    process.exitCode !== 0 ||
    output.truncated ||
    !effects.stagedProjectBaselinePreserved ||
    !effects.stagedExecutableBaselinePreserved ||
    !effects.profileBudgetPreserved ||
    termination.cause === "engine-timeout" ||
    termination.cause === "idle-timeout" ||
    termination.cause === "safety-boundary";
  if (
    (outcome === "succeeded" && (!success || mutationUncertain)) ||
    (outcome === "failed" &&
      (!failureSignal || cancelled || uncertaintySignal || mutationUncertain)) ||
    (outcome === "cancelled" && (!cancelled || mutationUncertain)) ||
    (outcome === "uncertain" && (!uncertaintySignal || !mutationUncertain))
  ) {
    throw new TypeError(
      "process containment engine run outcome contradicts its observations",
    );
  }
}

export function computeProcessContainmentEngineRunReportDigest(
  input: ProcessContainmentEngineRunReportDigestInput,
): Sha256Digest {
  validateReportInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-run-report",
    version: "1.0.0",
    report: input,
  });
}

export function assertProcessContainmentEngineRunReportSemantics(
  report: ProcessContainmentEngineRunReport,
): void {
  const value = dataObject(
    report,
    [
      "schemaVersion",
      "runId",
      "request",
      "requestDigest",
      "admissionDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "engine",
      "profileDigest",
      "profileContractDigest",
      "profileCatalogDigest",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
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
    "process containment engine run report is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "reportDigest"))
  ) {
    throw new TypeError(
      "process containment engine run report is outside the contract",
    );
  }
  const input = Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => key !== "schemaVersion" && key !== "reportDigest",
    ),
  ) as unknown as ProcessContainmentEngineRunReportDigestInput;
  if (
    ownValue(value, "reportDigest") !==
    computeProcessContainmentEngineRunReportDigest(input)
  ) {
    throw new TypeError(
      "process containment engine run report digest does not attest the report",
    );
  }
}

const hostSchema = closedObject(
  {
    platform: { type: "string", const: "windows" },
    architecture: { type: "string", const: "x64" },
  },
  ["platform", "architecture"],
);

const profileSchema = closedObject(
  {
    id: reference("stableId"),
    digest: reference("sha256Digest"),
    contractDigest: reference("sha256Digest"),
    catalogDigest: {
      type: "string",
      const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    },
  },
  ["id", "digest", "contractDigest", "catalogDigest"],
);

const maximumProjectFiles = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxProjectFiles,
  ),
);
const maximumProjectDirectories = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxProjectDirectories,
  ),
);
const maximumProjectBytes = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxProjectBytes,
  ),
);
const maximumOutputBytes = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxOutputBytes,
  ),
);
const maximumProfileBytes = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxProfileBytes,
  ),
);
const maximumReportDurationMs = Math.max(
  ...PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    ({ limits }) => limits.maxReportDurationMs,
  ),
);

const projectSchema = closedObject(
  {
    rootIdentityDigest: reference("sha256Digest"),
    snapshotDigest: reference("sha256Digest"),
    manifestDigest: reference("sha256Digest"),
    fileCount: {
      type: "integer",
      minimum: 1,
      maximum: maximumProjectFiles,
    },
    directoryCount: {
      type: "integer",
      minimum: 1,
      maximum: maximumProjectDirectories,
    },
    totalBytes: {
      type: "integer",
      minimum: 1,
      maximum: maximumProjectBytes,
    },
  },
  [
    "rootIdentityDigest",
    "snapshotDigest",
    "manifestDigest",
    "fileCount",
    "directoryCount",
    "totalBytes",
  ],
);

const executableSchema = closedObject(
  {
    snapshotDigest: reference("sha256Digest"),
    digest: reference("sha256Digest"),
    identityDigest: reference("sha256Digest"),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    },
  },
  ["snapshotDigest", "digest", "identityDigest", "bytes"],
);

const limitsSchema = closedObject(
  {
    startValidityMs: { type: "integer", minimum: 1, maximum: 60_000 },
    processTimeoutMs: { type: "integer", minimum: 1, maximum: 600_000 },
    idleTimeoutMs: { type: "integer", minimum: 1, maximum: 600_000 },
    terminationGraceMs: { type: "integer", minimum: 1, maximum: 30_000 },
    maxOutputBytes: { type: "integer", minimum: 1, maximum: 16_777_216 },
    maxProcesses: { type: "integer", minimum: 1, maximum: 16 },
    maxProjectFiles: { type: "integer", minimum: 1, maximum: 100_000 },
    maxProjectDirectories: {
      type: "integer",
      minimum: 1,
      maximum: 100_000,
    },
    maxProjectFileBytes: {
      type: "integer",
      minimum: 1,
      maximum: 1_073_741_824,
    },
    maxProjectBytes: {
      type: "integer",
      minimum: 1,
      maximum: 4_294_967_296,
    },
    maxProfileBytes: {
      type: "integer",
      minimum: 1,
      maximum: 4_294_967_296,
    },
    maxReportDurationMs: {
      type: "integer",
      minimum: 1,
      maximum: 1_200_000,
    },
  },
  [
    "startValidityMs",
    "processTimeoutMs",
    "idleTimeoutMs",
    "terminationGraceMs",
    "maxOutputBytes",
    "maxProcesses",
    "maxProjectFiles",
    "maxProjectDirectories",
    "maxProjectFileBytes",
    "maxProjectBytes",
    "maxProfileBytes",
    "maxReportDurationMs",
  ],
);

function profileBinding(
  profile: ProcessContainmentEngineExecutionProfile,
): ProcessContainmentEngineRunProfileBinding {
  return {
    id: profile.profileId,
    digest: profile.profileDigest,
    contractDigest: profile.contractDigest,
    catalogDigest:
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  };
}

function inputBindingSchema(
  profile: ProcessContainmentEngineExecutionProfile,
): JsonSchemaObject {
  return profile.operationId === "engine.headless-preflight"
    ? { type: "null" }
    : reference("sha256Digest");
}

function requestProfileVariantSchema(
  profile: ProcessContainmentEngineExecutionProfile,
): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      profile: {
        const: profileBinding(profile) as unknown as CanonicalJsonValue,
      },
      operationId: { const: profile.operationId },
      invocationDigest: { const: profile.invocationDigest },
      inputBindingDigest: inputBindingSchema(profile),
      limits: {
        const: profile.limits as unknown as CanonicalJsonValue,
      },
    },
    required: [
      "profile",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
      "limits",
    ],
  };
}

const requestProperties = {
  schemaVersion: { type: "string", const: "1.0.0" },
  runId: reference("uuid"),
  admissionDigest: reference("sha256Digest"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  host: hostSchema,
  engine: { type: "string", const: "godot" },
  workload: { type: "string", const: "engine-project-process" },
  policyDigest: { type: "string", const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  profile: profileSchema,
  operationId: reference("stableId"),
  invocationDigest: reference("sha256Digest"),
  inputBindingDigest: {
    anyOf: [reference("sha256Digest"), { type: "null" }],
  },
  snapshotBindingDigest: reference("sha256Digest"),
  project: projectSchema,
  executable: executableSchema,
  issuedAt: reference("timestamp"),
  startDeadline: reference("timestamp"),
  limits: limitsSchema,
};

const requestShape: JsonSchemaObject = {
  ...closedObject(requestProperties, Object.keys(requestProperties)),
  oneOf: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
    requestProfileVariantSchema,
  ),
};

export const processContainmentEngineRunRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-run-request",
    version: "1.0.0",
    title: "Process containment engine run request",
    schema: {
      ...contractRoot(requestProperties, Object.keys(requestProperties)),
      oneOf: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
        requestProfileVariantSchema,
      ),
    },
  });

const processSchema = closedObject(
  {
    started: { type: "boolean" },
    startedAt: {
      anyOf: [reference("timestamp"), { type: "null" }],
    },
    exitCode: {
      anyOf: [
        { type: "integer", minimum: -2_147_483_648, maximum: 2_147_483_647 },
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
  ["started", "startedAt", "exitCode", "totalProcesses", "activeProcesses"],
);

const outputSchema = closedObject(
  {
    logDigest: reference("sha256Digest"),
    capturedBytes: {
      type: "integer",
      minimum: 0,
      maximum: maximumOutputBytes,
    },
    observedBytes: {
      type: "integer",
      minimum: 0,
      maximum: maximumProfileBytes,
    },
    truncated: { type: "boolean" },
  },
  ["logDigest", "capturedBytes", "observedBytes", "truncated"],
);

const terminationSchema = closedObject(
  {
    requested: { type: "boolean" },
    confirmed: { type: "boolean" },
    cause: {
      type: "string",
      enum: [
        "none",
        "engine-timeout",
        "idle-timeout",
        "caller-cancelled",
        "safety-boundary",
      ],
    },
  },
  ["requested", "confirmed", "cause"],
);

const effectsSchema = closedObject(
  {
    sourceProjectPreserved: { type: "boolean" },
    sourceExecutablePreserved: { type: "boolean" },
    stagedProjectBaselinePreserved: { type: "boolean" },
    stagedExecutableBaselinePreserved: { type: "boolean" },
    profileBudgetPreserved: { type: "boolean" },
    networkConnectionEstablished: { type: "boolean" },
    childProcessStarted: { type: "boolean" },
    cleanup: {
      type: "string",
      enum: ["complete", "incomplete", "uncertain"],
    },
  },
  [
    "sourceProjectPreserved",
    "sourceExecutablePreserved",
    "stagedProjectBaselinePreserved",
    "stagedExecutableBaselinePreserved",
    "profileBudgetPreserved",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ],
);

const reportProperties = {
  schemaVersion: { type: "string", const: "1.0.0" },
  runId: reference("uuid"),
  request: requestShape,
  requestDigest: reference("sha256Digest"),
  admissionDigest: reference("sha256Digest"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  engine: { type: "string", const: "godot" },
  profileDigest: reference("sha256Digest"),
  profileContractDigest: reference("sha256Digest"),
  profileCatalogDigest: {
    type: "string",
    const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  },
  operationId: reference("stableId"),
  invocationDigest: reference("sha256Digest"),
  inputBindingDigest: {
    anyOf: [reference("sha256Digest"), { type: "null" }],
  },
  snapshotBindingDigest: reference("sha256Digest"),
  projectSnapshotDigest: reference("sha256Digest"),
  executableSnapshotDigest: reference("sha256Digest"),
  startedAt: reference("timestamp"),
  completedAt: reference("timestamp"),
  durationMs: {
    type: "integer",
    minimum: 0,
    maximum: maximumReportDurationMs,
  },
  process: processSchema,
  output: outputSchema,
  termination: terminationSchema,
  effects: effectsSchema,
  outcome: {
    type: "string",
    enum: ["succeeded", "failed", "cancelled", "uncertain"],
  },
  mutationUncertain: { type: "boolean" },
  reportDigest: reference("sha256Digest"),
};

function reportProfileVariantSchema(
  profile: ProcessContainmentEngineExecutionProfile,
): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      request: {
        ...requestShape,
        allOf: [requestProfileVariantSchema(profile)],
      },
      profileDigest: { const: profile.profileDigest },
      profileContractDigest: { const: profile.contractDigest },
      profileCatalogDigest: {
        const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      },
      operationId: { const: profile.operationId },
      invocationDigest: { const: profile.invocationDigest },
      inputBindingDigest: inputBindingSchema(profile),
      durationMs: {
        type: "integer",
        minimum: 0,
        maximum: profile.limits.maxReportDurationMs,
      },
      output: {
        type: "object",
        properties: {
          capturedBytes: {
            type: "integer",
            minimum: 0,
            maximum: profile.limits.maxOutputBytes,
          },
          observedBytes: {
            type: "integer",
            minimum: 0,
            maximum: profile.limits.maxProfileBytes,
          },
        },
        required: ["capturedBytes", "observedBytes"],
      },
      termination: {
        type: "object",
        properties: {
          cause: {
            enum:
              profile.output.kind === "digest-only-log"
                ? [
                    "none",
                    "engine-timeout",
                    "caller-cancelled",
                    "safety-boundary",
                  ]
                : [
                    "none",
                    "engine-timeout",
                    "idle-timeout",
                    "caller-cancelled",
                    "safety-boundary",
                  ],
          },
        },
        required: ["cause"],
      },
    },
    required: [
      "request",
      "profileDigest",
      "profileContractDigest",
      "profileCatalogDigest",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
      "durationMs",
      "output",
      "termination",
    ],
  };
}

export const processContainmentEngineRunReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-run-report",
    version: "1.0.0",
    title: "Process containment engine run report",
    schema: {
      ...contractRoot(reportProperties, Object.keys(reportProperties)),
      oneOf: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
        reportProfileVariantSchema,
      ),
    },
  });
