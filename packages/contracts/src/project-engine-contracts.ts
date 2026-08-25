import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  CapabilitySupportGrade,
  CpuArchitecture,
  EngineId,
  EngineOperationKind,
  EvidenceGrade,
  ExecutionBudgets,
  OperatingSystem,
  PermissionClass,
  ProjectStage,
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

export interface GameProjectProfile {
  readonly schemaVersion: SemanticVersion;
  readonly projectId: StableId;
  readonly projectRoot: ".";
  readonly engine: {
    readonly id: EngineId;
    readonly version: SemanticVersion;
    readonly projectIdentityDigest: Sha256Digest;
  };
  readonly stage: StageAssessment;
  readonly teamSize: 1 | 2 | 3 | 4 | 5;
  readonly gameShape: "offline-single-player-3d";
  readonly targets: readonly BuildTarget[];
  readonly budgets: ExecutionBudgets;
  readonly coreLoop: readonly string[];
  readonly pillars: readonly string[];
  readonly exclusions: readonly string[];
}

export interface StageAssessment {
  readonly declared?: ProjectStage;
  readonly detected?: ProjectStage;
  readonly effective: ProjectStage | "ambiguous";
  readonly confidence: "high" | "medium" | "low";
  readonly evidence: readonly {
    readonly locator: string;
    readonly grade: "declared" | "implemented" | "observed";
    readonly digest: Sha256Digest;
  }[];
  readonly reason: string;
}

export interface BuildTarget {
  readonly platform: OperatingSystem;
  readonly architecture: CpuArchitecture;
  readonly configuration: "development" | "test" | "release";
}

const profileEngine = closedObject(
  {
    id: reference("engineId"),
    version: reference("semanticVersion"),
    projectIdentityDigest: reference("sha256Digest"),
  },
  ["id", "version", "projectIdentityDigest"],
);

const stageEvidence = closedObject(
  {
    locator: reference("portablePath"),
    grade: enumSchema(["declared", "implemented", "observed"]),
    digest: reference("sha256Digest"),
  },
  ["locator", "grade", "digest"],
);

const stageAssessment = closedObject(
  {
    declared: reference("projectStage"),
    detected: reference("projectStage"),
    effective: enumSchema([
      "concept",
      "risk-prototype",
      "vertical-slice",
      "stabilization",
      "release-candidate",
      "ambiguous",
    ]),
    confidence: enumSchema(["high", "medium", "low"]),
    evidence: boundedArray(stageEvidence, { minimum: 1, maximum: 64 }),
    reason: reference("nonEmptyText"),
  },
  ["effective", "confidence", "evidence", "reason"],
);

const buildTarget = closedObject(
  {
    platform: reference("operatingSystem"),
    architecture: reference("architecture"),
    configuration: enumSchema(["development", "test", "release"]),
  },
  ["platform", "architecture", "configuration"],
);

export const gameProjectProfileSchema: VersionedContractSchema =
  defineContractSchema({
    id: "game-project-profile",
    version: "1.0.0",
    title: "Game Project Profile",
    description:
      "Records portable project identity, stage, target, scope, and declared execution budgets.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectId: reference("stableId"),
        projectRoot: { const: "." },
        engine: profileEngine,
        stage: stageAssessment,
        teamSize: { type: "integer", minimum: 1, maximum: 5 },
        gameShape: { const: "offline-single-player-3d" },
        targets: boundedArray(buildTarget, { minimum: 1, maximum: 16 }),
        budgets: reference("executionBudgets"),
        coreLoop: boundedArray(textSchema(120), {
          minimum: 1,
          maximum: 32,
          unique: true,
        }),
        pillars: boundedArray(textSchema(240), {
          minimum: 1,
          maximum: 16,
          unique: true,
        }),
        exclusions: boundedArray(textSchema(240), {
          maximum: 64,
          unique: true,
        }),
      },
      [
        "schemaVersion",
        "projectId",
        "projectRoot",
        "engine",
        "stage",
        "teamSize",
        "gameShape",
        "targets",
        "budgets",
        "coreLoop",
        "pillars",
        "exclusions",
      ],
    ),
  });

export type EngineExecutionKind =
  | "static"
  | "headless"
  | "editor-preview"
  | "runtime"
  | "packaged";

export interface EngineCapabilityReport {
  readonly schemaVersion: SemanticVersion;
  readonly reportId: StableId;
  readonly projectId: StableId;
  readonly generatedAt: string;
  readonly engineIdentity: {
    readonly engine: EngineId;
    readonly version: SemanticVersion;
    readonly projectIdentityDigest: Sha256Digest;
    readonly executableDigest?: Sha256Digest;
  };
  readonly sessionIdentity?: {
    readonly sessionId: string;
    readonly processId: number;
    readonly startedAt: string;
    readonly identityDigest: Sha256Digest;
  };
  readonly environmentDigest: Sha256Digest;
  readonly capabilities: readonly EngineCapability[];
}

export interface EngineCapability {
  readonly id: StableId;
  readonly operation: EngineOperationKind;
  readonly operationVersion: SemanticVersion;
  readonly support: CapabilitySupportGrade;
  readonly execution: EngineExecutionKind;
  readonly requiredComponents: readonly StableId[];
  readonly limitations: readonly string[];
  readonly degradeReason?: string;
  readonly permissions: readonly PermissionClass[];
  readonly requiredEvidence: readonly StableId[];
  readonly evidenceGrade: EvidenceGrade;
  readonly latestReceiptDigest?: Sha256Digest;
  readonly budgetStatus?: "declared" | "missing" | "exceeded";
  readonly checkedAt: string;
}

const capabilityEngineIdentity = closedObject(
  {
    engine: reference("engineId"),
    version: reference("semanticVersion"),
    projectIdentityDigest: reference("sha256Digest"),
    executableDigest: reference("sha256Digest"),
  },
  ["engine", "version", "projectIdentityDigest"],
);

const sessionIdentity = closedObject(
  {
    sessionId: reference("uuid"),
    processId: { type: "integer", minimum: 1, maximum: 2147483647 },
    startedAt: reference("timestamp"),
    identityDigest: reference("sha256Digest"),
  },
  ["sessionId", "processId", "startedAt", "identityDigest"],
);

const engineCapabilityRoot = closedObject(
  {
    id: reference("stableId"),
    operation: reference("engineOperation"),
    operationVersion: reference("semanticVersion"),
    support: reference("supportGrade"),
    execution: enumSchema([
      "static",
      "headless",
      "editor-preview",
      "runtime",
      "packaged",
    ]),
    requiredComponents: boundedArray(reference("stableId"), {
      maximum: 64,
      unique: true,
    }),
    limitations: boundedArray(textSchema(500), { maximum: 64 }),
    degradeReason: textSchema(500),
    permissions: boundedArray(reference("permissionClass"), {
      maximum: 11,
      unique: true,
    }),
    requiredEvidence: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 64,
      unique: true,
    }),
    evidenceGrade: reference("evidenceGrade"),
    latestReceiptDigest: reference("sha256Digest"),
    budgetStatus: enumSchema(["declared", "missing", "exceeded"]),
    checkedAt: reference("timestamp"),
  },
  [
    "id",
    "operation",
    "operationVersion",
    "support",
    "execution",
    "requiredComponents",
    "limitations",
    "permissions",
    "requiredEvidence",
    "evidenceGrade",
    "checkedAt",
  ],
);

const engineCapability = {
  ...engineCapabilityRoot,
  allOf: [
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
          latestReceiptDigest: reference("sha256Digest"),
        },
        required: ["evidenceGrade", "latestReceiptDigest"],
      },
    },
    {
      if: {
        type: "object",
        properties: { support: { const: "planned" } },
        required: ["support"],
      },
      then: {
        type: "object",
        properties: { degradeReason: textSchema(500) },
        required: ["degradeReason"],
      },
    },
  ],
};

export const engineCapabilityReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-capability-report",
    version: "1.0.0",
    title: "Engine Capability Report",
    description:
      "Reports support and evidence per engine operation without a global supported flag.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        reportId: reference("stableId"),
        projectId: reference("stableId"),
        generatedAt: reference("timestamp"),
        engineIdentity: capabilityEngineIdentity,
        sessionIdentity,
        environmentDigest: reference("sha256Digest"),
        capabilities: boundedArray(engineCapability, {
          minimum: 1,
          maximum: 256,
        }),
      },
      [
        "schemaVersion",
        "reportId",
        "projectId",
        "generatedAt",
        "engineIdentity",
        "environmentDigest",
        "capabilities",
      ],
    ),
  });
