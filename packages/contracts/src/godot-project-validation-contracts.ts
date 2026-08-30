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
  isPortableProjectPath,
  type PortableProjectPath,
} from "./portable-path.js";
import {
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_PROJECT_IMPORT_PROCESS_TIMEOUT_MS = 120_000;
export const GODOT_PROJECT_IMPORT_IDLE_TIMEOUT_MS = 120_000;
export const GODOT_PROJECT_IMPORT_TERMINATION_GRACE_MS = 2_000;
export const GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES = 1_048_576;
export const GODOT_PROJECT_IMPORT_COMMAND_TIMEOUT_MS = 152_000;

export const GODOT_PROJECT_VALIDATION_PROCESS_TIMEOUT_MS = 30_000;
export const GODOT_PROJECT_VALIDATION_IDLE_TIMEOUT_MS = 15_000;
export const GODOT_PROJECT_VALIDATION_TERMINATION_GRACE_MS = 2_000;
export const GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES = 65_536;
export const GODOT_PROJECT_VALIDATION_MAX_LINE_BYTES = 16_384;
export const GODOT_PROJECT_VALIDATION_MAX_EVENTS = 2;
export const GODOT_PROJECT_VALIDATION_COMMAND_TIMEOUT_MS = 62_000;
export const GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX =
  "AGPB_PROJECT_VALIDATION " as const;
export const GODOT_PROJECT_VALIDATOR_SCRIPT =
  "res://addons/ai_game_playbook/validators/project_validation.gd" as const;

const importInvocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  arguments: Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--import",
    "--log-file",
    "$profileLocalLog",
    "--no-header",
  ]),
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
  networkCapabilities: "none" as const,
  projectSource: "disposable-copy" as const,
  targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
  targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  processTimeoutMs: GODOT_PROJECT_IMPORT_PROCESS_TIMEOUT_MS,
  idleTimeoutMs: GODOT_PROJECT_IMPORT_IDLE_TIMEOUT_MS,
  terminationGraceMs: GODOT_PROJECT_IMPORT_TERMINATION_GRACE_MS,
  maxOutputBytes: GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
  output: "digest-only-log" as const,
});

export const GODOT_PROJECT_IMPORT_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-import-invocation",
    version: "1.0.0",
    ...importInvocationSubject,
  });

const validationInvocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  arguments: Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--script",
    GODOT_PROJECT_VALIDATOR_SCRIPT,
    "--log-file",
    "$profileLocalLog",
    "--no-header",
  ]),
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
  networkCapabilities: "none" as const,
  projectSource: "disposable-copy" as const,
  targetVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
  targetReleaseStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  processTimeoutMs: GODOT_PROJECT_VALIDATION_PROCESS_TIMEOUT_MS,
  idleTimeoutMs: GODOT_PROJECT_VALIDATION_IDLE_TIMEOUT_MS,
  terminationGraceMs: GODOT_PROJECT_VALIDATION_TERMINATION_GRACE_MS,
  maxOutputBytes: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  maxLineBytes: GODOT_PROJECT_VALIDATION_MAX_LINE_BYTES,
  maxEvents: GODOT_PROJECT_VALIDATION_MAX_EVENTS,
  outputPrefix: GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX,
});

export const GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-validation-invocation",
    version: "1.0.0",
    ...validationInvocationSubject,
  });

export interface GodotProjectValidationExpectationDigestInput {
  readonly engine: "godot";
  readonly targetVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
  readonly validatorScript: typeof GODOT_PROJECT_VALIDATOR_SCRIPT;
}

export interface GodotProjectValidationExpectation
  extends GodotProjectValidationExpectationDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly expectationDigest: Sha256Digest;
}

export interface GodotProjectValidationStartedEvent {
  readonly event: "validation-started";
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
}

export type GodotProjectValidationFailureCode =
  | "main-scene-instantiate-failed"
  | "main-scene-load-failed"
  | "main-scene-missing"
  | "main-scene-not-packed"
  | "main-scene-path-invalid"
  | "manifest-invalid"
  | "manifest-missing"
  | "project-identity-mismatch";

export interface GodotProjectValidationPassedEvent {
  readonly event: "validation-passed";
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
  readonly resourceType: "PackedScene";
  readonly rootType: string;
}

export interface GodotProjectValidationFailedEvent {
  readonly event: "validation-failed";
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
  readonly code: GodotProjectValidationFailureCode;
}

export type GodotProjectValidationTerminalEvent =
  | GodotProjectValidationPassedEvent
  | GodotProjectValidationFailedEvent;

export interface GodotProjectValidationWireAttestation {
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: 2;
  readonly lineEnding: "crlf" | "lf";
}

export interface GodotProjectValidationTranscriptDigestInput {
  readonly invocationDigest: typeof GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST;
  readonly expectationDigest: Sha256Digest;
  readonly wire: GodotProjectValidationWireAttestation;
  readonly started: GodotProjectValidationStartedEvent;
  readonly terminal: GodotProjectValidationTerminalEvent;
}

export interface GodotProjectValidationTranscript
  extends GodotProjectValidationTranscriptDigestInput {
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
  mainScene: reference("portablePath"),
  validatorScript: { const: GODOT_PROJECT_VALIDATOR_SCRIPT },
  expectationDigest: reference("sha256Digest"),
};

export const godotProjectValidationExpectationSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-project-validation-expectation",
    version: "1.0.0",
    title: "Godot Project Validation Expectation",
    description:
      "Binds one exact project identity and main scene to the fixed import and structured validation invocations.",
    schema: contractRoot(
      expectationProperties,
      Object.keys(expectationProperties),
    ),
  });

const identityProperties = {
  projectId: reference("stableId"),
  sourceDigest: reference("sha256Digest"),
  mainScene: reference("portablePath"),
};

const startedEventSchema = closedObject(
  {
    event: { const: "validation-started" },
    ...identityProperties,
  },
  ["event", ...Object.keys(identityProperties)],
);

const passedEventSchema = closedObject(
  {
    event: { const: "validation-passed" },
    ...identityProperties,
    resourceType: { const: "PackedScene" },
    rootType: textSchema(128),
  },
  [
    "event",
    ...Object.keys(identityProperties),
    "resourceType",
    "rootType",
  ],
);

const failedEventSchema = closedObject(
  {
    event: { const: "validation-failed" },
    ...identityProperties,
    code: enumSchema([
      "main-scene-instantiate-failed",
      "main-scene-load-failed",
      "main-scene-missing",
      "main-scene-not-packed",
      "main-scene-path-invalid",
      "manifest-invalid",
      "manifest-missing",
      "project-identity-mismatch",
    ]),
  },
  ["event", ...Object.keys(identityProperties), "code"],
);

const wireSchema = closedObject(
  {
    outputDigest: reference("sha256Digest"),
    bytes: {
      type: "integer",
      minimum: 1,
      maximum: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
    },
    eventCount: { const: GODOT_PROJECT_VALIDATION_MAX_EVENTS },
    lineEnding: enumSchema(["crlf", "lf"]),
  },
  ["outputDigest", "bytes", "eventCount", "lineEnding"],
);

const transcriptProperties = {
  schemaVersion: { const: "1.0.0" },
  invocationDigest: { const: GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST },
  expectationDigest: reference("sha256Digest"),
  wire: wireSchema,
  started: startedEventSchema,
  terminal: { oneOf: [passedEventSchema, failedEventSchema] },
  transcriptDigest: reference("sha256Digest"),
};

export const godotProjectValidationTranscriptSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-project-validation-transcript",
    version: "1.0.0",
    title: "Godot Project Validation Transcript",
    description:
      "Preserves a bounded start and terminal result from the fixed Godot script and scene validator without retaining engine paths.",
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

function boundedText(value: unknown, message: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    return invalid(message);
  }
  return value;
}

function identity(
  value: Record<string, unknown>,
  message: string,
): {
  readonly projectId: StableId;
  readonly sourceDigest: Sha256Digest;
  readonly mainScene: PortableProjectPath;
} {
  if (
    !isStableId(value["projectId"]) ||
    !isSha256Digest(value["sourceDigest"]) ||
    !isPortableProjectPath(value["mainScene"])
  ) {
    return invalid(message);
  }
  return {
    projectId: value["projectId"],
    sourceDigest: value["sourceDigest"],
    mainScene: value["mainScene"],
  };
}

function parseStarted(value: unknown): GodotProjectValidationStartedEvent {
  const record = exactRecord(
    value,
    ["event", "projectId", "sourceDigest", "mainScene"],
    "Godot project validation start event is invalid.",
  );
  if (record["event"] !== "validation-started") {
    return invalid("Godot project validation start event is invalid.");
  }
  return { event: "validation-started", ...identity(record, "Godot project validation start identity is invalid.") };
}

function parseTerminal(value: unknown): GodotProjectValidationTerminalEvent {
  const candidate = value as Record<string, unknown>;
  const event =
    value !== null && typeof value === "object" && !isProxy(value)
      ? Object.getOwnPropertyDescriptor(value, "event")
      : undefined;
  if (event === undefined || !("value" in event)) {
    return invalid("Godot project validation terminal event is invalid.");
  }
  if (event.value === "validation-passed") {
    const record = exactRecord(
      candidate,
      [
        "event",
        "projectId",
        "sourceDigest",
        "mainScene",
        "resourceType",
        "rootType",
      ],
      "Godot project validation pass event is invalid.",
    );
    if (record["resourceType"] !== "PackedScene") {
      return invalid("Godot project validation pass resource is invalid.");
    }
    return {
      event: "validation-passed",
      ...identity(record, "Godot project validation pass identity is invalid."),
      resourceType: "PackedScene",
      rootType: boundedText(
        record["rootType"],
        "Godot project validation root type is invalid.",
      ),
    };
  }
  const record = exactRecord(
    candidate,
    ["event", "projectId", "sourceDigest", "mainScene", "code"],
    "Godot project validation failure event is invalid.",
  );
  const code = record["code"];
  if (
    record["event"] !== "validation-failed" ||
    (code !== "main-scene-instantiate-failed" &&
      code !== "main-scene-load-failed" &&
      code !== "main-scene-missing" &&
      code !== "main-scene-not-packed" &&
      code !== "main-scene-path-invalid" &&
      code !== "manifest-invalid" &&
      code !== "manifest-missing" &&
      code !== "project-identity-mismatch")
  ) {
    return invalid("Godot project validation failure code is invalid.");
  }
  return {
    event: "validation-failed",
    ...identity(record, "Godot project validation failure identity is invalid."),
    code,
  };
}

export function computeGodotProjectValidationExpectationDigest(
  value: GodotProjectValidationExpectationDigestInput,
): Sha256Digest {
  const record = exactRecord(
    value,
    [
      "engine",
      "targetVersion",
      "targetReleaseStatus",
      "projectId",
      "sourceDigest",
      "mainScene",
      "validatorScript",
    ],
    "Godot project validation expectation is invalid.",
  );
  if (
    record["engine"] !== "godot" ||
    record["targetVersion"] !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    record["targetReleaseStatus"] !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    record["validatorScript"] !== GODOT_PROJECT_VALIDATOR_SCRIPT
  ) {
    return invalid("Godot project validation expectation tuple is invalid.");
  }
  identity(record, "Godot project validation expectation identity is invalid.");
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-validation-expectation",
    version: "1.0.0",
    expectation: value,
  });
}

export function assertGodotProjectValidationExpectationSemantics(
  value: GodotProjectValidationExpectation,
): void {
  const record = exactRecord(
    value,
    [...Object.keys(expectationProperties)],
    "Godot project validation expectation is outside the contract.",
  );
  if (record["schemaVersion"] !== "1.0.0" || !isSha256Digest(record["expectationDigest"])) {
    return invalid("Godot project validation expectation identity is invalid.");
  }
  const {
    schemaVersion: _schemaVersion,
    expectationDigest,
    ...digestInput
  } = record;
  if (
    computeGodotProjectValidationExpectationDigest(
      digestInput as unknown as GodotProjectValidationExpectationDigestInput,
    ) !== expectationDigest
  ) {
    return invalid("Godot project validation expectation digest is invalid.");
  }
}

export function computeGodotProjectValidationTranscriptDigest(
  value: GodotProjectValidationTranscriptDigestInput,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-validation-transcript",
    version: "1.0.0",
    transcript: value,
  });
}

export function assertGodotProjectValidationTranscriptSemantics(
  value: GodotProjectValidationTranscript,
): void {
  const record = exactRecord(
    value,
    [...Object.keys(transcriptProperties)],
    "Godot project validation transcript is outside the contract.",
  );
  if (
    record["schemaVersion"] !== "1.0.0" ||
    record["invocationDigest"] !== GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST ||
    !isSha256Digest(record["expectationDigest"]) ||
    !isSha256Digest(record["transcriptDigest"])
  ) {
    return invalid("Godot project validation transcript identity is invalid.");
  }
  const wire = exactRecord(
    record["wire"],
    ["outputDigest", "bytes", "eventCount", "lineEnding"],
    "Godot project validation wire attestation is invalid.",
  );
  if (
    !isSha256Digest(wire["outputDigest"]) ||
    !Number.isSafeInteger(wire["bytes"]) ||
    (wire["bytes"] as number) < 1 ||
    (wire["bytes"] as number) > GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES ||
    wire["eventCount"] !== GODOT_PROJECT_VALIDATION_MAX_EVENTS ||
    (wire["lineEnding"] !== "crlf" && wire["lineEnding"] !== "lf")
  ) {
    return invalid("Godot project validation wire attestation is invalid.");
  }
  const started = parseStarted(record["started"]);
  const terminal = parseTerminal(record["terminal"]);
  if (
    started.projectId !== terminal.projectId ||
    started.sourceDigest !== terminal.sourceDigest ||
    started.mainScene !== terminal.mainScene
  ) {
    return invalid("Godot project validation events do not share one identity.");
  }
  const digestInput: GodotProjectValidationTranscriptDigestInput = {
    invocationDigest: GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
    expectationDigest: record["expectationDigest"],
    wire: wire as unknown as GodotProjectValidationWireAttestation,
    started,
    terminal,
  };
  if (
    computeGodotProjectValidationTranscriptDigest(digestInput) !==
    record["transcriptDigest"]
  ) {
    return invalid("Godot project validation transcript digest is invalid.");
  }
}
