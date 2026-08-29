import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  resolveWorkflowPlan,
} from "@ai-game-playbook/registry";

import * as projectRuntime from "../dist/index.js";

const evidenceDigest = `sha256:${"a".repeat(64)}`;

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-project-init-execute-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function profile() {
  const projectId = "sample.graybox";
  const engine = { id: "godot", version: "4.7.2" };
  return {
    schemaVersion: "1.0.0",
    projectId,
    projectRoot: ".",
    engine: {
      ...engine,
      projectIdentityDigest: contracts.computeGameProjectIdentityDigest({
        projectId,
        engine,
      }),
    },
    stage: {
      declared: "vertical-slice",
      effective: "vertical-slice",
      confidence: "medium",
      evidence: [
        {
          locator: "project.godot",
          grade: "declared",
          digest: evidenceDigest,
        },
      ],
      reason: "The user declared the first vertical-slice milestone.",
    },
    teamSize: 1,
    gameShape: "offline-single-player-3d",
    targets: [
      {
        platform: "windows",
        architecture: "x64",
        configuration: "development",
      },
    ],
    budgets: {
      maxChangedFiles: 24,
      maxChangedBytes: 262144,
      maxDurationMs: 900000,
      maxOutputBytes: 4194304,
      maxRepairCycles: 3,
    },
    coreLoop: ["move", "collect", "win"],
    pillars: ["responsive movement", "clear feedback"],
    exclusions: ["multiplayer", "web export"],
  };
}

async function prepare(root, runId) {
  const reviewed = await core.planProjectInitialization({ root });
  const expectedInitPlanDigest = contracts.computeInitPlanDigest({
    registryDigest: BUILTIN_REGISTRY.digest,
    projectIdentityDigest: reviewed.rootIdentityDigest,
    targets: reviewed.targets,
  });
  return projectRuntime.prepareProjectInitialization({
    registry: BUILTIN_REGISTRY,
    targetRoot: root,
    expectedInitPlanDigest,
    profile: profile(),
    runId,
  });
}

function authorize(plan) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "approval.project-initialization";
  const broker = core.createPermissionBroker({
    registry: BUILTIN_REGISTRY,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      stage: plan.project.stage,
      budgets: profile().budgets,
    },
    trustedApprovalKeys: [
      {
        keyId,
        publicKeyPem: publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
    ],
  });
  const deadlineAt = new Date(Date.now() + 25_000).toISOString();
  const request =
    projectRuntime.createProjectInitializationAuthorizationRequest({
      plan,
      deadlineAt,
    });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  const subject = core.createApprovalGrantSubject(pending.challenge, {
    grantId: "grant.project-initialization",
    permission: "write-project-metadata",
    approvedAt: new Date(Date.now() - 1).toISOString(),
    expiresAt: deadlineAt,
    maxUses: 1,
  });
  const grant = {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId,
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
  const decision = broker.authorize(request, [grant]);
  assert.equal(decision.status, "authorized");
  return { decision, request };
}

function native(project, portablePath) {
  return join(project, ...portablePath.split("/"));
}

function expectRuntimeError(code) {
  return (error) =>
    error?.name === "ProjectRuntimeError" && error?.code === code;
}

async function waitForPath(path, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await lstat(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await delay(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function waitForHeldLane(root, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const inspection = await core.inspectProjectLane({ root });
      if (inspection.status === "held") return;
    } catch (error) {
      if (error?.code !== "project-path-not-found") throw error;
    }
    await delay(10);
  }
  throw new Error("timed out waiting for the project mutation lane");
}

test("approved initialization commits the exact layout and durable evidence chain", async (t) => {
  const f = await fixture(t);
  const runId = "21111111-1111-4111-8111-111111111111";
  const plan = await prepare(f.root, runId);
  const authority = authorize(plan);

  assert.deepEqual(authority.request.scope.paths, [
    ...plan.targets
      .filter(({ action }) => action === "create")
      .map(({ path }) => path)
      .sort(contracts.compareCanonicalText),
  ]);
  assert.deepEqual(authority.request.scope.changeKinds, ["metadata"]);
  assert.deepEqual(authority.request.budgets, plan.budgets);
  assert.equal(authority.request.workflow.id, "workflow.project-initialization");
  assert.equal(authority.request.workflow.stepId, "step.project-initialize");

  const report = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization: authority.decision,
    signal: null,
  });

  assert.equal(report.status, "succeeded");
  assert.equal(report.mutationUncertain, false);
  assert.equal(report.authorization.status, "succeeded");
  assert.equal(report.evidence.activeMarker.status, "cleared");
  assert.equal(report.effects.changedPaths.length, 11);
  assert.equal(report.effects.appliedPaths.length, 11);
  assert.equal(report.effects.rolledBackPaths.length, 0);
  assert.equal(report.effects.controlPlaneState.changedPaths.length, 18);
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationReportSemantics(report),
  );
  assert.equal(authority.decision.lease.state, "settled");

  for (const target of plan.targets) {
    const stats = await lstat(native(f.project, target.path));
    assert.equal(
      target.kind === "directory" ? stats.isDirectory() : stats.isFile(),
      true,
    );
  }
  assert.equal(
    await readFile(native(f.project, ".ai-game-playbook/.gitignore"), "utf8"),
    projectRuntime.PROJECT_INITIALIZATION_IGNORE_POLICY,
  );
  assert.equal(
    (await lstat(native(f.project, ".agents/skills"))).isDirectory(),
    true,
  );

  const workflow = resolveWorkflowPlan(
    BUILTIN_REGISTRY,
    "workflow.project-initialization",
    plan.project.stage,
  );
  const inputDigest = contracts.digestCanonicalJson(
    projectRuntime.createProjectInitializationCommandInput(plan),
  );
  const receipts = await core.loadRunReceiptChain({
    root: f.root,
    registry: BUILTIN_REGISTRY,
    runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.rootIdentityDigest,
    workflowId: workflow.workflow.id,
    resolvedPlanDigest: workflow.resolvedPlanDigest,
    maxArtifactBytes: 0,
  });
  assert.equal(receipts.receipts.length, 1);
  assert.equal(receipts.stored.receipt.status, "succeeded");
  assert.equal(
    receipts.stored.receipt.receiptDigest,
    report.evidence.receipt.receiptDigest,
  );
  const checkpoint = await core.loadWorkflowCheckpoint({
    root: f.root,
    registry: BUILTIN_REGISTRY,
    runId,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      rootIdentityDigest: plan.project.rootIdentityDigest,
      stage: plan.project.stage,
    },
    inputDigest,
  });
  assert.equal(checkpoint.checkpoint.status, "succeeded");
  assert.deepEqual(checkpoint.checkpoint.evidenceKinds, ["run-receipt"]);
  assert.equal((await core.inspectProjectLane({ root: f.root })).status, "free");
});

test("initialization can repair only missing control state without reporting a project mutation", async (t) => {
  const f = await fixture(t);
  const first = await prepare(
    f.root,
    "22111111-1111-4111-8111-111111111111",
  );
  const firstAuthority = authorize(first);
  const firstReport = await projectRuntime.executePreparedProjectInitialization({
    plan: first,
    authorization: firstAuthority.decision,
    signal: null,
  });
  assert.equal(firstReport.status, "succeeded");
  await rmdir(native(f.project, ".ai-game-playbook/locks"));

  const repeated = await prepare(
    f.root,
    "23111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    repeated.disposition,
    "ready",
    repeated.conflicts.map(({ code, path }) => `${code}:${path}`).join(", "),
  );
  assert.deepEqual(
    repeated.targets
      .filter(({ action }) => action === "create")
      .map(({ path }) => path),
    [".ai-game-playbook/locks"],
  );
  const repeatedAuthority = authorize(repeated);
  assert.deepEqual(repeatedAuthority.request.scope.paths, [
    ".ai-game-playbook/locks",
  ]);
  const report = await projectRuntime.executePreparedProjectInitialization({
    plan: repeated,
    authorization: repeatedAuthority.decision,
    signal: null,
  });

  assert.equal(report.status, "succeeded");
  assert.deepEqual(report.effects.changedPaths, []);
  assert.deepEqual(report.effects.appliedPaths, []);
  assert.deepEqual(report.effects.rolledBackPaths, []);
  assert.equal(report.effects.controlPlaneState.changedPaths.length, 8);
  assert.equal(report.authorization.status, "succeeded");
  assert.equal(repeatedAuthority.decision.lease.state, "settled");
  assert.doesNotThrow(() =>
    contracts.assertProjectInitializationReportSemantics(report),
  );
});

test("execution rejects copied authority and settles approval-time drift without writing", async (t) => {
  const copied = await fixture(t);
  const copiedPlan = await prepare(
    copied.root,
    "31111111-1111-4111-8111-111111111111",
  );
  const copiedAuthority = authorize(copiedPlan);
  assert.doesNotThrow(
    () =>
      projectRuntime.createProjectInitializationAuthorizationRequest({
        plan: copiedPlan,
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      }),
  );
  assert.throws(
    () =>
      projectRuntime.createProjectInitializationAuthorizationRequest({
        plan: copiedPlan,
        deadlineAt: new Date(Date.now() + 331_000).toISOString(),
      }),
    expectRuntimeError("invalid-project-initialization-execution-request"),
  );
  assert.throws(
    () =>
      projectRuntime.createProjectInitializationAuthorizationRequest({
        plan: structuredClone(copiedPlan),
        deadlineAt: new Date(Date.now() + 20_000).toISOString(),
      }),
    expectRuntimeError("project-initialization-plan-untrusted"),
  );
  await assert.rejects(
    projectRuntime.executePreparedProjectInitialization({
      plan: copiedPlan,
      authorization: structuredClone(copiedAuthority.decision),
      signal: null,
    }),
    expectRuntimeError("project-initialization-authorization-invalid"),
  );
  assert.deepEqual(await readdir(copied.project), []);

  const drifted = await fixture(t);
  const driftedPlan = await prepare(
    drifted.root,
    "41111111-1111-4111-8111-111111111111",
  );
  const driftedAuthority = authorize(driftedPlan);
  await mkdir(native(drifted.project, ".ai-game-playbook"));
  await assert.rejects(
    projectRuntime.executePreparedProjectInitialization({
      plan: driftedPlan,
      authorization: driftedAuthority.decision,
      signal: null,
    }),
    expectRuntimeError("project-initialization-plan-stale"),
  );
  assert.equal(driftedAuthority.decision.lease.state, "settled");
  assert.deepEqual(await readdir(drifted.project), [".ai-game-playbook"]);
  assert.deepEqual(
    await readdir(native(drifted.project, ".ai-game-playbook")),
    [],
  );
});

test("cancellation at lane admission removes every pre-checkpoint bootstrap mutation", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(
    f.root,
    "42111111-1111-4111-8111-111111111111",
  );
  const authority = authorize(plan);
  const controller = new AbortController();
  const cancel = (async () => {
    await waitForHeldLane(f.root);
    controller.abort();
  })();

  await assert.rejects(
    projectRuntime.executePreparedProjectInitialization({
      plan,
      authorization: authority.decision,
      signal: controller.signal,
    }),
    expectRuntimeError("project-initialization-execution-failed"),
  );
  await cancel;

  assert.equal(authority.decision.lease.state, "settled");
  assert.deepEqual(await readdir(f.project), []);
});

test("pre-checkpoint cleanup preserves concurrent user content and requires recovery", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(
    f.root,
    "43111111-1111-4111-8111-111111111111",
  );
  const authority = authorize(plan);
  const controller = new AbortController();
  const controlRoot = native(f.project, ".ai-game-playbook");
  const userFile = join(controlRoot, "user-owned.txt");
  const interfere = (async () => {
    await waitForPath(controlRoot);
    await writeFile(userFile, "preserve me\n", "utf8");
    await waitForHeldLane(f.root);
    controller.abort();
  })();

  await assert.rejects(
    projectRuntime.executePreparedProjectInitialization({
      plan,
      authorization: authority.decision,
      signal: controller.signal,
    }),
    expectRuntimeError("project-initialization-recovery-required"),
  );
  await interfere;

  assert.equal(authority.decision.lease.state, "settled");
  assert.equal(await readFile(userFile, "utf8"), "preserve me\n");
  assert.deepEqual(await readdir(controlRoot), ["user-owned.txt"]);
});

test("cooperative cancellation rolls back every confirmed project target creation", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(
    f.root,
    "51111111-1111-4111-8111-111111111111",
  );
  const authority = authorize(plan);
  const controller = new AbortController();
  const profilePath = native(f.project, ".ai-game-playbook/profile.json");
  const cancel = (async () => {
    await waitForPath(profilePath);
    controller.abort();
  })();

  const report = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization: authority.decision,
    signal: controller.signal,
  });
  await cancel;

  assert.equal(report.status, "rolled-back");
  assert.equal(report.mutationUncertain, false);
  assert.equal(report.authorization.status, "failed");
  assert.deepEqual(report.effects.changedPaths, [
    ".ai-game-playbook/profile.json",
  ]);
  assert.deepEqual(report.effects.appliedPaths, report.effects.changedPaths);
  assert.deepEqual(report.effects.rolledBackPaths, report.effects.changedPaths);
  await assert.rejects(lstat(profilePath), (error) => error?.code === "ENOENT");
  const receipt = await core.loadRunReceiptChain({
    root: f.root,
    registry: BUILTIN_REGISTRY,
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.rootIdentityDigest,
    workflowId: "workflow.project-initialization",
    resolvedPlanDigest: resolveWorkflowPlan(
      BUILTIN_REGISTRY,
      "workflow.project-initialization",
      plan.project.stage,
    ).resolvedPlanDigest,
    maxArtifactBytes: 0,
  });
  assert.equal(
    "postimageDigest" in receipt.stored.receipt.mutation.changedFiles[0],
    false,
  );
  assert.equal(
    (await core.loadWorkflowCheckpoint({
      root: f.root,
      registry: BUILTIN_REGISTRY,
      runId: plan.runId,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
        rootIdentityDigest: plan.project.rootIdentityDigest,
        stage: plan.project.stage,
      },
      inputDigest: contracts.digestCanonicalJson(
        projectRuntime.createProjectInitializationCommandInput(plan),
      ),
    })).checkpoint.status,
    "failed",
  );
});

test("cancellation between parent waves rolls back the shared skill parent", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(
    f.root,
    "52111111-1111-4111-8111-111111111111",
  );
  const authority = authorize(plan);
  const controller = new AbortController();
  const sharedParent = native(f.project, ".agents");
  const cancel = (async () => {
    await waitForPath(sharedParent);
    controller.abort();
  })();

  const report = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization: authority.decision,
    signal: controller.signal,
  });
  await cancel;

  assert.equal(report.status, "rolled-back");
  assert.equal(report.mutationUncertain, false);
  assert.equal(report.effects.appliedPaths.includes(".agents"), true);
  assert.equal(report.effects.rolledBackPaths.includes(".agents"), true);
  await assert.rejects(lstat(sharedParent), (error) => error?.code === "ENOENT");
});

test("unsafe rollback preserves user content and retains a recovery barrier", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(
    f.root,
    "61111111-1111-4111-8111-111111111111",
  );
  const authority = authorize(plan);
  const controller = new AbortController();
  const policiesPath = native(f.project, ".ai-game-playbook/policies");
  const userFile = join(policiesPath, "user-owned.txt");
  const interfere = (async () => {
    await waitForPath(policiesPath);
    await writeFile(userFile, "preserve me\n", "utf8");
    controller.abort();
  })();

  const report = await projectRuntime.executePreparedProjectInitialization({
    plan,
    authorization: authority.decision,
    signal: controller.signal,
  });
  await interfere;

  assert.equal(report.status, "recovery-required");
  assert.equal(report.mutationUncertain, true);
  assert.equal(report.authorization.status, "uncertain");
  assert.equal(report.evidence.activeMarker.status, "retained");
  assert.equal(await readFile(userFile, "utf8"), "preserve me\n");
  assert.equal(report.effects.appliedPaths.includes(".ai-game-playbook/policies"), true);
  assert.equal(report.effects.rolledBackPaths.includes(".ai-game-playbook/policies"), false);
  const checkpoint = await core.loadWorkflowCheckpoint({
    root: f.root,
    registry: BUILTIN_REGISTRY,
    runId: plan.runId,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      rootIdentityDigest: plan.project.rootIdentityDigest,
      stage: plan.project.stage,
    },
    inputDigest: contracts.digestCanonicalJson(
      projectRuntime.createProjectInitializationCommandInput(plan),
    ),
  });
  assert.equal(checkpoint.checkpoint.status, "uncertain");
});
