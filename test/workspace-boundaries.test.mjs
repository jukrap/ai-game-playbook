import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("workspace packages stay private and follow the foundation dependency direction", async () => {
  const root = await readJson(new URL("../package.json", import.meta.url));
  const contracts = await readJson(
    new URL("../packages/contracts/package.json", import.meta.url),
  );
  const registry = await readJson(
    new URL("../packages/registry/package.json", import.meta.url),
  );

  assert.equal(root.private, true);
  assert.equal(root.license, "UNLICENSED");
  assert.equal(root.packageManager, "pnpm@11.4.0");

  assert.equal(contracts.private, true);
  assert.equal(contracts.license, "UNLICENSED");
  assert.equal(contracts.dependencies, undefined);

  assert.equal(registry.private, true);
  assert.equal(registry.license, "UNLICENSED");
  assert.deepEqual(registry.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
  });
});

test("pnpm workspace enforces deterministic install boundaries", async () => {
  const workspace = await readFile(
    new URL("../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );

  assert.match(workspace, /^autoInstallPeers: false$/m);
  assert.match(workspace, /^disallowWorkspaceCycles: true$/m);
  assert.match(workspace, /^engineStrict: true$/m);
  assert.match(workspace, /^ignoreScripts: true$/m);
  assert.match(workspace, /^preferWorkspacePackages: true$/m);
  assert.match(workspace, /^saveExact: true$/m);
  assert.match(workspace, /^strictPeerDependencies: true$/m);
});

test("package-local compiler paths are not inherited from the root config", async () => {
  const base = await readJson(new URL("../tsconfig.base.json", import.meta.url));
  const contracts = await readJson(
    new URL("../packages/contracts/tsconfig.json", import.meta.url),
  );
  const registry = await readJson(
    new URL("../packages/registry/tsconfig.json", import.meta.url),
  );

  assert.equal(base.compilerOptions.rootDir, undefined);
  assert.equal(contracts.compilerOptions.rootDir, "src");
  assert.equal(registry.compilerOptions.rootDir, "src");
});
