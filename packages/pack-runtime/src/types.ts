import type {
  SemanticVersion,
  Sha256Digest,
  StableId,
} from "@ai-game-playbook/contracts";

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
  readonly changes: readonly PackChange[];
  readonly conflicts: readonly PackConflict[];
  readonly planDigest: Sha256Digest;
}
