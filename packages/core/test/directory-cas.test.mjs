import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as core from "../dist/index.js";

function expectCoreError(code, uncertain) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    (uncertain === undefined || error?.mutationUncertain === uncertain);
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-directory-cas-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, "Packs"), { recursive: true });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
    sandbox,
  };
}

test("staged directory CAS creates one absent directory only at commit", async (t) => {
  assert.equal(typeof core.stageProjectDirectoryCasCreate, "function");
  assert.equal(typeof core.createProjectDirectoryCas, "function");

  const { project, root } = await fixture(t);
  const target = join(project, "Packs", "managed");
  const staged = await core.stageProjectDirectoryCasCreate({
    root,
    path: "Packs/managed",
  });

  assert.equal(staged.state, "staged");
  assert.equal(staged.path, "Packs/managed");
  await assert.rejects(lstat(target), (error) => error?.code === "ENOENT");

  const result = await staged.commit();
  assert.equal(result.status, "created");
  assert.equal(result.path, "Packs/managed");
  assert.equal(result.identity.schemaVersion, "1.0.0");
  assert.equal(result.identity.path, "Packs/managed");
  assert.equal(result.identity.rootIdentityDigest, root.identityDigest);
  assert.match(result.identity.identityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.identity), true);
  assert.equal((await lstat(target)).isDirectory(), true);
  assert.equal(staged.state, "committed");
  await assert.rejects(staged.commit(), expectCoreError("cas-state-invalid"));
});

test("directory create aborts without effects and refuses competing targets", async (t) => {
  const { project, root } = await fixture(t);
  const target = join(project, "Packs", "managed");
  const aborted = await core.stageProjectDirectoryCasCreate({
    root,
    path: "Packs/managed",
  });
  await aborted.abort();
  assert.equal(aborted.state, "aborted");
  await assert.rejects(lstat(target), (error) => error?.code === "ENOENT");

  const raced = await core.stageProjectDirectoryCasCreate({
    root,
    path: "Packs/managed",
  });
  await mkdir(target);
  await writeFile(join(target, "user.txt"), "user\n", "utf8");
  await assert.rejects(
    raced.commit(),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(await readFile(join(target, "user.txt"), "utf8"), "user\n");
  await raced.abort();

  await assert.rejects(
    core.stageProjectDirectoryCasCreate({ root, path: "Packs/managed" }),
    expectCoreError("cas-precondition-failed", false),
  );
});

test("directory create requires a safe existing parent and rejects files or links", async (t) => {
  const { project, root, sandbox } = await fixture(t);
  await assert.rejects(
    core.stageProjectDirectoryCasCreate({
      root,
      path: "Packs/missing/nested",
    }),
    expectCoreError("project-path-not-found", false),
  );

  await writeFile(join(project, "Packs", "file"), "not a directory\n", "utf8");
  await assert.rejects(
    core.stageProjectDirectoryCasCreate({ root, path: "Packs/file" }),
    expectCoreError("project-path-type-mismatch", false),
  );

  const outside = join(sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(project, "Packs", "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    core.stageProjectDirectoryCasCreate({ root, path: "Packs/linked" }),
    expectCoreError("project-path-link", false),
  );
  assert.deepEqual(await readdir(outside), []);
});

test("directory CAS deletes only the exact empty directory witness", async (t) => {
  assert.equal(typeof core.stageProjectDirectoryCasDelete, "function");
  assert.equal(typeof core.deleteProjectDirectoryCas, "function");

  const { project, root } = await fixture(t);
  const created = await core.createProjectDirectoryCas({
    root,
    path: "Packs/managed",
  });
  await writeFile(join(project, "Packs", "sibling.txt"), "keep\n", "utf8");

  const staged = await core.stageProjectDirectoryCasDelete({
    root,
    path: "Packs/managed",
    expectedIdentity: created.identity,
  });
  assert.equal(staged.state, "staged");
  assert.deepEqual(staged.expectedIdentity, created.identity);
  assert.equal((await lstat(join(project, "Packs", "managed"))).isDirectory(), true);

  const deleted = await staged.commit();
  assert.deepEqual(deleted, {
    status: "deleted",
    path: "Packs/managed",
    identity: created.identity,
  });
  await assert.rejects(
    lstat(join(project, "Packs", "managed")),
    (error) => error?.code === "ENOENT",
  );
  assert.equal(await readFile(join(project, "Packs", "sibling.txt"), "utf8"), "keep\n");
});

test("directory delete preserves non-empty and identity-replaced targets", async (t) => {
  const nonEmptyFixture = await fixture(t);
  const nonEmpty = await core.createProjectDirectoryCas({
    root: nonEmptyFixture.root,
    path: "Packs/managed",
  });
  await writeFile(
    join(nonEmptyFixture.project, "Packs", "managed", "user.txt"),
    "user\n",
    "utf8",
  );
  await assert.rejects(
    core.stageProjectDirectoryCasDelete({
      root: nonEmptyFixture.root,
      path: "Packs/managed",
      expectedIdentity: nonEmpty.identity,
    }),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(
    await readFile(
      join(nonEmptyFixture.project, "Packs", "managed", "user.txt"),
      "utf8",
    ),
    "user\n",
  );

  const replacedFixture = await fixture(t);
  const replaced = await core.createProjectDirectoryCas({
    root: replacedFixture.root,
    path: "Packs/managed",
  });
  const original = join(replacedFixture.project, "Packs", "original");
  await rename(join(replacedFixture.project, "Packs", "managed"), original);
  await mkdir(join(replacedFixture.project, "Packs", "managed"));
  await writeFile(
    join(replacedFixture.project, "Packs", "managed", "user.txt"),
    "replacement\n",
    "utf8",
  );
  await assert.rejects(
    core.stageProjectDirectoryCasDelete({
      root: replacedFixture.root,
      path: "Packs/managed",
      expectedIdentity: replaced.identity,
    }),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(
    await readFile(
      join(replacedFixture.project, "Packs", "managed", "user.txt"),
      "utf8",
    ),
    "replacement\n",
  );
  assert.deepEqual(await readdir(original), []);
});

test("staged directory delete detects content and identity races", async (t) => {
  const contentFixture = await fixture(t);
  const contentTarget = join(contentFixture.project, "Packs", "managed");
  const contentCreated = await core.createProjectDirectoryCas({
    root: contentFixture.root,
    path: "Packs/managed",
  });
  const contentStage = await core.stageProjectDirectoryCasDelete({
    root: contentFixture.root,
    path: "Packs/managed",
    expectedIdentity: contentCreated.identity,
  });
  await writeFile(join(contentTarget, "user.txt"), "late\n", "utf8");
  await assert.rejects(
    contentStage.commit(),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(await readFile(join(contentTarget, "user.txt"), "utf8"), "late\n");
  await contentStage.abort();

  const identityFixture = await fixture(t);
  const identityTarget = join(identityFixture.project, "Packs", "managed");
  const identityCreated = await core.createProjectDirectoryCas({
    root: identityFixture.root,
    path: "Packs/managed",
  });
  const identityStage = await core.stageProjectDirectoryCasDelete({
    root: identityFixture.root,
    path: "Packs/managed",
    expectedIdentity: identityCreated.identity,
  });
  await rename(identityTarget, join(identityFixture.project, "Packs", "original"));
  await mkdir(identityTarget);
  await assert.rejects(
    identityStage.commit(),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal((await lstat(identityTarget)).isDirectory(), true);
  await identityStage.abort();
});

test("directory CAS rejects malformed authority and forged identity witnesses", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(
    core.stageProjectDirectoryCasCreate({
      root,
      path: "Packs/managed",
      recursive: true,
    }),
    expectCoreError("invalid-cas-request", false),
  );
  await assert.rejects(
    core.stageProjectDirectoryCasCreate({
      root: structuredClone(root),
      path: "Packs/managed",
    }),
    expectCoreError("invalid-project-root", false),
  );

  const created = await core.createProjectDirectoryCas({
    root,
    path: "Packs/managed",
  });
  await assert.rejects(
    core.stageProjectDirectoryCasDelete({
      root,
      path: "Packs/managed",
      expectedIdentity: {
        ...created.identity,
        identityDigest: `sha256:${"f".repeat(64)}`,
      },
    }),
    expectCoreError("cas-precondition-failed", false),
  );
});
