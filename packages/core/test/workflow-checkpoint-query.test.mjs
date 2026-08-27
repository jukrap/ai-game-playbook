import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as registry from "@ai-game-playbook/registry";
import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = "project.graybox";
const LOGICAL_PROJECT_DIGEST = contracts.sha256Digest("graybox project");
const INPUT_DIGEST = contracts.sha256Digest("initialization input");
const NOW = Date.parse("2026-08-27T02:00:00.000Z");

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-workflow-query-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function queryRequest(root, overrides = {}) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    maxEntries: 64,
    maxHeads: 16,
    maxTotalHeadBytes: 256 * 1024,
    ...overrides,
  };
}

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

function workflowStore(project) {
  return join(project, ".ai-game-playbook", "state", "workflows");
}

async function persistInitialCheckpoint(root, overrides = {}) {
  await core.initializeProjectState({ root });
  const checkpoint = core.createWorkflowCheckpoint({
    registry: registry.BUILTIN_REGISTRY,
    workflowId: "workflow.project-initialization",
    project: {
      id: PROJECT_ID,
      identityDigest: LOGICAL_PROJECT_DIGEST,
      rootIdentityDigest: root.identityDigest,
      stage: "vertical-slice",
    },
    runId: RUN_ID,
    inputDigest: INPUT_DIGEST,
    ttlMs: 86_400_000,
    now: () => NOW,
    ...overrides,
  });
  const stored = await core.persistWorkflowCheckpoint({
    root,
    registry: registry.BUILTIN_REGISTRY,
    checkpoint,
  });
  return { checkpoint, stored };
}

test("workflow checkpoint query treats a missing store as an immutable empty inventory without writes", async (t) => {
  const { project, root } = await fixture(t);

  assert.equal(typeof core.queryWorkflowCheckpointHeads, "function");
  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));

  assert.equal(Object.isFrozen(query), true);
  assert.equal(Object.isFrozen(query.heads), true);
  assert.deepEqual(query, {
    validationLevel: "head-and-latest-record-presence",
    rootIdentityDigest: root.identityDigest,
    registryDigest: registry.BUILTIN_REGISTRY.digest,
    entriesObserved: 0,
    headFilesObserved: 0,
    recordFilesObserved: 0,
    heads: [],
  });
  assert.deepEqual(await readdir(project), []);
});

test("workflow checkpoint query returns a deterministic safe summary for a canonical head", async (t) => {
  const { root } = await fixture(t);
  const { checkpoint, stored } = await persistInitialCheckpoint(root);

  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));

  assert.equal(query.entriesObserved, 2);
  assert.equal(query.headFilesObserved, 1);
  assert.equal(query.recordFilesObserved, 1);
  assert.deepEqual(query.heads, [
    {
      runId: RUN_ID,
      checkpointId: checkpoint.checkpointId,
      sequence: 0,
      checkpointDigest: checkpoint.checkpointDigest,
      status: "waiting-approval",
      projectId: PROJECT_ID,
      projectIdentityDigest: LOGICAL_PROJECT_DIGEST,
      projectRootIdentityDigest: root.identityDigest,
      projectAuthority: "current",
      projectStage: "vertical-slice",
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      registryAuthority: "current",
      workflowId: "workflow.project-initialization",
      workflowVersion: "1.0.0",
      resolvedPlanDigest: checkpoint.identity.workflow.resolvedPlanDigest,
      inputDigest: INPUT_DIGEST,
      updatedAt: checkpoint.updatedAt,
      headDigest: stored.headDigest,
    },
  ]);
  assert.equal("absolutePath" in query.heads[0], false);
  assert.equal("authorizationId" in query.heads[0], false);
  assert.equal(JSON.stringify(query).includes(root.canonicalPath), false);
});

test("a same-process query can load exactly one current checkpoint chain without caller-supplied identity", async (t) => {
  const { root } = await fixture(t);
  const { checkpoint, stored } = await persistInitialCheckpoint(root);
  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));

  assert.equal(typeof core.loadQueriedWorkflowCheckpoint, "function");
  const loaded = await core.loadQueriedWorkflowCheckpoint({
    query,
    runId: RUN_ID,
  });

  assert.equal(Object.isFrozen(loaded), true);
  assert.deepEqual(loaded.checkpoint, checkpoint);
  assert.equal(loaded.headDigest, stored.headDigest);
  assert.equal(loaded.chainLength, 1);
});

test("a same-process query can retain the validated chronological checkpoint chain", async (t) => {
  const { root } = await fixture(t);
  const { checkpoint, stored } = await persistInitialCheckpoint(root);
  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));

  assert.equal(typeof core.loadQueriedWorkflowCheckpointChain, "function");
  const loaded = await core.loadQueriedWorkflowCheckpointChain({
    query,
    runId: RUN_ID,
  });

  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.checkpoints), true);
  assert.equal(loaded.stored.headDigest, stored.headDigest);
  assert.equal(loaded.stored.chainLength, 1);
  assert.deepEqual(loaded.checkpoints, [checkpoint]);
});

test("queried checkpoint loading rejects copied authority and a changed head witness", async (t) => {
  const { project, root } = await fixture(t);
  await persistInitialCheckpoint(root);
  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));

  await assert.rejects(
    core.loadQueriedWorkflowCheckpoint({
      query: structuredClone(query),
      runId: RUN_ID,
    }),
    expectCoreError("invalid-workflow-checkpoint-store-request"),
  );

  const headPath = join(workflowStore(project), `${RUN_ID}.head.json`);
  const head = JSON.parse(await readFile(headPath, "utf8"));
  const { headDigest: _headDigest, ...body } = head;
  const changedBody = {
    ...body,
    updatedAt: "2026-08-27T02:00:01.000Z",
  };
  const changed = {
    ...changedBody,
    headDigest: contracts.digestCanonicalJson({
      domain: "ai-game-playbook.workflow-checkpoint-head",
      version: "1",
      subject: changedBody,
    }),
  };
  await writeFile(headPath, `${contracts.canonicalizeJson(changed)}\n`);

  await assert.rejects(
    core.loadQueriedWorkflowCheckpoint({ query, runId: RUN_ID }),
    expectCoreError("workflow-checkpoint-store-conflict"),
  );
});

test("an unbound checkpoint remains visible but cannot become current load authority", async (t) => {
  const { root } = await fixture(t);
  await persistInitialCheckpoint(root, {
    project: {
      id: PROJECT_ID,
      identityDigest: LOGICAL_PROJECT_DIGEST,
      stage: "vertical-slice",
    },
  });

  const query = await core.queryWorkflowCheckpointHeads(queryRequest(root));
  assert.equal(query.heads[0].projectAuthority, "unbound");
  assert.equal("projectRootIdentityDigest" in query.heads[0], false);
  await assert.rejects(
    core.loadQueriedWorkflowCheckpoint({ query, runId: RUN_ID }),
    expectCoreError("workflow-checkpoint-store-mismatch"),
  );
});

test("workflow checkpoint inventory fails closed on unknown entries and bounded scans", async (t) => {
  const unknown = await fixture(t);
  await persistInitialCheckpoint(unknown.root);
  await writeFile(join(workflowStore(unknown.project), "unexpected.json"), "{}\n");
  await assert.rejects(
    core.queryWorkflowCheckpointHeads(queryRequest(unknown.root)),
    expectCoreError("workflow-checkpoint-store-corrupt"),
  );

  const bounded = await fixture(t);
  await persistInitialCheckpoint(bounded.root);
  await assert.rejects(
    core.queryWorkflowCheckpointHeads(
      queryRequest(bounded.root, { maxEntries: 1 }),
    ),
    expectCoreError("workflow-checkpoint-store-budget-exceeded"),
  );
  await assert.rejects(
    core.queryWorkflowCheckpointHeads(
      queryRequest(bounded.root, { maxHeads: 0 }),
    ),
    expectCoreError("invalid-workflow-checkpoint-store-request"),
  );
});
