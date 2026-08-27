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
  processContainmentAssessmentReportSchema,
  processContainmentAssessmentRequestSchema,
} from "./process-containment-assessment-contracts.js";
import {
  processContainmentProviderDescriptorSchema,
  processContainmentSelfTestReportSchema,
  processContainmentSelfTestRequestSchema,
} from "./process-containment-provider-contracts.js";

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
    "build-artifact-evidence": buildArtifactEvidenceSchema,
    "doctor-report": doctorReportSchema,
    "doctor-request": doctorRequestSchema,
    "engine-status-report": engineStatusReportSchema,
    "engine-status-request": engineStatusRequestSchema,
    "godot-executable-discovery-report": godotExecutableDiscoveryReportSchema,
    "godot-executable-discovery-request": godotExecutableDiscoveryRequestSchema,
    "godot-headless-preflight-report": godotHeadlessPreflightReportSchema,
    "godot-headless-preflight-request": godotHeadlessPreflightRequestSchema,
    "godot-version-probe-report": godotVersionProbeReportSchema,
    "godot-version-probe-request": godotVersionProbeRequestSchema,
    "init-report": initReportSchema,
    "init-request": initRequestSchema,
    "project-inspect-report": projectInspectReportSchema,
    "project-inspect-request": projectInspectRequestSchema,
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
    "process-containment-provider-descriptor":
      processContainmentProviderDescriptorSchema,
    "process-containment-self-test-report":
      processContainmentSelfTestReportSchema,
    "process-containment-self-test-request":
      processContainmentSelfTestRequestSchema,
    "resolved-workflow-plan": resolvedWorkflowPlanSchema,
    "workflow-checkpoint": workflowCheckpointSchema,
    "run-handle": runHandleSchema,
    "runtime-frame-evidence": runtimeFrameEvidenceSchema,
    "task-routing-selection": taskRoutingSelectionSchema,
  });

export const ALL_CONTRACT_SCHEMAS: ContractSchemaCatalog = Object.freeze({
  ...PUBLIC_CONTRACT_SCHEMAS,
  ...ORCHESTRATION_DESCRIPTOR_SCHEMAS,
  ...FOUNDATION_PROTOCOL_SCHEMAS,
});
