import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type { SemanticVersion } from "./semantic-version.js";
import type { Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export const PACK_RECOVERY_COMMAND_ID = "pack.recover" as StableId;
export const PACK_RECOVERY_WORKFLOW_ID = "workflow.pack-recover" as StableId;
export const PACK_RECOVERY_WORKFLOW_STEP_ID = "step.pack-recover" as StableId;

export type PackRecoveryCommandAction =
  | "append-reconciliation"
  | "append-started-and-terminal"
  | "append-terminal"
  | "clear-marker";

export type PackRecoveryCommandOutcome =
  | "committed"
  | "failed"
  | "rolled-back";

export type PackRecoveryCommandStatus =
  | "failed"
  | "finalized"
  | "recovery-required"
  | "stale";

export interface PackRecoveryCommandInput {
  readonly schemaVersion: SemanticVersion;
  readonly recoveryRunId: string;
  readonly transactionRunId: string;
  readonly reportDigest: Sha256Digest;
  readonly journalSnapshotDigest: Sha256Digest;
  readonly action: PackRecoveryCommandAction;
  readonly finalOutcome: PackRecoveryCommandOutcome;
  readonly planDigest: Sha256Digest;
}

export interface PackRecoveryCommandOutput {
  readonly schemaVersion: SemanticVersion;
  readonly status: PackRecoveryCommandStatus;
  readonly recoveryRunId: string;
  readonly transactionRunId: string;
  readonly action: PackRecoveryCommandAction;
  readonly finalOutcome: PackRecoveryCommandOutcome;
  readonly reportDigest: Sha256Digest;
  readonly finalReportDigest?: Sha256Digest;
  readonly journalRecordDigest?: Sha256Digest;
  readonly planDigest: Sha256Digest;
  readonly receiptDigest: Sha256Digest;
  readonly mutationUncertain: boolean;
}

const digestSchema = Object.freeze({
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
});

const uuidSchema = Object.freeze({
  type: "string",
  pattern:
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

const actionSchema = Object.freeze({
  enum: [
    "append-reconciliation",
    "append-started-and-terminal",
    "append-terminal",
    "clear-marker",
  ],
});

const outcomeSchema = Object.freeze({
  enum: ["committed", "failed", "rolled-back"],
});

export const packRecoveryCommandInputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-recovery-input",
    version: "1.0.0",
    title: "Pack Recovery Input",
    description:
      "Digest-bound identity and action for one approved managed pack recovery closure.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        recoveryRunId: uuidSchema,
        transactionRunId: uuidSchema,
        reportDigest: digestSchema,
        journalSnapshotDigest: digestSchema,
        action: actionSchema,
        finalOutcome: outcomeSchema,
        planDigest: digestSchema,
      },
      required: [
        "schemaVersion",
        "recoveryRunId",
        "transactionRunId",
        "reportDigest",
        "journalSnapshotDigest",
        "action",
        "finalOutcome",
        "planDigest",
      ],
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { action: { const: "append-reconciliation" } },
            required: ["action"],
          },
          then: {
            properties: {
              finalOutcome: { enum: ["committed", "failed"] },
            },
          },
        },
      ],
    },
  });

export const packRecoveryCommandOutputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-recovery-output",
    version: "1.0.0",
    title: "Pack Recovery Output",
    description:
      "Bounded domain and evidence outcome for one managed pack recovery execution.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        status: {
          enum: ["failed", "finalized", "recovery-required", "stale"],
        },
        recoveryRunId: uuidSchema,
        transactionRunId: uuidSchema,
        action: actionSchema,
        finalOutcome: outcomeSchema,
        reportDigest: digestSchema,
        finalReportDigest: digestSchema,
        journalRecordDigest: digestSchema,
        planDigest: digestSchema,
        receiptDigest: digestSchema,
        mutationUncertain: { type: "boolean" },
      },
      required: [
        "schemaVersion",
        "status",
        "recoveryRunId",
        "transactionRunId",
        "action",
        "finalOutcome",
        "reportDigest",
        "planDigest",
        "receiptDigest",
        "mutationUncertain",
      ],
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { status: { const: "finalized" } },
            required: ["status"],
          },
          then: {
            properties: {
              mutationUncertain: { const: false },
              finalReportDigest: digestSchema,
              journalRecordDigest: digestSchema,
            },
            required: ["finalReportDigest", "journalRecordDigest"],
          },
        },
        {
          if: {
            properties: { status: { const: "recovery-required" } },
            required: ["status"],
          },
          then: {
            properties: { mutationUncertain: { const: true } },
          },
        },
        {
          if: {
            properties: { status: { enum: ["failed", "stale"] } },
            required: ["status"],
          },
          then: {
            properties: { mutationUncertain: { const: false } },
          },
        },
      ],
    },
  });
