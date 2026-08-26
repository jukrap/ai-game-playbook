export type EvidenceNormalizationErrorCode =
  | "invalid-process-result-observation"
  | "invalid-test-result-observation";

export class EvidenceNormalizationError extends Error {
  readonly code: EvidenceNormalizationErrorCode;
  readonly path: string;

  constructor(
    code: EvidenceNormalizationErrorCode,
    path: string,
    message: string,
  ) {
    super(message);
    this.name = "EvidenceNormalizationError";
    this.code = code;
    this.path = path;
  }
}
