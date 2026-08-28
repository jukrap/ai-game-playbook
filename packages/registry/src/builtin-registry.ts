import {
  approvalGrantSchema,
  assetProvenanceSchema,
  computePackManifestDigest,
  doctorReportSchema,
  doctorRequestSchema,
  engineCapabilitiesReportSchema,
  engineCapabilitiesRequestSchema,
  engineStatusReportSchema,
  engineStatusRequestSchema,
  GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
  GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
  gameProjectProfileSchema,
  godotExecutableDiscoveryReportSchema,
  godotExecutableDiscoveryRequestSchema,
  godotHeadlessPreflightReportSchema,
  godotHeadlessPreflightRequestSchema,
  godotVersionProbeReportSchema,
  godotVersionProbeRequestSchema,
  initReportSchema,
  initRequestSchema,
  packDoctorReportSchema,
  packDoctorRequestSchema,
  packListReportSchema,
  packListRequestSchema,
  parseSemanticVersion,
  parseSha256Digest,
  parseStableId,
  processContainmentAssessmentReportSchema,
  processContainmentAssessmentRequestSchema,
  PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
  PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES,
  PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES,
  PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
  PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID,
  projectInitializationCommandInputSchema,
  projectInitializationReportSchema,
  projectInitializationRecoveryReportSchema,
  projectInitializationRecoveryRequestSchema,
  projectInspectReportSchema,
  projectInspectRequestSchema,
  runReceiptSchema,
  skillCheckReportSchema,
  skillCheckRequestSchema,
  skillListReportSchema,
  skillListRequestSchema,
  workflowCheckpointSchema,
  type CommandDescriptor,
  type PackManifest,
  type PermissionClass,
  type ProjectStage,
  type SkillDescriptor,
  type WorkflowDescriptor,
} from "@ai-game-playbook/contracts";

import { generateRegistrySurfaces } from "./generation.js";
import type {
  RegistryDefinition,
  RegistrySurfaces,
  ValidatedRegistry,
} from "./types.js";
import { validateRegistry } from "./validation.js";

function supportedStages(): readonly ProjectStage[] {
  return Object.freeze<ProjectStage[]>([
    "concept",
    "risk-prototype",
    "vertical-slice",
    "stabilization",
    "release-candidate",
  ]);
}

const initCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("init"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Plan project-local initialization targets without mutation.",
  cli: Object.freeze({
    path: Object.freeze(["init"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: initRequestSchema.schemaId,
    digest: initRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: initReportSchema.schemaId,
    digest: initReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("workspace.init")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "project-initialization-plan",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("init-plan")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/cli",
    export: "runInit",
    digest: parseSha256Digest(
      "sha256:8d6ed0826eafc5855a47e820547af0f8c3d6b49d3c5baa46aa0a93c007e6e07d",
    ),
  }),
});

const doctorCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("doctor"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Inspect local control-plane and project state without mutation.",
  cli: Object.freeze({
    path: Object.freeze(["doctor"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: doctorRequestSchema.schemaId,
    digest: doctorRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: doctorReportSchema.schemaId,
    digest: doctorReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("workspace.doctor")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "project-diagnostics",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("doctor-report")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/cli",
    export: "runDoctor",
    digest: parseSha256Digest(
      "sha256:52fe80fc0964ea9b75ee1a7d4915e411df9833a63bcb642699dd4bec3691aafc",
    ),
  }),
});

const packListCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("pack.list"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "List installed pack identities and counts without disclosure or mutation.",
  cli: Object.freeze({
    path: Object.freeze(["pack", "list"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: packListRequestSchema.schemaId,
    digest: packListRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: packListReportSchema.schemaId,
    digest: packListReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("pack.list")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "pack-installed-list",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("pack-list-report")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/pack-runtime",
    export: "runPackList",
    digest: parseSha256Digest(
      "sha256:b494d5d704940284db73be7fd29e4bfaba57004b420c4736c9bebfdffaf22314",
    ),
  }),
});

const packDoctorCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("pack.doctor"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Inspect managed pack ownership and recovery state without mutation.",
  cli: Object.freeze({
    path: Object.freeze(["pack", "doctor"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: packDoctorRequestSchema.schemaId,
    digest: packDoctorRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: packDoctorReportSchema.schemaId,
    digest: packDoctorReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("pack.doctor")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "pack-managed-diagnostics",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("pack-doctor-report")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/pack-runtime",
    export: "runPackDoctor",
    digest: parseSha256Digest(
      "sha256:b494d5d704940284db73be7fd29e4bfaba57004b420c4736c9bebfdffaf22314",
    ),
  }),
});

const engineCapabilitiesCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.capabilities"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary:
    "Report planned Godot operations and containment gaps without engine execution.",
  cli: Object.freeze({
    path: Object.freeze(["engine", "capabilities"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: engineCapabilitiesRequestSchema.schemaId,
    digest: engineCapabilitiesRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: engineCapabilitiesReportSchema.schemaId,
    digest: engineCapabilitiesReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("engine.capabilities")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "godot-static-capabilities",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([
    parseStableId("engine-capabilities-report"),
  ]),
  handler: Object.freeze({
    package: "@ai-game-playbook/godot-adapter",
    export: "runGodotEngineCapabilities",
    digest: parseSha256Digest(
      "sha256:e9ee71502455014efe1f51a97de3e7994b9eea130a6767b822b7a4c48e561570",
    ),
  }),
});

const engineStatusCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.status"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Inspect static Godot project compatibility without engine execution.",
  cli: Object.freeze({
    path: Object.freeze(["engine", "status"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: engineStatusRequestSchema.schemaId,
    digest: engineStatusRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: engineStatusReportSchema.schemaId,
    digest: engineStatusReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("engine.status")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "godot-static-status",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("engine-status-report")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/godot-adapter",
    export: "runGodotEngineStatus",
    digest: parseSha256Digest(
      "sha256:308742c6fa837ebb6c2343c38a82997f59faacffdf97ba2ec2d0e38d70f95622",
    ),
  }),
});

const engineExecutableDiscoveryCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.executable-discovery"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary: "Discover bounded Godot executable identities without execution.",
  cli: Object.freeze({
    path: Object.freeze(["internal", "engine", "executable-discovery"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: godotExecutableDiscoveryRequestSchema.schemaId,
    digest: godotExecutableDiscoveryRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: godotExecutableDiscoveryReportSchema.schemaId,
    digest: godotExecutableDiscoveryReportSchema.digest,
  }),
  capabilities: Object.freeze([
    parseStableId("engine.executable-discovery"),
  ]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>([
    "read-project",
    "host-tool-inspection",
  ]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "godot-executable-discovery",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([
    parseStableId("godot-executable-discovery"),
  ]),
  handler: Object.freeze({
    package: "@ai-game-playbook/godot-adapter",
    export: "runGodotExecutableDiscovery",
    digest: parseSha256Digest(
      "sha256:c03c64fca514ed9273344cca53296fadd7e327b5901281b66f472dd9f95bfcdc",
    ),
  }),
});

const engineVersionProbeCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.version-probe"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary: "Run one identity-bound Godot version probe with bounded output.",
  cli: Object.freeze({
    path: Object.freeze(["internal", "engine", "version-probe"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: godotVersionProbeRequestSchema.schemaId,
    digest: godotVersionProbeRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: godotVersionProbeReportSchema.schemaId,
    digest: godotVersionProbeReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("engine.version-probe")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>([
    "read-project",
    "host-tool-inspection",
  ]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "process",
      scope: "godot-version-probe",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "process-tree", graceMs: 1_000 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("godot-version-probe")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/godot-adapter",
    export: "runGodotVersionProbe",
    digest: parseSha256Digest(
      "sha256:de01f617326dec440551a99f6b5ad1701411921cd4b98020874ddb48fce811aa",
    ),
  }),
});

const engineHeadlessPreflightCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.headless-preflight"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary:
    "Admit one identity-bound Godot project startup only when required containment is available.",
  cli: Object.freeze({
    path: Object.freeze(["internal", "engine", "headless-preflight"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: godotHeadlessPreflightRequestSchema.schemaId,
    digest: godotHeadlessPreflightRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: godotHeadlessPreflightReportSchema.schemaId,
    digest: godotHeadlessPreflightReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("engine.headless-preflight")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>([
    "read-project",
    "host-tool-inspection",
    "test-build",
  ]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "process",
      scope: "godot-headless-project-startup",
      boundary: "local",
    }),
  ]),
  lane: "build-bound",
  timeoutMs: GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  cancellation: Object.freeze({
    mode: "process-tree",
    graceMs: GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS,
  }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([
    parseStableId("godot-headless-preflight"),
    parseStableId("run-receipt"),
  ]),
  handler: Object.freeze({
    package: "@ai-game-playbook/godot-adapter",
    export: "runGodotHeadlessPreflight",
    digest: parseSha256Digest(
      "sha256:a6b50edc3a2dd2961a03b092370f047bb1975236e5c3bd352aaffff7c1a113ef",
    ),
  }),
});

const projectInspectCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("project.inspect"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Inspect static game project identity without mutation.",
  cli: Object.freeze({
    path: Object.freeze(["project", "inspect"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: projectInspectRequestSchema.schemaId,
    digest: projectInspectRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: projectInspectReportSchema.schemaId,
    digest: projectInspectReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("project.inspect")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "project-static-inspection",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("project-inspection")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/project-runtime",
    export: "runProjectInspect",
    digest: parseSha256Digest(
      "sha256:53fb471f5f4da4bcd79b8cba4420e66568aee517998f2384227cac78ea239b38",
    ),
  }),
});

const projectInitializationRecoveryAssessmentCommand: CommandDescriptor =
  Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    id: parseStableId(PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID),
    version: parseSemanticVersion("1.0.0").value,
    lifecycle: "internal",
    summary:
      "Assess bounded project initialization recovery state without mutation.",
    cli: Object.freeze({
      path: Object.freeze([
        "internal",
        "project",
        "initialization-recovery",
        "assess",
      ]),
      aliases: Object.freeze([]),
    }),
    input: Object.freeze({
      schemaId: projectInitializationRecoveryRequestSchema.schemaId,
      digest: projectInitializationRecoveryRequestSchema.digest,
    }),
    output: Object.freeze({
      schemaId: projectInitializationRecoveryReportSchema.schemaId,
      digest: projectInitializationRecoveryReportSchema.digest,
    }),
    capabilities: Object.freeze([
      parseStableId(PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID),
    ]),
    supportedStages: supportedStages(),
    permissions: Object.freeze<PermissionClass[]>(["read-project"]),
    sideEffects: Object.freeze([
      Object.freeze({
        kind: "none",
        scope: "project-initialization-recovery-assessment",
        boundary: "local",
      }),
    ]),
    lane: "parallel-read",
    timeoutMs: 10_000,
    cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
    retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
    budgets: Object.freeze({
      maxChangedFiles: 0,
      maxChangedBytes: 0,
      maxDurationMs: 10_000,
      maxOutputBytes: 1_048_576,
      maxRepairCycles: 0,
    }),
    requiredEvidence: Object.freeze([
      parseStableId("project-initialization-recovery-assessment"),
    ]),
    handler: Object.freeze({
      package: "@ai-game-playbook/project-runtime",
      export: "runProjectInitializationRecoveryAssessment",
      digest: parseSha256Digest(
        "sha256:c1b97119b88cf4da0f8a163bd0ee5bf627c5830db5670f4148b3a48936cb5a38",
      ),
    }),
  });

const projectInitializationCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("project.initialize"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary:
    "Execute one approved, identity-bound, fixed-layout project initialization.",
  cli: Object.freeze({
    path: Object.freeze(["internal", "project", "initialize"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: projectInitializationCommandInputSchema.schemaId,
    digest: projectInitializationCommandInputSchema.digest,
  }),
  output: Object.freeze({
    schemaId: projectInitializationReportSchema.schemaId,
    digest: projectInitializationReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("project.initialize")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["write-project-metadata"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "filesystem",
      scope: "bounded-project-initialization",
      boundary: "local",
    }),
  ]),
  lane: "project-write",
  timeoutMs: PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
  cancellation: Object.freeze({ mode: "cooperative", graceMs: 1_000 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    maxChangedBytes: PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES,
    maxDurationMs: PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
    maxOutputBytes: PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([
    parseStableId("project-initialization-report"),
    parseStableId("run-receipt"),
    parseStableId("workflow-checkpoint"),
  ]),
  handler: Object.freeze({
    package: "@ai-game-playbook/project-runtime",
    export: "executePreparedProjectInitialization",
    digest: parseSha256Digest(
      "sha256:e154b755ba54ef3a08288c9dc5a949007aac2f619d5f8e6365513b38e73e6eee",
    ),
  }),
});

const skillCheckCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("skill.check"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "Inspect project skill targets without mutation.",
  cli: Object.freeze({
    path: Object.freeze(["skill", "check"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: skillCheckRequestSchema.schemaId,
    digest: skillCheckRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: skillCheckReportSchema.schemaId,
    digest: skillCheckReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("skill.check")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "project-skill-target-inspection",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("skill-check")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/cli",
    export: "runSkillCheck",
    digest: parseSha256Digest(
      "sha256:448ab2a9ab4667d2755399fecbb810cb434391b0980020b94e534ce0125caadb",
    ),
  }),
});

const skillListCommand: CommandDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("skill.list"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "experimental",
  summary: "List registered project skills without materialization.",
  cli: Object.freeze({
    path: Object.freeze(["skill", "list"]),
    aliases: Object.freeze([]),
  }),
  input: Object.freeze({
    schemaId: skillListRequestSchema.schemaId,
    digest: skillListRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: skillListReportSchema.schemaId,
    digest: skillListReportSchema.digest,
  }),
  capabilities: Object.freeze([parseStableId("skill.list")]),
  supportedStages: supportedStages(),
  permissions: Object.freeze<PermissionClass[]>(["read-project"]),
  sideEffects: Object.freeze([
    Object.freeze({
      kind: "none",
      scope: "project-skill-catalog",
      boundary: "local",
    }),
  ]),
  lane: "parallel-read",
  timeoutMs: 10_000,
  cancellation: Object.freeze({ mode: "not-applicable", graceMs: 0 }),
  retry: Object.freeze({ mode: "never", maxAttempts: 1 }),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: 10_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  }),
  requiredEvidence: Object.freeze([parseStableId("skill-catalog")]),
  handler: Object.freeze({
    package: "@ai-game-playbook/cli",
    export: "runSkillList",
    digest: parseSha256Digest(
      "sha256:e552074a0f66b46ebc363e8bc2406f3a47d4a6bb9e450769b72a12e2db8e779a",
    ),
  }),
});

const assetLifecycleSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("asset.lifecycle"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Guide a game asset from typed placeholder or reviewed input through provenance, QA, approval, and reversible production promotion.",
  triggers: Object.freeze([
    "Use when a game asset is introduced, generated, transformed, imported, reviewed, or promoted.",
    "Use when asset provenance, rights, external transmission, cost, QA, or production readiness is unclear.",
    "Use when a deterministic placeholder or safe rollback path is needed before asset integration.",
  ]),
  exclusions: Object.freeze([
    "Do not use as authority to call a hosted provider, transmit project data, incur cost, infer rights, or bypass approval.",
    "Do not treat generation, conversion, decode, or import success alone as production readiness.",
  ]),
  capabilities: Object.freeze([
    parseStableId("asset.lifecycle"),
    parseStableId("asset.provenance"),
    parseStableId("asset.qa"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/asset-lifecycle/SKILL.md",
    digest: parseSha256Digest(
      "sha256:ad424ae56022552ab2588da337f72dc8f82420d5488571c9c5134e77f2b69a65",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Classify the asset's current lifecycle state and required next gate without mutating it.",
    "Identify provenance, rights, approval, QA, performance, integration, and rollback requirements that apply.",
    "Preserve unknown or unverified fields instead of promoting the asset by inference.",
  ]),
  evidenceDuties: Object.freeze([
    "Report source lineage, rights status, transformations, file digest, approval, cost, and external transmission when applicable.",
    "Distinguish technical import evidence, visual or audio review, runtime evidence, and production approval.",
    "State the current asset state, fallback, completed gates, and remaining limitations.",
  ]),
});

const deterministicBalanceReviewSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("balance.deterministic-review"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Review game balance through explicit models, reproducible scenarios, distributions, sensitivity checks, and predeclared decisions.",
  triggers: Object.freeze([
    "Use when combat, economy, progression, reward, difficulty, spawn, drop, or cooldown values need design or review.",
    "Use when a baseline and candidate must be compared from the same initial state, ruleset, seed policy, and stopping condition.",
    "Use when averages may hide harmful tails, player-state segments, dominant strategies, exploits, or dead-end states.",
  ]),
  exclusions: Object.freeze([
    "Do not treat deterministic simulation as proof of player experience, accessibility, retention, or fun.",
    "Do not mutate production tuning data, invent missing assumptions, or widen the review scope without an approved change contract.",
  ]),
  capabilities: Object.freeze([
    parseStableId("balance.model"),
    parseStableId("balance.simulate"),
    parseStableId("balance.review"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/deterministic-balance-review/SKILL.md",
    digest: parseSha256Digest(
      "sha256:d33b51c343cc9400521edd532a6b51aef8c9a286c66f709b60b10db893ddb4a2",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Define the player-facing question, decision, model inputs, units, ranges, sources, assumptions, invariants, and failure states.",
    "Bind baseline and candidate scenarios to the same initial state, ruleset, seed set, simulation step, horizon, stopping condition, and sample policy.",
    "Compare distributions and player-state segments, perform one-factor and relevant interaction sensitivity checks, and apply predeclared acceptance criteria.",
  ]),
  evidenceDuties: Object.freeze([
    "Report model and ruleset identity, inputs and units, assumptions, invariants, scenarios, initial state, seeds, sample count, and distributions.",
    "Preserve baseline and candidate deltas, failure rates, tails, sensitivity cliffs, unstable loops, exploit paths, and subgroup outcomes.",
    "Classify the candidate as accept, reject, revise, blocked, or unverified and keep simulation conclusions separate from playtest evidence.",
  ]),
});

const buildExportReadinessSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("build.export-readiness"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Review a local game build or export from exact toolchain and target identity through structured build results and packaged startup.",
  triggers: Object.freeze([
    "Use when preparing, diagnosing, or reviewing a local game build or export without publishing it.",
    "Use when build configuration, output ownership, required tests, artifact identity, or packaged startup evidence is unclear.",
    "Use when an Editor run or successful build report must be distinguished from the produced player's behavior.",
  ]),
  exclusions: Object.freeze([
    "Do not use as authority to install toolchains, sign, upload, publish, release, or delete an uncertain output directory.",
    "Do not treat file existence, Editor play, or a successful outer build response as packaged startup evidence.",
  ]),
  capabilities: Object.freeze([
    parseStableId("build.export"),
    parseStableId("build.startup"),
    parseStableId("release.readiness"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/build-export-readiness/SKILL.md",
    digest: parseSha256Digest(
      "sha256:636c280eae05b3421e9f52347be0cb0587dac3fa894953d715fa3187e81beeda",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Bind the proposed build to exact project, engine, toolchain, target, configuration, output root, required content, and budgets.",
    "Define nonempty test, structured build, artifact-inventory, packaged-startup, logging, controlled-input, and shutdown gates that apply.",
    "Keep signing, upload, publication, release, and unavailable platform checks outside the granted scope.",
  ]),
  evidenceDuties: Object.freeze([
    "Report phase outcomes, exact tools, test counts, bounded logs, warnings, produced inventory, artifact digests, and byte counts.",
    "Distinguish compile, import, cook, package, export, signing, process startup, initial scene, runtime frame, and shutdown evidence.",
    "State target environment, budgets, reproducibility limits, and every unavailable or unverified gate.",
  ]),
});

const engineChangeSafetySkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("engine.change-safety"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Plan Unity, Unreal, or Godot changes around exact identity, least authority, serialized Editor work, verification, and rollback.",
  triggers: Object.freeze([
    "Use when source, command-line automation, an Editor session, or a runtime bridge may change a game project.",
    "Use when project, engine, process, Editor, runtime session, or capability identity is uncertain.",
    "Use when a game-engine effect needs bounded authority, runtime evidence, or a recoverable preimage.",
  ]),
  exclusions: Object.freeze([
    "Do not use as execution authority or as a substitute for command admission, containment, permission, identity, or capability checks.",
    "Do not promote preview, outer success, zero-test, or artifact-only evidence to verified gameplay.",
  ]),
  capabilities: Object.freeze([
    parseStableId("engine.change-safety"),
    parseStableId("engine.inspect"),
    parseStableId("engine.verify"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/engine-change-safety/SKILL.md",
    digest: parseSha256Digest(
      "sha256:63d1057c90fa7c052c97289203fbde1b141cfeb6ad8a3bc291384417286eb756",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Bind the proposed work to one project, engine, executable, process, and Editor or runtime session identity.",
    "State admitted capabilities, required permissions, lane, budgets, stop conditions, verification oracle, and rollback boundary.",
    "Stop at unavailable containment or uncertain effects rather than inventing authority or replaying a mutation.",
  ]),
  evidenceDuties: Object.freeze([
    "Report exact identities, invoked commands or tools, effects, changed paths, tests, logs, captures, artifacts, and rollback outcome.",
    "Keep static inspection, compile or import, Editor preview, runtime play, capture, build, and rollback evidence grades distinct.",
    "Preserve unavailable, ambiguous, blocked, failed, and unverified states.",
  ]),
});

const evidenceSupportReviewSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("evidence.support-review"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Decide whether retained game-development evidence supports a bounded feature, capability, quality, performance, build, or release claim.",
  triggers: Object.freeze([
    "Use when deciding whether game-development evidence supports a feature, engine capability, quality, performance, build, or release claim.",
    "Use when evidence grade, locator integrity, provenance, freshness, test count, runtime origin, or claim scope is uncertain.",
    "Use when the cheapest missing witness must be identified without executing, exporting, or repairing evidence.",
  ]),
  exclusions: Object.freeze([
    "Do not use as authority to export evidence, reveal secrets, repair retained records, rerun tools, or promote engine support.",
    "Do not infer production readiness, performance, rights, rollback, or gameplay from unrelated or lower-grade evidence.",
  ]),
  capabilities: Object.freeze([
    parseStableId("evidence.integrity"),
    parseStableId("evidence.review"),
    parseStableId("support.grade"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/evidence-support-review/SKILL.md",
    digest: parseSha256Digest(
      "sha256:61072df1bc26f989a3f486cc34523a0b9cfd04d09a5cb1b516211e42aec6e96f",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "State each exact claim, required grade, acceptance oracle, project and run identity, and freshness requirement.",
    "Map every claim to bounded locators with validated producer, provenance, schema, counts, environment, and digest where applicable.",
    "Return supported, unsupported, blocked, or unverified per claim and identify the cheapest material missing witness.",
  ]),
  evidenceDuties: Object.freeze([
    "Keep documentation, implementation, tests, local execution, Editor preview, runtime play, capture, profile, build, startup, and rollback grades distinct.",
    "Report contradictions, zero or skipped tests, process failures, stale or cloned records, state injection, missing provenance, and environment mismatch.",
    "Preserve locator identity, redaction status, final decision, and residual uncertainty without returning protected content.",
  ]),
});

const featureContractPlanningSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("feature.contract-planning"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Turn one game idea, mechanic, fix, or milestone into a bounded player-outcome contract with observable completion oracles.",
  triggers: Object.freeze([
    "Use when a game idea, mechanic, bug fix, or vertical-slice milestone needs an implementable boundary.",
    "Use when acceptance criteria are subjective, implementation-led, too broad, or missing restart and failure behavior.",
    "Use when an unproven design assumption needs the cheapest discriminating prototype.",
  ]),
  exclusions: Object.freeze([
    "Do not invent engine support, performance budgets, save compatibility, asset rights, or test availability.",
    "Do not combine independent risky outcomes or unrelated cleanup when they can be contracted and verified separately.",
  ]),
  capabilities: Object.freeze([
    parseStableId("feature.contract"),
    parseStableId("production.milestone"),
    parseStableId("prototype.validate"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/feature-contract-planning/SKILL.md",
    digest: parseSha256Digest(
      "sha256:bb8316451ebd078e02767e49e4b3baeb55e193e7bca51eed55ec6054e2f6d54e",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "State one player-visible outcome, its core-loop purpose, and its allowed and excluded change scope.",
    "Define observable initial, input, transition, result, persistence or restart, and failure oracles that apply.",
    "Declare budgets, risks, rollback policy, required evidence, assumptions, and unresolved decisions.",
  ]),
  evidenceDuties: Object.freeze([
    "Keep design intent, assumptions, proposed acceptance oracles, and observed implementation evidence separate.",
    "Report the project stage, engine, target, declared budgets, and every unknown used to bound the contract.",
    "Classify prototype results as supported, refuted, or inconclusive rather than as implementation completion.",
  ]),
});

const gameplayVerticalSliceSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("gameplay.vertical-slice"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Shape one small playable core loop with explicit state ownership, risk-first placeholders, failure, restart, and runtime proof.",
  triggers: Object.freeze([
    "Use when shaping or reviewing a small playable game loop, gameplay architecture, or vertical-slice milestone.",
    "Use when core-loop scope, authoritative state, system ownership, dependency direction, restart behavior, or playability evidence is unclear.",
    "Use when a risky player-experience assumption needs a deterministic placeholder and discriminating prototype.",
  ]),
  exclusions: Object.freeze([
    "Do not expand a vertical slice into a full content plan, speculative framework, or unrelated production-polish pass.",
    "Do not claim playability from static scene construction, debug state injection, or isolated component tests alone.",
  ]),
  capabilities: Object.freeze([
    parseStableId("gameplay.architecture"),
    parseStableId("gameplay.core-loop"),
    parseStableId("gameplay.vertical-slice"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/gameplay-vertical-slice/SKILL.md",
    digest: parseSha256Digest(
      "sha256:2e1f4eed040f3f70620d01b98e2978e940ef11ab3fd7d673ac4a814c392d7cec",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Bound one player fantasy and core action, failure and retry, terminal state, target session, and riskiest assumption.",
    "Assign authoritative state and narrow directional interfaces across input, simulation, presentation, persistence, UI, and engine integration.",
    "Define controlled-input runtime oracles for success, failure, interruption, restart, and completion while deferring unproved expansion.",
  ]),
  evidenceDuties: Object.freeze([
    "Report the bounded loop, system ownership, dependency boundaries, placeholders, input trace, state transitions, and runtime result.",
    "Record failure, restart, terminal-state, feedback, HUD, persistence, and integration evidence that the slice requires.",
    "Classify design assumptions as supported, refuted, or inconclusive and list deferred scope separately.",
  ]),
});

const performanceBudgetReviewSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("performance.budget-review"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Define and review comparable game performance measurements against explicit runtime, resource, and content budgets.",
  triggers: Object.freeze([
    "Use when defining, measuring, comparing, or reviewing a game's runtime performance and resource budgets.",
    "Use when target hardware, renderer, build kind, scenario, warm-up, baseline, samples, profiler, or tolerance is missing.",
    "Use when an Editor diagnostic must be distinguished from comparable packaged-player or release evidence.",
  ]),
  exclusions: Object.freeze([
    "Do not claim a pass without an explicit budget, comparable baseline, bound environment, and sufficient sample.",
    "Do not optimize by silently disabling required gameplay, visual, accessibility, or evidence behavior.",
  ]),
  capabilities: Object.freeze([
    parseStableId("performance.budget"),
    parseStableId("performance.profile"),
    parseStableId("performance.review"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/performance-budget-review/SKILL.md",
    digest: parseSha256Digest(
      "sha256:9555bd8e129847d1b30f117290c386fd7cf17bbdf51ef0684f2ba014b063dfaa",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Bind target hardware, OS, engine, renderer, settings, resolution, build, scene, camera, input, seed, and warm-up policy.",
    "Declare applicable frame, CPU, GPU, memory, allocation, load, stall, and content budgets before measurement.",
    "Define a same-environment baseline, profiler, sample method, aggregation, tolerance, and pass, fail, blocked, or unverified rules.",
  ]),
  evidenceDuties: Object.freeze([
    "Report environment and run identities, deterministic scenario, budgets, baseline, profiler artifacts and digests, and sample method.",
    "Preserve average, percentile, sustained worst window, spikes, changed factors, regression attribution, and confidence limits where applicable.",
    "Label results as diagnostic, baseline-comparable, or release-representative and keep Editor and packaged evidence separate.",
  ]),
});

const deterministicPlaytestSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("playtest.deterministic"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Define and judge reproducible gameplay runs with fixed input, seed, state oracles, nonempty tests, and runtime-frame provenance.",
  triggers: Object.freeze([
    "Use when gameplay behavior, restart or save behavior, a game bug, or a build comparison needs reproducible verification.",
    "Use when input, seed, initial state, timing, camera, runtime frame, test count, or artifact provenance is missing.",
    "Use when deterministic divergence or a performance claim must be separated from visual similarity.",
  ]),
  exclusions: Object.freeze([
    "Do not call an Editor preview, viewport, state injection, zero-test run, or unbound capture a runtime playthrough.",
    "Do not claim a performance pass without both a declared budget and a comparable environment baseline.",
  ]),
  capabilities: Object.freeze([
    parseStableId("evidence.capture"),
    parseStableId("feature.verify"),
    parseStableId("playtest.deterministic"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/deterministic-playtest/SKILL.md",
    digest: parseSha256Digest(
      "sha256:f99dbe341267fa108c0b9146e596a772f9b63f2260cb0ec334de2c2f0eaa656c",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Bind the run to project, engine, build, renderer, scene, camera, initial state, seed, timing origin, and fixed-tick input.",
    "Define state and runtime-frame oracles, tolerances, required nonempty tests, and performance budget when applicable.",
    "Report success, failure, restart, save or load, and terminal-state outcomes separately, including divergence.",
  ]),
  evidenceDuties: Object.freeze([
    "Retain run identity, exact input trace, state hashes, test counts, logs, captures, environment, and artifact digests.",
    "Separate process failure, unavailable report, zero tests, all skipped, assertion failure, missing required tests, and post-result crash.",
    "Label direct state injection, preview-only evidence, missing provenance, and missing baselines without promotion.",
  ]),
});

const projectInspectionSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("project.inspection"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Inspect one local game project's static identity and documented Godot capability gaps before choosing later work.",
  triggers: Object.freeze([
    "Use when a local Godot, Unity, or Unreal project must be identified before planning changes.",
    "Use when engine, project profile, or static Editor marker evidence is missing or ambiguous.",
    "Use when a compatible Godot project's planned operation gaps must be reported without launching an engine.",
  ]),
  exclusions: Object.freeze([
    "Do not use for live Editor control, process discovery, builds, playtests, mutation, or support verification.",
  ]),
  capabilities: Object.freeze([
    parseStableId("engine.capabilities"),
    parseStableId("project.inspect"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/project-inspection/SKILL.md",
    digest: parseSha256Digest(
      "sha256:badbdb3400143e660674bb578e0821473a8f8379b31aa04c40601163d4a1cacf",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Report the bound project and observed engine candidate state without mutation.",
    "For a compatible Godot project, report each planned operation's limitations, permissions, evidence needs, and containment launch gap.",
    "Preserve every unknown, attention, blocked, and unverified result.",
  ]),
  evidenceDuties: Object.freeze([
    "Use the registered project inspection report and any eligible static Godot capability report as the complete evidence boundary for this step.",
    "Treat the empty compiled provider catalog and skipped self-test as unavailable execution authority.",
    "State that no live Editor, runtime frame, build, or engine support grade was verified.",
  ]),
});

const saveLoadIntegritySkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("save-load.integrity"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Design and review versioned game persistence across atomic writes, migration, corruption, recovery, process restart, and gameplay state.",
  triggers: Object.freeze([
    "Use when designing, changing, testing, migrating, or diagnosing game save data and progression state.",
    "Use when authoritative state, schema version, slot identity, compatibility, atomic replacement, corruption, or restart behavior is unclear.",
    "Use when serialization success must be distinguished from verified post-load gameplay and UI state.",
  ]),
  exclusions: Object.freeze([
    "Do not invent backward compatibility, cloud behavior, encryption, platform storage, privacy, or retention policy.",
    "Do not silently reset, overwrite, or migrate an unknown or corrupt save without an approved recoverable decision.",
  ]),
  capabilities: Object.freeze([
    parseStableId("gameplay.save-load"),
    parseStableId("save.integrity"),
    parseStableId("save.migration"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/save-load-integrity/SKILL.md",
    digest: parseSha256Digest(
      "sha256:e7f19734a52ae410975e8796f56b5067b972aac4e1c11f96a599476eb3d74172",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Define authoritative persistent state, transient state, slot and storage identity, schema version, compatibility, and size or privacy constraints.",
    "Specify canonical serialization, validation, defaults, migration, atomic replacement, backup, interruption recovery, and corruption behavior.",
    "Cover new game, same-process load, full restart, slots, missing or invalid data, every supported migration, recovery, and terminal progression.",
  ]),
  evidenceDuties: Object.freeze([
    "Report schema and slot identity, state boundary, fixtures, migrations, file digests, replacement method, backup, and corruption outcomes.",
    "Retain nonempty test counts, process-restart identity, controlled-input gameplay and UI oracles, failure recovery, and unsupported versions.",
    "Label debug state injection separately and never promote it to persisted restart evidence.",
  ]),
});

const gameUiQaSkill: SkillDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("ui.game-qa"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "stable",
  invocation: "model",
  summary:
    "Review game HUD and UI as responsive, localized, accessible interaction state with editable and runtime evidence.",
  triggers: Object.freeze([
    "Use when designing, implementing, reconstructing, or reviewing HUD, menu, dialogue, inventory, settings, or in-game UI.",
    "Use when viewport, safe-area, locale, focus, input, accessibility, state coverage, or game-state binding is unclear.",
    "Use when a visual match must be distinguished from actual runtime interaction correctness.",
  ]),
  exclusions: Object.freeze([
    "Do not infer focus, navigation, input, state binding, accessibility, or gameplay correctness from a static mockup or Editor preview.",
    "Do not silently replace project style, input conventions, localization rules, or accessibility policy with generic defaults.",
  ]),
  capabilities: Object.freeze([
    parseStableId("evidence.visual"),
    parseStableId("ui.accessibility"),
    parseStableId("ui.qa"),
  ]),
  supportedStages: supportedStages(),
  requiredPermissions: Object.freeze<PermissionClass[]>(["read-project"]),
  body: Object.freeze({
    path: "skills/game-ui-qa/SKILL.md",
    digest: parseSha256Digest(
      "sha256:30d3d677918fe22da387a97eebf5a9d74f51e107faf280e6fa57d290fe42ee88",
    ),
    maxTokens: 800,
  }),
  references: Object.freeze([]),
  completionCriteria: Object.freeze([
    "Inventory applicable screens, gameplay overlays, states, viewports, locales, input modes, focus rules, and accessibility needs.",
    "Verify layout and readable state plus supported keyboard, mouse, controller, remapped input, focus recovery, and back behavior.",
    "Distinguish editable structure, rendered output, and actual runtime interaction evidence while preserving unresolved gaps.",
  ]),
  evidenceDuties: Object.freeze([
    "Report exact viewport, safe area, locale, input mode, UI state, gameplay state, editable artifact, and rendered capture.",
    "Record runtime interaction results, text expansion, focus and navigation, contrast, scale, motion, overflow, occlusion, and HUD readability.",
    "State whether each conclusion is structural, static visual, Editor preview, or runtime evidence.",
  ]),
});

const builtinSkills: readonly SkillDescriptor[] = Object.freeze([
  assetLifecycleSkill,
  deterministicBalanceReviewSkill,
  buildExportReadinessSkill,
  engineChangeSafetySkill,
  evidenceSupportReviewSkill,
  featureContractPlanningSkill,
  gameplayVerticalSliceSkill,
  performanceBudgetReviewSkill,
  deterministicPlaytestSkill,
  projectInspectionSkill,
  saveLoadIntegritySkill,
  gameUiQaSkill,
]);

function skillTargetName(skill: SkillDescriptor): string {
  const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(
    skill.body.path,
  );
  if (match?.[1] === undefined) {
    throw new TypeError("Builtin skill path cannot be mapped to a project target.");
  }
  return match[1];
}

function createProjectSkillsPack(
  skills: readonly SkillDescriptor[],
): PackManifest {
  const artifacts = Object.freeze(
    skills.map((skill) => {
      const name = skillTargetName(skill);
      return Object.freeze({
        source: skill.body.path,
        target: `.agents/skills/${name}/SKILL.md`,
        digest: skill.body.digest,
        mode: "file" as const,
      });
    }),
  );
  const ownedPaths = Object.freeze(
    artifacts.flatMap((artifact) =>
      Object.freeze([
        Object.freeze({
          path: artifact.target.slice(0, -"/SKILL.md".length),
          kind: "directory" as const,
        }),
        Object.freeze({
          path: artifact.target,
          kind: "file" as const,
          digest: artifact.digest,
        }),
      ]),
    ),
  );
  const capabilities = Object.freeze(
    [...new Set(skills.flatMap(({ capabilities: values }) => values))].sort(),
  );
  const manifestBody: Omit<PackManifest, "digest" | "signature"> =
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      id: parseStableId("pack.project-skills"),
      version: parseSemanticVersion("1.0.0").value,
      kind: "skill",
      lifecycle: "experimental",
      compatibility: Object.freeze({
        controlPlane: Object.freeze({
          minimum: parseSemanticVersion("0.0.0").value,
          maximumExclusive: parseSemanticVersion("1.0.0").value,
        }),
        operatingSystems: Object.freeze([
          "windows",
          "linux",
          "macos",
        ] as const),
        engines: Object.freeze([]),
        hosts: Object.freeze([]),
      }),
      provides: Object.freeze({
        commands: Object.freeze([]),
        skills: Object.freeze(skills.map(({ id }) => id)),
        workflows: Object.freeze([]),
        capabilities,
        schemas: Object.freeze([]),
      }),
      dependencies: Object.freeze([]),
      permissions: Object.freeze<PermissionClass[]>([
        "read-project",
        "install",
      ]),
      network: Object.freeze({
        required: false,
        destinations: Object.freeze([]),
      }),
      artifacts,
      ownedPaths,
      lifecycleHooks: Object.freeze({}),
      license: Object.freeze({ status: "unresolved" as const }),
    });
  return Object.freeze({
    ...manifestBody,
    digest: computePackManifestDigest(manifestBody),
  });
}

const projectSkillsPack = createProjectSkillsPack(builtinSkills);

const godotHeadlessPreflightWorkflow: WorkflowDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("workflow.godot-headless-preflight"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary:
    "Evaluate one bounded Godot main-scene startup admission and retain its receipt.",
  input: Object.freeze({
    schemaId: godotHeadlessPreflightRequestSchema.schemaId,
    digest: godotHeadlessPreflightRequestSchema.digest,
  }),
  output: Object.freeze({
    schemaId: godotHeadlessPreflightReportSchema.schemaId,
    digest: godotHeadlessPreflightReportSchema.digest,
  }),
  supportedStages: supportedStages(),
  steps: Object.freeze([
    Object.freeze({
      id: parseStableId("step.godot-headless-preflight"),
      commandId: parseStableId("engine.headless-preflight"),
      dependsOn: Object.freeze([]),
      onFailure: "blocked" as const,
      approvalCheckpoint: false,
    }),
  ]),
  budgets: Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  }),
  resumePolicy: "never",
  terminalOracle:
    "The command must retain a blocked receipt without launching Godot until filesystem, network, and child-process containment are enforced.",
  requiredEvidence: Object.freeze([
    parseStableId("godot-headless-preflight"),
    parseStableId("run-receipt"),
  ]),
});

const projectInitializationWorkflow: WorkflowDescriptor = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  id: parseStableId("workflow.project-initialization"),
  version: parseSemanticVersion("1.0.0").value,
  lifecycle: "internal",
  summary:
    "Execute and retain evidence for one approved fixed-layout project initialization.",
  input: Object.freeze({
    schemaId: projectInitializationCommandInputSchema.schemaId,
    digest: projectInitializationCommandInputSchema.digest,
  }),
  output: Object.freeze({
    schemaId: projectInitializationReportSchema.schemaId,
    digest: projectInitializationReportSchema.digest,
  }),
  supportedStages: supportedStages(),
  steps: Object.freeze([
    Object.freeze({
      id: parseStableId("step.project-initialize"),
      commandId: parseStableId("project.initialize"),
      dependsOn: Object.freeze([]),
      onFailure: "stop" as const,
      approvalCheckpoint: true,
    }),
  ]),
  budgets: Object.freeze({
    maxChangedFiles: PROJECT_INITIALIZATION_COMMAND_TARGET_COUNT,
    maxChangedBytes: PROJECT_INITIALIZATION_COMMAND_MAX_MUTATION_BYTES,
    maxDurationMs: PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
    maxOutputBytes: PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  }),
  resumePolicy: "never",
  terminalOracle:
    "The exact prepared targets are committed and verified, or every confirmed target mutation is rolled back; uncertainty retains the in-flight workflow checkpoint.",
  requiredEvidence: Object.freeze([parseStableId("run-receipt")]),
});

const definition: RegistryDefinition = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  controlPlaneVersion: parseSemanticVersion("0.0.0").value,
  schemas: Object.freeze([
    approvalGrantSchema,
    assetProvenanceSchema,
    doctorRequestSchema,
    doctorReportSchema,
    engineCapabilitiesRequestSchema,
    engineCapabilitiesReportSchema,
    engineStatusRequestSchema,
    engineStatusReportSchema,
    godotExecutableDiscoveryRequestSchema,
    godotExecutableDiscoveryReportSchema,
    godotHeadlessPreflightRequestSchema,
    godotHeadlessPreflightReportSchema,
    godotVersionProbeRequestSchema,
    godotVersionProbeReportSchema,
    gameProjectProfileSchema,
    initRequestSchema,
    initReportSchema,
    packDoctorRequestSchema,
    packDoctorReportSchema,
    packListRequestSchema,
    packListReportSchema,
    processContainmentAssessmentRequestSchema,
    processContainmentAssessmentReportSchema,
    projectInitializationCommandInputSchema,
    projectInitializationReportSchema,
    projectInitializationRecoveryRequestSchema,
    projectInitializationRecoveryReportSchema,
    projectInspectRequestSchema,
    projectInspectReportSchema,
    runReceiptSchema,
    skillCheckRequestSchema,
    skillCheckReportSchema,
    skillListRequestSchema,
    skillListReportSchema,
    workflowCheckpointSchema,
  ]),
  commands: Object.freeze([
    doctorCommand,
    engineCapabilitiesCommand,
    engineExecutableDiscoveryCommand,
    engineHeadlessPreflightCommand,
    engineStatusCommand,
    engineVersionProbeCommand,
    initCommand,
    packDoctorCommand,
    packListCommand,
    projectInitializationRecoveryAssessmentCommand,
    projectInitializationCommand,
    projectInspectCommand,
    skillCheckCommand,
    skillListCommand,
  ]),
  skills: builtinSkills,
  roleLenses: Object.freeze([]),
  workflows: Object.freeze([
    godotHeadlessPreflightWorkflow,
    projectInitializationWorkflow,
  ]),
  packs: Object.freeze([projectSkillsPack]),
});

export const BUILTIN_REGISTRY: ValidatedRegistry = validateRegistry(definition);
export const BUILTIN_REGISTRY_SURFACES: RegistrySurfaces =
  generateRegistrySurfaces(BUILTIN_REGISTRY);
