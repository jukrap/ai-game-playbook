import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import { PLAYTEST_SCENARIO_MAX_ORACLES } from "./playtest-scenario-contracts.js";

export const GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX =
  "AGPB_RUNTIME_FRAME " as const;
export const GODOT_RUNTIME_FRAME_CAPTURE_MAX_LINE_BYTES = 65_536;
export const GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES = 1_048_576;
export const GODOT_RUNTIME_FRAME_CAPTURE_MAX_EVENTS: number =
  PLAYTEST_SCENARIO_MAX_ORACLES * 2 + 3;
export const GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_ID =
  "engine.runtime-frame-capture" as const;
export const GODOT_RUNTIME_FRAME_CAPTURE_WORKFLOW_ID =
  "workflow.godot-runtime-frame-capture" as const;
export const GODOT_RUNTIME_FRAME_CAPTURE_STEP_ID =
  "step.godot-runtime-frame-capture" as const;
export const GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS = 62_000;
export const GODOT_RUNTIME_FRAME_CAPTURE_PROCESS_TIMEOUT_MS = 45_000;
export const GODOT_RUNTIME_FRAME_CAPTURE_IDLE_TIMEOUT_MS = 20_000;
export const GODOT_RUNTIME_FRAME_CAPTURE_TERMINATION_GRACE_MS = 2_000;
export const GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES = 4_194_304;
export const GODOT_RUNTIME_FRAME_CAPTURE_ARTIFACT_FILE_NAME =
  "runtime-frame.png" as const;
export const GODOT_RUNTIME_FRAME_CAPTURE_ARTIFACT_PATH_TOKEN =
  "$profileLocalArtifact" as const;

export const GODOT_RUNTIME_FRAME_CAPTURE_ARGUMENTS: readonly string[] =
  Object.freeze([
    "--path",
    "$stagedProject",
    "--log-file",
    "$profileLocalLog",
    "--no-header",
    "--",
    "--agpb-runtime-frame",
    "--agpb-run-id",
    "$runId",
    "--agpb-input-binding",
    "$inputBindingDigest",
    "--agpb-artifact",
    GODOT_RUNTIME_FRAME_CAPTURE_ARTIFACT_PATH_TOKEN,
  ]);

const invocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  arguments: GODOT_RUNTIME_FRAME_CAPTURE_ARGUMENTS,
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
  networkCapabilities: "none" as const,
  projectSource: "disposable-copy" as const,
  processTimeoutMs: GODOT_RUNTIME_FRAME_CAPTURE_PROCESS_TIMEOUT_MS,
  idleTimeoutMs: GODOT_RUNTIME_FRAME_CAPTURE_IDLE_TIMEOUT_MS,
  terminationGraceMs: GODOT_RUNTIME_FRAME_CAPTURE_TERMINATION_GRACE_MS,
  maxOutputBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
  maxLineBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_LINE_BYTES,
  maxEvents: GODOT_RUNTIME_FRAME_CAPTURE_MAX_EVENTS,
  outputPrefix: GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX,
  artifact: Object.freeze({
    kind: "single-profile-file" as const,
    pathToken: GODOT_RUNTIME_FRAME_CAPTURE_ARTIFACT_PATH_TOKEN,
    fileName: GODOT_RUNTIME_FRAME_CAPTURE_ARTIFACT_FILE_NAME,
    format: "png" as const,
    maxBytes: GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    transfer: "same-process-one-use" as const,
  }),
});

export const GODOT_RUNTIME_FRAME_CAPTURE_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-runtime-frame-capture-invocation",
    version: "1.0.0",
    ...invocationSubject,
  });
