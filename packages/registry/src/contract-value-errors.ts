export type RegistryContractValueErrorCode =
  | "registered-schema-not-found"
  | "registered-schema-digest-mismatch"
  | "registered-schema-invalid"
  | "registered-value-invalid";

export class RegistryContractValueError extends TypeError {
  readonly code: RegistryContractValueErrorCode;
  readonly path: string;

  constructor(
    code: RegistryContractValueErrorCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message.slice(0, 500)}`);
    this.name = "RegistryContractValueError";
    this.code = code;
    this.path = path;
  }
}
