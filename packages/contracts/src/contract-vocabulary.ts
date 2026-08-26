import type { SemanticVersion } from "./semantic-version.js";
import type { Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export type { PortableProjectPath } from "./portable-path.js";

export type ProjectStage =
  | "concept"
  | "risk-prototype"
  | "vertical-slice"
  | "stabilization"
  | "release-candidate";

export type ExecutionLane =
  | "parallel-read"
  | "project-write"
  | "editor-bound"
  | "build-bound";

export type EffectBoundary = "local" | "network" | "external";

export type PermissionClass =
  | "read-project"
  | "host-tool-inspection"
  | "write-project-metadata"
  | "write-project-source"
  | "editor-control"
  | "test-build"
  | "install"
  | "network"
  | "external-transmission"
  | "paid-call"
  | "destructive"
  | "publish-release";

export type EngineId = "godot" | "unity" | "unreal";

export type EngineOperationKind =
  | "detect"
  | "negotiate"
  | "inspect"
  | "mutate"
  | "save"
  | "compile-import"
  | "test"
  | "play"
  | "input-replay"
  | "logs"
  | "capture"
  | "profile"
  | "build-export"
  | "rollback";

export type CapabilitySupportGrade =
  | "planned"
  | "detected"
  | "headless"
  | "editor-preview"
  | "verified";

export type EvidenceGrade =
  | "documented"
  | "implemented"
  | "test-witnessed"
  | "locally-executed"
  | "engine-verified";

export type ComponentOutcome =
  | "not-run"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "uncertain"
  | "unverified";

export type Lifecycle =
  | "experimental"
  | "stable"
  | "deprecated"
  | "internal";

export type OperatingSystem = "windows" | "linux" | "macos";
export type CpuArchitecture = "x64" | "arm64";
export type DecimalAmount = string;

export interface SchemaReference {
  readonly schemaId: string;
  readonly digest: Sha256Digest;
}

export interface ExecutionBudgets {
  readonly maxChangedFiles?: number;
  readonly maxChangedBytes?: number;
  readonly maxDurationMs: number;
  readonly maxOutputBytes: number;
  readonly maxRepairCycles: number;
  readonly maxMemoryBytes?: number;
  readonly maxCpuSeconds?: number;
  readonly maxGpuSeconds?: number;
  readonly maxCost?: {
    readonly currency: string;
    readonly amount: DecimalAmount;
  };
}

export interface EngineIdentity {
  readonly id: EngineId;
  readonly version: SemanticVersion;
  readonly projectIdentityDigest?: Sha256Digest;
  readonly executableDigest?: Sha256Digest;
}

export interface VersionedIdentity {
  readonly id: StableId;
  readonly version: SemanticVersion;
}

export const PROJECT_STAGES: readonly ProjectStage[] = Object.freeze([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);

export const EXECUTION_LANES: readonly ExecutionLane[] = Object.freeze([
  "parallel-read",
  "project-write",
  "editor-bound",
  "build-bound",
]);

export const EFFECT_BOUNDARIES: readonly EffectBoundary[] = Object.freeze([
  "local",
  "network",
  "external",
]);

export const PERMISSION_CLASSES: readonly PermissionClass[] = Object.freeze([
  "read-project",
  "host-tool-inspection",
  "write-project-metadata",
  "write-project-source",
  "editor-control",
  "test-build",
  "install",
  "network",
  "external-transmission",
  "paid-call",
  "destructive",
  "publish-release",
]);

export const ENGINE_OPERATION_KINDS: readonly EngineOperationKind[] =
  Object.freeze([
    "detect",
    "negotiate",
    "inspect",
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
  ]);

export const CAPABILITY_SUPPORT_GRADES: readonly CapabilitySupportGrade[] =
  Object.freeze([
    "planned",
    "detected",
    "headless",
    "editor-preview",
    "verified",
  ]);

export const EVIDENCE_GRADES: readonly EvidenceGrade[] = Object.freeze([
  "documented",
  "implemented",
  "test-witnessed",
  "locally-executed",
  "engine-verified",
]);

export const COMPONENT_OUTCOMES: readonly ComponentOutcome[] = Object.freeze([
  "not-run",
  "passed",
  "failed",
  "blocked",
  "cancelled",
  "uncertain",
  "unverified",
]);
