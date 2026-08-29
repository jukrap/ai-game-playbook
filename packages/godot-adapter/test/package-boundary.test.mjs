import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("the Godot adapter is private and keeps a one-way runtime boundary", async () => {
  const packageJson = await readJson(new URL("../package.json", import.meta.url));
  const tsconfig = await readJson(new URL("../tsconfig.json", import.meta.url));

  assert.equal(packageJson.name, "@ai-game-playbook/godot-adapter");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.deepEqual(packageJson.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
    "@ai-game-playbook/engine-common": "workspace:*",
    "@ai-game-playbook/evidence": "workspace:*",
    "@ai-game-playbook/project-runtime": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
    "@ai-game-playbook/windows-containment-provider": "workspace:*",
  });
  assert.deepEqual(tsconfig.references, [
    { path: "../contracts" },
    { path: "../registry" },
    { path: "../core" },
    { path: "../engine-common" },
    { path: "../evidence" },
    { path: "../project-runtime" },
    { path: "../windows-containment-provider" },
  ]);
});
