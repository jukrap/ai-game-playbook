import {
  assertSkillCheckReportSemantics,
  computeSkillCheckDigest,
  computeSkillCheckStatus,
  parseSemanticVersion,
  parseStableId,
  summarizeSkillChecks,
  type SkillCheckReport,
  type SkillCheckRequest,
} from "@ai-game-playbook/contracts";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  SkillRuntimeBoundaryError,
  createProjectSkillPlan,
  inspectProjectSkillTargets,
} from "@ai-game-playbook/skill-runtime";

function descriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === "skill.check");
  if (command === undefined) {
    throw new TypeError("builtin registry does not contain skill.check");
  }
  return command;
}

function validateReport(report: SkillCheckReport): SkillCheckReport {
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor().output,
    report,
  ) as unknown as SkillCheckReport;
  assertSkillCheckReportSemantics(validated);
  return validated;
}

function unavailableReport(requestedPath: string): SkillCheckReport {
  const checks = Object.freeze([]);
  const issues = Object.freeze([
    Object.freeze({
      severity: "blocked" as const,
      code: parseStableId("skill-project-unavailable"),
      message:
        "The selected project root could not be bound to one stable local directory.",
      nextAction:
        "Select one existing local game project directory and rerun the skill command.",
    }),
  ]);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "skill.check" as const,
      status: computeSkillCheckStatus(checks, issues),
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({ requestedPath }),
      checks,
      issues,
      summary: summarizeSkillChecks(checks),
      materializationPerformed: false as const,
      mutationPerformed: false as const,
      externalProcessStarted: false as const,
      networkAccessPerformed: false as const,
    }),
  );
}

export async function runSkillCheck(input: unknown): Promise<SkillCheckReport> {
  const command = descriptor();
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    command.input,
    input,
  ) as unknown as SkillCheckRequest;

  let plan;
  try {
    plan = await createProjectSkillPlan({ projectRoot: request.projectRoot });
  } catch (error) {
    if (
      error instanceof SkillRuntimeBoundaryError &&
      error.code === "skill-runtime-project-boundary"
    ) {
      return unavailableReport(request.projectRoot);
    }
    throw error;
  }
  const inspection = await inspectProjectSkillTargets(plan);
  const issues = Object.freeze([]);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "skill.check" as const,
      status: computeSkillCheckStatus(inspection.checks, issues),
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({
        requestedPath: request.projectRoot,
        canonicalPath: plan.project.canonicalPath,
        identityDigest: plan.project.identityDigest,
      }),
      checks: inspection.checks,
      issues,
      summary: summarizeSkillChecks(inspection.checks),
      checkDigest: computeSkillCheckDigest({
        registryDigest: BUILTIN_REGISTRY.digest,
        projectIdentityDigest: plan.project.identityDigest,
        checks: inspection.checks,
      }),
      materializationPerformed: false as const,
      mutationPerformed: false as const,
      externalProcessStarted: false as const,
      networkAccessPerformed: false as const,
    }),
  );
}
