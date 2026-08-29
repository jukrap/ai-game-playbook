import { isProxy } from "node:util/types";

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
  GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
  GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  type GodotDeterministicReplayFailureCode,
} from "./godot-deterministic-replay-contracts.js";
import {
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
} from "./godot-version-probe-contracts.js";
import {
  GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
} from "./process-containment-engine-execution-profile-contracts.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { SemanticVersion } from "./semantic-version.js";
import { parseSemanticVersion } from "./semantic-version.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS = 62_000;

export type GodotDeterministicReplayOutputInvalidCode =
  | "godot-replay-output-byte-limit"
  | "godot-replay-output-control-invalid"
  | "godot-replay-exit-outcome-mismatch"
  | "godot-replay-output-event-sequence-invalid"
  | "godot-replay-output-event-shape-invalid"
  | "godot-replay-output-framing-invalid"
  | "godot-replay-output-json-invalid"
  | "godot-replay-output-line-limit"
  | "godot-replay-output-oracle-set-invalid"
  | "godot-replay-output-oracle-state-invalid"
  | "godot-replay-output-oracle-timing-invalid"
  | "godot-replay-output-prefix-invalid"
  | "godot-replay-output-scenario-mismatch"
  | "godot-replay-output-state-hash-invalid"
  | "godot-replay-output-terminal-invalid";

export const GODOT_DETERMINISTIC_REPLAY_OUTPUT_INVALID_CODES: readonly GodotDeterministicReplayOutputInvalidCode[] = Object.freeze([
  "godot-replay-output-byte-limit",
  "godot-replay-output-control-invalid",
  "godot-replay-exit-outcome-mismatch",
  "godot-replay-output-event-sequence-invalid",
  "godot-replay-output-event-shape-invalid",
  "godot-replay-output-framing-invalid",
  "godot-replay-output-json-invalid",
  "godot-replay-output-line-limit",
  "godot-replay-output-oracle-set-invalid",
  "godot-replay-output-oracle-state-invalid",
  "godot-replay-output-oracle-timing-invalid",
  "godot-replay-output-prefix-invalid",
  "godot-replay-output-scenario-mismatch",
  "godot-replay-output-state-hash-invalid",
  "godot-replay-output-terminal-invalid",
] as const);

export type GodotDeterministicReplayReportCode =
  | GodotDeterministicReplayOutputInvalidCode
  | "godot-replay-checkpoint-incomplete"
  | "godot-replay-engine-process-failed"
  | "godot-replay-engine-run-cancelled"
  | "godot-replay-engine-run-uncertain"
  | "godot-replay-input-missed"
  | "godot-replay-maximum-ticks-reached"
  | "godot-replay-oracle-failed"
  | "godot-replay-oracle-window-expired"
  | "godot-replay-passed"
  | "godot-replay-transcript-unavailable";

export const GODOT_DETERMINISTIC_REPLAY_REPORT_CODES: readonly GodotDeterministicReplayReportCode[] = Object.freeze([
  ...GODOT_DETERMINISTIC_REPLAY_OUTPUT_INVALID_CODES,
  "godot-replay-checkpoint-incomplete",
  "godot-replay-engine-process-failed",
  "godot-replay-engine-run-cancelled",
  "godot-replay-engine-run-uncertain",
  "godot-replay-input-missed",
  "godot-replay-maximum-ticks-reached",
  "godot-replay-oracle-failed",
  "godot-replay-oracle-window-expired",
  "godot-replay-passed",
  "godot-replay-transcript-unavailable",
] as const);
export type GodotDeterministicReplayReportStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain";

export interface GodotDeterministicReplayValidatedTranscriptSummary {
  readonly status: "validated";
  readonly transcriptDigest: Sha256Digest;
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: number;
  readonly oracleCount: number;
  readonly terminal: "replay-passed" | "replay-failed";
  readonly terminalCode: "passed" | GodotDeterministicReplayFailureCode;
  readonly terminalTick: number;
}

export interface GodotDeterministicReplayRejectedTranscriptSummary {
  readonly status: "rejected";
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly code: GodotDeterministicReplayOutputInvalidCode;
}

export interface GodotDeterministicReplayUnavailableTranscriptSummary {
  readonly status: "unavailable";
}

export type GodotDeterministicReplayTranscriptSummary =
  | GodotDeterministicReplayValidatedTranscriptSummary
  | GodotDeterministicReplayRejectedTranscriptSummary
  | GodotDeterministicReplayUnavailableTranscriptSummary;

export interface GodotDeterministicReplayContainmentBinding {
  readonly admissionDigest: Sha256Digest;
  readonly runRequestDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly decision: "qualified";
  readonly evidenceGrade: "locally-executed";
  readonly expiresAt: string;
}

export interface GodotDeterministicReplayAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status:
    | "succeeded"
    | "failed"
    | "cancelled"
    | "uncertain"
    | "scope-violation";
  readonly mutationUncertain: boolean;
  readonly violations: readonly StableId[];
  readonly approvalIds: readonly StableId[];
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly settledAt: string;
}

export interface GodotDeterministicReplayReceiptPointer {
  readonly status: "retained";
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
}

export interface GodotDeterministicReplayEngineRunEvidence {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly admissionDigest: Sha256Digest;
  readonly profileId: typeof GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId;
  readonly profileDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly operationId: "engine.deterministic-replay";
  readonly invocationDigest: typeof GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST;
  readonly inputBindingDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly process: {
    readonly started: boolean;
    readonly startedAt: string | null;
    readonly exitCode: number | null;
    readonly totalProcesses: number | null;
    readonly activeProcesses: number | null;
  };
  readonly output: {
    readonly logDigest: Sha256Digest;
    readonly capturedBytes: number;
    readonly observedBytes: number;
    readonly truncated: boolean;
  };
  readonly termination: {
    readonly requested: boolean;
    readonly confirmed: boolean;
    readonly cause:
      | "none"
      | "engine-timeout"
      | "idle-timeout"
      | "caller-cancelled"
      | "safety-boundary";
  };
  readonly effects: {
    readonly sourceProjectPreserved: boolean;
    readonly sourceExecutablePreserved: boolean;
    readonly stagedProjectBaselinePreserved: boolean;
    readonly stagedExecutableBaselinePreserved: boolean;
    readonly profileBudgetPreserved: boolean;
    readonly networkConnectionEstablished: boolean;
    readonly childProcessStarted: boolean;
    readonly cleanup: "complete" | "incomplete" | "uncertain";
  };
  readonly outcome: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly mutationUncertain: boolean;
}

export interface GodotDeterministicReplayReportDigestInput {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
  };
  readonly executable: {
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
  };
  readonly targetVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly versionProbe: {
    readonly digest: Sha256Digest;
    readonly status: "matched";
    readonly exactTargetMatch: true;
  };
  readonly scenario: {
    readonly id: StableId;
    readonly digest: Sha256Digest;
    readonly expectationDigest: Sha256Digest;
  };
  readonly containment: GodotDeterministicReplayContainmentBinding;
  readonly execution: {
    readonly processStarted: boolean;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly status: GodotDeterministicReplayReportStatus;
  readonly code: GodotDeterministicReplayReportCode;
  readonly transcript: GodotDeterministicReplayTranscriptSummary;
  readonly authorization: GodotDeterministicReplayAuthorization;
  readonly engineRun: GodotDeterministicReplayEngineRunEvidence;
  readonly receipt: GodotDeterministicReplayReceiptPointer;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "locally-executed";
    readonly liveValidated: false;
    readonly reason: string;
  };
  readonly mutationPerformed: boolean;
  readonly externalProcessStarted: boolean;
  readonly networkAccessPerformed: boolean;
}

export interface GodotDeterministicReplayReport
  extends GodotDeterministicReplayReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: "engine.deterministic-replay";
  readonly reportDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function invalid(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return false;
  }
  return Object.getOwnPropertyNames(value).every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable === true
    );
  });
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const names = Object.keys(value);
  return (
    names.length === required.length &&
    required.every((name) => Object.hasOwn(value, name))
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function semanticVersion(value: unknown): value is SemanticVersion {
  if (typeof value !== "string") return false;
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function stableIds(value: unknown, minimum: number, maximum: number): boolean {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length < minimum ||
    value.length > maximum
  ) {
    return false;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1) return false;
  let previous: string | undefined;
  const observed = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      !isStableId(descriptor.value) ||
      observed.has(descriptor.value) ||
      (previous !== undefined && previous >= descriptor.value)
    ) {
      return false;
    }
    previous = descriptor.value;
    observed.add(descriptor.value);
  }
  return true;
}

function validateContainment(value: unknown): asserts value is GodotDeterministicReplayContainmentBinding {
  if (
    !record(value) ||
    !exactKeys(value, [
      "admissionDigest",
      "decision",
      "evidenceGrade",
      "executableSnapshotDigest",
      "expiresAt",
      "policyDigest",
      "profileCatalogDigest",
      "profileDigest",
      "projectSnapshotDigest",
      "providerCatalogDigest",
      "providerDescriptorDigest",
      "runRequestDigest",
      "snapshotBindingDigest",
    ])
  ) {
    invalid("Godot replay containment binding is invalid");
  }
  const candidate = value as unknown as GodotDeterministicReplayContainmentBinding;
  if (
    candidate.decision !== "qualified" ||
    candidate.evidenceGrade !== "locally-executed" ||
    candidate.policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    candidate.profileCatalogDigest !== PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    !timestamp(candidate.expiresAt) ||
    [
      candidate.admissionDigest,
      candidate.executableSnapshotDigest,
      candidate.profileDigest,
      candidate.projectSnapshotDigest,
      candidate.providerCatalogDigest,
      candidate.providerDescriptorDigest,
      candidate.runRequestDigest,
      candidate.snapshotBindingDigest,
    ].some((entry) => !isSha256Digest(entry))
  ) {
    invalid("Godot replay containment binding is invalid");
  }
}

function validateEngineRun(value: unknown): asserts value is GodotDeterministicReplayEngineRunEvidence {
  if (
    !record(value) ||
    !exactKeys(value, [
      "admissionDigest",
      "effects",
      "executableSnapshotDigest",
      "inputBindingDigest",
      "invocationDigest",
      "mutationUncertain",
      "operationId",
      "outcome",
      "output",
      "process",
      "profileCatalogDigest",
      "profileDigest",
      "profileId",
      "projectSnapshotDigest",
      "reportDigest",
      "requestDigest",
      "snapshotBindingDigest",
      "termination",
    ])
  ) {
    invalid("Godot replay engine evidence is invalid");
  }
  const candidate = value as unknown as GodotDeterministicReplayEngineRunEvidence;
  if (
    candidate.profileId !== GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId ||
    candidate.profileDigest !== GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileDigest ||
    candidate.profileCatalogDigest !== PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    candidate.operationId !== "engine.deterministic-replay" ||
    candidate.invocationDigest !== GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST ||
    (candidate.outcome !== "succeeded" &&
      candidate.outcome !== "failed" &&
      candidate.outcome !== "cancelled" &&
      candidate.outcome !== "uncertain") ||
    typeof candidate.mutationUncertain !== "boolean" ||
    [
      candidate.admissionDigest,
      candidate.executableSnapshotDigest,
      candidate.inputBindingDigest,
      candidate.projectSnapshotDigest,
      candidate.reportDigest,
      candidate.requestDigest,
      candidate.snapshotBindingDigest,
    ].some((entry) => !isSha256Digest(entry)) ||
    !record(candidate.process) ||
    !exactKeys(candidate.process as unknown as Record<string, unknown>, ["activeProcesses", "exitCode", "started", "startedAt", "totalProcesses"]) ||
    typeof candidate.process.started !== "boolean" ||
    (candidate.process.startedAt !== null && !timestamp(candidate.process.startedAt)) ||
    candidate.process.started !== (candidate.process.startedAt !== null) ||
    (candidate.process.exitCode !== null && !integer(candidate.process.exitCode, -2_147_483_648, 2_147_483_647)) ||
    (candidate.process.totalProcesses !== null && !integer(candidate.process.totalProcesses, 0, 1_024)) ||
    (candidate.process.activeProcesses !== null && !integer(candidate.process.activeProcesses, 0, 1_024)) ||
    !record(candidate.output) ||
    !exactKeys(candidate.output as unknown as Record<string, unknown>, ["capturedBytes", "logDigest", "observedBytes", "truncated"]) ||
    !isSha256Digest(candidate.output.logDigest) ||
    !integer(candidate.output.capturedBytes, 0, GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES) ||
    !integer(candidate.output.observedBytes, 0, 67_108_864) ||
    typeof candidate.output.truncated !== "boolean" ||
    !record(candidate.termination) ||
    !exactKeys(candidate.termination as unknown as Record<string, unknown>, ["cause", "confirmed", "requested"]) ||
    typeof candidate.termination.requested !== "boolean" ||
    typeof candidate.termination.confirmed !== "boolean" ||
    !["none", "engine-timeout", "idle-timeout", "caller-cancelled", "safety-boundary"].includes(candidate.termination.cause) ||
    !record(candidate.effects) ||
    !exactKeys(candidate.effects as unknown as Record<string, unknown>, [
      "childProcessStarted",
      "cleanup",
      "networkConnectionEstablished",
      "profileBudgetPreserved",
      "sourceExecutablePreserved",
      "sourceProjectPreserved",
      "stagedExecutableBaselinePreserved",
      "stagedProjectBaselinePreserved",
    ]) ||
    [
      candidate.effects.childProcessStarted,
      candidate.effects.networkConnectionEstablished,
      candidate.effects.profileBudgetPreserved,
      candidate.effects.sourceExecutablePreserved,
      candidate.effects.sourceProjectPreserved,
      candidate.effects.stagedExecutableBaselinePreserved,
      candidate.effects.stagedProjectBaselinePreserved,
    ].some((entry) => typeof entry !== "boolean") ||
    !["complete", "incomplete", "uncertain"].includes(candidate.effects.cleanup)
  ) {
    invalid("Godot replay engine evidence is invalid");
  }
  const process = candidate.process;
  const output = candidate.output;
  const termination = candidate.termination;
  const effects = candidate.effects;
  const profileLimits =
    GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits;
  const processInvalid =
    (process.totalProcesses === null) !== (process.activeProcesses === null) ||
    (process.totalProcesses !== null &&
      process.activeProcesses !== null &&
      process.activeProcesses > process.totalProcesses) ||
    (process.started &&
      (process.startedAt === null ||
        (process.totalProcesses !== null && process.totalProcesses < 1))) ||
    (!process.started &&
      (process.startedAt !== null ||
        process.exitCode !== null ||
        process.totalProcesses !== 0 ||
        process.activeProcesses !== 0));
  const outputInvalid =
    output.observedBytes > profileLimits.maxProfileBytes ||
    output.capturedBytes > output.observedBytes ||
    output.truncated !== (output.observedBytes > output.capturedBytes);
  const terminationInvalid =
    (!process.started && (termination.requested || !termination.confirmed)) ||
    (termination.requested && termination.cause === "none") ||
    (!termination.requested &&
      termination.cause !== "none" &&
      !(termination.cause === "caller-cancelled" && !process.started)) ||
    ((termination.cause === "engine-timeout" ||
      termination.cause === "idle-timeout" ||
      termination.cause === "safety-boundary") &&
      !process.started) ||
    (termination.cause === "caller-cancelled" &&
      process.started !== termination.requested);
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
      process.totalProcesses > profileLimits.maxProcesses) ||
    (process.activeProcesses !== null && process.activeProcesses > 0);
  const success =
    process.started &&
    process.exitCode === 0 &&
    process.totalProcesses === 1 &&
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
        process.totalProcesses === profileLimits.maxProcesses &&
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
    processInvalid ||
    outputInvalid ||
    terminationInvalid ||
    (candidate.outcome === "succeeded" &&
      (!success || candidate.mutationUncertain)) ||
    (candidate.outcome === "failed" &&
      (!failureSignal ||
        cancelled ||
        uncertaintySignal ||
        candidate.mutationUncertain)) ||
    (candidate.outcome === "cancelled" &&
      (!cancelled || candidate.mutationUncertain)) ||
    (candidate.outcome === "uncertain" &&
      (!uncertaintySignal || !candidate.mutationUncertain))
  ) {
    invalid("Godot replay engine evidence is contradictory");
  }
}

function validateTranscript(value: unknown): asserts value is GodotDeterministicReplayTranscriptSummary {
  if (!record(value) || typeof value["status"] !== "string") {
    invalid("Godot replay transcript summary is invalid");
  }
  const status = value["status"];
  if (status === "unavailable") {
    if (!exactKeys(value, ["status"])) invalid("Godot replay unavailable transcript is invalid");
    return;
  }
  if (status === "rejected") {
    const candidate = value as unknown as GodotDeterministicReplayRejectedTranscriptSummary;
    if (
      !exactKeys(value, ["bytes", "code", "outputDigest", "status"]) ||
      !isSha256Digest(candidate.outputDigest) ||
      !integer(candidate.bytes, 1, GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES) ||
      !GODOT_DETERMINISTIC_REPLAY_OUTPUT_INVALID_CODES.includes(candidate.code)
    ) {
      invalid("Godot replay rejected transcript is invalid");
    }
    return;
  }
  const candidate = value as unknown as GodotDeterministicReplayValidatedTranscriptSummary;
  if (
    status !== "validated" ||
    !exactKeys(value, [
      "bytes",
      "eventCount",
      "oracleCount",
      "outputDigest",
      "status",
      "terminal",
      "terminalCode",
      "terminalTick",
      "transcriptDigest",
    ]) ||
    !isSha256Digest(candidate.transcriptDigest) ||
    !isSha256Digest(candidate.outputDigest) ||
    !integer(candidate.bytes, 1, GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES) ||
    !integer(candidate.eventCount, 2, GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS) ||
    !integer(candidate.oracleCount, 0, GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS - 2) ||
    candidate.eventCount !== candidate.oracleCount + 2 ||
    !integer(candidate.terminalTick, 0, 1_000_000) ||
    (candidate.terminal !== "replay-passed" && candidate.terminal !== "replay-failed") ||
    (candidate.terminal === "replay-passed"
      ? candidate.terminalCode !== "passed"
      : !["checkpoint-incomplete", "input-missed", "maximum-ticks-reached", "oracle-failed", "oracle-window-expired"].includes(candidate.terminalCode))
  ) {
    invalid("Godot replay validated transcript is invalid");
  }
}

function expectedOutcome(
  transcript: GodotDeterministicReplayTranscriptSummary,
  engineRun: GodotDeterministicReplayEngineRunEvidence,
): { readonly status: GodotDeterministicReplayReportStatus; readonly code: GodotDeterministicReplayReportCode } {
  if (transcript.status === "validated") {
    return transcript.terminal === "replay-passed"
      ? { status: "succeeded", code: "godot-replay-passed" }
      : {
          status: "failed",
          code: `godot-replay-${transcript.terminalCode}` as GodotDeterministicReplayReportCode,
        };
  }
  if (transcript.status === "rejected") {
    return { status: "failed", code: transcript.code };
  }
  if (engineRun.outcome === "cancelled") {
    return { status: "cancelled", code: "godot-replay-engine-run-cancelled" };
  }
  if (engineRun.outcome === "uncertain" || engineRun.outcome === "succeeded") {
    return {
      status: "uncertain",
      code:
        engineRun.outcome === "succeeded"
          ? "godot-replay-transcript-unavailable"
          : "godot-replay-engine-run-uncertain",
    };
  }
  return { status: "failed", code: "godot-replay-engine-process-failed" };
}

function validateReportInput(input: GodotDeterministicReplayReportDigestInput): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "authorization",
      "code",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "externalProcessStarted",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "scenario",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "transcript",
      "versionProbe",
    ]) ||
    !uuidPattern.test(input.runId) ||
    !semanticVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    input.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    input.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    !record(input.project) ||
    !exactKeys(input.project, ["id", "identityDigest", "inspectionDigest"]) ||
    !isStableId(input.project.id) ||
    !isSha256Digest(input.project.identityDigest) ||
    !isSha256Digest(input.project.inspectionDigest) ||
    !record(input.executable) ||
    !exactKeys(input.executable, ["digest", "identityDigest"]) ||
    !isSha256Digest(input.executable.digest) ||
    !isSha256Digest(input.executable.identityDigest) ||
    !record(input.versionProbe) ||
    !exactKeys(input.versionProbe, ["digest", "exactTargetMatch", "status"]) ||
    !isSha256Digest(input.versionProbe.digest) ||
    input.versionProbe.status !== "matched" ||
    input.versionProbe.exactTargetMatch !== true ||
    !record(input.scenario) ||
    !exactKeys(input.scenario, ["digest", "expectationDigest", "id"]) ||
    !isStableId(input.scenario.id) ||
    !isSha256Digest(input.scenario.digest) ||
    !isSha256Digest(input.scenario.expectationDigest)
  ) {
    invalid("Godot replay report identity is invalid");
  }
  validateContainment(input.containment);
  validateEngineRun(input.engineRun);
  validateTranscript(input.transcript);
  const execution = input.execution;
  const authorization = input.authorization;
  const receipt = input.receipt;
  if (
    !record(execution) ||
    !exactKeys(execution, ["durationMs", "endedAt", "processStarted", "startedAt"]) ||
    typeof execution.processStarted !== "boolean" ||
    !timestamp(execution.startedAt) ||
    !timestamp(execution.endedAt) ||
    Date.parse(execution.endedAt) < Date.parse(execution.startedAt) ||
    !integer(execution.durationMs, 0, 604_800_000) ||
    execution.durationMs >
      GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits
        .maxReportDurationMs ||
    Date.parse(execution.endedAt) - Date.parse(execution.startedAt) !== execution.durationMs ||
    Date.parse(execution.startedAt) > Date.parse(input.containment.expiresAt) ||
    (input.engineRun.process.startedAt !== null &&
      (Date.parse(input.engineRun.process.startedAt) <
        Date.parse(execution.startedAt) ||
        Date.parse(input.engineRun.process.startedAt) >
          Date.parse(execution.endedAt) ||
        Date.parse(input.engineRun.process.startedAt) >
          Date.parse(input.containment.expiresAt))) ||
    !record(authorization) ||
    !exactKeys(authorization, [
      "approvalIds",
      "authorizationId",
      "durationMs",
      "mutationUncertain",
      "outputBytes",
      "requestDigest",
      "settledAt",
      "status",
      "violations",
    ]) ||
    !uuidPattern.test(authorization.authorizationId) ||
    !isSha256Digest(authorization.requestDigest) ||
    !["succeeded", "failed", "cancelled", "uncertain", "scope-violation"].includes(authorization.status) ||
    typeof authorization.mutationUncertain !== "boolean" ||
    !stableIds(authorization.violations, 0, 32) ||
    !stableIds(authorization.approvalIds, 1, 128) ||
    authorization.durationMs !== execution.durationMs ||
    authorization.outputBytes !== input.engineRun.output.capturedBytes ||
    !timestamp(authorization.settledAt) ||
    Date.parse(authorization.settledAt) < Date.parse(execution.endedAt) ||
    !record(receipt) ||
    !exactKeys(receipt, ["chainLength", "headDigest", "receiptDigest", "receiptId", "status"]) ||
    receipt.status !== "retained" ||
    !uuidPattern.test(receipt.receiptId) ||
    !isSha256Digest(receipt.receiptDigest) ||
    !isSha256Digest(receipt.headDigest) ||
    !integer(receipt.chainLength, 1, 4_096)
  ) {
    invalid("Godot replay execution settlement is invalid");
  }
  const observed = expectedOutcome(input.transcript, input.engineRun);
  const expected =
    authorization.status === "uncertain" ||
    authorization.status === "scope-violation"
      ? {
          status: "uncertain" as const,
          code:
            input.transcript.status === "unavailable" &&
            input.engineRun.outcome === "succeeded"
              ? ("godot-replay-transcript-unavailable" as const)
              : ("godot-replay-engine-run-uncertain" as const),
        }
      : observed;
  const expectedAuthorization =
    expected.status === "uncertain" ? ["uncertain", "scope-violation"] : [expected.status];
  const transcriptDigestMatches =
    input.transcript.status === "unavailable" ||
    input.transcript.outputDigest === input.engineRun.output.logDigest;
  const transcriptOutcomeMatches =
    input.transcript.status !== "validated" ||
    (input.transcript.terminal === "replay-passed"
      ? input.engineRun.outcome === "succeeded" && input.engineRun.process.exitCode === 0
      : input.engineRun.outcome === "failed" && input.engineRun.process.exitCode === 2);
  if (
    input.status !== expected.status ||
    input.code !== expected.code ||
    !expectedAuthorization.includes(authorization.status) ||
    execution.processStarted !== input.engineRun.process.started ||
    input.externalProcessStarted !== input.engineRun.process.started ||
    input.networkAccessPerformed !== input.engineRun.effects.networkConnectionEstablished ||
    input.mutationPerformed !==
      (!input.engineRun.effects.sourceProjectPreserved ||
        !input.engineRun.effects.sourceExecutablePreserved) ||
    input.engineRun.inputBindingDigest !== input.scenario.expectationDigest ||
    input.engineRun.requestDigest !== input.containment.runRequestDigest ||
    input.engineRun.admissionDigest !== input.containment.admissionDigest ||
    input.engineRun.profileDigest !== input.containment.profileDigest ||
    input.engineRun.snapshotBindingDigest !== input.containment.snapshotBindingDigest ||
    input.engineRun.projectSnapshotDigest !== input.containment.projectSnapshotDigest ||
    input.engineRun.executableSnapshotDigest !== input.containment.executableSnapshotDigest ||
    (input.engineRun.mutationUncertain && !authorization.mutationUncertain) ||
    (expected.status === "uncertain" && !authorization.mutationUncertain) ||
    (authorization.status === "scope-violation") !== (authorization.violations.length > 0) ||
    !transcriptDigestMatches ||
    !transcriptOutcomeMatches ||
    !record(input.support) ||
    !exactKeys(input.support, ["evidenceGrade", "grade", "liveValidated", "reason"]) ||
    input.support.grade !== "planned" ||
    input.support.evidenceGrade !== "locally-executed" ||
    input.support.liveValidated !== false ||
    typeof input.support.reason !== "string" ||
    input.support.reason.length < 1 ||
    input.support.reason.length > 500
  ) {
    invalid("Godot replay report outcome is contradictory");
  }
}

export function computeGodotDeterministicReplayReportDigest(
  input: GodotDeterministicReplayReportDigestInput,
): Sha256Digest {
  validateReportInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-deterministic-replay-report",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotDeterministicReplayReportSemantics(
  value: unknown,
): asserts value is GodotDeterministicReplayReport {
  if (
    !record(value) ||
    !exactKeys(value, [
      "authorization",
      "code",
      "commandId",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "externalProcessStarted",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "reportDigest",
      "runId",
      "scenario",
      "schemaVersion",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "transcript",
      "versionProbe",
    ])
  ) {
    invalid("Godot replay report is outside the contract");
  }
  const report = value as unknown as GodotDeterministicReplayReport;
  if (
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.deterministic-replay" ||
    !isSha256Digest(report.reportDigest)
  ) {
    invalid("Godot replay report is outside the contract");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    reportDigest,
    ...input
  } = report;
  if (
    computeGodotDeterministicReplayReportDigest(
      input as unknown as GodotDeterministicReplayReportDigestInput,
    ) !== reportDigest
  ) {
    invalid("Godot replay report digest does not attest its body");
  }
}

const digestFields = (names: readonly string[]) =>
  Object.fromEntries(names.map((name) => [name, reference("sha256Digest")])) as Record<string, ReturnType<typeof reference>>;
const nullableInteger = (minimum: number, maximum: number) => ({
  anyOf: [{ type: "integer", minimum, maximum }, { type: "null" }],
});

const containment = closedObject(
  {
    ...digestFields([
      "admissionDigest",
      "runRequestDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "profileDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
    ]),
    policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
    profileCatalogDigest: { const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST },
    decision: { const: "qualified" },
    evidenceGrade: { const: "locally-executed" },
    expiresAt: reference("timestamp"),
  },
  [
    "admissionDigest",
    "runRequestDigest",
    "policyDigest",
    "providerDescriptorDigest",
    "providerCatalogDigest",
    "profileDigest",
    "profileCatalogDigest",
    "snapshotBindingDigest",
    "projectSnapshotDigest",
    "executableSnapshotDigest",
    "decision",
    "evidenceGrade",
    "expiresAt",
  ],
);

const transcript = {
  oneOf: [
    closedObject({ status: { const: "unavailable" } }, ["status"]),
    closedObject(
      {
        status: { const: "rejected" },
        outputDigest: reference("sha256Digest"),
        bytes: { type: "integer", minimum: 1, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES },
        code: enumSchema(GODOT_DETERMINISTIC_REPLAY_OUTPUT_INVALID_CODES),
      },
      ["status", "outputDigest", "bytes", "code"],
    ),
    closedObject(
      {
        status: { const: "validated" },
        transcriptDigest: reference("sha256Digest"),
        outputDigest: reference("sha256Digest"),
        bytes: { type: "integer", minimum: 1, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES },
        eventCount: { type: "integer", minimum: 2, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS },
        oracleCount: { type: "integer", minimum: 0, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS - 2 },
        terminal: enumSchema(["replay-passed", "replay-failed"]),
        terminalCode: enumSchema([
          "passed",
          "checkpoint-incomplete",
          "input-missed",
          "maximum-ticks-reached",
          "oracle-failed",
          "oracle-window-expired",
        ]),
        terminalTick: { type: "integer", minimum: 0, maximum: 1_000_000 },
      },
      [
        "status",
        "transcriptDigest",
        "outputDigest",
        "bytes",
        "eventCount",
        "oracleCount",
        "terminal",
        "terminalCode",
        "terminalTick",
      ],
    ),
  ],
};

const engineRun = closedObject(
  {
    ...digestFields([
      "requestDigest",
      "reportDigest",
      "admissionDigest",
      "profileDigest",
      "inputBindingDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
    ]),
    profileId: { const: GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId },
    profileCatalogDigest: { const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST },
    operationId: { const: "engine.deterministic-replay" },
    invocationDigest: { const: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST },
    process: closedObject(
      {
        started: { type: "boolean" },
        startedAt: {
          anyOf: [reference("timestamp"), { type: "null" }],
        },
        exitCode: nullableInteger(-2_147_483_648, 2_147_483_647),
        totalProcesses: nullableInteger(0, 1_024),
        activeProcesses: nullableInteger(0, 1_024),
      },
      ["started", "startedAt", "exitCode", "totalProcesses", "activeProcesses"],
    ),
    output: closedObject(
      {
        logDigest: reference("sha256Digest"),
        capturedBytes: { type: "integer", minimum: 0, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES },
        observedBytes: { type: "integer", minimum: 0, maximum: 67_108_864 },
        truncated: { type: "boolean" },
      },
      ["logDigest", "capturedBytes", "observedBytes", "truncated"],
    ),
    termination: closedObject(
      {
        requested: { type: "boolean" },
        confirmed: { type: "boolean" },
        cause: enumSchema(["none", "engine-timeout", "idle-timeout", "caller-cancelled", "safety-boundary"]),
      },
      ["requested", "confirmed", "cause"],
    ),
    effects: closedObject(
      {
        sourceProjectPreserved: { type: "boolean" },
        sourceExecutablePreserved: { type: "boolean" },
        stagedProjectBaselinePreserved: { type: "boolean" },
        stagedExecutableBaselinePreserved: { type: "boolean" },
        profileBudgetPreserved: { type: "boolean" },
        networkConnectionEstablished: { type: "boolean" },
        childProcessStarted: { type: "boolean" },
        cleanup: enumSchema(["complete", "incomplete", "uncertain"]),
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
    ),
    outcome: enumSchema(["succeeded", "failed", "cancelled", "uncertain"]),
    mutationUncertain: { type: "boolean" },
  },
  [
    "requestDigest",
    "reportDigest",
    "admissionDigest",
    "profileId",
    "profileDigest",
    "profileCatalogDigest",
    "operationId",
    "invocationDigest",
    "inputBindingDigest",
    "snapshotBindingDigest",
    "projectSnapshotDigest",
    "executableSnapshotDigest",
    "process",
    "output",
    "termination",
    "effects",
    "outcome",
    "mutationUncertain",
  ],
);

const authorization = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    status: enumSchema(["succeeded", "failed", "cancelled", "uncertain", "scope-violation"]),
    mutationUncertain: { type: "boolean" },
    violations: boundedArray(reference("stableId"), { maximum: 32, unique: true }),
    approvalIds: boundedArray(reference("stableId"), { minimum: 1, maximum: 128, unique: true }),
    durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
    outputBytes: { type: "integer", minimum: 0, maximum: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES },
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "approvalIds",
    "durationMs",
    "outputBytes",
    "settledAt",
  ],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: "engine.deterministic-replay" },
  controlPlaneVersion: reference("semanticVersion"),
  registryDigest: reference("sha256Digest"),
  runId: reference("uuid"),
  project: closedObject(
    {
      id: reference("stableId"),
      identityDigest: reference("sha256Digest"),
      inspectionDigest: reference("sha256Digest"),
    },
    ["id", "identityDigest", "inspectionDigest"],
  ),
  executable: closedObject(
    { digest: reference("sha256Digest"), identityDigest: reference("sha256Digest") },
    ["digest", "identityDigest"],
  ),
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  versionProbe: closedObject(
    {
      digest: reference("sha256Digest"),
      status: { const: "matched" },
      exactTargetMatch: { const: true },
    },
    ["digest", "status", "exactTargetMatch"],
  ),
  scenario: closedObject(
    {
      id: reference("stableId"),
      digest: reference("sha256Digest"),
      expectationDigest: reference("sha256Digest"),
    },
    ["id", "digest", "expectationDigest"],
  ),
  containment,
  execution: closedObject(
    {
      processStarted: { type: "boolean" },
      startedAt: reference("timestamp"),
      endedAt: reference("timestamp"),
      durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
    },
    ["processStarted", "startedAt", "endedAt", "durationMs"],
  ),
  status: enumSchema(["succeeded", "failed", "cancelled", "uncertain"]),
  code: enumSchema(GODOT_DETERMINISTIC_REPLAY_REPORT_CODES),
  transcript,
  authorization,
  engineRun,
  receipt: closedObject(
    {
      status: { const: "retained" },
      receiptId: reference("uuid"),
      receiptDigest: reference("sha256Digest"),
      headDigest: reference("sha256Digest"),
      chainLength: { type: "integer", minimum: 1, maximum: 4_096 },
    },
    ["status", "receiptId", "receiptDigest", "headDigest", "chainLength"],
  ),
  support: closedObject(
    {
      grade: { const: "planned" },
      evidenceGrade: { const: "locally-executed" },
      liveValidated: { const: false },
      reason: textSchema(500),
    },
    ["grade", "evidenceGrade", "liveValidated", "reason"],
  ),
  mutationPerformed: { type: "boolean" },
  externalProcessStarted: { type: "boolean" },
  networkAccessPerformed: { type: "boolean" },
  reportDigest: reference("sha256Digest"),
} as const;

export const godotDeterministicReplayReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-deterministic-replay-report",
    version: "1.0.0",
    title: "Godot Deterministic Replay Report",
    description:
      "Retains one permission-bound, path-free contained replay result and its transcript validation without promoting engine support.",
    schema: contractRoot(reportProperties, Object.keys(reportProperties)),
  });
