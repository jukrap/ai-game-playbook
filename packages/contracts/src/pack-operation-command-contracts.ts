import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type { SemanticVersion } from "./semantic-version.js";
import type { Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export type PackOperationCommandKind = "add" | "remove" | "update";

export const PACK_OPERATION_COMMAND_IDS: Readonly<
  Record<PackOperationCommandKind, StableId>
> = Object.freeze({
  add: "pack.add" as StableId,
  remove: "pack.remove" as StableId,
  update: "pack.update" as StableId,
});

export interface PackOperationCommandInput {
  readonly schemaVersion: SemanticVersion;
  readonly operation: PackOperationCommandKind;
  readonly packId: StableId;
  readonly planDigest: Sha256Digest;
}

export interface PackOperationCommandOutput {
  readonly schemaVersion: SemanticVersion;
  readonly status:
    | "failed"
    | "no-op"
    | "recovery-required"
    | "rolled-back"
    | "succeeded";
  readonly planDigest: Sha256Digest;
}

const digestSchema = Object.freeze({
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
});

export const packOperationCommandInputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-operation-input",
    version: "1.0.0",
    title: "Pack Operation Input",
    description: "Digest-bound input for one managed pack operation.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        operation: { enum: ["add", "remove", "update"] },
        packId: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          pattern: "^[a-z0-9]+(?:[.-][a-z0-9]+)*$",
        },
        planDigest: digestSchema,
      },
      required: ["schemaVersion", "operation", "packId", "planDigest"],
      additionalProperties: false,
    },
  });

export const packOperationCommandOutputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-operation-output",
    version: "1.0.0",
    title: "Pack Operation Output",
    description: "Bounded outcome for one managed pack operation.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        status: {
          enum: [
            "failed",
            "no-op",
            "recovery-required",
            "rolled-back",
            "succeeded",
          ],
        },
        planDigest: digestSchema,
      },
      required: ["schemaVersion", "status", "planDigest"],
      additionalProperties: false,
    },
  });
