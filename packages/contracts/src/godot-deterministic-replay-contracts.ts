import { isProxy } from "node:util/types";

import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  sha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  PLAYTEST_SCENARIO_MAX_INPUTS,
  PLAYTEST_SCENARIO_MAX_ORACLES,
  PLAYTEST_SCENARIO_MAX_TICKS,
} from "./playtest-scenario-contracts.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX =
  "AGPB_GRAYBOX " as const;
export const GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES = 65_536;
export const GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES = 1_048_576;
export const GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS: number =
  PLAYTEST_SCENARIO_MAX_ORACLES * 2 + 2;
export const GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS = 30_000;
export const GODOT_DETERMINISTIC_REPLAY_IDLE_TIMEOUT_MS = 15_000;
export const GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS = 2_000;

const invocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  arguments: Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--log-file",
    "$profileLocalLog",
    "--no-header",
    "--",
    "--agpb-replay",
  ]),
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
  networkCapabilities: "none" as const,
  projectSource: "disposable-copy" as const,
  processTimeoutMs: GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS,
  idleTimeoutMs: GODOT_DETERMINISTIC_REPLAY_IDLE_TIMEOUT_MS,
  terminationGraceMs: GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS,
  maxOutputBytes: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  maxLineBytes: GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
  maxEvents: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
  outputPrefix: GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
});

export const GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-deterministic-replay-invocation",
    version: "1.0.0",
    ...invocationSubject,
  });

export type GodotDeterministicReplayStateValue =
  | null
  | boolean
  | number
  | string;

export interface GodotDeterministicReplayStateEntry {
  readonly path: StableId;
  readonly value: GodotDeterministicReplayStateValue;
}

export interface GodotDeterministicReplayStartedEvent {
  readonly event: "replay-started";
  readonly scenarioId: StableId;
  readonly scenarioDigest: Sha256Digest;
  readonly seed: string;
}

export interface GodotDeterministicReplayOracleEvent {
  readonly event: "oracle-passed";
  readonly oracleId: StableId;
  readonly terminal: boolean;
  readonly tick: number;
  readonly state: readonly GodotDeterministicReplayStateEntry[];
  readonly stateHash: Sha256Digest;
}

export type GodotDeterministicReplayFailureCode =
  | "checkpoint-incomplete"
  | "input-missed"
  | "maximum-ticks-reached"
  | "oracle-failed"
  | "oracle-window-expired";

export interface GodotDeterministicReplayPassedEvent {
  readonly event: "replay-passed";
  readonly tick: number;
  readonly scenarioDigest: Sha256Digest;
}

export interface GodotDeterministicReplayFailedEvent {
  readonly event: "replay-failed";
  readonly code: GodotDeterministicReplayFailureCode;
  readonly tick: number;
  readonly scenarioDigest: Sha256Digest;
  readonly oracleId?: StableId;
  readonly sequence?: number;
}

export type GodotDeterministicReplayTerminalEvent =
  | GodotDeterministicReplayPassedEvent
  | GodotDeterministicReplayFailedEvent;

export interface GodotDeterministicReplayWireAttestation {
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: number;
  readonly lineEnding: "crlf" | "lf";
}

export interface GodotDeterministicReplayTranscriptDigestInput {
  readonly invocationDigest: typeof GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST;
  readonly expectationDigest: Sha256Digest;
  readonly wire: GodotDeterministicReplayWireAttestation;
  readonly started: GodotDeterministicReplayStartedEvent;
  readonly oracles: readonly GodotDeterministicReplayOracleEvent[];
  readonly terminal: GodotDeterministicReplayTerminalEvent;
}

export interface GodotDeterministicReplayTranscript
  extends GodotDeterministicReplayTranscriptDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly transcriptDigest: Sha256Digest;
}

const stateValueSchema = {
  oneOf: [
    { type: "null" },
    { type: "boolean" },
    {
      type: "integer",
      minimum: -9_007_199_254_740_991,
      maximum: 9_007_199_254_740_991,
    },
    {
      type: "string",
      minLength: 0,
      maxLength: 500,
      pattern: "^[^\\u0000-\\u001f\\u007f]*$",
    },
  ],
};

const stateEntry = closedObject(
  {
    path: reference("stableId"),
    value: stateValueSchema,
  },
  ["path", "value"],
);

const startedEvent = closedObject(
  {
    event: { const: "replay-started" },
    scenarioId: reference("stableId"),
    scenarioDigest: reference("sha256Digest"),
    seed: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "^[^\\u0000-\\u001f\\u007f]+$",
    },
  },
  ["event", "scenarioId", "scenarioDigest", "seed"],
);

const oracleEvent = closedObject(
  {
    event: { const: "oracle-passed" },
    oracleId: reference("stableId"),
    terminal: { type: "boolean" },
    tick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    state: boundedArray(stateEntry, {
      maximum: PLAYTEST_SCENARIO_MAX_ORACLES,
    }),
    stateHash: reference("sha256Digest"),
  },
  ["event", "oracleId", "terminal", "tick", "state", "stateHash"],
);

const wireAttestation = closedObject(
  {
    outputDigest: reference("sha256Digest"),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
    },
    eventCount: {
      type: "integer",
      minimum: 2,
      maximum: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
    },
    lineEnding: enumSchema(["crlf", "lf"]),
  },
  ["outputDigest", "bytes", "eventCount", "lineEnding"],
);

const passedEvent = closedObject(
  {
    event: { const: "replay-passed" },
    tick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    scenarioDigest: reference("sha256Digest"),
  },
  ["event", "tick", "scenarioDigest"],
);

const failedEventRoot = closedObject(
  {
    event: { const: "replay-failed" },
    code: enumSchema([
      "checkpoint-incomplete",
      "input-missed",
      "maximum-ticks-reached",
      "oracle-failed",
      "oracle-window-expired",
    ]),
    tick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    scenarioDigest: reference("sha256Digest"),
    oracleId: reference("stableId"),
    sequence: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_INPUTS - 1,
    },
  },
  ["event", "code", "tick", "scenarioDigest"],
);

const failedEvent = {
  ...failedEventRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { code: { const: "input-missed" } },
        required: ["code"],
      },
      then: {
        required: ["sequence"],
        properties: {
          oracleId: false,
          sequence: {
            type: "integer",
            minimum: 0,
            maximum: PLAYTEST_SCENARIO_MAX_INPUTS - 1,
          },
        },
      },
    },
    {
      if: {
        type: "object",
        properties: {
          code: { enum: ["oracle-failed", "oracle-window-expired"] },
        },
        required: ["code"],
      },
      then: {
        required: ["oracleId"],
        properties: {
          oracleId: reference("stableId"),
          sequence: false,
        },
      },
    },
    {
      if: {
        type: "object",
        properties: {
          code: {
            enum: ["checkpoint-incomplete", "maximum-ticks-reached"],
          },
        },
        required: ["code"],
      },
      then: {
        properties: { oracleId: false, sequence: false },
      },
    },
  ],
};

export const godotDeterministicReplayTranscriptSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-deterministic-replay-transcript",
    version: "1.0.0",
    title: "Godot Deterministic Replay Transcript",
    description:
      "Binds one fixed Godot replay invocation to scenario, oracle state, and terminal protocol evidence without retaining raw process output.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        invocationDigest: {
          const: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
        },
        expectationDigest: reference("sha256Digest"),
        wire: wireAttestation,
        started: startedEvent,
        oracles: boundedArray(oracleEvent, {
          maximum: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS - 2,
        }),
        terminal: { oneOf: [passedEvent, failedEvent] },
        transcriptDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "invocationDigest",
        "expectationDigest",
        "wire",
        "started",
        "oracles",
        "terminal",
        "transcriptDigest",
      ],
    ),
  });

function invalid(message: string): never {
  throw new TypeError(message);
}

function dataRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return invalid(message);
  }
  const names = Object.getOwnPropertyNames(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((name) => !names.includes(name)) ||
    names.some((name) => !allowed.has(name))
  ) {
    return invalid(message);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return invalid(message);
    }
    record[name] = descriptor.value;
  }
  return record;
}

function dataArray(
  value: unknown,
  maximum: number,
  message: string,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximum
  ) {
    return invalid(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1) {
    return invalid(message);
  }
  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return invalid(message);
    }
    result.push(descriptor.value);
  }
  return result;
}

function tick(value: unknown, message: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > PLAYTEST_SCENARIO_MAX_TICKS
  ) {
    return invalid(message);
  }
  return value as number;
}

function canonicalText(
  value: unknown,
  minimum: number,
  maximum: number,
  message: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    return invalid(message);
  }
  return value;
}

function parseStateValue(value: unknown): GodotDeterministicReplayStateValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      !Object.is(value, -0))
  ) {
    return value as null | boolean | number;
  }
  return canonicalText(value, 0, 500, "Godot replay state value is invalid");
}

function parseState(
  value: unknown,
): readonly GodotDeterministicReplayStateEntry[] {
  const values = dataArray(
    value,
    PLAYTEST_SCENARIO_MAX_ORACLES,
    "Godot replay state is invalid",
  );
  const seen = new Set<string>();
  return values.map((entry) => {
    const record = dataRecord(
      entry,
      ["path", "value"],
      [],
      "Godot replay state entry is invalid",
    );
    if (!isStableId(record["path"]) || seen.has(record["path"])) {
      return invalid("Godot replay state path is invalid or duplicated");
    }
    seen.add(record["path"]);
    return {
      path: record["path"],
      value: parseStateValue(record["value"]),
    };
  });
}

export function computeGodotDeterministicReplayStateHash(
  value: readonly GodotDeterministicReplayStateEntry[],
): Sha256Digest;
export function computeGodotDeterministicReplayStateHash(
  value: unknown,
): Sha256Digest {
  const state = parseState(value);
  return sha256Digest(JSON.stringify(state));
}

export function computeGodotDeterministicReplayTranscriptDigest(
  value: GodotDeterministicReplayTranscriptDigestInput,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-deterministic-replay-transcript",
    version: "1.0.0",
    transcript: value,
  });
}

function parseStarted(value: unknown): GodotDeterministicReplayStartedEvent {
  const record = dataRecord(
    value,
    ["event", "scenarioId", "scenarioDigest", "seed"],
    [],
    "Godot replay start event is invalid",
  );
  if (
    record["event"] !== "replay-started" ||
    !isStableId(record["scenarioId"]) ||
    !isSha256Digest(record["scenarioDigest"])
  ) {
    return invalid("Godot replay start event is invalid");
  }
  return {
    event: "replay-started",
    scenarioId: record["scenarioId"],
    scenarioDigest: record["scenarioDigest"],
    seed: canonicalText(
      record["seed"],
      1,
      256,
      "Godot replay seed is invalid",
    ),
  };
}

function parseOracle(value: unknown): GodotDeterministicReplayOracleEvent {
  const record = dataRecord(
    value,
    ["event", "oracleId", "terminal", "tick", "state", "stateHash"],
    [],
    "Godot replay oracle event is invalid",
  );
  if (
    record["event"] !== "oracle-passed" ||
    !isStableId(record["oracleId"]) ||
    typeof record["terminal"] !== "boolean" ||
    !isSha256Digest(record["stateHash"])
  ) {
    return invalid("Godot replay oracle event is invalid");
  }
  const state = parseState(record["state"]);
  if (computeGodotDeterministicReplayStateHash(state) !== record["stateHash"]) {
    return invalid("Godot replay oracle state hash is invalid");
  }
  return {
    event: "oracle-passed",
    oracleId: record["oracleId"],
    terminal: record["terminal"],
    tick: tick(record["tick"], "Godot replay oracle tick is invalid"),
    state,
    stateHash: record["stateHash"],
  };
}

function parseTerminal(
  value: unknown,
): GodotDeterministicReplayTerminalEvent {
  const base = dataRecord(
    value,
    ["event", "tick", "scenarioDigest"],
    ["code", "oracleId", "sequence"],
    "Godot replay terminal event is invalid",
  );
  if (!isSha256Digest(base["scenarioDigest"])) {
    return invalid("Godot replay terminal scenario identity is invalid");
  }
  const terminalTick = tick(
    base["tick"],
    "Godot replay terminal tick is invalid",
  );
  if (base["event"] === "replay-passed") {
    if (
      Object.hasOwn(base, "code") ||
      Object.hasOwn(base, "oracleId") ||
      Object.hasOwn(base, "sequence")
    ) {
      return invalid("Godot replay pass event contains failure details");
    }
    return {
      event: "replay-passed",
      tick: terminalTick,
      scenarioDigest: base["scenarioDigest"],
    };
  }
  const code = base["code"];
  if (
    base["event"] !== "replay-failed" ||
    (code !== "checkpoint-incomplete" &&
      code !== "input-missed" &&
      code !== "maximum-ticks-reached" &&
      code !== "oracle-failed" &&
      code !== "oracle-window-expired")
  ) {
    return invalid("Godot replay failure event is invalid");
  }
  const oracleFailure = code === "oracle-failed" || code === "oracle-window-expired";
  const inputFailure = code === "input-missed";
  if (
    (oracleFailure && !isStableId(base["oracleId"])) ||
    (!oracleFailure && Object.hasOwn(base, "oracleId")) ||
    (inputFailure &&
      (!Number.isSafeInteger(base["sequence"]) ||
        (base["sequence"] as number) < 0 ||
        (base["sequence"] as number) >= PLAYTEST_SCENARIO_MAX_INPUTS)) ||
    (!inputFailure && Object.hasOwn(base, "sequence"))
  ) {
    return invalid("Godot replay failure details do not match their code");
  }
  return {
    event: "replay-failed",
    code,
    tick: terminalTick,
    scenarioDigest: base["scenarioDigest"],
    ...(oracleFailure ? { oracleId: base["oracleId"] as StableId } : {}),
    ...(inputFailure ? { sequence: base["sequence"] as number } : {}),
  };
}

function parseWire(
  value: unknown,
): GodotDeterministicReplayWireAttestation {
  const record = dataRecord(
    value,
    ["outputDigest", "bytes", "eventCount", "lineEnding"],
    [],
    "Godot replay wire attestation is invalid",
  );
  if (
    !isSha256Digest(record["outputDigest"]) ||
    !Number.isSafeInteger(record["bytes"]) ||
    (record["bytes"] as number) < 1 ||
    (record["bytes"] as number) > GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES ||
    !Number.isSafeInteger(record["eventCount"]) ||
    (record["eventCount"] as number) < 2 ||
    (record["eventCount"] as number) > GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS ||
    (record["lineEnding"] !== "lf" && record["lineEnding"] !== "crlf")
  ) {
    return invalid("Godot replay wire attestation is invalid");
  }
  return {
    outputDigest: record["outputDigest"],
    bytes: record["bytes"] as number,
    eventCount: record["eventCount"] as number,
    lineEnding: record["lineEnding"],
  };
}

export function assertGodotDeterministicReplayTranscriptSemantics(
  value: unknown,
): asserts value is GodotDeterministicReplayTranscript {
  const record = dataRecord(
    value,
    [
      "schemaVersion",
      "invocationDigest",
      "expectationDigest",
      "wire",
      "started",
      "oracles",
      "terminal",
      "transcriptDigest",
    ],
    [],
    "Godot deterministic replay transcript is invalid",
  );
  if (
    record["schemaVersion"] !== "1.0.0" ||
    record["invocationDigest"] !==
      GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST ||
    !isSha256Digest(record["expectationDigest"]) ||
    !isSha256Digest(record["transcriptDigest"])
  ) {
    return invalid("Godot deterministic replay identity is invalid");
  }
  const started = parseStarted(record["started"]);
  const wire = parseWire(record["wire"]);
  const oracleValues = dataArray(
    record["oracles"],
    GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS - 2,
    "Godot replay oracle event list is invalid",
  );
  const oracles = oracleValues.map(parseOracle);
  const terminal = parseTerminal(record["terminal"]);
  if (wire.eventCount !== oracles.length + 2) {
    return invalid("Godot replay wire event count is inconsistent");
  }
  if (terminal.scenarioDigest !== started.scenarioDigest) {
    return invalid("Godot replay scenario identity changed during execution");
  }
  const seen = new Set<string>();
  let previousTick = -1;
  for (const oracle of oracles) {
    if (seen.has(oracle.oracleId) || oracle.tick < previousTick) {
      return invalid("Godot replay oracle sequence is invalid");
    }
    seen.add(oracle.oracleId);
    previousTick = oracle.tick;
  }
  if (terminal.tick < previousTick) {
    return invalid("Godot replay terminal event precedes oracle evidence");
  }
  if (terminal.event === "replay-passed") {
    const terminalTicks = oracles
      .filter((oracle) => oracle.terminal)
      .map((oracle) => oracle.tick);
    if (
      oracles.length === 0 ||
      terminalTicks.length === 0 ||
      terminal.tick !== Math.max(...terminalTicks)
    ) {
      return invalid("Godot replay success lacks terminal oracle evidence");
    }
  }
  const digestInput: GodotDeterministicReplayTranscriptDigestInput = {
    invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    expectationDigest: record["expectationDigest"],
    wire,
    started,
    oracles,
    terminal,
  };
  if (
    computeGodotDeterministicReplayTranscriptDigest(digestInput) !==
    record["transcriptDigest"]
  ) {
    return invalid("Godot replay transcript digest is invalid");
  }
}
