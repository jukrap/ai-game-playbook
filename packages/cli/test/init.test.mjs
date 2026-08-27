import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as registry from "@ai-game-playbook/registry";
import * as cli from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-cli-init-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, sandbox };
}

test("init produces an immutable validated plan without changing the project", async (t) => {
  assert.equal(typeof cli.runInit, "function");
  const { project } = await fixture(t);
  const before = await readdir(project);

  const report = await cli.runInit({
    schemaVersion: "1.0.0",
    projectRoot: project,
  });

  assert.equal(report.commandId, "init");
  assert.equal(report.mode, "plan-only");
  assert.equal(report.status, "ready");
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.applySupported, false);
  assert.equal(report.externalInstallPlanned, false);
  assert.equal(report.networkAccessPlanned, false);
  assert.equal(report.summary.create, 20);
  assert.equal(report.summary.retain, 0);
  assert.equal(report.summary.conflict, 0);
  assert.equal(report.targets.length, 20);
  assert.deepEqual(report.issues, []);
  assert.match(report.planDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.targets), true);
  assert.equal(Object.isFrozen(report.issues), true);
  assert.deepEqual(await readdir(project), before);

  const descriptor = registry.BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "init",
  );
  assert.notEqual(descriptor, undefined);
  const validated = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    descriptor.output,
    report,
  );
  assert.equal(validated.planDigest, report.planDigest);
});

test("init reports unavailable roots and project-local conflicts without mutation", async (t) => {
  const { project, sandbox } = await fixture(t);
  const unavailable = join(sandbox, "missing");
  const missing = await cli.runInit({
    schemaVersion: "1.0.0",
    projectRoot: unavailable,
  });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.project.requestedPath, unavailable);
  assert.equal(missing.project.canonicalPath, undefined);
  assert.equal(missing.planDigest, undefined);
  assert.deepEqual(missing.targets, []);
  assert.equal(missing.issues[0].code, "project-root-not-found");

  await mkdir(join(project, ".ai-game-playbook"));
  await writeFile(
    join(project, ".ai-game-playbook", "policies"),
    "user-owned\n",
  );
  const before = await readdir(join(project, ".ai-game-playbook"));
  const conflict = await cli.runInit({
    schemaVersion: "1.0.0",
    projectRoot: project,
  });
  assert.equal(conflict.status, "blocked");
  assert.equal(conflict.summary.conflict, 1);
  assert.equal(conflict.issues[0].code, "project-path-type-mismatch");
  assert.deepEqual(
    await readdir(join(project, ".ai-game-playbook")),
    before,
  );
});

test("CLI init human and JSON modes share status and reject apply", async (t) => {
  const { project } = await fixture(t);
  const json = await cli.runCli(["init", "--project", project, "--json"]);
  assert.equal(json.exitCode, cli.CLI_EXIT_CODES.success);
  const report = JSON.parse(json.stdout);
  assert.equal(report.mode, "plan-only");
  assert.equal(report.status, "ready");
  assert.equal(report.mutationPerformed, false);

  const human = await cli.runCli(["init", "--project", project]);
  assert.equal(human.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(human.stdout, /AI Game Playbook init plan/);
  assert.match(human.stdout, /Mode: plan-only/);
  assert.match(human.stdout, /Files changed: 0/);

  const apply = await cli.runCli(["init", "--project", project, "--apply"]);
  assert.equal(apply.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.match(apply.stderr, /Unknown init option/);
  assert.deepEqual(await readdir(project), []);
});
