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
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as projectRuntime from "@ai-game-playbook/project-runtime";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import {
  createProjectSkillPlan,
  prepareProjectSkillMaterialization,
} from "@ai-game-playbook/skill-runtime";
import {
  CODEX_PROJECT_INITIALIZATION_APPROVAL_MAX_WAIT_MS,
  CodexProjectInitializationBoundaryError,
  createCodexApprovalPresenter,
  inspectCodexProjectInitializationRecovery,
  prepareCodexManagedSkillInstallation,
  prepareCodexProjectInitialization,
  runCodexManagedSkillInstallation,
  runCodexProjectInitialization,
} from "../dist/index.js";

const evidenceDigest = `sha256:${"a".repeat(64)}`;

function signingKey(keyId = "approval.codex-project-initialization") {
  const { privateKey } = generateKeyPairSync("ed25519");
  return core.createLocalApprovalSigningKey({
    keyId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
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

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-codex-project-init-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project };
}

async function initializationPlan(project, runId = randomUUID()) {
  const root = await core.canonicalizeProjectRoot(project);
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

async function prepared(project, key, runId = randomUUID()) {
  const plan = await initializationPlan(project, runId);
  const operation = await prepareCodexProjectInitialization({
    plan,
    signingKey: key,
    approvalWaitMs: 5_000,
  });
  return { operation, plan };
}

function expectOperationError(code) {
  return (error) =>
    error instanceof CodexProjectInitializationBoundaryError &&
    error.code === code;
}

test("approved project initialization dispatches in the approval call and exposes read-only recovery", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { operation } = await prepared(project, key);

  assert.equal(operation.disposition, "ready");
  assert.equal(operation.approval.required, true);
  assert.equal(Object.isFrozen(operation), true);
  assert.deepEqual(await readdir(project), []);
  const serialized = JSON.stringify(operation);
  assert.equal(serialized.includes(project), false);
  assert.equal(serialized.includes("PRIVATE KEY"), false);

  let presentations = 0;
  const result = await runCodexProjectInitialization({
    operation,
    presenter: createCodexApprovalPresenter(async (presentation) => {
      presentations += 1;
      assert.equal(presentation.session.sessionId, operation.approval.sessionId);
      assert.deepEqual(await readdir(project), []);
      return "approved";
    }),
    signingKey: key,
    signal: null,
  });

  assert.equal(result.status, "completed");
  assert.equal(result.approval, "authorized");
  assert.equal(result.disposition, "succeeded");
  assert.equal(result.output.status, "succeeded");
  assert.equal(result.output.preparedPlanDigest, operation.planDigest);
  assert.equal(presentations, 1);
  assert.deepEqual(
    (await readdir(join(project, ".agents"))).sort(),
    ["skills"],
  );
  assert.equal(core.inspectLocalApprovalSigningKey(key).status, "active");

  const recovery = await inspectCodexProjectInitializationRecovery({
    projectRoot: project,
    runId: operation.runId,
  });
  assert.equal(recovery.status, "clear");
  assert.equal(recovery.validationLevel, "selected-full-chain");
  assert.equal(recovery.selection.status, "assessed");
  assert.equal(recovery.selected.disposition, "terminal");
  assert.equal(recovery.selected.receipt.status, "verified");
  assert.equal(recovery.finalizationReady, false);
  assert.equal(recovery.mutationPerformed, false);
});

test("clean project initialization and managed skill installation use separate approvals", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { operation: initialization } = await prepared(project, key);
  const initializationResult = await runCodexProjectInitialization({
    operation: initialization,
    presenter: createCodexApprovalPresenter(() => "approved"),
    signingKey: key,
    signal: null,
  });
  assert.equal(initializationResult.status, "completed");

  const skillPlan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan: skillPlan,
    runId: randomUUID(),
  });
  const skill = await prepareCodexManagedSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
    signingKey: key,
    approvalWaitMs: 5_000,
  });
  assert.equal(skill.disposition, "ready");
  assert.notEqual(skill.runId, initialization.runId);
  assert.notEqual(skill.approval.sessionId, initialization.approval.sessionId);
  const skillResult = await runCodexManagedSkillInstallation({
    operation: skill,
    presenter: createCodexApprovalPresenter(() => "approved"),
    signingKey: key,
    signal: null,
  });
  assert.equal(skillResult.status, "completed");
  assert.equal(skillResult.approval, "authorized");
  assert.equal(
    (await readdir(join(project, ".agents", "skills"))).length,
    materialization.targets.length,
  );
});

test("project initialization rejects copied handles and mismatched keys before presentation", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  const otherKey = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  t.after(() => core.closeLocalApprovalSigningKey(otherKey));
  const { operation } = await prepared(project, key);
  let presentations = 0;
  const presenter = createCodexApprovalPresenter(() => {
    presentations += 1;
    return "denied";
  });

  await assert.rejects(
    () =>
      runCodexProjectInitialization({
        operation: structuredClone(operation),
        presenter,
        signingKey: key,
        signal: null,
      }),
    expectOperationError("codex-project-initialization-operation-invalid"),
  );
  await assert.rejects(
    () =>
      runCodexProjectInitialization({
        operation,
        presenter,
        signingKey: otherKey,
        signal: null,
      }),
    expectOperationError("codex-project-initialization-signing-key-mismatch"),
  );
  assert.equal(presentations, 0);
  assert.deepEqual(await readdir(project), []);

  const result = await runCodexProjectInitialization({
    operation,
    presenter,
    signingKey: key,
    signal: null,
  });
  assert.equal(result.status, "not-authorized");
  assert.equal(result.approval, "denied");
  assert.equal(presentations, 1);
  assert.deepEqual(await readdir(project), []);
});

test("project initialization rejects hostile request shapes and invalid bounds before effect", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const plan = await initializationPlan(project);
  let accessorCalls = 0;
  const accessorRequest = {
    signingKey: key,
    approvalWaitMs: 5_000,
  };
  Object.defineProperty(accessorRequest, "plan", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      return plan;
    },
  });
  assert.throws(
    () => prepareCodexProjectInitialization(accessorRequest),
    expectOperationError("codex-project-initialization-operation-invalid"),
  );
  assert.equal(accessorCalls, 0);
  assert.throws(
    () =>
      prepareCodexProjectInitialization(
        new Proxy(
          { plan, signingKey: key, approvalWaitMs: 5_000 },
          {
            get() {
              throw new Error("proxy trap must not run");
            },
          },
        ),
      ),
    expectOperationError("codex-project-initialization-operation-invalid"),
  );
  for (const approvalWaitMs of [
    999,
    CODEX_PROJECT_INITIALIZATION_APPROVAL_MAX_WAIT_MS + 1,
  ]) {
    assert.throws(
      () =>
        prepareCodexProjectInitialization({
          plan,
          signingKey: key,
          approvalWaitMs,
        }),
      expectOperationError("codex-project-initialization-operation-invalid"),
    );
  }
  assert.throws(
    () =>
      prepareCodexProjectInitialization({
        plan,
        signingKey: null,
        approvalWaitMs: 5_000,
      }),
    expectOperationError(
      "codex-project-initialization-signing-key-mismatch",
    ),
  );

  const operation = prepareCodexProjectInitialization({
    plan,
    signingKey: key,
    approvalWaitMs: 5_000,
  });
  await assert.rejects(
    () =>
      runCodexProjectInitialization({
        operation,
        presenter: createCodexApprovalPresenter(() => "approved"),
        signingKey: key,
        signal: Object.freeze({}),
      }),
    expectOperationError("codex-project-initialization-operation-invalid"),
  );
  const result = await runCodexProjectInitialization({
    operation,
    presenter: createCodexApprovalPresenter(() => "denied"),
    signingKey: key,
    signal: null,
  });
  assert.equal(result.status, "not-authorized");
  assert.deepEqual(await readdir(project), []);
});

test("project initialization rejects concurrent and repeated execution", async (t) => {
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
  const running = runCodexProjectInitialization(request);
  await started;

  await assert.rejects(
    () => runCodexProjectInitialization(request),
    expectOperationError("codex-project-initialization-operation-active"),
  );
  releasePresentation("cancelled");
  const result = await running;
  assert.equal(result.status, "not-authorized");
  assert.equal(result.approval, "cancelled");

  await assert.rejects(
    () => runCodexProjectInitialization(request),
    expectOperationError("codex-project-initialization-operation-settled"),
  );
  assert.deepEqual(await readdir(project), []);
});

test("approved initialization does not retry after pre-dispatch project drift", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const { operation } = await prepared(project, key);
  const occupied = join(project, ".ai-game-playbook");

  await assert.rejects(
    () =>
      runCodexProjectInitialization({
        operation,
        presenter: createCodexApprovalPresenter(async () => {
          await writeFile(occupied, "user-owned drift\n", "utf8");
          return "approved";
        }),
        signingKey: key,
        signal: null,
      }),
    (error) => error?.code === "project-initialization-plan-stale",
  );
  assert.equal(await readFile(occupied, "utf8"), "user-owned drift\n");
  await assert.rejects(
    () =>
      runCodexProjectInitialization({
        operation,
        presenter: createCodexApprovalPresenter(() => "approved"),
        signingKey: key,
        signal: null,
      }),
    expectOperationError("codex-project-initialization-operation-settled"),
  );
});

test("initialized projects complete as no-op without approval authority", async (t) => {
  const { project } = await fixture(t);
  const key = signingKey();
  t.after(() => core.closeLocalApprovalSigningKey(key));
  const first = await prepared(project, key);
  await runCodexProjectInitialization({
    operation: first.operation,
    presenter: createCodexApprovalPresenter(() => "approved"),
    signingKey: key,
    signal: null,
  });

  const plan = await initializationPlan(project);
  assert.equal(plan.disposition, "no-op");
  const operation = await prepareCodexProjectInitialization({
    plan,
    signingKey: null,
    approvalWaitMs: 5_000,
  });
  assert.equal(operation.disposition, "no-op");
  assert.deepEqual(operation.approval, { required: false });
  const result = await runCodexProjectInitialization({
    operation,
    signal: null,
  });
  assert.deepEqual(result, {
    schemaVersion: "1.0.0",
    runId: operation.runId,
    planDigest: operation.planDigest,
    status: "completed",
    approval: "not-required",
    disposition: "no-op",
  });
});

test("blocked initialization plans and unknown recovery selectors remain mutation-free", async (t) => {
  const { project } = await fixture(t);
  const runId = randomUUID();
  const recovery = await inspectCodexProjectInitializationRecovery({
    projectRoot: project,
    runId,
  });
  assert.equal(recovery.selection.status, "not-found");
  assert.equal(recovery.selection.runId, runId);
  assert.equal(recovery.mutationPerformed, false);

  await writeFile(join(project, ".ai-game-playbook"), "occupied\n", "utf8");
  const plan = await initializationPlan(project);
  assert.equal(plan.disposition, "blocked");
  assert.throws(
    () =>
      prepareCodexProjectInitialization({
        plan,
        signingKey: null,
        approvalWaitMs: 5_000,
    }),
    expectOperationError("codex-project-initialization-plan-blocked"),
  );
});
