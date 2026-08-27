import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";

import * as projectRuntime from "../dist/index.js";

const evidenceDigest = `sha256:${"a".repeat(64)}`;

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-project-init-prepare-"));
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

async function reviewedPlan(root) {
  const plan = await core.planProjectInitialization({ root });
  return {
    plan,
    digest: contracts.computeInitPlanDigest({
      registryDigest: BUILTIN_REGISTRY.digest,
      projectIdentityDigest: plan.rootIdentityDigest,
      targets: plan.targets,
    }),
  };
}

function request(root, expectedInitPlanDigest, overrides = {}) {
  return {
    registry: BUILTIN_REGISTRY,
    targetRoot: root,
    expectedInitPlanDigest,
    profile: profile(),
    runId: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function native(project, portablePath) {
  return join(project, ...portablePath.split("/"));
}

async function writeExactExistingLayout(project, selectedProfile) {
  for (const target of core.PROJECT_INITIALIZATION_TARGETS) {
    const path = native(project, target.path);
    if (target.kind === "directory") {
      await mkdir(path, { recursive: true });
      continue;
    }
    await mkdir(join(path, ".."), { recursive: true });
    if (target.content === "project-profile") {
      await writeFile(path, `${contracts.canonicalizeJson(selectedProfile)}\n`);
    } else if (target.content === "pack-lock") {
      const lock = contracts.createEmptyProjectPackLock({
        projectId: selectedProfile.projectId,
        projectIdentityDigest:
          selectedProfile.engine.projectIdentityDigest,
      });
      await writeFile(path, `${contracts.canonicalizeJson(lock)}\n`);
    } else {
      await writeFile(
        path,
        projectRuntime.PROJECT_INITIALIZATION_IGNORE_POLICY,
      );
    }
  }
}

test("fresh initialization preparation is write-free, exact, and same-process", async (t) => {
  const { project, root } = await fixture(t);
  const reviewed = await reviewedPlan(root);

  const prepared = await projectRuntime.prepareProjectInitialization(
    request(root, reviewed.digest),
  );

  assert.equal(prepared.schemaVersion, "1.0.0");
  assert.equal(prepared.disposition, "ready");
  assert.equal(prepared.registryDigest, BUILTIN_REGISTRY.digest);
  assert.equal(prepared.initPlanDigest, reviewed.digest);
  assert.equal(prepared.project.rootIdentityDigest, root.identityDigest);
  assert.equal(prepared.project.id, "sample.graybox");
  assert.equal(prepared.project.stage, "vertical-slice");
  assert.equal(prepared.targets.length, 20);
  assert.equal(prepared.targets.every(({ action }) => action === "create"), true);
  assert.equal(prepared.summary.create, 20);
  assert.equal(prepared.summary.retain, 0);
  assert.equal(prepared.summary.conflict, 0);
  assert.equal(prepared.budgets.maxChangedFiles, 20);
  assert.equal(prepared.budgets.maxChangedBytes > 0, true);
  assert.match(prepared.preparedPlanDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.targets), true);
  assert.deepEqual(await readdir(project), []);
  assert.doesNotThrow(() =>
    projectRuntime.assertPreparedProjectInitialization(prepared),
  );
  assert.throws(
    () =>
      projectRuntime.assertPreparedProjectInitialization(
        structuredClone(prepared),
      ),
    /same-process/,
  );
});

test("exact existing metadata prepares a write-free no-op", async (t) => {
  const { project, root } = await fixture(t);
  const selectedProfile = profile();
  await writeExactExistingLayout(project, selectedProfile);
  const before = await readdir(native(project, ".ai-game-playbook"));
  const reviewed = await reviewedPlan(root);

  const prepared = await projectRuntime.prepareProjectInitialization(
    request(root, reviewed.digest, { profile: selectedProfile }),
  );

  assert.equal(prepared.disposition, "no-op");
  assert.equal(prepared.summary.create, 0);
  assert.equal(prepared.summary.retain, 20);
  assert.equal(prepared.budgets.maxChangedFiles, 0);
  assert.equal(prepared.budgets.maxChangedBytes, 0);
  assert.deepEqual(
    await readdir(native(project, ".ai-game-playbook")),
    before,
  );
});

test("preparation blocks retained metadata drift without replacing bytes", async (t) => {
  const { project, root } = await fixture(t);
  const selectedProfile = profile();
  await writeExactExistingLayout(project, selectedProfile);
  const lockPath = native(project, ".ai-game-playbook/packs.lock.json");
  const invalidBytes = '{"schemaVersion":"1.0.0","packs":[]}\n';
  await writeFile(lockPath, invalidBytes);
  const reviewed = await reviewedPlan(root);

  const prepared = await projectRuntime.prepareProjectInitialization(
    request(root, reviewed.digest, { profile: selectedProfile }),
  );

  assert.equal(prepared.disposition, "blocked");
  assert.equal(prepared.summary.conflict, 1);
  assert.deepEqual(prepared.conflicts, [
    {
      code: "metadata-content-invalid",
      path: ".ai-game-playbook/packs.lock.json",
    },
  ]);
  assert.equal(
    prepared.targets.find(
      ({ path }) => path === ".ai-game-playbook/packs.lock.json",
    ).action,
    "conflict",
  );
  assert.equal(
    await (await import("node:fs/promises")).readFile(lockPath, "utf8"),
    invalidBytes,
  );
});

test("preparation rejects stale review digests, invalid profiles, and undeclared input", async (t) => {
  const { root } = await fixture(t);
  const reviewed = await reviewedPlan(root);
  await assert.rejects(
    projectRuntime.prepareProjectInitialization(
      request(root, `sha256:${"f".repeat(64)}`),
    ),
    (error) =>
      error?.name === "ProjectRuntimeError" &&
      error?.code === "project-initialization-plan-stale",
  );
  await assert.rejects(
    projectRuntime.prepareProjectInitialization(
      request(root, reviewed.digest, {
        profile: {
          ...profile(),
          stage: { ...profile().stage, effective: "ambiguous" },
        },
      }),
    ),
    (error) =>
      error?.name === "ProjectRuntimeError" &&
      error?.code === "project-initialization-profile-invalid",
  );
  await assert.rejects(
    projectRuntime.prepareProjectInitialization({
      ...request(root, reviewed.digest),
      sourceRoot: root,
    }),
    (error) =>
      error?.name === "ProjectRuntimeError" &&
      error?.code === "invalid-project-initialization-request",
  );
});

test("preparation rejects accessor-bearing profile input without invoking it", async (t) => {
  const { root } = await fixture(t);
  const reviewed = await reviewedPlan(root);
  let invoked = false;
  const selectedProfile = profile();
  Object.defineProperty(selectedProfile, "teamSize", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });

  await assert.rejects(
    projectRuntime.prepareProjectInitialization(
      request(root, reviewed.digest, { profile: selectedProfile }),
    ),
    (error) =>
      error?.name === "ProjectRuntimeError" &&
      error?.code === "project-initialization-profile-invalid",
  );
  assert.equal(invoked, false);
});
