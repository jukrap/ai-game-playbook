export type CoreBoundaryErrorCode =
  | "cas-budget-exceeded"
  | "cas-cleanup-conflict"
  | "cas-commit-failed"
  | "cas-postcondition-failed"
  | "cas-precondition-failed"
  | "cas-stage-failed"
  | "cas-state-invalid"
  | "filesystem-operation-failed"
  | "invalid-cas-request"
  | "invalid-process-executable"
  | "invalid-process-request"
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
  | "process-cancelled-before-spawn"
  | "process-executable-budget-exceeded"
  | "process-executable-drift"
  | "process-executable-link"
  | "process-executable-not-file"
  | "process-executable-not-found"
  | "process-timeout-before-spawn"
  | "process-working-directory-drift"
  | "invalid-project-lane-request"
  | "project-lane-busy"
  | "project-lane-cancelled"
  | "project-lane-expired"
  | "project-lane-identity-mismatch"
  | "project-lane-lock-invalid"
  | "project-lane-lock-write-failed"
  | "project-lane-ownership-lost"
  | "project-lane-recovery-failed"
  | "project-lane-release-failed"
  | "project-lane-state-invalid"
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
