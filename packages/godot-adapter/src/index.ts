export { GodotAdapterBoundaryError } from "./errors.js";
export {
  GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
  classifyGodotDeterministicReplayResult,
  createGodotDeterministicReplayExpectation,
  parseGodotDeterministicReplayOutput,
} from "./deterministic-replay-result.js";
export type {
  GodotDeterministicReplayExpectation,
  GodotDeterministicReplayInputExpectation,
  GodotDeterministicReplayOracleExpectation,
  GodotDeterministicReplayOutput,
  GodotDeterministicReplayOutputAttestation,
  GodotDeterministicReplayOutputInvalidCode,
  GodotDeterministicReplayResult,
  GodotDeterministicReplayResultCode,
  GodotDeterministicReplayResultStatus,
  InvalidGodotDeterministicReplayOutput,
  ParsedGodotDeterministicReplayOutput,
} from "./deterministic-replay-result.js";
export {
  GODOT_RUNTIME_FRAME_CAPTURE_CAMERA_ID,
  GODOT_RUNTIME_FRAME_CAPTURE_MAX_DECODED_BYTES,
  GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX,
  GODOT_RUNTIME_FRAME_CAPTURE_RENDERER,
  GODOT_RUNTIME_FRAME_CAPTURE_VIEWPORT,
  assessGodotRuntimeFrameArtifact,
  classifyGodotRuntimeFrameCaptureExecution,
  consumeGodotRuntimeFrameArtifactBytes,
  createGodotRuntimeFrameCaptureExpectation,
  createGodotRuntimeFrameEvidence,
  parseGodotRuntimeFrameCaptureOutput,
} from "./runtime-frame-capture-result.js";
export type {
  CreateGodotRuntimeFrameCaptureExpectationRequest,
  CreateGodotRuntimeFrameEvidenceRequest,
  GodotRuntimeFrameArtifactAssessment,
  GodotRuntimeFrameArtifactAssessmentCode,
  GodotRuntimeFrameCaptureExecutionSummary,
  GodotRuntimeFrameCaptureExpectation,
  GodotRuntimeFrameCaptureFailedEvent,
  GodotRuntimeFrameCaptureFailureCode,
  GodotRuntimeFrameCaptureOutput,
  GodotRuntimeFrameCaptureOutputInvalidCode,
  GodotRuntimeFrameCapturePassedEvent,
  GodotRuntimeFrameCaptureResult,
  GodotRuntimeFrameCaptureResultCode,
  GodotRuntimeFrameCaptureResultStatus,
  GodotRuntimeFrameCaptureStartedEvent,
  GodotRuntimeFrameCaptureTerminalEvent,
  GodotRuntimeFrameCaptureTranscript,
  GodotRuntimeFrameCaptureWireAttestation,
  InvalidGodotRuntimeFrameCaptureOutput,
  ParsedGodotRuntimeFrameCaptureOutput,
  RejectedGodotRuntimeFrameArtifact,
  ValidatedGodotRuntimeFrameArtifact,
} from "./runtime-frame-capture-result.js";
export {
  assertPreparedGodotContainedRuntimeFrameCapture,
  createGodotContainedRuntimeFrameCaptureAuthorizationRequest,
  isGodotContainedRuntimeFrameCaptureRunRequest,
  prepareGodotContainedRuntimeFrameCapture,
  runGodotContainedRuntimeFrameCapture,
  runGodotRuntimeFrameCapture,
} from "./contained-runtime-frame-capture.js";
export type {
  CreateGodotContainedRuntimeFrameCaptureAuthorizationRequest,
  PrepareGodotContainedRuntimeFrameCaptureRequest,
  PreparedGodotContainedRuntimeFrameCapture,
  RunGodotContainedRuntimeFrameCaptureRequest,
} from "./contained-runtime-frame-capture.js";
export {
  GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX,
  createGodotProjectValidationExpectation,
  parseGodotProjectValidationOutput,
} from "./project-validation-result.js";
export {
  GODOT_PERSISTENCE_CYCLE_OUTPUT_PREFIX,
  createGodotPersistenceCycleExpectation,
  parseGodotPersistenceCycleOutput,
} from "./persistence-cycle-result.js";
export type {
  GodotPersistenceCycleExpectationInput,
  GodotPersistenceCycleOutput,
  GodotPersistenceCycleOutputInvalidCode,
  InvalidGodotPersistenceCycleOutput,
  ParsedGodotPersistenceCycleOutput,
} from "./persistence-cycle-result.js";
export type {
  GodotProjectValidationExpectationInput,
  GodotProjectValidationOutput,
  GodotProjectValidationOutputInvalidCode,
  InvalidGodotProjectValidationOutput,
  ParsedGodotProjectValidationOutput,
} from "./project-validation-result.js";
export {
  GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  GODOT_GRAYBOX_FRESH_STATE_HASH,
  GODOT_GRAYBOX_PERSISTED_STATE_HASH,
  GODOT_GRAYBOX_SCENARIO_DIGEST,
  GODOT_GRAYBOX_TARGET_VERSION,
  verifyGodotGrayboxProjectBundle,
  verifyGodotGrayboxProjectRoot,
} from "./graybox-project.js";
export type {
  GodotGrayboxFeature,
  GodotGrayboxProjectManifest,
  GodotGrayboxProjectReport,
  GodotGrayboxSourceDescriptor,
  GodotGrayboxSourceRole,
  GodotGrayboxSourceText,
  VerifyGodotGrayboxProjectBundleRequest,
  VerifyGodotGrayboxProjectRootRequest,
} from "./graybox-project.js";
export { runGodotEngineCapabilities } from "./capabilities.js";
export {
  GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID,
  GODOT_EXECUTABLE_DISCOVERY_COMMAND_TIMEOUT_MS,
  GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
  createGodotExecutableDiscoveryAuthorizationRequest,
  prepareGodotExecutableDiscovery,
  runGodotExecutableDiscovery,
} from "./executable-discovery.js";
export type {
  CreateGodotExecutableDiscoveryAuthorizationRequest,
  PrepareGodotExecutableDiscoveryRequest,
  PreparedGodotExecutableDiscovery,
  RunGodotExecutableDiscoveryRequest,
} from "./executable-discovery.js";
export {
  GODOT_STATUS_TARGET_VERSION,
  runGodotEngineStatus,
} from "./status.js";
export {
  GODOT_VERSION_OUTPUT_MAX_BYTES,
  GODOT_VERSION_TARGET_RELEASE_STATUS,
  classifyGodotVersionProbeResult,
  parseGodotVersionOutput,
} from "./version-probe-result.js";
export type {
  GodotVersionOutput,
  GodotVersionOutputInvalidCode,
  GodotVersionProbeCode,
  GodotVersionProbeOutputAttestation,
  GodotVersionProbeResult,
  GodotVersionProbeStatus,
  InvalidGodotVersionOutput,
  ParsedGodotVersionOutput,
} from "./version-probe-result.js";
export {
  GODOT_VERSION_PROBE_COMMAND_ID,
  GODOT_VERSION_PROBE_COMMAND_TIMEOUT_MS,
  GODOT_VERSION_PROBE_IDLE_TIMEOUT_MS,
  GODOT_VERSION_PROBE_PROCESS_TIMEOUT_MS,
  GODOT_VERSION_PROBE_TERMINATION_GRACE_MS,
  createGodotVersionProbeAuthorizationRequest,
  prepareGodotVersionProbeFromDiscovery,
  runGodotVersionProbe,
} from "./version-probe.js";
export type {
  CreateGodotVersionProbeAuthorizationRequest,
  PrepareGodotVersionProbeFromDiscoveryRequest,
  PreparedGodotVersionProbe,
  RunGodotVersionProbeRequest,
} from "./version-probe.js";
export {
  GODOT_HEADLESS_PREFLIGHT_COMMAND_ID,
  GODOT_HEADLESS_PREFLIGHT_STEP_ID,
  GODOT_HEADLESS_PREFLIGHT_WORKFLOW_ID,
  createGodotHeadlessPreflightAuthorizationRequest,
  prepareGodotHeadlessPreflightFromVersionProbe,
  runGodotHeadlessPreflight,
} from "./headless-preflight.js";
export type {
  CreateGodotHeadlessPreflightAuthorizationRequest,
  PrepareGodotHeadlessPreflightFromVersionProbeRequest,
  PreparedGodotHeadlessPreflight,
  RunGodotHeadlessPreflightRequest,
} from "./headless-preflight.js";
export {
  assertPreparedGodotContainedHeadlessAdmission,
  createGodotContainedHeadlessAuthorizationRequest,
  isGodotContainedHeadlessRunRequest,
  prepareGodotContainedHeadlessAdmissionFromVersionProbe,
  runGodotContainedHeadless,
} from "./contained-headless-admission.js";
export type {
  BlockedGodotContainedHeadlessAdmission,
  CreateGodotContainedHeadlessAuthorizationRequest,
  GodotContainedHeadlessAdmissionBlocker,
  PrepareGodotContainedHeadlessAdmissionFromVersionProbeRequest,
  PreparedGodotContainedHeadlessAdmission,
  ReadyGodotContainedHeadlessAdmission,
  RunGodotContainedHeadlessRequest,
} from "./contained-headless-admission.js";
export {
  assertPreparedGodotContainedDeterministicReplay,
  consumeGodotContainedDeterministicReplayTranscript,
  createGodotContainedDeterministicReplayAuthorizationRequest,
  isGodotContainedDeterministicReplayRunRequest,
  prepareGodotContainedDeterministicReplay,
  runGodotContainedDeterministicReplay,
  runGodotDeterministicReplay,
} from "./contained-deterministic-replay.js";
export type {
  CreateGodotContainedDeterministicReplayAuthorizationRequest,
  PrepareGodotContainedDeterministicReplayRequest,
  PreparedGodotContainedDeterministicReplay,
  RunGodotContainedDeterministicReplayRequest,
} from "./contained-deterministic-replay.js";
export {
  assertPreparedGodotContainedPersistenceCycle,
  consumeGodotContainedPersistenceCycleTranscript,
  createGodotContainedPersistenceCycleAuthorizationRequest,
  isGodotContainedPersistenceCycleRunRequest,
  prepareGodotContainedPersistenceCycle,
  runGodotContainedPersistenceCycle,
  runGodotPersistenceCycle,
} from "./contained-persistence-cycle.js";
export type {
  CreateGodotContainedPersistenceCycleAuthorizationRequest,
  PrepareGodotContainedPersistenceCycleRequest,
  PreparedGodotContainedPersistenceCycle,
  RunGodotContainedPersistenceCycleRequest,
} from "./contained-persistence-cycle.js";
export {
  assertPreparedGodotContainedProjectImport,
  assertPreparedGodotContainedProjectValidation,
  consumeGodotContainedProjectValidationTranscript,
  createGodotContainedProjectImportAuthorizationRequest,
  createGodotContainedProjectValidationAuthorizationRequest,
  isGodotContainedProjectImportRunRequest,
  isGodotContainedProjectValidationRunRequest,
  prepareGodotContainedProjectImport,
  prepareGodotContainedProjectValidation,
  runGodotContainedProjectImport,
  runGodotContainedProjectValidation,
  runGodotProjectImport,
  runGodotProjectValidation,
} from "./contained-project-validation.js";
export type {
  CreateGodotContainedProjectImportAuthorizationRequest,
  CreateGodotContainedProjectValidationAuthorizationRequest,
  PrepareGodotContainedProjectImportRequest,
  PrepareGodotContainedProjectValidationRequest,
  PreparedGodotContainedProjectImport,
  PreparedGodotContainedProjectValidation,
  RunGodotContainedProjectImportRequest,
  RunGodotContainedProjectValidationRequest,
} from "./contained-project-validation.js";
