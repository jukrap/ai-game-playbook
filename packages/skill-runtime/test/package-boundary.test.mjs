import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_REGISTRY_SURFACES } from "../../registry/dist/index.js";

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

test("the packaged skill bytes match the only generated registry route", async () => {
  const routes = BUILTIN_REGISTRY_SURFACES.skills.data.routes;
  assert.equal(routes.length, 1);
  const [route] = routes;
  const content = await readFile(
    new URL("../skills/project-inspection/SKILL.md", import.meta.url),
    "utf8",
  );
  const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;

  assert.equal(route.id, "project.inspection");
  assert.equal(route.body.path, "skills/project-inspection/SKILL.md");
  assert.equal(route.body.digest, digest);
  assert.match(
    content,
    /^---\nname: project-inspection\ndescription: Use when [^\n]+\n---\n/u,
  );
  assert.equal(content.includes("\r"), false);
  assert.equal(content.endsWith("\n"), true);
});
