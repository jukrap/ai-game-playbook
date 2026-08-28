import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  watch,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";
import * as packRuntime from "../dist/index.js";
import * as activeTransactions from "../dist/active-transaction.js";
import * as recoveryInternals from "../dist/recovery.js";
import * as transactionInternals from "../dist/transaction-journal.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const runId = "018f6f35-2c9e-7d1a-8a4b-123456789abd";
const updateRunId = "018f6f35-2c9e-7d1a-8a4b-123456789abe";
const removeRunId = "018f6f35-2c9e-7d1a-8a4b-123456789abf";
const recoveryRunId = "018f6f35-2c9e-7d1a-8a4b-123456789ac0";
const projectIdentityDigest = `sha256:${"c".repeat(64)}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

const packOperationInputSchema = contracts.defineContractSchema({
  id: "pack-operation-input",
  version: "1.0.0",
  title: "Pack Operation Input",
  description: "Digest-bound input for one managed pack operation.",
  schema: {
    type: "object",
    properties: {
      schemaVersion: { type: "string" },
      operation: { enum: ["add", "remove", "update"] },
      packId: { type: "string", minLength: 1, maxLength: 128 },
      planDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      },
    },
    required: ["schemaVersion", "operation", "packId", "planDigest"],
    additionalProperties: false,
  },
});

const packOperationOutputSchema = contracts.defineContractSchema({
  id: "pack-operation-output",
  version: "1.0.0",
  title: "Pack Operation Output",
  description: "Bounded outcome for one managed pack operation.",
  schema: {
    type: "object",
    properties: {
      schemaVersion: { type: "string" },
      status: {
        enum: [
          "failed",
          "no-op",
          "recovery-required",
          "rolled-back",
          "succeeded",
        ],
      },
      planDigest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      },
    },
    required: ["schemaVersion", "status", "planDigest"],
    additionalProperties: false,
  },
});

const packRecoveryInputSchema = contracts.packRecoveryCommandInputSchema;
const packRecoveryOutputSchema = contracts.packRecoveryCommandOutputSchema;

function currentOperatingSystem() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function manifest(content, version = "1.0.0") {
  const artifactDigest = contracts.sha256Digest(content);
  const value = {
    schemaVersion: "1.0.0",
    id: "tool.local-demo",
    version,
    kind: "integration",
    lifecycle: "experimental",
    compatibility: {
      controlPlane: { minimum: "0.0.0", maximumExclusive: "1.0.0" },
      operatingSystems: [currentOperatingSystem()],
      engines: [],
      hosts: [],
    },
    provides: {
      commands: [],
      skills: [],
      workflows: [],
      capabilities: [],
      schemas: [],
    },
    dependencies: [],
    permissions: [],
    network: { required: false, destinations: [] },
    artifacts: [
      {
        source: "dist/demo.txt",
        target: ".ai-game-playbook/packs/local-demo/demo.txt",
        digest: artifactDigest,
        mode: "file",
      },
    ],
    ownedPaths: [
      {
        path: ".ai-game-playbook/packs/local-demo/demo.txt",
        kind: "file",
        digest: artifactDigest,
      },
    ],
    lifecycleHooks: {},
    license: { status: "unresolved" },
  };
  value.digest = contracts.computePackManifestDigest(value);
  return value;
}

function manifestWithOwnedDirectory(content, version = "1.0.0") {
  const value = manifest(content, version);
  value.ownedPaths.unshift({
    path: ".ai-game-playbook/packs/local-demo",
    kind: "directory",
  });
  value.digest = contracts.computePackManifestDigest(value);
  return value;
}

function multiArtifactManifest(artifacts, version = "1.0.0") {
  const value = {
    schemaVersion: "1.0.0",
    id: "tool.local-demo",
    version,
    kind: "integration",
    lifecycle: "experimental",
    compatibility: {
      controlPlane: { minimum: "0.0.0", maximumExclusive: "1.0.0" },
      operatingSystems: [currentOperatingSystem()],
      engines: [],
      hosts: [],
    },
    provides: {
      commands: [],
      skills: [],
      workflows: [],
      capabilities: [],
      schemas: [],
    },
    dependencies: [],
    permissions: [],
    network: { required: false, destinations: [] },
    artifacts: artifacts.map(({ name, content }) => ({
      source: `dist/${name}`,
      target: `.ai-game-playbook/packs/local-demo/${name}`,
      digest: contracts.sha256Digest(content),
      mode: "file",
    })),
    ownedPaths: artifacts.map(({ name, content }) => ({
      path: `.ai-game-playbook/packs/local-demo/${name}`,
      kind: "file",
      digest: contracts.sha256Digest(content),
    })),
    lifecycleHooks: {},
    license: { status: "unresolved" },
  };
  value.digest = contracts.computePackManifestDigest(value);
  return value;
}

function commandFor(operation) {
  const definition = createValidRegistryDefinition();
  const command = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  command.id = `pack.${operation}`;
  command.version = "1.0.0";
  command.lifecycle = "experimental";
  command.summary = `Apply one approved pack ${operation} transaction.`;
  command.cli = { path: ["pack", operation], aliases: [] };
  command.input = {
    schemaId: packOperationInputSchema.schemaId,
    digest: packOperationInputSchema.digest,
  };
  command.output = {
    schemaId: packOperationOutputSchema.schemaId,
    digest: packOperationOutputSchema.digest,
  };
  command.capabilities = [`pack.${operation}`];
  command.permissions = ["install"];
  command.sideEffects = [
    { kind: "filesystem", scope: "approved-paths", boundary: "local" },
  ];
  command.lane = "project-write";
  command.retry = { mode: "never", maxAttempts: 1 };
  command.budgets = {
    maxChangedFiles: 512,
    maxChangedBytes: 16_777_216,
    maxDurationMs: 30_000,
    maxOutputBytes: 65_536,
    maxRepairCycles: 0,
  };
  command.requiredEvidence = ["evidence.pack-transaction"];
  command.handler = {
    package: "@ai-game-playbook/pack-runtime",
    export: "dispatchPreparedPackOperation",
    digest: `sha256:${"8".repeat(64)}`,
  };
  return { command, definition };
}

function recoveryCommand(definition) {
  const command = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  command.id = "pack.recover";
  command.version = "1.0.0";
  command.lifecycle = "internal";
  command.summary = "Finalize one separately approved pack recovery closure.";
  command.cli = { path: ["internal", "pack", "recover"], aliases: [] };
  command.input = {
    schemaId: packRecoveryInputSchema.schemaId,
    digest: packRecoveryInputSchema.digest,
  };
  command.output = {
    schemaId: packRecoveryOutputSchema.schemaId,
    digest: packRecoveryOutputSchema.digest,
  };
  command.capabilities = ["pack.recover"];
  command.permissions = ["install"];
  command.sideEffects = [
    { kind: "filesystem", scope: "approved-paths", boundary: "local" },
  ];
  command.lane = "project-write";
  command.retry = { mode: "never", maxAttempts: 1 };
  command.budgets = {
    maxChangedFiles: 512,
    maxChangedBytes: 4_194_304,
    maxDurationMs: 30_000,
    maxOutputBytes: 65_536,
    maxRepairCycles: 0,
  };
  command.requiredEvidence = ["evidence.pack-recovery"];
  command.handler = {
    package: "@ai-game-playbook/pack-runtime",
    export: "dispatchPreparedPackRecoveryFinalization",
    digest: `sha256:${"9".repeat(64)}`,
  };
  return command;
}

function recoveryWorkflow() {
  return {
    schemaVersion: "1.0.0",
    id: "workflow.pack-recover",
    version: "1.0.0",
    lifecycle: "internal",
    summary: "Execute one approved pack recovery closure.",
    input: {
      schemaId: packRecoveryInputSchema.schemaId,
      digest: packRecoveryInputSchema.digest,
    },
    output: {
      schemaId: packRecoveryOutputSchema.schemaId,
      digest: packRecoveryOutputSchema.digest,
    },
    supportedStages: [
      "concept",
      "risk-prototype",
      "vertical-slice",
      "stabilization",
      "release-candidate",
    ],
    steps: [
      {
        id: "step.pack-recover",
        commandId: "pack.recover",
        dependsOn: [],
        onFailure: "stop",
        approvalCheckpoint: true,
      },
    ],
    budgets: {
      maxChangedFiles: 512,
      maxChangedBytes: 4_194_304,
      maxDurationMs: 30_000,
      maxOutputBytes: 65_536,
      maxRepairCycles: 0,
    },
    resumePolicy: "never",
    terminalOracle: "The recovery result and retained evidence agree.",
    requiredEvidence: ["pack-recovery", "run-receipt"],
  };
}

function validatedRegistry(pack, operation = "add") {
  const { command, definition } = commandFor(operation);
  definition.schemas.push(
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    packOperationInputSchema,
    packOperationOutputSchema,
    packRecoveryInputSchema,
    packRecoveryOutputSchema,
    contracts.workflowCheckpointSchema,
  );
  definition.commands.push(command, recoveryCommand(definition));
  definition.workflows.push(recoveryWorkflow());
  definition.packs.push(pack);
  return registry.validateRegistry(definition);
}

function validatedRegistryWithoutPack(operation) {
  const { command, definition } = commandFor(operation);
  definition.schemas.push(
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    packOperationInputSchema,
    packOperationOutputSchema,
    packRecoveryInputSchema,
    packRecoveryOutputSchema,
    contracts.workflowCheckpointSchema,
  );
  definition.commands.push(command, recoveryCommand(definition));
  definition.workflows.push(recoveryWorkflow());
  return registry.validateRegistry(definition);
}

function prepareRecovery(report, selectedRegistry, selectedRunId = recoveryRunId) {
  return packRuntime.preparePackTransactionRecoveryFinalization({
    report,
    registry: selectedRegistry,
    runId: selectedRunId,
    projectStage: "vertical-slice",
  });
}

async function fixture(t, content = "pack payload\n") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-pack-execute-"));
  const project = join(sandbox, "project");
  const source = join(sandbox, "source");
  await mkdir(join(project, ".ai-game-playbook", "locks"), {
    recursive: true,
  });
  await mkdir(
    join(project, ".ai-game-playbook", "state", "packs", "transactions"),
    { recursive: true },
  );
  await mkdir(join(project, ".ai-game-playbook", "packs", "local-demo"), {
    recursive: true,
  });
  await mkdir(join(source, "dist"), { recursive: true });
  await writeFile(join(source, "dist", "demo.txt"), content, "utf8");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    content,
    project,
    source,
    target: join(
      project,
      ".ai-game-playbook",
      "packs",
      "local-demo",
      "demo.txt",
    ),
    targetRoot: await core.canonicalizeProjectRoot(project),
    sourceRoot: await core.canonicalizeProjectRoot(source),
  };
}

async function ensureDurableStores(f) {
  for (const path of [
    core.EVIDENCE_ARTIFACT_STORE_PATH,
    core.EVIDENCE_ARTIFACT_MANIFESTS_PATH,
    core.EVIDENCE_ARTIFACT_OBJECTS_PATH,
    core.RUN_RECEIPT_STORE_PATH,
    core.WORKFLOW_CHECKPOINT_STORE_PATH,
  ]) {
    await mkdir(join(f.project, ...path.split("/")), { recursive: true });
  }
}

function prepareRequest(
  f,
  selectedRegistry,
  pack,
  { operation = "add", selectedRunId = runId } = {},
) {
  const request = {
    operation,
    registry: selectedRegistry,
    targetRoot: f.targetRoot,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    runId: selectedRunId,
    packId: pack.id,
    limits: {
      maxArtifactBytes: 1024,
      maxTotalBytes: 4096,
      maxDirectoryEntries: 1000,
    },
  };
  if (operation !== "remove") request.sourceRoot = f.sourceRoot;
  return request;
}

function budgets(overrides = {}) {
  return {
    maxChangedFiles: 16,
    maxChangedBytes: 4_194_304,
    maxDurationMs: 30_000,
    maxOutputBytes: 65_536,
    maxRepairCycles: 0,
    ...overrides,
  };
}

function signedGrant(challenge, { approvedAt, expiresAt }) {
  const subject = core.createApprovalGrantSubject(challenge, {
    grantId: "approval.pack.install",
    permission: "install",
    approvedAt,
    expiresAt,
    maxUses: 1,
  });
  const signature = sign(
    null,
    Buffer.from(contracts.computeApprovalGrantSigningDigest(subject), "utf8"),
    privateKey,
  ).toString("base64url");
  return {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId: "approval.local-key",
      value: signature,
    },
  };
}

function authorize(plan, selectedRegistry, options = {}) {
  const brokerNow = options.brokerNow ?? Date.now();
  const deadlineAt =
    options.deadlineAt ?? new Date(brokerNow + 30_000).toISOString();
  const grantApprovedAt =
    options.grantApprovedAt ?? new Date(brokerNow - 60_000).toISOString();
  const grantExpiresAt =
    options.grantExpiresAt ?? new Date(brokerNow + 600_000).toISOString();
  const broker = core.createPermissionBroker({
    registry: selectedRegistry,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
      budgets: budgets({
        maxChangedFiles: 512,
        maxChangedBytes: 16_777_216,
        maxDurationMs: 900_000,
      }),
    },
    trustedApprovalKeys: [
      { keyId: "approval.local-key", publicKeyPem },
    ],
    now: () => brokerNow,
  });
  const request = packRuntime.createPackOperationAuthorizationRequest({
    plan,
    budgets: budgets(),
    deadlineAt,
  });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  const decision = broker.authorize(request, [
    signedGrant(pending.challenge, {
      approvedAt: grantApprovedAt,
      expiresAt: grantExpiresAt,
    }),
  ]);
  assert.equal(decision.status, "authorized");
  return { broker, decision, request };
}

function authorizeRecovery(plan, selectedRegistry, options = {}) {
  const brokerNow = options.brokerNow ?? Date.now();
  const deadlineAt =
    options.deadlineAt ?? new Date(brokerNow + 30_000).toISOString();
  const broker = core.createPermissionBroker({
    registry: selectedRegistry,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
      budgets: budgets({
        maxChangedFiles: 512,
        maxChangedBytes: 16_777_216,
        maxDurationMs: 900_000,
      }),
    },
    trustedApprovalKeys: [
      { keyId: "approval.local-key", publicKeyPem },
    ],
    now: options.now ?? Date.now,
  });
  const request = packRuntime.createPackRecoveryAuthorizationRequest({
    plan,
    budgets: budgets({ maxChangedFiles: 512 }),
    deadlineAt,
  });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  const decision = broker.authorize(request, [
    signedGrant(pending.challenge, {
      approvedAt: new Date(brokerNow - 60_000).toISOString(),
      expiresAt: new Date(brokerNow + 600_000).toISOString(),
    }),
  ]);
  assert.equal(decision.status, "authorized");
  return { broker, decision, request };
}

async function acquireLane(root, selectedRunId = runId) {
  return core.acquireProjectLane({
    root,
    projectIdentityDigest,
    runId: selectedRunId,
    lane: "project-write",
    leaseDurationMs: 30_000,
    waitTimeoutMs: 0,
    pollIntervalMs: 20,
    signal: null,
  });
}

function expectPackError(code) {
  return (error) => error?.name === "PackRuntimeError" && error?.code === code;
}

async function reopenAsStartedOnly(f, selectedRunId = runId) {
  const project = {
    id: "sample.graybox",
    identityDigest: projectIdentityDigest,
  };
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId: selectedRunId,
    project,
    maxDirectoryEntries: 1000,
  });
  await rm(
    join(
      f.project,
      ...packRuntime.packTransactionRecordPath(selectedRunId, 1).split("/"),
    ),
  );
  await writeActiveForStarted(f, journal.started);
  return journal.started;
}

async function writeActiveForStarted(f, started) {
  const active = activeTransactions.createActivePackTransactionRecord(
    started,
  );
  await activeTransactions.writeActivePackTransactionRecord({
    root: f.targetRoot,
    record: active,
    maxDirectoryEntries: 1000,
  });
}

test("authorized local add commits artifacts, installed state, and an append-only journal", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );

  assert.equal(typeof packRuntime.createPackOperationAuthorizationRequest, "function");
  assert.equal(
    typeof packRuntime.createPackRecoveryAuthorizationRequest,
    "function",
  );
  assert.equal(
    typeof packRuntime.preparePackTransactionRecoveryFinalization,
    "function",
  );
  assert.equal(typeof packRuntime.executePreparedPackOperation, "function");
  assert.equal(typeof packRuntime.finalizePackTransactionRecovery, "function");
  assert.equal(typeof packRuntime.loadPackTransactionJournal, "function");
  const { decision, request } = authorize(plan, selectedRegistry);
  assert.deepEqual(request.input, {
    schemaVersion: "1.0.0",
    operation: "add",
    packId: pack.id,
    planDigest: plan.planDigest,
  });
  assert.equal(request.scope.paths.includes(packRuntime.PACK_INSTALLED_STATE_PATH), true);
  assert.equal(
    request.scope.paths.includes(packRuntime.PACK_ACTIVE_TRANSACTION_PATH),
    true,
  );
  assert.deepEqual(request.scope.changeKinds, ["config"]);

  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);
  const result = await packRuntime.executePreparedPackOperation({
    plan,
    authorization: decision,
    lane,
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "succeeded");
  assert.equal(result.planDigest, plan.planDigest);
  assert.equal(await readFile(f.target, "utf8"), f.content);

  const stateText = await readFile(
    join(f.project, ".ai-game-playbook", "state", "packs", "installed.json"),
    "utf8",
  );
  const state = JSON.parse(stateText);
  assert.equal(state.revision, 1);
  assert.equal(state.packs[0].id, pack.id);
  assert.equal(state.packs[0].artifacts[0].digest, contracts.sha256Digest(f.content));
  assert.equal(state.stateDigest, result.installedState.afterDigest);
  assert.equal(stateText, `${contracts.canonicalizeJson(state)}\n`);

  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.started.planDigest, plan.planDigest);
  assert.equal(journal.terminal.outcome, "committed");
  assert.equal(journal.terminal.parentRecordDigest, journal.started.recordDigest);
  assert.equal(journal.terminal.mutationUncertain, false);
  assert.equal(JSON.stringify(result).includes(f.project), false);
  assert.equal(JSON.stringify(journal).includes(f.content), false);

  await lane.release();
});

test("owned artifact parents install and remove through marker-bound reversible staging", async (t) => {
  const f = await fixture(t);
  const directoryPath = ".ai-game-playbook/packs/local-demo";
  const nativeDirectory = join(f.project, ...directoryPath.split("/"));
  await rm(nativeDirectory, { recursive: true, force: true });
  const pack = manifestWithOwnedDirectory(f.content);
  const addRegistry = validatedRegistry(pack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, pack),
  );
  assert.equal(addPlan.disposition, "ready");
  assert.equal(addPlan.directoryChanges[0]?.kind, "create");
  const { decision: addDecision } = authorize(addPlan, addRegistry);
  const addLane = await acquireLane(f.targetRoot);
  const added = await packRuntime.executePreparedPackOperation({
    plan: addPlan,
    authorization: addDecision,
    lane: addLane,
  });
  assert.equal(added.status, "succeeded");
  await addLane.release();

  assert.equal(await readFile(f.target, "utf8"), f.content);
  const markerPath = join(nativeDirectory, ".agpb-owned");
  const markerText = await readFile(markerPath, "utf8");
  assert.equal(markerText.endsWith("\n"), true);
  const installedPath = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
    "installed.json",
  );
  const installed = JSON.parse(await readFile(installedPath, "utf8"));
  assert.equal(installed.schemaVersion, "1.1.0");
  assert.deepEqual(installed.packs[0].directories, [
    addPlan.directoryChanges[0].marker,
  ]);
  const addJournal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(addJournal.started.schemaVersion, "1.1.0");
  assert.deepEqual(
    addJournal.started.directoryChanges,
    addPlan.directoryChanges,
  );
  assert.equal(addJournal.terminal.schemaVersion, "1.1.0");
  const markerOnlyStarted = structuredClone(addJournal.started);
  markerOnlyStarted.changes = markerOnlyStarted.changes.filter(
    ({ path }) => path === `${directoryPath}/.agpb-owned`,
  );
  markerOnlyStarted.recordDigest =
    transactionInternals.computePackTransactionRecordDigest(markerOnlyStarted);
  assert.throws(
    () =>
      transactionInternals.parsePackTransactionStartedRecord(
        markerOnlyStarted,
        runId,
        {
          id: "sample.graybox",
          identityDigest: projectIdentityDigest,
        },
      ),
    expectPackError("pack-transaction-corrupt"),
  );

  const removeRegistry = validatedRegistryWithoutPack("remove");
  const removePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, removeRegistry, pack, {
      operation: "remove",
      selectedRunId: removeRunId,
    }),
  );
  assert.equal(removePlan.disposition, "ready");
  assert.equal(removePlan.directoryChanges[0]?.kind, "delete");
  assert.equal(removePlan.directoryChanges[0]?.path, directoryPath);
  assert.equal(
    removePlan.directoryChanges[0]?.marker.digest,
    contracts.sha256Digest(markerText),
  );
  assert.equal(
    removePlan.changes.some(({ path }) => path === `${directoryPath}/.agpb-owned`),
    true,
  );
  const { decision: removeDecision } = authorize(removePlan, removeRegistry);
  const removeLane = await acquireLane(f.targetRoot, removeRunId);
  const removed = await packRuntime.executePreparedPackOperation({
    plan: removePlan,
    authorization: removeDecision,
    lane: removeLane,
  });
  assert.equal(removed.status, "succeeded");
  await removeLane.release();

  await assert.rejects(
    readFile(markerPath),
    (error) => error?.code === "ENOENT",
  );
  await assert.rejects(
    readFile(f.target),
    (error) => error?.code === "ENOENT",
  );
  await assert.rejects(
    readFile(nativeDirectory),
    (error) => error?.code === "ENOENT" || error?.code === "EISDIR",
  );
  const finalState = JSON.parse(await readFile(installedPath, "utf8"));
  assert.deepEqual(finalState.packs, []);
  const recovery = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId: removeRunId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(recovery.observedState, "postimage");
  assert.equal(recovery.consistency, "consistent");
  assert.deepEqual(
    recovery.observations
      .filter(({ role }) => role.startsWith("owned-directory"))
      .map(({ role, path, match }) => ({ role, path, match })),
    [
      {
        role: "owned-directory",
        path: directoryPath,
        match: "after",
      },
      {
        role: "owned-directory-detached",
        path: `${removePlan.directoryChanges[0].tombstonePath}/owned`,
        match: "both",
      },
      {
        role: "owned-directory-tombstone",
        path: removePlan.directoryChanges[0].tombstonePath,
        match: "both",
      },
    ].sort((left, right) => left.path.localeCompare(right.path)),
  );
});

test("owned artifact parent updates rotate marker ownership without replacing the directory", async (t) => {
  const f = await fixture(t, "version one\n");
  const directoryPath = ".ai-game-playbook/packs/local-demo";
  const nativeDirectory = join(f.project, ...directoryPath.split("/"));
  await rm(nativeDirectory, { recursive: true, force: true });
  const firstPack = manifestWithOwnedDirectory(f.content, "1.0.0");
  const addRegistry = validatedRegistry(firstPack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, firstPack),
  );
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: authorize(addPlan, addRegistry).decision,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();
  const identityBefore = await core.readProjectDirectoryIdentity({
    root: f.targetRoot,
    path: directoryPath,
    maxDirectoryEntries: 1000,
  });

  const nextContent = "version two\n";
  await writeFile(join(f.source, "dist", "demo.txt"), nextContent, "utf8");
  const nextPack = manifestWithOwnedDirectory(nextContent, "1.1.0");
  const updateRegistry = validatedRegistry(nextPack, "update");
  const updatePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, updateRegistry, nextPack, {
      operation: "update",
      selectedRunId: updateRunId,
    }),
  );
  assert.equal(updatePlan.disposition, "ready");
  assert.equal(updatePlan.directoryChanges.length, 1);
  assert.equal(updatePlan.directoryChanges[0].kind, "retain");
  assert.equal(updatePlan.directoryChanges[0].path, directoryPath);
  const markerChange = updatePlan.changes.find(
    ({ path }) => path === `${directoryPath}/.agpb-owned`,
  );
  assert.equal(markerChange?.kind, "replace");
  assert.equal(markerChange?.beforeDigest, addPlan.directoryChanges[0].marker.digest);

  const updateLane = await acquireLane(f.targetRoot, updateRunId);
  const updated = await packRuntime.executePreparedPackOperation({
    plan: updatePlan,
    authorization: authorize(updatePlan, updateRegistry).decision,
    lane: updateLane,
  });
  assert.equal(updated.status, "succeeded");
  await updateLane.release();

  const identityAfter = await core.readProjectDirectoryIdentity({
    root: f.targetRoot,
    path: directoryPath,
    maxDirectoryEntries: 1000,
  });
  assert.deepEqual(identityAfter, identityBefore);
  const installed = JSON.parse(
    await readFile(
      join(
        f.project,
        ".ai-game-playbook",
        "state",
        "packs",
        "installed.json",
      ),
      "utf8",
    ),
  );
  assert.equal(installed.packs[0].directories.length, 1);
  assert.equal(installed.packs[0].directories[0].ownerPackDigest, nextPack.digest);
  assert.equal(installed.packs[0].directories[0].digest, markerChange.afterDigest);
  assert.equal(await readFile(f.target, "utf8"), nextContent);
});

test("directory removal rolls owned files back and preserves unexpected user content", async (t) => {
  const f = await fixture(t);
  const directoryPath = ".ai-game-playbook/packs/local-demo";
  const nativeDirectory = join(f.project, ...directoryPath.split("/"));
  await rm(nativeDirectory, { recursive: true, force: true });
  const pack = manifestWithOwnedDirectory(f.content);
  const addRegistry = validatedRegistry(pack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, pack),
  );
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: authorize(addPlan, addRegistry).decision,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();
  const markerPath = join(nativeDirectory, ".agpb-owned");
  const markerBefore = await readFile(markerPath, "utf8");
  const userPath = join(nativeDirectory, "user-note.txt");
  await writeFile(userPath, "preserve me\n", "utf8");

  const removeRegistry = validatedRegistryWithoutPack("remove");
  const removePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, removeRegistry, pack, {
      operation: "remove",
      selectedRunId: removeRunId,
    }),
  );
  const removeLane = await acquireLane(f.targetRoot, removeRunId);
  const removed = await packRuntime.executePreparedPackOperation({
    plan: removePlan,
    authorization: authorize(removePlan, removeRegistry).decision,
    lane: removeLane,
  });
  assert.equal(removed.status, "rolled-back");
  assert.equal(removed.mutationUncertain, false);
  await removeLane.release();

  assert.equal(await readFile(userPath, "utf8"), "preserve me\n");
  assert.equal(await readFile(f.target, "utf8"), f.content);
  assert.equal(await readFile(markerPath, "utf8"), markerBefore);
  const state = JSON.parse(
    await readFile(
      join(
        f.project,
        ".ai-game-playbook",
        "state",
        "packs",
        "installed.json",
      ),
      "utf8",
    ),
  );
  assert.equal(state.revision, 1);
  assert.equal(state.packs[0].id, pack.id);
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId: removeRunId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "rolled-back");
});

test("approved recovery finalizes an exact detached directory before journal closure", async (t) => {
  const f = await fixture(t);
  const directoryPath = ".ai-game-playbook/packs/local-demo";
  const nativeDirectory = join(f.project, ...directoryPath.split("/"));
  await rm(nativeDirectory, { recursive: true, force: true });
  const pack = manifestWithOwnedDirectory(f.content);
  const addRegistry = validatedRegistry(pack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, pack),
  );
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: authorize(addPlan, addRegistry).decision,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();

  const removeRegistry = validatedRegistryWithoutPack("remove");
  const removePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, removeRegistry, pack, {
      operation: "remove",
      selectedRunId: removeRunId,
    }),
  );
  const removeAuthority = authorize(removePlan, removeRegistry).decision;
  const installedPath = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
    "installed.json",
  );
  const installed = JSON.parse(await readFile(installedPath, "utf8"));
  const nextStateBody = {
    schemaVersion: "1.1.0",
    project: installed.project,
    revision: installed.revision + 1,
    packs: [],
  };
  const nextState = {
    ...nextStateBody,
    stateDigest: packRuntime.computeInstalledPackStateDigest(nextStateBody),
  };
  const nextStateContent = Buffer.from(
    `${contracts.canonicalizeJson(nextState)}\n`,
    "utf8",
  );
  const started = transactionInternals.createStartedPackTransaction({
    plan: removePlan,
    authorizationId: removeAuthority.lease.authorizationId,
    requestDigest: removeAuthority.challenge.requestDigest,
    installedStateAfter: {
      revision: nextState.revision,
      digest: nextState.stateDigest,
      fileDigest: contracts.sha256Digest(nextStateContent),
    },
    startedAt: new Date().toISOString(),
  });
  await writeActiveForStarted(f, started);
  await transactionInternals.writePackTransactionRecord(
    f.targetRoot,
    started,
    1000,
  );
  for (const change of removePlan.changes) {
    assert.equal(change.kind, "delete");
    await core.deleteProjectFileCas({
      root: f.targetRoot,
      path: change.path,
      expectedDigest: change.beforeDigest,
      maxBytes: 1024,
      maxDirectoryEntries: 1000,
    });
  }
  const directoryChange = removePlan.directoryChanges[0];
  assert.equal(directoryChange.kind, "delete");
  const detached = await core.stageProjectDirectoryCasRemoval({
    root: f.targetRoot,
    path: directoryChange.path,
    expectedIdentity: directoryChange.expectedIdentity,
    tombstonePath: directoryChange.tombstonePath,
    maxDirectoryEntries: 1000,
  });
  await detached.detach();
  await core.writeProjectFileCas({
    root: f.targetRoot,
    path: ".ai-game-playbook/state/packs/installed.json",
    content: nextStateContent,
    expected: { mode: "digest", digest: removePlan.installedState.fileDigest },
    maxBytes: 1024 * 1024,
    maxDirectoryEntries: 1000,
  });

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId: removeRunId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(report.observedState, "postimage");
  assert.equal(report.finalizationAction, "append-terminal");
  assert.equal(report.finalizationOutcome, "committed");
  assert.equal(report.mutationUncertain, true);
  assert.deepEqual(report.directoryCleanup, [
    {
      path: directoryPath,
      tombstonePath: directoryChange.tombstonePath,
      expectedIdentity: directoryChange.expectedIdentity,
    },
  ]);

  const recoveryPlan = prepareRecovery(report, removeRegistry);
  assert.equal(recoveryPlan.paths.includes(directoryPath), true);
  assert.equal(recoveryPlan.paths.includes(directoryChange.tombstonePath), true);
  const recoveryAuthority = authorizeRecovery(
    recoveryPlan,
    removeRegistry,
  ).decision;
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  const finalized = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority,
    lane: recoveryLane,
  });
  assert.equal(finalized.status, "finalized");
  await recoveryLane.release();

  await assert.rejects(
    readFile(nativeDirectory),
    (error) => error?.code === "ENOENT" || error?.code === "EISDIR",
  );
  await assert.rejects(
    readFile(join(f.project, ...directoryChange.tombstonePath.split("/"))),
    (error) => error?.code === "ENOENT" || error?.code === "EISDIR",
  );
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId: removeRunId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "committed");
});

test("same-process authorization and lane capabilities cannot be replaced by copies", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);

  await assert.rejects(
    packRuntime.executePreparedPackOperation({
      plan,
      authorization: { ...decision, lease: { ...decision.lease } },
      lane,
    }),
    expectPackError("pack-authorization-invalid"),
  );
  await assert.rejects(
    packRuntime.executePreparedPackOperation({
      plan,
      authorization: decision,
      lane: { ...lane },
    }),
    expectPackError("pack-lane-invalid"),
  );
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  await assert.rejects(
    readFile(join(f.project, ".ai-game-playbook", "state", "packs", "installed.json")),
    (error) => error?.code === "ENOENT",
  );

  await lane.release();
});

test("an expired same-process authorization cannot start a pack transaction", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const brokerNow = Date.parse("2026-08-25T07:00:00.000Z");
  const { decision } = authorize(plan, selectedRegistry, {
    brokerNow,
    deadlineAt: new Date(brokerNow + 30_000).toISOString(),
    grantApprovedAt: new Date(brokerNow - 60_000).toISOString(),
    grantExpiresAt: new Date(brokerNow + 300_000).toISOString(),
  });
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);

  await assert.rejects(
    packRuntime.executePreparedPackOperation({
      plan,
      authorization: decision,
      lane,
    }),
    expectPackError("pack-authorization-invalid"),
  );
  await lane.release();
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  await assert.rejects(
    readFile(
      join(
        f.project,
        packRuntime.packTransactionRecordPath(plan.runId, 0),
      ),
    ),
    (error) => error?.code === "ENOENT",
  );
});

test("target drift after approval is preserved and recorded as a clear failed transaction", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);
  await writeFile(f.target, "competing owner\n", "utf8");

  const result = await packRuntime.executePreparedPackOperation({
    plan,
    authorization: decision,
    lane,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "failed");
  assert.equal(await readFile(f.target, "utf8"), "competing owner\n");
  await assert.rejects(
    readFile(join(f.project, ".ai-game-playbook", "state", "packs", "installed.json")),
    (error) => error?.code === "ENOENT",
  );
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "failed");
  assert.equal(journal.terminal.mutationUncertain, false);

  await lane.release();
});

test("a clean reinstall finalizes as a write-free no-op without runtime authority", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const firstPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(firstPlan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  const first = await packRuntime.executePreparedPackOperation({
    plan: firstPlan,
    authorization: decision,
    lane,
  });
  assert.equal(first.status, "succeeded");
  await lane.release();

  const noOpPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  assert.equal(noOpPlan.disposition, "no-op");
  const noOp = await packRuntime.executePreparedPackOperation({ plan: noOpPlan });
  assert.deepEqual(noOp, {
    schemaVersion: "1.0.0",
    status: "no-op",
    operation: "add",
    planDigest: noOpPlan.planDigest,
    mutationUncertain: false,
    effects: {
      changedPaths: [],
      changedBytes: 0,
      appliedPaths: [],
      rolledBackPaths: [],
    },
  });
});

test("a write-free plan is revalidated and refuses post-preflight drift", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const firstPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(firstPlan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: firstPlan,
        authorization: decision,
        lane,
      })
    ).status,
    "succeeded",
  );
  await lane.release();

  const noOpPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  await writeFile(f.target, "post-preflight edit\n", "utf8");
  await assert.rejects(
    packRuntime.executePreparedPackOperation({ plan: noOpPlan }),
    expectPackError("pack-plan-not-executable"),
  );
  assert.equal(await readFile(f.target, "utf8"), "post-preflight edit\n");
});

test("update and remove advance exact installed state through separate transactions", async (t) => {
  const f = await fixture(t, "version one\n");
  const firstPack = manifest(f.content, "1.0.0");
  const addRegistry = validatedRegistry(firstPack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, firstPack),
  );
  const addAuthorization = authorize(addPlan, addRegistry).decision;
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: addAuthorization,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();

  const nextContent = "version two\n";
  await writeFile(join(f.source, "dist", "demo.txt"), nextContent, "utf8");
  const nextPack = manifest(nextContent, "1.1.0");
  const updateRegistry = validatedRegistry(nextPack, "update");
  const updatePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, updateRegistry, nextPack, {
      operation: "update",
      selectedRunId: updateRunId,
    }),
  );
  assert.equal(updatePlan.changes[0].kind, "replace");
  const updateAuthorization = authorize(updatePlan, updateRegistry).decision;
  const updateLane = await acquireLane(f.targetRoot, updateRunId);
  const updated = await packRuntime.executePreparedPackOperation({
    plan: updatePlan,
    authorization: updateAuthorization,
    lane: updateLane,
  });
  assert.equal(updated.status, "succeeded");
  assert.equal(await readFile(f.target, "utf8"), nextContent);
  await updateLane.release();

  const removeRegistry = validatedRegistryWithoutPack("remove");
  const removePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, removeRegistry, nextPack, {
      operation: "remove",
      selectedRunId: removeRunId,
    }),
  );
  assert.equal(removePlan.changes[0].kind, "delete");
  assert.deepEqual(removePlan.pack, {
    id: nextPack.id,
    version: nextPack.version,
    digest: nextPack.digest,
  });
  const removeAuthorization = authorize(removePlan, removeRegistry).decision;
  const removeLane = await acquireLane(f.targetRoot, removeRunId);
  const removed = await packRuntime.executePreparedPackOperation({
    plan: removePlan,
    authorization: removeAuthorization,
    lane: removeLane,
  });
  assert.equal(removed.status, "succeeded");
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  const state = JSON.parse(
    await readFile(
      join(f.project, ".ai-game-playbook", "state", "packs", "installed.json"),
      "utf8",
    ),
  );
  assert.equal(state.revision, 3);
  assert.deepEqual(state.packs, []);
  const removeJournal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId: removeRunId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(removeJournal.terminal.outcome, "committed");
  await removeLane.release();
});

test("an update with unchanged artifact bytes still commits pack metadata", async (t) => {
  const f = await fixture(t, "stable payload\n");
  const firstPack = manifest(f.content, "1.0.0");
  const addRegistry = validatedRegistry(firstPack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, firstPack),
  );
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: authorize(addPlan, addRegistry).decision,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();

  const nextPack = manifest(f.content, "1.1.0");
  const updateRegistry = validatedRegistry(nextPack, "update");
  const updatePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, updateRegistry, nextPack, {
      operation: "update",
      selectedRunId: updateRunId,
    }),
  );
  assert.equal(updatePlan.disposition, "ready");
  assert.deepEqual(updatePlan.changes.map(({ kind }) => kind), ["unchanged"]);
  const updateLane = await acquireLane(f.targetRoot, updateRunId);
  const updated = await packRuntime.executePreparedPackOperation({
    plan: updatePlan,
    authorization: authorize(updatePlan, updateRegistry).decision,
    lane: updateLane,
  });
  assert.equal(updated.status, "succeeded");
  await updateLane.release();

  const state = JSON.parse(
    await readFile(
      join(f.project, ".ai-game-playbook", "state", "packs", "installed.json"),
      "utf8",
    ),
  );
  assert.equal(state.revision, 2);
  assert.equal(state.packs[0].version, "1.1.0");
  assert.equal(state.packs[0].digest, nextPack.digest);
  assert.equal(await readFile(f.target, "utf8"), f.content);
});

test("state-only update refuses drift in an unchanged owned artifact", async (t) => {
  const f = await fixture(t, "stable payload\n");
  const firstPack = manifest(f.content, "1.0.0");
  const addRegistry = validatedRegistry(firstPack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, firstPack),
  );
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: authorize(addPlan, addRegistry).decision,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();

  const nextPack = manifest(f.content, "1.1.0");
  const updateRegistry = validatedRegistry(nextPack, "update");
  const updatePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, updateRegistry, nextPack, {
      operation: "update",
      selectedRunId: updateRunId,
    }),
  );
  const authorization = authorize(updatePlan, updateRegistry).decision;
  const updateLane = await acquireLane(f.targetRoot, updateRunId);
  await writeFile(f.target, "external edit\n", "utf8");

  const result = await packRuntime.executePreparedPackOperation({
    plan: updatePlan,
    authorization,
    lane: updateLane,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.mutationUncertain, false);
  await updateLane.release();
  assert.equal(await readFile(f.target, "utf8"), "external edit\n");
  const state = JSON.parse(
    await readFile(
      join(f.project, ".ai-game-playbook", "state", "packs", "installed.json"),
      "utf8",
    ),
  );
  assert.equal(state.revision, 1);
  assert.equal(state.packs[0].version, "1.0.0");
});

test("journal loading preserves an incomplete transaction and rejects canonical tampering", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan,
        authorization: decision,
        lane,
      })
    ).status,
    "succeeded",
  );
  await lane.release();

  const terminalPath = join(
    f.project,
    ...packRuntime.packTransactionRecordPath(runId, 1).split("/"),
  );
  const originalTerminal = await readFile(terminalPath, "utf8");
  await rm(terminalPath);
  const incomplete = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(incomplete.terminal, undefined);

  const tampered = JSON.parse(originalTerminal);
  tampered.outcome = "failed";
  await writeFile(
    terminalPath,
    `${contracts.canonicalizeJson(tampered)}\n`,
    "utf8",
  );
  await assert.rejects(
    packRuntime.loadPackTransactionJournal({
      root: f.targetRoot,
      runId,
      project: {
        id: "sample.graybox",
        identityDigest: projectIdentityDigest,
      },
      maxDirectoryEntries: 1000,
    }),
    expectPackError("pack-transaction-corrupt"),
  );
});

test("authorization helper rejects budgets below rollback and journal bounds", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  assert.throws(
    () =>
      packRuntime.createPackOperationAuthorizationRequest({
        plan,
        budgets: budgets({ maxChangedBytes: 1 }),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    expectPackError("pack-authorization-invalid"),
  );
  const withoutActiveMarker =
    Buffer.byteLength(f.content) * 2 +
    packRuntime.PACK_INSTALLED_STATE_MAX_BYTES +
    packRuntime.PACK_TRANSACTION_MAX_RECORD_BYTES * 2;
  assert.throws(
    () =>
      packRuntime.createPackOperationAuthorizationRequest({
        plan,
        budgets: budgets({ maxChangedBytes: withoutActiveMarker }),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    expectPackError("pack-authorization-invalid"),
  );
  assert.doesNotThrow(() =>
    packRuntime.createPackOperationAuthorizationRequest({
      plan,
      budgets: budgets({
        maxChangedBytes:
          withoutActiveMarker +
          packRuntime.PACK_ACTIVE_TRANSACTION_MAX_BYTES * 2,
      }),
      deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    }),
  );
});

test("authorization budgets include a larger replacement rollback preimage", async (t) => {
  const oldContent = `${"o".repeat(900)}\n`;
  const f = await fixture(t, oldContent);
  const oldPack = manifest(oldContent, "1.0.0");
  const addRegistry = validatedRegistry(oldPack, "add");
  const addPlan = await packRuntime.preparePackOperation(
    prepareRequest(f, addRegistry, oldPack),
  );
  const addAuthorization = authorize(addPlan, addRegistry).decision;
  const addLane = await acquireLane(f.targetRoot);
  assert.equal(
    (
      await packRuntime.executePreparedPackOperation({
        plan: addPlan,
        authorization: addAuthorization,
        lane: addLane,
      })
    ).status,
    "succeeded",
  );
  await addLane.release();

  const nextContent = "n\n";
  await writeFile(join(f.source, "dist", "demo.txt"), nextContent, "utf8");
  const nextPack = manifest(nextContent, "1.1.0");
  const updateRegistry = validatedRegistry(nextPack, "update");
  const updatePlan = await packRuntime.preparePackOperation(
    prepareRequest(f, updateRegistry, nextPack, {
      operation: "update",
      selectedRunId: updateRunId,
    }),
  );
  const postimageBytes = Buffer.byteLength(nextContent);
  const naiveReplacementBudget =
    postimageBytes * 2 +
    packRuntime.PACK_INSTALLED_STATE_MAX_BYTES +
    packRuntime.PACK_TRANSACTION_MAX_RECORD_BYTES * 2;

  assert.throws(
    () =>
      packRuntime.createPackOperationAuthorizationRequest({
        plan: updatePlan,
        budgets: budgets({ maxChangedBytes: naiveReplacementBudget }),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    expectPackError("pack-authorization-invalid"),
  );
});

test("a clear later-file race rolls earlier commits back and preserves the competing file", async (t) => {
  const f = await fixture(t);
  const artifacts = [
    { name: "a.txt", content: "first managed file\n" },
    { name: "z.txt", content: "second managed file\n" },
  ];
  for (const artifact of artifacts) {
    await writeFile(
      join(f.source, "dist", artifact.name),
      artifact.content,
      "utf8",
    );
  }
  const pack = multiArtifactManifest(artifacts);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);

  const targetDirectory = join(
    f.project,
    ".ai-game-playbook",
    "packs",
    "local-demo",
  );
  const firstTarget = join(targetDirectory, "a.txt");
  const secondTarget = join(targetDirectory, "z.txt");
  const watcher = watch(targetDirectory);
  const injectCompetingFile = (async () => {
    for await (const event of watcher) {
      if (event.filename?.toString() === "a.txt") {
        await writeFile(secondTarget, "competing file\n", "utf8");
        return;
      }
    }
  })();

  const result = await packRuntime.executePreparedPackOperation({
    plan,
    authorization: decision,
    lane,
  });
  await Promise.race([
    injectCompetingFile,
    delay(5_000, undefined, { ref: false }).then(() => {
      throw new Error("filesystem race observer did not see the first commit");
    }),
  ]);

  assert.equal(result.status, "rolled-back");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "failed");
  assert.deepEqual(result.effects.appliedPaths, [
    ".ai-game-playbook/packs/local-demo/a.txt",
  ]);
  assert.deepEqual(result.effects.rolledBackPaths, result.effects.appliedPaths);
  await assert.rejects(readFile(firstTarget), (error) => error?.code === "ENOENT");
  assert.equal(await readFile(secondTarget, "utf8"), "competing file\n");
  await assert.rejects(
    readFile(join(f.project, ".ai-game-playbook", "state", "packs", "installed.json")),
    (error) => error?.code === "ENOENT",
  );
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "rolled-back");
  assert.deepEqual(journal.terminal.appliedPaths, journal.terminal.rolledBackPaths);

  await lane.release();
});

test("missing transaction storage fails before artifact or installed-state mutation", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);
  await rm(
    join(f.project, ".ai-game-playbook", "state", "packs", "transactions"),
    { recursive: true },
  );

  const result = await packRuntime.executePreparedPackOperation({
    plan,
    authorization: decision,
    lane,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "failed");
  assert.equal(result.error.code, "project-path-not-found");
  assert.deepEqual(result.effects.changedPaths, []);
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  await assert.rejects(
    readFile(join(f.project, ".ai-game-playbook", "state", "packs", "installed.json")),
    (error) => error?.code === "ENOENT",
  );

  await lane.release();
});

test("pack execution attests its expected post-state and clears the active marker", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);

  const result = await packRuntime.executePreparedPackOperation({
    plan,
    authorization: decision,
    lane,
  });
  assert.equal(result.status, "succeeded");

  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.deepEqual(journal.started.limits, plan.limits);
  assert.equal(journal.started.installedStateAfter.revision, 1);
  assert.equal(
    journal.started.installedStateAfter.digest,
    journal.terminal.installedStateAfterDigest,
  );
  assert.match(
    journal.started.installedStateAfter.fileDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
  const terminalSnapshotDigest =
    recoveryInternals.computePackRecoveryJournalSnapshotDigest(
      journal,
      "journal",
    );
  const startedSnapshotDigest =
    recoveryInternals.computePackRecoveryJournalSnapshotDigest(
      { started: journal.started },
      "journal",
    );
  const markerSnapshotDigest =
    recoveryInternals.computePackRecoveryJournalSnapshotDigest(
      { started: journal.started },
      "marker",
    );
  assert.notEqual(terminalSnapshotDigest, startedSnapshotDigest);
  assert.notEqual(startedSnapshotDigest, markerSnapshotDigest);
  const overBudgetStarted = structuredClone(journal.started);
  overBudgetStarted.changes[0].bytes =
    overBudgetStarted.limits.maxArtifactBytes + 1;
  overBudgetStarted.recordDigest =
    transactionInternals.computePackTransactionRecordDigest(
      overBudgetStarted,
    );
  assert.throws(
    () =>
      transactionInternals.parsePackTransactionStartedRecord(
        overBudgetStarted,
        runId,
        {
          id: "sample.graybox",
          identityDigest: projectIdentityDigest,
        },
    ),
    expectPackError("pack-transaction-corrupt"),
  );
  const legacyStarted = structuredClone(journal.started);
  legacyStarted.schemaVersion = "1.0.0";
  delete legacyStarted.directoryChanges;
  legacyStarted.recordDigest =
    transactionInternals.computePackTransactionRecordDigest(legacyStarted);
  const parsedLegacy = transactionInternals.parsePackTransactionStartedRecord(
    legacyStarted,
    runId,
    {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
  );
  assert.equal(parsedLegacy.schemaVersion, "1.0.0");
  assert.equal(parsedLegacy.directoryChanges, undefined);
  await assert.rejects(
    readFile(
      join(
        f.project,
        ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
      ),
    ),
    (error) => error?.code === "ENOENT",
  );

  const recovery = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(recovery.journal, "terminal");
  assert.equal(recovery.activeMarker, "absent");
  assert.equal(recovery.observedState, "postimage");
  assert.equal(recovery.consistency, "consistent");
  assert.equal(recovery.recordedOutcome, "committed");
  assert.equal(recovery.mutationUncertain, false);

  await lane.release();
});

test("a started-only postimage blocks new plans and can be closed as committed", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: decision,
      lane,
    })).status,
    "succeeded",
  );
  await lane.release();
  await reopenAsStartedOnly(f);

  await assert.rejects(
    packRuntime.preparePackOperation(
      prepareRequest(f, selectedRegistry, pack, {
        selectedRunId: updateRunId,
      }),
    ),
    expectPackError("pack-transaction-conflict"),
  );
  const recovery = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(recovery.journal, "started-only");
  assert.equal(recovery.activeMarker, "matching");
  assert.equal(recovery.observedState, "postimage");
  assert.equal(recovery.consistency, "incomplete");
  assert.equal(recovery.safeTerminalOutcome, "committed");
  assert.equal(recovery.mutationUncertain, false);
});

test("separately approved recovery closes a stable started-only postimage", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(report.finalizationAction, "append-terminal");
  assert.equal(report.finalizationOutcome, "committed");
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  assert.equal(recoveryPlan.runId, recoveryRunId);
  assert.equal(recoveryPlan.transactionRunId, runId);
  assert.notEqual(recoveryPlan.runId, recoveryPlan.transactionRunId);
  assert.equal(recoveryPlan.workflow.id, "workflow.pack-recover");
  assert.equal(recoveryPlan.workflow.stepId, "step.pack-recover");
  assert.deepEqual(packRuntime.createPackRecoveryCommandInput(recoveryPlan), {
    schemaVersion: "1.0.0",
    recoveryRunId,
    transactionRunId: runId,
    reportDigest: recoveryPlan.reportDigest,
    journalSnapshotDigest: recoveryPlan.journalSnapshotDigest,
    action: "append-terminal",
    finalOutcome: "committed",
    planDigest: recoveryPlan.planDigest,
  });
  assert.throws(
    () => prepareRecovery(report, selectedRegistry, runId),
    expectPackError("invalid-pack-recovery-request"),
  );
  const recoveryByteFloor =
    packRuntime.PACK_ACTIVE_TRANSACTION_MAX_BYTES * 2 +
    packRuntime.PACK_TRANSACTION_MAX_RECORD_BYTES;
  assert.throws(
    () =>
      packRuntime.createPackRecoveryAuthorizationRequest({
        plan: recoveryPlan,
        budgets: budgets({
          maxChangedFiles: 4,
          maxChangedBytes: recoveryByteFloor - 1,
        }),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    expectPackError("pack-authorization-invalid"),
  );
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  assert.deepEqual(recoveryAuthority.request.scope.paths, [
    packRuntime.PACK_ACTIVE_TRANSACTION_PATH,
    packRuntime.packTransactionRecordPath(runId, 1),
  ].sort());
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );

  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });
  assert.equal(result.status, "finalized");
  assert.equal(result.action, "append-terminal");
  assert.equal(result.finalOutcome, "committed");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "succeeded");
  assert.deepEqual(result.effects.changedPaths, [
    packRuntime.PACK_ACTIVE_TRANSACTION_PATH,
    packRuntime.packTransactionRecordPath(runId, 1),
  ].sort());

  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "committed");
  assert.equal(journal.reconciliation, undefined);
  const closed = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(closed.consistency, "consistent");
  assert.equal(closed.finalizationAction, "none");
  assert.throws(
    () => prepareRecovery(closed, selectedRegistry),
    expectPackError("pack-recovery-not-actionable"),
  );

  await recoveryLane.release();
});

test("durable recovery dispatch retains checkpoint, receipt, and closure artifact", async (t) => {
  const f = await fixture(t);
  await ensureDurableStores(f);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  const rejectedAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  await assert.rejects(
    packRuntime.dispatchPreparedPackRecoveryFinalization({
      plan: structuredClone(recoveryPlan),
      authorization: rejectedAuthority.decision,
      signal: null,
    }),
    expectPackError("pack-recovery-plan-untrusted"),
  );
  assert.equal(rejectedAuthority.decision.lease.state, "active");
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    packRuntime.dispatchPreparedPackRecoveryFinalization({
      plan: recoveryPlan,
      authorization: rejectedAuthority.decision,
      signal: cancelled.signal,
    }),
    expectPackError("pack-operation-cancelled"),
  );
  assert.equal(rejectedAuthority.decision.lease.state, "settled");
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const output = await packRuntime.dispatchPreparedPackRecoveryFinalization({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    signal: null,
  });

  assert.equal(output.status, "finalized");
  assert.equal(output.recoveryRunId, recoveryRunId);
  assert.equal(output.transactionRunId, runId);
  assert.equal(output.planDigest, recoveryPlan.planDigest);
  assert.equal(output.mutationUncertain, false);
  assert.equal(recoveryAuthority.decision.lease.state, "settled");

  const inputDigest = contracts.digestCanonicalJson(
    packRuntime.createPackRecoveryCommandInput(recoveryPlan),
  );
  const checkpoint = await core.loadWorkflowCheckpoint({
    root: f.targetRoot,
    registry: selectedRegistry,
    runId: recoveryPlan.runId,
    project: {
      id: recoveryPlan.project.id,
      identityDigest: recoveryPlan.project.identityDigest,
      rootIdentityDigest: recoveryPlan.project.rootIdentityDigest,
      stage: recoveryPlan.workflow.projectStage,
    },
    inputDigest,
  });
  assert.equal(checkpoint.checkpoint.status, "succeeded");
  assert.deepEqual(checkpoint.checkpoint.evidenceKinds, [
    "pack-recovery",
    "run-receipt",
  ]);
  assert.equal(checkpoint.checkpoint.receiptChainHead, output.receiptDigest);

  const receipts = await core.loadRunReceiptChain({
    root: f.targetRoot,
    registry: selectedRegistry,
    runId: recoveryPlan.runId,
    projectId: recoveryPlan.project.id,
    projectIdentityDigest: recoveryPlan.project.rootIdentityDigest,
    workflowId: recoveryPlan.workflow.id,
    resolvedPlanDigest: recoveryPlan.workflow.resolvedPlanDigest,
    maxArtifactBytes: packRuntime.PACK_TRANSACTION_MAX_RECORD_BYTES,
  });
  assert.equal(receipts.receipts.length, 1);
  assert.equal(receipts.stored.receipt.status, "succeeded");
  assert.equal(receipts.stored.receipt.receiptDigest, output.receiptDigest);
  assert.equal(receipts.stored.receipt.artifacts.length, 1);
  assert.equal(receipts.stored.receipt.artifacts[0].kind, "pack-recovery");
  assert.equal(
    receipts.stored.receipt.artifacts[0].sourcePath,
    packRuntime.packTransactionRecordPath(runId, 1),
  );
  assert.equal(
    (await core.inspectProjectLane({ root: f.targetRoot })).status,
    "free",
  );
});

test("durable recovery dispatch retains a started checkpoint when evidence promotion fails", async (t) => {
  const f = await fixture(t);
  await ensureDurableStores(f);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  const interruptedRunId = "018f6f35-2c9e-7d1a-8a4b-123456789ac1";
  const recoveryPlan = prepareRecovery(
    report,
    selectedRegistry,
    interruptedRunId,
  );
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const packStateDirectory = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
  );
  const artifactObjectsDirectory = join(
    f.project,
    ...core.EVIDENCE_ARTIFACT_OBJECTS_PATH.split("/"),
  );
  const watcher = watch(packStateDirectory);
  const breakEvidenceStore = (async () => {
    for await (const event of watcher) {
      if (event.filename?.toString() === "active.json") {
        await rm(artifactObjectsDirectory, { recursive: true, force: true });
        await writeFile(artifactObjectsDirectory, "not a directory\n", "utf8");
        return;
      }
    }
  })();

  await assert.rejects(
    packRuntime.dispatchPreparedPackRecoveryFinalization({
      plan: recoveryPlan,
      authorization: recoveryAuthority.decision,
      signal: null,
    }),
    (error) =>
      error?.name === "CoreBoundaryError" &&
      error?.code === "workflow-dispatch-execution-failed" &&
      error?.mutationUncertain === true,
  );
  await breakEvidenceStore;
  assert.equal(recoveryAuthority.decision.lease.state, "settled");

  const inputDigest = contracts.digestCanonicalJson(
    packRuntime.createPackRecoveryCommandInput(recoveryPlan),
  );
  const checkpoint = await core.loadWorkflowCheckpoint({
    root: f.targetRoot,
    registry: selectedRegistry,
    runId: recoveryPlan.runId,
    project: {
      id: recoveryPlan.project.id,
      identityDigest: recoveryPlan.project.identityDigest,
      rootIdentityDigest: recoveryPlan.project.rootIdentityDigest,
      stage: recoveryPlan.workflow.projectStage,
    },
    inputDigest,
  });
  assert.equal(checkpoint.checkpoint.status, "running");
  assert.equal(checkpoint.checkpoint.inFlight.sideEffect, "started");
  assert.equal(checkpoint.checkpoint.receiptChainHead, undefined);

  const closed = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(closed.consistency, "consistent");
  assert.equal(closed.finalizationAction, "none");
  assert.equal(
    (await core.inspectProjectLane({ root: f.targetRoot })).status,
    "free",
  );
});

test("recovery can close a marker-only preimage without touching game artifacts", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);
  await rm(f.target);
  await rm(
    join(
      f.project,
      ...packRuntime.PACK_INSTALLED_STATE_PATH.split("/"),
    ),
  );
  await rm(
    join(
      f.project,
      ...packRuntime.packTransactionRecordPath(runId, 0).split("/"),
    ),
  );

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(report.finalizationAction, "append-started-and-terminal");
  assert.equal(report.finalizationOutcome, "failed");
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });

  assert.equal(result.status, "finalized");
  assert.equal(result.finalOutcome, "failed");
  assert.equal(result.mutationUncertain, false);
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "failed");
  assert.equal(journal.reconciliation, undefined);
  await recoveryLane.release();
});

test("recovery clears a stranded marker only after an existing terminal still matches", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  const journalBefore = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  await writeActiveForStarted(f, journalBefore.started);

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(report.finalizationAction, "clear-marker");
  assert.equal(report.finalizationOutcome, "committed");
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  assert.deepEqual(recoveryPlan.paths, [
    packRuntime.PACK_ACTIVE_TRANSACTION_PATH,
  ]);
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });

  assert.equal(result.status, "finalized");
  assert.deepEqual(result.effects.changedPaths, [
    packRuntime.PACK_ACTIVE_TRANSACTION_PATH,
  ]);
  const journalAfter = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(
    journalAfter.terminal.recordDigest,
    journalBefore.terminal.recordDigest,
  );
  await recoveryLane.release();
});

test("recovery-required terminal is resolved by a separate reconciliation record", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  const started = await reopenAsStartedOnly(f);
  const terminal = transactionInternals.createTerminalPackTransaction({
    started,
    outcome: "recovery-required",
    mutationUncertain: true,
    touchedPaths: [
      packRuntime.PACK_ACTIVE_TRANSACTION_PATH,
      packRuntime.PACK_INSTALLED_STATE_PATH,
      f.target
        .slice(f.project.length + 1)
        .replaceAll("\\", "/"),
      packRuntime.packTransactionRecordPath(runId, 0),
      packRuntime.packTransactionRecordPath(runId, 1),
    ].sort(),
    appliedPaths: [
      f.target
        .slice(f.project.length + 1)
        .replaceAll("\\", "/"),
    ],
    rolledBackPaths: [],
    installedStateAfterDigest: started.installedStateAfter.digest,
    error: { code: "pack-execution-uncertain", path: f.target
      .slice(f.project.length + 1)
      .replaceAll("\\", "/") },
    endedAt: new Date(Date.parse(started.startedAt) + 1).toISOString(),
  });
  await transactionInternals.writePackTransactionRecord(
    f.targetRoot,
    terminal,
    1000,
  );

  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(report.finalizationAction, "append-reconciliation");
  assert.equal(report.finalizationOutcome, "committed");
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });

  assert.equal(result.status, "finalized");
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(journal.terminal.outcome, "recovery-required");
  assert.equal(journal.reconciliation.outcome, "committed");
  assert.equal(
    journal.reconciliation.parentRecordDigest,
    journal.terminal.recordDigest,
  );
  assert.equal(
    journal.reconciliation.recoveryReportDigest,
    report.reportDigest,
  );
  const reconciliationPath = join(
    f.project,
    ...packRuntime.packTransactionRecordPath(runId, 2).split("/"),
  );
  const tamperedReconciliation = JSON.parse(
    await readFile(reconciliationPath, "utf8"),
  );
  tamperedReconciliation.recoveryReportDigest = `sha256:${"0".repeat(64)}`;
  await writeFile(
    reconciliationPath,
    `${contracts.canonicalizeJson(tamperedReconciliation)}\n`,
    "utf8",
  );
  await assert.rejects(
    packRuntime.loadPackTransactionJournal({
      root: f.targetRoot,
      runId,
      project: {
        id: "sample.graybox",
        identityDigest: projectIdentityDigest,
      },
      maxDirectoryEntries: 1000,
    }),
    (error) =>
      error instanceof packRuntime.PackRuntimeError &&
      error.code === "pack-transaction-corrupt" &&
      error.path === "$transaction.reconciliation.recordDigest",
  );
  await recoveryLane.release();
});

test("recovery rejects copied authority and settles a drifted report without writes", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);
  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.throws(
    () => prepareRecovery(structuredClone(report), selectedRegistry),
    expectPackError("pack-recovery-report-untrusted"),
  );
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  assert.throws(
    () =>
      packRuntime.createPackRecoveryAuthorizationRequest({
        plan: structuredClone(recoveryPlan),
        budgets: budgets({ maxChangedFiles: 4 }),
        deadlineAt: new Date(Date.now() + 30_000).toISOString(),
      }),
    expectPackError("pack-recovery-plan-untrusted"),
  );
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  await assert.rejects(
    packRuntime.finalizePackTransactionRecovery({
      plan: recoveryPlan,
      authorization: {
        ...recoveryAuthority.decision,
        lease: { ...recoveryAuthority.decision.lease },
      },
      lane: recoveryLane,
    }),
    expectPackError("pack-authorization-invalid"),
  );
  await assert.rejects(
    packRuntime.finalizePackTransactionRecovery({
      plan: recoveryPlan,
      authorization: recoveryAuthority.decision,
      lane: { ...recoveryLane },
    }),
    expectPackError("pack-lane-invalid"),
  );
  await writeFile(f.target, "drift after recovery approval\n", "utf8");
  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });

  assert.equal(result.status, "stale");
  assert.equal(result.mutationUncertain, false);
  assert.equal(result.settlement.status, "failed");
  assert.deepEqual(result.effects.changedPaths, []);
  assert.equal(result.error.code, "pack-recovery-stale");
  assert.equal(
    await readFile(
      join(
        f.project,
        ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
      ),
      "utf8",
    ).then((text) => text.length > 0),
    true,
  );
  await recoveryLane.release();
});

test("recovery keeps the active barrier when state drifts after journal closure", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  await reopenAsStartedOnly(f);
  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  const transactionDirectory = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
    "transactions",
  );
  const watcher = watch(transactionDirectory);
  const injectDrift = (async () => {
    for await (const event of watcher) {
      if (event.filename?.toString() === `${runId}-0001.json`) {
        await writeFile(f.target, "drift during recovery closure\n", "utf8");
        return;
      }
    }
  })();

  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });
  await Promise.race([
    injectDrift,
    delay(5_000, undefined, { ref: false }).then(() => {
      throw new Error("recovery journal observer did not inject drift");
    }),
  ]);

  assert.equal(result.status, "recovery-required");
  assert.equal(result.mutationUncertain, true);
  assert.equal(result.settlement.status, "uncertain");
  assert.equal(result.error.path, "$recovery.beforeClear");
  assert.equal(
    await readFile(
      join(
        f.project,
        ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
      ),
      "utf8",
    ).then((text) => text.length > 0),
    true,
  );
  await recoveryLane.release();
});

test("recovery restores the barrier when post-clear verification detects drift", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const executionAuthority = authorize(plan, selectedRegistry);
  const executionLane = await acquireLane(f.targetRoot);
  t.after(() =>
    executionLane.state === "active" ? executionLane.release() : undefined,
  );
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: executionAuthority.decision,
      lane: executionLane,
    })).status,
    "succeeded",
  );
  await executionLane.release();
  const journal = await packRuntime.loadPackTransactionJournal({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  await writeActiveForStarted(f, journal.started);
  const report = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  const recoveryPlan = prepareRecovery(report, selectedRegistry);
  const recoveryAuthority = authorizeRecovery(recoveryPlan, selectedRegistry);
  const recoveryLane = await acquireLane(f.targetRoot, recoveryPlan.runId);
  t.after(() =>
    recoveryLane.state === "active" ? recoveryLane.release() : undefined,
  );
  const packStateDirectory = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
  );
  const watcher = watch(packStateDirectory);
  const injectDrift = (async () => {
    for await (const event of watcher) {
      if (event.filename?.toString() === "active.json") {
        await writeFile(f.target, "drift after marker clear\n", "utf8");
        return;
      }
    }
  })();

  const result = await packRuntime.finalizePackTransactionRecovery({
    plan: recoveryPlan,
    authorization: recoveryAuthority.decision,
    lane: recoveryLane,
  });
  await Promise.race([
    injectDrift,
    delay(5_000, undefined, { ref: false }).then(() => {
      throw new Error("active marker observer did not inject drift");
    }),
  ]);

  assert.equal(result.status, "recovery-required");
  assert.equal(result.mutationUncertain, true);
  assert.equal(result.settlement.status, "uncertain");
  assert.equal(
    await readFile(
      join(
        f.project,
        ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
      ),
      "utf8",
    ).then((text) => text.length > 0),
    true,
  );
  await recoveryLane.release();
});

test("recovery distinguishes a restored preimage from a mixed transaction", async (t) => {
  const preimage = await fixture(t);
  const preimagePack = manifest(preimage.content);
  const preimageRegistry = validatedRegistry(preimagePack);
  const preimagePlan = await packRuntime.preparePackOperation(
    prepareRequest(preimage, preimageRegistry, preimagePack),
  );
  const preimageAuthorization = authorize(preimagePlan, preimageRegistry);
  const preimageLane = await acquireLane(preimage.targetRoot);
  t.after(() => preimageLane.state === "active" ? preimageLane.release() : undefined);
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan: preimagePlan,
      authorization: preimageAuthorization.decision,
      lane: preimageLane,
    })).status,
    "succeeded",
  );
  await preimageLane.release();
  await reopenAsStartedOnly(preimage);
  await rm(preimage.target);
  await rm(
    join(
      preimage.project,
      ...packRuntime.PACK_INSTALLED_STATE_PATH.split("/"),
    ),
  );

  const restored = await packRuntime.inspectPackTransactionRecovery({
    root: preimage.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(restored.observedState, "preimage");
  assert.equal(restored.consistency, "incomplete");
  assert.equal(restored.safeTerminalOutcome, "failed");
  assert.equal(restored.mutationUncertain, false);

  await rm(
    join(
      preimage.project,
      ...packRuntime.packTransactionRecordPath(runId, 0).split("/"),
    ),
  );
  const markerOnly = await packRuntime.inspectPackTransactionRecovery({
    root: preimage.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(markerOnly.journal, "marker-only");
  assert.equal(markerOnly.observedState, "preimage");
  assert.equal(markerOnly.consistency, "incomplete");
  assert.equal(markerOnly.safeTerminalOutcome, "failed");
  assert.equal(markerOnly.mutationUncertain, false);
  await writeFile(
    join(
      preimage.project,
      ...packRuntime.packTransactionRecordPath(runId, 1).split("/"),
    ),
    "{}\n",
    "utf8",
  );
  await assert.rejects(
    packRuntime.inspectPackTransactionRecovery({
      root: preimage.targetRoot,
      runId,
      project: {
        id: "sample.graybox",
        identityDigest: projectIdentityDigest,
      },
      maxDirectoryEntries: 1000,
    }),
    expectPackError("pack-transaction-corrupt"),
  );
  await rm(
    join(
      preimage.project,
      ...packRuntime.packTransactionRecordPath(runId, 1).split("/"),
    ),
  );
  await writeFile(
    join(
      preimage.project,
      ...packRuntime.packTransactionRecordPath(runId, 2).split("/"),
    ),
    "{}\n",
    "utf8",
  );
  await assert.rejects(
    packRuntime.inspectPackTransactionRecovery({
      root: preimage.targetRoot,
      runId,
      project: {
        id: "sample.graybox",
        identityDigest: projectIdentityDigest,
      },
      maxDirectoryEntries: 1000,
    }),
    expectPackError("pack-transaction-corrupt"),
  );

  const mixed = await fixture(t);
  const mixedPack = manifest(mixed.content);
  const mixedRegistry = validatedRegistry(mixedPack);
  const mixedPlan = await packRuntime.preparePackOperation(
    prepareRequest(mixed, mixedRegistry, mixedPack),
  );
  const mixedAuthorization = authorize(mixedPlan, mixedRegistry);
  const mixedLane = await acquireLane(mixed.targetRoot);
  t.after(() => mixedLane.state === "active" ? mixedLane.release() : undefined);
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan: mixedPlan,
      authorization: mixedAuthorization.decision,
      lane: mixedLane,
    })).status,
    "succeeded",
  );
  await mixedLane.release();
  await reopenAsStartedOnly(mixed);
  await rm(mixed.target);

  const unresolved = await packRuntime.inspectPackTransactionRecovery({
    root: mixed.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(unresolved.observedState, "mixed");
  assert.equal(unresolved.consistency, "unresolved");
  assert.equal(unresolved.safeTerminalOutcome, undefined);
  assert.equal(unresolved.mutationUncertain, true);
});

test("terminal outcome drift remains contradictory and recovery-required", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );
  const { decision } = authorize(plan, selectedRegistry);
  const lane = await acquireLane(f.targetRoot);
  t.after(() => lane.state === "active" ? lane.release() : undefined);
  assert.equal(
    (await packRuntime.executePreparedPackOperation({
      plan,
      authorization: decision,
      lane,
    })).status,
    "succeeded",
  );
  await lane.release();
  await writeFile(f.target, "user drift\n", "utf8");

  const recovery = await packRuntime.inspectPackTransactionRecovery({
    root: f.targetRoot,
    runId,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    maxDirectoryEntries: 1000,
  });
  assert.equal(recovery.observedState, "mixed");
  assert.equal(recovery.consistency, "contradictory");
  assert.equal(recovery.recordedOutcome, "committed");
  assert.equal(recovery.mutationUncertain, true);

  await assert.rejects(
    packRuntime.inspectPackTransactionRecovery({
      root: f.targetRoot,
      runId,
      project: {
        id: "sample.graybox",
        identityDigest: projectIdentityDigest,
      },
      maxDirectoryEntries: 1000,
      undeclared: true,
    }),
    expectPackError("invalid-pack-recovery-request"),
  );
});

test("a malformed active marker blocks planning without being replaced", async (t) => {
  const f = await fixture(t);
  const activePath = join(
    f.project,
    ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
  );
  await writeFile(activePath, "{}\n", "utf8");
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);

  await assert.rejects(
    packRuntime.preparePackOperation(
      prepareRequest(f, selectedRegistry, pack),
    ),
    expectPackError("pack-transaction-corrupt"),
  );
  assert.equal(await readFile(activePath, "utf8"), "{}\n");
});
