import {
  approvalGrantSchema,
  assetProvenanceSchema,
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
  parseSemanticVersion,
  parseSha256Digest,
  parseStableId,
  processContainmentAssessmentReportSchema,
  processContainmentAssessmentRequestSchema,
  projectInspectReportSchema,
  projectInspectRequestSchema,
  runReceiptSchema,
  skillCheckReportSchema,
  skillCheckRequestSchema,
  skillListReportSchema,
  skillListRequestSchema,
  type CommandDescriptor,
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
      "sha256:5f20c0ba5af33d5c7ac4048fde16550f621fbdd1407d56df24c83a30162111d4",
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
    processContainmentAssessmentRequestSchema,
    processContainmentAssessmentReportSchema,
    projectInspectRequestSchema,
    projectInspectReportSchema,
    runReceiptSchema,
    skillCheckRequestSchema,
    skillCheckReportSchema,
    skillListRequestSchema,
    skillListReportSchema,
  ]),
  commands: Object.freeze([
    doctorCommand,
    engineCapabilitiesCommand,
    engineExecutableDiscoveryCommand,
    engineHeadlessPreflightCommand,
    engineStatusCommand,
    engineVersionProbeCommand,
    initCommand,
    projectInspectCommand,
    skillCheckCommand,
    skillListCommand,
  ]),
  skills: Object.freeze([projectInspectionSkill]),
  roleLenses: Object.freeze([]),
  workflows: Object.freeze([godotHeadlessPreflightWorkflow]),
  packs: Object.freeze([]),
});

export const BUILTIN_REGISTRY: ValidatedRegistry = validateRegistry(definition);
export const BUILTIN_REGISTRY_SURFACES: RegistrySurfaces =
  generateRegistrySurfaces(BUILTIN_REGISTRY);
