import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type { ProjectStage } from "./contract-vocabulary.js";
import type { Sha256Digest } from "./digest.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";

export type TaskRoutingSource = "user" | "model";

export interface TaskRoutingSelection {
  readonly schemaVersion: SemanticVersion;
  readonly selectionId: string;
  readonly registryDigest: Sha256Digest;
  readonly projectId: StableId;
  readonly stage: ProjectStage;
  readonly source: TaskRoutingSource;
  readonly skills: readonly StableId[];
  readonly roleLenses: readonly StableId[];
  readonly rationaleDigest: Sha256Digest;
  readonly selectedAt: string;
}

export const taskRoutingSelectionSchema: VersionedContractSchema =
  defineContractSchema({
    id: "task-routing-selection",
    version: "1.0.0",
    title: "Task Routing Selection",
    description:
      "Binds a bounded skill and role-lens selection to one registry, project stage, source, and rationale.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        selectionId: reference("uuid"),
        registryDigest: reference("sha256Digest"),
        projectId: reference("stableId"),
        stage: reference("projectStage"),
        source: enumSchema(["user", "model"]),
        skills: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 5,
          unique: true,
        }),
        roleLenses: boundedArray(reference("stableId"), {
          maximum: 3,
          unique: true,
        }),
        rationaleDigest: reference("sha256Digest"),
        selectedAt: reference("timestamp"),
      },
      [
        "schemaVersion",
        "selectionId",
        "registryDigest",
        "projectId",
        "stage",
        "source",
        "skills",
        "roleLenses",
        "rationaleDigest",
        "selectedAt",
      ],
    ),
  });
