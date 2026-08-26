export type CoreBoundaryErrorCode =
  | "filesystem-operation-failed"
  | "invalid-project-root"
  | "invalid-project-path-options"
  | "project-path-budget-exceeded"
  | "project-path-case-conflict"
  | "project-path-escape"
  | "project-path-exists"
  | "project-path-link"
  | "project-path-not-found"
  | "project-path-type-mismatch"
  | "project-root-drift"
  | "project-root-not-directory"
  | "project-root-not-found"
  | "unsafe-project-root";

export class CoreBoundaryError extends Error {
  readonly code: CoreBoundaryErrorCode;
  readonly path: string;
  readonly mutationUncertain: boolean;

  constructor(
    code: CoreBoundaryErrorCode,
    path: string,
    message: string,
    mutationUncertain = false,
  ) {
    super(`${path}: ${message}`);
    this.name = "CoreBoundaryError";
    this.code = code;
    this.path = path;
    this.mutationUncertain = mutationUncertain;
  }
}
