import {
  assertEngineStatusReportSemantics,
  compareCanonicalText,
  computeEngineStatusDigest,
  computeEngineStatusStatus,
  engineStatusReportSchema,
  engineStatusRequestSchema,
  parseSemanticVersion,
  parseStableId,
  type EngineStatusCompatibility,
  type EngineStatusExecutableObservation,
  type EngineStatusIssue,
  type EngineStatusProjectObservation,
  type EngineStatusReport,
  type EngineStatusRequest,
  type OperatingSystem,
  type ProjectEngineCandidate,
  type ProjectInspectReport,
  type SemanticVersion,
} from "@ai-game-playbook/contracts";
import {
  assertProcessExecutableIdentity,
  type BoundProcessExecutable,
} from "@ai-game-playbook/core";
import { runProjectInspect } from "@ai-game-playbook/project-runtime";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { basename } from "node:path";

import { GodotAdapterBoundaryError } from "./errors.js";

export const GODOT_STATUS_TARGET_VERSION: SemanticVersion =
  parseSemanticVersion("4.7.2").value;

interface IssueCollector {
  readonly add: (
    severity: EngineStatusIssue["severity"],
    code: string,
    message: string,
    nextAction: string,
  ) => void;
  readonly finish: () => readonly EngineStatusIssue[];
}

function issueKey(issue: EngineStatusIssue): string {
  return `${issue.severity}/${issue.code}/${issue.path ?? ""}`;
}

function createIssueCollector(): IssueCollector {
  const issues = new Map<string, EngineStatusIssue>();
  return Object.freeze({
    add(
      severity: EngineStatusIssue["severity"],
      code: string,
      message: string,
      nextAction: string,
    ): void {
      const stableCode = parseStableId(code);
      if (!issues.has(stableCode)) {
        issues.set(
          stableCode,
          Object.freeze({ severity, code: stableCode, message, nextAction }),
        );
      }
    },
    finish(): readonly EngineStatusIssue[] {
      return Object.freeze(
        [...issues.values()].sort((left, right) =>
          compareCanonicalText(issueKey(left), issueKey(right)),
        ),
      );
    },
  });
}

function candidateForEngine(
  report: ProjectInspectReport,
): ProjectEngineCandidate | undefined {
  const candidates = report.engine.candidates.filter(
    ({ engine }) => engine === "godot",
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function boundProjectFields(report: ProjectInspectReport):
  | {
      readonly canonicalPath: string;
      readonly rootIdentityDigest: EngineStatusReport["registryDigest"];
      readonly inspectionDigest: EngineStatusReport["registryDigest"];
    }
  | undefined {
  const canonicalPath = report.project.canonicalPath;
  const rootIdentityDigest = report.project.rootIdentityDigest;
  const inspectionDigest = report.inspectionDigest;
  return canonicalPath === undefined ||
    rootIdentityDigest === undefined ||
    inspectionDigest === undefined
    ? undefined
    : Object.freeze({ canonicalPath, rootIdentityDigest, inspectionDigest });
}

function statusProjectCandidate(
  candidate: ProjectEngineCandidate,
): NonNullable<EngineStatusProjectObservation["candidate"]> {
  return Object.freeze({
    completeness: candidate.completeness,
    observationDigest: candidate.observationDigest,
    version: Object.freeze({
      precision: candidate.version.precision,
      ...(candidate.version.raw === undefined
        ? {}
        : { raw: candidate.version.raw }),
      ...(candidate.version.normalized === undefined
        ? {}
        : { normalized: candidate.version.normalized }),
    }),
  });
}

function blockedProject(
  report: ProjectInspectReport,
): EngineStatusProjectObservation {
  const bound = boundProjectFields(report);
  return Object.freeze({
    status: "blocked",
    requestedPath: report.project.requestedPath,
    ...(bound ?? {}),
  });
}

function mapProjectInspection(
  report: ProjectInspectReport,
  issues: IssueCollector,
): EngineStatusProjectObservation {
  const bound = boundProjectFields(report);
  if (bound === undefined) {
    issues.add(
      "blocked",
      "godot-project-unavailable",
      "The selected project could not be bound to one stable local identity.",
      "Select an existing Godot project directory and rerun engine status.",
    );
    return blockedProject(report);
  }
  if (report.engine.status === "ambiguous") {
    issues.add(
      "blocked",
      "godot-project-ambiguous",
      "The project inspection found more than one engine candidate.",
      "Remove unintended engine markers before selecting a Godot executable.",
    );
    return Object.freeze({
      status: "ambiguous",
      requestedPath: report.project.requestedPath,
      ...bound,
    });
  }
  if (report.status === "blocked") {
    issues.add(
      "blocked",
      "godot-project-inspection-blocked",
      "Static project identity contains a blocking conflict.",
      "Resolve the project inspection conflicts and rerun engine status.",
    );
    return blockedProject(report);
  }

  const candidate = candidateForEngine(report);
  if (candidate === undefined) {
    issues.add(
      "blocked",
      "godot-project-not-detected",
      "No single Godot project candidate was detected at the selected root.",
      "Select a root containing one case-exact regular project.godot file.",
    );
    return Object.freeze({
      status: "not-detected",
      requestedPath: report.project.requestedPath,
      ...bound,
    });
  }
  if (candidate.completeness === "partial") {
    issues.add(
      "attention",
      "godot-project-marker-partial",
      "The Godot project marker is incomplete or not portable.",
      "Repair the project.godot marker before binding an executable candidate.",
    );
    return Object.freeze({
      status: "partial",
      requestedPath: report.project.requestedPath,
      ...bound,
      candidate: statusProjectCandidate(candidate),
    });
  }
  return Object.freeze({
    status: "detected",
    requestedPath: report.project.requestedPath,
    ...bound,
    candidate: statusProjectCandidate(candidate),
  });
}

function compatibilityFor(
  project: EngineStatusProjectObservation,
  issues: IssueCollector,
): EngineStatusCompatibility {
  const normalized = project.candidate?.version.normalized;
  if (project.candidate === undefined) {
    return Object.freeze({
      targetVersion: GODOT_STATUS_TARGET_VERSION,
      status: "not-assessed",
      reason: "No single Godot project version hint is available for comparison.",
    });
  }
  if (normalized === undefined) {
    issues.add(
      "attention",
      "godot-project-version-unverified",
      "The project marker does not provide a recognized Godot version hint.",
      "Confirm the project version before any engine-backed operation.",
    );
    return Object.freeze({
      targetVersion: GODOT_STATUS_TARGET_VERSION,
      status: "unverified",
      reason: "The project version hint is unavailable.",
    });
  }
  const observed = parseSemanticVersion(normalized);
  const target = parseSemanticVersion(GODOT_STATUS_TARGET_VERSION);
  if (observed.major !== target.major || observed.minor !== target.minor) {
    issues.add(
      "blocked",
      "godot-target-version-mismatch",
      "The project major/minor version differs from the pinned Godot target.",
      "Use a compatible project or revise the pinned target through a reviewed change.",
    );
    return Object.freeze({
      targetVersion: GODOT_STATUS_TARGET_VERSION,
      status: "major-minor-mismatch",
      reason: "The project feature hint differs from the pinned major/minor target.",
    });
  }
  return Object.freeze({
    targetVersion: GODOT_STATUS_TARGET_VERSION,
    status: "major-minor-match",
    reason: "The project feature hint matches the pinned major/minor target.",
  });
}

function sourceWithoutCandidate(
  executableProvided: boolean,
  status: "invalid" | "not-found" | "not-inspected" | "not-provided",
): EngineStatusExecutableObservation {
  return Object.freeze({
    status,
    source: executableProvided ? "explicit" : "none",
    versionProbePerformed: false,
  });
}

function operatingSystem(): OperatingSystem {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  throw new GodotAdapterBoundaryError(
    "godot-platform-unsupported",
    "Godot executable identity is unsupported on this operating system.",
  );
}

function executableCandidate(
  executable: BoundProcessExecutable,
): EngineStatusExecutableObservation {
  return Object.freeze({
    status: "candidate",
    source: "explicit",
    candidate: Object.freeze({
      label: basename(executable.canonicalPath),
      platform: operatingSystem(),
      bytes: executable.size,
      digest: executable.digest,
      identityDigest: executable.identityDigest,
    }),
    versionProbePerformed: false,
  });
}

function sameProjectInspection(
  first: ProjectInspectReport,
  second: ProjectInspectReport,
): boolean {
  return (
    first.project.canonicalPath === second.project.canonicalPath &&
    first.project.rootIdentityDigest === second.project.rootIdentityDigest &&
    first.inspectionDigest === second.inspectionDigest &&
    first.engine.status === second.engine.status &&
    candidateForEngine(first)?.observationDigest ===
      candidateForEngine(second)?.observationDigest
  );
}

function schemaReference(schema: typeof engineStatusRequestSchema) {
  return Object.freeze({ schemaId: schema.schemaId, digest: schema.digest });
}

function validateReport(report: EngineStatusReport): EngineStatusReport {
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(engineStatusReportSchema),
    report,
  ) as unknown as EngineStatusReport;
  assertEngineStatusReportSemantics(validated);
  return validated;
}

async function runGodotEngineStatusInternal(
  input: unknown,
  executableCandidateAuthority?: BoundProcessExecutable,
): Promise<EngineStatusReport> {
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(engineStatusRequestSchema),
    input,
  ) as unknown as EngineStatusRequest;
  const issues = createIssueCollector();
  const firstInspection = await runProjectInspect({
    schemaVersion: "1.0.0",
    projectRoot: request.projectRoot,
  });
  let project = mapProjectInspection(firstInspection, issues);
  let compatibility = compatibilityFor(project, issues);
  let executable: EngineStatusExecutableObservation = sourceWithoutCandidate(
    executableCandidateAuthority !== undefined,
    executableCandidateAuthority === undefined
      ? "not-provided"
      : "not-inspected",
  );

  const projectCanBind =
    project.status === "detected" &&
    compatibility.status !== "major-minor-mismatch";
  if (!projectCanBind) {
    executable = sourceWithoutCandidate(
      executableCandidateAuthority !== undefined,
      executableCandidateAuthority === undefined
        ? "not-provided"
        : "not-inspected",
    );
  } else if (executableCandidateAuthority === undefined) {
    issues.add(
      "attention",
      "godot-executable-not-provided",
      "No explicit Godot executable candidate was provided.",
      "Run approved executable discovery before selecting a static identity.",
    );
    executable = sourceWithoutCandidate(false, "not-provided");
  } else {
    let bound: BoundProcessExecutable | undefined = executableCandidateAuthority;
    try {
      await assertProcessExecutableIdentity(bound);
    } catch {
      issues.add(
        "blocked",
        "godot-executable-invalid",
        "The approved executable identity could not be revalidated safely.",
        "Run approved executable discovery again and select a stable candidate identity.",
      );
      executable = sourceWithoutCandidate(true, "invalid");
      bound = undefined;
    }

    if (bound !== undefined) {
      executable = executableCandidate(bound);
      let secondInspection: ProjectInspectReport | undefined;
      try {
        secondInspection = await runProjectInspect({
          schemaVersion: "1.0.0",
          projectRoot: request.projectRoot,
        });
      } catch {
        // The bounded blocked observation below preserves a failed recheck.
      }
      if (
        secondInspection === undefined ||
        !sameProjectInspection(firstInspection, secondInspection)
      ) {
        issues.add(
          "blocked",
          "godot-project-identity-drift",
          "Project identity changed while the approved executable was being revalidated.",
          "Stabilize the project and rerun engine status without reusing this observation.",
        );
        project = blockedProject(secondInspection ?? firstInspection);
        compatibility = compatibilityFor(project, issues);
      }
      try {
        await assertProcessExecutableIdentity(bound);
      } catch {
        issues.add(
          "blocked",
          "godot-executable-identity-drift",
          "Executable candidate identity changed before status settlement.",
          "Select a stable executable file and rerun engine status.",
        );
        executable = sourceWithoutCandidate(true, "invalid");
      }
    }
  }

  const finalizedIssues = issues.finish();
  const support = Object.freeze({
    grade: "planned" as const,
    evidenceGrade: "implemented" as const,
    reason:
      "Static identity checks do not provide a retained Godot execution receipt.",
  });
  const digestInput = Object.freeze({
    registryDigest: BUILTIN_REGISTRY.digest,
    engine: "godot" as const,
    project,
    executable,
    compatibility,
    support,
    issues: finalizedIssues,
  });
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "engine.status",
      status: computeEngineStatusStatus(finalizedIssues),
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      ...digestInput,
      statusDigest: computeEngineStatusDigest(digestInput),
      mutationReady: false,
      mutationPerformed: false,
      externalProcessStarted: false,
      networkAccessPerformed: false,
      editorControlPerformed: false,
    }),
  );
}

export async function runGodotEngineStatus(
  input: unknown,
): Promise<EngineStatusReport> {
  if (arguments.length !== 1) {
    throw new GodotAdapterBoundaryError(
      "godot-status-options-invalid",
      "Registered Godot status cannot accept host executable authority.",
    );
  }
  return runGodotEngineStatusInternal(input);
}

export async function runGodotEngineStatusWithExecutable(
  input: unknown,
  executable: BoundProcessExecutable,
): Promise<EngineStatusReport> {
  if (arguments.length !== 2) {
    throw new GodotAdapterBoundaryError(
      "godot-status-options-invalid",
      "Internal Godot status requires one bound executable authority.",
    );
  }
  return runGodotEngineStatusInternal(input, executable);
}
