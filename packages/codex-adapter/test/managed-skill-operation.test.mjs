import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import {
  createProjectSkillPlan,
  prepareProjectSkillMaterialization,
} from "@ai-game-playbook/skill-runtime";
import {
  CodexManagedSkillBoundaryError,
  createCodexApprovalPresenter,
  inspectCodexManagedSkillInstallationRecovery,
  prepareCodexManagedSkillInstallation,
  queryCodexManagedSkillInstallationStatus,
  runCodexManagedSkillInstallation,
} from "../dist/index.js";

function signingKey(keyId = "approval.codex-managed-skill") {
  const { privateKey } = generateKeyPairSync("ed25519");
  return core.createLocalApprovalSigningKey({
    keyId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-codex-managed-skill-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, ".agents", "skills"), { recursive: true });
  for (const path of [
    [".ai-game-playbook", "locks"],
    [".ai-game-playbook", "state", "packs", "transactions"],
    [".ai-game-playbook", "state", "workflows"],
    [".ai-game-playbook", "evidence", "artifacts", "manifests"],
    [".ai-game-playbook", "evidence", "artifacts", "objects"],
    [".ai-game-playbook", "evidence", "receipts"],
  ]) {
    await mkdir(join(project, ...path), { recursive: true });
  }
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project };
}

async function prepared(project, key) {
  const skillPlan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan: skillPlan,
    runId: randomUUID(),
  });
  const operation = await prepareCodexManagedSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
    signingKey: key,
    approvalWaitMs: 5_000,
  });
  return { materialization, operation };
}

function expectOperationError(code) {
  return (error) =>
    error instanceof CodexManagedSkillBoundaryError && error.code === code;
}

test("approved managed skill operation dispatches immediately and records durable status", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { materialization, operation } = await prepared(project, key);

  assert.equal(operation.disposition, "ready");
  assert.equal(operation.approval.required, true);
  assert.equal(Object.isFrozen(operation), true);
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
  const serialized = JSON.stringify(operation);
  assert.equal(serialized.includes(project), false);
  assert.equal(serialized.includes("PRIVATE KEY"), false);

  let presentations = 0;
  const result = await runCodexManagedSkillInstallation({
    operation,
    presenter: createCodexApprovalPresenter(async (presentation) => {
      presentations += 1;
      assert.equal(presentation.session.sessionId, operation.approval.sessionId);
      assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
      return "approved";
    }),
    signingKey: key,
    signal: null,
  });

  assert.deepEqual(result, {
    schemaVersion: "1.0.0",
    runId: operation.runId,
    planDigest: operation.planDigest,
    status: "completed",
    approval: "authorized",
    output: {
      schemaVersion: "1.0.0",
      status: "succeeded",
      planDigest: operation.planDigest,
    },
  });
  assert.equal(presentations, 1);
  assert.equal(
    (await readdir(join(project, ".agents", "skills"))).length,
    materialization.targets.length,
  );
  assert.equal(core.inspectLocalApprovalSigningKey(key).status, "active");

  const status = await queryCodexManagedSkillInstallationStatus({
    projectRoot: project,
    runId: operation.runId,
  });
  assert.equal(status.disposition, "found");
  assert.equal(status.head.status, "succeeded");
  assert.equal(status.head.workflowId, "workflow.pack-add");
  assert.equal(status.head.projectAuthority, "current");
  assert.equal(status.head.registryAuthority, "current");

  const recovery = await inspectCodexManagedSkillInstallationRecovery({
    projectRoot: project,
    runId: operation.runId,
  });
  assert.equal(recovery.disposition, "assessed");
  assert.equal(recovery.head.status, "succeeded");
  assert.equal(recovery.report.runId, operation.runId);
  assert.equal(recovery.report.stable, true);
  assert.equal(recovery.report.mutationUncertain, false);
});

test("managed skill operation rejects copied handles and mismatched signing keys before presentation", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  const otherKey = signingKey("approval.codex-managed-skill-other");
  t.after(() => core.closeLocalApprovalSigningKey(key));
  t.after(() => core.closeLocalApprovalSigningKey(otherKey));
  const { materialization, operation } = await prepared(project, key);
  let presentations = 0;
  const presenter = createCodexApprovalPresenter(() => {
    presentations += 1;
    return "denied";
  });

  await assert.rejects(
    () =>
      prepareCodexManagedSkillInstallation({
        materialization,
        projectId: "sample.graybox",
        projectStage: "vertical-slice",
        signingKey: null,
        approvalWaitMs: 5_000,
      }),
    expectOperationError("codex-managed-skill-signing-key-mismatch"),
  );

  await assert.rejects(
    () =>
      runCodexManagedSkillInstallation({
        operation: structuredClone(operation),
        presenter,
        signingKey: key,
        signal: null,
      }),
    expectOperationError("codex-managed-skill-operation-invalid"),
  );
  await assert.rejects(
    () =>
      runCodexManagedSkillInstallation({
        operation,
        presenter,
        signingKey: otherKey,
        signal: null,
      }),
    expectOperationError("codex-managed-skill-signing-key-mismatch"),
  );
  assert.equal(presentations, 0);
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);

  const result = await runCodexManagedSkillInstallation({
    operation,
    presenter,
    signingKey: key,
    signal: null,
  });
  assert.equal(result.status, "not-authorized");
  assert.equal(result.approval, "denied");
  assert.equal(presentations, 1);
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
});

test("managed skill operation rejects concurrent and repeated execution", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { operation } = await prepared(project, key);
  let releasePresentation;
  let presentationStarted;
  const started = new Promise((resolve) => {
    presentationStarted = resolve;
  });
  const presenter = createCodexApprovalPresenter(() => {
    presentationStarted();
    return new Promise((resolve) => {
      releasePresentation = resolve;
    });
  });
  const request = { operation, presenter, signingKey: key, signal: null };
  const running = runCodexManagedSkillInstallation(request);
  await started;

  await assert.rejects(
    () => runCodexManagedSkillInstallation(request),
    expectOperationError("codex-managed-skill-operation-active"),
  );
  releasePresentation("cancelled");
  const result = await running;
  assert.equal(result.status, "not-authorized");
  assert.equal(result.approval, "cancelled");

  await assert.rejects(
    () => runCodexManagedSkillInstallation(request),
    expectOperationError("codex-managed-skill-operation-settled"),
  );
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
});

test("approved operation does not retry after pre-dispatch project drift", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { materialization, operation } = await prepared(project, key);
  const target = join(
    project,
    ...materialization.targets[0].targetPath.split("/"),
  );

  await assert.rejects(
    () =>
      runCodexManagedSkillInstallation({
        operation,
        presenter: createCodexApprovalPresenter(async () => {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, "user-owned drift\n", "utf8");
          return "approved";
        }),
        signingKey: key,
        signal: null,
      }),
    (error) => error?.code === "pack-plan-not-executable",
  );
  assert.equal(await readFile(target, "utf8"), "user-owned drift\n");
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
  await assert.rejects(
    () =>
      runCodexManagedSkillInstallation({
        operation,
        presenter: createCodexApprovalPresenter(() => "approved"),
        signingKey: key,
        signal: null,
      }),
    expectOperationError("codex-managed-skill-operation-settled"),
  );
});

test("managed skill no-op remains approval-free and durable queries are bounded", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const first = await prepared(project, key);
  await runCodexManagedSkillInstallation({
    operation: first.operation,
    presenter: createCodexApprovalPresenter(() => "approved"),
    signingKey: key,
    signal: null,
  });

  const skillPlan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan: skillPlan,
    runId: randomUUID(),
  });
  const second = {
    materialization,
    operation: await prepareCodexManagedSkillInstallation({
      materialization,
      projectId: "sample.graybox",
      projectStage: "vertical-slice",
      signingKey: null,
      approvalWaitMs: 5_000,
    }),
  };
  assert.equal(second.operation.disposition, "no-op");
  assert.deepEqual(second.operation.approval, { required: false });
  const result = await runCodexManagedSkillInstallation({
    operation: second.operation,
    signal: null,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.approval, "not-required");
  assert.equal(result.output.status, "no-op");

  const missingRunId = randomUUID();
  assert.deepEqual(
    await queryCodexManagedSkillInstallationStatus({
      projectRoot: project,
      runId: missingRunId,
    }),
    {
      schemaVersion: "1.0.0",
      runId: missingRunId,
      disposition: "not-found",
    },
  );
  assert.deepEqual(
    await inspectCodexManagedSkillInstallationRecovery({
      projectRoot: project,
      runId: missingRunId,
    }),
    {
      schemaVersion: "1.0.0",
      runId: missingRunId,
      disposition: "not-found",
    },
  );
});

test("recovery assessment reports a durable pre-effect checkpoint without replay", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  const runId = randomUUID();
  const checkpoint = core.createWorkflowCheckpoint({
    registry: BUILTIN_REGISTRY,
    workflowId: "workflow.pack-add",
    project: {
      id: "sample.graybox",
      identityDigest: root.identityDigest,
      rootIdentityDigest: root.identityDigest,
      stage: "vertical-slice",
    },
    runId,
    inputDigest: contracts.digestCanonicalJson({ runId, phase: "pre-effect" }),
    ttlMs: 60_000,
  });
  await core.persistWorkflowCheckpoint({
    root,
    registry: BUILTIN_REGISTRY,
    checkpoint,
  });

  const recovery = await inspectCodexManagedSkillInstallationRecovery({
    projectRoot: project,
    runId,
  });
  assert.equal(recovery.disposition, "transaction-not-found");
  assert.equal(recovery.head.status, "waiting-approval");
  assert.equal(recovery.head.inFlight, undefined);
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
});
