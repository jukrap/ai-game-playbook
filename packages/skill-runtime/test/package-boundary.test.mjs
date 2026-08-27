import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_REGISTRY_SURFACES } from "../../registry/dist/index.js";
import * as skillRuntime from "../dist/index.js";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("the skill runtime is private and keeps a one-way workspace boundary", async () => {
  const root = await readJson(new URL("../../../tsconfig.json", import.meta.url));
  const packageJson = await readJson(new URL("../package.json", import.meta.url));
  const tsconfig = await readJson(new URL("../tsconfig.json", import.meta.url));

  assert.equal(packageJson.name, "@ai-game-playbook/skill-runtime");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.deepEqual(packageJson.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
  });
  assert.deepEqual(packageJson.files, ["dist", "skills"]);
  assert.deepEqual(tsconfig.references, [
    { path: "../contracts" },
    { path: "../registry" },
    { path: "../core" },
  ]);
  assert.equal(
    root.references.some(({ path }) => path === "./packages/skill-runtime"),
    true,
  );
});

test("the skill runtime exposes preparation but no materialization executor", () => {
  assert.deepEqual(Object.keys(skillRuntime).sort(), [
    "SKILL_MATERIALIZATION_MAX_DURATION_MS",
    "SKILL_MATERIALIZATION_MAX_OUTPUT_BYTES",
    "SkillRuntimeBoundaryError",
    "assertPreparedProjectSkillMaterialization",
    "assertProjectSkillPlan",
    "createProjectSkillPlan",
    "inspectProjectSkillTargets",
    "prepareProjectSkillMaterialization",
  ]);
  assert.equal("executeProjectSkillMaterialization" in skillRuntime, false);
  assert.equal("installProjectSkills" in skillRuntime, false);
});

test("the packaged skill bytes match every generated registry route", async () => {
  const routes = BUILTIN_REGISTRY_SURFACES.skills.data.routes;
  assert.deepEqual(
    routes.map(({ id }) => id),
    [
      "asset.lifecycle",
      "balance.deterministic-review",
      "build.export-readiness",
      "engine.change-safety",
      "evidence.support-review",
      "feature.contract-planning",
      "gameplay.vertical-slice",
      "performance.budget-review",
      "playtest.deterministic",
      "project.inspection",
      "save-load.integrity",
      "ui.game-qa",
    ],
  );
  for (const route of routes) {
    const name = route.body.path.split("/")[1];
    const content = await readFile(
      new URL(`../${route.body.path}`, import.meta.url),
      "utf8",
    );
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;

    assert.equal(route.body.digest, digest);
    assert.match(
      content,
      new RegExp(`^---\\nname: ${name}\\ndescription: Use when [^\\n]+\\n---\\n`, "u"),
    );
    assert.equal(content.includes("\r"), false);
    assert.equal(content.endsWith("\n"), true);
  }
});
