import {
  doctorReportSchema,
  doctorRequestSchema,
  gameProjectProfileSchema,
  initReportSchema,
  initRequestSchema,
  parseSemanticVersion,
  parseSha256Digest,
  parseStableId,
  projectInspectReportSchema,
  projectInspectRequestSchema,
  runReceiptSchema,
  type CommandDescriptor,
  type PermissionClass,
  type ProjectStage,
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
      "sha256:d8996ca370062478f2ad393cdccb622ad36b094a6add613bc7674724bcba87a9",
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
    package: "@ai-game-playbook/cli",
    export: "runProjectInspect",
    digest: parseSha256Digest(
      "sha256:53fb471f5f4da4bcd79b8cba4420e66568aee517998f2384227cac78ea239b38",
    ),
  }),
});

const definition: RegistryDefinition = Object.freeze({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  controlPlaneVersion: parseSemanticVersion("0.0.0").value,
  schemas: Object.freeze([
    doctorRequestSchema,
    doctorReportSchema,
    gameProjectProfileSchema,
    initRequestSchema,
    initReportSchema,
    projectInspectRequestSchema,
    projectInspectReportSchema,
    runReceiptSchema,
  ]),
  commands: Object.freeze([doctorCommand, initCommand, projectInspectCommand]),
  skills: Object.freeze([]),
  roleLenses: Object.freeze([]),
  workflows: Object.freeze([]),
  packs: Object.freeze([]),
});

export const BUILTIN_REGISTRY: ValidatedRegistry = validateRegistry(definition);
export const BUILTIN_REGISTRY_SURFACES: RegistrySurfaces =
  generateRegistrySurfaces(BUILTIN_REGISTRY);
