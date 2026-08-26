import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("the Codex adapter is private and keeps a one-way workspace boundary", async () => {
  const root = await readJson(new URL("../../../tsconfig.json", import.meta.url));
  const packageJson = await readJson(
    new URL("../package.json", import.meta.url),
  );
  const tsconfig = await readJson(new URL("../tsconfig.json", import.meta.url));

  assert.equal(packageJson.name, "@ai-game-playbook/codex-adapter");
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.deepEqual(packageJson.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
    "@ai-game-playbook/mcp": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
  });
  assert.deepEqual(packageJson.exports, {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js",
    },
  });
  assert.deepEqual(tsconfig.references, [
    { path: "../contracts" },
    { path: "../registry" },
    { path: "../core" },
    { path: "../mcp" },
  ]);
  assert.equal(
    root.references.some(({ path }) => path === "./packages/codex-adapter"),
    true,
  );
});
