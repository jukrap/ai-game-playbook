import {
  assertSkillListReportSemantics,
  computeSkillCatalogDigest,
  parseSemanticVersion,
  parseStableId,
  summarizeSkillCatalogEntries,
  type SkillListReport,
  type SkillListRequest,
} from "@ai-game-playbook/contracts";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  SkillRuntimeBoundaryError,
  createProjectSkillPlan,
} from "@ai-game-playbook/skill-runtime";

function descriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === "skill.list");
  if (command === undefined) {
    throw new TypeError("builtin registry does not contain skill.list");
  }
  return command;
}

function validateReport(report: SkillListReport): SkillListReport {
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor().output,
    report,
  ) as unknown as SkillListReport;
  assertSkillListReportSemantics(validated);
  return validated;
}

function unavailableReport(requestedPath: string): SkillListReport {
  const entries = Object.freeze([]);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "skill.list" as const,
      status: "blocked" as const,
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({ requestedPath }),
      entries,
      issues: Object.freeze([
        Object.freeze({
          severity: "blocked" as const,
          code: parseStableId("skill-project-unavailable"),
          message:
            "The selected project root could not be bound to one stable local directory.",
          nextAction:
            "Select one existing local game project directory and rerun the skill command.",
        }),
      ]),
      summary: summarizeSkillCatalogEntries(entries),
      materializationAvailable: false as const,
      mutationPerformed: false as const,
      externalProcessStarted: false as const,
      networkAccessPerformed: false as const,
    }),
  );
}

export async function runSkillList(input: unknown): Promise<SkillListReport> {
  const command = descriptor();
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    command.input,
    input,
  ) as unknown as SkillListRequest;

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

  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "skill.list" as const,
      status: "ready" as const,
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({
        requestedPath: request.projectRoot,
        canonicalPath: plan.project.canonicalPath,
        identityDigest: plan.project.identityDigest,
      }),
      entries: plan.catalog,
      issues: Object.freeze([]),
      summary: summarizeSkillCatalogEntries(plan.catalog),
      catalogDigest: computeSkillCatalogDigest({
        registryDigest: BUILTIN_REGISTRY.digest,
        entries: plan.catalog,
      }),
      materializationAvailable: false as const,
      mutationPerformed: false as const,
      externalProcessStarted: false as const,
      networkAccessPerformed: false as const,
    }),
  );
}
