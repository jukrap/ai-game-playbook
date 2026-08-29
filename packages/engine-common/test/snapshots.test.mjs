import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as engineCommon from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-engine-snapshot-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, "scenes"), { recursive: true });
  await mkdir(join(project, ".godot"), { recursive: true });
  await mkdir(join(project, ".ai-game-playbook"), { recursive: true });
  await writeFile(join(project, "project.godot"), "config_version=5\n");
  await writeFile(join(project, "scenes", "main.tscn"), "[gd_scene format=3]\n");
  await writeFile(join(project, ".godot", "cache.bin"), "ignored-cache");
  await writeFile(
    join(project, ".ai-game-playbook", "local.json"),
    "ignored-local-state",
  );
  const root = await core.canonicalizeProjectRoot(project);
  const executable = await core.bindProcessExecutable({
    path: process.execPath,
    maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    allowedEnvironmentKeys: [],
  });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root, executable };
}

function request(context) {
  return {
    root: context.root,
    executable: context.executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      project: "ready",
    }),
  };
}

function expectEngineError(code) {
  return (error) =>
    error?.name === "EngineCommonBoundaryError" && error?.code === code;
}

test("captures one bounded path-free project and executable snapshot authority", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );

  assert.doesNotThrow(() =>
    contracts.assertEngineExecutionSnapshotBindingSemantics(binding),
  );
  assert.equal(binding.engine, "godot");
  assert.equal(binding.project.fileCount, 2);
  assert.equal(binding.project.directoryCount, 2);
  assert.equal(
    binding.project.totalBytes,
    Buffer.byteLength("config_version=5\n[gd_scene format=3]\n"),
  );
  assert.equal(binding.executable.executableDigest, context.executable.digest);
  assert.equal(
    binding.executable.executableIdentityDigest,
    context.executable.identityDigest,
  );
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.project), true);
  assert.equal(JSON.stringify(binding).includes(context.project), false);
  assert.equal(JSON.stringify(binding).includes("project.godot"), false);

  await assert.doesNotReject(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding,
      root: context.root,
      executable: context.executable,
    }),
  );
  await assert.rejects(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding: structuredClone(binding),
      root: context.root,
      executable: context.executable,
    }),
    expectEngineError("engine-snapshot-authority-invalid"),
  );
});

test("rejects project drift after capture", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  await writeFile(join(context.project, "scenes", "main.tscn"), "changed\n");

  await assert.rejects(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding,
      root: context.root,
      executable: context.executable,
    }),
    expectEngineError("engine-snapshot-project-drift"),
  );
});

test("ignores declared local state while retaining source authority", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  await writeFile(join(context.project, ".godot", "cache.bin"), "changed-cache");
  await writeFile(
    join(context.project, ".ai-game-playbook", "local.json"),
    "changed-local-state",
  );

  await assert.doesNotReject(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding,
      root: context.root,
      executable: context.executable,
    }),
  );
});

test("rejects substituted root and executable authorities", async (t) => {
  const context = await fixture(t);
  const substitute = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );

  await assert.rejects(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding,
      root: substitute.root,
      executable: context.executable,
    }),
    expectEngineError("engine-snapshot-authority-invalid"),
  );
  await assert.rejects(
    engineCommon.assertEngineExecutionSnapshotAuthority({
      binding,
      root: context.root,
      executable: substitute.executable,
    }),
    expectEngineError("engine-snapshot-authority-invalid"),
  );
});

test("rejects project reparse points instead of traversing them", async (t) => {
  const context = await fixture(t);
  const outside = join(context.project, "..", "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "outside");
  const link = join(context.project, "linked");
  try {
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("host does not permit creating a test reparse point");
      return;
    }
    throw error;
  }

  await assert.rejects(
    engineCommon.captureEngineExecutionSnapshots(request(context)),
    expectEngineError("engine-snapshot-link-rejected"),
  );
});

test("request parsing never invokes accessors", async (t) => {
  const context = await fixture(t);
  let called = false;
  const hostile = { ...request(context) };
  Object.defineProperty(hostile, "engine", {
    enumerable: true,
    get() {
      called = true;
      return "godot";
    },
  });

  await assert.rejects(
    engineCommon.captureEngineExecutionSnapshots(hostile),
    expectEngineError("engine-snapshot-request-invalid"),
  );
  assert.equal(called, false);
});
