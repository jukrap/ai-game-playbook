export type SkillRuntimeBoundaryErrorCode =
  | "skill-runtime-artifact-invalid"
  | "skill-runtime-options-invalid"
  | "skill-runtime-materialization-budget-exceeded"
  | "skill-runtime-materialization-drift"
  | "skill-runtime-materialization-plan-invalid"
  | "skill-runtime-materialization-request-invalid"
  | "skill-runtime-managed-install-plan-invalid"
  | "skill-runtime-managed-install-request-invalid"
  | "skill-runtime-plan-invalid"
  | "skill-runtime-project-boundary"
  | "skill-runtime-registry-drift"
  | "skill-runtime-runtime-drift";

export class SkillRuntimeBoundaryError extends Error {
  readonly code: SkillRuntimeBoundaryErrorCode;

  constructor(code: SkillRuntimeBoundaryErrorCode, message: string) {
    super(message);
    this.name = "SkillRuntimeBoundaryError";
    this.code = code;
  }
}
