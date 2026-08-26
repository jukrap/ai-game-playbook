import assert from "node:assert/strict";
import {
  lstat,
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

import * as core from "../dist/index.js";

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-bootstrap-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
    sandbox,
  };
}

function nativePath(project, portablePath) {
  return join(project, ...portablePath.split("/"));
}

test("project state bootstrap creates only the fixed runtime layout and is idempotent", async (t) => {
  assert.equal(typeof core.initializeProjectState, "function");
  assert.deepEqual(core.PROJECT_STATE_DIRECTORIES, [
    ".ai-game-playbook",
    ".ai-game-playbook/locks",
    ".ai-game-playbook/state",
    ".ai-game-playbook/state/packs",
    ".ai-game-playbook/state/packs/transactions",
    ".ai-game-playbook/state/workflows",
  ]);

  const { project, root } = await fixture(t);
  const initialized = await core.initializeProjectState({ root });

  assert.equal(Object.isFrozen(initialized), true);
  assert.equal(Object.isFrozen(initialized.createdDirectories), true);
  assert.equal(Object.isFrozen(initialized.existingDirectories), true);
  assert.equal(initialized.schemaVersion, "1.0.0");
  assert.equal(initialized.status, "created");
  assert.equal(initialized.rootIdentityDigest, root.identityDigest);
  assert.deepEqual(
    initialized.createdDirectories,
    core.PROJECT_STATE_DIRECTORIES,
  );
  assert.deepEqual(initialized.existingDirectories, []);

  for (const path of core.PROJECT_STATE_DIRECTORIES) {
    const stats = await lstat(nativePath(project, path));
    assert.equal(stats.isDirectory(), true);
    assert.equal(stats.isSymbolicLink(), false);
    if (process.platform !== "win32") {
      assert.equal(stats.mode & 0o777, 0o700);
    }
  }
  assert.deepEqual(
    (await readdir(join(project, ".ai-game-playbook"))).sort(),
    ["locks", "state"],
  );

  const repeated = await core.initializeProjectState({ root });
  assert.equal(repeated.status, "ready");
  assert.deepEqual(repeated.createdDirectories, []);
  assert.deepEqual(
    repeated.existingDirectories,
    core.PROJECT_STATE_DIRECTORIES,
  );
});

test("concurrent bootstrap calls converge on the same safe layout", async (t) => {
  const { root } = await fixture(t);
  const results = await Promise.all(
    Array.from({ length: 16 }, () => core.initializeProjectState({ root })),
  );

  assert.equal(results.some((result) => result.status === "created"), true);
  for (const result of results) {
    assert.equal(result.rootIdentityDigest, root.identityDigest);
    assert.equal(
      result.createdDirectories.length + result.existingDirectories.length,
      core.PROJECT_STATE_DIRECTORIES.length,
    );
  }
});

test("bootstrap rejects malformed authority and caller-constructed roots", async (t) => {
  const { root } = await fixture(t);

  await assert.rejects(
    core.initializeProjectState({ root, undeclared: true }),
    expectCoreError("invalid-project-state-request"),
  );
  await assert.rejects(
    core.initializeProjectState({ root: structuredClone(root) }),
    expectCoreError("invalid-project-root"),
  );
});

test("bootstrap fails closed on files, case aliases, and writable links", async (t) => {
  const fileFixture = await fixture(t);
  await mkdir(join(fileFixture.project, ".ai-game-playbook"));
  await writeFile(
    join(fileFixture.project, ".ai-game-playbook", "locks"),
    "owned by user\n",
  );
  await assert.rejects(
    core.initializeProjectState({ root: fileFixture.root }),
    expectCoreError("project-path-type-mismatch"),
  );
  assert.equal(
    await readFile(
      join(fileFixture.project, ".ai-game-playbook", "locks"),
      "utf8",
    ),
    "owned by user\n",
  );

  const caseFixture = await fixture(t);
  await mkdir(join(caseFixture.project, ".AI-GAME-PLAYBOOK"));
  await assert.rejects(
    core.initializeProjectState({ root: caseFixture.root }),
    expectCoreError("project-path-case-conflict"),
  );

  const linkFixture = await fixture(t);
  const outside = join(linkFixture.sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(linkFixture.project, ".ai-game-playbook"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    core.initializeProjectState({ root: linkFixture.root }),
    expectCoreError("project-path-link"),
  );
  assert.deepEqual(await readdir(outside), []);
});

test("clear partial initialization failures remove only directories created by this call", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, ".ai-game-playbook", "state"), {
    recursive: true,
  });
  await writeFile(
    join(project, ".ai-game-playbook", "state", "packs"),
    "conflict\n",
  );

  await assert.rejects(
    core.initializeProjectState({ root }),
    expectCoreError("project-path-type-mismatch"),
  );

  await assert.rejects(
    lstat(join(project, ".ai-game-playbook", "locks")),
    (error) => error?.code === "ENOENT",
  );
  assert.equal(
    await readFile(
      join(project, ".ai-game-playbook", "state", "packs"),
      "utf8",
    ),
    "conflict\n",
  );
});
