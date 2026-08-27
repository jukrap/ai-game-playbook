import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.match(help.stdout, /init\s+Plan/);
  assert.match(help.stdout, /doctor\s+Inspect/);
  assert.match(help.stdout, /engine capabilities\s+Report/);
  assert.match(help.stdout, /engine status\s+Inspect/);
  assert.match(help.stdout, /project inspect\s+Inspect/);
  assert.match(help.stdout, /pack doctor\s+Inspect/);
  assert.match(help.stdout, /pack list\s+List/);
  assert.match(help.stdout, /skill check\s+Inspect/);
  assert.match(help.stdout, /skill list\s+List/);
  assert.doesNotMatch(help.stdout, /pack add/);
  assert.equal(help.stderr, "");

  const version = await cli.runCli(["--version"]);
  assert.equal(version.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(version.stdout, "0.0.0\n");
});

test("project inspect JSON and human modes preserve static attention", async (t) => {
  const { project } = await fixture(t);

  const json = await cli.runCli([
    "project",
    "inspect",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(json.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.equal(report.commandId, "project.inspect");
  assert.equal(report.status, "attention");
  assert.equal(report.engine.status, "none");
  assert.equal(report.mutationPerformed, false);

  const human = await cli.runCli([
    "project",
    "inspect",
    "--project",
    project,
  ]);
  assert.equal(human.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(human.stdout, /AI Game Playbook project inspect/);
  assert.match(human.stdout, /Status: attention/);
  assert.match(human.stdout, /Engine: none/);
  assert.match(human.stdout, /Files changed: 0/);
});

test("project inspect maps engine ambiguity to the blocked exit category", async (t) => {
  const { project } = await fixture(t);
  await writeFile(join(project, "project.godot"), "config_version=5\n", "utf8");
  await writeFile(
    join(project, "Sample.uproject"),
    '{"EngineAssociation":"5.8"}\n',
    "utf8",
  );

  const output = await cli.runCli([
    "project",
    "inspect",
    "--project",
    project,
    "--json",
  ]);

  assert.equal(output.exitCode, cli.CLI_EXIT_CODES.blocked);
  assert.equal(JSON.parse(output.stdout).engine.status, "ambiguous");
});

test("engine status exposes bounded Godot project compatibility without host tool reads", async (t) => {
  const { project } = await fixture(t);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
    "utf8",
  );

  const json = await cli.runCli([
    "engine",
    "status",
    "--engine",
    "godot",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(json.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.equal(report.commandId, "engine.status");
  assert.equal(report.status, "attention");
  assert.equal(report.engine, "godot");
  assert.equal(report.project.status, "detected");
  assert.equal(report.executable.status, "not-provided");
  assert.equal(report.compatibility.targetVersion, "4.7.2");
  assert.equal(report.support.grade, "planned");
  assert.equal(report.externalProcessStarted, false);

  const human = await cli.runCli([
    "engine",
    "status",
    "--engine",
    "godot",
    "--project",
    project,
  ]);
  assert.equal(human.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(human.stdout, /AI Game Playbook engine status/);
  assert.match(human.stdout, /Support: planned/);
  assert.match(human.stdout, /Executable: not-provided/);
  assert.match(human.stdout, /Files changed: 0/);
});

test("engine capabilities expose identity-bound planned operations without execution", async (t) => {
  const { project } = await fixture(t);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
    "utf8",
  );

  const json = await cli.runCli([
    "engine",
    "capabilities",
    "--engine",
    "godot",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(json.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(json.stderr, "");
  const report = JSON.parse(json.stdout);
  assert.equal(report.commandId, "engine.capabilities");
  assert.equal(report.status, "attention");
  assert.equal(report.containment.providerCount, 0);
  assert.equal(report.containment.launchAvailable, false);
  assert.equal(report.capabilityReport.capabilities.length, 14);
  assert.equal(
    report.capabilityReport.capabilities.every(
      ({ support }) => support === "planned",
    ),
    true,
  );
  assert.equal(report.externalProcessStarted, false);

  const human = await cli.runCli([
    "engine",
    "capabilities",
    "--engine",
    "godot",
    "--project",
    project,
  ]);
  assert.equal(human.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(human.stdout, /AI Game Playbook engine capabilities/);
  assert.match(human.stdout, /Identity-bound operations: 14/);
  assert.match(human.stdout, /Containment providers: 0/);
  assert.match(human.stdout, /Support ceiling: planned/);
  assert.match(human.stdout, /Files changed: 0/);

  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.8")\n',
    "utf8",
  );
  const blocked = await cli.runCli([
    "engine",
    "capabilities",
    "--engine",
    "godot",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(blocked.exitCode, cli.CLI_EXIT_CODES.blocked);
  assert.equal(JSON.parse(blocked.stdout).capabilityReport, undefined);
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

test("pack list and doctor expose read-only JSON and human reports", async (t) => {
  const { project } = await fixture(t);

  const listed = await cli.runCli([
    "pack",
    "list",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(listed.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(listed.stderr, "");
  const listReport = JSON.parse(listed.stdout);
  assert.equal(listReport.commandId, "pack.list");
  assert.equal(listReport.status, "attention");
  assert.equal(listReport.entries.length, 0);
  assert.equal(listReport.mutationPerformed, false);

  const listHuman = await cli.runCli([
    "pack",
    "list",
    "--project",
    project,
  ]);
  assert.equal(listHuman.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(listHuman.stdout, /AI Game Playbook pack list/);
  assert.match(listHuman.stdout, /Installed packs: 0/);
  assert.match(listHuman.stdout, /Files changed: 0/);

  const diagnosed = await cli.runCli([
    "pack",
    "doctor",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(diagnosed.exitCode, cli.CLI_EXIT_CODES.success);
  const doctorReport = JSON.parse(diagnosed.stdout);
  assert.equal(doctorReport.commandId, "pack.doctor");
  assert.equal(doctorReport.status, "attention");
  assert.equal(doctorReport.recoveryFinalizationPerformed, false);

  const doctorHuman = await cli.runCli([
    "pack",
    "doctor",
    "--project",
    project,
  ]);
  assert.equal(doctorHuman.exitCode, cli.CLI_EXIT_CODES.success);
  assert.match(doctorHuman.stdout, /AI Game Playbook pack doctor/);
  assert.match(doctorHuman.stdout, /Transaction: not-inspected/);
  assert.match(doctorHuman.stdout, /Files changed: 0/);
});

test("CLI fails closed on unknown commands, flags, and missing option values", async () => {
  for (const args of [
    ["pack", "add"],
    ["pack", "update"],
    ["pack", "remove"],
    ["pack", "list", "--source", "D:\\packs"],
    ["pack", "doctor", "--repair"],
    ["skill", "install"],
    ["doctor", "--repair"],
    ["init", "--apply"],
    ["doctor", "--project"],
    ["project"],
    ["project", "status"],
    ["project", "inspect", "--connect"],
    ["project", "inspect", "--project"],
    ["project", "inspect", "--project", "one", "--project", "two"],
    ["engine"],
    ["engine", "connect"],
    ["engine", "capabilities"],
    ["engine", "capabilities", "--engine", "unity"],
    ["engine", "capabilities", "--engine", "godot", "--provider", "x"],
    ["engine", "capabilities", "--engine", "godot", "--executable", process.execPath],
    ["engine", "status"],
    ["engine", "status", "--engine", "unity"],
    ["engine", "status", "--engine", "godot", "--executable", process.execPath],
  ]) {
    const result = await cli.runCli(args);
    assert.equal(result.exitCode, cli.CLI_EXIT_CODES.usage);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage|Unknown|requires|repeated/);
  }
});

test("skill CLI commands expose read-only JSON and stable exit categories", async (t) => {
  const { project } = await fixture(t);

  const listed = await cli.runCli([
    "skill",
    "list",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(listed.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(JSON.parse(listed.stdout).commandId, "skill.list");

  const missing = await cli.runCli([
    "skill",
    "check",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(missing.exitCode, cli.CLI_EXIT_CODES.success);
  assert.equal(JSON.parse(missing.stdout).status, "attention");

  await mkdir(
    join(project, ".agents", "skills", "project-inspection"),
    { recursive: true },
  );
  await writeFile(
    join(project, ".agents", "skills", "project-inspection", "SKILL.md"),
    "conflicting local skill\n",
  );
  const conflict = await cli.runCli([
    "skill",
    "check",
    "--project",
    project,
    "--json",
  ]);
  assert.equal(conflict.exitCode, cli.CLI_EXIT_CODES.blocked);
  assert.equal(JSON.parse(conflict.stdout).status, "blocked");
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

test("CLI rejects accessor arguments without invoking them", async () => {
  let getterCalled = false;
  const args = [];
  Object.defineProperty(args, "0", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "--version";
    },
  });

  const output = await cli.runCli(args);

  assert.equal(getterCalled, false);
  assert.equal(output.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /argument/i);
});

test("CLI rejects hidden and nonstandard argument array state", async () => {
  class CustomArguments extends Array {}

  const hidden = ["--version"];
  Object.defineProperty(hidden, "provider", { value: "hidden" });
  const symbol = ["--version"];
  symbol[Symbol("provider")] = "hidden";
  let proxyTrapCalled = false;
  const proxied = new Proxy(["--version"], {
    get(target, property, receiver) {
      proxyTrapCalled = true;
      return Reflect.get(target, property, receiver);
    },
  });

  for (const args of [
    hidden,
    symbol,
    new CustomArguments("--version"),
    proxied,
  ]) {
    const output = await cli.runCli(args);
    assert.equal(output.exitCode, cli.CLI_EXIT_CODES.usage);
    assert.equal(output.stdout, "");
    assert.match(output.stderr, /argument/i);
  }
  assert.equal(proxyTrapCalled, false);
});

test("CLI rejects malformed runtime options without invoking accessors", async () => {
  let getterCalled = false;
  const accessorOptions = {};
  Object.defineProperty(accessorOptions, "cwd", {
    enumerable: true,
    get() {
      getterCalled = true;
      return process.cwd();
    },
  });

  const accessorOutput = await cli.runCli(["doctor", "--json"], accessorOptions);
  assert.equal(getterCalled, false);
  assert.equal(accessorOutput.exitCode, cli.CLI_EXIT_CODES.usage);
  assert.equal(accessorOutput.stdout, "");
  assert.match(accessorOutput.stderr, /runtime options/i);

  const hidden = { cwd: process.cwd() };
  Object.defineProperty(hidden, "provider", { value: "hidden" });
  const symbol = { cwd: process.cwd() };
  symbol[Symbol("provider")] = "hidden";
  const inherited = Object.create({ cwd: process.cwd() });
  const unexpected = { cwd: process.cwd(), provider: "hidden" };

  for (const options of [hidden, symbol, inherited, unexpected]) {
    const output = await cli.runCli(["--version"], options);
    assert.equal(output.exitCode, cli.CLI_EXIT_CODES.usage);
    assert.equal(output.stdout, "");
    assert.match(output.stderr, /runtime options/i);
  }
});

test("CLI maps a blocked doctor report to the blocked exit category", async () => {
  const result = await cli.runCli(
    ["doctor", "--json"],
    { cwd: "relative-root-is-invalid", nodeVersion: "23.0.0" },
  );
  assert.equal(result.exitCode, cli.CLI_EXIT_CODES.blocked);
  assert.equal(JSON.parse(result.stdout).status, "blocked");
});
