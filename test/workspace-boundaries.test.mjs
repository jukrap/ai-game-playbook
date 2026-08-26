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
  const core = await readJson(
    new URL("../packages/core/package.json", import.meta.url),
  );
  const evidence = await readJson(
    new URL("../packages/evidence/package.json", import.meta.url),
  );
  const packRuntime = await readJson(
    new URL("../packages/pack-runtime/package.json", import.meta.url),
  );
  const cli = await readJson(
    new URL("../packages/cli/package.json", import.meta.url),
  );

  assert.equal(root.private, true);
  assert.equal(root.license, "UNLICENSED");
  assert.equal(
    root.packageManager,
    "pnpm@11.4.0+sha512.f0febc7e37552ab485494a914241b338e0b3580b93d54ce31f00933015880863129038a1b4ae4e414a0ee63ac35bf21197e990172c4a68256450b5636310968f",
  );
  assert.deepEqual(root.bin, { agpb: "./packages/cli/dist/bin.js" });

  assert.equal(contracts.private, true);
  assert.equal(contracts.license, "UNLICENSED");
  assert.equal(contracts.dependencies, undefined);

  assert.equal(registry.private, true);
  assert.equal(registry.license, "UNLICENSED");
  assert.deepEqual(registry.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    ajv: "catalog:",
    "ajv-formats": "catalog:",
  });
  assert.equal(core.private, true);
  assert.equal(core.license, "UNLICENSED");
  assert.deepEqual(core.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
  });
  assert.equal(evidence.private, true);
  assert.equal(evidence.license, "UNLICENSED");
  assert.deepEqual(evidence.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
  });
  assert.equal(packRuntime.private, true);
  assert.equal(packRuntime.license, "UNLICENSED");
  assert.deepEqual(packRuntime.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
  });
  assert.equal(cli.private, true);
  assert.equal(cli.license, "UNLICENSED");
  assert.deepEqual(cli.bin, { agpb: "./dist/bin.js" });
  assert.deepEqual(cli.dependencies, {
    "@ai-game-playbook/contracts": "workspace:*",
    "@ai-game-playbook/core": "workspace:*",
    "@ai-game-playbook/pack-runtime": "workspace:*",
    "@ai-game-playbook/registry": "workspace:*",
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
  const core = await readJson(
    new URL("../packages/core/tsconfig.json", import.meta.url),
  );
  const evidence = await readJson(
    new URL("../packages/evidence/tsconfig.json", import.meta.url),
  );
  const packRuntime = await readJson(
    new URL("../packages/pack-runtime/tsconfig.json", import.meta.url),
  );
  const cli = await readJson(
    new URL("../packages/cli/tsconfig.json", import.meta.url),
  );

  assert.equal(base.compilerOptions.rootDir, undefined);
  assert.equal(contracts.compilerOptions.rootDir, "src");
  assert.equal(registry.compilerOptions.rootDir, "src");
  assert.equal(core.compilerOptions.rootDir, "src");
  assert.equal(evidence.compilerOptions.rootDir, "src");
  assert.equal(packRuntime.compilerOptions.rootDir, "src");
  assert.equal(cli.compilerOptions.rootDir, "src");
});
