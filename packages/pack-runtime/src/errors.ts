export type PackRuntimeErrorCode =
  | "invalid-pack-request"
  | "pack-artifact-budget-exceeded"
  | "pack-artifact-digest-mismatch"
  | "pack-not-found"
  | "pack-plan-untrusted"
  | "pack-registry-untrusted"
  | "pack-state-corrupt"
  | "pack-surface-unsupported"
  | "pack-target-invalid";

export class PackRuntimeError extends Error {
  readonly code: PackRuntimeErrorCode;
  readonly path: string;
  readonly mutationUncertain: boolean;

  constructor(
    code: PackRuntimeErrorCode,
    path: string,
    message: string,
    mutationUncertain = false,
  ) {
    super(`${path}: ${message}`);
    this.name = "PackRuntimeError";
    this.code = code;
    this.path = path;
    this.mutationUncertain = mutationUncertain;
  }
}
