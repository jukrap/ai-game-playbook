import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

async function fixture(t, initial) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-cas-"));
  const project = join(sandbox, "project");
  const target = join(project, "Config", "settings.json");
  await mkdir(join(project, "Config"), { recursive: true });
  if (initial !== undefined) {
    await writeFile(target, initial, "utf8");
  }
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    sandbox,
    project,
    target,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function expectCoreError(code, uncertain) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    (uncertain === undefined || error?.mutationUncertain === uncertain);
}

test("staged CAS creates a new file only at commit", async (t) => {
  assert.equal(typeof core.stageProjectFileCas, "function");
  assert.equal(typeof core.writeProjectFileCas, "function");

  const { root, target } = await fixture(t);
  const content = '{"quality":"high"}\n';
  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content,
    expected: { mode: "absent" },
    maxBytes: 1024,
  });

  assert.equal(staged.state, "staged");
  assert.equal(staged.beforeDigest, undefined);
  assert.equal(staged.afterDigest, contracts.sha256Digest(content));
  assert.equal("temporaryPath" in staged, false);
  await assert.rejects(readFile(target), (error) => error?.code === "ENOENT");

  const result = await staged.commit();
  assert.deepEqual(result, {
    status: "created",
    path: "Config/settings.json",
    afterDigest: contracts.sha256Digest(content),
    bytes: Buffer.byteLength(content),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(staged.state, "committed");
  assert.equal(await readFile(target, "utf8"), content);
  await assert.rejects(staged.commit(), expectCoreError("cas-state-invalid"));
});

test("CAS replacement is staged and identical content is a write-free no-op", async (t) => {
  const initial = '{"quality":"low"}\n';
  const replacement = '{"quality":"high"}\n';
  const { root, target } = await fixture(t, initial);
  const beforeDigest = contracts.sha256Digest(initial);

  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: replacement,
    expected: { mode: "digest", digest: beforeDigest },
    maxBytes: 1024,
  });
  assert.equal(await readFile(target, "utf8"), initial);
  assert.equal((await staged.commit()).status, "replaced");
  assert.equal(await readFile(target, "utf8"), replacement);

  const beforeNoop = await stat(target, { bigint: true });
  const noOp = await core.writeProjectFileCas({
    root,
    path: "Config/settings.json",
    content: replacement,
    expected: {
      mode: "digest",
      digest: contracts.sha256Digest(replacement),
    },
    maxBytes: 1024,
  });
  const afterNoop = await stat(target, { bigint: true });
  assert.equal(noOp.status, "no-op");
  assert.equal(afterNoop.ino, beforeNoop.ino);
  assert.equal(afterNoop.mtimeNs, beforeNoop.mtimeNs);
});

test("CAS preconditions and byte budgets fail without changing the target", async (t) => {
  const initial = "stable\n";
  const { root, target } = await fixture(t, initial);

  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/settings.json",
      content: "new\n",
      expected: { mode: "absent" },
      maxBytes: 1024,
    }),
    expectCoreError("cas-precondition-failed", false),
  );
  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/settings.json",
      content: "new\n",
      expected: { mode: "digest", digest: `sha256:${"f".repeat(64)}` },
      maxBytes: 1024,
    }),
    expectCoreError("cas-precondition-failed", false),
  );
  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/new.json",
      content: "12345",
      expected: { mode: "absent" },
      maxBytes: 4,
    }),
    expectCoreError("cas-budget-exceeded", false),
  );
  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/settings.json",
      content: "x",
      expected: { mode: "digest", digest: contracts.sha256Digest(initial) },
      maxBytes: 4,
    }),
    expectCoreError("cas-budget-exceeded", false),
  );

  assert.equal(await readFile(target, "utf8"), initial);
});

test("CAS detaches mutable input and rejects undeclared request authority", async (t) => {
  const { root, target } = await fixture(t);
  const mutable = Buffer.from("detached\n", "utf8");
  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: mutable,
    expected: { mode: "absent" },
    maxBytes: 1024,
  });
  mutable.fill(0x78);
  await staged.commit();
  assert.equal(await readFile(target, "utf8"), "detached\n");

  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/other.json",
      content: "other\n",
      expected: { mode: "absent" },
      maxBytes: 1024,
      overwrite: true,
    }),
    expectCoreError("invalid-cas-request", false),
  );
});

test("CAS snapshots mutable content before its first asynchronous boundary", async (t) => {
  const { root, target } = await fixture(t);
  const mutable = Buffer.from("call-time\n", "utf8");
  const pending = core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: mutable,
    expected: { mode: "absent" },
    maxBytes: 1024,
  });
  mutable.fill(0x78);

  const staged = await pending;
  await staged.commit();
  assert.equal(await readFile(target, "utf8"), "call-time\n");
});

test("staged CAS detects target races and preserves the competing write", async (t) => {
  const initial = "before\n";
  const raced = "editor-write\n";
  const { root, target } = await fixture(t, initial);
  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: "planned\n",
    expected: { mode: "digest", digest: contracts.sha256Digest(initial) },
    maxBytes: 1024,
  });

  await writeFile(target, raced, "utf8");
  await assert.rejects(
    staged.commit(),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(await readFile(target, "utf8"), raced);
  assert.equal(staged.state, "staged");
  await staged.abort();
  assert.equal(staged.state, "aborted");
  assert.deepEqual(await readdir(join(root.canonicalPath, "Config")), [
    "settings.json",
  ]);
});

test("staged create refuses a target claimed before commit", async (t) => {
  const { root, target } = await fixture(t);
  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: "planned\n",
    expected: { mode: "absent" },
    maxBytes: 1024,
  });

  await writeFile(target, "claimed\n", "utf8");
  await assert.rejects(
    staged.commit(),
    expectCoreError("cas-precondition-failed", false),
  );
  assert.equal(await readFile(target, "utf8"), "claimed\n");
  await staged.abort();
});

test("CAS never follows a project link into an outside directory", async (t) => {
  const { sandbox, project, root } = await fixture(t);
  const outside = join(sandbox, "outside");
  await mkdir(outside);
  await symlink(
    outside,
    join(project, "Config", "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    core.stageProjectFileCas({
      root,
      path: "Config/escape/owned.txt",
      content: "must stay inside\n",
      expected: { mode: "absent" },
      maxBytes: 1024,
    }),
    expectCoreError("project-path-link", false),
  );
  await assert.rejects(
    readFile(join(outside, "owned.txt")),
    (error) => error?.code === "ENOENT",
  );
});

test("root replacement makes staged cleanup uncertain without deleting a new file", async (t) => {
  const initial = "before\n";
  const { sandbox, project, root } = await fixture(t, initial);
  const staged = await core.stageProjectFileCas({
    root,
    path: "Config/settings.json",
    content: "planned\n",
    expected: { mode: "digest", digest: contracts.sha256Digest(initial) },
    maxBytes: 1024,
  });

  const original = join(sandbox, "original-project");
  await rename(project, original);
  await mkdir(join(project, "Config"), { recursive: true });
  const stagedName = (await readdir(join(original, "Config"))).find((name) =>
    name.startsWith(".agpb-cas-"),
  );
  assert.equal(typeof stagedName, "string");
  const sentinel = join(project, "Config", stagedName);
  await writeFile(sentinel, "new-root-file\n", "utf8");

  await assert.rejects(
    staged.commit(),
    expectCoreError("project-root-drift", false),
  );
  await assert.rejects(
    staged.abort(),
    expectCoreError("cas-cleanup-conflict", true),
  );
  assert.equal(staged.state, "uncertain");
  assert.equal(await readFile(sentinel, "utf8"), "new-root-file\n");
});
