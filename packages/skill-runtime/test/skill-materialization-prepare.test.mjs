import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  SkillRuntimeBoundaryError,
  assertPreparedProjectSkillMaterialization,
  createProjectSkillPlan,
  prepareProjectSkillMaterialization,
} from "../dist/index.js";

async function fixture(t) {
  const created = await mkdtemp(join(tmpdir(), "agpb-skill-prepare-"));
  const sandbox = await realpath(created);
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

async function installFixtureSkills(project, sourcePlan) {
  for (const target of sourcePlan.targets) {
    const path = join(project, ...target.targetPath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, target.content);
  }
}

function isBoundaryCode(code) {
  return (error) =>
    error instanceof SkillRuntimeBoundaryError && error.code === code;
}

test("prepares a bounded write-free materialization plan for missing skill targets", async (t) => {
  const { project, sandbox } = await fixture(t);
  const before = await readdir(project);
  const sourcePlan = await createProjectSkillPlan({ projectRoot: project });
  const runId = randomUUID();
  const expectedBytes = sourcePlan.targets.reduce(
    (total, target) => total + Buffer.byteLength(target.content, "utf8"),
    0,
  );
  const expectedTargetCount = sourcePlan.targets.length;
  const expectedDirectoryCount = expectedTargetCount + 2;

  const prepared = await prepareProjectSkillMaterialization({
    plan: sourcePlan,
    runId,
  });

  assert.equal(prepared.schemaVersion, "1.0.0");
  assert.equal(prepared.runId, runId);
  assert.equal(prepared.sourcePlanDigest, sourcePlan.planDigest);
  assert.equal(
    prepared.projectIdentityDigest,
    sourcePlan.project.identityDigest,
  );
  assert.equal(prepared.disposition, "ready");
  assert.equal(prepared.directories.length, expectedDirectoryCount);
  assert.equal(prepared.targets.length, expectedTargetCount);
  assert.deepEqual(prepared.directories.map(({ path }) => path), [
    ".agents",
    ".agents/skills",
    ...sourcePlan.targets.map(({ name }) => `.agents/skills/${name}`),
  ]);
  assert.equal(prepared.directories.every(({ action }) => action === "create"), true);
  assert.equal(prepared.targets.every(({ action }) => action === "create"), true);
  assert.deepEqual(prepared.summary, {
    createDirectories: expectedDirectoryCount,
    retainDirectories: 0,
    createFiles: expectedTargetCount,
    retainFiles: 0,
    conflicts: 0,
  });
  assert.deepEqual(prepared.budgets, {
    maxChangedFiles: expectedTargetCount,
    maxChangedBytes: expectedBytes * 2,
    maxDurationMs: 30_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  });
  assert.deepEqual(prepared.conflicts, []);
  assert.match(prepared.preparedDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(prepared.mutationPerformed, false);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.directories), true);
  assert.equal(Object.isFrozen(prepared.targets), true);
  for (const target of prepared.targets) {
    assert.equal(Object.hasOwn(target, "content"), false);
    assert.equal(Object.hasOwn(target, "sourcePath"), false);
    assert.equal(Object.hasOwn(target, "artifactPath"), false);
  }
  assert.equal(JSON.stringify(prepared).includes(project), false);
  assert.equal(JSON.stringify(prepared).includes(sandbox), false);
  assert.doesNotThrow(() =>
    assertPreparedProjectSkillMaterialization(prepared),
  );
  assert.throws(
    () => assertPreparedProjectSkillMaterialization(structuredClone(prepared)),
    (error) =>
      error instanceof SkillRuntimeBoundaryError &&
      error.code === "skill-runtime-materialization-plan-invalid",
  );
  assert.deepEqual(await readdir(project), before);
});

test("preparation reports an exact installation as a zero-budget no-op", async (t) => {
  const { project } = await fixture(t);
  const sourcePlan = await createProjectSkillPlan({ projectRoot: project });
  await installFixtureSkills(project, sourcePlan);
  const expectedTargetCount = sourcePlan.targets.length;
  const expectedDirectoryCount = expectedTargetCount + 2;

  const prepared = await prepareProjectSkillMaterialization({
    plan: sourcePlan,
    runId: randomUUID(),
  });

  assert.equal(prepared.disposition, "no-op");
  assert.equal(prepared.directories.length, expectedDirectoryCount);
  assert.equal(prepared.targets.length, expectedTargetCount);
  assert.equal(prepared.directories.every(({ action }) => action === "retain"), true);
  assert.equal(prepared.targets.every(({ action }) => action === "retain"), true);
  assert.deepEqual(prepared.summary, {
    createDirectories: 0,
    retainDirectories: expectedDirectoryCount,
    createFiles: 0,
    retainFiles: expectedTargetCount,
    conflicts: 0,
  });
  assert.equal(prepared.budgets.maxChangedFiles, 0);
  assert.equal(prepared.budgets.maxChangedBytes, 0);
  assert.deepEqual(prepared.conflicts, []);
  assert.equal(prepared.mutationPerformed, false);
});

test("preparation blocks on user-modified and oversized skill files", async (t) => {
  const changed = await fixture(t);
  const changedPlan = await createProjectSkillPlan({
    projectRoot: changed.project,
  });
  await installFixtureSkills(changed.project, changedPlan);
  const changedTarget = changedPlan.targets[0];
  await appendFile(
    join(changed.project, ...changedTarget.targetPath.split("/")),
    "User change.\n",
  );

  const changedPrepared = await prepareProjectSkillMaterialization({
    plan: changedPlan,
    runId: randomUUID(),
  });

  assert.equal(changedPrepared.disposition, "blocked");
  assert.equal(changedPrepared.summary.conflicts, 1);
  assert.deepEqual(changedPrepared.conflicts, [
    {
      path: changedTarget.targetPath,
      code: "skill-target-content-conflict",
      id: changedTarget.id,
    },
  ]);
  assert.equal(changedPrepared.budgets.maxChangedFiles, 0);
  assert.equal(changedPrepared.budgets.maxChangedBytes, 0);

  const oversized = await fixture(t);
  const oversizedPlan = await createProjectSkillPlan({
    projectRoot: oversized.project,
  });
  await installFixtureSkills(oversized.project, oversizedPlan);
  const oversizedTarget = oversizedPlan.targets[0];
  await writeFile(
    join(oversized.project, ...oversizedTarget.targetPath.split("/")),
    Buffer.alloc(oversizedTarget.maxBytes + 1),
  );

  const oversizedPrepared = await prepareProjectSkillMaterialization({
    plan: oversizedPlan,
    runId: randomUUID(),
  });

  assert.equal(oversizedPrepared.disposition, "blocked");
  assert.equal(
    oversizedPrepared.conflicts.some(
      ({ code, path }) =>
        code === "skill-target-byte-budget-exceeded" &&
        path === oversizedTarget.targetPath,
    ),
    true,
  );
});

test("unsafe parent topology blocks preparation without following it", async (t) => {
  const linked = await fixture(t);
  const linkedPlan = await createProjectSkillPlan({
    projectRoot: linked.project,
  });
  const outside = join(linked.sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(linked.project, ".agents"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const linkedPrepared = await prepareProjectSkillMaterialization({
    plan: linkedPlan,
    runId: randomUUID(),
  });

  assert.equal(linkedPrepared.disposition, "blocked");
  assert.equal(linkedPrepared.directories.every(({ action }) => action === "conflict"), true);
  assert.equal(linkedPrepared.targets.every(({ action }) => action === "conflict"), true);
  assert.deepEqual(await readdir(outside), []);

  const aliased = await fixture(t);
  const aliasedPlan = await createProjectSkillPlan({
    projectRoot: aliased.project,
  });
  await mkdir(join(aliased.project, ".AGENTS"));

  const aliasedPrepared = await prepareProjectSkillMaterialization({
    plan: aliasedPlan,
    runId: randomUUID(),
  });

  assert.equal(aliasedPrepared.disposition, "blocked");
  assert.equal(aliasedPrepared.conflicts[0].path, ".agents");
  assert.equal(aliasedPrepared.conflicts[0].code, "skill-directory-unsafe");

  const typed = await fixture(t);
  const typedPlan = await createProjectSkillPlan({
    projectRoot: typed.project,
  });
  await writeFile(join(typed.project, ".agents"), "not a directory\n");

  const typedPrepared = await prepareProjectSkillMaterialization({
    plan: typedPlan,
    runId: randomUUID(),
  });

  assert.equal(typedPrepared.disposition, "blocked");
  assert.equal(typedPrepared.conflicts[0].path, ".agents");
  assert.equal(typedPrepared.conflicts[0].code, "skill-directory-unsafe");
});

test("request validation rejects clones, accessors, proxies, extras, and malformed run IDs", async (t) => {
  const { project } = await fixture(t);
  const sourcePlan = await createProjectSkillPlan({ projectRoot: project });
  const runId = randomUUID();

  await assert.rejects(
    prepareProjectSkillMaterialization({
      plan: structuredClone(sourcePlan),
      runId,
    }),
    isBoundaryCode("skill-runtime-plan-invalid"),
  );
  await assert.rejects(
    prepareProjectSkillMaterialization({ plan: sourcePlan, runId: "not-a-uuid" }),
    isBoundaryCode("skill-runtime-materialization-request-invalid"),
  );
  await assert.rejects(
    prepareProjectSkillMaterialization({
      plan: sourcePlan,
      runId,
      extra: true,
    }),
    isBoundaryCode("skill-runtime-materialization-request-invalid"),
  );

  const symbolRequest = { plan: sourcePlan, runId };
  symbolRequest[Symbol("unexpected")] = true;
  await assert.rejects(
    prepareProjectSkillMaterialization(symbolRequest),
    isBoundaryCode("skill-runtime-materialization-request-invalid"),
  );

  let getterCalls = 0;
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, "plan", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return sourcePlan;
    },
  });
  Object.defineProperty(accessorRequest, "runId", {
    enumerable: true,
    value: runId,
  });
  await assert.rejects(
    prepareProjectSkillMaterialization(accessorRequest),
    isBoundaryCode("skill-runtime-materialization-request-invalid"),
  );
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxiedRequest = new Proxy(
    { plan: sourcePlan, runId },
    {
      getPrototypeOf(target) {
        proxyTraps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTraps += 1;
        return Reflect.ownKeys(target);
      },
    },
  );
  await assert.rejects(
    prepareProjectSkillMaterialization(proxiedRequest),
    isBoundaryCode("skill-runtime-materialization-request-invalid"),
  );
  assert.equal(proxyTraps, 0);
});

test("project identity changes during preparation invalidate the plan", async (t) => {
  const { project, sandbox } = await fixture(t);
  const sourcePlan = await createProjectSkillPlan({ projectRoot: project });
  const preparation = assert.rejects(
    prepareProjectSkillMaterialization({
      plan: sourcePlan,
      runId: randomUUID(),
    }),
    isBoundaryCode("skill-runtime-runtime-drift"),
  );
  await rename(project, join(sandbox, "moved-project"));
  await mkdir(project);

  await preparation;
});
