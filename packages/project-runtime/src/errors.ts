export type ProjectRuntimeErrorCode =
  | "invalid-project-initialization-request"
  | "invalid-project-initialization-execution-request"
  | "project-initialization-authorization-invalid"
  | "project-initialization-budget-exceeded"
  | "project-initialization-evidence-failed"
  | "project-initialization-execution-failed"
  | "project-initialization-lane-failed"
  | "project-initialization-metadata-invalid"
  | "project-initialization-plan-stale"
  | "project-initialization-plan-not-ready"
  | "project-initialization-plan-untrusted"
  | "project-initialization-profile-invalid"
  | "project-initialization-recovery-required";

export class ProjectRuntimeError extends Error {
  readonly code: ProjectRuntimeErrorCode;
  readonly path: string;
  readonly mutationUncertain: boolean;

  constructor(
    code: ProjectRuntimeErrorCode,
    path: string,
    message: string,
    mutationUncertain = false,
  ) {
    super(`${path}: ${message}`);
    this.name = "ProjectRuntimeError";
    this.code = code;
    this.path = path;
    this.mutationUncertain = mutationUncertain;
  }
}
