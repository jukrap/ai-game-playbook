import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  ExecutionBudgets,
  Lifecycle,
  PermissionClass,
  ProjectStage,
  SchemaReference,
} from "./contract-vocabulary.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export interface SkillDescriptor {
  readonly schemaVersion: SemanticVersion;
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly lifecycle: Lifecycle;
  readonly invocation: "user" | "model" | "both";
  readonly summary: string;
  readonly triggers: readonly string[];
  readonly exclusions: readonly string[];
  readonly capabilities: readonly StableId[];
  readonly supportedStages: readonly ProjectStage[];
  readonly requiredPermissions: readonly PermissionClass[];
  readonly body: SkillBody;
  readonly references: readonly (SkillBody & { readonly loadWhen: string })[];
  readonly completionCriteria: readonly string[];
  readonly evidenceDuties: readonly string[];
}

export interface SkillBody {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly maxTokens: number;
}

const skillBody = closedObject(
  {
    path: reference("portablePath"),
    digest: reference("sha256Digest"),
    maxTokens: { type: "integer", minimum: 1, maximum: 100000 },
  },
  ["path", "digest", "maxTokens"],
);

const skillReference = closedObject(
  {
    path: reference("portablePath"),
    digest: reference("sha256Digest"),
    maxTokens: { type: "integer", minimum: 1, maximum: 100000 },
    loadWhen: textSchema(500),
  },
  ["path", "digest", "maxTokens", "loadWhen"],
);

export const skillDescriptorSchema: VersionedContractSchema =
  defineContractSchema({
    id: "skill-descriptor",
    version: "1.0.0",
    title: "Skill Descriptor",
    description:
      "Declares bounded discovery, loading, capability, permission, completion, and evidence metadata for one skill.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        id: reference("stableId"),
        version: reference("semanticVersion"),
        lifecycle: reference("lifecycle"),
        invocation: enumSchema(["user", "model", "both"]),
        summary: textSchema(240),
        triggers: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
          unique: true,
        }),
        exclusions: boundedArray(textSchema(500), {
          maximum: 64,
          unique: true,
        }),
        capabilities: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 64,
          unique: true,
        }),
        supportedStages: boundedArray(reference("projectStage"), {
          minimum: 1,
          maximum: 5,
          unique: true,
        }),
        requiredPermissions: boundedArray(reference("permissionClass"), {
          maximum: 11,
          unique: true,
        }),
        body: skillBody,
        references: boundedArray(skillReference, { maximum: 64 }),
        completionCriteria: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        evidenceDuties: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
      },
      [
        "schemaVersion",
        "id",
        "version",
        "lifecycle",
        "invocation",
        "summary",
        "triggers",
        "exclusions",
        "capabilities",
        "supportedStages",
        "requiredPermissions",
        "body",
        "references",
        "completionCriteria",
        "evidenceDuties",
      ],
    ),
  });

export interface RoleLensDescriptor {
  readonly schemaVersion: SemanticVersion;
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly lifecycle: Lifecycle;
  readonly summary: string;
  readonly appliesWhen: readonly string[];
  readonly reviewQuestions: readonly string[];
  readonly evidenceDuties: readonly string[];
  readonly stopConditions: readonly string[];
  readonly handoffResponsibilities: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly maxContextTokens: number;
}

export const roleLensDescriptorSchema: VersionedContractSchema =
  defineContractSchema({
    id: "role-lens-descriptor",
    version: "1.0.0",
    title: "Role Lens Descriptor",
    description:
      "Declares a bounded review perspective without granting authority or creating an executor.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        id: reference("stableId"),
        version: reference("semanticVersion"),
        lifecycle: reference("lifecycle"),
        summary: textSchema(240),
        appliesWhen: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        reviewQuestions: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        evidenceDuties: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        stopConditions: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        handoffResponsibilities: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        prohibitedActions: boundedArray(textSchema(500), {
          minimum: 1,
          maximum: 64,
        }),
        maxContextTokens: {
          type: "integer",
          minimum: 1,
          maximum: 100000,
        },
      },
      [
        "schemaVersion",
        "id",
        "version",
        "lifecycle",
        "summary",
        "appliesWhen",
        "reviewQuestions",
        "evidenceDuties",
        "stopConditions",
        "handoffResponsibilities",
        "prohibitedActions",
        "maxContextTokens",
      ],
    ),
  });

export type WorkflowFailureTransition =
  | "stop"
  | "rollback"
  | "continue"
  | "blocked";

export interface WorkflowDescriptor {
  readonly schemaVersion: SemanticVersion;
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly lifecycle: Lifecycle;
  readonly summary: string;
  readonly input: SchemaReference;
  readonly output: SchemaReference;
  readonly supportedStages: readonly ProjectStage[];
  readonly steps: readonly WorkflowStep[];
  readonly budgets: ExecutionBudgets;
  readonly resumePolicy: "never" | "safe-checkpoint-only";
  readonly terminalOracle: string;
  readonly requiredEvidence: readonly StableId[];
}

export interface WorkflowStep {
  readonly id: StableId;
  readonly commandId: StableId;
  readonly dependsOn: readonly StableId[];
  readonly bindings?: readonly {
    readonly target: string;
    readonly source: string;
  }[];
  readonly onFailure: WorkflowFailureTransition;
  readonly approvalCheckpoint: boolean;
  readonly rollbackCommandId?: StableId;
}

const workflowBinding = closedObject(
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

const workflowStep = closedObject(
  {
    id: reference("stableId"),
    commandId: reference("stableId"),
    dependsOn: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
    bindings: boundedArray(workflowBinding, { maximum: 256 }),
    onFailure: enumSchema(["stop", "rollback", "continue", "blocked"]),
    approvalCheckpoint: { type: "boolean" },
    rollbackCommandId: reference("stableId"),
  },
  ["id", "commandId", "dependsOn", "onFailure", "approvalCheckpoint"],
);

export const workflowDescriptorSchema: VersionedContractSchema =
  defineContractSchema({
    id: "workflow-descriptor",
    version: "1.0.0",
    title: "Workflow Descriptor",
    description:
      "Declares a finite composition of registered commands with bounded transitions, approvals, rollback, and evidence.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        id: reference("stableId"),
        version: reference("semanticVersion"),
        lifecycle: reference("lifecycle"),
        summary: textSchema(240),
        input: reference("schemaReference"),
        output: reference("schemaReference"),
        supportedStages: boundedArray(reference("projectStage"), {
          minimum: 1,
          maximum: 5,
          unique: true,
        }),
        steps: boundedArray(workflowStep, { minimum: 1, maximum: 256 }),
        budgets: reference("executionBudgets"),
        resumePolicy: enumSchema(["never", "safe-checkpoint-only"]),
        terminalOracle: textSchema(1000),
        requiredEvidence: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 128,
          unique: true,
        }),
      },
      [
        "schemaVersion",
        "id",
        "version",
        "lifecycle",
        "summary",
        "input",
        "output",
        "supportedStages",
        "steps",
        "budgets",
        "resumePolicy",
        "terminalOracle",
        "requiredEvidence",
      ],
    ),
  });
