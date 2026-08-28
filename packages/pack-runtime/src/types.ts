import type {
  ExecutionBudgets,
  ProjectStage,
  SemanticVersion,
  Sha256Digest,
  StableId,
} from "@ai-game-playbook/contracts";
import type {
  AuthorizedPermissionDecision,
  PermissionAuthorizationRequest,
  PermissionSettlement,
  ProjectDirectoryIdentity,
  ProjectLaneLease,
} from "@ai-game-playbook/core";

export type PackOperation = "add" | "remove" | "update";

export interface PackOperationLimits {
  readonly maxArtifactBytes: number;
  readonly maxTotalBytes: number;
  readonly maxDirectoryEntries: number;
}

export interface PreparePackOperationRequest {
  readonly operation: PackOperation;
  readonly registry: unknown;
  readonly targetRoot: unknown;
  readonly sourceRoot?: unknown;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly workflow?: {
    readonly id: StableId;
    readonly stepId: StableId;
    readonly projectStage: ProjectStage;
  };
  readonly runId: string;
  readonly packId: StableId;
  readonly limits: PackOperationLimits;
}

export type PackChange =
  | {
      readonly kind: "create";
      readonly path: string;
      readonly afterDigest: Sha256Digest;
      readonly bytes: number;
    }
  | {
      readonly kind: "replace";
      readonly path: string;
      readonly beforeDigest: Sha256Digest;
      readonly afterDigest: Sha256Digest;
      readonly bytes: number;
    }
  | {
      readonly kind: "delete";
      readonly path: string;
      readonly beforeDigest: Sha256Digest;
      readonly bytes: number;
    }
  | {
      readonly kind: "unchanged";
      readonly path: string;
      readonly beforeDigest: Sha256Digest;
      readonly afterDigest: Sha256Digest;
      readonly bytes: number;
    };

export interface PackDirectoryOwnershipMarker {
  readonly directoryPath: string;
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly ownershipDigest: Sha256Digest;
  readonly ownerPackDigest: Sha256Digest;
}

export type PackDirectoryChange =
  | {
      readonly kind: "create";
      readonly path: string;
      readonly marker: PackDirectoryOwnershipMarker;
    }
  | {
      readonly kind: "retain";
      readonly path: string;
      readonly marker: PackDirectoryOwnershipMarker;
      readonly expectedIdentity: ProjectDirectoryIdentity;
    }
  | {
      readonly kind: "delete";
      readonly path: string;
      readonly marker: PackDirectoryOwnershipMarker;
      readonly expectedIdentity: ProjectDirectoryIdentity;
      readonly tombstonePath: string;
    };

export type PackConflictCode =
  | "already-installed"
  | "dependency-in-use"
  | "dependency-missing"
  | "downgrade-refused"
  | "integrity-conflict"
  | "not-installed"
  | "non-owned-target"
  | "owned-target-missing"
  | "target-parent-missing"
  | "user-modified";

export interface PackConflict {
  readonly code: PackConflictCode;
  readonly path: string;
  readonly actualDigest?: Sha256Digest;
  readonly expectedDigest?: Sha256Digest;
  readonly packId?: StableId;
}

export interface PreparedPackOperation {
  readonly schemaVersion: "1.0.0";
  readonly operation: PackOperation;
  readonly disposition: "conflicted" | "no-op" | "ready";
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly workflow?: {
    readonly id: StableId;
    readonly stepId: StableId;
    readonly projectStage: ProjectStage;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly sourceRootIdentityDigest?: Sha256Digest;
  readonly registryDigest: Sha256Digest;
  readonly pack: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly digest: Sha256Digest;
  };
  readonly installedState: {
    readonly revision: number;
    readonly digest: Sha256Digest;
    readonly fileDigest?: Sha256Digest;
  };
  readonly limits: PackOperationLimits;
  readonly directoryChanges: readonly PackDirectoryChange[];
  readonly changes: readonly PackChange[];
  readonly conflicts: readonly PackConflict[];
  readonly planDigest: Sha256Digest;
}

export interface CreatePackOperationAuthorizationRequest {
  readonly plan: unknown;
  readonly budgets: ExecutionBudgets;
  readonly deadlineAt: string;
}

export interface ExecutePackOperationRequest {
  readonly plan: unknown;
  readonly authorization?: AuthorizedPermissionDecision;
  readonly lane?: ProjectLaneLease;
  readonly signal?: AbortSignal | null;
}

export interface PackExecutionEffects {
  readonly changedPaths: readonly string[];
  readonly changedBytes: number;
  readonly appliedPaths: readonly string[];
  readonly rolledBackPaths: readonly string[];
}

export interface PackExecutionErrorSummary {
  readonly code: string;
  readonly path: string;
}

export type PackExecutionResult =
  | {
      readonly schemaVersion: "1.0.0";
      readonly status: "no-op";
      readonly operation: PackOperation;
      readonly planDigest: Sha256Digest;
      readonly mutationUncertain: false;
      readonly effects: PackExecutionEffects;
    }
  | {
      readonly schemaVersion: "1.0.0";
      readonly status:
        | "failed"
        | "recovery-required"
        | "rolled-back"
        | "succeeded";
      readonly operation: PackOperation;
      readonly planDigest: Sha256Digest;
      readonly mutationUncertain: boolean;
      readonly transaction: {
        readonly startedRecordPath: string;
        readonly startedRecordDigest?: Sha256Digest;
        readonly terminalRecordPath: string;
        readonly terminalRecordDigest?: Sha256Digest;
        readonly terminalRecordFileDigest?: Sha256Digest;
        readonly terminalRecordBytes?: number;
      };
      readonly installedState: {
        readonly beforeDigest: Sha256Digest;
        readonly afterDigest?: Sha256Digest;
        readonly fileDigest?: Sha256Digest;
      };
      readonly effects: PackExecutionEffects;
      readonly settlement: PermissionSettlement;
      readonly error?: PackExecutionErrorSummary;
    };

export type PackOperationAuthorizationRequest = PermissionAuthorizationRequest;
