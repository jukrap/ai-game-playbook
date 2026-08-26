import {
  PROJECT_STAGES,
  checkResolvedWorkflowPlanSemantics,
  compareCanonicalText,
  computeResolvedWorkflowPlanDigest,
  digestCanonicalJson,
  isStableId,
  resolvedWorkflowPlanSchema,
  type CommandDescriptor,
  type ProjectStage,
  type ResolvedWorkflowCommand,
  type ResolvedWorkflowPlan,
  type ResolvedWorkflowStep,
  type WorkflowDescriptor,
  type WorkflowStep,
} from "@ai-game-playbook/contracts";

import { assertValidatedRegistry } from "./validation.js";
import { WorkflowPlanResolutionError } from "./workflow-plan-errors.js";
import type { ValidatedRegistry } from "./types.js";

function planError(
  code: ConstructorParameters<typeof WorkflowPlanResolutionError>[0],
  path: string,
  message: string,
): WorkflowPlanResolutionError {
  return new WorkflowPlanResolutionError(code, path, message);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function commandBinding(command: CommandDescriptor): ResolvedWorkflowCommand {
  return {
    id: command.id,
    version: command.version,
    descriptorDigest: digestCanonicalJson(command),
    handlerDigest: command.handler.digest,
    lane: command.lane,
    permissions: [...command.permissions].sort(compareCanonicalText),
  };
}

function topologicalSteps(workflow: WorkflowDescriptor): readonly WorkflowStep[] {
  const byId = new Map(workflow.steps.map((step) => [step.id, step]));
  const remainingDependencies = new Map(
    workflow.steps.map((step) => [step.id, new Set(step.dependsOn)]),
  );
  const ready = workflow.steps
    .filter((step) => step.dependsOn.length === 0)
    .map(({ id }) => id)
    .sort(compareCanonicalText);
  const ordered: WorkflowStep[] = [];

  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    const step = byId.get(id);
    if (step === undefined) {
      throw planError(
        "workflow-plan-registry-invariant",
        "$workflow.steps",
        "validated workflow contains an unresolved step",
      );
    }
    ordered.push(step);
    for (const [candidateId, dependencies] of remainingDependencies) {
      if (!dependencies.delete(id) || dependencies.size !== 0) continue;
      if (
        !ordered.some(({ id: completedId }) => completedId === candidateId) &&
        !ready.includes(candidateId)
      ) {
        ready.push(candidateId);
        ready.sort(compareCanonicalText);
      }
    }
  }

  if (ordered.length !== workflow.steps.length) {
    throw planError(
      "workflow-plan-registry-invariant",
      "$workflow.steps",
      "validated workflow DAG could not be resolved",
    );
  }
  return ordered;
}

function resolveStep(
  step: WorkflowStep,
  ordinal: number,
  commands: ReadonlyMap<string, CommandDescriptor>,
): ResolvedWorkflowStep {
  const command = commands.get(step.commandId);
  const rollback =
    step.rollbackCommandId === undefined
      ? undefined
      : commands.get(step.rollbackCommandId);
  if (
    command === undefined ||
    (step.onFailure === "rollback" && rollback === undefined)
  ) {
    throw planError(
      "workflow-plan-registry-invariant",
      `$workflow.steps[${ordinal}]`,
      "validated workflow command authority is missing",
    );
  }
  const bindings = [...(step.bindings ?? [])]
    .map(({ target, source }) => ({ target, source }))
    .sort((left, right) =>
      compareCanonicalText(
        `${left.target}\u0000${left.source}`,
        `${right.target}\u0000${right.source}`,
      ),
    );
  return {
    id: step.id,
    ordinal,
    dependsOn: [...step.dependsOn].sort(compareCanonicalText),
    bindings,
    onFailure: step.onFailure,
    approvalCheckpoint: step.approvalCheckpoint,
    command: commandBinding(command),
    ...(rollback === undefined
      ? {}
      : { rollbackCommand: commandBinding(rollback) }),
  };
}

export function resolveWorkflowPlan(
  registry: ValidatedRegistry,
  workflowId: string,
  projectStage: ProjectStage,
): ResolvedWorkflowPlan {
  assertValidatedRegistry(registry);
  if (!isStableId(workflowId)) {
    throw planError(
      "invalid-workflow-plan-request",
      "$workflowId",
      "expected a canonical workflow ID",
    );
  }
  if (!PROJECT_STAGES.includes(projectStage)) {
    throw planError(
      "invalid-workflow-plan-request",
      "$projectStage",
      "expected a known project stage",
    );
  }
  const workflow = registry.workflows.find(({ id }) => id === workflowId);
  if (workflow === undefined) {
    throw planError(
      "workflow-plan-not-found",
      "$workflowId",
      "workflow is not registered",
    );
  }
  if (!workflow.supportedStages.includes(projectStage)) {
    throw planError(
      "workflow-plan-stage-unsupported",
      "$projectStage",
      "workflow does not support the requested project stage",
    );
  }
  const commands = new Map(
    registry.commands.map((command) => [command.id, command]),
  );
  const steps = topologicalSteps(workflow).map((step, ordinal) =>
    resolveStep(step, ordinal, commands),
  );
  const draft: Omit<ResolvedWorkflowPlan, "resolvedPlanDigest"> = {
    schemaVersion: resolvedWorkflowPlanSchema.version,
    registryDigest: registry.digest,
    workflow: {
      id: workflow.id,
      version: workflow.version,
      descriptorDigest: digestCanonicalJson(workflow),
    },
    projectStage,
    input: { ...workflow.input },
    output: { ...workflow.output },
    steps,
    budgets: {
      ...workflow.budgets,
      ...(workflow.budgets.maxCost === undefined
        ? {}
        : { maxCost: { ...workflow.budgets.maxCost } }),
    },
    resumePolicy: workflow.resumePolicy,
    terminalOracleDigest: digestCanonicalJson({
      domain: "ai-game-playbook.workflow-terminal-oracle",
      version: "1",
      statement: workflow.terminalOracle,
    }),
    requiredEvidence: [...workflow.requiredEvidence].sort(compareCanonicalText),
  };
  const plan: ResolvedWorkflowPlan = {
    ...draft,
    resolvedPlanDigest: computeResolvedWorkflowPlanDigest(draft),
  };
  const issues = checkResolvedWorkflowPlanSemantics(plan);
  if (issues.length > 0) {
    throw planError(
      "workflow-plan-registry-invariant",
      "$workflow",
      `resolved workflow plan violated ${issues[0]?.code ?? "an invariant"}`,
    );
  }
  return deepFreeze(plan);
}
