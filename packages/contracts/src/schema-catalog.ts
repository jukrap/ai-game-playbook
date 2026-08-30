import {
  commandDescriptorSchema,
  packManifestSchema,
} from "./command-pack-contracts.js";
import type { VersionedContractSchema } from "./contract-schema.js";
import {
  assetProvenanceSchema,
  featureContractSchema,
  runReceiptSchema,
} from "./feature-evidence-contracts.js";
import {
  buildArtifactEvidenceSchema,
  inputReplayTraceSchema,
  runtimeFrameEvidenceSchema,
} from "./engine-evidence-contracts.js";
import {
  playtestScenarioBindingSchema,
  playtestScenarioSchema,
} from "./playtest-scenario-contracts.js";
import {
  engineExecutableSnapshotSchema,
  engineExecutionSnapshotBindingSchema,
  engineProjectSnapshotSchema,
} from "./engine-execution-snapshot-contracts.js";
import {
  roleLensDescriptorSchema,
  skillDescriptorSchema,
  workflowDescriptorSchema,
} from "./orchestration-contracts.js";
import {
  engineCapabilityReportSchema,
  gameProjectProfileSchema,
} from "./project-engine-contracts.js";
import {
  engineDiagnosticSchema,
  engineOperationRequestSchema,
  engineOperationResultSchema,
  engineProjectIdentitySchema,
  engineSessionIdentitySchema,
  runHandleSchema,
} from "./run-engine-contracts.js";
import { approvalGrantSchema } from "./approval-contracts.js";
import { approvalPromptSchema } from "./approval-prompt-contracts.js";
import {
  approvalSessionChallengeSchema,
  approvalSessionResponseSchema,
} from "./approval-session-contracts.js";
import { taskRoutingSelectionSchema } from "./routing-contracts.js";
import {
  doctorReportSchema,
  doctorRequestSchema,
} from "./doctor-contracts.js";
import { initReportSchema, initRequestSchema } from "./init-contracts.js";
import {
  projectInspectReportSchema,
  projectInspectRequestSchema,
} from "./project-inspect-contracts.js";
import { resolvedWorkflowPlanSchema } from "./workflow-runtime-contracts.js";
import { workflowCheckpointSchema } from "./workflow-checkpoint-contracts.js";
import {
  skillCheckReportSchema,
  skillCheckRequestSchema,
  skillListReportSchema,
  skillListRequestSchema,
} from "./skill-catalog-contracts.js";
import {
  engineStatusReportSchema,
  engineStatusRequestSchema,
} from "./engine-status-contracts.js";
import {
  engineCapabilitiesReportSchema,
  engineCapabilitiesRequestSchema,
} from "./engine-capabilities-contracts.js";
import {
  godotExecutableDiscoveryReportSchema,
  godotExecutableDiscoveryRequestSchema,
} from "./godot-executable-discovery-contracts.js";
import {
  godotVersionProbeReportSchema,
  godotVersionProbeRequestSchema,
} from "./godot-version-probe-contracts.js";
import {
  godotHeadlessPreflightReportSchema,
  godotHeadlessPreflightRequestSchema,
} from "./godot-headless-preflight-contracts.js";
import {
  godotProjectValidationExpectationSchema,
  godotProjectValidationTranscriptSchema,
} from "./godot-project-validation-contracts.js";
import {
  godotPersistenceCycleExpectationSchema,
  godotPersistenceCycleTranscriptSchema,
} from "./godot-persistence-cycle-contracts.js";
import { godotPersistenceCycleReportSchema } from "./godot-persistence-cycle-report-contracts.js";
import {
  godotProjectImportReportSchema,
  godotProjectValidationReportSchema,
} from "./godot-project-validation-report-contracts.js";
import { godotDeterministicReplayTranscriptSchema } from "./godot-deterministic-replay-contracts.js";
import { godotDeterministicReplayReportSchema } from "./godot-deterministic-replay-report-contracts.js";
import {
  processContainmentAssessmentReportSchema,
  processContainmentAssessmentRequestSchema,
} from "./process-containment-assessment-contracts.js";
import {
  processContainmentProviderDescriptorSchema,
  processContainmentSelfTestReportSchema,
  processContainmentSelfTestRequestSchema,
} from "./process-containment-provider-contracts.js";
import {
  processContainmentLaunchReportSchema,
  processContainmentLaunchRequestSchema,
} from "./process-containment-launch-contracts.js";
import {
  processContainmentEngineAdmissionSchema,
} from "./process-containment-engine-admission-contracts.js";
import {
  processContainmentEngineExecutionProfileSchema,
} from "./process-containment-engine-execution-profile-contracts.js";
import {
  processContainmentEngineRunReportSchema,
  processContainmentEngineRunRequestSchema,
} from "./process-containment-engine-run-contracts.js";
import {
  packDoctorReportSchema,
  packDoctorRequestSchema,
  packListReportSchema,
  packListRequestSchema,
} from "./pack-inspection-contracts.js";
import {
  packOperationCommandInputSchema,
  packOperationCommandOutputSchema,
} from "./pack-operation-command-contracts.js";
import {
  packRecoveryCommandInputSchema,
  packRecoveryCommandOutputSchema,
} from "./pack-recovery-command-contracts.js";
import { projectPackLockSchema } from "./project-pack-lock-contracts.js";
import {
  projectInitializationCommandInputSchema,
  projectInitializationReportSchema,
} from "./project-initialization-command-contracts.js";
import {
  projectInitializationRecoveryReportSchema,
  projectInitializationRecoveryRequestSchema,
} from "./project-initialization-recovery-contracts.js";
import {
  workflowReconciliationCommandInputSchema,
  workflowReconciliationCommandOutputSchema,
} from "./workflow-reconciliation-contracts.js";

export type ContractSchemaCatalog = Readonly<
  Record<string, VersionedContractSchema>
>;

export const PUBLIC_CONTRACT_SCHEMAS: ContractSchemaCatalog = Object.freeze({
  "asset-provenance": assetProvenanceSchema,
  "command-descriptor": commandDescriptorSchema,
  "engine-capability-report": engineCapabilityReportSchema,
  "feature-contract": featureContractSchema,
  "game-project-profile": gameProjectProfileSchema,
  "pack-manifest": packManifestSchema,
  "project-pack-lock": projectPackLockSchema,
  "run-receipt": runReceiptSchema,
});

export const ORCHESTRATION_DESCRIPTOR_SCHEMAS: ContractSchemaCatalog =
  Object.freeze({
    "role-lens-descriptor": roleLensDescriptorSchema,
    "skill-descriptor": skillDescriptorSchema,
    "workflow-descriptor": workflowDescriptorSchema,
  });

export const FOUNDATION_PROTOCOL_SCHEMAS: ContractSchemaCatalog =
  Object.freeze({
    "approval-grant": approvalGrantSchema,
    "approval-prompt": approvalPromptSchema,
    "approval-session-challenge": approvalSessionChallengeSchema,
    "approval-session-response": approvalSessionResponseSchema,
    "build-artifact-evidence": buildArtifactEvidenceSchema,
    "doctor-report": doctorReportSchema,
    "doctor-request": doctorRequestSchema,
    "engine-capabilities-report": engineCapabilitiesReportSchema,
    "engine-capabilities-request": engineCapabilitiesRequestSchema,
    "engine-executable-snapshot": engineExecutableSnapshotSchema,
    "engine-execution-snapshot-binding": engineExecutionSnapshotBindingSchema,
    "engine-project-snapshot": engineProjectSnapshotSchema,
    "engine-status-report": engineStatusReportSchema,
    "engine-status-request": engineStatusRequestSchema,
    "godot-executable-discovery-report": godotExecutableDiscoveryReportSchema,
    "godot-executable-discovery-request": godotExecutableDiscoveryRequestSchema,
    "godot-headless-preflight-report": godotHeadlessPreflightReportSchema,
    "godot-headless-preflight-request": godotHeadlessPreflightRequestSchema,
    "godot-persistence-cycle-expectation":
      godotPersistenceCycleExpectationSchema,
    "godot-persistence-cycle-report": godotPersistenceCycleReportSchema,
    "godot-persistence-cycle-transcript":
      godotPersistenceCycleTranscriptSchema,
    "godot-project-validation-expectation":
      godotProjectValidationExpectationSchema,
    "godot-project-import-report": godotProjectImportReportSchema,
    "godot-project-validation-report": godotProjectValidationReportSchema,
    "godot-project-validation-transcript":
      godotProjectValidationTranscriptSchema,
    "godot-deterministic-replay-report":
      godotDeterministicReplayReportSchema,
    "godot-deterministic-replay-transcript":
      godotDeterministicReplayTranscriptSchema,
    "godot-version-probe-report": godotVersionProbeReportSchema,
    "godot-version-probe-request": godotVersionProbeRequestSchema,
    "init-report": initReportSchema,
    "init-request": initRequestSchema,
    "pack-doctor-report": packDoctorReportSchema,
    "pack-doctor-request": packDoctorRequestSchema,
    "pack-list-report": packListReportSchema,
    "pack-list-request": packListRequestSchema,
    "pack-operation-input": packOperationCommandInputSchema,
    "pack-operation-output": packOperationCommandOutputSchema,
    "pack-recovery-input": packRecoveryCommandInputSchema,
    "pack-recovery-output": packRecoveryCommandOutputSchema,
    "playtest-scenario-binding": playtestScenarioBindingSchema,
    "playtest-scenario": playtestScenarioSchema,
    "project-inspect-report": projectInspectReportSchema,
    "project-inspect-request": projectInspectRequestSchema,
    "project-initialization-command-input":
      projectInitializationCommandInputSchema,
    "project-initialization-report": projectInitializationReportSchema,
    "project-initialization-recovery-report":
      projectInitializationRecoveryReportSchema,
    "project-initialization-recovery-request":
      projectInitializationRecoveryRequestSchema,
    "skill-check-report": skillCheckReportSchema,
    "skill-check-request": skillCheckRequestSchema,
    "skill-list-report": skillListReportSchema,
    "skill-list-request": skillListRequestSchema,
    "engine-diagnostic": engineDiagnosticSchema,
    "engine-operation-request": engineOperationRequestSchema,
    "engine-operation-result": engineOperationResultSchema,
    "engine-project-identity": engineProjectIdentitySchema,
    "engine-session-identity": engineSessionIdentitySchema,
    "input-replay-trace": inputReplayTraceSchema,
    "process-containment-assessment-report":
      processContainmentAssessmentReportSchema,
    "process-containment-assessment-request":
      processContainmentAssessmentRequestSchema,
    "process-containment-engine-admission":
      processContainmentEngineAdmissionSchema,
    "process-containment-engine-execution-profile":
      processContainmentEngineExecutionProfileSchema,
    "process-containment-engine-run-report":
      processContainmentEngineRunReportSchema,
    "process-containment-engine-run-request":
      processContainmentEngineRunRequestSchema,
    "process-containment-provider-descriptor":
      processContainmentProviderDescriptorSchema,
    "process-containment-launch-report":
      processContainmentLaunchReportSchema,
    "process-containment-launch-request":
      processContainmentLaunchRequestSchema,
    "process-containment-self-test-report":
      processContainmentSelfTestReportSchema,
    "process-containment-self-test-request":
      processContainmentSelfTestRequestSchema,
    "resolved-workflow-plan": resolvedWorkflowPlanSchema,
    "workflow-checkpoint": workflowCheckpointSchema,
    "workflow-reconciliation-input": workflowReconciliationCommandInputSchema,
    "workflow-reconciliation-output": workflowReconciliationCommandOutputSchema,
    "run-handle": runHandleSchema,
    "runtime-frame-evidence": runtimeFrameEvidenceSchema,
    "task-routing-selection": taskRoutingSelectionSchema,
  });

export const ALL_CONTRACT_SCHEMAS: ContractSchemaCatalog = Object.freeze({
  ...PUBLIC_CONTRACT_SCHEMAS,
  ...ORCHESTRATION_DESCRIPTOR_SCHEMAS,
  ...FOUNDATION_PROTOCOL_SCHEMAS,
});
