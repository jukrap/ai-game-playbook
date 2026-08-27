export type ProjectRuntimeErrorCode =
  | "invalid-project-initialization-request"
  | "project-initialization-budget-exceeded"
  | "project-initialization-metadata-invalid"
  | "project-initialization-plan-stale"
  | "project-initialization-plan-untrusted"
  | "project-initialization-profile-invalid";

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
