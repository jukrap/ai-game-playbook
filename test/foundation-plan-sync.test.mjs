import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as registry from "../packages/registry/dist/index.js";

const generatorPath = fileURLToPath(
  new URL("../scripts/generate-foundation-plan.mjs", import.meta.url),
);

function runGenerator(mode, root) {
  return spawnSync(process.execPath, [generatorPath, mode, "--root", root], {
    encoding: "utf8",
    windowsHide: true,
  });
}

test("foundation plan generation writes and checks every registry-derived status surface", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agpb-foundation-plan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "generated"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "generated", "foundation-plan.json"), "stale\n");
  await writeFile(
    join(root, "docs", "planned-surface.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        artifact: "ai-game-playbook-planned-surface",
        runtimeRegistryDigest: `sha256:${"0".repeat(64)}`,
        sentinel: { preserve: true },
      },
      null,
      2,
    )}\n`,
  );

  const before = runGenerator("--check", root);
  assert.equal(before.status, 1);

  const write = runGenerator("--write", root);
  assert.equal(
    write.status,
    0,
    `generator failed:\n${write.stdout}\n${write.stderr}`,
  );
  assert.equal(
    await readFile(join(root, "generated", "foundation-plan.json"), "utf8"),
    registry.serializeFoundationPlanArtifact(),
  );
  const publicSurface = JSON.parse(
    await readFile(join(root, "docs", "planned-surface.json"), "utf8"),
  );
  assert.equal(
    publicSurface.runtimeRegistryDigest,
    registry.BUILTIN_REGISTRY.digest,
  );
  assert.deepEqual(publicSurface.sentinel, { preserve: true });

  const after = runGenerator("--check", root);
  assert.equal(
    after.status,
    0,
    `generated surfaces still drifted:\n${after.stdout}\n${after.stderr}`,
  );

  const duplicateRoot = spawnSync(
    process.execPath,
    [generatorPath, "--check", "--root", root, "--root", root],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(duplicateRoot.status, 1);
});

test("foundation plan generation refuses to synthesize an invalid public surface", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agpb-foundation-plan-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "generated"));
  await mkdir(join(root, "docs"));
  const planPath = join(root, "generated", "foundation-plan.json");
  const publicSurfacePath = join(root, "docs", "planned-surface.json");
  await writeFile(planPath, "preserve plan\n");

  const missing = runGenerator("--write", root);
  assert.equal(missing.status, 1);
  await assert.rejects(readFile(publicSurfacePath, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(planPath, "utf8"), "preserve plan\n");

  await writeFile(publicSurfacePath, "{}\n");
  const invalid = runGenerator("--write", root);
  assert.equal(invalid.status, 1);
  assert.equal(await readFile(publicSurfacePath, "utf8"), "{}\n");
  assert.equal(await readFile(planPath, "utf8"), "preserve plan\n");
});

test("foundation plan generation rejects linked output directories without escaping its root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agpb-foundation-plan-linked-"));
  const outside = await mkdtemp(
    join(tmpdir(), "agpb-foundation-plan-outside-"),
  );
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(outside, { recursive: true, force: true }),
    ]),
  );

  const outsideDocs = join(outside, "docs");
  await mkdir(outsideDocs);
  const outsideSurfacePath = join(outsideDocs, "planned-surface.json");
  const outsideSurface = `${JSON.stringify(
    {
      schemaVersion: "1",
      artifact: "ai-game-playbook-planned-surface",
      runtimeRegistryDigest: `sha256:${"0".repeat(64)}`,
    },
    null,
    2,
  )}\n`;
  await writeFile(outsideSurfacePath, outsideSurface);
  await mkdir(join(root, "generated"));
  const planPath = join(root, "generated", "foundation-plan.json");
  await writeFile(planPath, "preserve linked-docs plan\n");
  await symlink(
    outsideDocs,
    join(root, "docs"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const linkedDocs = runGenerator("--write", root);
  assert.equal(linkedDocs.status, 1);
  assert.equal(await readFile(planPath, "utf8"), "preserve linked-docs plan\n");
  assert.equal(await readFile(outsideSurfacePath, "utf8"), outsideSurface);

  await rm(join(root, "docs"), { force: true });
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "planned-surface.json"), outsideSurface);
  await rm(join(root, "generated"), { recursive: true, force: true });
  const outsideGenerated = join(outside, "generated");
  await mkdir(outsideGenerated);
  const outsidePlanPath = join(outsideGenerated, "foundation-plan.json");
  await writeFile(outsidePlanPath, "preserve linked-generated plan\n");
  await symlink(
    outsideGenerated,
    join(root, "generated"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const linkedGenerated = runGenerator("--write", root);
  assert.equal(linkedGenerated.status, 1);
  assert.equal(
    await readFile(outsidePlanPath, "utf8"),
    "preserve linked-generated plan\n",
  );
  assert.equal(
    await readFile(join(root, "docs", "planned-surface.json"), "utf8"),
    outsideSurface,
  );
});
