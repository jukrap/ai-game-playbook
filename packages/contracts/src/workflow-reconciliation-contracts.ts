import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type { SemanticVersion } from "./semantic-version.js";
import type { Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export const WORKFLOW_RECONCILIATION_COMMAND_ID =
  "workflow.evidence-reconcile" as StableId;
export const WORKFLOW_RECONCILIATION_WORKFLOW_ID =
  "workflow.evidence-reconciliation" as StableId;
export const WORKFLOW_RECONCILIATION_STEP_ID =
  "step.workflow-evidence-reconcile" as StableId;

export type WorkflowReconciliationTargetOutcome = "failed" | "succeeded";
export type WorkflowReconciliationTargetReceiptState = "missing" | "present";

export interface WorkflowReconciliationCommandInput {
  readonly schemaVersion: SemanticVersion;
  readonly reconciliationRunId: string;
  readonly targetRunId: string;
  readonly targetCheckpointDigest: Sha256Digest;
  readonly targetCheckpointHeadDigest: Sha256Digest;
  readonly targetWorkflowId: StableId;
  readonly targetResolvedPlanDigest: Sha256Digest;
  readonly targetCommandId: StableId;
  readonly targetInputDigest: Sha256Digest;
  readonly targetReceiptState: WorkflowReconciliationTargetReceiptState;
  readonly targetReceiptDigest?: Sha256Digest;
  readonly proofKind: StableId;
  readonly proofDigest: Sha256Digest;
  readonly targetOutcome: WorkflowReconciliationTargetOutcome;
  readonly planDigest: Sha256Digest;
}

export interface WorkflowReconciliationCommandOutput {
  readonly schemaVersion: SemanticVersion;
  readonly status: "reconciled";
  readonly reconciliationRunId: string;
  readonly targetRunId: string;
  readonly targetOutcome: WorkflowReconciliationTargetOutcome;
  readonly proofKind: StableId;
  readonly proofDigest: Sha256Digest;
  readonly reconciliationReceiptDigest: Sha256Digest;
  readonly targetCheckpointDigest: Sha256Digest;
  readonly targetCheckpointHeadDigest: Sha256Digest;
  readonly mutationReplayed: false;
}

const digestSchema = Object.freeze({
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
});

const stableIdSchema = Object.freeze({
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
  maxLength: 128,
});

const uuidSchema = Object.freeze({
  type: "string",
  pattern:
    "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
});

export const workflowReconciliationCommandInputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "workflow-reconciliation-input",
    version: "1.0.0",
    title: "Workflow Reconciliation Input",
    description:
      "Binds one separate reconciliation run to an uncertain workflow checkpoint, current receipt state, and complete domain proof without replaying the target mutation.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        reconciliationRunId: uuidSchema,
        targetRunId: uuidSchema,
        targetCheckpointDigest: digestSchema,
        targetCheckpointHeadDigest: digestSchema,
        targetWorkflowId: stableIdSchema,
        targetResolvedPlanDigest: digestSchema,
        targetCommandId: stableIdSchema,
        targetInputDigest: digestSchema,
        targetReceiptState: { enum: ["missing", "present"] },
        targetReceiptDigest: digestSchema,
        proofKind: stableIdSchema,
        proofDigest: digestSchema,
        targetOutcome: { enum: ["failed", "succeeded"] },
        planDigest: digestSchema,
      },
      required: [
        "schemaVersion",
        "reconciliationRunId",
        "targetRunId",
        "targetCheckpointDigest",
        "targetCheckpointHeadDigest",
        "targetWorkflowId",
        "targetResolvedPlanDigest",
        "targetCommandId",
        "targetInputDigest",
        "targetReceiptState",
        "proofKind",
        "proofDigest",
        "targetOutcome",
        "planDigest",
      ],
      additionalProperties: false,
      allOf: [
        {
          if: {
            properties: { targetReceiptState: { const: "present" } },
            required: ["targetReceiptState"],
          },
          then: {
            type: "object",
            properties: { targetReceiptDigest: digestSchema },
            required: ["targetReceiptDigest"],
          },
          else: { properties: { targetReceiptDigest: false } },
        },
      ],
    },
  });

export const workflowReconciliationCommandOutputSchema: VersionedContractSchema =
  defineContractSchema({
    id: "workflow-reconciliation-output",
    version: "1.0.0",
    title: "Workflow Reconciliation Output",
    description:
      "Reports one receipt-backed uncertain-workflow closure and explicitly denies target mutation replay.",
    schema: {
      type: "object",
      properties: {
        schemaVersion: { const: "1.0.0" },
        status: { const: "reconciled" },
        reconciliationRunId: uuidSchema,
        targetRunId: uuidSchema,
        targetOutcome: { enum: ["failed", "succeeded"] },
        proofKind: stableIdSchema,
        proofDigest: digestSchema,
        reconciliationReceiptDigest: digestSchema,
        targetCheckpointDigest: digestSchema,
        targetCheckpointHeadDigest: digestSchema,
        mutationReplayed: { const: false },
      },
      required: [
        "schemaVersion",
        "status",
        "reconciliationRunId",
        "targetRunId",
        "targetOutcome",
        "proofKind",
        "proofDigest",
        "reconciliationReceiptDigest",
        "targetCheckpointDigest",
        "targetCheckpointHeadDigest",
        "mutationReplayed",
      ],
      additionalProperties: false,
    },
  });
