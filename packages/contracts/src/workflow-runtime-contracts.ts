import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type {
  ExecutionBudgets,
  ExecutionLane,
  PermissionClass,
  ProjectStage,
  SchemaReference,
} from "./contract-vocabulary.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import type { WorkflowFailureTransition } from "./orchestration-contracts.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";

export interface ResolvedWorkflowCommand {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly descriptorDigest: Sha256Digest;
  readonly handlerDigest: Sha256Digest;
  readonly lane: ExecutionLane;
  readonly permissions: readonly PermissionClass[];
}

export interface ResolvedWorkflowStep {
  readonly id: StableId;
  readonly ordinal: number;
  readonly dependsOn: readonly StableId[];
  readonly bindings: readonly {
    readonly target: string;
    readonly source: string;
  }[];
  readonly onFailure: WorkflowFailureTransition;
  readonly approvalCheckpoint: boolean;
  readonly command: ResolvedWorkflowCommand;
  readonly rollbackCommand?: ResolvedWorkflowCommand;
}

export interface ResolvedWorkflowPlan {
  readonly schemaVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly workflow: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly descriptorDigest: Sha256Digest;
  };
  readonly projectStage: ProjectStage;
  readonly input: SchemaReference;
  readonly output: SchemaReference;
  readonly steps: readonly ResolvedWorkflowStep[];
  readonly budgets: ExecutionBudgets;
  readonly resumePolicy: "never" | "safe-checkpoint-only";
  readonly terminalOracleDigest: Sha256Digest;
  readonly requiredEvidence: readonly StableId[];
  readonly resolvedPlanDigest: Sha256Digest;
}

export type ResolvedWorkflowPlanDigestInput = Omit<
  ResolvedWorkflowPlan,
  "resolvedPlanDigest"
> &
  Partial<Pick<ResolvedWorkflowPlan, "resolvedPlanDigest">>;

export function computeResolvedWorkflowPlanDigest(
  plan: ResolvedWorkflowPlanDigestInput,
): Sha256Digest {
  const { resolvedPlanDigest: _resolvedPlanDigest, ...subject } = plan;
  return digestCanonicalJson({
    domain: "ai-game-playbook.resolved-workflow-plan",
    version: "1",
    subject,
  });
}

export function isResolvedWorkflowPlanDigestValid(
  plan: ResolvedWorkflowPlan,
): boolean {
  try {
    return computeResolvedWorkflowPlanDigest(plan) === plan.resolvedPlanDigest;
  } catch {
    return false;
  }
}

const resolvedCommand = closedObject(
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

const resolvedBinding = closedObject(
  {
    target: {
      type: "string",
      pattern: "^/[A-Za-z0-9_~./-]+$",
      maxLength: 512,
    },
    source: {
      type: "string",
      pattern: "^/[A-Za-z0-9_~./-]+$",
      maxLength: 512,
    },
  },
  ["target", "source"],
);

const resolvedStepBase = closedObject(
  {
    id: reference("stableId"),
    ordinal: { type: "integer", minimum: 0, maximum: 255 },
    dependsOn: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
    bindings: boundedArray(resolvedBinding, { maximum: 256 }),
    onFailure: enumSchema(["stop", "rollback", "continue", "blocked"]),
    approvalCheckpoint: { type: "boolean" },
    command: resolvedCommand,
    rollbackCommand: resolvedCommand,
  },
  [
    "id",
    "ordinal",
    "dependsOn",
    "bindings",
    "onFailure",
    "approvalCheckpoint",
    "command",
  ],
);

const resolvedStep = {
  ...resolvedStepBase,
  allOf: [
    {
      if: {
        type: "object",
        properties: { onFailure: { const: "rollback" } },
        required: ["onFailure"],
      },
      then: {
        type: "object",
        properties: { rollbackCommand: resolvedCommand },
        required: ["rollbackCommand"],
      },
      else: {
        type: "object",
        properties: { rollbackCommand: false },
      },
    },
  ],
};

const workflowIdentity = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    descriptorDigest: reference("sha256Digest"),
  },
  ["id", "version", "descriptorDigest"],
);

export const resolvedWorkflowPlanSchema: VersionedContractSchema =
  defineContractSchema({
    id: "resolved-workflow-plan",
    version: "1.0.0",
    title: "Resolved Workflow Plan",
    description:
      "Attests one finite workflow DAG to exact registry, command, handler, stage, authority, and budget identity before execution.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        workflow: workflowIdentity,
        projectStage: reference("projectStage"),
        input: reference("schemaReference"),
        output: reference("schemaReference"),
        steps: boundedArray(resolvedStep, { minimum: 1, maximum: 256 }),
        budgets: reference("executionBudgets"),
        resumePolicy: enumSchema(["never", "safe-checkpoint-only"]),
        terminalOracleDigest: reference("sha256Digest"),
        requiredEvidence: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 128,
          unique: true,
        }),
        resolvedPlanDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "registryDigest",
        "workflow",
        "projectStage",
        "input",
        "output",
        "steps",
        "budgets",
        "resumePolicy",
        "terminalOracleDigest",
        "requiredEvidence",
        "resolvedPlanDigest",
      ],
    ),
  });
