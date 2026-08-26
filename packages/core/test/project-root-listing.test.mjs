import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as core from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-root-listing-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, "Assets"), { recursive: true });
  await writeFile(join(project, "project.godot"), "[application]\n", "utf8");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project };
}

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

test("project root listing is bounded, deterministic, and immutable", async (t) => {
  assert.equal(typeof core.listProjectRootEntries, "function");

  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  const entries = await core.listProjectRootEntries({ root, maxEntries: 10 });

  assert.deepEqual(entries, [
    { name: "Assets", kindHint: "directory" },
    { name: "project.godot", kindHint: "file" },
  ]);
  assert.equal(Object.isFrozen(entries), true);
  assert.equal(entries.every((entry) => Object.isFrozen(entry)), true);
  assert.throws(() => {
    entries.push({ name: "later", kindHint: "file" });
  }, TypeError);
  assert.throws(() => {
    entries[0].name = "changed";
  }, TypeError);
});

test("project root listing snapshots an exact request before its first await", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  const request = { root, maxEntries: 2 };

  const pending = core.listProjectRootEntries(request);
  request.maxEntries = 1;

  assert.equal((await pending).length, 2);
  await assert.rejects(
    core.listProjectRootEntries({ root, maxEntries: 2, extra: true }),
    expectCoreError("invalid-project-root-listing-request"),
  );
  await assert.rejects(
    core.listProjectRootEntries({ root, maxEntries: 0 }),
    expectCoreError("invalid-project-root-listing-request"),
  );
  await assert.rejects(
    core.listProjectRootEntries({ root, maxEntries: 100_001 }),
    expectCoreError("invalid-project-root-listing-request"),
  );
});

test("project root listing rejects caller-constructed roots", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);

  await assert.rejects(
    core.listProjectRootEntries({
      root: structuredClone(root),
      maxEntries: 10,
    }),
    expectCoreError("invalid-project-root"),
  );
});

test("project root listing counts every observed entry against its budget", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);

  await assert.rejects(
    core.listProjectRootEntries({ root, maxEntries: 1 }),
    expectCoreError("project-root-listing-budget-exceeded"),
  );
});

test("project root listing stops after the bound directory is replaced", async (t) => {
  const { sandbox, project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await rename(project, join(sandbox, "original-project"));
  await mkdir(project);

  await assert.rejects(
    core.listProjectRootEntries({ root, maxEntries: 10 }),
    expectCoreError("project-root-drift"),
  );
});

test(
  "project root listing fails closed when the root changes after the call starts",
  { skip: process.platform === "win32" },
  async (t) => {
    const { sandbox, project } = await fixture(t);
    for (let index = 0; index < 512; index += 1) {
      await writeFile(join(project, `entry-${index}.txt`), "entry\n", "utf8");
    }
    const root = await core.canonicalizeProjectRoot(project);

    const pending = core
      .listProjectRootEntries({ root, maxEntries: 1_000 })
      .then(
        () => ({ status: "fulfilled" }),
        (error) => ({ status: "rejected", error }),
      );
    await rename(project, join(sandbox, "moved-project"));
    await mkdir(project);

    const outcome = await pending;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error?.name, "CoreBoundaryError");
    assert.equal(outcome.error?.code, "project-root-drift");
  },
);

test(
  "project root listing preserves distinct case variants and link hints",
  { skip: process.platform === "win32" },
  async (t) => {
    const { project } = await fixture(t);
    await writeFile(join(project, "Alpha"), "upper\n", "utf8");
    await writeFile(join(project, "alpha"), "lower\n", "utf8");
    await symlink("project.godot", join(project, "engine-link"), "file");
    const root = await core.canonicalizeProjectRoot(project);

    const entries = await core.listProjectRootEntries({ root, maxEntries: 10 });
    assert.deepEqual(
      entries.filter((entry) => entry.name.toLowerCase() === "alpha"),
      [
        { name: "Alpha", kindHint: "file" },
        { name: "alpha", kindHint: "file" },
      ],
    );
    assert.deepEqual(
      entries.find((entry) => entry.name === "engine-link"),
      { name: "engine-link", kindHint: "link" },
    );
  },
);

test(
  "project root listing rejects names that cannot enter portable inspection",
  { skip: process.platform === "win32" },
  async (t) => {
    const { project } = await fixture(t);
    await writeFile(join(project, "bad\nname"), "invalid\n", "utf8");
    const root = await core.canonicalizeProjectRoot(project);

    await assert.rejects(
      core.listProjectRootEntries({ root, maxEntries: 10 }),
      expectCoreError("project-root-entry-unrepresentable"),
    );
  },
);
