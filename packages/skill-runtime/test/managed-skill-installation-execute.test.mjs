import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
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
import {
  PACK_TRANSACTION_MAX_RECORD_BYTES,
  createPackOperationAuthorizationRequest,
  dispatchPreparedPackOperation,
} from "@ai-game-playbook/pack-runtime";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import {
  createProjectSkillPlan,
  prepareManagedProjectSkillInstallation,
  prepareProjectSkillMaterialization,
} from "../dist/index.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-managed-skill-execute-"));
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

async function prepared(project) {
  const skillPlan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan: skillPlan,
    runId: randomUUID(),
  });
  const packPlan = await prepareManagedProjectSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
  });
  assert.equal(packPlan.disposition, "ready");
  return { materialization, packPlan };
}

function grant(challenge, approvedAt, expiresAt) {
  const subject = core.createApprovalGrantSubject(challenge, {
    grantId: "approval.project-skills-install",
    permission: "install",
    approvedAt,
    expiresAt,
    maxUses: 1,
  });
  return {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId: "approval.local-key",
      value: sign(
        null,
        Buffer.from(
          contracts.computeApprovalGrantSigningDigest(subject),
          "utf8",
        ),
        privateKey,
      ).toString("base64url"),
    },
  };
}

function authorize(packPlan) {
  const now = Date.now();
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === "pack.add");
  assert.notEqual(command, undefined);
  const broker = core.createPermissionBroker({
    registry: BUILTIN_REGISTRY,
    project: {
      id: packPlan.project.id,
      identityDigest: packPlan.project.identityDigest,
      stage: packPlan.workflow.projectStage,
      budgets: {
        ...command.budgets,
        maxDurationMs: 900_000,
      },
    },
    trustedApprovalKeys: [{ keyId: "approval.local-key", publicKeyPem }],
  });
  const request = createPackOperationAuthorizationRequest({
    plan: packPlan,
    budgets: command.budgets,
    deadlineAt: new Date(now + command.timeoutMs).toISOString(),
  });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  const decision = broker.authorize(request, [
    grant(
      pending.challenge,
      new Date(now - 1_000).toISOString(),
      new Date(now + command.timeoutMs).toISOString(),
    ),
  ]);
  assert.equal(decision.status, "authorized");
  return decision;
}

test("managed skill add dispatches one approved durable workflow", async (t) => {
  const { project } = await fixture(t);
  const { materialization, packPlan } = await prepared(project);
  const authorization = authorize(packPlan);

  const result = await dispatchPreparedPackOperation({
    plan: packPlan,
    authorization,
    signal: null,
  });

  assert.deepEqual(result, {
    schemaVersion: "1.0.0",
    status: "succeeded",
    planDigest: packPlan.planDigest,
  });
  assert.equal(authorization.lease.state, "settled");
  assert.equal(
    (await readdir(join(project, ".agents", "skills"))).length,
    materialization.targets.length,
  );
  assert.equal(
    (await readdir(join(project, ".ai-game-playbook", "evidence", "receipts")))
      .length >= 2,
    true,
  );
  assert.equal(
    (await readdir(join(project, ".ai-game-playbook", "state", "workflows")))
      .length >= 5,
    true,
  );
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "locks")),
    [],
  );
  const root = await core.canonicalizeProjectRoot(project);
  const workflowQuery = await core.queryWorkflowCheckpointHeads({
    root,
    registry: BUILTIN_REGISTRY,
    maxEntries: 64,
    maxHeads: 16,
    maxTotalHeadBytes: 256 * 1024,
  });
  assert.equal(workflowQuery.heads.length, 1);
  assert.equal(workflowQuery.heads[0].runId, packPlan.runId);
  assert.equal(workflowQuery.heads[0].status, "succeeded");
  const workflowChain = await core.loadQueriedWorkflowCheckpointChain({
    query: workflowQuery,
    runId: packPlan.runId,
  });
  assert.equal(workflowChain.checkpoints.at(-1).status, "succeeded");

  const receiptQuery = await core.queryRunReceiptHeads({
    root,
    registry: BUILTIN_REGISTRY,
    maxEntries: 64,
    maxHeads: 16,
    maxTotalHeadBytes: 256 * 1024,
  });
  assert.equal(receiptQuery.heads.length, 1);
  const receiptChain = await core.loadQueriedRunReceiptChain({
    query: receiptQuery,
    runId: packPlan.runId,
    maxArtifactBytes: PACK_TRANSACTION_MAX_RECORD_BYTES,
  });
  assert.equal(receiptChain.receipts.length, 1);
  assert.equal(receiptChain.receipts[0].status, "succeeded");
  assert.equal(receiptChain.receipts[0].authority.command.id, "pack.add");
  assert.equal(receiptChain.receipts[0].mutation.status, "committed");
  assert.equal(receiptChain.receipts[0].artifacts.length, 1);
  assert.equal(receiptChain.receipts[0].artifacts[0].kind, "pack-transaction");
  assert.equal(receiptChain.receipts[0].artifacts[0].complete, true);
});

test("managed skill redispatch completes as a write-free no-op", async (t) => {
  const { project } = await fixture(t);
  const first = await prepared(project);
  await dispatchPreparedPackOperation({
    plan: first.packPlan,
    authorization: authorize(first.packPlan),
    signal: null,
  });

  const skillPlan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan: skillPlan,
    runId: randomUUID(),
  });
  const packPlan = await prepareManagedProjectSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
  });
  assert.equal(packPlan.disposition, "no-op");
  const receiptsBefore = await readdir(
    join(project, ".ai-game-playbook", "evidence", "receipts"),
  );
  const workflowsBefore = await readdir(
    join(project, ".ai-game-playbook", "state", "workflows"),
  );

  const result = await dispatchPreparedPackOperation({
    plan: packPlan,
    signal: null,
  });

  assert.deepEqual(result, {
    schemaVersion: "1.0.0",
    status: "no-op",
    planDigest: packPlan.planDigest,
  });
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "evidence", "receipts")),
    receiptsBefore,
  );
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    workflowsBefore,
  );
});

test("managed skill dispatch rejects copied plans before mutation", async (t) => {
  const { project } = await fixture(t);
  const { packPlan } = await prepared(project);
  const authorization = authorize(packPlan);

  await assert.rejects(
    dispatchPreparedPackOperation({
      plan: structuredClone(packPlan),
      authorization,
      signal: null,
    }),
    (error) => error?.code === "pack-plan-untrusted",
  );
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
});

test("managed skill dispatch honors cancellation before lane acquisition", async (t) => {
  const { project } = await fixture(t);
  const { packPlan } = await prepared(project);
  const authorization = authorize(packPlan);
  const controller = new AbortController();
  controller.abort("private reason must not escape");

  await assert.rejects(
    dispatchPreparedPackOperation({
      plan: packPlan,
      authorization,
      signal: controller.signal,
    }),
    (error) =>
      error?.code === "pack-operation-cancelled" &&
      !String(error.message).includes("private reason"),
  );
  assert.equal(authorization.lease.state, "settled");
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
});

test("managed skill dispatch rejects stale plans before workflow admission", async (t) => {
  const { project } = await fixture(t);
  const { materialization, packPlan } = await prepared(project);
  const authorization = authorize(packPlan);
  const target = join(
    project,
    ...materialization.targets[0].targetPath.split("/"),
  );
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "user-owned drift\n", "utf8");

  await assert.rejects(
    dispatchPreparedPackOperation({
      plan: packPlan,
      authorization,
      signal: null,
    }),
    (error) => error?.code === "pack-plan-not-executable",
  );
  assert.equal(authorization.lease.state, "settled");
  assert.equal(await readFile(target, "utf8"), "user-owned drift\n");
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
});

test("managed skill dispatch requires durable evidence stores before mutation", async (t) => {
  const { project } = await fixture(t);
  const { packPlan } = await prepared(project);
  const authorization = authorize(packPlan);
  await rm(
    join(project, ".ai-game-playbook", "evidence", "artifacts", "objects"),
    { recursive: true },
  );

  await assert.rejects(
    dispatchPreparedPackOperation({
      plan: packPlan,
      authorization,
      signal: null,
    }),
    (error) => error?.code === "pack-plan-not-executable",
  );
  assert.equal(authorization.lease.state, "settled");
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
});

test("managed skill dispatch rejects pending approval before lane acquisition", async (t) => {
  const { project } = await fixture(t);
  const { packPlan } = await prepared(project);

  await assert.rejects(
    dispatchPreparedPackOperation({
      plan: packPlan,
      authorization: { status: "approval-required" },
      signal: null,
    }),
    (error) => error?.code === "pack-authorization-invalid",
  );
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), []);
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook", "state", "workflows")),
    [],
  );
});
