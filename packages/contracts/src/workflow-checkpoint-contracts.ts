import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type {
  DecimalAmount,
  ProjectStage,
} from "./contract-vocabulary.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";
import type { ResolvedWorkflowCommand } from "./workflow-runtime-contracts.js";

export type WorkflowCheckpointStatus =
  | "prepared"
  | "running"
  | "waiting-approval"
  | "waiting-restart"
  | "waiting-rollback"
  | "rolling-back"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "uncertain"
  | "expired"
  | "archived";

export type WorkflowCheckpointAttemptPhase = "command" | "rollback";
export type WorkflowCheckpointAttemptOutcome =
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "uncertain"
  | "continued"
  | "rolled-back";

export type WorkflowCheckpointSideEffect =
  | "not-started"
  | "started"
  | "confirmed"
  | "rolled-back"
  | "uncertain";

export interface WorkflowCheckpointAttempt {
  readonly stepId: StableId;
  readonly ordinal: number;
  readonly attempt: number;
  readonly phase: WorkflowCheckpointAttemptPhase;
  readonly outcome: WorkflowCheckpointAttemptOutcome;
  readonly receiptDigest: Sha256Digest;
}

export interface WorkflowCheckpointInFlight {
  readonly stepId: StableId;
  readonly ordinal: number;
  readonly attempt: number;
  readonly phase: WorkflowCheckpointAttemptPhase;
  readonly command: ResolvedWorkflowCommand;
  readonly inputDigest: Sha256Digest;
  readonly authorizationId: string;
  readonly authorizationRequestDigest: Sha256Digest;
  readonly authorizationExpiresAt: string;
  readonly approvalIds: readonly StableId[];
  readonly sideEffect: WorkflowCheckpointSideEffect;
}

export interface WorkflowCheckpointBudgetUsage {
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly changedFiles: number;
  readonly changedBytes: number;
  readonly repairCycles: number;
  readonly cost?: {
    readonly currency: string;
    readonly amount: DecimalAmount;
  };
}

export interface WorkflowCheckpointReconciliation {
  readonly reconciliationRunId: string;
  readonly workflowId: StableId;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly receiptDigest: Sha256Digest;
  readonly proofKind: StableId;
  readonly proofDigest: Sha256Digest;
  readonly targetCheckpointHeadDigest: Sha256Digest;
  readonly targetReceiptState: "missing" | "present";
  readonly targetReceiptDigest?: Sha256Digest;
  readonly outcome: "failed" | "succeeded";
  readonly reconciledAt: string;
}

export interface WorkflowCheckpointRecord {
  readonly schemaVersion: SemanticVersion;
  readonly checkpointId: string;
  readonly sequence: number;
  readonly identity: {
    readonly runId: string;
    readonly projectId: StableId;
    readonly projectIdentityDigest: Sha256Digest;
    readonly projectRootIdentityDigest?: Sha256Digest;
    readonly projectStage: ProjectStage;
    readonly featureId?: StableId;
    readonly featureContractDigest?: Sha256Digest;
    readonly registryDigest: Sha256Digest;
    readonly workflow: {
      readonly id: StableId;
      readonly version: SemanticVersion;
      readonly resolvedPlanDigest: Sha256Digest;
    };
    readonly inputDigest: Sha256Digest;
  };
  readonly status: WorkflowCheckpointStatus;
  readonly nextOrdinal: number;
  readonly attempts: readonly WorkflowCheckpointAttempt[];
  readonly inFlight?: WorkflowCheckpointInFlight;
  readonly budgetUsage: WorkflowCheckpointBudgetUsage;
  readonly evidenceKinds: readonly StableId[];
  readonly artifactDigests: readonly Sha256Digest[];
  readonly receiptChainHead?: Sha256Digest;
  readonly reconciliation?: WorkflowCheckpointReconciliation;
  readonly dirtyStateDigest?: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly parentCheckpointDigest?: Sha256Digest;
  readonly checkpointDigest: Sha256Digest;
}

export type WorkflowCheckpointDigestInput = Omit<
  WorkflowCheckpointRecord,
  "checkpointDigest"
> &
  Partial<Pick<WorkflowCheckpointRecord, "checkpointDigest">>;

export function computeWorkflowCheckpointDigest(
  checkpoint: WorkflowCheckpointDigestInput,
): Sha256Digest {
  const { checkpointDigest: _checkpointDigest, ...subject } = checkpoint;
  return digestCanonicalJson({
    domain: "ai-game-playbook.workflow-checkpoint",
    version: "1",
    subject,
  });
}

export function isWorkflowCheckpointDigestValid(
  checkpoint: WorkflowCheckpointRecord,
): boolean {
  try {
    return (
      computeWorkflowCheckpointDigest(checkpoint) ===
      checkpoint.checkpointDigest
    );
  } catch {
    return false;
  }
}

const checkpointWorkflowIdentity = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    resolvedPlanDigest: reference("sha256Digest"),
  },
  ["id", "version", "resolvedPlanDigest"],
);

const checkpointIdentity = closedObject(
  {
    runId: reference("uuid"),
    projectId: reference("stableId"),
    projectIdentityDigest: reference("sha256Digest"),
    projectRootIdentityDigest: reference("sha256Digest"),
    projectStage: reference("projectStage"),
    featureId: reference("stableId"),
    featureContractDigest: reference("sha256Digest"),
    registryDigest: reference("sha256Digest"),
    workflow: checkpointWorkflowIdentity,
    inputDigest: reference("sha256Digest"),
  },
  [
    "runId",
    "projectId",
    "projectIdentityDigest",
    "projectStage",
    "registryDigest",
    "workflow",
    "inputDigest",
  ],
);

const checkpointCommand = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    descriptorDigest: reference("sha256Digest"),
    handlerDigest: reference("sha256Digest"),
    lane: reference("executionLane"),
    permissions: boundedArray(reference("permissionClass"), {
      maximum: 11,
      unique: true,
    }),
  },
  [
    "id",
    "version",
    "descriptorDigest",
    "handlerDigest",
    "lane",
    "permissions",
  ],
);

const checkpointAttempt = closedObject(
  {
    stepId: reference("stableId"),
    ordinal: { type: "integer", minimum: 0, maximum: 255 },
    attempt: { type: "integer", minimum: 1, maximum: 100 },
    phase: enumSchema(["command", "rollback"]),
    outcome: enumSchema([
      "succeeded",
      "failed",
      "blocked",
      "cancelled",
      "uncertain",
      "continued",
      "rolled-back",
    ]),
    receiptDigest: reference("sha256Digest"),
  },
  ["stepId", "ordinal", "attempt", "phase", "outcome", "receiptDigest"],
);

const checkpointInFlight = closedObject(
  {
    stepId: reference("stableId"),
    ordinal: { type: "integer", minimum: 0, maximum: 255 },
    attempt: { type: "integer", minimum: 1, maximum: 100 },
    phase: enumSchema(["command", "rollback"]),
    command: checkpointCommand,
    inputDigest: reference("sha256Digest"),
    authorizationId: reference("uuid"),
    authorizationRequestDigest: reference("sha256Digest"),
    authorizationExpiresAt: reference("timestamp"),
    approvalIds: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
    sideEffect: enumSchema([
      "not-started",
      "started",
      "confirmed",
      "rolled-back",
      "uncertain",
    ]),
  },
  [
    "stepId",
    "ordinal",
    "attempt",
    "phase",
    "command",
    "inputDigest",
    "authorizationId",
    "authorizationRequestDigest",
    "authorizationExpiresAt",
    "approvalIds",
    "sideEffect",
  ],
);

const checkpointBudgetUsage = closedObject(
  {
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
    outputBytes: { type: "integer", minimum: 0, maximum: 1073741824 },
    changedFiles: { type: "integer", minimum: 0, maximum: 100000 },
    changedBytes: { type: "integer", minimum: 0, maximum: 1099511627776 },
    repairCycles: { type: "integer", minimum: 0, maximum: 3 },
    cost: reference("money"),
  },
  ["durationMs", "outputBytes", "changedFiles", "changedBytes", "repairCycles"],
);

const checkpointReconciliationRoot = closedObject(
  {
    reconciliationRunId: reference("uuid"),
    workflowId: reference("stableId"),
    resolvedPlanDigest: reference("sha256Digest"),
    inputDigest: reference("sha256Digest"),
    receiptDigest: reference("sha256Digest"),
    proofKind: reference("stableId"),
    proofDigest: reference("sha256Digest"),
    targetCheckpointHeadDigest: reference("sha256Digest"),
    targetReceiptState: enumSchema(["missing", "present"]),
    targetReceiptDigest: reference("sha256Digest"),
    outcome: enumSchema(["failed", "succeeded"]),
    reconciledAt: reference("timestamp"),
  },
  [
    "reconciliationRunId",
    "workflowId",
    "resolvedPlanDigest",
    "inputDigest",
    "receiptDigest",
    "proofKind",
    "proofDigest",
    "targetCheckpointHeadDigest",
    "targetReceiptState",
    "outcome",
    "reconciledAt",
  ],
);

const checkpointReconciliation = {
  ...checkpointReconciliationRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { targetReceiptState: { const: "present" } },
        required: ["targetReceiptState"],
      },
      then: {
        type: "object",
        properties: {
          targetReceiptDigest: reference("sha256Digest"),
        },
        required: ["targetReceiptDigest"],
      },
      else: { properties: { targetReceiptDigest: false } },
    },
  ],
};

const checkpointRoot = contractRoot(
  {
    schemaVersion: reference("semanticVersion"),
    checkpointId: reference("uuid"),
    sequence: { type: "integer", minimum: 0, maximum: 1000000 },
    identity: checkpointIdentity,
    status: enumSchema([
      "prepared",
      "running",
      "waiting-approval",
      "waiting-restart",
      "waiting-rollback",
      "rolling-back",
      "succeeded",
      "failed",
      "blocked",
      "cancelled",
      "uncertain",
      "expired",
      "archived",
    ]),
    nextOrdinal: { type: "integer", minimum: 0, maximum: 256 },
    attempts: boundedArray(checkpointAttempt, { maximum: 1024 }),
    inFlight: checkpointInFlight,
    budgetUsage: checkpointBudgetUsage,
    evidenceKinds: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
    artifactDigests: boundedArray(reference("sha256Digest"), {
      maximum: 10000,
      unique: true,
    }),
    receiptChainHead: reference("sha256Digest"),
    reconciliation: checkpointReconciliation,
    dirtyStateDigest: reference("sha256Digest"),
    sessionIdentityDigest: reference("sha256Digest"),
    createdAt: reference("timestamp"),
    updatedAt: reference("timestamp"),
    expiresAt: reference("timestamp"),
    parentCheckpointDigest: reference("sha256Digest"),
    checkpointDigest: reference("sha256Digest"),
  },
  [
    "schemaVersion",
    "checkpointId",
    "sequence",
    "identity",
    "status",
    "nextOrdinal",
    "attempts",
    "budgetUsage",
    "evidenceKinds",
    "artifactDigests",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "checkpointDigest",
  ],
);

export const workflowCheckpointSchema: VersionedContractSchema =
  defineContractSchema({
    id: "workflow-checkpoint",
    version: "1.0.0",
    title: "Workflow Checkpoint",
    description:
      "Attests append-only workflow state, in-flight authority, budget use, evidence, TTL, and parent-chain identity for bounded recovery.",
    schema: {
      ...checkpointRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: { sequence: { const: 0 } },
            required: ["sequence"],
          },
          then: {
            type: "object",
            properties: { parentCheckpointDigest: false },
          },
          else: {
            type: "object",
            properties: {
              parentCheckpointDigest: reference("sha256Digest"),
            },
            required: ["parentCheckpointDigest"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              status: { enum: ["running", "rolling-back", "uncertain"] },
            },
            required: ["status"],
          },
          then: {
            type: "object",
            properties: { inFlight: checkpointInFlight },
            required: ["inFlight"],
          },
          else: {
            type: "object",
            properties: { inFlight: false },
          },
        },
        {
          if: {
            type: "object",
            properties: { attempts: { type: "array", minItems: 1 } },
            required: ["attempts"],
          },
          then: {
            type: "object",
            properties: { receiptChainHead: reference("sha256Digest") },
            required: ["receiptChainHead"],
          },
          else: {
            type: "object",
            properties: { receiptChainHead: false },
          },
        },
      ],
    },
  });
