import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as cli from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-cli-runtime-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project };
}

test("CLI help and version are derived from the implemented runtime surface", async () => {
  const help = await cli.runCli(["--help"]);
  assert.equal(help.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(help.stdout, /^AI Game Playbook 0\.0\.0/m);
  assert.match(help.stdout, /doctor\s+Inspect/);
  assert.doesNotMatch(help.stdout, /pack add/);
  assert.equal(help.stderr, "");

  const version = await cli.runCli(["--version"]);
  assert.equal(version.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(version.stdout, "0.0.0\n");
});

test("doctor JSON and human output agree with stable exit categories", async (t) => {
  const { project } = await fixture(t);

  const json = await cli.runCli([
    "doctor",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(json.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.equal(report.commandId, "doctor");
  assert.equal(report.status, "attention");

  const human = await cli.runCli(["doctor", "--project", project]);
  assert.equal(human.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(human.stdout, /Status: attention/);
  assert.match(human.stdout, /WARNING\s+project\.state/);
});

test("CLI fails closed on unknown commands, flags, and missing option values", async () => {
  for (const args of [
    ["pack", "add"],
    ["doctor", "--repair"],
    ["doctor", "--project"],
  ]) {
    const result = await cli.runCli(args);
    assert.equal(result.exitCode, cli.CLI_EXIT_CODES.usage);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage|Unknown|requires/);
  }
});

test("CLI bounds arguments, contains schema failures, and does not reflect terminal controls", async () => {
  const controlText = "\u001b[31msecret\u001b[0m";
  const unknown = await cli.runCli([controlText]);
  assert.equal(unknown.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.equal(unknown.stderr.includes(controlText), false);

  const oversized = await cli.runCli([
    "doctor",
    "--project",
    `C:\\${"a".repeat(70_000)}`,
  ]);
  assert.equal(oversized.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.match(oversized.stderr, /argument|input/i);

  const excessive = await cli.runCli(
    Array.from({ length: 65 }, () => "unknown"),
  );
  assert.equal(excessive.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.match(excessive.stderr, /argument/i);
});

test("CLI maps a blocked doctor report to the blocked exit category", async () => {
  const result = await cli.runCli(
    ["doctor", "--json"],
    { cwd: "relative-root-is-invalid", nodeVersion: "23.0.0" },
  );
  assert.equal(result.exitCode, cli.CLI_EXIT_CODES.blocked);
  assert.equal(JSON.parse(result.stdout).status, "blocked");
});
