export type WorkflowPlanResolutionErrorCode =
  | "invalid-workflow-plan-request"
  | "workflow-plan-not-found"
  | "workflow-plan-stage-unsupported"
  | "workflow-plan-registry-invariant";

export class WorkflowPlanResolutionError extends TypeError {
  readonly code: WorkflowPlanResolutionErrorCode;
  readonly path: string;

  constructor(
    code: WorkflowPlanResolutionErrorCode,
    path: string,
    message: string,
  ) {
    super(`${path}: ${message.slice(0, 500)}`);
    this.name = "WorkflowPlanResolutionError";
    this.code = code;
    this.path = path;
  }
}
