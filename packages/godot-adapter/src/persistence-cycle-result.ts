import { isProxy } from "node:util/types";

import {
  GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
  GODOT_PERSISTENCE_CYCLE_MAX_EVENTS,
  GODOT_PERSISTENCE_CYCLE_MAX_LINE_BYTES,
  GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
  GODOT_PERSISTENCE_CYCLE_MAX_SAVE_BYTES,
  GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  assertGodotPersistenceCycleExpectationSemantics,
  assertGodotPersistenceCycleTranscriptSemantics,
  computeGodotPersistenceCycleExpectationDigest,
  computeGodotPersistenceCycleTranscriptDigest,
  isSha256Digest,
  isStableId,
  sha256Digest,
  type GodotPersistenceCycleExpectation,
  type GodotPersistenceCyclePassedEvent,
  type GodotPersistenceCycleTranscript,
  type GodotPersistenceCycleTranscriptDigestInput,
  type GodotPersistenceLoadCompletedEvent,
  type GodotPersistenceLoadStartedEvent,
  type GodotPersistenceSaveCompletedEvent,
  type GodotPersistenceSaveStartedEvent,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";

import { GodotAdapterBoundaryError } from "./errors.js";

export { GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX };

export interface GodotPersistenceCycleExpectationInput {
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly freshStateHash: Sha256Digest;
  readonly persistedStateHash: Sha256Digest;
}

export type GodotPersistenceCycleOutputInvalidCode =
  | "godot-persistence-output-byte-limit"
  | "godot-persistence-output-event-count-invalid"
  | "godot-persistence-output-event-sequence-invalid"
  | "godot-persistence-output-event-shape-invalid"
  | "godot-persistence-output-framing-invalid"
  | "godot-persistence-output-identity-invalid"
  | "godot-persistence-output-json-invalid"
  | "godot-persistence-output-line-limit"
  | "godot-persistence-output-prefix-invalid"
  | "godot-persistence-output-save-identity-invalid"
  | "godot-persistence-output-state-invalid";

export interface ParsedGodotPersistenceCycleOutput {
  readonly status: "parsed";
  readonly transcript: GodotPersistenceCycleTranscript;
}

export interface InvalidGodotPersistenceCycleOutput {
  readonly status: "invalid";
  readonly code: GodotPersistenceCycleOutputInvalidCode;
}

export type GodotPersistenceCycleOutput =
  | InvalidGodotPersistenceCycleOutput
  | ParsedGodotPersistenceCycleOutput;

const jsonPrimitivePattern =
  /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/gy;

function fail(message: string): never {
  throw new GodotAdapterBoundaryError(
    "godot-persistence-expectation-invalid",
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

export function createGodotPersistenceCycleExpectation(
  value: GodotPersistenceCycleExpectationInput,
): GodotPersistenceCycleExpectation;
export function createGodotPersistenceCycleExpectation(
  value: unknown,
): GodotPersistenceCycleExpectation {
  const record = exactRecord(value, [
    "projectId",
    "sourceDigest",
    "freshStateHash",
    "persistedStateHash",
  ]);
  if (
    record === undefined ||
    !isStableId(record["projectId"]) ||
    !isSha256Digest(record["sourceDigest"]) ||
    !isSha256Digest(record["freshStateHash"]) ||
    !isSha256Digest(record["persistedStateHash"])
  ) {
    return fail(
      "Godot persistence cycle requires one exact project, source, fresh-state, and persisted-state identity.",
    );
  }
  const digestInput = {
    engine: "godot" as const,
    targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    projectId: record["projectId"],
    sourceDigest: record["sourceDigest"],
    saveSchemaVersion: "1.0.0" as const,
    freshStateHash: record["freshStateHash"],
    persistedStateHash: record["persistedStateHash"],
  };
  const expectation: GodotPersistenceCycleExpectation = deepFreeze({
    schemaVersion: "1.0.0" as const,
    ...digestInput,
    expectationDigest:
      computeGodotPersistenceCycleExpectationDigest(digestInput),
  });
  assertGodotPersistenceCycleExpectationSemantics(expectation);
  return expectation;
}

function invalid(
  code: GodotPersistenceCycleOutputInvalidCode,
): InvalidGodotPersistenceCycleOutput {
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

function eventKeys(event: unknown): readonly string[] | undefined {
  switch (event) {
    case "persistence-save-started":
      return ["event", "projectId", "sourceDigest", "freshStateHash"];
    case "persistence-save-completed":
      return [
        "event",
        "projectId",
        "sourceDigest",
        "stateHash",
        "saveDigest",
        "saveBytes",
        "userfsPersistent",
      ];
    case "persistence-load-started":
      return [
        "event",
        "projectId",
        "sourceDigest",
        "freshStateHash",
        "saveDigest",
        "saveBytes",
        "userfsPersistent",
      ];
    case "persistence-load-completed":
    case "persistence-cycle-passed":
      return [
        "event",
        "projectId",
        "sourceDigest",
        "stateHash",
        "saveDigest",
        "saveBytes",
      ];
    default:
      return undefined;
  }
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
  const event = Object.getOwnPropertyDescriptor(parsed, "event");
  const keys = event !== undefined && "value" in event
    ? eventKeys(event.value)
    : undefined;
  if (
    scanned === undefined ||
    scanned.next !== payload.length ||
    scanned.duplicate ||
    keys === undefined
  ) {
    return undefined;
  }
  return exactRecord(parsed, keys);
}

function identityMatches(
  record: Record<string, unknown>,
  expectation: GodotPersistenceCycleExpectation,
): boolean {
  return (
    record["projectId"] === expectation.projectId &&
    record["sourceDigest"] === expectation.sourceDigest
  );
}

function saveIdentity(
  record: Record<string, unknown>,
): { readonly saveDigest: Sha256Digest; readonly saveBytes: number } | undefined {
  if (
    !isSha256Digest(record["saveDigest"]) ||
    !Number.isSafeInteger(record["saveBytes"]) ||
    (record["saveBytes"] as number) < 1 ||
    (record["saveBytes"] as number) > GODOT_PERSISTENCE_CYCLE_MAX_SAVE_BYTES
  ) {
    return undefined;
  }
  return {
    saveDigest: record["saveDigest"],
    saveBytes: record["saveBytes"] as number,
  };
}

function parseEvents(
  events: readonly Record<string, unknown>[],
  expectation: GodotPersistenceCycleExpectation,
):
  | {
      readonly saveStarted: GodotPersistenceSaveStartedEvent;
      readonly saveCompleted: GodotPersistenceSaveCompletedEvent;
      readonly loadStarted: GodotPersistenceLoadStartedEvent;
      readonly loadCompleted: GodotPersistenceLoadCompletedEvent;
      readonly terminal: GodotPersistenceCyclePassedEvent;
    }
  | GodotPersistenceCycleOutputInvalidCode {
  if (
    events.some((event) => !identityMatches(event, expectation))
  ) {
    return "godot-persistence-output-identity-invalid";
  }
  const [saveStartedValue, saveCompletedValue, loadStartedValue, loadCompletedValue, terminalValue] = events;
  if (
    saveStartedValue === undefined ||
    saveCompletedValue === undefined ||
    loadStartedValue === undefined ||
    loadCompletedValue === undefined ||
    terminalValue === undefined
  ) {
    return "godot-persistence-output-event-count-invalid";
  }
  const save = saveIdentity(saveCompletedValue);
  const loadStartSave = saveIdentity(loadStartedValue);
  const loadSave = saveIdentity(loadCompletedValue);
  const terminalSave = saveIdentity(terminalValue);
  if (
    saveStartedValue["freshStateHash"] !== expectation.freshStateHash ||
    loadStartedValue["freshStateHash"] !== expectation.freshStateHash ||
    saveCompletedValue["stateHash"] !== expectation.persistedStateHash ||
    loadCompletedValue["stateHash"] !== expectation.persistedStateHash ||
    terminalValue["stateHash"] !== expectation.persistedStateHash
  ) {
    return "godot-persistence-output-state-invalid";
  }
  if (
    saveCompletedValue["userfsPersistent"] !== true ||
    loadStartedValue["userfsPersistent"] !== true ||
    save === undefined ||
    loadStartSave === undefined ||
    loadSave === undefined ||
    terminalSave === undefined ||
    loadStartSave.saveDigest !== save.saveDigest ||
    loadStartSave.saveBytes !== save.saveBytes ||
    loadSave.saveDigest !== save.saveDigest ||
    loadSave.saveBytes !== save.saveBytes ||
    terminalSave.saveDigest !== save.saveDigest ||
    terminalSave.saveBytes !== save.saveBytes
  ) {
    return "godot-persistence-output-save-identity-invalid";
  }
  const identity = {
    projectId: expectation.projectId,
    sourceDigest: expectation.sourceDigest,
  };
  return {
    saveStarted: {
      event: "persistence-save-started",
      ...identity,
      freshStateHash: expectation.freshStateHash,
    },
    saveCompleted: {
      event: "persistence-save-completed",
      ...identity,
      stateHash: expectation.persistedStateHash,
      ...save,
      userfsPersistent: true,
    },
    loadStarted: {
      event: "persistence-load-started",
      ...identity,
      freshStateHash: expectation.freshStateHash,
      ...save,
      userfsPersistent: true,
    },
    loadCompleted: {
      event: "persistence-load-completed",
      ...identity,
      stateHash: expectation.persistedStateHash,
      ...save,
    },
    terminal: {
      event: "persistence-cycle-passed",
      ...identity,
      stateHash: expectation.persistedStateHash,
      ...save,
    },
  };
}

export function parseGodotPersistenceCycleOutput(
  output: unknown,
  expectation: GodotPersistenceCycleExpectation,
): GodotPersistenceCycleOutput {
  try {
    assertGodotPersistenceCycleExpectationSemantics(expectation);
  } catch {
    return fail("Godot persistence cycle expectation is outside the contract.");
  }
  if (
    typeof output !== "string" ||
    Buffer.from(output, "utf8").toString("utf8") !== output
  ) {
    return invalid("godot-persistence-output-framing-invalid");
  }
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes > GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES) {
    return invalid("godot-persistence-output-byte-limit");
  }
  if (bytes === 0 || !output.endsWith("\n") || output.includes("\u0000")) {
    return invalid("godot-persistence-output-framing-invalid");
  }
  const withoutCrlf = output.replaceAll("\r\n", "");
  const lineEnding = output.includes("\r\n") ? "crlf" : "lf";
  if (
    withoutCrlf.includes("\r") ||
    (lineEnding === "crlf" && withoutCrlf.includes("\n")) ||
    (lineEnding === "lf" && output.includes("\r"))
  ) {
    return invalid("godot-persistence-output-framing-invalid");
  }
  const separator = lineEnding === "crlf" ? "\r\n" : "\n";
  const lines = output.split(separator);
  lines.pop();
  if (lines.length !== GODOT_PERSISTENCE_CYCLE_MAX_EVENTS) {
    return invalid("godot-persistence-output-event-count-invalid");
  }
  const events: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > GODOT_PERSISTENCE_CYCLE_MAX_LINE_BYTES) {
      return invalid("godot-persistence-output-line-limit");
    }
    if (!line.startsWith(GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX)) {
      return invalid("godot-persistence-output-prefix-invalid");
    }
    const event = parseJsonEvent(
      line.slice(GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX.length),
    );
    if (event === undefined) {
      return invalid("godot-persistence-output-json-invalid");
    }
    events.push(event);
  }
  const expectedSequence = [
    "persistence-save-started",
    "persistence-save-completed",
    "persistence-load-started",
    "persistence-load-completed",
    "persistence-cycle-passed",
  ];
  if (
    events.some((event, index) => event["event"] !== expectedSequence[index])
  ) {
    return invalid("godot-persistence-output-event-sequence-invalid");
  }
  const parsed = parseEvents(events, expectation);
  if (typeof parsed === "string") return invalid(parsed);

  const digestInput: GodotPersistenceCycleTranscriptDigestInput = {
    invocationDigest: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
    expectationDigest: expectation.expectationDigest,
    wire: {
      outputDigest: sha256Digest(output),
      bytes,
      eventCount: GODOT_PERSISTENCE_CYCLE_MAX_EVENTS,
      lineEnding,
    },
    ...parsed,
  };
  const transcript: GodotPersistenceCycleTranscript = deepFreeze({
    schemaVersion: "1.0.0" as const,
    ...digestInput,
    transcriptDigest:
      computeGodotPersistenceCycleTranscriptDigest(digestInput),
  });
  try {
    assertGodotPersistenceCycleTranscriptSemantics(transcript);
  } catch {
    return invalid("godot-persistence-output-event-shape-invalid");
  }
  return Object.freeze({ status: "parsed" as const, transcript });
}
