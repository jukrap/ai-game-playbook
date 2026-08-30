export {
  WINDOWS_CONTAINMENT_PROVIDER_ID,
  WINDOWS_CONTAINMENT_PROVIDER_MAX_ARTIFACT_BYTES,
  WINDOWS_CONTAINMENT_PROVIDER_VERSION,
  loadPackagedWindowsContainmentProviderRuntime,
} from "./artifact.js";
export type {
  WindowsContainmentProviderRuntime,
} from "./artifact.js";
export {
  assertWindowsContainmentSelfTestWitness,
  consumeWindowsContainmentSelfTestReport,
  prepareWindowsContainmentSelfTest,
  runWindowsContainmentSelfTest,
} from "./self-test.js";
export type {
  ConsumeWindowsContainmentSelfTestReportRequest,
  PreparedWindowsContainmentSelfTest,
  PrepareWindowsContainmentSelfTestRequest,
  RunWindowsContainmentSelfTestRequest,
  WindowsContainmentSelfTestWitness,
} from "./self-test.js";
export {
  assertWindowsContainedSyntheticLaunchWitness,
  consumeWindowsContainedSyntheticLaunchReport,
  prepareWindowsContainedSyntheticLaunch,
  runWindowsContainedSyntheticLaunch,
} from "./launch.js";
export type {
  ConsumeWindowsContainedSyntheticLaunchReportRequest,
  PreparedWindowsContainedSyntheticLaunch,
  PrepareWindowsContainedSyntheticLaunchRequest,
  RunWindowsContainedSyntheticLaunchRequest,
  WindowsContainedSyntheticLaunchWitness,
} from "./launch.js";
export {
  assertWindowsContainedEngineAdmission,
  claimWindowsContainedEngineAdmissionForDispatch,
  createWindowsContainedEngineAdmission,
} from "./admission.js";
export type {
  AssertWindowsContainedEngineAdmissionRequest,
  CreateWindowsContainedEngineAdmissionRequest,
} from "./admission.js";
export {
  consumeWindowsContainedGodotReplayTranscript,
  consumeWindowsContainedGodotValidationTranscript,
  prepareWindowsContainedGodotEngineRun,
  prepareWindowsContainedGodotImportRun,
  prepareWindowsContainedGodotReplayRun,
  prepareWindowsContainedGodotValidationRun,
  runWindowsContainedGodotEngine,
  runWindowsContainedGodotImport,
  runWindowsContainedGodotReplay,
  runWindowsContainedGodotValidation,
} from "./engine-run.js";
export type {
  PreparedWindowsContainedGodotEngineRun,
  PreparedWindowsContainedGodotImportRun,
  PreparedWindowsContainedGodotReplayRun,
  PreparedWindowsContainedGodotValidationRun,
  PrepareWindowsContainedGodotEngineRunRequest,
  PrepareWindowsContainedGodotImportRunRequest,
  PrepareWindowsContainedGodotReplayRunRequest,
  PrepareWindowsContainedGodotValidationRunRequest,
  RunWindowsContainedGodotEngineRequest,
  RunWindowsContainedGodotImportRequest,
  RunWindowsContainedGodotReplayRequest,
  RunWindowsContainedGodotValidationRequest,
  WindowsContainedGodotReplayExecution,
  WindowsContainedGodotValidationExecution,
} from "./engine-run.js";
export { WindowsContainmentProviderError } from "./errors.js";
export type { WindowsContainmentProviderErrorCode } from "./errors.js";
