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
  roleLensDescriptorSchema,
  skillDescriptorSchema,
  workflowDescriptorSchema,
} from "./orchestration-contracts.js";
import {
  engineCapabilityReportSchema,
  gameProjectProfileSchema,
} from "./project-engine-contracts.js";

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

export const ALL_CONTRACT_SCHEMAS: ContractSchemaCatalog = Object.freeze({
  ...PUBLIC_CONTRACT_SCHEMAS,
  ...ORCHESTRATION_DESCRIPTOR_SCHEMAS,
});
