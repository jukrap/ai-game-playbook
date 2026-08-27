import {
  ENGINE_OPERATION_KINDS,
  PROCESS_CONTAINMENT_REQUIREMENTS,
  assertEngineCapabilitiesReportSemantics,
  assertEngineCapabilitiesRequestSemantics,
  checkEngineCapabilityReportSemantics,
  compareCanonicalText,
  computeEngineCapabilitiesEnvironmentDigest,
  computeEngineCapabilitiesReportDigest,
  computeEngineCapabilitiesReportId,
  computeEngineCapabilitiesStatus,
  computeGameProjectIdentityDigest,
  computeProcessContainmentProviderCatalogDigest,
  computeStaticEngineCapabilitiesProjectId,
  engineCapabilitiesReportSchema,
  engineCapabilitiesRequestSchema,
  parseSemanticVersion,
  parseStableId,
  type EngineCapabilitiesContainmentSummary,
  type EngineCapabilitiesDigestInput,
  type EngineCapabilitiesIssue,
  type EngineCapabilitiesProjectObservation,
  type EngineCapabilitiesReport,
  type EngineCapabilitiesRequest,
  type EngineCapability,
  type EngineCapabilityReport,
  type EngineExecutionKind,
  type EngineOperationKind,
  type EngineStatusReport,
  type PermissionClass,
  type SemanticVersion,
  type StableId,
} from "@ai-game-playbook/contracts";
import { inspectProcessContainmentProviderCatalog } from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

import { GodotAdapterBoundaryError } from "./errors.js";
import { runGodotEngineStatus } from "./status.js";

interface PlannedCapabilityDefinition {
  readonly execution: EngineExecutionKind;
  readonly requiredComponents: readonly StableId[];
  readonly limitation: string;
  readonly degradeReason: string;
  readonly permissions: readonly PermissionClass[];
  readonly requiredEvidence: readonly StableId[];
}

function ids(...values: readonly string[]): readonly StableId[] {
  return Object.freeze(values.map((value) => parseStableId(value)));
}

function permissions(
  ...values: readonly PermissionClass[]
): readonly PermissionClass[] {
  return Object.freeze(values);
}

const CAPABILITY_DEFINITIONS: Readonly<
  Record<EngineOperationKind, PlannedCapabilityDefinition>
> = Object.freeze({
  detect: Object.freeze({
    execution: "static",
    requiredComponents: ids("project-inspection"),
    limitation:
      "Only static project markers are inspected; no Godot executable or process identity is retained.",
    degradeReason:
      "Static marker inspection does not establish detected engine support.",
    permissions: permissions("read-project"),
    requiredEvidence: ids("engine-detection-receipt"),
  }),
  negotiate: Object.freeze({
    execution: "static",
    requiredComponents: ids("godot-adapter", "process-containment"),
    limitation:
      "The compiled containment provider catalog is empty and no self-test authority exists.",
    degradeReason:
      "Capability negotiation cannot advance without a verified containment provider and engine receipt.",
    permissions: permissions("read-project"),
    requiredEvidence: ids("engine-capability-receipt"),
  }),
  inspect: Object.freeze({
    execution: "static",
    requiredComponents: ids("godot-adapter", "project-inspection"),
    limitation:
      "No engine-backed scene, resource, or runtime inspection has been retained.",
    degradeReason:
      "Project metadata alone is below the required engine inspection evidence grade.",
    permissions: permissions("read-project"),
    requiredEvidence: ids("engine-inspection-receipt"),
  }),
  mutate: Object.freeze({
    execution: "editor-preview",
    requiredComponents: ids("godot-editor-bridge", "project-mutation-lane"),
    limitation:
      "No authenticated Editor session, mutation lane, or rollback witness is available.",
    degradeReason:
      "Editor mutation remains disabled until session identity and rollback are verified.",
    permissions: permissions(
      "read-project",
      "write-project-source",
      "editor-control",
    ),
    requiredEvidence: ids("editor-mutation-receipt", "rollback-receipt"),
  }),
  save: Object.freeze({
    execution: "editor-preview",
    requiredComponents: ids("godot-editor-bridge", "project-mutation-lane"),
    limitation:
      "No authenticated save, reload, and requery cycle has been witnessed.",
    degradeReason:
      "Saving remains disabled until post-save identity and import reconciliation are verified.",
    permissions: permissions(
      "read-project",
      "write-project-source",
      "editor-control",
    ),
    requiredEvidence: ids("engine-save-receipt", "engine-reload-receipt"),
  }),
  "compile-import": Object.freeze({
    execution: "headless",
    requiredComponents: ids("godot-headless-runner", "process-containment"),
    limitation:
      "No contained Godot project process can run script validation or resource import.",
    degradeReason:
      "Compile and import support requires contained execution with normalized diagnostics.",
    permissions: permissions("read-project", "test-build"),
    requiredEvidence: ids("compile-import-receipt", "engine-diagnostics"),
  }),
  test: Object.freeze({
    execution: "headless",
    requiredComponents: ids("godot-test-runner", "process-containment"),
    limitation:
      "No contained test process or nonzero normalized test report has been retained.",
    degradeReason:
      "Test support requires process success and assertion-level evidence with at least one executed test.",
    permissions: permissions("read-project", "test-build"),
    requiredEvidence: ids("engine-test-receipt", "test-report"),
  }),
  play: Object.freeze({
    execution: "runtime",
    requiredComponents: ids("godot-runtime-session", "process-containment"),
    limitation:
      "No live gameplay session identity or completed runtime startup receipt exists.",
    degradeReason:
      "Play support requires a contained runtime session and gameplay completion witness.",
    permissions: permissions("read-project", "editor-control"),
    requiredEvidence: ids("runtime-startup-receipt", "gameplay-receipt"),
  }),
  "input-replay": Object.freeze({
    execution: "runtime",
    requiredComponents: ids("godot-runtime-session", "deterministic-input"),
    limitation:
      "No tick-bound input mapping, seed, or terminal-state oracle has been replayed in Godot.",
    degradeReason:
      "Input replay requires deterministic runtime state and divergence evidence.",
    permissions: permissions("read-project", "editor-control"),
    requiredEvidence: ids("input-replay-trace", "gameplay-receipt"),
  }),
  logs: Object.freeze({
    execution: "runtime",
    requiredComponents: ids("godot-runtime-session", "engine-log-normalizer"),
    limitation:
      "No bounded runtime log stream is attached to an exact Godot session identity.",
    degradeReason:
      "Log support requires retained bounded output and a matching runtime receipt.",
    permissions: permissions("read-project", "editor-control"),
    requiredEvidence: ids("engine-log-receipt"),
  }),
  capture: Object.freeze({
    execution: "runtime",
    requiredComponents: ids("godot-runtime-session", "runtime-frame-capture"),
    limitation:
      "No actual gameplay frame with scene, camera, state, and input provenance has been captured.",
    degradeReason:
      "Capture support requires a complete runtime frame from a verified gameplay session.",
    permissions: permissions("read-project", "editor-control"),
    requiredEvidence: ids("runtime-frame-evidence", "gameplay-receipt"),
  }),
  profile: Object.freeze({
    execution: "runtime",
    requiredComponents: ids("godot-runtime-session", "performance-baseline"),
    limitation:
      "No matching hardware, renderer, project budget, and baseline profile has been retained.",
    degradeReason:
      "Performance support remains unverified without a declared budget and comparable runtime baseline.",
    permissions: permissions("read-project", "editor-control", "test-build"),
    requiredEvidence: ids("performance-profile-receipt", "performance-baseline"),
  }),
  "build-export": Object.freeze({
    execution: "packaged",
    requiredComponents: ids("godot-export-runner", "process-containment"),
    limitation:
      "No Windows x64 export artifact and packaged startup receipt have been retained.",
    degradeReason:
      "Build and export support requires a hashed artifact plus successful packaged startup evidence.",
    permissions: permissions("read-project", "test-build"),
    requiredEvidence: ids("build-artifact-evidence", "packaged-startup-receipt"),
  }),
  rollback: Object.freeze({
    execution: "editor-preview",
    requiredComponents: ids("godot-editor-bridge", "project-mutation-lane"),
    limitation:
      "No mutation has an exact preimage, Editor transaction, and completed restoration receipt.",
    degradeReason:
      "Rollback support requires an admitted mutation and independently verified restoration.",
    permissions: permissions(
      "read-project",
      "write-project-source",
      "editor-control",
    ),
    requiredEvidence: ids("rollback-receipt", "project-identity-receipt"),
  }),
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function schemaReference(schema: typeof engineCapabilitiesRequestSchema) {
  return Object.freeze({ schemaId: schema.schemaId, digest: schema.digest });
}

function issueKey(issue: EngineCapabilitiesIssue): string {
  return `${issue.code}/${issue.path ?? ""}`;
}

function collectIssues(
  status: EngineStatusReport,
  capabilityAvailable: boolean,
): readonly EngineCapabilitiesIssue[] {
  const issues = new Map<string, EngineCapabilitiesIssue>();
  for (const source of status.issues) {
    const issue = Object.freeze({
      severity: source.severity,
      code: source.code,
      message: source.message,
      nextAction: source.nextAction,
      ...(source.path === undefined ? {} : { path: source.path }),
    });
    issues.set(issueKey(issue), issue);
  }
  const containmentIssue = Object.freeze({
    severity: "attention" as const,
    code: parseStableId("process-containment-provider-unavailable"),
    message:
      "Engine project process launch remains blocked because no verified containment provider is compiled.",
    nextAction:
      "Do not install or launch a tool automatically; wait for a verified provider implementation.",
  });
  issues.set(issueKey(containmentIssue), containmentIssue);
  if (!capabilityAvailable && status.status !== "blocked") {
    const identityIssue = Object.freeze({
      severity: "attention" as const,
      code: parseStableId("godot-capability-identity-unavailable"),
      message:
        "A complete normalized Godot project identity is unavailable for an operation report.",
      nextAction:
        "Provide one complete compatible project marker with a recognized version hint.",
    });
    issues.set(issueKey(identityIssue), identityIssue);
  }
  return Object.freeze(
    [...issues.values()].sort((left, right) =>
      compareCanonicalText(issueKey(left), issueKey(right)),
    ),
  );
}

function containmentSummary(): EngineCapabilitiesContainmentSummary {
  const catalog = inspectProcessContainmentProviderCatalog();
  if (
    catalog.schemaVersion !== "1.0.0" ||
    catalog.registration !== "compiled" ||
    catalog.dynamicRegistration !== false ||
    catalog.providers.length !== 0 ||
    catalog.catalogDigest !==
      computeProcessContainmentProviderCatalogDigest(catalog.providers)
  ) {
    throw new GodotAdapterBoundaryError(
      "godot-capabilities-containment-drift",
      "Godot capabilities cannot summarize an unexpected containment catalog state.",
    );
  }
  return Object.freeze({
    registration: "compiled" as const,
    dynamicRegistration: false as const,
    providerCount: 0 as const,
    catalogDigest: catalog.catalogDigest,
    status: "unavailable" as const,
    selfTestPerformed: false as const,
    launchAvailable: false as const,
    decision: "block" as const,
    requirements: PROCESS_CONTAINMENT_REQUIREMENTS,
    reason:
      "No verified process-containment provider is compiled into this runtime.",
  });
}

function projectObservation(
  status: EngineStatusReport,
): EngineCapabilitiesProjectObservation {
  const project = status.project;
  const base =
    project.canonicalPath === undefined ||
    project.rootIdentityDigest === undefined ||
    project.inspectionDigest === undefined
      ? {}
      : {
          canonicalPath: project.canonicalPath,
          rootIdentityDigest: project.rootIdentityDigest,
          inspectionDigest: project.inspectionDigest,
        };
  const observedVersion = project.candidate?.version.normalized;
  const canBind =
    project.status === "detected" &&
    observedVersion !== undefined &&
    project.rootIdentityDigest !== undefined &&
    status.compatibility.status === "major-minor-match";
  if (!canBind) {
    return Object.freeze({
      status: project.status,
      requestedPath: project.requestedPath,
      ...base,
    });
  }
  const projectId = computeStaticEngineCapabilitiesProjectId(
    project.rootIdentityDigest,
  );
  const projectIdentityDigest = computeGameProjectIdentityDigest({
    projectId,
    engine: { id: "godot", version: observedVersion },
  });
  return Object.freeze({
    status: project.status,
    requestedPath: project.requestedPath,
    ...base,
    identitySource: "derived-static" as const,
    projectId,
    projectIdentityDigest,
    observedVersion,
  });
}

function plannedCapabilities(checkedAt: string): readonly EngineCapability[] {
  const operationVersion: SemanticVersion =
    parseSemanticVersion("1.0.0").value;
  return Object.freeze(
    ENGINE_OPERATION_KINDS.map((operation) => {
      const definition = CAPABILITY_DEFINITIONS[operation];
      return Object.freeze({
        id: parseStableId(`godot.${operation}`),
        operation,
        operationVersion,
        support: "planned" as const,
        execution: definition.execution,
        requiredComponents: definition.requiredComponents,
        limitations: Object.freeze([definition.limitation]),
        degradeReason: definition.degradeReason,
        permissions: definition.permissions,
        requiredEvidence: definition.requiredEvidence,
        evidenceGrade: "documented" as const,
        checkedAt,
      });
    }),
  );
}

function capabilityReport(
  project: EngineCapabilitiesProjectObservation,
  status: EngineStatusReport,
  containment: EngineCapabilitiesContainmentSummary,
): EngineCapabilityReport | undefined {
  if (
    project.identitySource !== "derived-static" ||
    project.projectId === undefined ||
    project.projectIdentityDigest === undefined ||
    project.observedVersion === undefined ||
    project.rootIdentityDigest === undefined
  ) {
    return undefined;
  }
  const generatedAt = new Date().toISOString();
  const environmentDigest = computeEngineCapabilitiesEnvironmentDigest({
    registryDigest: BUILTIN_REGISTRY.digest,
    engine: "godot",
    engineStatusDigest: status.statusDigest,
    projectRootIdentityDigest: project.rootIdentityDigest,
    providerCatalogDigest: containment.catalogDigest,
    supportGradeCeiling: "planned",
  });
  const report: EngineCapabilityReport = Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    reportId: computeEngineCapabilitiesReportId({
      environmentDigest,
      generatedAt,
    }),
    projectId: project.projectId,
    generatedAt,
    engineIdentity: Object.freeze({
      engine: "godot" as const,
      version: project.observedVersion,
      projectIdentityDigest: project.projectIdentityDigest,
    }),
    environmentDigest,
    capabilities: plannedCapabilities(generatedAt),
  });
  if (checkEngineCapabilityReportSemantics(report).length !== 0) {
    throw new GodotAdapterBoundaryError(
      "godot-capabilities-core-report-invalid",
      "Godot capability inventory violates the core support contract.",
    );
  }
  return report;
}

function validateReport(report: EngineCapabilitiesReport): EngineCapabilitiesReport {
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(engineCapabilitiesReportSchema),
    report,
  ) as unknown as EngineCapabilitiesReport;
  assertEngineCapabilitiesReportSemantics(validated);
  return deepFreeze(validated);
}

export async function runGodotEngineCapabilities(
  input: unknown,
): Promise<EngineCapabilitiesReport> {
  if (arguments.length !== 1) {
    throw new GodotAdapterBoundaryError(
      "godot-capabilities-options-invalid",
      "Registered Godot capabilities cannot accept host or provider authority.",
    );
  }
  assertEngineCapabilitiesRequestSemantics(
    input as EngineCapabilitiesRequest,
  );
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(engineCapabilitiesRequestSchema),
    input,
  ) as unknown as EngineCapabilitiesRequest;
  const status = await runGodotEngineStatus(request);
  const project = projectObservation(status);
  const containment = containmentSummary();
  const capabilities = capabilityReport(project, status, containment);
  const issues = collectIssues(status, capabilities !== undefined);
  const digestInput: EngineCapabilitiesDigestInput = Object.freeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    engine: "godot" as const,
    engineStatusDigest: status.statusDigest,
    project,
    containment,
    ...(capabilities === undefined ? {} : { capabilityReport: capabilities }),
    supportGradeCeiling: "planned" as const,
    issues,
    mutationPerformed: false as const,
    externalProcessStarted: false as const,
    networkAccessPerformed: false as const,
    editorControlPerformed: false as const,
    selfTestPerformed: false as const,
  });
  return validateReport(
    Object.freeze({
      schemaVersion: "1.0.0" as const,
      commandId: "engine.capabilities" as const,
      status: computeEngineCapabilitiesStatus(issues),
      ...digestInput,
      reportDigest: computeEngineCapabilitiesReportDigest(digestInput),
    }),
  );
}
