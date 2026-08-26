import assert from "node:assert/strict";
import {
  appendFile,
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

import {
  runSkillCheck,
  runSkillList,
} from "../dist/index.js";

const skillContent = await readFile(
  new URL(
    "../../skill-runtime/skills/project-inspection/SKILL.md",
    import.meta.url,
  ),
  "utf8",
);

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-skill-command-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

const request = (projectRoot) => ({
  schemaVersion: "1.0.0",
  projectRoot,
});

test("skill list exposes a bounded registry catalog without artifact bodies or writes", async (t) => {
  const { project } = await fixture(t);
  const before = await readdir(project);

  const report = await runSkillList(request(project));

  assert.equal(report.commandId, "skill.list");
  assert.equal(report.status, "ready");
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0].id, "project.inspection");
  assert.equal(report.entries[0].artifactPath, "skills/project-inspection/SKILL.md");
  assert.equal(
    report.entries[0].targetPath,
    ".agents/skills/project-inspection/SKILL.md",
  );
  assert.equal("content" in report.entries[0], false);
  assert.equal("sourcePath" in report.entries[0], false);
  assert.match(report.catalogDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(report.summary, {
    registered: 1,
    modelInvoked: 1,
    userInvoked: 0,
  });
  assert.equal(report.materializationAvailable, false);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.networkAccessPerformed, false);
  assert.deepEqual(await readdir(project), before);
});

test("skill check distinguishes missing, current, content conflict, and byte overflow", async (t) => {
  const { project } = await fixture(t);

  const missing = await runSkillCheck(request(project));
  assert.equal(missing.status, "attention");
  assert.equal(missing.checks[0].targetStatus, "missing");
  assert.equal(missing.checks[0].code, "skill-target-missing");

  const directory = join(project, ".agents", "skills", "project-inspection");
  const target = join(directory, "SKILL.md");
  await mkdir(directory, { recursive: true });
  await writeFile(target, skillContent);

  const current = await runSkillCheck(request(project));
  assert.equal(current.status, "ready");
  assert.equal(current.checks[0].targetStatus, "current");
  assert.equal(current.checks[0].actualDigest, current.checks[0].artifactDigest);

  await appendFile(target, "User change.\n");
  const conflict = await runSkillCheck(request(project));
  assert.equal(conflict.status, "blocked");
  assert.equal(conflict.checks[0].targetStatus, "conflict");
  assert.equal(conflict.checks[0].code, "skill-target-content-conflict");

  await writeFile(target, Buffer.alloc(65_537));
  const oversized = await runSkillCheck(request(project));
  assert.equal(oversized.status, "blocked");
  assert.equal(
    oversized.checks[0].code,
    "skill-target-byte-budget-exceeded",
  );
  assert.equal(oversized.checks[0].actualDigest, undefined);
  assert.equal(oversized.materializationPerformed, false);
  assert.equal(oversized.mutationPerformed, false);
});

test("skill check reports linked target parents as blocked without following them", async (t) => {
  const { project, sandbox } = await fixture(t);
  const outside = join(sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(project, ".agents"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const report = await runSkillCheck(request(project));

  assert.equal(report.status, "blocked");
  assert.equal(report.checks[0].targetStatus, "unsafe");
  assert.equal(report.checks[0].code, "skill-target-unsafe");
  assert.deepEqual(await readdir(outside), []);
});

test("skill commands preserve an unavailable project as a validated blocked report", async (t) => {
  const { project } = await fixture(t);
  await rm(project, { recursive: true });

  const listed = await runSkillList(request(project));
  const checked = await runSkillCheck(request(project));

  assert.equal(listed.status, "blocked");
  assert.deepEqual(listed.entries, []);
  assert.equal(listed.catalogDigest, undefined);
  assert.equal(listed.issues[0].code, "skill-project-unavailable");
  assert.equal(checked.status, "blocked");
  assert.deepEqual(checked.checks, []);
  assert.equal(checked.checkDigest, undefined);
  assert.equal(checked.issues[0].code, "skill-project-unavailable");
});
