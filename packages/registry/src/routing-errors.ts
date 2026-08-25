export type TaskRoutingDiagnosticCode =
  | "routing-lifecycle-not-routable"
  | "routing-registry-digest-mismatch"
  | "routing-role-lens-missing"
  | "routing-schema-invalid"
  | "routing-skill-invocation-mismatch"
  | "routing-skill-missing"
  | "routing-skill-stage-mismatch";

export interface TaskRoutingDiagnostic {
  readonly code: TaskRoutingDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export class TaskRoutingSelectionError extends TypeError {
  readonly diagnostics: readonly TaskRoutingDiagnostic[];

  constructor(diagnostics: readonly TaskRoutingDiagnostic[]) {
    const sorted = [...diagnostics].sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
    );
    super(
      sorted.length === 1
        ? `${sorted[0]?.path}: ${sorted[0]?.message}`
        : `task routing selection failed with ${sorted.length} diagnostics`,
    );
    this.name = "TaskRoutingSelectionError";
    this.diagnostics = Object.freeze(
      sorted.map((diagnostic) => Object.freeze({ ...diagnostic })),
    );
  }
}
