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
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BUILTIN_REGISTRY_SURFACES } from "@ai-game-playbook/registry";

import {
  CODEX_CONFIG_MAX_BYTES,
  CODEX_CONFIG_PATH,
  CODEX_MCP_ENTRY_MAX_BYTES,
  CodexSetupBoundaryError,
  assertCodexProjectSetupPlan,
  createCodexProjectSetupPlan,
  inspectCodexProjectSetup,
} from "../dist/index.js";
import {
  runtimeEntryMatches,
  snapshotRuntimeEntry,
} from "../dist/runtime-entry.js";

const mcpEntryPoint = fileURLToPath(
  new URL("../../mcp/dist/bin.js", import.meta.url),
);

async function fixture(t) {
  const createdSandbox = await mkdtemp(join(tmpdir(), "agpb-codex-setup-"));
  const sandbox = await realpath(createdSandbox);
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

async function createPlan(project) {
  return createCodexProjectSetupPlan({
    projectRoot: project,
    enabledTools: ["agpb_project__inspect", "agpb_doctor"],
    allowHostDisclosure: true,
  });
}

test("setup planning emits one deterministic local-only config without writing", async (t) => {
  const { project } = await fixture(t);
  const before = await readdir(project);

  const plan = await createPlan(project);

  assert.deepEqual(await readdir(project), before);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.project), true);
  assert.equal(Object.isFrozen(plan.runtime), true);
  assert.equal(Object.isFrozen(plan.host), true);
  assert.equal(Object.isFrozen(plan.host.enabledTools), true);
  assert.equal(Object.isFrozen(plan.target), true);
  assert.equal(Object.isFrozen(plan.skillTargets), true);
  assert.equal(plan.schemaVersion, "1.0.0");
  assert.match(plan.planDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan.target.path, CODEX_CONFIG_PATH);
  assert.equal(plan.target.policy, "local-only");
  assert.equal(plan.target.maxBytes, CODEX_CONFIG_MAX_BYTES);
  assert.match(plan.target.contentDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(plan.target.content.endsWith("\n"), true);
  assert.equal(plan.target.content.includes("\r"), false);
  assert.equal(plan.mutationPerformed, false);
  assert.deepEqual(plan.host.enabledTools, [
    "agpb_doctor",
    "agpb_project__inspect",
  ]);
  assert.equal(plan.host.defaultToolsApprovalMode, "prompt");
  assert.equal(plan.host.projectTrustRequired, true);
  assert.equal(plan.host.disclosureAcknowledged, true);
  assert.equal(plan.runtime.nodeExecutable, await realpath(process.execPath));
  assert.equal(plan.runtime.nodeVersion, process.versions.node);
  assert.equal(plan.runtime.mcpEntryPoint, await realpath(mcpEntryPoint));
  assert.match(plan.target.content, /\[mcp_servers\.ai_game_playbook\]/u);
  assert.match(plan.target.content, /default_tools_approval_mode = "prompt"/u);
  assert.match(plan.target.content, /--allow-host-disclosure/u);
  assert.match(plan.target.content, /enabled_tools = \["agpb_doctor", "agpb_project__inspect"\]/u);
  assert.equal(plan.skillTargets.length, 1);
  const skillTarget = plan.skillTargets[0];
  assert.equal(skillTarget.id, "project.inspection");
  assert.equal(skillTarget.name, "project-inspection");
  assert.equal(
    skillTarget.path,
    ".agents/skills/project-inspection/SKILL.md",
  );
  assert.equal(skillTarget.sourcePath, "skills/project-inspection/SKILL.md");
  assert.match(skillTarget.sourceDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(skillTarget.maxBytes, 65_536);
  assert.equal(skillTarget.materialization, "plan-only");
  assert.equal(skillTarget.content.startsWith("---\nname: project-inspection\n"), true);
  assert.equal(skillTarget.content.includes("\r"), false);
  assert.equal(skillTarget.content.endsWith("\n"), true);
  assert.deepEqual(
    plan.skillTargets.map(({ id }) => id),
    BUILTIN_REGISTRY_SURFACES.skills.data.routes.map(({ id }) => id),
  );
});

test("setup plans are same-process capabilities and disclosure is explicit", async (t) => {
  const { project } = await fixture(t);
  const plan = await createPlan(project);

  assert.doesNotThrow(() => assertCodexProjectSetupPlan(plan));
  assert.throws(
    () => assertCodexProjectSetupPlan(structuredClone(plan)),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-plan-invalid",
  );
  await assert.rejects(
    () =>
      createCodexProjectSetupPlan({
        projectRoot: project,
        enabledTools: ["agpb_doctor"],
        allowHostDisclosure: false,
      }),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-disclosure-required",
  );
  await assert.rejects(
    () =>
      createCodexProjectSetupPlan({
        projectRoot: project,
        enabledTools: ["agpb_doctor", "agpb_doctor"],
        allowHostDisclosure: true,
      }),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-options-invalid",
  );
  await assert.rejects(
    () =>
      createCodexProjectSetupPlan({
        projectRoot: project,
        nodeExecutable: process.execPath,
        mcpEntryPoint,
        enabledTools: ["agpb_doctor"],
        allowHostDisclosure: true,
      }),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-options-invalid",
  );
});

test("inspection distinguishes create, retain, and conflict without mutation", async (t) => {
  const { project } = await fixture(t);
  const plan = await createPlan(project);

  const missing = await inspectCodexProjectSetup(plan);
  assert.equal(missing.target.action, "create");
  assert.equal(missing.target.code, "target-missing");
  assert.equal(missing.mutationPerformed, false);
  assert.deepEqual(await readdir(project), []);

  await mkdir(join(project, ".codex"));
  await writeFile(join(project, ".codex", "config.toml"), plan.target.content);
  const current = await inspectCodexProjectSetup(plan);
  assert.equal(current.target.action, "retain");
  assert.equal(current.target.code, "target-current");
  assert.equal(current.target.actualDigest, plan.target.contentDigest);

  await appendFile(join(project, ".codex", "config.toml"), "# user change\n");
  const conflict = await inspectCodexProjectSetup(plan);
  assert.equal(conflict.target.action, "conflict");
  assert.equal(conflict.target.code, "target-content-conflict");
  assert.notEqual(conflict.target.actualDigest, plan.target.contentDigest);
  assert.equal(
    (await readdir(join(project, ".codex"))).join(","),
    "config.toml",
  );

  await writeFile(
    join(project, ".codex", "config.toml"),
    Buffer.alloc(CODEX_CONFIG_MAX_BYTES + 1),
  );
  const oversized = await inspectCodexProjectSetup(plan);
  assert.equal(oversized.target.action, "conflict");
  assert.equal(oversized.target.code, "target-byte-budget-exceeded");
  assert.equal(oversized.target.actualDigest, undefined);
});

test("skill targets are planned and inspected without mutation", async (t) => {
  const { project } = await fixture(t);
  const plan = await createPlan(project);
  const [skillPlan] = plan.skillTargets;

  const missing = await inspectCodexProjectSetup(plan);
  assert.equal(missing.skillTargets.length, 1);
  assert.equal(missing.skillTargets[0].id, "project.inspection");
  assert.equal(missing.skillTargets[0].action, "create");
  assert.equal(missing.skillTargets[0].code, "target-missing");
  assert.deepEqual(await readdir(project), []);

  const skillDirectory = join(
    project,
    ".agents",
    "skills",
    "project-inspection",
  );
  await mkdir(skillDirectory, { recursive: true });
  const skillPath = join(skillDirectory, "SKILL.md");
  await writeFile(skillPath, skillPlan.content);

  const current = await inspectCodexProjectSetup(plan);
  assert.equal(current.skillTargets[0].action, "retain");
  assert.equal(current.skillTargets[0].code, "target-current");
  assert.equal(
    current.skillTargets[0].actualDigest,
    skillPlan.sourceDigest,
  );

  await appendFile(skillPath, "\nUser change.\n");
  const conflict = await inspectCodexProjectSetup(plan);
  assert.equal(conflict.skillTargets[0].action, "conflict");
  assert.equal(conflict.skillTargets[0].code, "target-content-conflict");
  assert.notEqual(
    conflict.skillTargets[0].actualDigest,
    skillPlan.sourceDigest,
  );
  assert.equal(conflict.mutationPerformed, false);

  await writeFile(skillPath, Buffer.alloc(skillPlan.maxBytes + 1));
  const oversized = await inspectCodexProjectSetup(plan);
  assert.equal(oversized.skillTargets[0].action, "conflict");
  assert.equal(oversized.skillTargets[0].code, "target-byte-budget-exceeded");
  assert.equal(oversized.skillTargets[0].actualDigest, undefined);
});

test("unsafe config parents and case aliases fail closed", async (t) => {
  const linked = await fixture(t);
  const linkedPlan = await createPlan(linked.project);
  const outside = join(linked.sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(linked.project, ".codex"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    () => inspectCodexProjectSetup(linkedPlan),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-target-unsafe",
  );
  assert.deepEqual(await readdir(outside), []);

  const aliased = await fixture(t);
  const aliasedPlan = await createPlan(aliased.project);
  await mkdir(join(aliased.project, ".CODEX"));
  await assert.rejects(
    () => inspectCodexProjectSetup(aliasedPlan),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-target-unsafe",
  );

  const skillLinked = await fixture(t);
  const skillLinkedPlan = await createPlan(skillLinked.project);
  const skillOutside = join(skillLinked.sandbox, "skill-outside");
  await mkdir(skillOutside);
  await symlink(
    skillOutside,
    join(skillLinked.project, ".agents"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    () => inspectCodexProjectSetup(skillLinkedPlan),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-target-unsafe",
  );
  assert.deepEqual(await readdir(skillOutside), []);
});

test("runtime entrypoint snapshots detect drift and reject unsafe sizes", async (t) => {
  const { sandbox } = await fixture(t);
  const entryPoint = join(sandbox, "mcp-entry.mjs");
  await writeFile(entryPoint, "export {};\n");
  const before = await snapshotRuntimeEntry(entryPoint);

  await appendFile(entryPoint, "// changed\n");
  const after = await snapshotRuntimeEntry(entryPoint);
  assert.equal(runtimeEntryMatches(before, after), false);

  const oversized = join(sandbox, "oversized-entry.mjs");
  await writeFile(oversized, Buffer.alloc(CODEX_MCP_ENTRY_MAX_BYTES + 1));
  await assert.rejects(
    () => snapshotRuntimeEntry(oversized),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-entrypoint-invalid",
  );

  const empty = join(sandbox, "empty-entry.mjs");
  await writeFile(empty, "");
  await assert.rejects(
    () => snapshotRuntimeEntry(empty),
    (error) =>
      error instanceof CodexSetupBoundaryError &&
      error.code === "codex-setup-entrypoint-invalid",
  );
});
