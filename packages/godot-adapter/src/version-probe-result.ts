import {
  parseSemanticVersion,
  sha256Digest,
  type SemanticVersion,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  normalizeProcessResult,
  type NormalizedProcessResult,
  type ProcessResultCode,
} from "@ai-game-playbook/evidence";
import type { BoundedProcessResult } from "@ai-game-playbook/core";

import { GODOT_STATUS_TARGET_VERSION } from "./status.js";

export const GODOT_VERSION_OUTPUT_MAX_BYTES: number = 512;
export const GODOT_VERSION_TARGET_RELEASE_STATUS = "stable" as const;

export type GodotVersionOutputInvalidCode =
  | "godot-version-output-byte-limit"
  | "godot-version-output-control-invalid"
  | "godot-version-output-format-invalid"
  | "godot-version-output-framing-invalid";

export interface ParsedGodotVersionOutput {
  readonly status: "parsed";
  readonly version: SemanticVersion;
  readonly releaseStatus: string;
  readonly qualifiers: readonly string[];
  readonly outputDigest: Sha256Digest;
  readonly exactTargetMatch: boolean;
}

export interface InvalidGodotVersionOutput {
  readonly status: "invalid";
  readonly code: GodotVersionOutputInvalidCode;
}

export type GodotVersionOutput =
  | ParsedGodotVersionOutput
  | InvalidGodotVersionOutput;

export type GodotVersionProbeStatus =
  | "cancelled"
  | "invalid-output"
  | "matched"
  | "mismatched"
  | "process-failed"
  | "uncertain";

export type GodotVersionProbeCode =
  | GodotVersionOutputInvalidCode
  | ProcessResultCode
  | "godot-version-diagnostic-output"
  | "godot-version-target-match"
  | "godot-version-target-mismatch";

export interface GodotVersionProbeOutputAttestation {
  readonly stdoutDigest: Sha256Digest;
  readonly stderrDigest: Sha256Digest;
  readonly stdoutObservedBytes: number;
  readonly stderrObservedBytes: number;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface GodotVersionProbeResult {
  readonly status: GodotVersionProbeStatus;
  readonly code: GodotVersionProbeCode;
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_TARGET_RELEASE_STATUS;
  readonly process: NormalizedProcessResult;
  readonly output: GodotVersionProbeOutputAttestation;
  readonly version?: ParsedGodotVersionOutput;
}

const numberPart = "(?:0|[1-9][0-9]{0,5})";
const versionLinePattern = new RegExp(
  `^(${numberPart})\\.(${numberPart})(?:\\.(${numberPart}))?\\.` +
    "([a-z][a-z0-9_]{0,31})" +
    "((?:\\.[a-z0-9_+-]{1,64}){1,16})$",
  "u",
);
const controlCharacterPattern = /[\u0000-\u001f\u007f]/u;

function invalid(code: GodotVersionOutputInvalidCode): InvalidGodotVersionOutput {
  return Object.freeze({ status: "invalid", code });
}

export function parseGodotVersionOutput(value: unknown): GodotVersionOutput {
  if (
    typeof value !== "string" ||
    value.length > GODOT_VERSION_OUTPUT_MAX_BYTES ||
    Buffer.byteLength(value, "utf8") > GODOT_VERSION_OUTPUT_MAX_BYTES
  ) {
    return invalid(
      typeof value === "string"
        ? "godot-version-output-byte-limit"
        : "godot-version-output-format-invalid",
    );
  }
  if (!value.endsWith("\n")) {
    return invalid("godot-version-output-framing-invalid");
  }
  const line = value.endsWith("\r\n") ? value.slice(0, -2) : value.slice(0, -1);
  if (line.includes("\n") || line.includes("\r")) {
    return invalid("godot-version-output-framing-invalid");
  }
  if (controlCharacterPattern.test(line)) {
    return invalid("godot-version-output-control-invalid");
  }
  const match = versionLinePattern.exec(line);
  if (match === null) {
    return invalid("godot-version-output-format-invalid");
  }
  const major = match[1];
  const minor = match[2];
  const patch = match[3] ?? "0";
  const releaseStatus = match[4];
  const suffix = match[5];
  if (
    major === undefined ||
    minor === undefined ||
    releaseStatus === undefined ||
    suffix === undefined
  ) {
    return invalid("godot-version-output-format-invalid");
  }
  const version = parseSemanticVersion(`${major}.${minor}.${patch}`).value;
  const qualifiers = Object.freeze(suffix.slice(1).split("."));
  return Object.freeze({
    status: "parsed",
    version,
    releaseStatus,
    qualifiers,
    outputDigest: sha256Digest(value),
    exactTargetMatch:
      version === GODOT_STATUS_TARGET_VERSION &&
      releaseStatus === GODOT_VERSION_TARGET_RELEASE_STATUS,
  });
}

function outputAttestation(
  result: BoundedProcessResult,
): GodotVersionProbeOutputAttestation {
  return Object.freeze({
    stdoutDigest: result.output.stdoutDigest,
    stderrDigest: result.output.stderrDigest,
    stdoutObservedBytes: result.output.stdoutObservedBytes,
    stderrObservedBytes: result.output.stderrObservedBytes,
    capturedBytes: result.output.capturedBytes,
    observedBytes: result.output.observedBytes,
    truncated: result.output.truncated,
  });
}

function classified(
  status: GodotVersionProbeStatus,
  code: GodotVersionProbeCode,
  process: NormalizedProcessResult,
  output: GodotVersionProbeOutputAttestation,
  version?: ParsedGodotVersionOutput,
): GodotVersionProbeResult {
  return Object.freeze({
    status,
    code,
    targetVersion: GODOT_STATUS_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_TARGET_RELEASE_STATUS,
    process,
    output,
    ...(version === undefined ? {} : { version }),
  });
}

export function classifyGodotVersionProbeResult(
  result: BoundedProcessResult,
): GodotVersionProbeResult {
  const process = normalizeProcessResult(result);
  const output = outputAttestation(result);
  if (process.status === "cancelled") {
    return classified("cancelled", process.code, process, output);
  }
  if (process.status === "uncertain") {
    return classified("uncertain", process.code, process, output);
  }
  if (process.status !== "passed") {
    return classified("process-failed", process.code, process, output);
  }
  if (result.output.stderrObservedBytes !== 0) {
    return classified(
      "invalid-output",
      "godot-version-diagnostic-output",
      process,
      output,
    );
  }
  const version = parseGodotVersionOutput(result.output.stdout);
  if (version.status === "invalid") {
    return classified("invalid-output", version.code, process, output);
  }
  return classified(
    version.exactTargetMatch ? "matched" : "mismatched",
    version.exactTargetMatch
      ? "godot-version-target-match"
      : "godot-version-target-mismatch",
    process,
    output,
    version,
  );
}
