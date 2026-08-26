export class GodotAdapterBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GodotAdapterBoundaryError";
    this.code = code;
  }
}
