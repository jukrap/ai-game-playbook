import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as godot from "../dist/index.js";

async function fixture(t, version = "4.7") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-status-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    `config_version=5\nconfig/features=PackedStringArray("${version}")\n`,
  );
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project };
}

async function manifest(project) {
  const names = (await readdir(project)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      content: await readFile(join(project, name), "utf8"),
    })),
  );
}

function request(projectRoot) {
  return {
    schemaVersion: "1.0.0",
    projectRoot,
    engine: "godot",
  };
}

test("Godot status preserves a detected project and missing executable without writes", async (t) => {
  const { project } = await fixture(t);
  const before = await manifest(project);

  const report = await godot.runGodotEngineStatus(request(project));

  assert.equal(report.status, "attention");
  assert.equal(report.engine, "godot");
  assert.equal(report.project.status, "detected");
  assert.equal(report.executable.status, "not-provided");
  assert.equal(report.compatibility.status, "major-minor-match");
  assert.equal(report.compatibility.targetVersion, "4.7.2");
  assert.equal(report.support.grade, "planned");
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.mutationPerformed, false);
  assert.deepEqual(await manifest(project), before);
  assert.doesNotThrow(() => contracts.assertEngineStatusReportSemantics(report));
});

test("project mismatch blocks support promotion before host inspection", async (t) => {
  const { project } = await fixture(t, "4.8");
  const report = await godot.runGodotEngineStatus(request(project));

  assert.equal(report.status, "blocked");
  assert.equal(report.project.status, "detected");
  assert.equal(report.compatibility.status, "major-minor-mismatch");
  assert.equal(report.executable.status, "not-provided");
  assert.equal(report.support.grade, "planned");
  assert.equal(report.externalProcessStarted, false);
});

test("non-Godot and unavailable projects remain explicit blocked observations", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-status-empty-"));
  const empty = join(sandbox, "empty");
  await mkdir(empty);
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const notDetected = await godot.runGodotEngineStatus(request(empty));
  assert.equal(notDetected.status, "blocked");
  assert.equal(notDetected.project.status, "not-detected");

  const unavailable = await godot.runGodotEngineStatus(
    request(join(sandbox, "missing")),
  );
  assert.equal(unavailable.status, "blocked");
  assert.equal(unavailable.project.status, "blocked");
  assert.equal(unavailable.statusDigest.startsWith("sha256:"), true);
});

test("the registered handler input cannot select a host executable path", async (t) => {
  const { project } = await fixture(t);

  await assert.rejects(() =>
    godot.runGodotEngineStatus({
      ...request(project),
      executablePath: process.execPath,
    }),
  );
});

test("registered status rejects every unapproved host executable option", async (t) => {
  const { project } = await fixture(t);

  await assert.rejects(
    godot.runGodotEngineStatus(request(project), {}),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-status-options-invalid",
  );

  const inherited = Object.create({ executablePath: process.execPath });
  await assert.rejects(() =>
    godot.runGodotEngineStatus(request(project), inherited),
  );

  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, "executablePath", {
    enumerable: true,
    get() {
      getterCalled = true;
      return process.execPath;
    },
  });
  await assert.rejects(() =>
    godot.runGodotEngineStatus(request(project), accessor),
  );
  assert.equal(getterCalled, false);
});
