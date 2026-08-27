export type McpRuntimeBoundaryErrorCode =
  | "mcp-arguments-invalid"
  | "mcp-host-disclosure-required"
  | "mcp-tool-selection-invalid"
  | "mcp-runtime-plan-invalid"
  | "mcp-project-boundary"
  | "mcp-tool-unavailable"
  | "mcp-handler-binding-invalid"
  | "mcp-command-input-invalid"
  | "mcp-command-output-invalid"
  | "mcp-command-cancelled"
  | "mcp-command-deadline"
  | "mcp-command-settlement-uncertain"
  | "mcp-output-budget-exceeded"
  | "mcp-runtime-failure";

export class McpRuntimeBoundaryError extends Error {
  readonly code: McpRuntimeBoundaryErrorCode;

  constructor(code: McpRuntimeBoundaryErrorCode, message: string) {
    super(message);
    this.name = "McpRuntimeBoundaryError";
    this.code = code;
  }
}
