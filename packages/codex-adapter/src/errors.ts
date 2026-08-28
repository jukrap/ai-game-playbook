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

export type CodexApprovalBoundaryErrorCode =
  | "codex-approval-decision-invalid"
  | "codex-approval-host-failed"
  | "codex-approval-host-mismatch"
  | "codex-approval-presenter-invalid"
  | "codex-approval-session-active"
  | "codex-approval-session-invalid"
  | "codex-approval-session-settled";

export class CodexApprovalBoundaryError extends Error {
  readonly code: CodexApprovalBoundaryErrorCode;

  constructor(code: CodexApprovalBoundaryErrorCode, message: string) {
    super(message);
    this.name = "CodexApprovalBoundaryError";
    this.code = code;
  }
}

export type CodexManagedSkillBoundaryErrorCode =
  | "codex-managed-skill-operation-active"
  | "codex-managed-skill-operation-invalid"
  | "codex-managed-skill-operation-settled"
  | "codex-managed-skill-plan-conflicted"
  | "codex-managed-skill-signing-key-mismatch"
  | "codex-managed-skill-status-mismatch";

export class CodexManagedSkillBoundaryError extends Error {
  readonly code: CodexManagedSkillBoundaryErrorCode;

  constructor(code: CodexManagedSkillBoundaryErrorCode, message: string) {
    super(message);
    this.name = "CodexManagedSkillBoundaryError";
    this.code = code;
  }
}
