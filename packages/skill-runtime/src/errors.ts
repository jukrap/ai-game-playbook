export type SkillRuntimeBoundaryErrorCode =
  | "skill-runtime-artifact-invalid"
  | "skill-runtime-options-invalid"
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
