import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { assertPreparedPackOperation } from "@ai-game-playbook/pack-runtime";
import {
  SkillRuntimeBoundaryError,
  createProjectSkillPlan,
  prepareManagedProjectSkillInstallation,
  prepareProjectSkillMaterialization,
} from "../dist/index.js";

async function fixture(t) {
  const created = await mkdtemp(join(tmpdir(), "agpb-managed-skills-"));
  const sandbox = await realpath(created);
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

async function candidate(project) {
  const plan = await createProjectSkillPlan({ projectRoot: project });
  const materialization = await prepareProjectSkillMaterialization({
    plan,
    runId: randomUUID(),
  });
  return { materialization, plan };
}

function isBoundaryCode(code) {
  return (error) =>
    error instanceof SkillRuntimeBoundaryError && error.code === code;
}

test("managed preflight blocks when the shared skill parent is absent and writes nothing", async (t) => {
  const { project, sandbox } = await fixture(t);
  const before = await readdir(project);
  const { materialization, plan } = await candidate(project);

  const prepared = await prepareManagedProjectSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
  });

  assert.equal(prepared.schemaVersion, "1.0.0");
  assert.equal(prepared.operation, "add");
  assert.equal(prepared.disposition, "conflicted");
  assert.equal(prepared.pack.id, "pack.project-skills");
  assert.equal(prepared.project.id, "sample.graybox");
  assert.deepEqual(prepared.workflow, {
    id: "workflow.pack-add",
    stepId: "step.pack-add",
    projectStage: "vertical-slice",
    resolvedPlanDigest:
      prepared.workflow.resolvedPlanDigest,
  });
  assert.match(prepared.workflow.resolvedPlanDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(prepared.directoryChanges.length, 0);
  assert.equal(prepared.changes.length, 0);
  assert.equal(prepared.conflicts.length, materialization.targets.length);
  assert.equal(
    prepared.conflicts.every(({ code }) => code === "target-parent-missing"),
    true,
  );
  assert.equal(
    prepared.conflicts.every(({ path }) =>
      /^\.agents\/skills\/[a-z0-9-]+$/u.test(path),
    ),
    true,
  );
  assert.doesNotThrow(() => assertPreparedPackOperation(prepared));
  const serialized = JSON.stringify(prepared);
  assert.equal(serialized.includes(project), false);
  assert.equal(serialized.includes(sandbox), false);
  assert.equal(
    plan.targets.every(({ content }) => !serialized.includes(content)),
    true,
  );
  assert.deepEqual(await readdir(project), before);
});

test("managed preflight prepares owned skill directories and artifacts without mutation", async (t) => {
  const { project, sandbox } = await fixture(t);
  await mkdir(join(project, ".agents", "skills"), { recursive: true });
  const before = await readdir(join(project, ".agents", "skills"));
  const { materialization } = await candidate(project);

  const prepared = await prepareManagedProjectSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
  });

  assert.equal(prepared.disposition, "ready");
  assert.equal(prepared.directoryChanges.length, materialization.targets.length);
  assert.equal(
    prepared.directoryChanges.every(({ kind }) => kind === "create"),
    true,
  );
  const skillChanges = prepared.changes.filter(({ path }) =>
    path.endsWith("/SKILL.md"),
  );
  const markerChanges = prepared.changes.filter(({ path }) =>
    path.endsWith("/.agpb-owned"),
  );
  assert.equal(skillChanges.length, materialization.targets.length);
  assert.equal(markerChanges.length, materialization.targets.length);
  assert.equal(skillChanges.every(({ kind }) => kind === "create"), true);
  assert.equal(markerChanges.every(({ kind }) => kind === "create"), true);
  assert.equal(prepared.limits.maxArtifactBytes, 64 * 1024);
  assert.equal(prepared.limits.maxTotalBytes, 8 * 1024 * 1024);
  assert.equal(prepared.limits.maxDirectoryEntries, 10_000);
  assert.doesNotThrow(() => assertPreparedPackOperation(prepared));
  assert.throws(
    () => assertPreparedPackOperation(structuredClone(prepared)),
    (error) => error?.code === "pack-plan-untrusted",
  );
  assert.equal(JSON.stringify(prepared).includes(project), false);
  assert.equal(JSON.stringify(prepared).includes(sandbox), false);
  assert.deepEqual(await readdir(join(project, ".agents", "skills")), before);
  await assert.rejects(
    readFile(join(project, ...materialization.targets[0].targetPath.split("/"))),
    (error) => error?.code === "ENOENT",
  );
});

test("managed preflight never adopts an exact unmanaged skill target", async (t) => {
  const { project } = await fixture(t);
  const first = await candidate(project);
  for (const target of first.plan.targets) {
    const path = join(project, ...target.targetPath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, target.content, "utf8");
  }
  const { materialization } = await candidate(project);
  assert.equal(materialization.disposition, "no-op");

  const prepared = await prepareManagedProjectSkillInstallation({
    materialization,
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
  });

  assert.equal(prepared.disposition, "conflicted");
  assert.equal(prepared.changes.length, 0);
  assert.equal(prepared.directoryChanges.length, 0);
  assert.equal(prepared.conflicts.length, materialization.targets.length);
  assert.equal(
    prepared.conflicts.every(({ code }) => code === "non-owned-target"),
    true,
  );
  for (const target of first.plan.targets) {
    assert.equal(
      await readFile(join(project, ...target.targetPath.split("/")), "utf8"),
      target.content,
    );
  }
});

test("managed preflight rejects detached candidates and invalid project identities", async (t) => {
  const { project } = await fixture(t);
  const { materialization } = await candidate(project);

  await assert.rejects(
    prepareManagedProjectSkillInstallation({
      materialization: structuredClone(materialization),
      projectId: "sample.graybox",
      projectStage: "vertical-slice",
    }),
    isBoundaryCode("skill-runtime-materialization-plan-invalid"),
  );
  await assert.rejects(
    prepareManagedProjectSkillInstallation({
      materialization,
      projectId: "Not Valid",
      projectStage: "vertical-slice",
    }),
    isBoundaryCode("skill-runtime-managed-install-request-invalid"),
  );
  await assert.rejects(
    prepareManagedProjectSkillInstallation({
      materialization,
      projectId: "sample.graybox",
      projectStage: "production",
    }),
    isBoundaryCode("skill-runtime-managed-install-request-invalid"),
  );
  await assert.rejects(
    prepareManagedProjectSkillInstallation({
      materialization,
      projectId: "sample.graybox",
      projectStage: "vertical-slice",
      extra: true,
    }),
    isBoundaryCode("skill-runtime-managed-install-request-invalid"),
  );

  let getterCalls = 0;
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, "materialization", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return materialization;
    },
  });
  Object.defineProperty(accessorRequest, "projectId", {
    enumerable: true,
    value: "sample.graybox",
  });
  Object.defineProperty(accessorRequest, "projectStage", {
    enumerable: true,
    value: "vertical-slice",
  });
  await assert.rejects(
    prepareManagedProjectSkillInstallation(accessorRequest),
    isBoundaryCode("skill-runtime-managed-install-request-invalid"),
  );
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxiedRequest = new Proxy(
    {
      materialization,
      projectId: "sample.graybox",
      projectStage: "vertical-slice",
    },
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
    prepareManagedProjectSkillInstallation(proxiedRequest),
    isBoundaryCode("skill-runtime-managed-install-request-invalid"),
  );
  assert.equal(proxyTraps, 0);
});

test("managed preflight rejects project identity drift before pack inspection", async (t) => {
  const { project, sandbox } = await fixture(t);
  await mkdir(join(project, ".agents", "skills"), { recursive: true });
  const { materialization } = await candidate(project);
  await rename(project, join(sandbox, "moved-project"));
  await mkdir(project);

  await assert.rejects(
    prepareManagedProjectSkillInstallation({
      materialization,
      projectId: "sample.graybox",
      projectStage: "vertical-slice",
    }),
    isBoundaryCode("skill-runtime-runtime-drift"),
  );
});
