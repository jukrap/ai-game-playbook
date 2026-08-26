import {
  digestCanonicalJson,
  isSha256Digest,
  type ComponentOutcome,
} from "@ai-game-playbook/contracts";
import {
  PROCESS_MAX_DURATION_MS,
  PROCESS_MAX_OUTPUT_BYTES,
  type BoundedProcessResult,
  type ProcessStopReason,
} from "@ai-game-playbook/core";

import { EvidenceNormalizationError } from "./errors.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNAL_PATTERN = /^SIG[A-Z0-9]{1,28}$/;
const SPAWN_ERROR_PATTERN = /^[A-Z0-9_]{1,64}$/;
const PROCESS_STOP_REASONS: readonly ProcessStopReason[] = Object.freeze([
  "cancelled",
  "idle-timed-out",
  "output-limit",
  "timed-out",
]);

type DataRecord = Record<string, unknown>;

export type ProcessResultCode =
  | "process.exited-zero"
  | "process.exit-nonzero"
  | "process.signalled"
  | "process.spawn-failed"
  | "process.timed-out"
  | "process.idle-timed-out"
  | "process.output-limit"
  | "process.cancelled"
  | "process.termination-uncertain";

export interface NormalizedProcessResult {
  readonly component: "process";
  readonly status: ComponentOutcome;
  readonly code: ProcessResultCode;
  readonly message: string;
  readonly outer: {
    readonly status: ComponentOutcome;
    readonly exitCode?: number;
    readonly timedOut: boolean;
  };
  readonly mutationUncertain: boolean;
  readonly outputTruncated: boolean;
  readonly terminationConfirmed: boolean;
}

interface ProcessClassification {
  readonly status: ComponentOutcome;
  readonly code: ProcessResultCode;
  readonly message: string;
}

function invalid(path: string, message: string): never {
  throw new EvidenceNormalizationError(
    "invalid-process-result-observation",
    path,
    message,
  );
}

function plainRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    invalid(path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    invalid(path, "object properties must be enumerable data fields");
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const expected = new Set([...required, ...optional]);
  const actual = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid(path, "record contains undeclared fields or omits required fields");
  }
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "expected a nonnegative safe integer");
  }
  return value as number;
}

function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    invalid(path, "expected a canonical UTC timestamp");
  }
  return value;
}

function validateIdentity(value: unknown): void {
  const identity = plainRecord(value, "$process.identity");
  exactKeys(
    identity,
    [
      "pid",
      "spawnedAt",
      "processToken",
      "executableDigest",
      "rootIdentityDigest",
      "identityDigest",
    ],
    [],
    "$process.identity",
  );
  if (!Number.isSafeInteger(identity["pid"]) || (identity["pid"] as number) < 1) {
    invalid("$process.identity.pid", "process PID must be a positive integer");
  }
  timestamp(identity["spawnedAt"], "$process.identity.spawnedAt");
  if (
    typeof identity["processToken"] !== "string" ||
    !UUID_PATTERN.test(identity["processToken"])
  ) {
    invalid("$process.identity.processToken", "process token must be a lowercase UUID");
  }
  if (
    !isSha256Digest(identity["executableDigest"]) ||
    !isSha256Digest(identity["rootIdentityDigest"]) ||
    !isSha256Digest(identity["identityDigest"])
  ) {
    invalid("$process.identity", "process identity digests must be canonical SHA-256 values");
  }
  const { identityDigest, ...body } = identity;
  if (digestCanonicalJson(body) !== identityDigest) {
    invalid("$process.identity.identityDigest", "process identity digest does not attest its body");
  }
}

function validateOutput(value: unknown): { readonly truncated: boolean } {
  const output = plainRecord(value, "$process.output");
  exactKeys(
    output,
    [
      "stdout",
      "stderr",
      "stdoutDigest",
      "stderrDigest",
      "stdoutObservedBytes",
      "stderrObservedBytes",
      "capturedBytes",
      "observedBytes",
      "truncated",
    ],
    [],
    "$process.output",
  );
  if (
    typeof output["stdout"] !== "string" ||
    typeof output["stderr"] !== "string" ||
    output["stdout"].length > PROCESS_MAX_OUTPUT_BYTES ||
    output["stderr"].length > PROCESS_MAX_OUTPUT_BYTES ||
    !isSha256Digest(output["stdoutDigest"]) ||
    !isSha256Digest(output["stderrDigest"]) ||
    typeof output["truncated"] !== "boolean"
  ) {
    invalid("$process.output", "process output observation is malformed or unbounded");
  }
  const stdoutObservedBytes = nonnegativeInteger(
    output["stdoutObservedBytes"],
    "$process.output.stdoutObservedBytes",
  );
  const stderrObservedBytes = nonnegativeInteger(
    output["stderrObservedBytes"],
    "$process.output.stderrObservedBytes",
  );
  const capturedBytes = nonnegativeInteger(
    output["capturedBytes"],
    "$process.output.capturedBytes",
  );
  const observedBytes = nonnegativeInteger(
    output["observedBytes"],
    "$process.output.observedBytes",
  );
  if (
    capturedBytes > PROCESS_MAX_OUTPUT_BYTES ||
    stdoutObservedBytes + stderrObservedBytes !== observedBytes ||
    capturedBytes > observedBytes ||
    (!output["truncated"] && capturedBytes !== observedBytes)
  ) {
    invalid("$process.output", "process output byte counters are contradictory");
  }
  return Object.freeze({ truncated: output["truncated"] });
}

function isStopReason(value: unknown): value is ProcessStopReason {
  return PROCESS_STOP_REASONS.some((candidate) => candidate === value);
}

function validateTermination(value: unknown): {
  readonly requested: boolean;
  readonly reason?: ProcessStopReason;
  readonly confirmed: boolean;
} {
  const termination = plainRecord(value, "$process.termination");
  exactKeys(
    termination,
    ["requested", "escalated", "confirmed"],
    ["reason"],
    "$process.termination",
  );
  if (
    typeof termination["requested"] !== "boolean" ||
    typeof termination["escalated"] !== "boolean" ||
    typeof termination["confirmed"] !== "boolean" ||
    (termination["reason"] !== undefined && !isStopReason(termination["reason"]))
  ) {
    invalid("$process.termination", "process termination observation is malformed");
  }
  if (
    (!termination["requested"] &&
      (termination["reason"] !== undefined || termination["escalated"])) ||
    (termination["requested"] && termination["reason"] === undefined)
  ) {
    invalid("$process.termination", "process termination fields are contradictory");
  }
  return Object.freeze({
    requested: termination["requested"],
    ...(termination["reason"] === undefined
      ? {}
      : { reason: termination["reason"] as ProcessStopReason }),
    confirmed: termination["confirmed"],
  });
}

function validateProcessResult(value: BoundedProcessResult): {
  readonly result: DataRecord;
  readonly output: { readonly truncated: boolean };
  readonly termination: {
    readonly requested: boolean;
    readonly reason?: ProcessStopReason;
    readonly confirmed: boolean;
  };
  readonly exitCode: number | null;
  readonly signal: string | null;
} {
  const result = plainRecord(value, "$process");
  exactKeys(
    result,
    [
      "outcome",
      "startedAt",
      "endedAt",
      "durationMs",
      "exitCode",
      "signal",
      "output",
      "termination",
      "mutationUncertain",
    ],
    ["identity", "spawnErrorCode"],
    "$process",
  );
  const outcomes = new Set([
    "exited",
    "spawn-failed",
    "termination-uncertain",
    ...PROCESS_STOP_REASONS,
  ]);
  if (!outcomes.has(result["outcome"] as string)) {
    invalid("$process.outcome", "process outcome is not recognized");
  }
  const startedAt = timestamp(result["startedAt"], "$process.startedAt");
  const endedAt = timestamp(result["endedAt"], "$process.endedAt");
  const durationMs = nonnegativeInteger(result["durationMs"], "$process.durationMs");
  if (Date.parse(endedAt) < Date.parse(startedAt) || durationMs > PROCESS_MAX_DURATION_MS) {
    invalid("$process.durationMs", "process timing is unordered or exceeds the runtime boundary");
  }
  const exitCode = result["exitCode"];
  if (
    exitCode !== null &&
    (!Number.isInteger(exitCode) ||
      (exitCode as number) < -2147483648 ||
      (exitCode as number) > 2147483647)
  ) {
    invalid("$process.exitCode", "process exit code is outside the signed 32-bit range");
  }
  const signal = result["signal"];
  if (signal !== null && (typeof signal !== "string" || !SIGNAL_PATTERN.test(signal))) {
    invalid("$process.signal", "process signal is not canonical");
  }
  if (typeof result["mutationUncertain"] !== "boolean") {
    invalid("$process.mutationUncertain", "mutation uncertainty must be explicit");
  }
  const output = validateOutput(result["output"]);
  const termination = validateTermination(result["termination"]);
  const outcome = result["outcome"] as string;
  const hasIdentity = result["identity"] !== undefined;
  const hasSpawnError = result["spawnErrorCode"] !== undefined;
  if (hasIdentity) validateIdentity(result["identity"]);
  if (
    hasSpawnError &&
    (typeof result["spawnErrorCode"] !== "string" ||
      !SPAWN_ERROR_PATTERN.test(result["spawnErrorCode"]))
  ) {
    invalid("$process.spawnErrorCode", "spawn error code is not canonical");
  }
  const hasClose = (exitCode === null) !== (signal === null);
  if (outcome === "spawn-failed") {
    if (
      hasIdentity ||
      !hasSpawnError ||
      exitCode !== null ||
      signal !== null ||
      termination.requested ||
      !termination.confirmed ||
      result["mutationUncertain"] ||
      output.truncated
    ) {
      invalid("$process", "spawn failure observation contradicts process lifecycle");
    }
  } else if (outcome === "exited") {
    if (
      !hasIdentity ||
      hasSpawnError ||
      !hasClose ||
      termination.requested ||
      !termination.confirmed ||
      result["mutationUncertain"] ||
      output.truncated
    ) {
      invalid("$process", "exited process observation contradicts process lifecycle");
    }
  } else if (outcome === "termination-uncertain") {
    if (
      !hasIdentity ||
      hasSpawnError ||
      !termination.requested ||
      termination.confirmed ||
      !result["mutationUncertain"] ||
      output.truncated !== (termination.reason === "output-limit")
    ) {
      invalid("$process", "uncertain termination observation contradicts process lifecycle");
    }
  } else if (
    !hasIdentity ||
    hasSpawnError ||
    !hasClose ||
    !termination.requested ||
    termination.reason !== outcome ||
    !termination.confirmed ||
    !result["mutationUncertain"] ||
    output.truncated !== (outcome === "output-limit")
  ) {
    invalid("$process", "stopped process observation contradicts process lifecycle");
  }
  return Object.freeze({
    result,
    output,
    termination,
    exitCode: exitCode as number | null,
    signal: signal as string | null,
  });
}

function classifyProcess(
  result: DataRecord,
  exitCode: number | null,
  signal: string | null,
): ProcessClassification {
  switch (result["outcome"]) {
    case "spawn-failed":
      return {
        status: "failed",
        code: "process.spawn-failed",
        message: "Process could not be started.",
      };
    case "timed-out":
      return {
        status: "failed",
        code: "process.timed-out",
        message: "Process exceeded its total time limit.",
      };
    case "idle-timed-out":
      return {
        status: "failed",
        code: "process.idle-timed-out",
        message: "Process exceeded its idle time limit.",
      };
    case "output-limit":
      return {
        status: "failed",
        code: "process.output-limit",
        message: "Process output exceeded its byte limit.",
      };
    case "cancelled":
      return {
        status: "cancelled",
        code: "process.cancelled",
        message: "Process execution was cancelled.",
      };
    case "termination-uncertain":
      return {
        status: "uncertain",
        code: "process.termination-uncertain",
        message: "Process termination could not be confirmed.",
      };
    default:
      if (signal !== null) {
        return {
          status: "failed",
          code: "process.signalled",
          message: "Process exited after receiving a signal.",
        };
      }
      return exitCode === 0
        ? {
            status: "passed",
            code: "process.exited-zero",
            message: "Process exited successfully.",
          }
        : {
            status: "failed",
            code: "process.exit-nonzero",
            message: "Process exited with a nonzero code.",
          };
  }
}

export function normalizeProcessResult(
  value: BoundedProcessResult,
): NormalizedProcessResult {
  const { result, output, termination, exitCode, signal } =
    validateProcessResult(value);
  const classified = classifyProcess(result, exitCode, signal);
  const timedOut =
    termination.reason === "timed-out" ||
    termination.reason === "idle-timed-out";
  const outer = Object.freeze({
    status: classified.status,
    ...(exitCode === null ? {} : { exitCode }),
    timedOut,
  });
  return Object.freeze({
    component: "process",
    ...classified,
    outer,
    mutationUncertain: result["mutationUncertain"] as boolean,
    outputTruncated: output.truncated,
    terminationConfirmed: termination.confirmed,
  });
}
