export type RegistryDiagnosticCode =
  | "cli-path-collision"
  | "command-budget-mismatch"
  | "descriptor-schema-invalid"
  | "duplicate-id"
  | "external-schema-reference"
  | "invalid-retry-attempts"
  | "lane-permission-mismatch"
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
        left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
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
