import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as core from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-init-plan-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
    sandbox,
  };
}

function nativePath(project, portablePath) {
  return join(project, ...portablePath.split("/"));
}

test("initialization planning reports the fixed layout without writing", async (t) => {
  assert.equal(typeof core.planProjectInitialization, "function");
  assert.equal(core.PROJECT_INITIALIZATION_TARGETS.length, 22);
  assert.equal(Object.isFrozen(core.PROJECT_INITIALIZATION_TARGETS), true);

  const { project, root } = await fixture(t);
  const before = await readdir(project);
  const plan = await core.planProjectInitialization({ root });
  const after = await readdir(project);

  assert.deepEqual(before, []);
  assert.deepEqual(after, []);
  assert.equal(plan.schemaVersion, "1.0.0");
  assert.equal(plan.rootIdentityDigest, root.identityDigest);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.targets), true);
  assert.equal(Object.isFrozen(plan.issues), true);
  assert.equal(plan.targets.length, 22);
  assert.equal(plan.targets.every(({ action }) => action === "create"), true);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(
    plan.targets.map(({ path, kind, policy, content }) => ({
      path,
      kind,
      policy,
      content,
    })),
    core.PROJECT_INITIALIZATION_TARGETS,
  );
  assert.deepEqual(
    core.PROJECT_INITIALIZATION_TARGETS
      .filter(({ path }) => path.startsWith(".ai-game-playbook/evidence"))
      .map(({ path }) => path),
    [
      ".ai-game-playbook/evidence",
      ".ai-game-playbook/evidence/artifacts",
      ".ai-game-playbook/evidence/artifacts/manifests",
      ".ai-game-playbook/evidence/artifacts/objects",
      ".ai-game-playbook/evidence/receipts",
    ],
  );
  assert.deepEqual(
    core.PROJECT_INITIALIZATION_TARGETS
      .filter(({ path }) => path === ".agents" || path.startsWith(".agents/"))
      .map(({ path, kind, policy, content }) => ({
        path,
        kind,
        policy,
        content,
      })),
    [
      {
        path: ".agents",
        kind: "directory",
        policy: "committed",
        content: "none",
      },
      {
        path: ".agents/skills",
        kind: "directory",
        policy: "committed",
        content: "none",
      },
    ],
  );
  await assert.rejects(lstat(join(project, ".ai-game-playbook")), {
    code: "ENOENT",
  });
  await assert.rejects(lstat(join(project, ".agents")), { code: "ENOENT" });
});

test("initialization planning retains an existing type-correct layout", async (t) => {
  const { project, root } = await fixture(t);
  for (const target of core.PROJECT_INITIALIZATION_TARGETS) {
    const path = nativePath(project, target.path);
    if (target.kind === "directory") {
      await mkdir(path, { recursive: true });
    } else {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, `${target.content}\n`);
    }
  }
  const before = await readdir(join(project, ".ai-game-playbook"));

  const plan = await core.planProjectInitialization({ root });

  assert.equal(plan.targets.every(({ action }) => action === "retain"), true);
  assert.equal(plan.targets.every(({ code }) => code === "target-ready"), true);
  assert.deepEqual(plan.issues, []);
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook")),
    before,
  );
});

test("initialization planning preserves and reports files, case aliases, and links", async (t) => {
  const fileFixture = await fixture(t);
  await mkdir(join(fileFixture.project, ".ai-game-playbook"));
  await writeFile(
    join(fileFixture.project, ".ai-game-playbook", "policies"),
    "user-owned\n",
  );
  const filePlan = await core.planProjectInitialization({
    root: fileFixture.root,
  });
  const policies = filePlan.targets.find(
    ({ path }) => path === ".ai-game-playbook/policies",
  );
  assert.equal(policies.action, "conflict");
  assert.equal(policies.code, "project-path-type-mismatch");
  assert.equal(filePlan.issues.length, 1);

  const caseFixture = await fixture(t);
  await mkdir(join(caseFixture.project, ".AI-GAME-PLAYBOOK"));
  const casePlan = await core.planProjectInitialization({
    root: caseFixture.root,
  });
  assert.equal(casePlan.targets[0].action, "conflict");
  assert.equal(casePlan.targets[0].code, "project-path-case-conflict");
  assert.equal(
    casePlan.targets
      .filter(({ path }) => path.startsWith(".ai-game-playbook/"))
      .every(({ code }) => code === "parent-conflict"),
    true,
  );
  assert.equal(
    casePlan.targets
      .filter(({ path }) => path === ".agents" || path.startsWith(".agents/"))
      .every(({ action }) => action === "create"),
    true,
  );
  assert.deepEqual(await readdir(caseFixture.project), [".AI-GAME-PLAYBOOK"]);

  const linkFixture = await fixture(t);
  const outside = join(linkFixture.sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(linkFixture.project, ".ai-game-playbook"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const linkPlan = await core.planProjectInitialization({
    root: linkFixture.root,
  });
  assert.equal(linkPlan.targets[0].action, "conflict");
  assert.equal(linkPlan.targets[0].code, "project-path-link");
  assert.deepEqual(await readdir(outside), []);

  const sharedParentFixture = await fixture(t);
  await writeFile(join(sharedParentFixture.project, ".agents"), "user-owned\n");
  const sharedParentPlan = await core.planProjectInitialization({
    root: sharedParentFixture.root,
  });
  assert.equal(
    sharedParentPlan.targets.find(({ path }) => path === ".agents").code,
    "project-path-type-mismatch",
  );
  assert.equal(
    sharedParentPlan.targets.find(({ path }) => path === ".agents/skills")
      .code,
    "parent-conflict",
  );
  assert.equal(
    await readFile(join(sharedParentFixture.project, ".agents"), "utf8"),
    "user-owned\n",
  );
});

test("initialization planning rejects malformed authority and forged roots", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(
    core.planProjectInitialization({ root, target: ".ai-game-playbook" }),
    (error) =>
      error?.name === "CoreBoundaryError" &&
      error?.code === "invalid-project-initialization-plan-request",
  );
  await assert.rejects(
    core.planProjectInitialization({ root: structuredClone(root) }),
    (error) =>
      error?.name === "CoreBoundaryError" && error?.code === "invalid-project-root",
  );
});
