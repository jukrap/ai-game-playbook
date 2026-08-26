import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalizeJson, parseStableId } from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as packRuntime from "@ai-game-playbook/pack-runtime";
import * as registry from "@ai-game-playbook/registry";
import * as cli from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-cli-doctor-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

async function treeSnapshot(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const snapshot = [];
  for (const entry of entries) {
    const relative = entry.parentPath.slice(root.length + 1);
    const path = relative.length === 0 ? entry.name : join(relative, entry.name);
    snapshot.push({
      path,
      kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
      content: entry.isFile() ? await readFile(join(root, path), "utf8") : undefined,
    });
  }
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

test("doctor reports an uninitialized project without mutating it", async (t) => {
  const { project } = await fixture(t);
  const before = await treeSnapshot(project);

  const report = await cli.runDoctor(
    { schemaVersion: "1.0.0", projectRoot: project },
    { nodeVersion: "22.22.0" },
  );

  assert.equal(report.status, "attention");
  assert.equal(report.project.state, "uninitialized");
  assert.equal(
    report.checks.find(({ id }) => id === "project.state").status,
    "warning",
  );
  assert.deepEqual(await treeSnapshot(project), before);

  const doctor = registry.BUILTIN_REGISTRY.commands[0];
  assert.doesNotThrow(() =>
    registry.validateRegisteredContractValue(
      registry.BUILTIN_REGISTRY,
      doctor.output,
      report,
    ),
  );
});

test("doctor reports a complete empty runtime state as healthy", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  const before = await treeSnapshot(project);

  const report = await cli.runDoctor(
    { schemaVersion: "1.0.0", projectRoot: project },
    { nodeVersion: "22.22.0" },
  );

  assert.equal(report.status, "healthy", JSON.stringify(report, null, 2));
  assert.equal(report.project.state, "ready");
  assert.equal(report.checks.every(({ status }) => status === "passed"), true);
  assert.deepEqual(await treeSnapshot(project), before);
});

test("doctor validates canonical installed pack state against the bound project", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  const initial = packRuntime.createEmptyInstalledPackState({
    id: parseStableId("project.doctor-test"),
    identityDigest: root.identityDigest,
  });
  const installedBody = {
    schemaVersion: initial.schemaVersion,
    project: initial.project,
    revision: 2,
    packs: initial.packs,
  };
  const installed = {
    ...installedBody,
    stateDigest: packRuntime.computeInstalledPackStateDigest(installedBody),
  };
  await writeFile(
    join(project, ".ai-game-playbook", "state", "packs", "installed.json"),
    `${canonicalizeJson(installed)}\n`,
    "utf8",
  );
  const before = await treeSnapshot(project);

  const report = await cli.runDoctor(
    { schemaVersion: "1.0.0", projectRoot: project },
    { nodeVersion: "22.22.0" },
  );

  assert.equal(report.status, "healthy", JSON.stringify(report, null, 2));
  assert.equal(
    report.checks.find(({ id }) => id === "pack.state").code,
    "pack-state-valid",
  );
  assert.deepEqual(await treeSnapshot(project), before);
});

test("doctor blocks unsupported runtimes and corrupt managed state", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  await writeFile(
    join(project, ".ai-game-playbook", "state", "packs", "installed.json"),
    '{"not":"canonical-pack-state"}\n',
    "utf8",
  );

  const report = await cli.runDoctor(
    { schemaVersion: "1.0.0", projectRoot: project },
    { nodeVersion: "23.0.0" },
  );

  assert.equal(report.status, "blocked");
  assert.equal(
    report.checks.find(({ id }) => id === "runtime.node").status,
    "blocked",
  );
  assert.equal(
    report.checks.find(({ id }) => id === "pack.state").status,
    "blocked",
  );
});

test("doctor blocks a surviving or malformed active pack transaction marker", async (t) => {
  const { project } = await fixture(t);
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  await writeFile(
    join(project, ".ai-game-playbook", "state", "packs", "active.json"),
    '{"transaction":"unfinished"}\n',
    "utf8",
  );

  const report = await cli.runDoctor(
    { schemaVersion: "1.0.0", projectRoot: project },
    { nodeVersion: "22.22.0" },
  );

  assert.equal(report.status, "blocked");
  assert.equal(
    report.checks.find(({ id }) => id === "pack.transaction").status,
    "blocked",
  );
});
