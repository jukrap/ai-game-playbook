import { compareCanonicalText } from "@ai-game-playbook/contracts";

export type RegistryDiagnosticCode =
  | "cli-path-collision"
  | "command-budget-mismatch"
  | "descriptor-schema-invalid"
  | "duplicate-id"
  | "external-schema-reference"
  | "invalid-retry-attempts"
  | "lane-permission-mismatch"
  | "invalid-control-plane-version"
  | "pack-compatibility-duplicate"
  | "pack-control-plane-incompatible"
  | "pack-digest-mismatch"
  | "pack-dependency-cycle"
  | "pack-dependency-duplicate"
  | "pack-dependency-missing"
  | "pack-dependency-version-mismatch"
  | "pack-lifecycle-command-missing"
  | "pack-network-declaration-invalid"
  | "pack-owned-path-invalid"
  | "pack-permission-underdeclared"
  | "pack-provision-collision"
  | "pack-provision-missing"
  | "pack-version-interval-invalid"
  | "registry-input-invalid"
  | "registry-shape-invalid"
  | "schema-attestation-invalid"
  | "schema-complexity-exceeded"
  | "schema-digest-mismatch"
  | "schema-id-duplicate"
  | "schema-reference-missing"
  | "side-effect-permission-mismatch"
  | "side-effect-without-permission"
  | "unsafe-retry-policy"
  | "unsupported-registry-version"
  | "workflow-binding-ambiguous"
  | "workflow-command-missing"
  | "workflow-cycle"
  | "workflow-dependency-missing"
  | "workflow-rollback-command-missing"
  | "workflow-stage-mismatch"
  | "workflow-step-duplicate";

export interface RegistryDiagnostic {
  readonly code: RegistryDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export class RegistryValidationError extends TypeError {
  readonly diagnostics: readonly RegistryDiagnostic[];

  constructor(diagnostics: readonly RegistryDiagnostic[]) {
    const sorted = [...diagnostics].sort(
      (left, right) =>
        compareCanonicalText(left.path, right.path) ||
        compareCanonicalText(left.code, right.code),
    );
    super(
      sorted.length === 1
        ? `${sorted[0]?.path}: ${sorted[0]?.message}`
        : `registry validation failed with ${sorted.length} diagnostics`,
    );
    this.name = "RegistryValidationError";
    this.diagnostics = Object.freeze(
      sorted.map((diagnostic) => Object.freeze({ ...diagnostic })),
    );
  }
}
