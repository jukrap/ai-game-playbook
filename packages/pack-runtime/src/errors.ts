export type PackRuntimeErrorCode =
  | "invalid-pack-request"
  | "invalid-pack-execution-request"
  | "invalid-pack-recovery-request"
  | "pack-artifact-budget-exceeded"
  | "pack-artifact-digest-mismatch"
  | "pack-authorization-invalid"
  | "pack-execution-failed"
  | "pack-execution-uncertain"
  | "pack-lane-invalid"
  | "pack-not-found"
  | "pack-plan-conflicted"
  | "pack-plan-not-executable"
  | "pack-plan-untrusted"
  | "pack-registry-untrusted"
  | "pack-recovery-budget-exceeded"
  | "pack-state-corrupt"
  | "pack-storage-not-initialized"
  | "pack-surface-unsupported"
  | "pack-target-invalid"
  | "pack-transaction-conflict"
  | "pack-transaction-corrupt"
  | "pack-transaction-not-found";

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
