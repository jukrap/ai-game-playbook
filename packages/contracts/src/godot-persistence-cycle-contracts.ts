import { Buffer } from "node:buffer";
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
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
} from "./godot-version-probe-contracts.js";
import {
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX =
  "AGPB_PERSISTENCE " as const;
export const GODOT_PERSISTENCE_CYCLE_MAX_LINE_BYTES = 16_384;
export const GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES = 65_536;
export const GODOT_PERSISTENCE_CYCLE_MAX_EVENTS = 5;
export const GODOT_PERSISTENCE_CYCLE_MAX_SAVE_BYTES = 16_384;
export const GODOT_PERSISTENCE_CYCLE_PROCESS_TIMEOUT_MS = 30_000;
export const GODOT_PERSISTENCE_CYCLE_IDLE_TIMEOUT_MS = 15_000;
export const GODOT_PERSISTENCE_CYCLE_TERMINATION_GRACE_MS = 2_000;
export const GODOT_PERSISTENCE_CYCLE_PHASE_COUNT = 2;
export const GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS = 92_000;

export const GODOT_PERSISTENCE_CYCLE_SAVE_ARGUMENTS: readonly string[] =
  Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--log-file",
    "$profileSaveLog",
    "--no-header",
    "--",
    "--agpb-persistence-save",
  ]);

export const GODOT_PERSISTENCE_CYCLE_LOAD_ARGUMENTS: readonly string[] =
  Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--log-file",
    "$profileLoadLog",
    "--no-header",
    "--",
    "--agpb-persistence-load",
  ]);

const invocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  phases: Object.freeze([
    Object.freeze({
      phase: "save" as const,
      arguments: GODOT_PERSISTENCE_CYCLE_SAVE_ARGUMENTS,
    }),
    Object.freeze({
      phase: "load" as const,
      arguments: GODOT_PERSISTENCE_CYCLE_LOAD_ARGUMENTS,
    }),
  ]),
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
  networkCapabilities: "none" as const,
  projectSource: "disposable-copy" as const,
  targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
  targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  processTimeoutMs: GODOT_PERSISTENCE_CYCLE_PROCESS_TIMEOUT_MS,
  idleTimeoutMs: GODOT_PERSISTENCE_CYCLE_IDLE_TIMEOUT_MS,
  terminationGraceMs: GODOT_PERSISTENCE_CYCLE_TERMINATION_GRACE_MS,
  maxOutputBytes: GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
  maxLineBytes: GODOT_PERSISTENCE_CYCLE_MAX_LINE_BYTES,
  maxEvents: GODOT_PERSISTENCE_CYCLE_MAX_EVENTS,
  outputPrefix: GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX,
});

export const GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-persistence-cycle-invocation",
    version: "1.0.0",
    ...invocationSubject,
  });

export interface GodotPersistenceCycleExpectationDigestInput {
  readonly engine: "godot";
  readonly targetVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly saveSchemaVersion: "1.0.0";
  readonly freshStateHash: Sha256Digest;
  readonly persistedStateHash: Sha256Digest;
}

export interface GodotPersistenceCycleExpectation
  extends GodotPersistenceCycleExpectationDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly expectationDigest: Sha256Digest;
}

interface GodotPersistenceCycleIdentity {
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
}

interface GodotPersistenceCycleSaveIdentity {
  readonly saveDigest: Sha256Digest;
  readonly saveBytes: number;
}

export interface GodotPersistenceSaveStartedEvent
  extends GodotPersistenceCycleIdentity {
  readonly event: "persistence-save-started";
  readonly freshStateHash: Sha256Digest;
}

export interface GodotPersistenceSaveCompletedEvent
  extends GodotPersistenceCycleIdentity,
    GodotPersistenceCycleSaveIdentity {
  readonly event: "persistence-save-completed";
  readonly stateHash: Sha256Digest;
  readonly userfsPersistent: true;
}

export interface GodotPersistenceLoadStartedEvent
  extends GodotPersistenceCycleIdentity,
    GodotPersistenceCycleSaveIdentity {
  readonly event: "persistence-load-started";
  readonly freshStateHash: Sha256Digest;
  readonly userfsPersistent: true;
}

export interface GodotPersistenceLoadCompletedEvent
  extends GodotPersistenceCycleIdentity,
    GodotPersistenceCycleSaveIdentity {
  readonly event: "persistence-load-completed";
  readonly stateHash: Sha256Digest;
}

export interface GodotPersistenceCyclePassedEvent
  extends GodotPersistenceCycleIdentity,
    GodotPersistenceCycleSaveIdentity {
  readonly event: "persistence-cycle-passed";
  readonly stateHash: Sha256Digest;
}

export interface GodotPersistenceCycleWireAttestation {
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: typeof GODOT_PERSISTENCE_CYCLE_MAX_EVENTS;
  readonly lineEnding: "crlf" | "lf";
}

export interface GodotPersistenceCycleTranscriptDigestInput {
  readonly invocationDigest: typeof GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST;
  readonly expectationDigest: Sha256Digest;
  readonly wire: GodotPersistenceCycleWireAttestation;
  readonly saveStarted: GodotPersistenceSaveStartedEvent;
  readonly saveCompleted: GodotPersistenceSaveCompletedEvent;
  readonly loadStarted: GodotPersistenceLoadStartedEvent;
  readonly loadCompleted: GodotPersistenceLoadCompletedEvent;
  readonly terminal: GodotPersistenceCyclePassedEvent;
}

export interface GodotPersistenceCycleTranscript
  extends GodotPersistenceCycleTranscriptDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly transcriptDigest: Sha256Digest;
}

const expectationProperties = {
  schemaVersion: { const: "1.0.0" },
  engine: { const: "godot" },
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  projectId: reference("stableId"),
  sourceDigest: reference("sha256Digest"),
  saveSchemaVersion: { const: "1.0.0" },
  freshStateHash: reference("sha256Digest"),
  persistedStateHash: reference("sha256Digest"),
  expectationDigest: reference("sha256Digest"),
};

export const godotPersistenceCycleExpectationSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-persistence-cycle-expectation",
    version: "1.0.0",
    title: "Godot persistence cycle expectation",
    description:
      "Binds one exact Godot project and expected fresh and persisted states to a fixed two-process save and load sequence.",
    schema: contractRoot(
      expectationProperties,
      Object.keys(expectationProperties),
    ),
  });

const identityProperties = {
  projectId: reference("stableId"),
  sourceDigest: reference("sha256Digest"),
};
const saveProperties = {
  saveDigest: reference("sha256Digest"),
  saveBytes: {
    type: "integer",
    minimum: 1,
    maximum: GODOT_PERSISTENCE_CYCLE_MAX_SAVE_BYTES,
  },
};

const saveStartedSchema = closedObject(
  {
    event: { const: "persistence-save-started" },
    ...identityProperties,
    freshStateHash: reference("sha256Digest"),
  },
  ["event", ...Object.keys(identityProperties), "freshStateHash"],
);

const saveCompletedSchema = closedObject(
  {
    event: { const: "persistence-save-completed" },
    ...identityProperties,
    stateHash: reference("sha256Digest"),
    ...saveProperties,
    userfsPersistent: { const: true },
  },
  [
    "event",
    ...Object.keys(identityProperties),
    "stateHash",
    ...Object.keys(saveProperties),
    "userfsPersistent",
  ],
);

const loadStartedSchema = closedObject(
  {
    event: { const: "persistence-load-started" },
    ...identityProperties,
    freshStateHash: reference("sha256Digest"),
    ...saveProperties,
    userfsPersistent: { const: true },
  },
  [
    "event",
    ...Object.keys(identityProperties),
    "freshStateHash",
    ...Object.keys(saveProperties),
    "userfsPersistent",
  ],
);

function loadedEventSchema(event: string) {
  return closedObject(
    {
      event: { const: event },
      ...identityProperties,
      stateHash: reference("sha256Digest"),
      ...saveProperties,
    },
    [
      "event",
      ...Object.keys(identityProperties),
      "stateHash",
      ...Object.keys(saveProperties),
    ],
  );
}

const wireSchema = closedObject(
  {
    outputDigest: reference("sha256Digest"),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
    },
    eventCount: { const: GODOT_PERSISTENCE_CYCLE_MAX_EVENTS },
    lineEnding: enumSchema(["crlf", "lf"]),
  },
  ["outputDigest", "bytes", "eventCount", "lineEnding"],
);

const transcriptProperties = {
  schemaVersion: { const: "1.0.0" },
  invocationDigest: { const: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST },
  expectationDigest: reference("sha256Digest"),
  wire: wireSchema,
  saveStarted: saveStartedSchema,
  saveCompleted: saveCompletedSchema,
  loadStarted: loadStartedSchema,
  loadCompleted: loadedEventSchema("persistence-load-completed"),
  terminal: loadedEventSchema("persistence-cycle-passed"),
  transcriptDigest: reference("sha256Digest"),
};

export const godotPersistenceCycleTranscriptSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-persistence-cycle-transcript",
    version: "1.0.0",
    title: "Godot persistence cycle transcript",
    description:
      "Preserves bounded save and restart-load evidence from one ordered two-process cycle without retaining user storage paths or save bytes.",
    schema: contractRoot(
      transcriptProperties,
      Object.keys(transcriptProperties),
    ),
  });

function invalid(message: string): never {
  throw new TypeError(message);
}

function exactRecord(
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
    return invalid(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return invalid(message);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return invalid(message);
    }
    result[key] = descriptor.value;
  }
  return result;
}

function parseIdentity(record: Record<string, unknown>, message: string) {
  if (
    !isStableId(record["projectId"]) ||
    !isSha256Digest(record["sourceDigest"])
  ) {
    return invalid(message);
  }
  return {
    projectId: record["projectId"],
    sourceDigest: record["sourceDigest"],
  };
}

function parseSave(record: Record<string, unknown>, message: string) {
  if (
    !isSha256Digest(record["saveDigest"]) ||
    !Number.isSafeInteger(record["saveBytes"]) ||
    (record["saveBytes"] as number) < 1 ||
    (record["saveBytes"] as number) > GODOT_PERSISTENCE_CYCLE_MAX_SAVE_BYTES
  ) {
    return invalid(message);
  }
  return {
    saveDigest: record["saveDigest"],
    saveBytes: record["saveBytes"] as number,
  };
}

function parseSaveStarted(value: unknown): GodotPersistenceSaveStartedEvent {
  const record = exactRecord(
    value,
    ["event", "projectId", "sourceDigest", "freshStateHash"],
    "Godot persistence save start event is invalid.",
  );
  if (
    record["event"] !== "persistence-save-started" ||
    !isSha256Digest(record["freshStateHash"])
  ) {
    return invalid("Godot persistence save start event is invalid.");
  }
  return {
    event: "persistence-save-started",
    ...parseIdentity(record, "Godot persistence save identity is invalid."),
    freshStateHash: record["freshStateHash"],
  };
}

function parseSaveCompleted(
  value: unknown,
): GodotPersistenceSaveCompletedEvent {
  const record = exactRecord(
    value,
    [
      "event",
      "projectId",
      "sourceDigest",
      "stateHash",
      "saveDigest",
      "saveBytes",
      "userfsPersistent",
    ],
    "Godot persistence save completion event is invalid.",
  );
  if (
    record["event"] !== "persistence-save-completed" ||
    !isSha256Digest(record["stateHash"]) ||
    record["userfsPersistent"] !== true
  ) {
    return invalid("Godot persistence save completion event is invalid.");
  }
  return {
    event: "persistence-save-completed",
    ...parseIdentity(record, "Godot persistence save identity is invalid."),
    stateHash: record["stateHash"],
    ...parseSave(record, "Godot persistence save artifact is invalid."),
    userfsPersistent: true,
  };
}

function parseLoadStarted(value: unknown): GodotPersistenceLoadStartedEvent {
  const record = exactRecord(
    value,
    [
      "event",
      "projectId",
      "sourceDigest",
      "freshStateHash",
      "saveDigest",
      "saveBytes",
      "userfsPersistent",
    ],
    "Godot persistence load start event is invalid.",
  );
  if (
    record["event"] !== "persistence-load-started" ||
    !isSha256Digest(record["freshStateHash"]) ||
    record["userfsPersistent"] !== true
  ) {
    return invalid("Godot persistence load start event is invalid.");
  }
  return {
    event: "persistence-load-started",
    ...parseIdentity(record, "Godot persistence load identity is invalid."),
    freshStateHash: record["freshStateHash"],
    ...parseSave(record, "Godot persistence load artifact is invalid."),
    userfsPersistent: true,
  };
}

function parseLoadedEvent(
  value: unknown,
  expectedEvent: "persistence-cycle-passed" | "persistence-load-completed",
): GodotPersistenceCyclePassedEvent | GodotPersistenceLoadCompletedEvent {
  const record = exactRecord(
    value,
    [
      "event",
      "projectId",
      "sourceDigest",
      "stateHash",
      "saveDigest",
      "saveBytes",
    ],
    "Godot persistence loaded event is invalid.",
  );
  if (record["event"] !== expectedEvent || !isSha256Digest(record["stateHash"])) {
    return invalid("Godot persistence loaded event is invalid.");
  }
  return {
    event: expectedEvent,
    ...parseIdentity(record, "Godot persistence loaded identity is invalid."),
    stateHash: record["stateHash"],
    ...parseSave(record, "Godot persistence loaded artifact is invalid."),
  };
}

export function computeGodotPersistenceCycleExpectationDigest(
  value: GodotPersistenceCycleExpectationDigestInput,
): Sha256Digest {
  const record = exactRecord(
    value,
    [
      "engine",
      "targetVersion",
      "targetReleaseStatus",
      "projectId",
      "sourceDigest",
      "saveSchemaVersion",
      "freshStateHash",
      "persistedStateHash",
    ],
    "Godot persistence cycle expectation is invalid.",
  );
  if (
    record["engine"] !== "godot" ||
    record["targetVersion"] !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    record["targetReleaseStatus"] !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    record["saveSchemaVersion"] !== "1.0.0" ||
    !isSha256Digest(record["freshStateHash"]) ||
    !isSha256Digest(record["persistedStateHash"])
  ) {
    return invalid("Godot persistence cycle expectation tuple is invalid.");
  }
  parseIdentity(record, "Godot persistence cycle expectation identity is invalid.");
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-persistence-cycle-expectation",
    version: "1.0.0",
    expectation: value,
  });
}

export function assertGodotPersistenceCycleExpectationSemantics(
  value: GodotPersistenceCycleExpectation,
): void {
  const record = exactRecord(
    value,
    Object.keys(expectationProperties),
    "Godot persistence cycle expectation is outside the contract.",
  );
  if (
    record["schemaVersion"] !== "1.0.0" ||
    !isSha256Digest(record["expectationDigest"])
  ) {
    return invalid("Godot persistence cycle expectation identity is invalid.");
  }
  const {
    schemaVersion: _schemaVersion,
    expectationDigest,
    ...digestInput
  } = record;
  if (
    computeGodotPersistenceCycleExpectationDigest(
      digestInput as unknown as GodotPersistenceCycleExpectationDigestInput,
    ) !== expectationDigest
  ) {
    return invalid("Godot persistence cycle expectation digest is invalid.");
  }
}

export function computeGodotPersistenceCycleTranscriptDigest(
  value: GodotPersistenceCycleTranscriptDigestInput,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-persistence-cycle-transcript",
    version: "1.0.0",
    transcript: value,
  });
}

export function assertGodotPersistenceCycleTranscriptSemantics(
  value: GodotPersistenceCycleTranscript,
): void {
  const record = exactRecord(
    value,
    Object.keys(transcriptProperties),
    "Godot persistence cycle transcript is outside the contract.",
  );
  if (
    record["schemaVersion"] !== "1.0.0" ||
    record["invocationDigest"] !== GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST ||
    !isSha256Digest(record["expectationDigest"]) ||
    !isSha256Digest(record["transcriptDigest"])
  ) {
    return invalid("Godot persistence cycle transcript identity is invalid.");
  }
  const wire = exactRecord(
    record["wire"],
    ["outputDigest", "bytes", "eventCount", "lineEnding"],
    "Godot persistence cycle wire attestation is invalid.",
  );
  if (
    !isSha256Digest(wire["outputDigest"]) ||
    !Number.isSafeInteger(wire["bytes"]) ||
    (wire["bytes"] as number) < 1 ||
    (wire["bytes"] as number) > GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES ||
    wire["eventCount"] !== GODOT_PERSISTENCE_CYCLE_MAX_EVENTS ||
    (wire["lineEnding"] !== "crlf" && wire["lineEnding"] !== "lf")
  ) {
    return invalid("Godot persistence cycle wire attestation is invalid.");
  }

  const saveStarted = parseSaveStarted(record["saveStarted"]);
  const saveCompleted = parseSaveCompleted(record["saveCompleted"]);
  const loadStarted = parseLoadStarted(record["loadStarted"]);
  const loadCompleted = parseLoadedEvent(
    record["loadCompleted"],
    "persistence-load-completed",
  ) as GodotPersistenceLoadCompletedEvent;
  const terminal = parseLoadedEvent(
    record["terminal"],
    "persistence-cycle-passed",
  ) as GodotPersistenceCyclePassedEvent;
  const identities = [saveCompleted, loadStarted, loadCompleted, terminal];
  if (
    identities.some(
      (event) =>
        event.projectId !== saveStarted.projectId ||
        event.sourceDigest !== saveStarted.sourceDigest,
    ) ||
    loadStarted.freshStateHash !== saveStarted.freshStateHash ||
    loadStarted.saveDigest !== saveCompleted.saveDigest ||
    loadStarted.saveBytes !== saveCompleted.saveBytes ||
    loadCompleted.saveDigest !== saveCompleted.saveDigest ||
    loadCompleted.saveBytes !== saveCompleted.saveBytes ||
    terminal.saveDigest !== saveCompleted.saveDigest ||
    terminal.saveBytes !== saveCompleted.saveBytes ||
    loadCompleted.stateHash !== saveCompleted.stateHash ||
    terminal.stateHash !== saveCompleted.stateHash
  ) {
    return invalid("Godot persistence cycle events do not describe one save and state.");
  }
  const digestInput: GodotPersistenceCycleTranscriptDigestInput = {
    invocationDigest: GODOT_PERSISTENCE_CYCLE_INVOCATION_DIGEST,
    expectationDigest: record["expectationDigest"],
    wire: wire as unknown as GodotPersistenceCycleWireAttestation,
    saveStarted,
    saveCompleted,
    loadStarted,
    loadCompleted,
    terminal,
  };
  if (
    computeGodotPersistenceCycleTranscriptDigest(digestInput) !==
    record["transcriptDigest"]
  ) {
    return invalid("Godot persistence cycle transcript digest is invalid.");
  }
}

export function isGodotPersistenceCycleOutputText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Buffer.from(value, "utf8").toString("utf8") === value
  );
}
