import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  CapabilitySupportGrade,
  ComponentOutcome,
  EngineId,
  EngineOperationKind,
  EvidenceGrade,
  ExecutionBudgets,
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

export type RunHandleStatus =
  | "queued"
  | "running"
  | "waiting-approval"
  | "succeeded"
  | "failed"
  | "blocked"
  | "cancelled"
  | "uncertain";

export interface RunHandle {
  readonly schemaVersion: SemanticVersion;
  readonly runId: string;
  readonly projectId: StableId;
  readonly featureId?: StableId;
  readonly workflow: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly status: RunHandleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly checkpointDigest?: Sha256Digest;
  readonly latestReceiptDigest?: Sha256Digest;
  readonly commands: {
    readonly status: StableId;
    readonly cancel: StableId;
    readonly resume: StableId;
  };
}

const runWorkflowIdentity = closedObject(
  {
    id: reference("stableId"),
    version: reference("semanticVersion"),
    resolvedPlanDigest: reference("sha256Digest"),
  },
  ["id", "version", "resolvedPlanDigest"],
);

const runCommands = closedObject(
  {
    status: reference("stableId"),
    cancel: reference("stableId"),
    resume: reference("stableId"),
  },
  ["status", "cancel", "resume"],
);

const runHandleRoot = contractRoot(
  {
    schemaVersion: reference("semanticVersion"),
    runId: reference("uuid"),
    projectId: reference("stableId"),
    featureId: reference("stableId"),
    workflow: runWorkflowIdentity,
    status: enumSchema([
      "queued",
      "running",
      "waiting-approval",
      "succeeded",
      "failed",
      "blocked",
      "cancelled",
      "uncertain",
    ]),
    createdAt: reference("timestamp"),
    updatedAt: reference("timestamp"),
    checkpointDigest: reference("sha256Digest"),
    latestReceiptDigest: reference("sha256Digest"),
    commands: runCommands,
  },
  [
    "schemaVersion",
    "runId",
    "projectId",
    "workflow",
    "status",
    "createdAt",
    "updatedAt",
    "commands",
  ],
);

export const runHandleSchema: VersionedContractSchema = defineContractSchema({
  id: "run-handle",
  version: "1.0.0",
  title: "Run Handle",
  description:
    "Carries durable workflow identity and canonical status, cancel, and resume command identities.",
  schema: {
    ...runHandleRoot,
    allOf: [
      {
        if: {
          type: "object",
          properties: {
            status: {
              enum: [
                "succeeded",
                "failed",
                "blocked",
                "cancelled",
                "uncertain",
              ],
            },
          },
          required: ["status"],
        },
        then: {
          type: "object",
          properties: {
            latestReceiptDigest: reference("sha256Digest"),
          },
          required: ["latestReceiptDigest"],
        },
      },
    ],
  },
});

export interface EngineProjectIdentity {
  readonly schemaVersion: SemanticVersion;
  readonly projectId: StableId;
  readonly engine: EngineId;
  readonly engineVersion: SemanticVersion;
  readonly canonicalRootDigest: Sha256Digest;
  readonly projectFileDigest: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly detectedAt: string;
}

export const engineProjectIdentitySchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-project-identity",
    version: "1.0.0",
    title: "Engine Project Identity",
    description:
      "Binds a portable project ID to exact engine, root, project file, registry, and profile digests.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectId: reference("stableId"),
        engine: reference("engineId"),
        engineVersion: reference("semanticVersion"),
        canonicalRootDigest: reference("sha256Digest"),
        projectFileDigest: reference("sha256Digest"),
        registryDigest: reference("sha256Digest"),
        profileDigest: reference("sha256Digest"),
        detectedAt: reference("timestamp"),
      },
      [
        "schemaVersion",
        "projectId",
        "engine",
        "engineVersion",
        "canonicalRootDigest",
        "projectFileDigest",
        "registryDigest",
        "profileDigest",
        "detectedAt",
      ],
    ),
  });

export type EngineSessionExecutionKind =
  | "static"
  | "headless"
  | "editor"
  | "runtime"
  | "packaged";

export interface EngineSessionIdentity {
  readonly schemaVersion: SemanticVersion;
  readonly sessionId: string;
  readonly projectIdentityDigest: Sha256Digest;
  readonly executionKind: EngineSessionExecutionKind;
  readonly process: {
    readonly pid: number;
    readonly startedAt: string;
    readonly executableDigest: Sha256Digest;
  };
  readonly editorInstanceId?: StableId;
  readonly nonceDigest?: Sha256Digest;
  readonly boundAt: string;
}

const engineProcessIdentity = closedObject(
  {
    pid: { type: "integer", minimum: 1, maximum: 2147483647 },
    startedAt: reference("timestamp"),
    executableDigest: reference("sha256Digest"),
  },
  ["pid", "startedAt", "executableDigest"],
);

export const engineSessionIdentitySchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-session-identity",
    version: "1.0.0",
    title: "Engine Session Identity",
    description:
      "Binds an engine process and optional editor instance to one attested project session.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          sessionId: reference("uuid"),
          projectIdentityDigest: reference("sha256Digest"),
          executionKind: enumSchema([
            "static",
            "headless",
            "editor",
            "runtime",
            "packaged",
          ]),
          process: engineProcessIdentity,
          editorInstanceId: reference("stableId"),
          nonceDigest: reference("sha256Digest"),
          boundAt: reference("timestamp"),
        },
        [
          "schemaVersion",
          "sessionId",
          "projectIdentityDigest",
          "executionKind",
          "process",
          "boundAt",
        ],
      ),
      allOf: [
        {
          if: {
            type: "object",
            properties: {
              executionKind: { enum: ["editor", "runtime"] },
            },
            required: ["executionKind"],
          },
          then: {
            type: "object",
            properties: {
              editorInstanceId: reference("stableId"),
              nonceDigest: reference("sha256Digest"),
            },
            required: ["editorInstanceId", "nonceDigest"],
          },
        },
        {
          if: {
            type: "object",
            properties: { executionKind: { const: "packaged" } },
            required: ["executionKind"],
          },
          then: {
            type: "object",
            properties: { nonceDigest: reference("sha256Digest") },
            required: ["nonceDigest"],
          },
        },
      ],
    },
  });

export interface EngineDiagnostic {
  readonly schemaVersion: SemanticVersion;
  readonly severity: "info" | "warning" | "error" | "fatal";
  readonly code: StableId;
  readonly message: string;
  readonly sourcePath?: string;
  readonly line?: number;
  readonly column?: number;
  readonly rawDigest?: Sha256Digest;
  readonly redacted: boolean;
}

export const engineDiagnosticSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-diagnostic",
    version: "1.0.0",
    title: "Engine Diagnostic",
    description:
      "Normalizes bounded engine diagnostics without storing unredacted raw output.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        severity: enumSchema(["info", "warning", "error", "fatal"]),
        code: reference("stableId"),
        message: textSchema(4000),
        sourcePath: reference("portablePath"),
        line: { type: "integer", minimum: 1, maximum: 100000000 },
        column: { type: "integer", minimum: 1, maximum: 1000000 },
        rawDigest: reference("sha256Digest"),
        redacted: { type: "boolean" },
      },
      ["schemaVersion", "severity", "code", "message", "redacted"],
    ),
  });

export interface EngineOperationRequest {
  readonly schemaVersion: SemanticVersion;
  readonly requestId: string;
  readonly operation: EngineOperationKind;
  readonly operationVersion: SemanticVersion;
  readonly commandId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
  readonly featureContractDigest?: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly approvalIds: readonly StableId[];
  readonly payload: {
    readonly schemaId: string;
    readonly schemaDigest: Sha256Digest;
    readonly valueDigest: Sha256Digest;
  };
  readonly deadlineAt: string;
  readonly budgets: ExecutionBudgets;
}

const engineOperationPayload = closedObject(
  {
    schemaId: {
      type: "string",
      pattern:
        "^urn:ai-game-playbook:schema:[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*:(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$",
      maxLength: 256,
    },
    schemaDigest: reference("sha256Digest"),
    valueDigest: reference("sha256Digest"),
  },
  ["schemaId", "schemaDigest", "valueDigest"],
);

const engineOperationRequestRoot = contractRoot(
  {
    schemaVersion: reference("semanticVersion"),
    requestId: reference("uuid"),
    operation: reference("engineOperation"),
    operationVersion: reference("semanticVersion"),
    commandId: reference("stableId"),
    projectIdentityDigest: reference("sha256Digest"),
    sessionIdentityDigest: reference("sha256Digest"),
    featureContractDigest: reference("sha256Digest"),
    registryDigest: reference("sha256Digest"),
    approvalIds: boundedArray(reference("stableId"), {
      maximum: 128,
      unique: true,
    }),
    payload: engineOperationPayload,
    deadlineAt: reference("timestamp"),
    budgets: reference("executionBudgets"),
  },
  [
    "schemaVersion",
    "requestId",
    "operation",
    "operationVersion",
    "commandId",
    "projectIdentityDigest",
    "registryDigest",
    "approvalIds",
    "payload",
    "deadlineAt",
    "budgets",
  ],
);

export const engineOperationRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-operation-request",
    version: "1.0.0",
    title: "Engine Operation Request",
    description:
      "Binds one engine operation to exact project, session, feature, registry, payload, approval, and budget identity.",
    schema: {
      ...engineOperationRequestRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: {
              operation: {
                enum: [
                  "mutate",
                  "save",
                  "compile-import",
                  "test",
                  "play",
                  "input-replay",
                  "logs",
                  "capture",
                  "profile",
                  "build-export",
                  "rollback",
                ],
              },
            },
            required: ["operation"],
          },
          then: {
            type: "object",
            properties: {
              sessionIdentityDigest: reference("sha256Digest"),
            },
            required: ["sessionIdentityDigest"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              operation: { enum: ["mutate", "save", "rollback"] },
            },
            required: ["operation"],
          },
          then: {
            type: "object",
            properties: {
              sessionIdentityDigest: reference("sha256Digest"),
              featureContractDigest: reference("sha256Digest"),
            },
            required: ["sessionIdentityDigest", "featureContractDigest"],
          },
        },
      ],
    },
  });

export type EngineMutationOutcome =
  | "not-applicable"
  | "not-started"
  | "committed"
  | "rolled-back"
  | "uncertain";

export interface EngineOperationResult {
  readonly schemaVersion: SemanticVersion;
  readonly requestId: string;
  readonly operation: EngineOperationKind;
  readonly projectIdentityDigest: Sha256Digest;
  readonly sessionIdentityDigest?: Sha256Digest;
  readonly support: CapabilitySupportGrade;
  readonly evidenceGrade: EvidenceGrade;
  readonly status: ComponentOutcome;
  readonly outer: {
    readonly status: ComponentOutcome;
    readonly exitCode?: number;
    readonly timedOut: boolean;
    readonly cancelled: boolean;
  };
  readonly inner: {
    readonly status: ComponentOutcome;
    readonly code: StableId;
    readonly message: string;
  };
  readonly diagnostics: readonly EngineDiagnostic[];
  readonly artifacts: readonly {
    readonly kind: StableId;
    readonly digest: Sha256Digest;
    readonly bytes: number;
    readonly complete: boolean;
  }[];
  readonly mutation: EngineMutationOutcome;
  readonly receiptDigest: Sha256Digest;
  readonly completedAt: string;
}

const operationOuterResult = closedObject(
  {
    status: reference("componentOutcome"),
    exitCode: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
    timedOut: { type: "boolean" },
    cancelled: { type: "boolean" },
  },
  ["status", "timedOut", "cancelled"],
);

const operationInnerResult = closedObject(
  {
    status: reference("componentOutcome"),
    code: reference("stableId"),
    message: textSchema(4000),
  },
  ["status", "code", "message"],
);

const embeddedDiagnostic = closedObject(
  {
    schemaVersion: reference("semanticVersion"),
    severity: enumSchema(["info", "warning", "error", "fatal"]),
    code: reference("stableId"),
    message: textSchema(4000),
    sourcePath: reference("portablePath"),
    line: { type: "integer", minimum: 1, maximum: 100000000 },
    column: { type: "integer", minimum: 1, maximum: 1000000 },
    rawDigest: reference("sha256Digest"),
    redacted: { type: "boolean" },
  },
  ["schemaVersion", "severity", "code", "message", "redacted"],
);

const operationArtifact = closedObject(
  {
    kind: reference("stableId"),
    digest: reference("sha256Digest"),
    bytes: { type: "integer", minimum: 0, maximum: 1099511627776 },
    complete: { type: "boolean" },
  },
  ["kind", "digest", "bytes", "complete"],
);

const engineOperationResultRoot = contractRoot(
  {
    schemaVersion: reference("semanticVersion"),
    requestId: reference("uuid"),
    operation: reference("engineOperation"),
    projectIdentityDigest: reference("sha256Digest"),
    sessionIdentityDigest: reference("sha256Digest"),
    support: reference("supportGrade"),
    evidenceGrade: reference("evidenceGrade"),
    status: reference("componentOutcome"),
    outer: operationOuterResult,
    inner: operationInnerResult,
    diagnostics: boundedArray(embeddedDiagnostic, { maximum: 10000 }),
    artifacts: boundedArray(operationArtifact, { maximum: 10000 }),
    mutation: enumSchema([
      "not-applicable",
      "not-started",
      "committed",
      "rolled-back",
      "uncertain",
    ]),
    receiptDigest: reference("sha256Digest"),
    completedAt: reference("timestamp"),
  },
  [
    "schemaVersion",
    "requestId",
    "operation",
    "projectIdentityDigest",
    "support",
    "evidenceGrade",
    "status",
    "outer",
    "inner",
    "diagnostics",
    "artifacts",
    "mutation",
    "receiptDigest",
    "completedAt",
  ],
);

export const engineOperationResultSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-operation-result",
    version: "1.0.0",
    title: "Engine Operation Result",
    description:
      "Separates outer and inner engine outcomes and preserves support, evidence, diagnostics, artifacts, and mutation state.",
    schema: {
      ...engineOperationResultRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: {
              operation: {
                enum: [
                  "mutate",
                  "save",
                  "compile-import",
                  "test",
                  "play",
                  "input-replay",
                  "logs",
                  "capture",
                  "profile",
                  "build-export",
                  "rollback",
                ],
              },
            },
            required: ["operation"],
          },
          then: {
            type: "object",
            properties: {
              sessionIdentityDigest: reference("sha256Digest"),
            },
            required: ["sessionIdentityDigest"],
          },
        },
        {
          if: {
            type: "object",
            properties: { status: { const: "passed" } },
            required: ["status"],
          },
          then: {
            type: "object",
            properties: {
              outer: {
                type: "object",
                properties: {
                  status: { const: "passed" },
                  exitCode: { const: 0 },
                  timedOut: { const: false },
                  cancelled: { const: false },
                },
                required: ["status", "timedOut", "cancelled"],
              },
              inner: {
                type: "object",
                properties: { status: { const: "passed" } },
                required: ["status"],
              },
            },
          },
        },
        {
          if: {
            type: "object",
            properties: { support: { const: "verified" } },
            required: ["support"],
          },
          then: {
            type: "object",
            properties: {
              evidenceGrade: { const: "engine-verified" },
            },
            required: ["evidenceGrade"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              operation: {
                enum: [
                  "detect",
                  "negotiate",
                  "inspect",
                  "compile-import",
                  "test",
                  "play",
                  "input-replay",
                  "logs",
                  "capture",
                  "profile",
                  "build-export",
                ],
              },
            },
            required: ["operation"],
          },
          then: {
            type: "object",
            properties: { mutation: { const: "not-applicable" } },
            required: ["mutation"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              operation: { enum: ["mutate", "save"] },
              status: { const: "passed" },
            },
            required: ["operation", "status"],
          },
          then: {
            type: "object",
            properties: { mutation: { const: "committed" } },
            required: ["mutation"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              operation: { const: "rollback" },
              status: { const: "passed" },
            },
            required: ["operation", "status"],
          },
          then: {
            type: "object",
            properties: { mutation: { const: "rolled-back" } },
            required: ["mutation"],
          },
        },
      ],
    },
  });
