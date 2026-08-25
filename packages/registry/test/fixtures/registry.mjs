import * as contracts from "@ai-game-playbook/contracts";

import {
  validOrchestrationDescriptorFixtures,
  validPublicContractFixtures,
} from "./public-contracts.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;

const emptyInputSchema = contracts.defineContractSchema({
  id: "empty-input",
  version: "1.0.0",
  title: "Empty Input",
  schema: {
    type: "object",
    properties: { schemaVersion: { type: "string" } },
    required: ["schemaVersion"],
    additionalProperties: false,
  },
});

const schemaRef = (entry) => ({
  schemaId: entry.schemaId,
  digest: entry.digest,
});

const inspectCommand = {
  ...structuredClone(validPublicContractFixtures["command-descriptor"]),
  cli: { path: ["project", "inspect"], aliases: [["inspect"]] },
  input: schemaRef(emptyInputSchema),
  output: schemaRef(contracts.gameProjectProfileSchema),
};

const verifyCommand = {
  ...structuredClone(validPublicContractFixtures["command-descriptor"]),
  id: "verify",
  summary: "Verify one approved feature contract.",
  cli: { path: ["verify"], aliases: [] },
  input: schemaRef(contracts.featureContractSchema),
  output: schemaRef(contracts.runReceiptSchema),
  capabilities: ["feature.verify"],
  permissions: ["read-project", "test-build"],
  sideEffects: [
    { kind: "process", scope: "test-process", boundary: "local" },
  ],
  lane: "build-bound",
  retry: { mode: "never", maxAttempts: 1 },
  requiredEvidence: ["test-report", "runtime-frame"],
  handler: {
    package: "@ai-game-playbook/core",
    export: "verifyFeature",
    digest,
  },
};

const rollbackCommand = {
  ...structuredClone(validPublicContractFixtures["command-descriptor"]),
  id: "engine.rollback",
  summary: "Restore an attested project and editor preimage.",
  cli: { path: ["engine", "rollback"], aliases: [] },
  input: schemaRef(contracts.featureContractSchema),
  output: schemaRef(contracts.runReceiptSchema),
  capabilities: ["engine.rollback"],
  permissions: ["write-project-source", "editor-control"],
  sideEffects: [
    { kind: "filesystem", scope: "feature-scope", boundary: "local" },
    { kind: "editor", scope: "project-editor", boundary: "local" },
  ],
  lane: "editor-bound",
  retry: { mode: "never", maxAttempts: 1 },
  budgets: {
    maxChangedFiles: 64,
    maxChangedBytes: 10485760,
    maxDurationMs: 30000,
    maxOutputBytes: 1048576,
    maxRepairCycles: 0,
  },
  requiredEvidence: ["rollback-state"],
  handler: {
    package: "@ai-game-playbook/core",
    export: "rollbackFeature",
    digest: secondDigest,
  },
};

const internalCommand = {
  ...structuredClone(validPublicContractFixtures["command-descriptor"]),
  id: "internal.health",
  lifecycle: "internal",
  summary: "Check an in-process invariant.",
  cli: { path: ["internal", "health"], aliases: [] },
  input: schemaRef(emptyInputSchema),
  output: schemaRef(emptyInputSchema),
  capabilities: ["registry.health"],
  supportedStages: ["concept"],
  permissions: [],
  sideEffects: [{ kind: "none", scope: "registry", boundary: "local" }],
  lane: "parallel-read",
  retry: { mode: "never", maxAttempts: 1 },
  requiredEvidence: ["registry-check"],
  handler: {
    package: "@ai-game-playbook/registry",
    export: "checkRegistryHealth",
    digest,
  },
};

const workflow = {
  ...structuredClone(validOrchestrationDescriptorFixtures["workflow-descriptor"]),
  input: schemaRef(contracts.featureContractSchema),
  output: schemaRef(contracts.runReceiptSchema),
};

export function createValidRegistryDefinition() {
  return {
    schemaVersion: "1.0.0",
    controlPlaneVersion: "0.0.0",
    schemas: [
      emptyInputSchema,
      contracts.featureContractSchema,
      contracts.gameProjectProfileSchema,
      contracts.runReceiptSchema,
    ],
    commands: structuredClone([
      inspectCommand,
      verifyCommand,
      rollbackCommand,
      internalCommand,
    ]),
    skills: [
      structuredClone(
        validOrchestrationDescriptorFixtures["skill-descriptor"],
      ),
    ],
    roleLenses: [
      structuredClone(
        validOrchestrationDescriptorFixtures["role-lens-descriptor"],
      ),
    ],
    workflows: structuredClone([workflow]),
    packs: [],
  };
}
