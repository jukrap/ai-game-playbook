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

test("issues and consumes one frozen private source handoff", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );

  const handoff = await engineCommon.issueEngineExecutionSourceHandoff({
    binding,
    root: context.root,
    executable: context.executable,
    profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  });

  assert.equal(Object.isFrozen(handoff), true);
  assert.equal(handoff.bindingDigest, binding.bindingDigest);
  assert.equal(
    handoff.profileContractDigest,
    contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.contractDigest,
  );
  assert.equal(
    handoff.profileCatalogDigest,
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  );
  assert.equal(JSON.stringify(handoff).includes(context.project), false);
  assert.equal(JSON.stringify(handoff).includes("project.godot"), false);
  assert.throws(
    () =>
      engineCommon.consumeEngineExecutionSourceHandoff(
        structuredClone(handoff),
      ),
    expectEngineError("engine-snapshot-handoff-invalid"),
  );

  const source = engineCommon.consumeEngineExecutionSourceHandoff(handoff);
  assert.equal(source.root, context.root);
  assert.equal(source.executable, context.executable);
  assert.equal(source.binding, binding);
  assert.equal(source.profileContractDigest, handoff.profileContractDigest);
  assert.equal(source.profileCatalogDigest, handoff.profileCatalogDigest);
  assert.deepEqual(
    source.manifest.files.map((entry) => entry.path),
    ["project.godot", "scenes/main.tscn"],
  );
  assert.equal(Object.isFrozen(source), true);
  assert.equal(Object.isFrozen(source.manifest), true);
  assert.equal(Object.isFrozen(source.manifest.directories), true);
  assert.equal(Object.isFrozen(source.manifest.files), true);
  assert.equal(Object.isFrozen(source.manifest.files[0]), true);

  assert.throws(
    () => engineCommon.consumeEngineExecutionSourceHandoff(handoff),
    expectEngineError("engine-snapshot-handoff-invalid"),
  );
  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff({
      binding,
      root: context.root,
      executable: context.executable,
      profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
    }),
    expectEngineError("engine-snapshot-authority-consumed"),
  );
});

test("issues a private source handoff for the registered replay profile", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  const profile =
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE;

  const handoff = await engineCommon.issueEngineExecutionSourceHandoff({
    binding,
    root: context.root,
    executable: context.executable,
    profileId: profile.profileId,
  });

  assert.equal(handoff.profileId, profile.profileId);
  assert.equal(handoff.profileDigest, profile.profileDigest);
  assert.equal(handoff.profileContractDigest, profile.contractDigest);
  assert.equal(
    handoff.profileCatalogDigest,
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  );
  const source = engineCommon.consumeEngineExecutionSourceHandoff(handoff);
  assert.equal(source.profileId, profile.profileId);
  assert.equal(source.profileDigest, profile.profileDigest);
  assert.equal(source.profileContractDigest, profile.contractDigest);
});

test("burns the source authority when drift is found during handoff", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  await writeFile(join(context.project, "project.godot"), "changed=true\n");
  const handoffRequest = {
    binding,
    root: context.root,
    executable: context.executable,
    profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  };

  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff(handoffRequest),
    expectEngineError("engine-snapshot-project-drift"),
  );
  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff(handoffRequest),
    expectEngineError("engine-snapshot-authority-consumed"),
  );
});

test("rejects handoff profiles and budgets outside the fixed boundary", async (t) => {
  const profileContext = await fixture(t);
  const profileBinding = await engineCommon.captureEngineExecutionSnapshots(
    request(profileContext),
  );
  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff({
      binding: profileBinding,
      root: profileContext.root,
      executable: profileContext.executable,
      profileId: "godot-editor-v1",
    }),
    expectEngineError("engine-snapshot-handoff-invalid"),
  );

  const budgetContext = await fixture(t);
  await writeFile(
    join(budgetContext.project, "oversized.bin"),
    Buffer.alloc(
      contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES + 1,
      0x61,
    ),
  );
  const budgetBinding = await engineCommon.captureEngineExecutionSnapshots(
    request(budgetContext),
  );
  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff({
      binding: budgetBinding,
      root: budgetContext.root,
      executable: budgetContext.executable,
      profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
    }),
    expectEngineError("engine-snapshot-handoff-budget-exceeded"),
  );
});

test("handoff request parsing never invokes accessors", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  let called = false;
  const hostile = {
    binding,
    root: context.root,
    executable: context.executable,
    profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  };
  Object.defineProperty(hostile, "profileId", {
    enumerable: true,
    get() {
      called = true;
      return contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID;
    },
  });

  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff(hostile),
    expectEngineError("engine-snapshot-handoff-invalid"),
  );
  assert.equal(called, false);
});

test("handoff request parsing rejects proxies without invoking traps", async (t) => {
  const context = await fixture(t);
  const binding = await engineCommon.captureEngineExecutionSnapshots(
    request(context),
  );
  let called = false;
  const hostile = new Proxy(
    {
      binding,
      root: context.root,
      executable: context.executable,
      profileId: contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
    },
    {
      getPrototypeOf() {
        called = true;
        return Object.prototype;
      },
    },
  );

  await assert.rejects(
    engineCommon.issueEngineExecutionSourceHandoff(hostile),
    expectEngineError("engine-snapshot-handoff-invalid"),
  );
  assert.equal(called, false);
});
