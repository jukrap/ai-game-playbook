import { compareCanonicalText } from "./canonical-json.js";
import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  ExecutionBudgets,
  PermissionClass,
} from "./contract-vocabulary.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";

export interface ApprovalGrantScope {
  readonly paths: readonly string[];
  readonly objectIds: readonly string[];
  readonly destinations: readonly string[];
  readonly dataClasses: readonly StableId[];
  readonly changeKinds: readonly (
    | "metadata"
    | "source"
    | "config"
    | "scene"
    | "asset"
    | "test"
  )[];
  readonly provider?: string;
  readonly model?: string;
  readonly publishTargets: readonly string[];
}

export interface ApprovalGrant {
  readonly schemaVersion: SemanticVersion;
  readonly grantId: StableId;
  readonly permission: PermissionClass;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly feature?: {
    readonly id: StableId;
    readonly contractDigest: Sha256Digest;
  };
  readonly workflow?: {
    readonly id: StableId;
    readonly stepId: StableId;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly command: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly handlerDigest: Sha256Digest;
  };
  readonly registryDigest: Sha256Digest;
  readonly editorSessionIdentityDigest?: Sha256Digest;
  readonly scope: ApprovalGrantScope;
  readonly budgets: {
    readonly expiresAt: string;
    readonly maxUses: number;
    readonly execution: ExecutionBudgets;
  };
  readonly requestDigest: Sha256Digest;
  readonly approvedBy: "user";
  readonly approvedAt: string;
  readonly signature: {
    readonly algorithm: "ed25519";
    readonly keyId: StableId;
    readonly value: string;
  };
}

export type ApprovalGrantSigningDigestInput = Omit<ApprovalGrant, "signature"> &
  Partial<Pick<ApprovalGrant, "signature">>;

export function computeApprovalGrantSigningDigest(
  grant: ApprovalGrantSigningDigestInput,
): Sha256Digest {
  const { signature: _signature, ...subject } = grant;
  return digestCanonicalJson({
    domain: "ai-game-playbook.approval-grant",
    version: "1",
    subject,
  });
}

export function isCanonicalApprovalDestination(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "" &&
      parsed.hostname.length > 0 &&
      value === parsed.origin
    );
  } catch {
    return false;
  }
}

export function isCanonicalApprovalScope(scope: ApprovalGrantScope): boolean {
  const arrays: readonly (readonly string[])[] = [
    scope.paths,
    scope.objectIds,
    scope.destinations,
    scope.dataClasses,
    scope.changeKinds,
    scope.publishTargets,
  ];
  return arrays.every((values) =>
    values.every(
      (value, index) =>
        index === 0 ||
        compareCanonicalText(values[index - 1] ?? "", value) < 0,
    ),
  );
}

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

const commandBinding = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    handlerDigest: reference("sha256Digest"),
  },
  ["id", "version", "handlerDigest"],
);

const exactTextArray = boundedArray(textSchema(512), {
  maximum: 256,
  unique: true,
});

const destinationArray = boundedArray(
  {
    type: "string",
    pattern: "^https?://[a-z0-9.-]+(?::[1-9][0-9]{0,4})?$",
    minLength: 8,
    maxLength: 300,
  },
  { maximum: 32, unique: true },
);

const grantScope = closedObject(
  {
    paths: boundedArray(reference("portablePath"), {
      maximum: 256,
      unique: true,
    }),
    objectIds: exactTextArray,
    destinations: destinationArray,
    dataClasses: boundedArray(reference("stableId"), {
      maximum: 64,
      unique: true,
    }),
    changeKinds: boundedArray(
      enumSchema(["metadata", "source", "config", "scene", "asset", "test"]),
      { maximum: 6, unique: true },
    ),
    provider: textSchema(200),
    model: textSchema(200),
    publishTargets: exactTextArray,
  },
  [
    "paths",
    "objectIds",
    "destinations",
    "dataClasses",
    "changeKinds",
    "publishTargets",
  ],
);

const grantBudgets = closedObject(
  {
    expiresAt: reference("timestamp"),
    maxUses: { type: "integer", minimum: 1, maximum: 10000 },
    execution: reference("executionBudgets"),
  },
  ["expiresAt", "maxUses", "execution"],
);

const grantSignature = closedObject(
  {
    algorithm: { const: "ed25519" },
    keyId: reference("stableId"),
    value: {
      type: "string",
      pattern: "^[A-Za-z0-9_-]{86}$",
      minLength: 86,
      maxLength: 86,
    },
  },
  ["algorithm", "keyId", "value"],
);

export const approvalGrantSchema: VersionedContractSchema =
  defineContractSchema({
    id: "approval-grant",
    version: "1.0.0",
    title: "Approval Grant",
    description:
      "Binds one user-approved permission to exact project, command, scope, budget, request, and optional feature, workflow, or editor session identity.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          grantId: reference("stableId"),
          permission: reference("permissionClass"),
          projectId: reference("stableId"),
          projectIdentityDigest: reference("sha256Digest"),
          feature: featureBinding,
          workflow: workflowBinding,
          command: commandBinding,
          registryDigest: reference("sha256Digest"),
          editorSessionIdentityDigest: reference("sha256Digest"),
          scope: grantScope,
          budgets: grantBudgets,
          requestDigest: reference("sha256Digest"),
          approvedBy: { const: "user" },
          approvedAt: reference("timestamp"),
          signature: grantSignature,
        },
        [
          "schemaVersion",
          "grantId",
          "permission",
          "projectId",
          "projectIdentityDigest",
          "command",
          "registryDigest",
          "scope",
          "budgets",
          "requestDigest",
          "approvedBy",
          "approvedAt",
          "signature",
        ],
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: { permission: { const: "editor-control" } },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              editorSessionIdentityDigest: reference("sha256Digest"),
            },
            required: ["editorSessionIdentityDigest"],
          },
        },
        {
          if: {
            type: "object",
            properties: { permission: { const: "write-project-source" } },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              feature: featureBinding,
              scope: {
                type: "object",
                properties: {
                  paths: { type: "array", minItems: 1 },
                  changeKinds: { type: "array", minItems: 1 },
                },
                required: ["paths", "changeKinds"],
              },
            },
            required: ["feature"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              permission: {
                enum: ["network", "external-transmission", "paid-call"],
              },
            },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              scope: {
                type: "object",
                properties: {
                  destinations: { type: "array", minItems: 1 },
                },
                required: ["destinations"],
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: {
              permission: { enum: ["external-transmission", "paid-call"] },
            },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              scope: {
                type: "object",
                properties: {
                  dataClasses: { type: "array", minItems: 1 },
                },
                required: ["dataClasses"],
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: { permission: { const: "paid-call" } },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              scope: {
                type: "object",
                properties: {
                  provider: textSchema(200),
                  model: textSchema(200),
                },
                required: ["provider", "model"],
              },
              budgets: {
                type: "object",
                properties: {
                  execution: {
                    type: "object",
                    properties: { maxCost: reference("money") },
                    required: ["maxCost"],
                  },
                },
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: { permission: { const: "destructive" } },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              scope: {
                type: "object",
                anyOf: [
                  {
                    properties: { paths: { type: "array", minItems: 1 } },
                    required: ["paths"],
                  },
                  {
                    properties: {
                      objectIds: { type: "array", minItems: 1 },
                    },
                    required: ["objectIds"],
                  },
                ],
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: { permission: { const: "publish-release" } },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              scope: {
                type: "object",
                properties: {
                  publishTargets: { type: "array", minItems: 1 },
                },
                required: ["publishTargets"],
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: {
              permission: {
                enum: [
                  "write-project-metadata",
                  "install",
                  "network",
                  "external-transmission",
                  "paid-call",
                  "destructive",
                  "publish-release",
                ],
              },
            },
            required: ["permission"],
          },
          then: {
            type: "object",
            properties: {
              budgets: {
                type: "object",
                properties: { maxUses: { const: 1 } },
                required: ["maxUses"],
              },
            },
          },
        },
      ],
    },
  });
