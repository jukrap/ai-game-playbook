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
    maxChangedFiles: 128,
    maxChangedBytes: 16_777_216,
    maxDurationMs: 30_000,
    maxOutputBytes: 65_536,
    maxRepairCycles: 0,
  };
  command.requiredEvidence = ["evidence.pack-transaction"];
  command.handler = {
    package: "@ai-game-playbook/pack-runtime",
    export: "executePreparedPackOperation",
    digest: `sha256:${"8".repeat(64)}`,
  };
  return { command, definition };
}

function validatedRegistry(pack, operation = "add") {
  const { command, definition } = commandFor(operation);
  definition.schemas.push(
    contracts.approvalGrantSchema,
    packOperationInputSchema,
    packOperationOutputSchema,
  );
  definition.commands.push(command);
  definition.packs.push(pack);
  return registry.validateRegistry(definition);
}

function validatedRegistryWithoutPack(operation) {
  const { command, definition } = commandFor(operation);
  definition.schemas.push(
    contracts.approvalGrantSchema,
    packOperationInputSchema,
    packOperationOutputSchema,
  );
  definition.commands.push(command);
  return registry.validateRegistry(definition);
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
        maxChangedFiles: 128,
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
  const active = activeTransactions.createActivePackTransactionRecord(
    journal.started,
  );
  await activeTransactions.writeActivePackTransactionRecord({
    root: f.targetRoot,
    record: active,
    maxDirectoryEntries: 1000,
  });
  return journal.started;
}

test("authorized local add commits artifacts, installed state, and an append-only journal", async (t) => {
  const f = await fixture(t);
  const pack = manifest(f.content);
  const selectedRegistry = validatedRegistry(pack);
  const plan = await packRuntime.preparePackOperation(
    prepareRequest(f, selectedRegistry, pack),
  );

  assert.equal(typeof packRuntime.createPackOperationAuthorizationRequest, "function");
  assert.equal(typeof packRuntime.executePreparedPackOperation, "function");
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
