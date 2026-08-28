import type { ApprovalGrantScope } from "./approval-contracts.js";
import { approvalScopeSchema } from "./approval-contracts.js";
import {
  PERMISSION_CLASSES,
  type ExecutionBudgets,
  type PermissionClass,
} from "./contract-vocabulary.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
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

export type ApprovalImpactClass =
  | "host-state-read"
  | "project-files-change"
  | "editor-control"
  | "process-execution"
  | "software-installation"
  | "network-access"
  | "external-data-transfer"
  | "paid-operation"
  | "destructive-change"
  | "publication";

export const APPROVAL_IMPACT_CLASSES: readonly ApprovalImpactClass[] =
  Object.freeze([
    "host-state-read",
    "project-files-change",
    "editor-control",
    "process-execution",
    "software-installation",
    "network-access",
    "external-data-transfer",
    "paid-operation",
    "destructive-change",
    "publication",
  ]);

function frozenImpacts(
  ...values: readonly ApprovalImpactClass[]
): readonly ApprovalImpactClass[] {
  return Object.freeze([...values]);
}

export const APPROVAL_PERMISSION_IMPACT_CLASSES: Readonly<
  Record<PermissionClass, readonly ApprovalImpactClass[]>
> = Object.freeze({
  "read-project": frozenImpacts(),
  "host-tool-inspection": frozenImpacts("host-state-read"),
  "write-project-metadata": frozenImpacts("project-files-change"),
  "write-project-source": frozenImpacts("project-files-change"),
  "editor-control": frozenImpacts("editor-control"),
  "test-build": frozenImpacts("process-execution"),
  install: frozenImpacts(
    "project-files-change",
    "software-installation",
  ),
  network: frozenImpacts("network-access"),
  "external-transmission": frozenImpacts("external-data-transfer"),
  "paid-call": frozenImpacts("paid-operation"),
  destructive: frozenImpacts("destructive-change"),
  "publish-release": frozenImpacts("publication"),
});

export interface ApprovalPromptPermission {
  readonly permission: PermissionClass;
  readonly mode: "automatic" | "approval-required";
  readonly impactClasses: readonly ApprovalImpactClass[];
}

export interface ApprovalPrompt {
  readonly schemaVersion: SemanticVersion;
  readonly runId: string;
  readonly requestDigest: Sha256Digest;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly command: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly handlerDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly feature?: {
    readonly id: StableId;
    readonly contractDigest: Sha256Digest;
  };
  readonly workflow?: {
    readonly id: StableId;
    readonly stepId: StableId;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly scope: ApprovalGrantScope;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
  readonly permissions: readonly ApprovalPromptPermission[];
  readonly promptDigest: Sha256Digest;
}

export type ApprovalPromptDigestInput = Omit<ApprovalPrompt, "promptDigest"> &
  Partial<Pick<ApprovalPrompt, "promptDigest">>;

export function computeApprovalPromptDigest(
  prompt: ApprovalPromptDigestInput,
): Sha256Digest {
  const { promptDigest: _promptDigest, ...subject } = prompt;
  return digestCanonicalJson({
    domain: "ai-game-playbook.approval-prompt",
    version: "1",
    subject,
  });
}

const projectBinding = closedObject(
  {
    id: reference("stableId"),
    identityDigest: reference("sha256Digest"),
  },
  ["id", "identityDigest"],
);

const commandBinding = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    handlerDigest: reference("sha256Digest"),
  },
  ["id", "version", "handlerDigest"],
);

const featureBinding = closedObject(
  {
    id: reference("stableId"),
    contractDigest: reference("sha256Digest"),
  },
  ["id", "contractDigest"],
);

const workflowBinding = closedObject(
  {
    id: reference("stableId"),
    stepId: reference("stableId"),
    resolvedPlanDigest: reference("sha256Digest"),
  },
  ["id", "stepId", "resolvedPlanDigest"],
);

const promptPermission = {
  oneOf: PERMISSION_CLASSES.map((permission) =>
    closedObject(
      {
        permission: { const: permission },
        mode: enumSchema(["automatic", "approval-required"]),
        impactClasses: {
          const: APPROVAL_PERMISSION_IMPACT_CLASSES[permission],
        },
      },
      ["permission", "mode", "impactClasses"],
    ),
  ),
};

const permissionUniquenessConstraints = PERMISSION_CLASSES.map(
  (permission) => ({
    type: "object",
    properties: {
      permissions: {
        type: "array",
        contains: {
          type: "object",
          properties: { permission: { const: permission } },
          required: ["permission"],
        },
        minContains: 0,
        maxContains: 1,
      },
    },
    required: ["permissions"],
  }),
);

export const approvalPromptSchema: VersionedContractSchema =
  defineContractSchema({
    id: "approval-prompt",
    version: "1.0.0",
    title: "Approval Prompt",
    description:
      "Presents exact bounded permission impact without carrying command input, credentials, or execution authority.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          runId: reference("uuid"),
          requestDigest: reference("sha256Digest"),
          project: projectBinding,
          command: commandBinding,
          registryDigest: reference("sha256Digest"),
          inputDigest: reference("sha256Digest"),
          feature: featureBinding,
          workflow: workflowBinding,
          editorSessionIdentityDigest: reference("sha256Digest"),
          scope: approvalScopeSchema,
          budgets: reference("executionBudgets"),
          deadlineAt: reference("timestamp"),
          permissions: boundedArray(promptPermission, {
            minimum: 1,
            maximum: PERMISSION_CLASSES.length,
            unique: true,
          }),
          promptDigest: reference("sha256Digest"),
        },
        [
          "schemaVersion",
          "runId",
          "requestDigest",
          "project",
          "command",
          "registryDigest",
          "inputDigest",
          "scope",
          "budgets",
          "deadlineAt",
          "permissions",
          "promptDigest",
        ],
      ),
      allOf: [
        ...permissionUniquenessConstraints,
        {
          if: {
            type: "object",
            properties: {
              permissions: {
                type: "array",
                contains: {
                  type: "object",
                  properties: {
                    permission: { const: "editor-control" },
                  },
                  required: ["permission"],
                },
                minContains: 1,
              },
            },
            required: ["permissions"],
          },
          then: {
            type: "object",
            properties: {
              editorSessionIdentityDigest: reference("sha256Digest"),
            },
            required: ["editorSessionIdentityDigest"],
          },
        },
      ],
    },
  });
