import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SkillRuntimeBoundaryError,
  assertProjectSkillPlan,
  createProjectSkillPlan,
  inspectProjectSkillTargets,
} from "../dist/index.js";

async function fixture(t) {
  const created = await mkdtemp(join(tmpdir(), "agpb-skill-runtime-"));
  const sandbox = await realpath(created);
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

test("project skill plans bind one packaged registry artifact without writes", async (t) => {
  const { project } = await fixture(t);
  const before = await readdir(project);

  const plan = await createProjectSkillPlan({ projectRoot: project });

  assert.deepEqual(await readdir(project), before);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.catalog), true);
  assert.equal(Object.isFrozen(plan.targets), true);
  assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan.project.canonicalPath, await realpath(project));
  assert.match(plan.project.identityDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan.catalog.length, 1);
  assert.equal(plan.catalog[0].id, "project.inspection");
  assert.equal(plan.catalog[0].name, "project-inspection");
  assert.deepEqual(plan.catalog[0].capabilities, [
    "engine.capabilities",
    "project.inspect",
  ]);
  assert.equal(
    plan.catalog[0].targetPath,
    ".agents/skills/project-inspection/SKILL.md",
  );
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].id, plan.catalog[0].id);
  assert.equal(plan.targets[0].artifactDigest, plan.catalog[0].artifactDigest);
  assert.equal(plan.targets[0].content.startsWith("---\nname: project-inspection\n"), true);
  assert.equal(plan.targets[0].content.includes("\r"), false);
  assert.equal(plan.targets[0].content.endsWith("\n"), true);
  assert.match(plan.targets[0].content, /engine\.capabilities/u);
  assert.equal(plan.targets[0].maxBytes, 65_536);
  assert.equal(plan.targets[0].materialization, "plan-only");
  assert.equal(plan.mutationPerformed, false);
  assert.doesNotThrow(() => assertProjectSkillPlan(plan));
  assert.throws(
    () => assertProjectSkillPlan(structuredClone(plan)),
    (error) =>
      error instanceof SkillRuntimeBoundaryError &&
      error.code === "skill-runtime-plan-invalid",
  );
});
test("target inspection distinguishes missing, current, and conflicts without mutation", async (t) => {
  const { project } = await fixture(t);
  const plan = await createProjectSkillPlan({ projectRoot: project });
  const [target] = plan.targets;

  const missing = await inspectProjectSkillTargets(plan);
  assert.equal(missing.checks[0].targetStatus, "missing");
  assert.equal(missing.checks[0].code, "skill-target-missing");
  assert.equal(missing.mutationPerformed, false);
  assert.deepEqual(await readdir(project), []);

  const directory = join(project, ".agents", "skills", target.name);
  await mkdir(directory, { recursive: true });
  const targetFile = join(directory, "SKILL.md");
  await writeFile(targetFile, target.content);

  const current = await inspectProjectSkillTargets(plan);
  assert.equal(current.checks[0].targetStatus, "current");
  assert.equal(current.checks[0].code, "skill-target-current");
  assert.equal(current.checks[0].actualDigest, target.artifactDigest);
  assert.equal(current.checks[0].bytes, Buffer.byteLength(target.content));

  await appendFile(targetFile, "User change.\n");
  const changed = await inspectProjectSkillTargets(plan);
  assert.equal(changed.checks[0].targetStatus, "conflict");
  assert.equal(changed.checks[0].code, "skill-target-content-conflict");
  assert.notEqual(changed.checks[0].actualDigest, target.artifactDigest);

  await writeFile(targetFile, Buffer.alloc(target.maxBytes + 1));
  const oversized = await inspectProjectSkillTargets(plan);
  assert.equal(oversized.checks[0].targetStatus, "conflict");
  assert.equal(
    oversized.checks[0].code,
    "skill-target-byte-budget-exceeded",
  );
  assert.equal(oversized.checks[0].actualDigest, undefined);
  assert.equal(oversized.checks[0].bytes, undefined);
});

test("linked and case-aliased target parents are unsafe and never followed", async (t) => {
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

  const linkedResult = await inspectProjectSkillTargets(linkedPlan);
  assert.equal(linkedResult.checks[0].targetStatus, "unsafe");
  assert.equal(linkedResult.checks[0].code, "skill-target-unsafe");
  assert.deepEqual(await readdir(outside), []);

  const aliased = await fixture(t);
  const aliasedPlan = await createProjectSkillPlan({
    projectRoot: aliased.project,
  });
  await mkdir(join(aliased.project, ".AGENTS"));
  const aliasedResult = await inspectProjectSkillTargets(aliasedPlan);
  assert.equal(aliasedResult.checks[0].targetStatus, "unsafe");
  assert.equal(aliasedResult.checks[0].code, "skill-target-unsafe");
});
