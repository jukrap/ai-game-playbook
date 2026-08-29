import {
  GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
  GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
  GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
  assertGodotDeterministicReplayTranscriptSemantics,
  checkPlaytestScenarioSemantics,
  computeGodotDeterministicReplayStateHash,
  computeGodotDeterministicReplayTranscriptDigest,
  computePlaytestScenarioDigest,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  playtestScenarioSchema,
  sha256Digest,
  type GodotDeterministicReplayFailedEvent,
  type GodotDeterministicReplayFailureCode,
  type GodotDeterministicReplayOracleEvent,
  type GodotDeterministicReplayStartedEvent,
  type GodotDeterministicReplayStateEntry,
  type GodotDeterministicReplayTerminalEvent,
  type GodotDeterministicReplayTranscript,
  type PlaytestScenario,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import type { BoundedProcessResult } from "@ai-game-playbook/core";
import {
  normalizeProcessResult,
  type NormalizedProcessResult,
  type ProcessResultCode,
} from "@ai-game-playbook/evidence";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

import { GodotAdapterBoundaryError } from "./errors.js";

export { GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX };

export interface GodotDeterministicReplayOracleExpectation {
  readonly oracleId: StableId;
  readonly terminal: boolean;
  readonly timing:
    | { readonly kind: "at-tick"; readonly tick: number }
    | {
        readonly kind: "within-ticks";
        readonly firstTick: number;
        readonly lastTick: number;
      };
  readonly stateHashFields: readonly StableId[];
}

export interface GodotDeterministicReplayInputExpectation {
  readonly sequence: number;
  readonly tick: number;
}

export interface GodotDeterministicReplayExpectation {
  readonly schemaVersion: "1.0.0";
  readonly scenarioId: StableId;
  readonly scenarioDigest: Sha256Digest;
  readonly seed: string;
  readonly maximumTicks: number;
  readonly maximumOutputBytes: number;
  readonly inputs: readonly GodotDeterministicReplayInputExpectation[];
  readonly oracles: readonly GodotDeterministicReplayOracleExpectation[];
  readonly expectationDigest: Sha256Digest;
}

export type GodotDeterministicReplayOutputInvalidCode =
  | "godot-replay-output-byte-limit"
  | "godot-replay-output-control-invalid"
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

export interface ParsedGodotDeterministicReplayOutput {
  readonly status: "parsed";
  readonly transcript: GodotDeterministicReplayTranscript;
}

export interface InvalidGodotDeterministicReplayOutput {
  readonly status: "invalid";
  readonly code: GodotDeterministicReplayOutputInvalidCode;
}

export type GodotDeterministicReplayOutput =
  | ParsedGodotDeterministicReplayOutput
  | InvalidGodotDeterministicReplayOutput;

export type GodotDeterministicReplayResultStatus =
  | "cancelled"
  | "invalid-output"
  | "process-failed"
  | "replay-failed"
  | "replay-passed"
  | "uncertain";

export type GodotDeterministicReplayResultCode =
  | GodotDeterministicReplayOutputInvalidCode
  | ProcessResultCode
  | "godot-replay-diagnostic-output"
  | "godot-replay-exit-outcome-mismatch"
  | "godot-replay-passed"
  | `godot-replay-${GodotDeterministicReplayFailureCode}`;

export interface GodotDeterministicReplayOutputAttestation {
  readonly stdoutDigest: Sha256Digest;
  readonly stderrDigest: Sha256Digest;
  readonly stdoutObservedBytes: number;
  readonly stderrObservedBytes: number;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface GodotDeterministicReplayResult {
  readonly status: GodotDeterministicReplayResultStatus;
  readonly code: GodotDeterministicReplayResultCode;
  readonly expectationDigest: Sha256Digest;
  readonly invocationDigest: typeof GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST;
  readonly process: NormalizedProcessResult;
  readonly output: GodotDeterministicReplayOutputAttestation;
  readonly transcript?: GodotDeterministicReplayTranscript;
}

const expectations = new WeakSet<object>();
const disallowedOutputControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const jsonPrimitivePattern =
  /(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/uy;

function fail(code: string, message: string): never {
  throw new GodotAdapterBoundaryError(code, message, false);
}

function assertExpectation(
  value: GodotDeterministicReplayExpectation,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    !expectations.has(value)
  ) {
    fail(
      "godot-replay-expectation-invalid",
      "Godot replay expectation must be created from a registered playtest scenario.",
    );
  }
}

function freezeExpectation(
  value: Omit<GodotDeterministicReplayExpectation, "expectationDigest">,
): GodotDeterministicReplayExpectation {
  const digestInput = {
    scenarioId: value.scenarioId,
    scenarioDigest: value.scenarioDigest,
    seed: value.seed,
    maximumTicks: value.maximumTicks,
    maximumOutputBytes: value.maximumOutputBytes,
    inputs: value.inputs,
    oracles: value.oracles,
  };
  const result = Object.freeze({
    ...value,
    expectationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-deterministic-replay-expectation",
      version: "1.0.0",
      expectation: digestInput,
    }),
  });
  expectations.add(result);
  return result;
}

export function createGodotDeterministicReplayExpectation(
  value: unknown,
): GodotDeterministicReplayExpectation {
  let scenario: PlaytestScenario;
  try {
    scenario = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: playtestScenarioSchema.schemaId,
        digest: playtestScenarioSchema.digest,
      },
      value,
    ) as unknown as PlaytestScenario;
  } catch {
    return fail(
      "godot-replay-scenario-invalid",
      "Godot replay scenario must satisfy the registered bounded contract.",
    );
  }
  if (checkPlaytestScenarioSemantics(scenario).length !== 0) {
    return fail(
      "godot-replay-scenario-invalid",
      "Godot replay scenario has invalid deterministic semantics.",
    );
  }

  const inputs = Object.freeze(
    scenario.inputs.map((input) =>
      Object.freeze({ sequence: input.sequence, tick: input.tick }),
    ),
  );
  const oracles = Object.freeze(
    [
      ...scenario.checkpoints.map((oracle) => ({ oracle, terminal: false })),
      ...scenario.terminal.map((oracle) => ({ oracle, terminal: true })),
    ].map(({ oracle, terminal }) =>
      Object.freeze({
        oracleId: oracle.oracleId,
        terminal,
        timing:
          oracle.atTick === undefined
            ? Object.freeze({
                kind: "within-ticks" as const,
                firstTick: oracle.withinTicks?.firstTick ?? 0,
                lastTick: oracle.withinTicks?.lastTick ?? 0,
              })
            : Object.freeze({
                kind: "at-tick" as const,
                tick: oracle.atTick,
              }),
        stateHashFields: Object.freeze([...oracle.stateHashFields]),
      }),
    ),
  );
  return freezeExpectation({
    schemaVersion: "1.0.0",
    scenarioId: scenario.scenarioId,
    scenarioDigest: computePlaytestScenarioDigest(scenario),
    seed: scenario.initialState.seed,
    maximumTicks: scenario.clock.maximumTicks,
    maximumOutputBytes: Math.min(
      scenario.budgets.outputBytes,
      GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
    ),
    inputs,
    oracles,
  });
}

function invalid(
  code: GodotDeterministicReplayOutputInvalidCode,
): InvalidGodotDeterministicReplayOutput {
  return Object.freeze({ status: "invalid", code });
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return undefined;
  }
  const names = Object.getOwnPropertyNames(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((name) => !names.includes(name)) ||
    names.some((name) => !allowed.has(name))
  ) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result[name] = descriptor.value;
  }
  return result;
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
  if (depth > 32 || start >= text.length) return undefined;
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
  if (payload.length === 0 || /[\t\n\r ]/u.test(payload.replace(/"(?:\\.|[^"\\])*"/gu, ""))) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
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
  return exactRecord(parsed, ["event"], [
    "code",
    "oracleId",
    "scenarioDigest",
    "scenarioId",
    "seed",
    "sequence",
    "state",
    "stateHash",
    "terminal",
    "tick",
  ]);
}

function parseStarted(
  value: Record<string, unknown>,
  expectation: GodotDeterministicReplayExpectation,
): GodotDeterministicReplayStartedEvent | undefined {
  const record = exactRecord(value, [
    "event",
    "scenarioId",
    "scenarioDigest",
    "seed",
  ]);
  if (
    record === undefined ||
    record["event"] !== "replay-started" ||
    record["scenarioId"] !== expectation.scenarioId ||
    record["scenarioDigest"] !== expectation.scenarioDigest ||
    record["seed"] !== expectation.seed
  ) {
    return undefined;
  }
  return {
    event: "replay-started",
    scenarioId: expectation.scenarioId,
    scenarioDigest: expectation.scenarioDigest,
    seed: expectation.seed,
  };
}

function parseState(
  value: unknown,
  fields: readonly StableId[],
): readonly GodotDeterministicReplayStateEntry[] | undefined {
  if (!Array.isArray(value) || value.length !== fields.length) return undefined;
  const state: GodotDeterministicReplayStateEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const entry = exactRecord(value[index], ["path", "value"]);
    const path = fields[index];
    if (entry === undefined || path === undefined || entry["path"] !== path) {
      return undefined;
    }
    const stateValue = entry["value"];
    if (
      !(
        stateValue === null ||
        typeof stateValue === "boolean" ||
        (typeof stateValue === "number" &&
          Number.isSafeInteger(stateValue) &&
          !Object.is(stateValue, -0)) ||
        (typeof stateValue === "string" &&
          stateValue.length <= 500 &&
          !/[\u0000-\u001f\u007f]/u.test(stateValue) &&
          Buffer.from(stateValue, "utf8").toString("utf8") === stateValue)
      )
    ) {
      return undefined;
    }
    state.push({ path, value: stateValue });
  }
  return state;
}

function timingMatches(
  tick: number,
  expectation: GodotDeterministicReplayOracleExpectation,
): boolean {
  return expectation.timing.kind === "at-tick"
    ? tick === expectation.timing.tick
    : tick >= expectation.timing.firstTick &&
        tick <= expectation.timing.lastTick;
}

function parseOracle(
  value: Record<string, unknown>,
  expected: GodotDeterministicReplayOracleExpectation,
):
  | GodotDeterministicReplayOracleEvent
  | GodotDeterministicReplayOutputInvalidCode {
  const record = exactRecord(value, [
    "event",
    "oracleId",
    "terminal",
    "tick",
    "state",
    "stateHash",
  ]);
  if (
    record === undefined ||
    record["event"] !== "oracle-passed" ||
    record["oracleId"] !== expected.oracleId ||
    record["terminal"] !== expected.terminal ||
    !Number.isSafeInteger(record["tick"])
  ) {
    return "godot-replay-output-event-shape-invalid";
  }
  const observedTick = record["tick"] as number;
  if (!timingMatches(observedTick, expected)) {
    return "godot-replay-output-oracle-timing-invalid";
  }
  const state = parseState(record["state"], expected.stateHashFields);
  if (state === undefined) {
    return "godot-replay-output-oracle-state-invalid";
  }
  if (
    !isSha256Digest(record["stateHash"]) ||
    computeGodotDeterministicReplayStateHash(state) !== record["stateHash"]
  ) {
    return "godot-replay-output-state-hash-invalid";
  }
  return {
    event: "oracle-passed",
    oracleId: expected.oracleId,
    terminal: expected.terminal,
    tick: observedTick,
    state,
    stateHash: record["stateHash"],
  };
}

function parseTerminal(
  value: Record<string, unknown>,
  expectation: GodotDeterministicReplayExpectation,
): GodotDeterministicReplayTerminalEvent | undefined {
  const event = value["event"];
  if (event === "replay-passed") {
    const record = exactRecord(value, ["event", "tick", "scenarioDigest"]);
    if (
      record === undefined ||
      !Number.isSafeInteger(record["tick"]) ||
      record["scenarioDigest"] !== expectation.scenarioDigest
    ) {
      return undefined;
    }
    return {
      event,
      tick: record["tick"] as number,
      scenarioDigest: expectation.scenarioDigest,
    };
  }
  const record = exactRecord(
    value,
    ["event", "code", "tick", "scenarioDigest"],
    ["oracleId", "sequence"],
  );
  if (
    record === undefined ||
    event !== "replay-failed" ||
    !Number.isSafeInteger(record["tick"]) ||
    record["scenarioDigest"] !== expectation.scenarioDigest
  ) {
    return undefined;
  }
  const code = record["code"];
  if (
    code !== "checkpoint-incomplete" &&
    code !== "input-missed" &&
    code !== "maximum-ticks-reached" &&
    code !== "oracle-failed" &&
    code !== "oracle-window-expired"
  ) {
    return undefined;
  }
  const oracleFailure = code === "oracle-failed" || code === "oracle-window-expired";
  const inputFailure = code === "input-missed";
  if (
    (oracleFailure && !isStableId(record["oracleId"])) ||
    (!oracleFailure && Object.hasOwn(record, "oracleId")) ||
    (inputFailure && !Number.isSafeInteger(record["sequence"])) ||
    (!inputFailure && Object.hasOwn(record, "sequence"))
  ) {
    return undefined;
  }
  return {
    event,
    code,
    tick: record["tick"] as number,
    scenarioDigest: expectation.scenarioDigest,
    ...(oracleFailure ? { oracleId: record["oracleId"] as StableId } : {}),
    ...(inputFailure ? { sequence: record["sequence"] as number } : {}),
  };
}

function failureMatches(
  terminal: GodotDeterministicReplayFailedEvent,
  expectation: GodotDeterministicReplayExpectation,
  passed: ReadonlySet<StableId>,
  observed: readonly GodotDeterministicReplayOracleEvent[],
): boolean {
  const nextOracle =
    terminal.oracleId === undefined
      ? undefined
      : expectation.oracles.find(
          ({ oracleId }) => oracleId === terminal.oracleId,
        );
  const targetOrder =
    nextOracle === undefined ? -1 : expectation.oracles.indexOf(nextOracle);
  const deadline = (
    oracle: GodotDeterministicReplayOracleExpectation,
  ): number =>
    oracle.timing.kind === "at-tick"
      ? oracle.timing.tick
      : oracle.timing.lastTick;
  const requiredBeforeFailure = expectation.oracles.every(
    (oracle, index) =>
      passed.has(oracle.oracleId) ||
      deadline(oracle) > terminal.tick ||
      (deadline(oracle) === terminal.tick &&
        targetOrder >= 0 &&
        index >= targetOrder),
  );
  switch (terminal.code) {
    case "input-missed": {
      const input = expectation.inputs[terminal.sequence ?? -1];
      return (
        input !== undefined &&
        terminal.tick === input.tick + 1 &&
        expectation.oracles.every(
          (oracle) =>
            passed.has(oracle.oracleId) || deadline(oracle) >= terminal.tick,
        )
      );
    }
    case "oracle-failed":
      return (
        requiredBeforeFailure &&
        nextOracle !== undefined &&
        !passed.has(nextOracle.oracleId) &&
        nextOracle.timing.kind === "at-tick" &&
        terminal.tick === nextOracle.timing.tick
      );
    case "oracle-window-expired":
      return (
        requiredBeforeFailure &&
        nextOracle !== undefined &&
        !passed.has(nextOracle.oracleId) &&
        nextOracle.timing.kind === "within-ticks" &&
        terminal.tick === nextOracle.timing.lastTick
      );
    case "maximum-ticks-reached":
      // Registered scenarios require terminal oracles whose deadlines are all
      // inside the maximum tick. A specific oracle or completion result wins.
      return false;
    case "checkpoint-incomplete": {
      const terminalTicks = observed
        .filter(({ terminal: isTerminal }) => isTerminal)
        .map(({ tick }) => tick);
      return (
        terminalTicks.length > 0 &&
        terminal.tick === Math.max(...terminalTicks) &&
        expectation.oracles
          .filter(({ terminal: isTerminal }) => isTerminal)
          .every(({ oracleId }) => passed.has(oracleId)) &&
        expectation.oracles
          .filter(({ terminal: isTerminal }) => !isTerminal)
          .some(({ oracleId }) => !passed.has(oracleId)) &&
        expectation.oracles
          .filter(({ terminal: isTerminal }) => !isTerminal)
          .every(
            (oracle) =>
              passed.has(oracle.oracleId) || deadline(oracle) > terminal.tick,
          )
      );
    }
    default:
      return false;
  }
}

function outputLines(
  value: unknown,
  expectation: GodotDeterministicReplayExpectation,
):
  | {
      readonly lines: readonly string[];
      readonly lineEnding: "crlf" | "lf";
      readonly bytes: number;
      readonly outputDigest: Sha256Digest;
    }
  | GodotDeterministicReplayOutputInvalidCode {
  if (typeof value !== "string") {
    return "godot-replay-output-framing-invalid";
  }
  if (value.length > expectation.maximumOutputBytes) {
    return "godot-replay-output-byte-limit";
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > expectation.maximumOutputBytes) {
    return "godot-replay-output-byte-limit";
  }
  if (
    value.length === 0 ||
    !value.endsWith("\n") ||
    value.startsWith("\uFEFF")
  ) {
    return "godot-replay-output-framing-invalid";
  }
  if (disallowedOutputControls.test(value)) {
    return "godot-replay-output-control-invalid";
  }
  const hasCrlf = value.includes("\r\n");
  if (
    value.includes("\r") &&
    (!hasCrlf || value.replaceAll("\r\n", "").includes("\r"))
  ) {
    return "godot-replay-output-framing-invalid";
  }
  if (hasCrlf && value.replaceAll("\r\n", "").includes("\n")) {
    return "godot-replay-output-framing-invalid";
  }
  const normalized = hasCrlf ? value.replaceAll("\r\n", "\n") : value;
  const lines = normalized.slice(0, -1).split("\n");
  if (lines.length > GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS) {
    return "godot-replay-output-line-limit";
  }
  if (
    lines.some(
      (line) =>
        line.length === 0 ||
        Buffer.byteLength(line, "utf8") >
          GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
    )
  ) {
    return "godot-replay-output-line-limit";
  }
  return {
    lines,
    lineEnding: hasCrlf ? "crlf" : "lf",
    bytes,
    outputDigest: sha256Digest(value),
  };
}

export function parseGodotDeterministicReplayOutput(
  value: unknown,
  expectation: GodotDeterministicReplayExpectation,
): GodotDeterministicReplayOutput {
  assertExpectation(expectation);
  const framed = outputLines(value, expectation);
  if (typeof framed === "string") {
    return invalid(framed as GodotDeterministicReplayOutputInvalidCode);
  }
  const events: Record<string, unknown>[] = [];
  for (const line of framed.lines) {
    if (!line.startsWith(GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX)) {
      return invalid("godot-replay-output-prefix-invalid");
    }
    const event = parseJsonEvent(
      line.slice(GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX.length),
    );
    if (event === undefined) {
      return invalid("godot-replay-output-json-invalid");
    }
    events.push(event);
  }
  if (events.length < 2) {
    return invalid("godot-replay-output-event-sequence-invalid");
  }
  const first = events[0];
  const last = events.at(-1);
  if (first === undefined || last === undefined) {
    return invalid("godot-replay-output-event-sequence-invalid");
  }
  const started = parseStarted(first, expectation);
  if (started === undefined) {
    return invalid("godot-replay-output-scenario-mismatch");
  }
  const terminal = parseTerminal(last, expectation);
  if (terminal === undefined) {
    return invalid("godot-replay-output-terminal-invalid");
  }

  const expectedById = new Map(
    expectation.oracles.map((oracle) => [oracle.oracleId, oracle]),
  );
  const orderById = new Map(
    expectation.oracles.map((oracle, index) => [oracle.oracleId, index]),
  );
  const passed = new Set<StableId>();
  const oracles: GodotDeterministicReplayOracleEvent[] = [];
  let previousTick = -1;
  let previousOrder = -1;
  for (const event of events.slice(1, -1)) {
    if (event["event"] !== "oracle-passed" || !isStableId(event["oracleId"])) {
      return invalid("godot-replay-output-event-sequence-invalid");
    }
    const expected = expectedById.get(event["oracleId"]);
    if (expected === undefined || passed.has(expected.oracleId)) {
      return invalid("godot-replay-output-oracle-set-invalid");
    }
    const parsed = parseOracle(event, expected);
    if (typeof parsed === "string") return invalid(parsed);
    const observedOrder = orderById.get(parsed.oracleId);
    if (
      observedOrder === undefined ||
      parsed.tick < previousTick ||
      (parsed.tick === previousTick && observedOrder <= previousOrder)
    ) {
      return invalid("godot-replay-output-event-sequence-invalid");
    }
    previousTick = parsed.tick;
    previousOrder = observedOrder;
    passed.add(parsed.oracleId);
    oracles.push(parsed);
  }
  if (terminal.tick < previousTick || terminal.tick > expectation.maximumTicks) {
    return invalid("godot-replay-output-terminal-invalid");
  }
  if (terminal.event === "replay-passed") {
    if (
      passed.size !== expectation.oracles.length ||
      expectation.oracles.some(({ oracleId }) => !passed.has(oracleId))
    ) {
      return invalid("godot-replay-output-oracle-set-invalid");
    }
    const terminalTicks = oracles
      .filter(({ terminal: isTerminal }) => isTerminal)
      .map(({ tick }) => tick);
    if (
      terminalTicks.length === 0 ||
      terminal.tick !== Math.max(...terminalTicks)
    ) {
      return invalid("godot-replay-output-terminal-invalid");
    }
  } else if (!failureMatches(terminal, expectation, passed, oracles)) {
    return invalid("godot-replay-output-terminal-invalid");
  }

  const digestInput = {
    invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    expectationDigest: expectation.expectationDigest,
    wire: {
      outputDigest: framed.outputDigest,
      bytes: framed.bytes,
      eventCount: events.length,
      lineEnding: framed.lineEnding,
    },
    started,
    oracles,
    terminal,
  };
  const transcript: GodotDeterministicReplayTranscript = {
    schemaVersion: "1.0.0",
    ...digestInput,
    transcriptDigest:
      computeGodotDeterministicReplayTranscriptDigest(digestInput),
  };
  try {
    assertGodotDeterministicReplayTranscriptSemantics(transcript);
  } catch {
    return invalid("godot-replay-output-event-shape-invalid");
  }
  Object.freeze(transcript.started);
  Object.freeze(transcript.wire);
  for (const oracle of transcript.oracles) {
    for (const state of oracle.state) Object.freeze(state);
    Object.freeze(oracle.state);
    Object.freeze(oracle);
  }
  Object.freeze(transcript.oracles);
  Object.freeze(transcript.terminal);
  Object.freeze(transcript);
  return Object.freeze({ status: "parsed", transcript });
}

function outputAttestation(
  result: BoundedProcessResult,
): GodotDeterministicReplayOutputAttestation {
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
  status: GodotDeterministicReplayResultStatus,
  code: GodotDeterministicReplayResultCode,
  expectation: GodotDeterministicReplayExpectation,
  process: NormalizedProcessResult,
  output: GodotDeterministicReplayOutputAttestation,
  transcript?: GodotDeterministicReplayTranscript,
): GodotDeterministicReplayResult {
  return Object.freeze({
    status,
    code,
    expectationDigest: expectation.expectationDigest,
    invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    process,
    output,
    ...(transcript === undefined ? {} : { transcript }),
  });
}

export function classifyGodotDeterministicReplayResult(
  result: BoundedProcessResult,
  expectation: GodotDeterministicReplayExpectation,
): GodotDeterministicReplayResult {
  assertExpectation(expectation);
  const process = normalizeProcessResult(result);
  const output = outputAttestation(result);
  if (process.status === "cancelled") {
    return classified("cancelled", process.code, expectation, process, output);
  }
  if (process.status === "uncertain") {
    return classified("uncertain", process.code, expectation, process, output);
  }
  const exitCode = process.outer.exitCode;
  const cleanBehaviorFailure =
    result.outcome === "exited" && exitCode === 2;
  if (process.status !== "passed" && !cleanBehaviorFailure) {
    return classified(
      "process-failed",
      process.code,
      expectation,
      process,
      output,
    );
  }
  if (result.output.stderrObservedBytes !== 0) {
    return classified(
      "invalid-output",
      "godot-replay-diagnostic-output",
      expectation,
      process,
      output,
    );
  }
  const parsed = parseGodotDeterministicReplayOutput(
    result.output.stdout,
    expectation,
  );
  if (parsed.status === "invalid") {
    return classified(
      "invalid-output",
      parsed.code,
      expectation,
      process,
      output,
    );
  }
  const passed = parsed.transcript.terminal.event === "replay-passed";
  if ((exitCode === 0) !== passed) {
    return classified(
      "invalid-output",
      "godot-replay-exit-outcome-mismatch",
      expectation,
      process,
      output,
      parsed.transcript,
    );
  }
  if (passed) {
    return classified(
      "replay-passed",
      "godot-replay-passed",
      expectation,
      process,
      output,
      parsed.transcript,
    );
  }
  const terminal = parsed.transcript.terminal as GodotDeterministicReplayFailedEvent;
  return classified(
    "replay-failed",
    `godot-replay-${terminal.code}`,
    expectation,
    process,
    output,
    parsed.transcript,
  );
}
