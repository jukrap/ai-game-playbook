import { isProxy } from "node:util/types";

import {
  GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
  GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE,
  GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_EVENTS,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_LINE_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  assertProcessContainmentEngineRunReportSemantics,
  checkPlaytestScenarioSemantics,
  computePlaytestScenarioDigest,
  digestCanonicalJson,
  isSha256Digest,
  playtestScenarioSchema,
  runtimeFrameEvidenceSchema,
  sha256Digest,
  type GodotDeterministicReplayFailedEvent,
  type GodotDeterministicReplayOracleEvent,
  type GodotDeterministicReplayTerminalEvent,
  type PlaytestScenario,
  type ProcessContainmentEngineRunReport,
  type RuntimeFrameEvidence,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  inspectArtifactBytes,
  type ArtifactFormatDetails,
} from "@ai-game-playbook/evidence";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  consumeWindowsContainedGodotCapturePayload,
  type WindowsContainedGodotCaptureExecution,
} from "@ai-game-playbook/windows-containment-provider";

import {
  createGodotDeterministicReplayExpectation,
  parseGodotDeterministicReplayOutput,
  parseGodotStructuredOutputJsonRecord,
  type GodotDeterministicReplayExpectation,
  type GodotDeterministicReplayOutputInvalidCode,
} from "./deterministic-replay-result.js";
import { GodotAdapterBoundaryError } from "./errors.js";
import { GODOT_GRAYBOX_SCENARIO_DIGEST } from "./graybox-project.js";

export { GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX };

export const GODOT_RUNTIME_FRAME_CAPTURE_CAMERA_ID: StableId & "camera.follow" =
  "camera.follow" as StableId & "camera.follow";
export const GODOT_RUNTIME_FRAME_CAPTURE_RENDERER: "gl_compatibility" =
  "gl_compatibility";
export const GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT: Readonly<{
  width: 960;
  height: 540;
  scale: "1.000000";
}> = Object.freeze({
  width: 960 as const,
  height: 540 as const,
  scale: "1.000000" as const,
});
export const GODOT_RUNTIME_FRAME_CAPTURE_MAX_DECODED_BYTES: number =
  GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.height *
  (GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.width * 4 + 1);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const disallowedOutputControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const expectedSceneId = "scene.graybox.main" as StableId;

export interface CreateGodotRuntimeFrameCaptureExpectationRequest {
  readonly runId: string;
  readonly scenario: unknown;
}

export interface GodotRuntimeFrameCaptureExpectation {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly scenarioId: StableId;
  readonly scenarioDigest: Sha256Digest;
  readonly seed: string;
  readonly sceneId: StableId;
  readonly cameraId: typeof GODOT_RUNTIME_FRAME_CAPTURE_CAMERA_ID;
  readonly renderer: typeof GODOT_RUNTIME_FRAME_CAPTURE_RENDERER;
  readonly engineVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly engineStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly viewport: typeof GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT;
  readonly maximumTicks: number;
  readonly maximumOutputBytes: number;
  readonly replayExpectationDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest;
  readonly expectationDigest: Sha256Digest;
}

export interface GodotRuntimeFrameCaptureStartedEvent {
  readonly event: "capture-started";
  readonly runId: string;
  readonly scenarioId: StableId;
  readonly scenarioDigest: Sha256Digest;
  readonly seed: string;
  readonly inputBindingDigest: Sha256Digest;
  readonly sceneId: StableId;
  readonly cameraId: StableId;
}

export type GodotRuntimeFrameCaptureFailureCode =
  | "artifact-identity-invalid"
  | "artifact-unavailable"
  | "display-unavailable"
  | "engine-identity-invalid"
  | "image-unavailable"
  | "png-save-failed"
  | "renderer-invalid"
  | "terminal-state-unavailable"
  | "viewport-invalid";

export interface GodotRuntimeFrameCaptureFailedEvent {
  readonly event: "capture-failed";
  readonly runId: string;
  readonly code: GodotRuntimeFrameCaptureFailureCode;
  readonly tick: number;
  readonly scenarioDigest: Sha256Digest;
}

export interface GodotRuntimeFrameCapturePassedEvent {
  readonly event: "capture-passed";
  readonly runId: string;
  readonly tick: number;
  readonly scenarioDigest: Sha256Digest;
  readonly stateDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest;
  readonly sceneId: StableId;
  readonly cameraId: StableId;
  readonly renderer: string;
  readonly renderingDriver: string;
  readonly displayServer: string;
  readonly engineVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly engineStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly scale: string;
  };
  readonly artifactDigest: Sha256Digest;
  readonly artifactBytes: number;
}

export type GodotRuntimeFrameCaptureTerminalEvent =
  | GodotRuntimeFrameCaptureFailedEvent
  | GodotRuntimeFrameCapturePassedEvent;

export interface GodotRuntimeFrameCaptureWireAttestation {
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: number;
  readonly lineEnding: "crlf" | "lf";
}

export interface GodotRuntimeFrameCaptureTranscript {
  readonly schemaVersion: "1.0.0";
  readonly invocationDigest: typeof GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST;
  readonly expectationDigest: Sha256Digest;
  readonly wire: GodotRuntimeFrameCaptureWireAttestation;
  readonly started: GodotRuntimeFrameCaptureStartedEvent;
  readonly oracles: readonly GodotDeterministicReplayOracleEvent[];
  readonly replayTerminal: GodotDeterministicReplayTerminalEvent;
  readonly captureTerminal?: GodotRuntimeFrameCaptureTerminalEvent;
  readonly transcriptDigest: Sha256Digest;
}

export type GodotRuntimeFrameCaptureOutputInvalidCode =
  | "godot-capture-output-byte-limit"
  | "godot-capture-output-capture-terminal-invalid"
  | "godot-capture-output-control-invalid"
  | "godot-capture-output-event-sequence-invalid"
  | "godot-capture-output-framing-invalid"
  | "godot-capture-output-json-invalid"
  | "godot-capture-output-line-limit"
  | "godot-capture-output-prefix-invalid"
  | "godot-capture-output-replay-invalid"
  | "godot-capture-output-start-mismatch";

export interface ParsedGodotRuntimeFrameCaptureOutput {
  readonly status: "parsed";
  readonly transcript: GodotRuntimeFrameCaptureTranscript;
}

export interface InvalidGodotRuntimeFrameCaptureOutput {
  readonly status: "invalid";
  readonly code: GodotRuntimeFrameCaptureOutputInvalidCode;
  readonly replayCode?: GodotDeterministicReplayOutputInvalidCode;
}

export type GodotRuntimeFrameCaptureOutput =
  | InvalidGodotRuntimeFrameCaptureOutput
  | ParsedGodotRuntimeFrameCaptureOutput;

export type GodotRuntimeFrameArtifactAssessmentCode =
  | "godot-capture-artifact-identity-mismatch"
  | "godot-capture-artifact-invalid-png"
  | "godot-capture-artifact-png-shape-invalid"
  | "godot-capture-artifact-validated";

export interface ValidatedGodotRuntimeFrameArtifact {
  readonly status: "validated";
  readonly code: "godot-capture-artifact-validated";
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly format: ArtifactFormatDetails;
}

export interface RejectedGodotRuntimeFrameArtifact {
  readonly status: "rejected";
  readonly code: Exclude<
    GodotRuntimeFrameArtifactAssessmentCode,
    "godot-capture-artifact-validated"
  >;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

export type GodotRuntimeFrameArtifactAssessment =
  | RejectedGodotRuntimeFrameArtifact
  | ValidatedGodotRuntimeFrameArtifact;

export type GodotRuntimeFrameCaptureResultStatus =
  | "artifact-invalid"
  | "artifact-unavailable"
  | "cancelled"
  | "capture-failed"
  | "capture-passed"
  | "invalid-output"
  | "process-failed"
  | "replay-failed"
  | "transcript-unavailable"
  | "uncertain";

export type GodotRuntimeFrameCaptureResultCode =
  | GodotRuntimeFrameCaptureOutputInvalidCode
  | GodotRuntimeFrameArtifactAssessmentCode
  | "godot-capture-artifact-unavailable"
  | "godot-capture-engine-process-failed"
  | "godot-capture-engine-run-cancelled"
  | "godot-capture-engine-run-uncertain"
  | "godot-capture-exit-outcome-mismatch"
  | "godot-capture-passed"
  | "godot-capture-transcript-attestation-mismatch"
  | "godot-capture-transcript-unavailable"
  | `godot-capture-${GodotRuntimeFrameCaptureFailureCode}`
  | `godot-capture-replay-${GodotDeterministicReplayFailedEvent["code"]}`;

export interface GodotRuntimeFrameCaptureExecutionSummary {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly outcome: ProcessContainmentEngineRunReport["outcome"];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly logDigest: Sha256Digest;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
  readonly mutationUncertain: boolean;
}

export interface GodotRuntimeFrameCaptureResult {
  readonly status: GodotRuntimeFrameCaptureResultStatus;
  readonly code: GodotRuntimeFrameCaptureResultCode;
  readonly expectationDigest: Sha256Digest;
  readonly invocationDigest: typeof GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST;
  readonly execution: GodotRuntimeFrameCaptureExecutionSummary;
  readonly transcript:
    | { readonly status: "unavailable" }
    | {
        readonly status: "rejected";
        readonly code: GodotRuntimeFrameCaptureOutputInvalidCode;
        readonly outputDigest: Sha256Digest;
        readonly bytes: number;
        readonly replayCode?: GodotDeterministicReplayOutputInvalidCode;
      }
    | {
        readonly status: "validated";
        readonly value: GodotRuntimeFrameCaptureTranscript;
      };
  readonly artifact:
    | { readonly status: "unavailable" }
    | GodotRuntimeFrameArtifactAssessment;
  readonly frame?: RuntimeFrameEvidence;
}

const expectations = new WeakSet<object>();
const replayExpectations = new WeakMap<
  object,
  GodotDeterministicReplayExpectation
>();
const transcripts = new WeakSet<object>();
const validatedArtifacts = new WeakSet<object>();
const validatedArtifactBytes = new WeakMap<object, Uint8Array>();

function fail(code: string, message: string): never {
  throw new GodotAdapterBoundaryError(code, message, false);
}

function exactRecord(
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
    return fail("godot-capture-boundary-invalid", message);
  }
  const names = Object.getOwnPropertyNames(value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((name) => !names.includes(name)) ||
    names.some((name) => !allowed.has(name))
  ) {
    return fail("godot-capture-boundary-invalid", message);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail("godot-capture-boundary-invalid", message);
    }
    result[name] = descriptor.value;
  }
  return result;
}

function tryExactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  try {
    return exactRecord(value, required, optional, "capture event is invalid");
  } catch {
    return undefined;
  }
}

function canonicalText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    Buffer.from(value, "utf8").toString("utf8") !== value
  ) {
    return undefined;
  }
  return value;
}

function canonicalRuntimeToken(value: unknown): string | undefined {
  const text = canonicalText(value, 1, 64);
  return text !== undefined && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(text)
    ? text
    : undefined;
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function invalid(
  code: GodotRuntimeFrameCaptureOutputInvalidCode,
  replayCode?: GodotDeterministicReplayOutputInvalidCode,
): InvalidGodotRuntimeFrameCaptureOutput {
  return Object.freeze({
    status: "invalid" as const,
    code,
    ...(replayCode === undefined ? {} : { replayCode }),
  });
}

function expectationAuthority(
  value: GodotRuntimeFrameCaptureExpectation,
): GodotDeterministicReplayExpectation {
  const replay =
    value !== null && typeof value === "object"
      ? replayExpectations.get(value)
      : undefined;
  if (replay === undefined || !expectations.has(value)) {
    return fail(
      "godot-capture-expectation-invalid",
      "Godot capture expectation must be created in this runtime.",
    );
  }
  return replay;
}

export function createGodotRuntimeFrameCaptureExpectation(
  value: unknown,
): GodotRuntimeFrameCaptureExpectation {
  const request = exactRecord(
    value,
    ["runId", "scenario"],
    [],
    "Godot capture expectation request is invalid.",
  );
  if (typeof request["runId"] !== "string" || !uuidPattern.test(request["runId"])) {
    return fail(
      "godot-capture-expectation-invalid",
      "Godot capture run identity is invalid.",
    );
  }
  let scenario: PlaytestScenario;
  try {
    scenario = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: playtestScenarioSchema.schemaId,
        digest: playtestScenarioSchema.digest,
      },
      request["scenario"],
    ) as unknown as PlaytestScenario;
  } catch {
    return fail(
      "godot-capture-expectation-invalid",
      "Godot capture scenario is outside the registered contract.",
    );
  }
  const scenarioDigest = computePlaytestScenarioDigest(scenario);
  if (
    checkPlaytestScenarioSemantics(scenario).length !== 0 ||
    scenarioDigest !== GODOT_GRAYBOX_SCENARIO_DIGEST ||
    scenario.initialState.sceneId !== expectedSceneId
  ) {
    return fail(
      "godot-capture-expectation-invalid",
      "Godot capture requires the exact deterministic graybox scenario.",
    );
  }
  const replay = createGodotDeterministicReplayExpectation(scenario);
  const runId = request["runId"];
  const inputBindingDigest = digestCanonicalJson({
    domain: "ai-game-playbook/godot-runtime-frame-input-binding",
    version: "1.0.0",
    runId,
    invocationDigest: GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
    scenarioDigest,
    replayExpectationDigest: replay.expectationDigest,
  });
  const subject = Object.freeze({
    schemaVersion: "1.0.0" as const,
    runId,
    scenarioId: scenario.scenarioId,
    scenarioDigest,
    seed: scenario.initialState.seed,
    sceneId: scenario.initialState.sceneId,
    cameraId: GODOT_RUNTIME_FRAME_CAPTURE_CAMERA_ID,
    renderer: GODOT_RUNTIME_FRAME_CAPTURE_RENDERER,
    engineVersion: GODOT_VERSION_PROBE_TARGET_VERSION,
    engineStatus: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
    viewport: GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT,
    maximumTicks: scenario.clock.maximumTicks,
    maximumOutputBytes: Math.min(
      scenario.budgets.outputBytes,
      GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
    ),
    replayExpectationDigest: replay.expectationDigest,
    inputBindingDigest,
  });
  const expectation = Object.freeze({
    ...subject,
    expectationDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-runtime-frame-expectation",
      version: "1.0.0",
      expectation: subject,
    }),
  });
  expectations.add(expectation);
  replayExpectations.set(expectation, replay);
  return expectation;
}

interface FramedOutput {
  readonly lines: readonly string[];
  readonly lineEnding: "crlf" | "lf";
  readonly bytes: number;
  readonly outputDigest: Sha256Digest;
}

function frameOutput(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
): FramedOutput | GodotRuntimeFrameCaptureOutputInvalidCode {
  if (typeof value !== "string") {
    return "godot-capture-output-framing-invalid";
  }
  if (value.length > expectation.maximumOutputBytes) {
    return "godot-capture-output-byte-limit";
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > expectation.maximumOutputBytes) {
    return "godot-capture-output-byte-limit";
  }
  if (
    value.length === 0 ||
    !value.endsWith("\n") ||
    value.startsWith("\uFEFF")
  ) {
    return "godot-capture-output-framing-invalid";
  }
  if (disallowedOutputControls.test(value)) {
    return "godot-capture-output-control-invalid";
  }
  const hasCrlf = value.includes("\r\n");
  if (
    value.includes("\r") &&
    (!hasCrlf || value.replaceAll("\r\n", "").includes("\r"))
  ) {
    return "godot-capture-output-framing-invalid";
  }
  if (hasCrlf && value.replaceAll("\r\n", "").includes("\n")) {
    return "godot-capture-output-framing-invalid";
  }
  const normalized = hasCrlf ? value.replaceAll("\r\n", "\n") : value;
  const lines = normalized.slice(0, -1).split("\n");
  if (
    lines.length > GODOT_RUNTIME_FRAME_CAPTURE_MAX_EVENTS ||
    lines.some(
      (line) =>
        line.length === 0 ||
        Buffer.byteLength(line, "utf8") >
          GODOT_RUNTIME_FRAME_CAPTURE_MAX_LINE_BYTES,
    )
  ) {
    return "godot-capture-output-line-limit";
  }
  return {
    lines,
    lineEnding: hasCrlf ? "crlf" : "lf",
    bytes,
    outputDigest: sha256Digest(value),
  };
}

function parseStarted(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
): GodotRuntimeFrameCaptureStartedEvent | undefined {
  const record = tryExactRecord(value, [
    "event",
    "runId",
    "scenarioId",
    "scenarioDigest",
    "seed",
    "inputBindingDigest",
    "sceneId",
    "cameraId",
  ]);
  if (
    record === undefined ||
    record["event"] !== "capture-started" ||
    record["runId"] !== expectation.runId ||
    record["scenarioId"] !== expectation.scenarioId ||
    record["scenarioDigest"] !== expectation.scenarioDigest ||
    record["seed"] !== expectation.seed ||
    record["inputBindingDigest"] !== expectation.inputBindingDigest ||
    record["sceneId"] !== expectation.sceneId ||
    record["cameraId"] !== expectation.cameraId
  ) {
    return undefined;
  }
  return {
    event: "capture-started",
    runId: expectation.runId,
    scenarioId: expectation.scenarioId,
    scenarioDigest: expectation.scenarioDigest,
    seed: expectation.seed,
    inputBindingDigest: expectation.inputBindingDigest,
    sceneId: expectation.sceneId,
    cameraId: expectation.cameraId,
  };
}

const captureFailureCodes = new Set<GodotRuntimeFrameCaptureFailureCode>([
  "artifact-identity-invalid",
  "artifact-unavailable",
  "display-unavailable",
  "engine-identity-invalid",
  "image-unavailable",
  "png-save-failed",
  "renderer-invalid",
  "terminal-state-unavailable",
  "viewport-invalid",
]);

function parseCaptureFailed(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
  replayTick: number,
): GodotRuntimeFrameCaptureFailedEvent | undefined {
  const record = tryExactRecord(value, [
    "event",
    "runId",
    "code",
    "tick",
    "scenarioDigest",
  ]);
  if (
    record === undefined ||
    record["event"] !== "capture-failed" ||
    record["runId"] !== expectation.runId ||
    !captureFailureCodes.has(
      record["code"] as GodotRuntimeFrameCaptureFailureCode,
    ) ||
    record["tick"] !== replayTick ||
    record["scenarioDigest"] !== expectation.scenarioDigest
  ) {
    return undefined;
  }
  return {
    event: "capture-failed",
    runId: expectation.runId,
    code: record["code"] as GodotRuntimeFrameCaptureFailureCode,
    tick: replayTick,
    scenarioDigest: expectation.scenarioDigest,
  };
}

function terminalStateDigest(
  oracles: readonly GodotDeterministicReplayOracleEvent[],
): Sha256Digest | undefined {
  return [...oracles].reverse().find(({ terminal }) => terminal)?.stateHash;
}

function parseCapturePassed(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
  replayTick: number,
  oracles: readonly GodotDeterministicReplayOracleEvent[],
): GodotRuntimeFrameCapturePassedEvent | undefined {
  const record = tryExactRecord(value, [
    "event",
    "runId",
    "tick",
    "scenarioDigest",
    "stateDigest",
    "inputBindingDigest",
    "sceneId",
    "cameraId",
    "renderer",
    "renderingDriver",
    "displayServer",
    "engineVersion",
    "engineStatus",
    "viewport",
    "artifactDigest",
    "artifactBytes",
  ]);
  const viewport = tryExactRecord(record?.["viewport"], [
    "width",
    "height",
    "scale",
  ]);
  const stateDigest = terminalStateDigest(oracles);
  const renderingDriver = canonicalRuntimeToken(record?.["renderingDriver"]);
  const displayServer = canonicalRuntimeToken(record?.["displayServer"]);
  if (
    record === undefined ||
    viewport === undefined ||
    stateDigest === undefined ||
    renderingDriver === undefined ||
    displayServer === undefined ||
    record["event"] !== "capture-passed" ||
    record["runId"] !== expectation.runId ||
    record["tick"] !== replayTick ||
    record["scenarioDigest"] !== expectation.scenarioDigest ||
    record["stateDigest"] !== stateDigest ||
    record["inputBindingDigest"] !== expectation.inputBindingDigest ||
    record["sceneId"] !== expectation.sceneId ||
    record["cameraId"] !== expectation.cameraId ||
    record["renderer"] !== expectation.renderer ||
    record["engineVersion"] !== expectation.engineVersion ||
    record["engineStatus"] !== expectation.engineStatus ||
    viewport["width"] !== expectation.viewport.width ||
    viewport["height"] !== expectation.viewport.height ||
    viewport["scale"] !== expectation.viewport.scale ||
    !isSha256Digest(record["artifactDigest"]) ||
    !safeInteger(
      record["artifactBytes"],
      8,
      GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    )
  ) {
    return undefined;
  }
  return {
    event: "capture-passed",
    runId: expectation.runId,
    tick: replayTick,
    scenarioDigest: expectation.scenarioDigest,
    stateDigest,
    inputBindingDigest: expectation.inputBindingDigest,
    sceneId: expectation.sceneId,
    cameraId: expectation.cameraId,
    renderer: expectation.renderer,
    renderingDriver,
    displayServer,
    engineVersion: expectation.engineVersion,
    engineStatus: expectation.engineStatus,
    viewport: {
      width: expectation.viewport.width,
      height: expectation.viewport.height,
      scale: expectation.viewport.scale,
    },
    artifactDigest: record["artifactDigest"],
    artifactBytes: record["artifactBytes"],
  };
}

function replayProjection(
  started: GodotRuntimeFrameCaptureStartedEvent,
  events: readonly Record<string, unknown>[],
  replayTerminalIndex: number,
): string {
  const replayStarted = {
    event: "replay-started",
    scenarioId: started.scenarioId,
    scenarioDigest: started.scenarioDigest,
    seed: started.seed,
  };
  return [replayStarted, ...events.slice(1, replayTerminalIndex + 1)]
    .map(
      (event) =>
        `${GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX}${JSON.stringify(event)}\n`,
    )
    .join("");
}

function freezeTranscript(
  value: Omit<GodotRuntimeFrameCaptureTranscript, "transcriptDigest">,
): GodotRuntimeFrameCaptureTranscript {
  Object.freeze(value.started);
  Object.freeze(value.wire);
  if (value.captureTerminal?.event === "capture-passed") {
    Object.freeze(value.captureTerminal.viewport);
  }
  if (value.captureTerminal !== undefined) {
    Object.freeze(value.captureTerminal);
  }
  const result = Object.freeze({
    ...value,
    transcriptDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-runtime-frame-transcript",
      version: "1.0.0",
      transcript: value,
    }),
  });
  transcripts.add(result);
  return result;
}

export function parseGodotRuntimeFrameCaptureOutput(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
): GodotRuntimeFrameCaptureOutput {
  const replayExpectation = expectationAuthority(expectation);
  const framed = frameOutput(value, expectation);
  if (typeof framed === "string") return invalid(framed);
  const events: Record<string, unknown>[] = [];
  for (const line of framed.lines) {
    if (!line.startsWith(GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX)) {
      return invalid("godot-capture-output-prefix-invalid");
    }
    const event = parseGodotStructuredOutputJsonRecord(
      line.slice(GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX.length),
    );
    if (event === undefined) {
      return invalid("godot-capture-output-json-invalid");
    }
    events.push(event);
  }
  if (events.length < 2) {
    return invalid("godot-capture-output-event-sequence-invalid");
  }
  const started = parseStarted(events[0], expectation);
  if (started === undefined) {
    return invalid("godot-capture-output-start-mismatch");
  }
  const last = events.at(-1);
  const previous = events.at(-2);
  let replayTerminalIndex: number;
  let captureExpected = false;
  if (last?.["event"] === "replay-failed") {
    replayTerminalIndex = events.length - 1;
  } else if (previous?.["event"] === "replay-passed") {
    replayTerminalIndex = events.length - 2;
    captureExpected = true;
  } else {
    return invalid("godot-capture-output-event-sequence-invalid");
  }
  const replay = parseGodotDeterministicReplayOutput(
    replayProjection(started, events, replayTerminalIndex),
    replayExpectation,
  );
  if (replay.status === "invalid") {
    return invalid("godot-capture-output-replay-invalid", replay.code);
  }
  const replayTerminal = replay.transcript.terminal;
  let captureTerminal: GodotRuntimeFrameCaptureTerminalEvent | undefined;
  if (captureExpected) {
    if (replayTerminal.event !== "replay-passed" || last === undefined) {
      return invalid("godot-capture-output-event-sequence-invalid");
    }
    captureTerminal =
      last["event"] === "capture-passed"
        ? parseCapturePassed(
            last,
            expectation,
            replayTerminal.tick,
            replay.transcript.oracles,
          )
        : parseCaptureFailed(last, expectation, replayTerminal.tick);
    if (captureTerminal === undefined) {
      return invalid("godot-capture-output-capture-terminal-invalid");
    }
  } else if (replayTerminal.event !== "replay-failed") {
    return invalid("godot-capture-output-event-sequence-invalid");
  }
  const transcript = freezeTranscript({
    schemaVersion: "1.0.0",
    invocationDigest: GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
    expectationDigest: expectation.expectationDigest,
    wire: {
      outputDigest: framed.outputDigest,
      bytes: framed.bytes,
      eventCount: events.length,
      lineEnding: framed.lineEnding,
    },
    started,
    oracles: replay.transcript.oracles,
    replayTerminal,
    ...(captureTerminal === undefined ? {} : { captureTerminal }),
  });
  return Object.freeze({ status: "parsed" as const, transcript });
}

export function assessGodotRuntimeFrameArtifact(
  value: unknown,
): GodotRuntimeFrameArtifactAssessment {
  const request = exactRecord(
    value,
    ["transcript", "attestation", "content"],
    [],
    "Godot capture artifact assessment request is invalid.",
  );
  const transcript = request["transcript"] as GodotRuntimeFrameCaptureTranscript;
  if (
    transcript === null ||
    typeof transcript !== "object" ||
    !transcripts.has(transcript) ||
    transcript.captureTerminal?.event !== "capture-passed"
  ) {
    return fail(
      "godot-capture-artifact-request-invalid",
      "Godot capture artifact requires an original successful transcript.",
    );
  }
  const attestation = exactRecord(
    request["attestation"],
    ["digest", "bytes"],
    [],
    "Godot capture artifact attestation is invalid.",
  );
  if (
    !isSha256Digest(attestation["digest"]) ||
    !safeInteger(
      attestation["bytes"],
      1,
      GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    )
  ) {
    return fail(
      "godot-capture-artifact-request-invalid",
      "Godot capture artifact attestation is invalid.",
    );
  }
  const content = request["content"];
  if (
    !(content instanceof Uint8Array) ||
    isProxy(content) ||
    Object.getPrototypeOf(content) !== Uint8Array.prototype
  ) {
    return fail(
      "godot-capture-artifact-request-invalid",
      "Godot capture artifact bytes are invalid.",
    );
  }
  let snapshot: Uint8Array;
  try {
    snapshot = Uint8Array.from(content);
  } catch {
    return fail(
      "godot-capture-artifact-request-invalid",
      "Godot capture artifact bytes could not be snapshotted.",
    );
  }
  const digest = sha256Digest(snapshot);
  const bytes = snapshot.byteLength;
  if (
    digest !== attestation["digest"] ||
    bytes !== attestation["bytes"] ||
    digest !== transcript.captureTerminal.artifactDigest ||
    bytes !== transcript.captureTerminal.artifactBytes
  ) {
    return Object.freeze({
      status: "rejected" as const,
      code: "godot-capture-artifact-identity-mismatch" as const,
      digest,
      bytes,
    });
  }
  const inspected = inspectArtifactBytes({
    content: snapshot,
    expectation: {
      format: "png",
      maxWidth: GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.width,
      maxHeight: GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.height,
      maxPixels:
        GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.width *
        GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.height,
      maxDecodedBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_DECODED_BYTES,
    },
    maxBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
  });
  if (inspected.status !== "passed") {
    return Object.freeze({
      status: "rejected" as const,
      code: "godot-capture-artifact-invalid-png" as const,
      digest,
      bytes,
    });
  }
  if (
    inspected.format.width !== GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.width ||
    inspected.format.height !== GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT.height ||
    inspected.format.bitDepth !== 8 ||
    inspected.format.colorType !== 6 ||
    inspected.format.interlaced !== false ||
    inspected.format.decodedBytes !==
      GODOT_RUNTIME_FRAME_CAPTURE_MAX_DECODED_BYTES
  ) {
    return Object.freeze({
      status: "rejected" as const,
      code: "godot-capture-artifact-png-shape-invalid" as const,
      digest,
      bytes,
    });
  }
  const result = Object.freeze({
    status: "validated" as const,
    code: "godot-capture-artifact-validated" as const,
    digest,
    bytes,
    format: Object.freeze({ ...inspected.format }),
  });
  validatedArtifacts.add(result);
  validatedArtifactBytes.set(result, snapshot);
  return result;
}

export function consumeGodotRuntimeFrameArtifactBytes(
  value: unknown,
): Uint8Array {
  if (
    value === null ||
    typeof value !== "object" ||
    !validatedArtifacts.has(value)
  ) {
    return fail(
      "godot-capture-artifact-bytes-unavailable",
      "Godot capture artifact bytes require an original validated assessment.",
    );
  }
  const snapshot = validatedArtifactBytes.get(value);
  if (snapshot === undefined) {
    return fail(
      "godot-capture-artifact-bytes-unavailable",
      "Godot capture artifact bytes are unavailable, cloned, or already consumed.",
    );
  }
  validatedArtifactBytes.delete(value);
  return Uint8Array.from(snapshot);
}

export interface CreateGodotRuntimeFrameEvidenceRequest {
  readonly transcript: GodotRuntimeFrameCaptureTranscript;
  readonly artifact: ValidatedGodotRuntimeFrameArtifact;
  readonly projectIdentityDigest: Sha256Digest;
  readonly sessionIdentityDigest: Sha256Digest;
  readonly capturedAt: string;
}

export function createGodotRuntimeFrameEvidence(
  value: unknown,
): RuntimeFrameEvidence {
  const request = exactRecord(
    value,
    [
      "transcript",
      "artifact",
      "projectIdentityDigest",
      "sessionIdentityDigest",
      "capturedAt",
    ],
    [],
    "Godot runtime frame evidence request is invalid.",
  );
  const transcript = request["transcript"] as GodotRuntimeFrameCaptureTranscript;
  const artifact = request["artifact"] as ValidatedGodotRuntimeFrameArtifact;
  if (
    transcript === null ||
    typeof transcript !== "object" ||
    !transcripts.has(transcript) ||
    transcript.captureTerminal?.event !== "capture-passed" ||
    artifact === null ||
    typeof artifact !== "object" ||
    !validatedArtifacts.has(artifact) ||
    artifact.status !== "validated" ||
    artifact.digest !== transcript.captureTerminal.artifactDigest ||
    artifact.bytes !== transcript.captureTerminal.artifactBytes ||
    !isSha256Digest(request["projectIdentityDigest"]) ||
    !isSha256Digest(request["sessionIdentityDigest"]) ||
    typeof request["capturedAt"] !== "string" ||
    !timestampPattern.test(request["capturedAt"]) ||
    Number.isNaN(Date.parse(request["capturedAt"])) ||
    new Date(Date.parse(request["capturedAt"])).toISOString() !==
      request["capturedAt"]
  ) {
    return fail(
      "godot-capture-frame-evidence-invalid",
      "Godot runtime frame evidence identity is invalid.",
    );
  }
  const terminal = transcript.captureTerminal;
  const candidate: RuntimeFrameEvidence = {
    schemaVersion: "1.0.0" as RuntimeFrameEvidence["schemaVersion"],
    artifactDigest: terminal.artifactDigest,
    bytes: terminal.artifactBytes,
    complete: true,
    origin: "standalone-player",
    runId: terminal.runId,
    tick: terminal.tick,
    stateDigest: terminal.stateDigest,
    inputTraceDigest: terminal.inputBindingDigest,
    projectIdentityDigest: request["projectIdentityDigest"],
    sessionIdentityDigest: request["sessionIdentityDigest"],
    engine: "godot",
    engineVersion: terminal.engineVersion,
    renderer: terminal.renderer,
    sceneId: terminal.sceneId,
    cameraId: terminal.cameraId,
    viewport: {
      width: terminal.viewport.width,
      height: terminal.viewport.height,
      scale: terminal.viewport.scale,
    },
    seed: transcript.started.seed,
    capturedAt: request["capturedAt"],
  };
  let validated: RuntimeFrameEvidence;
  try {
    validated = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: runtimeFrameEvidenceSchema.schemaId,
        digest: runtimeFrameEvidenceSchema.digest,
      },
      candidate,
    ) as unknown as RuntimeFrameEvidence;
  } catch {
    return fail(
      "godot-capture-frame-evidence-invalid",
      "Godot runtime frame evidence failed its registered contract.",
    );
  }
  Object.freeze(validated.viewport);
  return Object.freeze(validated);
}

interface ParsedExecution {
  readonly execution: WindowsContainedGodotCaptureExecution;
  readonly report: ProcessContainmentEngineRunReport;
  readonly transcript:
    | { readonly status: "unavailable" }
    | {
        readonly status: "available";
        readonly digest: Sha256Digest;
        readonly bytes: number;
      };
  readonly artifact:
    | { readonly status: "unavailable" }
    | {
        readonly status: "available";
        readonly digest: Sha256Digest;
        readonly bytes: number;
      };
}

function parseExecution(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
): ParsedExecution {
  const record = exactRecord(
    value,
    ["schemaVersion", "report", "transcript", "artifact"],
    [],
    "Godot capture execution is invalid.",
  );
  const report = record["report"] as ProcessContainmentEngineRunReport;
  try {
    assertProcessContainmentEngineRunReportSemantics(report);
  } catch {
    return fail(
      "godot-capture-execution-invalid",
      "Godot capture engine report is invalid.",
    );
  }
  const profile = GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE;
  if (
    record["schemaVersion"] !== "1.0.0" ||
    report.runId !== expectation.runId ||
    report.operationId !== "engine.runtime-frame-capture" ||
    report.invocationDigest !== GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST ||
    report.inputBindingDigest !== expectation.inputBindingDigest ||
    report.profileDigest !== profile.profileDigest ||
    report.profileContractDigest !== profile.contractDigest ||
    report.profileCatalogDigest !==
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    report.request.profile.id !== profile.profileId
  ) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot capture engine report does not match its expectation.",
    );
  }
  const transcriptRecord = tryExactRecord(record["transcript"], ["status"], [
    "digest",
    "bytes",
  ]);
  const artifactRecord = tryExactRecord(record["artifact"], ["status"], [
    "kind",
    "format",
    "digest",
    "bytes",
  ]);
  if (transcriptRecord === undefined || artifactRecord === undefined) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot capture transfer attestation is invalid.",
    );
  }
  const transcript =
    transcriptRecord["status"] === "unavailable" &&
    Object.getOwnPropertyNames(transcriptRecord).length === 1
      ? ({ status: "unavailable" } as const)
      : transcriptRecord["status"] === "available" &&
          isSha256Digest(transcriptRecord["digest"]) &&
          safeInteger(
            transcriptRecord["bytes"],
            1,
            GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
          ) &&
          transcriptRecord["digest"] === report.output.logDigest &&
          transcriptRecord["bytes"] === report.output.capturedBytes
        ? ({
            status: "available" as const,
            digest: transcriptRecord["digest"],
            bytes: transcriptRecord["bytes"],
          } as const)
        : undefined;
  const artifact =
    artifactRecord["status"] === "unavailable" &&
    Object.getOwnPropertyNames(artifactRecord).length === 1
      ? ({ status: "unavailable" } as const)
      : artifactRecord["status"] === "available" &&
          artifactRecord["kind"] === "runtime-frame" &&
          artifactRecord["format"] === "png" &&
          isSha256Digest(artifactRecord["digest"]) &&
          safeInteger(
            artifactRecord["bytes"],
            1,
            GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
          )
        ? ({
            status: "available" as const,
            digest: artifactRecord["digest"],
            bytes: artifactRecord["bytes"],
          } as const)
        : undefined;
  if (
    transcript === undefined ||
    artifact === undefined ||
    (artifact.status === "available" && transcript.status !== "available")
  ) {
    return fail(
      "godot-capture-execution-invalid",
      "Godot capture transfer attestation contradicts its report.",
    );
  }
  return {
    execution: value as WindowsContainedGodotCaptureExecution,
    report,
    transcript,
    artifact,
  };
}

function executionSummary(
  report: ProcessContainmentEngineRunReport,
): GodotRuntimeFrameCaptureExecutionSummary {
  return Object.freeze({
    requestDigest: report.requestDigest,
    reportDigest: report.reportDigest,
    outcome: report.outcome,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    durationMs: report.durationMs,
    exitCode: report.process.exitCode,
    logDigest: report.output.logDigest,
    capturedBytes: report.output.capturedBytes,
    observedBytes: report.output.observedBytes,
    truncated: report.output.truncated,
    mutationUncertain: report.mutationUncertain,
  });
}

function classified(
  status: GodotRuntimeFrameCaptureResultStatus,
  code: GodotRuntimeFrameCaptureResultCode,
  expectation: GodotRuntimeFrameCaptureExpectation,
  execution: GodotRuntimeFrameCaptureExecutionSummary,
  transcript: GodotRuntimeFrameCaptureResult["transcript"],
  artifact: GodotRuntimeFrameCaptureResult["artifact"],
  frame?: RuntimeFrameEvidence,
): GodotRuntimeFrameCaptureResult {
  return Object.freeze({
    status,
    code,
    expectationDigest: expectation.expectationDigest,
    invocationDigest: GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST,
    execution,
    transcript: Object.freeze(transcript),
    artifact: Object.freeze(artifact),
    ...(frame === undefined ? {} : { frame }),
  });
}

function cleanBehaviorFailure(report: ProcessContainmentEngineRunReport): boolean {
  return (
    report.outcome === "failed" &&
    report.process.started &&
    report.process.exitCode === 2 &&
    report.process.totalProcesses === report.request.limits.maxProcesses &&
    report.process.activeProcesses === 0 &&
    !report.output.truncated &&
    !report.termination.requested &&
    report.termination.cause === "none" &&
    report.termination.confirmed &&
    report.effects.sourceProjectPreserved &&
    report.effects.sourceExecutablePreserved &&
    report.effects.stagedProjectBaselinePreserved &&
    report.effects.stagedExecutableBaselinePreserved &&
    report.effects.profileBudgetPreserved &&
    !report.effects.networkConnectionEstablished &&
    !report.effects.childProcessStarted &&
    report.effects.cleanup === "complete" &&
    !report.mutationUncertain
  );
}

export function classifyGodotRuntimeFrameCaptureExecution(
  value: unknown,
  expectation: GodotRuntimeFrameCaptureExpectation,
): GodotRuntimeFrameCaptureResult {
  expectationAuthority(expectation);
  const parsedExecution = parseExecution(value, expectation);
  const { report } = parsedExecution;
  const summary = executionSummary(report);
  const unavailableTranscript = { status: "unavailable" as const };
  const unavailableArtifact = { status: "unavailable" as const };
  if (parsedExecution.transcript.status === "unavailable") {
    if (report.outcome === "cancelled") {
      return classified(
        "cancelled",
        "godot-capture-engine-run-cancelled",
        expectation,
        summary,
        unavailableTranscript,
        unavailableArtifact,
      );
    }
    if (report.outcome === "uncertain" || report.mutationUncertain) {
      return classified(
        "uncertain",
        "godot-capture-engine-run-uncertain",
        expectation,
        summary,
        unavailableTranscript,
        unavailableArtifact,
      );
    }
    if (report.outcome === "failed") {
      return classified(
        "process-failed",
        "godot-capture-engine-process-failed",
        expectation,
        summary,
        unavailableTranscript,
        unavailableArtifact,
      );
    }
    return classified(
      "transcript-unavailable",
      "godot-capture-transcript-unavailable",
      expectation,
      summary,
      unavailableTranscript,
      unavailableArtifact,
    );
  }
  let payload: ReturnType<
    typeof consumeWindowsContainedGodotCapturePayload
  >;
  try {
    payload = consumeWindowsContainedGodotCapturePayload(
      parsedExecution.execution,
    );
  } catch {
    return fail(
      "godot-capture-payload-unavailable",
      "Godot capture payload is cloned, stale, or already consumed.",
    );
  }
  if (
    sha256Digest(payload.transcript) !== parsedExecution.transcript.digest ||
    Buffer.byteLength(payload.transcript, "utf8") !==
      parsedExecution.transcript.bytes
  ) {
    return classified(
      "invalid-output",
      "godot-capture-transcript-attestation-mismatch",
      expectation,
      summary,
      {
        status: "rejected",
        code: "godot-capture-output-framing-invalid",
        outputDigest: sha256Digest(payload.transcript),
        bytes: Buffer.byteLength(payload.transcript, "utf8"),
      },
      unavailableArtifact,
    );
  }
  const parsed = parseGodotRuntimeFrameCaptureOutput(
    payload.transcript,
    expectation,
  );
  if (parsed.status === "invalid") {
    return classified(
      "invalid-output",
      parsed.code,
      expectation,
      summary,
      {
        status: "rejected",
        code: parsed.code,
        outputDigest: parsedExecution.transcript.digest,
        bytes: parsedExecution.transcript.bytes,
        ...(parsed.replayCode === undefined
          ? {}
          : { replayCode: parsed.replayCode }),
      },
      unavailableArtifact,
    );
  }
  const validatedTranscript = {
    status: "validated" as const,
    value: parsed.transcript,
  };
  if (parsed.transcript.replayTerminal.event === "replay-failed") {
    if (
      !cleanBehaviorFailure(report) ||
      parsed.transcript.captureTerminal !== undefined ||
      parsedExecution.artifact.status !== "unavailable" ||
      payload.artifact !== undefined
    ) {
      return classified(
        "invalid-output",
        "godot-capture-exit-outcome-mismatch",
        expectation,
        summary,
        validatedTranscript,
        unavailableArtifact,
      );
    }
    return classified(
      "replay-failed",
      `godot-capture-replay-${parsed.transcript.replayTerminal.code}`,
      expectation,
      summary,
      validatedTranscript,
      unavailableArtifact,
    );
  }
  if (parsed.transcript.captureTerminal?.event === "capture-failed") {
    if (
      !cleanBehaviorFailure(report) ||
      parsedExecution.artifact.status !== "unavailable" ||
      payload.artifact !== undefined
    ) {
      return classified(
        "invalid-output",
        "godot-capture-exit-outcome-mismatch",
        expectation,
        summary,
        validatedTranscript,
        unavailableArtifact,
      );
    }
    return classified(
      "capture-failed",
      `godot-capture-${parsed.transcript.captureTerminal.code}`,
      expectation,
      summary,
      validatedTranscript,
      unavailableArtifact,
    );
  }
  if (
    parsed.transcript.captureTerminal?.event !== "capture-passed" ||
    report.outcome !== "succeeded" ||
    report.process.exitCode !== 0 ||
    report.mutationUncertain
  ) {
    return classified(
      "invalid-output",
      "godot-capture-exit-outcome-mismatch",
      expectation,
      summary,
      validatedTranscript,
      unavailableArtifact,
    );
  }
  if (
    parsedExecution.artifact.status !== "available" ||
    payload.artifact === undefined
  ) {
    return classified(
      "artifact-unavailable",
      "godot-capture-artifact-unavailable",
      expectation,
      summary,
      validatedTranscript,
      unavailableArtifact,
    );
  }
  const artifact = assessGodotRuntimeFrameArtifact({
    transcript: parsed.transcript,
    attestation: {
      digest: parsedExecution.artifact.digest,
      bytes: parsedExecution.artifact.bytes,
    },
    content: payload.artifact,
  });
  if (artifact.status === "rejected") {
    return classified(
      "artifact-invalid",
      artifact.code,
      expectation,
      summary,
      validatedTranscript,
      artifact,
    );
  }
  const sessionIdentityDigest = digestCanonicalJson({
    domain: "ai-game-playbook/godot-runtime-frame-session",
    version: "1.0.0",
    runId: report.runId,
    reportDigest: report.reportDigest,
    requestDigest: report.requestDigest,
    snapshotBindingDigest: report.snapshotBindingDigest,
    projectSnapshotDigest: report.projectSnapshotDigest,
    executableSnapshotDigest: report.executableSnapshotDigest,
    inputBindingDigest: report.inputBindingDigest,
  });
  const frame = createGodotRuntimeFrameEvidence({
    transcript: parsed.transcript,
    artifact,
    projectIdentityDigest: report.request.project.rootIdentityDigest,
    sessionIdentityDigest,
    capturedAt: report.completedAt,
  });
  return classified(
    "capture-passed",
    "godot-capture-passed",
    expectation,
    summary,
    validatedTranscript,
    artifact,
    frame,
  );
}
