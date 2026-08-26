import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, relative } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-path-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, "Assets"), { recursive: true });
  await writeFile(join(project, "Assets", "Player.cs"), "player\n", "utf8");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project };
}

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

test("canonical project roots bind a real directory identity immutably", async (t) => {
  assert.equal(typeof core.canonicalizeProjectRoot, "function");
  assert.equal(typeof core.assertProjectRootIdentity, "function");

  const { sandbox, project } = await fixture(t);
  const linkedRoot = join(sandbox, "linked-project");
  await symlink(
    project,
    linkedRoot,
    process.platform === "win32" ? "junction" : "dir",
  );

  const root = await core.canonicalizeProjectRoot(linkedRoot);
  assert.equal(root.canonicalPath, await realpath(project));
  assert.equal(root.requestedPath, linkedRoot);
  assert.match(root.identityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(typeof root.device, "string");
  assert.equal(typeof root.inode, "string");
  assert.equal(Object.isFrozen(root), true);
  await core.assertProjectRootIdentity(root);

  assert.throws(() => {
    root.canonicalPath = sandbox;
  }, TypeError);
});

test("canonical project roots reject relative, broad, and non-directory targets", async (t) => {
  const { sandbox } = await fixture(t);
  const file = join(sandbox, "not-a-project.txt");
  await writeFile(file, "not a directory\n", "utf8");

  await assert.rejects(
    core.canonicalizeProjectRoot("relative/project"),
    expectCoreError("invalid-project-root"),
  );
  await assert.rejects(
    core.canonicalizeProjectRoot(parse(sandbox).root),
    expectCoreError("unsafe-project-root"),
  );
  await assert.rejects(
    core.canonicalizeProjectRoot(await realpath(homedir())),
    expectCoreError("unsafe-project-root"),
  );
  await assert.rejects(
    core.canonicalizeProjectRoot(file),
    expectCoreError("project-root-not-directory"),
  );
});

test("project path resolution rejects case ambiguity and link escape", async (t) => {
  assert.equal(typeof core.resolveProjectPath, "function");

  const { sandbox, project } = await fixture(t);
  const outside = join(sandbox, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "outside\n", "utf8");
  await symlink(
    outside,
    join(project, "Assets", "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const root = await core.canonicalizeProjectRoot(project);

  const player = await core.resolveProjectPath(root, "Assets/Player.cs", {
    expectedType: "file",
    existence: "required",
  });
  assert.equal(player.relativePath, "Assets/Player.cs");
  assert.equal(player.absolutePath, join(await realpath(project), "Assets", "Player.cs"));
  assert.equal(player.kind, "file");
  assert.equal(Object.isFrozen(player), true);

  await assert.rejects(
    core.resolveProjectPath(root, "assets/Player.cs", {
      expectedType: "file",
      existence: "required",
    }),
    expectCoreError("project-path-case-conflict"),
  );
  await assert.rejects(
    core.resolveProjectPath(root, "Assets/escape/secret.txt", {
      expectedType: "file",
      existence: "required",
    }),
    expectCoreError("project-path-link"),
  );
  await assert.rejects(
    core.resolveProjectPath(root, "../outside/secret.txt", {
      expectedType: "file",
      existence: "required",
    }),
    (error) =>
      error?.name === "ContractValueError" &&
      error?.code === "invalid-portable-project-path",
  );

  const candidate = await core.resolveProjectPath(root, "Assets/NewPlayer.cs", {
    expectedType: "file",
    existence: "optional",
  });
  assert.equal(candidate.kind, "absent");
  assert.equal(
    relative(root.canonicalPath, dirname(candidate.absolutePath)),
    "Assets",
  );
  assert.equal(contracts.isPortableProjectPath(candidate.relativePath), true);
});

test("bound roots stop after the project directory is replaced", async (t) => {
  const { sandbox, project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await rename(project, join(sandbox, "original-project"));
  await mkdir(project);

  await assert.rejects(
    core.assertProjectRootIdentity(root),
    expectCoreError("project-root-drift"),
  );
  await assert.rejects(
    core.resolveProjectPath(root, "Assets/Player.cs", {
      expectedType: "file",
      existence: "required",
    }),
    expectCoreError("project-root-drift"),
  );
});

test("project path APIs reject caller-constructed roots and malformed options", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  const unboundRoot = structuredClone(root);

  await assert.rejects(
    core.assertProjectRootIdentity(unboundRoot),
    expectCoreError("invalid-project-root"),
  );
  await assert.rejects(
    core.resolveProjectPath(unboundRoot, "Assets/Player.cs", {
      expectedType: "file",
      existence: "required",
    }),
    expectCoreError("invalid-project-root"),
  );
  await assert.rejects(
    core.resolveProjectPath(root, "Assets/Player.cs", {
      expectedType: "file",
      existence: "sometimes",
    }),
    expectCoreError("invalid-project-path-options"),
  );
});

test("project path resolution bounds directory enumeration", async (t) => {
  const { project } = await fixture(t);
  await writeFile(join(project, "Assets", "Second.cs"), "second\n", "utf8");
  const root = await core.canonicalizeProjectRoot(project);

  await assert.rejects(
    core.resolveProjectPath(root, "Assets/Player.cs", {
      expectedType: "file",
      existence: "required",
      maxDirectoryEntries: 1,
    }),
    expectCoreError("project-path-budget-exceeded"),
  );
});
