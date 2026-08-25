export type ContractValueErrorCode =
  | "invalid-canonical-json"
  | "invalid-contract-schema"
  | "invalid-semantic-version"
  | "invalid-sha256-digest"
  | "invalid-sha256-input"
  | "invalid-stable-id";

export class ContractValueError extends TypeError {
  readonly code: ContractValueErrorCode;
  readonly path: string;

  constructor(code: ContractValueErrorCode, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ContractValueError";
    this.code = code;
    this.path = path;
  }
}
