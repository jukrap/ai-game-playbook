import {
  GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
  GODOT_PROJECT_VALIDATION_MAX_EVENTS,
  GODOT_PROJECT_VALIDATION_MAX_LINE_BYTES,
  GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX,
  GODOT_PROJECT_VALIDATOR_SCRIPT,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  assertGodotProjectValidationExpectationSemantics,
  assertGodotProjectValidationTranscriptSemantics,
  computeGodotProjectValidationExpectationDigest,
  computeGodotProjectValidationTranscriptDigest,
  isPortableProjectPath,
  isSha256Digest,
  isStableId,
  sha256Digest,
  type GodotProjectValidationExpectation,
  type GodotProjectValidationFailedEvent,
  type GodotProjectValidationFailureCode,
  type GodotProjectValidationPassedEvent,
  type GodotProjectValidationStartedEvent,
  type GodotProjectValidationTerminalEvent,
  type GodotProjectValidationTranscript,
  type GodotProjectValidationTranscriptDigestInput,
  type PortableProjectPath,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import { isProxy } from "node:util/types";

import { GodotAdapterBoundaryError } from "./errors.js";

export { GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX };

export interface GodotProjectValidationExpectationInput {
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
}

export type GodotProjectValidationOutputInvalidCode =
  | "godot-project-validation-output-byte-limit"
  | "godot-project-validation-output-event-count-invalid"
  | "godot-project-validation-output-event-sequence-invalid"
  | "godot-project-validation-output-event-shape-invalid"
  | "godot-project-validation-output-framing-invalid"
  | "godot-project-validation-output-identity-invalid"
  | "godot-project-validation-output-json-invalid"
  | "godot-project-validation-output-line-limit"
  | "godot-project-validation-output-prefix-invalid";

export interface ParsedGodotProjectValidationOutput {
  readonly status: "parsed";
  readonly transcript: GodotProjectValidationTranscript;
}

export interface InvalidGodotProjectValidationOutput {
  readonly status: "invalid";
  readonly code: GodotProjectValidationOutputInvalidCode;
}

export type GodotProjectValidationOutput =
  | ParsedGodotProjectValidationOutput
  | InvalidGodotProjectValidationOutput;

const jsonPrimitivePattern =
  /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/gy;

function fail(message: string): never {
  throw new GodotAdapterBoundaryError(
    "godot-project-validation-expectation-invalid",
    message,
    false,
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return undefined;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createGodotProjectValidationExpectation(
  value: GodotProjectValidationExpectationInput,
): GodotProjectValidationExpectation;
export function createGodotProjectValidationExpectation(
  value: unknown,
): GodotProjectValidationExpectation {
  const record = exactRecord(value, ["projectId", "sourceDigest", "mainScene"]);
  if (
    record === undefined ||
    !isStableId(record["projectId"]) ||
    !isSha256Digest(record["sourceDigest"]) ||
    !isPortableProjectPath(record["mainScene"])
  ) {
    return fail(
      "Godot project validation requires one exact project, source, and main-scene identity.",
    );
  }
  const digestInput = {
    engine: "godot" as const,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    projectId: record["projectId"],
    sourceDigest: record["sourceDigest"],
    mainScene: record["mainScene"],
    validatorScript: GODOT_PROJECT_VALIDATOR_SCRIPT,
  };
  const expectation: GodotProjectValidationExpectation = deepFreeze({
    schemaVersion: "1.0.0" as const,
    ...digestInput,
    expectationDigest:
      computeGodotProjectValidationExpectationDigest(digestInput),
  });
  assertGodotProjectValidationExpectationSemantics(expectation);
  return expectation;
}

function invalid(
  code: GodotProjectValidationOutputInvalidCode,
): InvalidGodotProjectValidationOutput {
  return Object.freeze({ status: "invalid", code });
}

interface JsonScanResult {
  readonly next: number;
  readonly duplicate: boolean;
}

function scanJsonString(text: string, start: number): JsonScanResult | undefined {
  if (text[start] !== '"') return undefined;
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === '"') return { next: index + 1, duplicate: false };
    if (character === "\\") {
      index += 1;
      if (index >= text.length) return undefined;
      if (text[index] === "u") index += 4;
    }
    index += 1;
  }
  return undefined;
}

function scanJsonValue(
  text: string,
  start: number,
  depth: number,
): JsonScanResult | undefined {
  if (depth > 16 || start >= text.length) return undefined;
  const character = text[start];
  if (character === '"') return scanJsonString(text, start);
  if (character === "[") {
    let index = start + 1;
    let duplicate = false;
    if (text[index] === "]") return { next: index + 1, duplicate };
    while (index < text.length) {
      const child = scanJsonValue(text, index, depth + 1);
      if (child === undefined) return undefined;
      duplicate ||= child.duplicate;
      index = child.next;
      if (text[index] === "]") return { next: index + 1, duplicate };
      if (text[index] !== ",") return undefined;
      index += 1;
    }
    return undefined;
  }
  if (character === "{") {
    let index = start + 1;
    let duplicate = false;
    const keys = new Set<string>();
    if (text[index] === "}") return { next: index + 1, duplicate };
    while (index < text.length) {
      const key = scanJsonString(text, index);
      if (key === undefined || text[key.next] !== ":") return undefined;
      let decoded: unknown;
      try {
        decoded = JSON.parse(text.slice(index, key.next)) as unknown;
      } catch {
        return undefined;
      }
      if (typeof decoded !== "string") return undefined;
      if (keys.has(decoded)) duplicate = true;
      keys.add(decoded);
      const child = scanJsonValue(text, key.next + 1, depth + 1);
      if (child === undefined) return undefined;
      duplicate ||= child.duplicate;
      index = child.next;
      if (text[index] === "}") return { next: index + 1, duplicate };
      if (text[index] !== ",") return undefined;
      index += 1;
    }
    return undefined;
  }
  jsonPrimitivePattern.lastIndex = start;
  const primitive = jsonPrimitivePattern.exec(text);
  return primitive === null
    ? undefined
    : { next: jsonPrimitivePattern.lastIndex, duplicate: false };
}

function parseJsonEvent(payload: string): Record<string, unknown> | undefined {
  if (
    payload.length === 0 ||
    /[\t\n\r ]/u.test(payload.replace(/"(?:\\.|[^"\\])*"/gu, ""))
  ) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return undefined;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    isProxy(parsed)
  ) {
    return undefined;
  }
  const scanned = scanJsonValue(payload, 0, 0);
  if (
    scanned === undefined ||
    scanned.next !== payload.length ||
    scanned.duplicate
  ) {
    return undefined;
  }
  return exactRecord(
    parsed,
    Object.hasOwn(parsed, "code")
      ? ["event", "projectId", "sourceDigest", "mainScene", "code"]
      : Object.hasOwn(parsed, "resourceType")
        ? [
            "event",
            "projectId",
            "sourceDigest",
            "mainScene",
            "resourceType",
            "rootType",
          ]
        : ["event", "projectId", "sourceDigest", "mainScene"],
  );
}

function identityMatches(
  record: Record<string, unknown>,
  expectation: GodotProjectValidationExpectation,
): boolean {
  return (
    record["projectId"] === expectation.projectId &&
    record["sourceDigest"] === expectation.sourceDigest &&
    record["mainScene"] === expectation.mainScene
  );
}

function parseStarted(
  value: Record<string, unknown>,
  expectation: GodotProjectValidationExpectation,
): GodotProjectValidationStartedEvent | undefined {
  if (
    value["event"] !== "validation-started" ||
    !identityMatches(value, expectation)
  ) {
    return undefined;
  }
  return {
    event: "validation-started",
    projectId: expectation.projectId,
    sourceDigest: expectation.sourceDigest,
    mainScene: expectation.mainScene,
  };
}

function failureCode(value: unknown): value is GodotProjectValidationFailureCode {
  return (
    value === "main-scene-instantiate-failed" ||
    value === "main-scene-load-failed" ||
    value === "main-scene-missing" ||
    value === "main-scene-not-packed" ||
    value === "main-scene-path-invalid" ||
    value === "manifest-invalid" ||
    value === "manifest-missing" ||
    value === "project-identity-mismatch"
  );
}

function parseTerminal(
  value: Record<string, unknown>,
  expectation: GodotProjectValidationExpectation,
): GodotProjectValidationTerminalEvent | undefined {
  if (!identityMatches(value, expectation)) return undefined;
  if (value["event"] === "validation-passed") {
    if (
      value["resourceType"] !== "PackedScene" ||
      typeof value["rootType"] !== "string" ||
      value["rootType"].length < 1 ||
      value["rootType"].length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(value["rootType"])
    ) {
      return undefined;
    }
    const event: GodotProjectValidationPassedEvent = {
      event: "validation-passed",
      projectId: expectation.projectId,
      sourceDigest: expectation.sourceDigest,
      mainScene: expectation.mainScene,
      resourceType: "PackedScene",
      rootType: value["rootType"],
    };
    return event;
  }
  if (
    value["event"] !== "validation-failed" ||
    !failureCode(value["code"])
  ) {
    return undefined;
  }
  const event: GodotProjectValidationFailedEvent = {
    event: "validation-failed",
    projectId: expectation.projectId,
    sourceDigest: expectation.sourceDigest,
    mainScene: expectation.mainScene,
    code: value["code"],
  };
  return event;
}

export function parseGodotProjectValidationOutput(
  output: unknown,
  expectation: GodotProjectValidationExpectation,
): GodotProjectValidationOutput {
  try {
    assertGodotProjectValidationExpectationSemantics(expectation);
  } catch {
    return fail("Godot project validation expectation is outside the contract.");
  }
  if (
    typeof output !== "string" ||
    Buffer.from(output, "utf8").toString("utf8") !== output
  ) {
    return invalid("godot-project-validation-output-framing-invalid");
  }
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes > GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES) {
    return invalid("godot-project-validation-output-byte-limit");
  }
  if (bytes === 0 || !output.endsWith("\n") || output.includes("\u0000")) {
    return invalid("godot-project-validation-output-framing-invalid");
  }
  const withoutCrlf = output.replaceAll("\r\n", "");
  const lineEnding = output.includes("\r\n") ? "crlf" : "lf";
  if (
    withoutCrlf.includes("\r") ||
    (lineEnding === "crlf" && withoutCrlf.includes("\n")) ||
    (lineEnding === "lf" && output.includes("\r"))
  ) {
    return invalid("godot-project-validation-output-framing-invalid");
  }
  const separator = lineEnding === "crlf" ? "\r\n" : "\n";
  const lines = output.split(separator);
  lines.pop();
  if (lines.length !== GODOT_PROJECT_VALIDATION_MAX_EVENTS) {
    return invalid("godot-project-validation-output-event-count-invalid");
  }
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > GODOT_PROJECT_VALIDATION_MAX_LINE_BYTES) {
      return invalid("godot-project-validation-output-line-limit");
    }
    if (!line.startsWith(GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX)) {
      return invalid("godot-project-validation-output-prefix-invalid");
    }
    const event = parseJsonEvent(
      line.slice(GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX.length),
    );
    if (event === undefined) {
      return invalid("godot-project-validation-output-json-invalid");
    }
    events.push(event);
  }
  const first = events[0];
  const second = events[1];
  if (first === undefined || second === undefined) {
    return invalid("godot-project-validation-output-event-count-invalid");
  }
  if (
    first["event"] !== "validation-started" ||
    (second["event"] !== "validation-passed" &&
      second["event"] !== "validation-failed")
  ) {
    return invalid("godot-project-validation-output-event-sequence-invalid");
  }
  if (!identityMatches(first, expectation) || !identityMatches(second, expectation)) {
    return invalid("godot-project-validation-output-identity-invalid");
  }
  const started = parseStarted(first, expectation);
  const terminal = parseTerminal(second, expectation);
  if (started === undefined || terminal === undefined) {
    return invalid("godot-project-validation-output-event-shape-invalid");
  }
  const digestInput: GodotProjectValidationTranscriptDigestInput = {
    invocationDigest: GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
    expectationDigest: expectation.expectationDigest,
    wire: {
      outputDigest: sha256Digest(output),
      bytes,
      eventCount: GODOT_PROJECT_VALIDATION_MAX_EVENTS,
      lineEnding,
    },
    started,
    terminal,
  };
  const transcript: GodotProjectValidationTranscript = deepFreeze({
    schemaVersion: "1.0.0" as const,
    ...digestInput,
    transcriptDigest:
      computeGodotProjectValidationTranscriptDigest(digestInput),
  });
  try {
    assertGodotProjectValidationTranscriptSemantics(transcript);
  } catch {
    return invalid("godot-project-validation-output-event-shape-invalid");
  }
  return Object.freeze({ status: "parsed" as const, transcript });
}
