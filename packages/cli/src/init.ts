import {
  assertInitReportSemantics,
  computeInitPlanDigest,
  computeInitPlanStatus,
  parseSemanticVersion,
  parseStableId,
  summarizeInitPlanTargets,
  type InitPlanIssue,
  type InitReport,
  type InitRequest,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  canonicalizeProjectRoot,
  planProjectInitialization,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

function initDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === "init");
  if (command === undefined) {
    throw new TypeError("builtin registry does not contain init");
  }
  return command;
}

function unavailableIssue(error: CoreBoundaryError): InitPlanIssue {
  const message =
    error.code === "project-root-not-found"
      ? "The selected project root does not exist."
      : error.code === "project-root-not-directory"
        ? "The selected project root is not a directory."
        : error.code === "unsafe-project-root"
          ? "The selected project root is too broad for initialization planning."
          : "The selected project root could not be bound to one stable directory identity.";
  return Object.freeze({
    code: parseStableId(error.code),
    message,
    nextAction:
      "Select one existing local game project directory and rerun init.",
  });
}

function isUnavailableProjectRoot(error: CoreBoundaryError): boolean {
  return [
    "project-root-drift",
    "project-root-not-directory",
    "project-root-not-found",
    "unsafe-project-root",
  ].includes(error.code);
}

function validateReport(report: InitReport): InitReport {
  assertInitReportSemantics(report);
  const descriptor = initDescriptor();
  return validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.output,
    report,
  ) as unknown as InitReport;
}

function unavailableReport(
  requestedPath: string,
  error: CoreBoundaryError,
): InitReport {
  const issues = Object.freeze([unavailableIssue(error)]);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "init",
      mode: "plan-only",
      status: "blocked",
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({ requestedPath }),
      targets: Object.freeze([]),
      issues,
      summary: summarizeInitPlanTargets([]),
      mutationPerformed: false,
      applySupported: false,
      externalInstallPlanned: false,
      networkAccessPlanned: false,
    }),
  );
}

export async function runInit(input: unknown): Promise<InitReport> {
  const descriptor = initDescriptor();
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.input,
    input,
  ) as unknown as InitRequest;

  try {
    const root = await canonicalizeProjectRoot(request.projectRoot);
    const plan = await planProjectInitialization({ root });
    const summary = summarizeInitPlanTargets(plan.targets);
    const status = computeInitPlanStatus(plan.targets, plan.issues);
    const report: InitReport = Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "init",
      mode: "plan-only",
      status,
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      project: Object.freeze({
        requestedPath: request.projectRoot,
        canonicalPath: root.canonicalPath,
        identityDigest: root.identityDigest,
      }),
      targets: plan.targets,
      issues: plan.issues,
      summary,
      planDigest: computeInitPlanDigest({
        registryDigest: BUILTIN_REGISTRY.digest,
        projectIdentityDigest: plan.rootIdentityDigest,
        targets: plan.targets,
      }),
      mutationPerformed: false,
      applySupported: false,
      externalInstallPlanned: false,
      networkAccessPlanned: false,
    });
    return validateReport(report);
  } catch (error) {
    if (error instanceof CoreBoundaryError && isUnavailableProjectRoot(error)) {
      return unavailableReport(request.projectRoot, error);
    }
    throw error;
  }
}
