import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  CapabilitySupportGrade,
  ComponentOutcome,
  CpuArchitecture,
  EngineId,
  EvidenceGrade,
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

export type RuntimeFrameOrigin =
  | "editor-preview"
  | "in-editor-play"
  | "standalone-player"
  | "packaged-player";

export interface RuntimeFrameEvidence {
  readonly schemaVersion: SemanticVersion;
  readonly artifactDigest: Sha256Digest;
  readonly bytes: number;
  readonly complete: true;
  readonly origin: RuntimeFrameOrigin;
  readonly runId: string;
  readonly tick: number;
  readonly stateDigest: Sha256Digest;
  readonly inputTraceDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly sessionIdentityDigest: Sha256Digest;
  readonly engine: EngineId;
  readonly engineVersion: SemanticVersion;
  readonly renderer: string;
  readonly sceneId: StableId;
  readonly cameraId: StableId;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly scale: string;
  };
  readonly seed: string;
  readonly capturedAt: string;
}

const viewport = closedObject(
  {
    width: { type: "integer", minimum: 1, maximum: 32768 },
    height: { type: "integer", minimum: 1, maximum: 32768 },
    scale: {
      type: "string",
      pattern: "^(?:0|[1-9][0-9]{0,5})(?:\\.[0-9]{1,6})?$",
    },
  },
  ["width", "height", "scale"],
);

export const runtimeFrameEvidenceSchema: VersionedContractSchema =
  defineContractSchema({
    id: "runtime-frame-evidence",
    version: "1.0.0",
    title: "Runtime Frame Evidence",
    description:
      "Attests a completed frame with runtime origin, state, input, engine, scene, camera, viewport, and seed identity.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        artifactDigest: reference("sha256Digest"),
        bytes: { type: "integer", minimum: 1, maximum: 1099511627776 },
        complete: { const: true },
        origin: enumSchema([
          "editor-preview",
          "in-editor-play",
          "standalone-player",
          "packaged-player",
        ]),
        runId: reference("uuid"),
        tick: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        stateDigest: reference("sha256Digest"),
        inputTraceDigest: reference("sha256Digest"),
        projectIdentityDigest: reference("sha256Digest"),
        sessionIdentityDigest: reference("sha256Digest"),
        engine: reference("engineId"),
        engineVersion: reference("semanticVersion"),
        renderer: textSchema(200),
        sceneId: reference("stableId"),
        cameraId: reference("stableId"),
        viewport,
        seed: { type: "string", minLength: 1, maxLength: 256 },
        capturedAt: reference("timestamp"),
      },
      [
        "schemaVersion",
        "artifactDigest",
        "bytes",
        "complete",
        "origin",
        "runId",
        "tick",
        "stateDigest",
        "inputTraceDigest",
        "projectIdentityDigest",
        "sessionIdentityDigest",
        "engine",
        "engineVersion",
        "renderer",
        "sceneId",
        "cameraId",
        "viewport",
        "seed",
        "capturedAt",
      ],
    ),
  });

export interface InputReplayTrace {
  readonly schemaVersion: SemanticVersion;
  readonly scenarioId: StableId;
  readonly scenarioVersion: SemanticVersion;
  readonly runId: string;
  readonly projectIdentityDigest: Sha256Digest;
  readonly sessionIdentityDigest: Sha256Digest;
  readonly seed: string;
  readonly tickRate: number;
  readonly initialStateDigest: Sha256Digest;
  readonly inputMappingDigest: Sha256Digest;
  readonly events: readonly {
    readonly tick: number;
    readonly action: StableId;
    readonly value: string;
    readonly durationTicks: number;
  }[];
  readonly terminalStateDigest: Sha256Digest;
  readonly oracle: {
    readonly id: StableId;
    readonly outcome: ComponentOutcome;
    readonly toleranceDigest?: Sha256Digest;
  };
  readonly divergenceCount: number;
  readonly completedAt: string;
}

const replayEvent = closedObject(
  {
    tick: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    action: reference("stableId"),
    value: {
      type: "string",
      pattern: "^-?(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,6})?$",
    },
    durationTicks: {
      type: "integer",
      minimum: 1,
      maximum: 1000000000,
    },
  },
  ["tick", "action", "value", "durationTicks"],
);

const replayOracle = closedObject(
  {
    id: reference("stableId"),
    outcome: reference("componentOutcome"),
    toleranceDigest: reference("sha256Digest"),
  },
  ["id", "outcome"],
);

const inputReplayTraceRoot = contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        scenarioId: reference("stableId"),
        scenarioVersion: reference("semanticVersion"),
        runId: reference("uuid"),
        projectIdentityDigest: reference("sha256Digest"),
        sessionIdentityDigest: reference("sha256Digest"),
        seed: { type: "string", minLength: 1, maxLength: 256 },
        tickRate: { type: "integer", minimum: 1, maximum: 10000 },
        initialStateDigest: reference("sha256Digest"),
        inputMappingDigest: reference("sha256Digest"),
        events: boundedArray(replayEvent, { minimum: 1, maximum: 1000000 }),
        terminalStateDigest: reference("sha256Digest"),
        oracle: replayOracle,
        divergenceCount: { type: "integer", minimum: 0, maximum: 1000000 },
        completedAt: reference("timestamp"),
      },
      [
        "schemaVersion",
        "scenarioId",
        "scenarioVersion",
        "runId",
        "projectIdentityDigest",
        "sessionIdentityDigest",
        "seed",
        "tickRate",
        "initialStateDigest",
        "inputMappingDigest",
        "events",
        "terminalStateDigest",
        "oracle",
        "divergenceCount",
        "completedAt",
      ],
);

export const inputReplayTraceSchema: VersionedContractSchema =
  defineContractSchema({
    id: "input-replay-trace",
    version: "1.0.0",
    title: "Input Replay Trace",
    description:
      "Records deterministic tick-relative input, state, mapping, oracle, and divergence identity.",
    schema: {
      ...inputReplayTraceRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: {
              oracle: {
                type: "object",
                properties: { outcome: { const: "passed" } },
                required: ["outcome"],
              },
            },
            required: ["oracle"],
          },
          then: {
            type: "object",
            properties: { divergenceCount: { const: 0 } },
            required: ["divergenceCount"],
          },
        },
      ],
    },
  });

export interface BuildArtifactEvidence {
  readonly schemaVersion: SemanticVersion;
  readonly artifactDigest: Sha256Digest;
  readonly path: string;
  readonly bytes: number;
  readonly projectIdentityDigest: Sha256Digest;
  readonly engine: EngineId;
  readonly engineVersion: SemanticVersion;
  readonly target: {
    readonly platform: OperatingSystem;
    readonly architecture: CpuArchitecture;
    readonly configuration: "development" | "test" | "release";
  };
  readonly buildReceiptDigest: Sha256Digest;
  readonly createdAt: string;
  readonly startup: {
    readonly attempted: boolean;
    readonly outcome: ComponentOutcome;
    readonly exitCode?: number;
    readonly durationMs: number;
    readonly logsDigest?: Sha256Digest;
  };
  readonly scenarioReceiptDigest?: Sha256Digest;
  readonly support: Exclude<CapabilitySupportGrade, "planned">;
  readonly evidenceGrade: EvidenceGrade;
}

const buildTarget = closedObject(
  {
    platform: reference("operatingSystem"),
    architecture: reference("architecture"),
    configuration: enumSchema(["development", "test", "release"]),
  },
  ["platform", "architecture", "configuration"],
);

const startupEvidenceRoot = closedObject(
  {
    attempted: { type: "boolean" },
    outcome: reference("componentOutcome"),
    exitCode: { type: "integer", minimum: -2147483648, maximum: 2147483647 },
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
    logsDigest: reference("sha256Digest"),
  },
  ["attempted", "outcome", "durationMs"],
);

const startupEvidence = {
  ...startupEvidenceRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { attempted: { const: false } },
        required: ["attempted"],
      },
      then: {
        type: "object",
        properties: {
          outcome: { const: "not-run" },
          exitCode: false,
          durationMs: { const: 0 },
          logsDigest: false,
        },
        required: ["outcome", "durationMs"],
      },
    },
    {
      if: {
        type: "object",
        properties: { attempted: { const: true } },
        required: ["attempted"],
      },
      then: {
        type: "object",
        properties: {
          outcome: enumSchema([
            "passed",
            "failed",
            "blocked",
            "cancelled",
            "uncertain",
            "unverified",
          ]),
          logsDigest: reference("sha256Digest"),
        },
        required: ["outcome", "logsDigest"],
      },
    },
    {
      if: {
        type: "object",
        properties: { outcome: { const: "passed" } },
        required: ["outcome"],
      },
      then: {
        type: "object",
        properties: {
          attempted: { const: true },
          exitCode: { const: 0 },
          logsDigest: reference("sha256Digest"),
        },
        required: ["attempted", "exitCode", "logsDigest"],
      },
    },
  ],
};

const buildArtifactRoot = contractRoot(
  {
    schemaVersion: reference("semanticVersion"),
    artifactDigest: reference("sha256Digest"),
    path: reference("portablePath"),
    bytes: { type: "integer", minimum: 1, maximum: 1099511627776 },
    projectIdentityDigest: reference("sha256Digest"),
    engine: reference("engineId"),
    engineVersion: reference("semanticVersion"),
    target: buildTarget,
    buildReceiptDigest: reference("sha256Digest"),
    createdAt: reference("timestamp"),
    startup: startupEvidence,
    scenarioReceiptDigest: reference("sha256Digest"),
    support: enumSchema(["detected", "headless", "editor-preview", "verified"]),
    evidenceGrade: reference("evidenceGrade"),
  },
  [
    "schemaVersion",
    "artifactDigest",
    "path",
    "bytes",
    "projectIdentityDigest",
    "engine",
    "engineVersion",
    "target",
    "buildReceiptDigest",
    "createdAt",
    "startup",
    "support",
    "evidenceGrade",
  ],
);

export const buildArtifactEvidenceSchema: VersionedContractSchema =
  defineContractSchema({
    id: "build-artifact-evidence",
    version: "1.0.0",
    title: "Build Artifact Evidence",
    description:
      "Attests build identity separately from startup and packaged gameplay evidence.",
    schema: {
      ...buildArtifactRoot,
      allOf: [
        {
          if: {
            type: "object",
            properties: { support: { enum: ["detected", "headless"] } },
            required: ["support"],
          },
          then: {
            type: "object",
            properties: {
              evidenceGrade: enumSchema([
                "locally-executed",
                "engine-verified",
              ]),
            },
            required: ["evidenceGrade"],
          },
        },
        {
          if: {
            type: "object",
            properties: {
              support: { enum: ["editor-preview", "verified"] },
            },
            required: ["support"],
          },
          then: {
            type: "object",
            properties: { evidenceGrade: { const: "engine-verified" } },
            required: ["evidenceGrade"],
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
            required: ["scenarioReceiptDigest"],
            properties: {
              scenarioReceiptDigest: reference("sha256Digest"),
              startup: {
                type: "object",
                properties: {
                  attempted: { const: true },
                  outcome: { const: "passed" },
                  exitCode: { const: 0 },
                  logsDigest: reference("sha256Digest"),
                },
                required: ["attempted", "outcome", "exitCode", "logsDigest"],
              },
              evidenceGrade: { const: "engine-verified" },
            },
          },
        },
      ],
    },
  });
