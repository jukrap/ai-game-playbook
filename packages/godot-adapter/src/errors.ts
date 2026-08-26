export class GodotAdapterBoundaryError extends Error {
  readonly code: string;
  readonly mutationUncertain: boolean;

  constructor(code: string, message: string, mutationUncertain = false) {
    super(message);
    this.name = "GodotAdapterBoundaryError";
    this.code = code;
    this.mutationUncertain = mutationUncertain;
  }
}
