import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import { ENGINE_SNAPSHOT_MAX_FILE_BYTES } from "./engine-execution-snapshot-contracts.js";
import { GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST } from "./godot-headless-preflight-contracts.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";
import { closedObject, contractRoot, reference } from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID =
  "godot-headless-preflight-v1" as const;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS = 30_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS = 10_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS = 2_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES = 262_144;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES = 1;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES = 1_024;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES = 1_024;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES =
  16_777_216;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES =
  33_554_432;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES =
  67_108_864;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS = 42_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-run-profile",
    version: "1.0.0",
    id: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
    engine: "godot",
    operationId: "engine.headless-preflight",
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    arguments: [
      "--headless",
      "--path",
      "$stagedProject",
      "--quit-after",
      "1",
      "--log-file",
      "$profileLocalLog",
      "--no-header",
    ],
    callerArguments: "denied",
    callerEnvironment: "denied",
    networkCapabilities: "none",
    projectSource: "disposable-copy",
  });

export interface ProcessContainmentEngineRunLimits {
  readonly engineTimeoutMs: typeof PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS;
  readonly maxOutputBytes: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES;
  readonly terminationGraceMs: typeof PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS;
  readonly maxProcesses: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES;
  readonly maxProjectFiles: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES;
  readonly maxProjectDirectories: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES;
  readonly maxProjectFileBytes: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES;
  readonly maxProjectBytes: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES;
  readonly maxProfileBytes: typeof PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES;
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
  readonly profile: {
    readonly id: typeof PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID;
    readonly digest: typeof PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST;
  };
  readonly operationId: StableId;
  readonly invocationDigest: typeof GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST;
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
  | "uncertain";

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
  readonly profileDigest: typeof PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST;
  readonly operationId: StableId;
  readonly invocationDigest: typeof GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST;
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

function validateLimits(value: unknown): ProcessContainmentEngineRunLimits {
  const limits = dataObject(
    value,
    [
      "engineTimeoutMs",
      "maxOutputBytes",
      "terminationGraceMs",
      "maxProcesses",
      "maxProjectFiles",
      "maxProjectDirectories",
      "maxProjectFileBytes",
      "maxProjectBytes",
      "maxProfileBytes",
    ],
    "process containment engine run limits are outside the contract",
  );
  if (
    ownValue(limits, "engineTimeoutMs") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS ||
    ownValue(limits, "maxOutputBytes") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES ||
    ownValue(limits, "terminationGraceMs") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS ||
    ownValue(limits, "maxProcesses") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES ||
    ownValue(limits, "maxProjectFiles") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES ||
    ownValue(limits, "maxProjectDirectories") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES ||
    ownValue(limits, "maxProjectFileBytes") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES ||
    ownValue(limits, "maxProjectBytes") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES ||
    ownValue(limits, "maxProfileBytes") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES
  ) {
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
    ["id", "digest"],
    "process containment engine run profile is outside the contract",
  );
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
  validateLimits(ownValue(value, "limits"));
  const runId = ownValue(value, "runId");
  const issuedAt = ownValue(value, "issuedAt");
  const startDeadline = ownValue(value, "startDeadline");
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
    ownValue(profile, "id") !== PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID ||
    ownValue(profile, "digest") !==
      PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST ||
    ownValue(value, "operationId") !== "engine.headless-preflight" ||
    !isStableId(ownValue(value, "operationId")) ||
    ownValue(value, "invocationDigest") !==
      GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    !isSha256Digest(ownValue(value, "snapshotBindingDigest")) ||
    !isSha256Digest(ownValue(project, "rootIdentityDigest")) ||
    !isSha256Digest(ownValue(project, "snapshotDigest")) ||
    !isSha256Digest(ownValue(project, "manifestDigest")) ||
    !integer(
      ownValue(project, "fileCount"),
      1,
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
    ) ||
    !integer(
      ownValue(project, "directoryCount"),
      1,
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
    ) ||
    !integer(
      ownValue(project, "totalBytes"),
      1,
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
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
    validity > PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS
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
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
    ) ||
    !integer(
      observedBytes,
      0,
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
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
    ["requested", "confirmed"],
    "process containment engine run termination is outside the contract",
  );
  if (
    typeof ownValue(termination, "requested") !== "boolean" ||
    typeof ownValue(termination, "confirmed") !== "boolean"
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
      "operationId",
      "invocationDigest",
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
  const output = validateOutput(ownValue(value, "output"));
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
    ownValue(value, "operationId") !== request.operationId ||
    ownValue(value, "invocationDigest") !== request.invocationDigest ||
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
      PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
    ) ||
    (outcome !== "succeeded" &&
      outcome !== "failed" &&
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
    (!process.started && (termination.requested || !termination.confirmed))
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
    process.totalProcesses === 1 &&
    process.activeProcesses === 0 &&
    !output.truncated &&
    !termination.requested &&
    termination.confirmed &&
    effects.sourceProjectPreserved &&
    effects.sourceExecutablePreserved &&
    effects.stagedProjectBaselinePreserved &&
    effects.stagedExecutableBaselinePreserved &&
    effects.profileBudgetPreserved &&
    !effects.networkConnectionEstablished &&
    !effects.childProcessStarted &&
    effects.cleanup === "complete";
  const failureSignal =
    !process.started ||
    process.exitCode !== 0 ||
    output.truncated ||
    !effects.stagedProjectBaselinePreserved ||
    !effects.stagedExecutableBaselinePreserved ||
    !effects.profileBudgetPreserved ||
    termination.requested;
  if (
    (outcome === "succeeded" && (!success || mutationUncertain)) ||
    (outcome === "failed" &&
      (!failureSignal || uncertaintySignal || mutationUncertain)) ||
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
      "operationId",
      "invocationDigest",
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
    id: { type: "string", const: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID },
    digest: {
      type: "string",
      const: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
    },
  },
  ["id", "digest"],
);

const projectSchema = closedObject(
  {
    rootIdentityDigest: reference("sha256Digest"),
    snapshotDigest: reference("sha256Digest"),
    manifestDigest: reference("sha256Digest"),
    fileCount: {
      type: "integer",
      minimum: 1,
      maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
    },
    directoryCount: {
      type: "integer",
      minimum: 1,
      maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
    },
    totalBytes: {
      type: "integer",
      minimum: 1,
      maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
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
    engineTimeoutMs: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
    },
    maxOutputBytes: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
    },
    terminationGraceMs: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
    },
    maxProcesses: { const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES },
    maxProjectFiles: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
    },
    maxProjectDirectories: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
    },
    maxProjectFileBytes: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
    },
    maxProjectBytes: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
    },
    maxProfileBytes: {
      const: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
    },
  },
  [
    "engineTimeoutMs",
    "maxOutputBytes",
    "terminationGraceMs",
    "maxProcesses",
    "maxProjectFiles",
    "maxProjectDirectories",
    "maxProjectFileBytes",
    "maxProjectBytes",
    "maxProfileBytes",
  ],
);

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
  operationId: { type: "string", const: "engine.headless-preflight" },
  invocationDigest: {
    type: "string",
    const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  },
  snapshotBindingDigest: reference("sha256Digest"),
  project: projectSchema,
  executable: executableSchema,
  issuedAt: reference("timestamp"),
  startDeadline: reference("timestamp"),
  limits: limitsSchema,
};

export const processContainmentEngineRunRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-run-request",
    version: "1.0.0",
    title: "Process containment engine run request",
    schema: contractRoot(requestProperties, Object.keys(requestProperties)),
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
      maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
    },
    observedBytes: {
      type: "integer",
      minimum: 0,
      maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
    },
    truncated: { type: "boolean" },
  },
  ["logDigest", "capturedBytes", "observedBytes", "truncated"],
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
  request: closedObject(requestProperties, Object.keys(requestProperties)),
  requestDigest: reference("sha256Digest"),
  admissionDigest: reference("sha256Digest"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  engine: { type: "string", const: "godot" },
  profileDigest: {
    type: "string",
    const: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  },
  operationId: { type: "string", const: "engine.headless-preflight" },
  invocationDigest: {
    type: "string",
    const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  },
  snapshotBindingDigest: reference("sha256Digest"),
  projectSnapshotDigest: reference("sha256Digest"),
  executableSnapshotDigest: reference("sha256Digest"),
  startedAt: reference("timestamp"),
  completedAt: reference("timestamp"),
  durationMs: {
    type: "integer",
    minimum: 0,
    maximum: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
  },
  process: processSchema,
  output: outputSchema,
  termination: terminationSchema,
  effects: effectsSchema,
  outcome: { type: "string", enum: ["succeeded", "failed", "uncertain"] },
  mutationUncertain: { type: "boolean" },
  reportDigest: reference("sha256Digest"),
};

export const processContainmentEngineRunReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-run-report",
    version: "1.0.0",
    title: "Process containment engine run report",
    schema: contractRoot(reportProperties, Object.keys(reportProperties)),
  });
