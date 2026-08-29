export type EngineCommonBoundaryErrorCode =
  | "engine-adapter-definition-invalid"
  | "engine-adapter-authority-invalid"
  | "engine-adapter-invocation-invalid"
  | "engine-adapter-operation-invalid"
  | "engine-adapter-cancelled-before-start"
  | "engine-adapter-result-mismatch"
  | "engine-snapshot-request-invalid"
  | "engine-snapshot-project-invalid"
  | "engine-snapshot-project-drift"
  | "engine-snapshot-project-budget-exceeded"
  | "engine-snapshot-path-invalid"
  | "engine-snapshot-link-rejected"
  | "engine-snapshot-file-invalid"
  | "engine-snapshot-executable-invalid"
  | "engine-snapshot-authority-invalid"
  | "engine-snapshot-authority-consumed"
  | "engine-snapshot-handoff-invalid"
  | "engine-snapshot-handoff-budget-exceeded";

export class EngineCommonBoundaryError extends Error {
  readonly code: EngineCommonBoundaryErrorCode;
  readonly mutationUncertain: false = false;

  constructor(code: EngineCommonBoundaryErrorCode, message: string) {
    super(message);
    this.name = "EngineCommonBoundaryError";
    this.code = code;
  }
}
