import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as engineCommon from "@ai-game-playbook/engine-common";
import * as godot from "../dist/index.js";

const projectRoot = new URL("../../../golden/graybox/godot/", import.meta.url);
const attributesUrl = new URL("../../../.gitattributes", import.meta.url);

async function fixture() {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", projectRoot), "utf8"),
  );
  const files = await Promise.all(
    manifest.files.map(async ({ path }) => ({
      path,
      text: await readFile(new URL(path, projectRoot), "utf8"),
    })),
  );
  return { manifest, files };
}

function expectGodotError(code) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" && error?.code === code;
}

test("canonical Godot graybox source binds one exact static project", async () => {
  const source = await fixture();
  const report = godot.verifyGodotGrayboxProjectBundle(source);

  assert.equal(report.projectId, "golden.graybox.godot");
  assert.deepEqual(report.engine, {
    id: "godot",
    version: "4.7.2",
    releaseStatus: "stable",
  });
  assert.equal(
    report.scenarioDigest,
    "sha256:4bce945905093f746939b6b8f1c6183d0795f2f74b533763970aeed5be4e6c0f",
  );
  assert.equal(
    report.manifestDigest,
    godot.GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
  );
  assert.equal(report.sourceDigest, source.manifest.sourceDigest);
  assert.equal(report.fileCount, 6);
  assert.equal(report.totalBytes > 0, true);
  assert.equal(report.mainScene, "scenes/main.tscn");
  assert.deepEqual(report.features, [
    "camera-follow",
    "collision",
    "collectible",
    "deterministic-input-replay",
    "hud-counter",
    "movement",
    "save-load",
    "state-trace",
    "win-state",
  ]);
  assert.deepEqual(report.support, {
    grade: "planned",
    evidenceGrade: "implemented",
    liveValidated: false,
  });
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.features), true);
  assert.equal(Object.isFrozen(report.engine), true);
  assert.equal(Object.isFrozen(report.support), true);
});

async function rootVerificationContext(project) {
  const root = await core.canonicalizeProjectRoot(project);
  const executable = await core.bindProcessExecutable({
    path: process.execPath,
    maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    allowedEnvironmentKeys: [],
  });
  const binding = await engineCommon.captureEngineExecutionSnapshots({
    root,
    executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      project: "golden-graybox",
    }),
  });
  return { root, executable, binding };
}

test("canonical Godot graybox root matches the complete execution snapshot", async () => {
  const context = await rootVerificationContext(fileURLToPath(projectRoot));
  const report = await godot.verifyGodotGrayboxProjectRoot(context);

  assert.equal(report.projectId, "golden.graybox.godot");
  assert.equal(report.fileCount, 6);
  assert.equal(report.manifestDigest, godot.GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST);
});

test("Godot graybox root rejects undeclared snapshot source and request accessors", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-graybox-root-"));
  const project = join(sandbox, "project");
  await cp(fileURLToPath(projectRoot), project, { recursive: true });
  await writeFile(join(project, "undeclared.gd"), "extends Node\n");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const context = await rootVerificationContext(project);

  await assert.rejects(
    godot.verifyGodotGrayboxProjectRoot(context),
    expectGodotError("godot-graybox-source-drift"),
  );

  let invoked = false;
  const hostile = {
    binding: context.binding,
    executable: context.executable,
  };
  Object.defineProperty(hostile, "root", {
    enumerable: true,
    get() {
      invoked = true;
      return context.root;
    },
  });
  await assert.rejects(
    godot.verifyGodotGrayboxProjectRoot(hostile),
    expectGodotError("godot-graybox-request-invalid"),
  );
  assert.equal(invoked, false);
});

test("Godot project carries the exact engine-neutral scenario", async () => {
  const source = await fixture();
  const projectScenario = JSON.parse(
    source.files.find(({ path }) => path === "scenario.json").text,
  );
  const canonicalScenario = JSON.parse(
    await readFile(new URL("../../../golden/graybox/scenario.json", import.meta.url), "utf8"),
  );

  assert.deepEqual(projectScenario, canonicalScenario);
  assert.equal(
    contracts.computePlaytestScenarioDigest(projectScenario),
    source.manifest.scenario.digest,
  );
  assert.deepEqual(contracts.checkPlaytestScenarioSemantics(projectScenario), []);
});

test("Godot graybox verification rejects missing, extra, and changed source", async () => {
  const source = await fixture();
  const withoutReplay = {
    manifest: source.manifest,
    files: source.files.filter(
      ({ path }) => path !== "scripts/graybox_replay.gd",
    ),
  };
  assert.throws(
    () => godot.verifyGodotGrayboxProjectBundle(withoutReplay),
    expectGodotError("godot-graybox-source-invalid"),
  );

  assert.throws(
    () =>
      godot.verifyGodotGrayboxProjectBundle({
        manifest: source.manifest,
        files: [
          ...source.files,
          { path: "unexpected.txt", text: "unexpected\n" },
        ],
      }),
    expectGodotError("godot-graybox-source-invalid"),
  );

  const changed = source.files.map((file) =>
    file.path === "scripts/graybox_game.gd"
      ? { ...file, text: file.text.replace("CharacterBody3D", "Node3D") }
      : file,
  );
  assert.throws(
    () =>
      godot.verifyGodotGrayboxProjectBundle({
        manifest: source.manifest,
        files: changed,
      }),
    expectGodotError("godot-graybox-source-drift"),
  );
});

test("Godot graybox parsing rejects hostile values without invoking them", async () => {
  const source = await fixture();
  let invoked = false;
  const request = { manifest: source.manifest, files: source.files };
  Object.defineProperty(request, "files", {
    enumerable: true,
    get() {
      invoked = true;
      return source.files;
    },
  });
  assert.throws(
    () => godot.verifyGodotGrayboxProjectBundle(request),
    expectGodotError("godot-graybox-request-invalid"),
  );
  assert.equal(invoked, false);

  const trap = () => {
    invoked = true;
    throw new Error("proxy trap must not run");
  };
  const hostileManifest = new Proxy(
    {},
    {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    },
  );
  assert.throws(
    () =>
      godot.verifyGodotGrayboxProjectBundle({
        manifest: hostileManifest,
        files: source.files,
      }),
    expectGodotError("godot-graybox-manifest-invalid"),
  );
  assert.equal(invoked, false);

  const promoted = structuredClone(source.manifest);
  promoted.support.liveValidated = true;
  assert.throws(
    () =>
      godot.verifyGodotGrayboxProjectBundle({
        manifest: promoted,
        files: source.files,
      }),
    expectGodotError("godot-graybox-manifest-invalid"),
  );
});

test("Godot graybox verification rejects noncanonical source text", async () => {
  const source = await fixture();
  for (const replacement of [
    (text) => text.replaceAll("\n", "\r\n"),
    (text) => `\uFEFF${text}`,
    (text) => text.slice(0, -1),
  ]) {
    const files = source.files.map((file) =>
      file.path === "project.godot"
        ? { ...file, text: replacement(file.text) }
        : file,
    );
    assert.throws(
      () =>
        godot.verifyGodotGrayboxProjectBundle({
          manifest: source.manifest,
          files,
        }),
      expectGodotError("godot-graybox-source-invalid"),
    );
  }
});

test("Godot project text extensions stay pinned to LF checkouts", async () => {
  const lines = new Set(
    (await readFile(attributesUrl, "utf8")).split("\n").filter(Boolean),
  );

  for (const rule of [
    "*.gd text eol=lf",
    "*.godot text eol=lf",
    "*.json text eol=lf",
    "*.tscn text eol=lf",
  ]) {
    assert.equal(lines.has(rule), true, `missing Git attribute: ${rule}`);
  }
});
