export type CodexSetupBoundaryErrorCode =
  | "codex-setup-disclosure-required"
  | "codex-setup-entrypoint-invalid"
  | "codex-setup-options-invalid"
  | "codex-setup-plan-invalid"
  | "codex-setup-project-boundary"
  | "codex-setup-registry-drift"
  | "codex-setup-runtime-drift"
  | "codex-setup-runtime-invalid"
  | "codex-setup-skill-artifact-invalid"
  | "codex-setup-target-unsafe";

export class CodexSetupBoundaryError extends Error {
  readonly code: CodexSetupBoundaryErrorCode;

  constructor(code: CodexSetupBoundaryErrorCode, message: string) {
    super(message);
    this.name = "CodexSetupBoundaryError";
    this.code = code;
  }
}
