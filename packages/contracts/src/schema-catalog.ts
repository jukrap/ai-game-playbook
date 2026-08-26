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
import { resolvedWorkflowPlanSchema } from "./workflow-runtime-contracts.js";
import { workflowCheckpointSchema } from "./workflow-checkpoint-contracts.js";

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
    "engine-diagnostic": engineDiagnosticSchema,
    "engine-operation-request": engineOperationRequestSchema,
    "engine-operation-result": engineOperationResultSchema,
    "engine-project-identity": engineProjectIdentitySchema,
    "engine-session-identity": engineSessionIdentitySchema,
    "input-replay-trace": inputReplayTraceSchema,
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
