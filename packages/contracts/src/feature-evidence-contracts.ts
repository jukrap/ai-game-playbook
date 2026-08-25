import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  ComponentOutcome,
  CpuArchitecture,
  DecimalAmount,
  EngineId,
  ExecutionBudgets,
  OperatingSystem,
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

export interface FeatureContract {
  readonly schemaVersion: SemanticVersion;
  readonly featureId: StableId;
  readonly version: SemanticVersion;
  readonly projectId: StableId;
  readonly status:
    | "draft"
    | "approved"
    | "active"
    | "completed"
    | "cancelled"
    | "expired";
  readonly playerOutcome: string;
  readonly scope: {
    readonly allowedPaths: readonly {
      readonly path: string;
      readonly access: "read" | "read-write";
      readonly recursive: boolean;
    }[];
    readonly allowedEditorObjects: readonly {
      readonly kind: string;
      readonly identity: string;
      readonly operations: readonly ("create" | "update" | "delete")[];
    }[];
    readonly allowedChangeKinds: readonly (
      | "metadata"
      | "source"
      | "config"
      | "scene"
      | "asset"
      | "test"
    )[];
    readonly exclusions: readonly string[];
  };
  readonly completion: {
    readonly oracleId: StableId;
    readonly criteria: readonly {
      readonly id: StableId;
      readonly statement: string;
      readonly evidenceKinds: readonly StableId[];
    }[];
    readonly zeroTestPolicy: "fail";
  };
  readonly risk: {
    readonly level: "low" | "medium" | "high" | "critical";
    readonly factors: readonly string[];
    readonly uncertainMutationPolicy: "stop";
  };
  readonly budgets: ExecutionBudgets;
  readonly rollback: {
    readonly mode: "required" | "not-applicable";
    readonly preimageRequired: boolean;
    readonly commandId?: StableId;
    readonly requiredEvidence: readonly StableId[];
  };
  readonly approval?: {
    readonly approvalId: StableId;
    readonly approvedBy: "user";
    readonly approvedAt: string;
    readonly expiresAt: string;
    readonly contractDigest: Sha256Digest;
  };
}

const allowedPath = closedObject(
  {
    path: reference("portablePath"),
    access: enumSchema(["read", "read-write"]),
    recursive: { type: "boolean" },
  },
  ["path", "access", "recursive"],
);

const allowedEditorObject = closedObject(
  {
    kind: { type: "string", minLength: 1, maxLength: 128 },
    identity: { type: "string", minLength: 1, maxLength: 512 },
    operations: boundedArray(enumSchema(["create", "update", "delete"]), {
      minimum: 1,
      maximum: 3,
      unique: true,
    }),
  },
  ["kind", "identity", "operations"],
);

const featureScope = closedObject(
  {
    allowedPaths: boundedArray(allowedPath, { maximum: 256 }),
    allowedEditorObjects: boundedArray(allowedEditorObject, { maximum: 256 }),
    allowedChangeKinds: boundedArray(
      enumSchema(["metadata", "source", "config", "scene", "asset", "test"]),
      { minimum: 1, maximum: 6, unique: true },
    ),
    exclusions: boundedArray(textSchema(300), {
      maximum: 64,
      unique: true,
    }),
  },
  [
    "allowedPaths",
    "allowedEditorObjects",
    "allowedChangeKinds",
    "exclusions",
  ],
);

const completionCriterion = closedObject(
  {
    id: reference("stableId"),
    statement: textSchema(500),
    evidenceKinds: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 32,
      unique: true,
    }),
  },
  ["id", "statement", "evidenceKinds"],
);

const featureCompletion = closedObject(
  {
    oracleId: reference("stableId"),
    criteria: boundedArray(completionCriterion, {
      minimum: 1,
      maximum: 64,
    }),
    zeroTestPolicy: { const: "fail" },
  },
  ["oracleId", "criteria", "zeroTestPolicy"],
);

const featureRisk = closedObject(
  {
    level: enumSchema(["low", "medium", "high", "critical"]),
    factors: boundedArray(textSchema(300), { maximum: 64, unique: true }),
    uncertainMutationPolicy: { const: "stop" },
  },
  ["level", "factors", "uncertainMutationPolicy"],
);

const featureRollback = closedObject(
  {
    mode: enumSchema(["required", "not-applicable"]),
    preimageRequired: { type: "boolean" },
    commandId: reference("stableId"),
    requiredEvidence: boundedArray(reference("stableId"), {
      maximum: 32,
      unique: true,
    }),
  },
  ["mode", "preimageRequired", "requiredEvidence"],
);

const featureApproval = closedObject(
  {
    approvalId: reference("stableId"),
    approvedBy: { const: "user" },
    approvedAt: reference("timestamp"),
    expiresAt: reference("timestamp"),
    contractDigest: reference("sha256Digest"),
  },
  ["approvalId", "approvedBy", "approvedAt", "expiresAt", "contractDigest"],
);

export const featureContractSchema: VersionedContractSchema =
  defineContractSchema({
    id: "feature-contract",
    version: "1.0.0",
    title: "Feature Contract",
    description:
      "Bounds one player-facing outcome, mutation scope, oracle, risk, budget, approval, and rollback.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        featureId: reference("stableId"),
        version: reference("semanticVersion"),
        projectId: reference("stableId"),
        status: enumSchema([
          "draft",
          "approved",
          "active",
          "completed",
          "cancelled",
          "expired",
        ]),
        playerOutcome: textSchema(1000),
        scope: featureScope,
        completion: featureCompletion,
        risk: featureRisk,
        budgets: reference("executionBudgets"),
        rollback: featureRollback,
        approval: featureApproval,
      },
      [
        "schemaVersion",
        "featureId",
        "version",
        "projectId",
        "status",
        "playerOutcome",
        "scope",
        "completion",
        "risk",
        "budgets",
        "rollback",
      ],
    ),
  });

export type RunStatus =
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "uncertain";

export interface RunReceipt {
  readonly schemaVersion: SemanticVersion;
  readonly receiptId: string;
  readonly previousReceiptDigest?: Sha256Digest;
  readonly status: RunStatus;
  readonly identity: {
    readonly runId: string;
    readonly workflowId: StableId;
    readonly stepId: StableId;
    readonly attempt: number;
    readonly projectId: StableId;
    readonly featureId?: StableId;
  };
  readonly authority: {
    readonly command: { readonly id: StableId; readonly version: SemanticVersion };
    readonly registryDigest: Sha256Digest;
    readonly handlerDigest: Sha256Digest;
    readonly packDigests: readonly Sha256Digest[];
    readonly approvalIds: readonly StableId[];
  };
  readonly environment: {
    readonly platform: OperatingSystem;
    readonly architecture: CpuArchitecture;
    readonly nodeVersion: SemanticVersion;
    readonly projectIdentityDigest: Sha256Digest;
    readonly engine?: { readonly id: EngineId; readonly version: SemanticVersion };
    readonly sessionIdentityDigest?: Sha256Digest;
  };
  readonly timing: {
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly outcomes: {
    readonly outer: {
      readonly status: ComponentOutcome;
      readonly exitCode?: number;
      readonly timedOut: boolean;
    };
    readonly inner: {
      readonly status: ComponentOutcome;
      readonly code: StableId;
      readonly message: string;
    };
    readonly tests?: {
      readonly status: ComponentOutcome;
      readonly discovered: number;
      readonly passed: number;
      readonly failed: number;
      readonly skipped: number;
    };
  };
  readonly mutation: {
    readonly status: "none" | "committed" | "rolled-back" | "uncertain";
    readonly changedFiles: readonly {
      readonly path: string;
      readonly preimageDigest?: Sha256Digest;
      readonly postimageDigest?: Sha256Digest;
      readonly bytesDelta: number;
    }[];
    readonly unexpectedDirtyFiles: readonly string[];
  };
  readonly artifacts: readonly {
    readonly artifactId: StableId;
    readonly kind: StableId;
    readonly path: string;
    readonly digest: Sha256Digest;
    readonly bytes: number;
    readonly complete: boolean;
    readonly createdAt: string;
    readonly commandId: StableId;
  }[];
  readonly diagnostics: readonly {
    readonly severity: "info" | "warning" | "error";
    readonly code: StableId;
    readonly message: string;
    readonly redacted: boolean;
  }[];
  readonly recovery: {
    readonly attempted: boolean;
    readonly outcome: ComponentOutcome;
    readonly actions: readonly string[];
  };
  readonly receiptDigest: Sha256Digest;
}

const runIdentity = closedObject(
  {
    runId: reference("uuid"),
    workflowId: reference("stableId"),
    stepId: reference("stableId"),
    attempt: { type: "integer", minimum: 1, maximum: 100 },
    projectId: reference("stableId"),
    featureId: reference("stableId"),
  },
  ["runId", "workflowId", "stepId", "attempt", "projectId"],
);

const commandAuthority = closedObject(
  { id: reference("stableId"), version: reference("semanticVersion") },
  ["id", "version"],
);

const runAuthority = closedObject(
  {
    command: commandAuthority,
    registryDigest: reference("sha256Digest"),
    handlerDigest: reference("sha256Digest"),
    packDigests: boundedArray(reference("sha256Digest"), {
      maximum: 128,
      unique: true,
    }),
    approvalIds: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
  },
  [
    "command",
    "registryDigest",
    "handlerDigest",
    "packDigests",
    "approvalIds",
  ],
);

const receiptEngine = closedObject(
  { id: reference("engineId"), version: reference("semanticVersion") },
  ["id", "version"],
);

const runEnvironment = closedObject(
  {
    platform: reference("operatingSystem"),
    architecture: reference("architecture"),
    nodeVersion: reference("semanticVersion"),
    projectIdentityDigest: reference("sha256Digest"),
    engine: receiptEngine,
    sessionIdentityDigest: reference("sha256Digest"),
  },
  ["platform", "architecture", "nodeVersion", "projectIdentityDigest"],
);

const runTiming = closedObject(
  {
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
  },
  ["startedAt", "endedAt", "durationMs"],
);

const outerOutcome = closedObject(
  {
    status: reference("componentOutcome"),
    exitCode: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
    timedOut: { type: "boolean" },
  },
  ["status", "timedOut"],
);

const innerOutcome = closedObject(
  {
    status: reference("componentOutcome"),
    code: reference("stableId"),
    message: textSchema(2000),
  },
  ["status", "code", "message"],
);

const testOutcome = closedObject(
  {
    status: reference("componentOutcome"),
    discovered: { type: "integer", minimum: 0, maximum: 10000000 },
    passed: { type: "integer", minimum: 0, maximum: 10000000 },
    failed: { type: "integer", minimum: 0, maximum: 10000000 },
    skipped: { type: "integer", minimum: 0, maximum: 10000000 },
  },
  ["status", "discovered", "passed", "failed", "skipped"],
);

const runOutcomes = closedObject(
  { outer: outerOutcome, inner: innerOutcome, tests: testOutcome },
  ["outer", "inner"],
);

const changedFile = closedObject(
  {
    path: reference("portablePath"),
    preimageDigest: reference("sha256Digest"),
    postimageDigest: reference("sha256Digest"),
    bytesDelta: {
      type: "integer",
      minimum: -1099511627776,
      maximum: 1099511627776,
    },
  },
  ["path", "bytesDelta"],
);

const mutation = closedObject(
  {
    status: enumSchema(["none", "committed", "rolled-back", "uncertain"]),
    changedFiles: boundedArray(changedFile, { maximum: 100000 }),
    unexpectedDirtyFiles: boundedArray(reference("portablePath"), {
      maximum: 100000,
      unique: true,
    }),
  },
  ["status", "changedFiles", "unexpectedDirtyFiles"],
);

const receiptArtifact = closedObject(
  {
    artifactId: reference("stableId"),
    kind: reference("stableId"),
    path: reference("portablePath"),
    digest: reference("sha256Digest"),
    bytes: { type: "integer", minimum: 0, maximum: 1099511627776 },
    complete: { type: "boolean" },
    createdAt: reference("timestamp"),
    commandId: reference("stableId"),
  },
  [
    "artifactId",
    "kind",
    "path",
    "digest",
    "bytes",
    "complete",
    "createdAt",
    "commandId",
  ],
);

const diagnostic = closedObject(
  {
    severity: enumSchema(["info", "warning", "error"]),
    code: reference("stableId"),
    message: textSchema(4000),
    redacted: { type: "boolean" },
  },
  ["severity", "code", "message", "redacted"],
);

const recovery = closedObject(
  {
    attempted: { type: "boolean" },
    outcome: reference("componentOutcome"),
    actions: boundedArray(textSchema(500), { maximum: 128 }),
  },
  ["attempted", "outcome", "actions"],
);

const runReceiptRoot = contractRoot(
    {
      schemaVersion: reference("semanticVersion"),
      receiptId: reference("uuid"),
      previousReceiptDigest: reference("sha256Digest"),
      status: enumSchema([
        "succeeded",
        "failed",
        "blocked",
        "cancelled",
        "uncertain",
      ]),
      identity: runIdentity,
      authority: runAuthority,
      environment: runEnvironment,
      timing: runTiming,
      outcomes: runOutcomes,
      mutation,
      artifacts: boundedArray(receiptArtifact, { maximum: 10000 }),
      diagnostics: boundedArray(diagnostic, { maximum: 10000 }),
      recovery,
      receiptDigest: reference("sha256Digest"),
    },
    [
      "schemaVersion",
      "receiptId",
      "status",
      "identity",
      "authority",
      "environment",
      "timing",
      "outcomes",
      "mutation",
      "artifacts",
      "diagnostics",
      "recovery",
      "receiptDigest",
    ],
);

export const runReceiptSchema: VersionedContractSchema = defineContractSchema({
  id: "run-receipt",
  version: "1.0.0",
  title: "Run Receipt",
  description:
    "Attests execution identity, authority, separated outcomes, mutations, artifacts, diagnostics, and recovery.",
  schema: {
    ...runReceiptRoot,
    allOf: [
      {
        if: {
          type: "object",
          properties: { status: { const: "succeeded" } },
          required: ["status"],
        },
        then: {
          type: "object",
          properties: {
            outcomes: {
              type: "object",
              properties: {
                outer: {
                  type: "object",
                  properties: {
                    status: { const: "passed" },
                    exitCode: { const: 0 },
                    timedOut: { const: false },
                  },
                  required: ["status", "timedOut"],
                },
                inner: {
                  type: "object",
                  properties: { status: { const: "passed" } },
                  required: ["status"],
                },
                tests: {
                  type: "object",
                  properties: { status: { const: "passed" } },
                  required: ["status"],
                },
              },
              required: ["outer", "inner"],
            },
            mutation: {
              type: "object",
              properties: {
                status: {
                  enum: ["none", "committed", "rolled-back"],
                },
              },
              required: ["status"],
            },
          },
          required: ["outcomes", "mutation"],
        },
      },
      {
        if: {
          type: "object",
          properties: {
            outcomes: {
              type: "object",
              properties: {
                tests: {
                  type: "object",
                  properties: { status: { const: "passed" } },
                  required: ["status"],
                },
              },
              required: ["tests"],
            },
          },
          required: ["outcomes"],
        },
        then: {
          type: "object",
          properties: {
            outcomes: {
              type: "object",
              properties: {
                tests: {
                  type: "object",
                  properties: {
                    discovered: { type: "integer", minimum: 1 },
                    passed: { type: "integer", minimum: 1 },
                    failed: { const: 0 },
                  },
                  required: ["discovered", "passed", "failed"],
                },
              },
              required: ["tests"],
            },
          },
          required: ["outcomes"],
        },
      },
      {
        if: {
          type: "object",
          properties: {
            mutation: {
              type: "object",
              properties: { status: { const: "uncertain" } },
              required: ["status"],
            },
          },
          required: ["mutation"],
        },
        then: {
          type: "object",
          properties: { status: { const: "uncertain" } },
          required: ["status"],
        },
      },
    ],
  },
});

export type AssetLifecycleState =
  | "placeholder"
  | "user-licensed"
  | "candidate"
  | "qa"
  | "approved"
  | "production"
  | "rejected";

export interface AssetProvenance {
  readonly schemaVersion: SemanticVersion;
  readonly assetId: StableId;
  readonly slotId: StableId;
  readonly state: AssetLifecycleState;
  readonly source: {
    readonly kind:
      | "deterministic-placeholder"
      | "user-provided"
      | "licensed-library"
      | "local-tool"
      | "hosted-provider";
    readonly label: string;
    readonly acquiredAt: string;
    readonly sourceUri?: string;
  };
  readonly lineage: readonly AssetLineageStage[];
  readonly rights: {
    readonly identifier?: string;
    readonly textDigest?: Sha256Digest;
    readonly attribution?: string;
    readonly redistribution: "allowed" | "restricted" | "unknown";
    readonly commercialUse: "allowed" | "restricted" | "unknown";
    readonly userAssertion?: string;
  };
  readonly generation?: {
    readonly provider: string;
    readonly model: string;
    readonly checkpoint?: string;
    readonly effectiveSeed?: string;
    readonly deterministic: boolean;
    readonly promptDigest: Sha256Digest;
    readonly negativePromptDigest?: Sha256Digest;
  };
  readonly transfer?: {
    readonly destination: string;
    readonly fields: readonly string[];
    readonly approvalId: StableId;
  };
  readonly cost?: {
    readonly currency: string;
    readonly estimated: DecimalAmount;
    readonly actual?: DecimalAmount;
    readonly approvalId: StableId;
  };
  readonly qa: readonly AssetQaResult[];
  readonly approvals: readonly StableId[];
  readonly currentFiles: readonly {
    readonly path: string;
    readonly digest: Sha256Digest;
    readonly bytes: number;
  }[];
}

export interface AssetLineageStage {
  readonly stageId: StableId;
  readonly operation:
    | "ingest"
    | "generate"
    | "edit"
    | "convert"
    | "slice"
    | "pack"
    | "import"
    | "qa"
    | "promote"
    | "rollback";
  readonly toolId: StableId;
  readonly toolVersion: SemanticVersion;
  readonly inputHashes: readonly Sha256Digest[];
  readonly outputHashes: readonly Sha256Digest[];
  readonly parametersDigest: Sha256Digest;
  readonly startedAt: string;
  readonly endedAt: string;
}

export interface AssetQaResult {
  readonly checkId: StableId;
  readonly scope:
    | "content"
    | "rights"
    | "engine-import"
    | "runtime"
    | "performance"
    | "visual";
  readonly outcome: "pass" | "fail" | "unverified" | "waived";
  readonly environmentDigest?: Sha256Digest;
  readonly artifactHashes: readonly Sha256Digest[];
  readonly findings: readonly string[];
  readonly waiverApprovalId?: StableId;
}

const assetSource = closedObject(
  {
    kind: enumSchema([
      "deterministic-placeholder",
      "user-provided",
      "licensed-library",
      "local-tool",
      "hosted-provider",
    ]),
    label: textSchema(300),
    acquiredAt: reference("timestamp"),
    sourceUri: { type: "string", format: "uri", minLength: 1, maxLength: 2048 },
  },
  ["kind", "label", "acquiredAt"],
);

const lineageStage = closedObject(
  {
    stageId: reference("stableId"),
    operation: enumSchema([
      "ingest",
      "generate",
      "edit",
      "convert",
      "slice",
      "pack",
      "import",
      "qa",
      "promote",
      "rollback",
    ]),
    toolId: reference("stableId"),
    toolVersion: reference("semanticVersion"),
    inputHashes: boundedArray(reference("sha256Digest"), { maximum: 1024 }),
    outputHashes: boundedArray(reference("sha256Digest"), {
      minimum: 1,
      maximum: 1024,
    }),
    parametersDigest: reference("sha256Digest"),
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
  },
  [
    "stageId",
    "operation",
    "toolId",
    "toolVersion",
    "inputHashes",
    "outputHashes",
    "parametersDigest",
    "startedAt",
    "endedAt",
  ],
);

const assetRights = closedObject(
  {
    identifier: { type: "string", minLength: 1, maxLength: 256 },
    textDigest: reference("sha256Digest"),
    attribution: textSchema(2000),
    redistribution: enumSchema(["allowed", "restricted", "unknown"]),
    commercialUse: enumSchema(["allowed", "restricted", "unknown"]),
    userAssertion: textSchema(2000),
  },
  ["redistribution", "commercialUse"],
);

const assetGeneration = closedObject(
  {
    provider: textSchema(200),
    model: textSchema(200),
    checkpoint: textSchema(500),
    effectiveSeed: { type: "string", minLength: 1, maxLength: 256 },
    deterministic: { type: "boolean" },
    promptDigest: reference("sha256Digest"),
    negativePromptDigest: reference("sha256Digest"),
  },
  ["provider", "model", "deterministic", "promptDigest"],
);

const assetTransfer = closedObject(
  {
    destination: textSchema(500),
    fields: boundedArray(textSchema(200), {
      minimum: 1,
      maximum: 128,
      unique: true,
    }),
    approvalId: reference("stableId"),
  },
  ["destination", "fields", "approvalId"],
);

const assetCost = closedObject(
  {
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    estimated: reference("decimalAmount"),
    actual: reference("decimalAmount"),
    approvalId: reference("stableId"),
  },
  ["currency", "estimated", "approvalId"],
);

const assetQa = closedObject(
  {
    checkId: reference("stableId"),
    scope: enumSchema([
      "content",
      "rights",
      "engine-import",
      "runtime",
      "performance",
      "visual",
    ]),
    outcome: enumSchema(["pass", "fail", "unverified", "waived"]),
    environmentDigest: reference("sha256Digest"),
    artifactHashes: boundedArray(reference("sha256Digest"), {
      maximum: 1024,
      unique: true,
    }),
    findings: boundedArray(textSchema(1000), { maximum: 256 }),
    waiverApprovalId: reference("stableId"),
  },
  ["checkId", "scope", "outcome", "artifactHashes", "findings"],
);

const currentAssetFile = closedObject(
  {
    path: reference("portablePath"),
    digest: reference("sha256Digest"),
    bytes: { type: "integer", minimum: 0, maximum: 1099511627776 },
  },
  ["path", "digest", "bytes"],
);

export const assetProvenanceSchema: VersionedContractSchema =
  defineContractSchema({
    id: "asset-provenance",
    version: "1.0.0",
    title: "Asset Provenance",
    description:
      "Records asset lifecycle, source, lineage, rights, transfer, cost, QA, approval, and current file identity.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        assetId: reference("stableId"),
        slotId: reference("stableId"),
        state: enumSchema([
          "placeholder",
          "user-licensed",
          "candidate",
          "qa",
          "approved",
          "production",
          "rejected",
        ]),
        source: assetSource,
        lineage: boundedArray(lineageStage, { maximum: 1024 }),
        rights: assetRights,
        generation: assetGeneration,
        transfer: assetTransfer,
        cost: assetCost,
        qa: boundedArray(assetQa, { maximum: 1024 }),
        approvals: boundedArray(reference("stableId"), {
          maximum: 256,
          unique: true,
        }),
        currentFiles: boundedArray(currentAssetFile, {
          minimum: 1,
          maximum: 10000,
        }),
      },
      [
        "schemaVersion",
        "assetId",
        "slotId",
        "state",
        "source",
        "lineage",
        "rights",
        "qa",
        "approvals",
        "currentFiles",
      ],
    ),
  });
