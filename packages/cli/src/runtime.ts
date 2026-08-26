import { canonicalizeJson } from "@ai-game-playbook/contracts";
import {
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { isAbsolute, resolve } from "node:path";

import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { CliDeadlineError, runWithDeadline } from "./deadline.js";

export interface CliExitCodes {
  readonly success: 0;
  readonly failure: 1;
  readonly usage: 2;
  readonly blocked: 3;
  readonly cancelled: 4;
  readonly uncertain: 5;
}

export interface CliRuntimeOptions {
  readonly cwd?: string;
  readonly nodeVersion?: string;
}

export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export const CLI_EXIT_CODES: CliExitCodes = Object.freeze({
  success: 0,
  failure: 1,
  usage: 2,
  blocked: 3,
  cancelled: 4,
  uncertain: 5,
});

const CLI_MAX_ARGUMENTS = 64;
const CLI_MAX_ARGUMENT_BYTES = 65_536;

function argumentsAreBounded(args: readonly string[]): boolean {
  if (args.length > CLI_MAX_ARGUMENTS) {
    return false;
  }
  let bytes = 0;
  for (const argument of args) {
    if (typeof argument !== "string") {
      return false;
    }
    bytes += Buffer.byteLength(argument, "utf8");
    if (bytes > CLI_MAX_ARGUMENT_BYTES) {
      return false;
    }
  }
  return true;
}

function result(
  exitCode: number,
  stdout = "",
  stderr = "",
): CliRunResult {
  return Object.freeze({ exitCode, stdout, stderr });
}

function helpText(): string {
  const lines = [
    `AI Game Playbook ${BUILTIN_REGISTRY.controlPlaneVersion}`,
    "",
    "Usage: agpb <command> [options]",
    "",
    "Commands:",
  ];
  for (const command of BUILTIN_REGISTRY_SURFACES.cli.data.commands) {
    lines.push(`  ${command.cli.path.join(" ").padEnd(16)} ${command.summary}`);
  }
  lines.push(
    "",
    "Options:",
    "  -h, --help       Show help",
    "  -V, --version    Show version",
    "",
  );
  return `${lines.join("\n")}\n`;
}

function doctorHelpText(): string {
  return [
    "Usage: agpb doctor [--project <path>] [--json]",
    "",
    "Read-only checks for the runtime registry, Node.js, project state, and pack state.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered doctor report as canonical JSON",
    "  -h, --help        Show command help",
    "",
  ].join("\n");
}

function initHelpText(): string {
  return [
    "Usage: agpb init [--project <path>] [--json]",
    "",
    "Plan the fixed project-local layout without changing any files.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered plan-only init report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "Apply is unavailable. This command never initializes, installs, or repairs.",
    "",
  ].join("\n");
}

interface ParsedDoctorArguments {
  readonly json: boolean;
  readonly projectRoot: string;
  readonly help: boolean;
}

function parseDoctorArguments(
  args: readonly string[],
  cwd: string,
): ParsedDoctorArguments | CliRunResult {
  let json = false;
  let help = false;
  let projectValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--json") {
      if (json) {
        return result(CLI_EXIT_CODES.usage, "", "Option --json was repeated.\n");
      }
      json = true;
      continue;
    }
    if (value === "-h" || value === "--help") {
      help = true;
      continue;
    }
    if (value === "--project") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          "Option --project requires one path.\n",
        );
      }
      if (projectValue !== undefined) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          "Option --project was repeated.\n",
        );
      }
      projectValue = next;
      index += 1;
      continue;
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown doctor option.\n${doctorHelpText()}`,
    );
  }

  const projectRoot =
    projectValue === undefined
      ? cwd
      : isAbsolute(projectValue)
        ? projectValue
        : resolve(cwd, projectValue);
  return Object.freeze({ json, projectRoot, help });
}

function parseInitArguments(
  args: readonly string[],
  cwd: string,
): ParsedDoctorArguments | CliRunResult {
  let json = false;
  let help = false;
  let projectValue: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--json") {
      if (json) {
        return result(CLI_EXIT_CODES.usage, "", "Option --json was repeated.\n");
      }
      json = true;
      continue;
    }
    if (value === "-h" || value === "--help") {
      help = true;
      continue;
    }
    if (value === "--project") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          "Option --project requires one path.\n",
        );
      }
      if (projectValue !== undefined) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          "Option --project was repeated.\n",
        );
      }
      projectValue = next;
      index += 1;
      continue;
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown init option.\n${initHelpText()}`,
    );
  }

  const projectRoot =
    projectValue === undefined
      ? cwd
      : isAbsolute(projectValue)
        ? projectValue
        : resolve(cwd, projectValue);
  return Object.freeze({ json, projectRoot, help });
}

function humanDoctorReport(report: Awaited<ReturnType<typeof runDoctor>>): string {
  const lines = [
    "AI Game Playbook doctor",
    `Status: ${report.status}`,
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    "",
  ];
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(8)} ${check.id}  ${check.message}`);
    if (check.nextAction !== undefined) {
      lines.push(`         Next: ${check.nextAction}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function humanInitReport(report: Awaited<ReturnType<typeof runInit>>): string {
  const lines = [
    "AI Game Playbook init plan",
    `Status: ${report.status}`,
    `Mode: ${report.mode}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Targets: create ${report.summary.create}, retain ${report.summary.retain}, conflict ${report.summary.conflict}`,
    "",
  ];
  for (const target of report.targets) {
    lines.push(
      `${target.action.toUpperCase().padEnd(8)} ${target.policy.padEnd(10)} ${target.kind.padEnd(9)} ${target.path}`,
    );
  }
  for (const issue of report.issues) {
    lines.push("", `BLOCKED  ${issue.path ?? issue.code}  ${issue.message}`);
    lines.push(`         Next: ${issue.nextAction}`);
  }
  if (report.planDigest !== undefined) {
    lines.push("", `Plan digest: ${report.planDigest}`);
  }
  lines.push("Apply support: unavailable; no project state was changed.");
  return `${lines.join("\n")}\n`;
}

async function dispatchInit(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseInitArguments(args, cwd);
  if ("exitCode" in parsed) {
    return parsed;
  }
  if (parsed.help) {
    return result(CLI_EXIT_CODES.success, initHelpText());
  }

  const descriptor = BUILTIN_REGISTRY.commands.find(({ id }) => id === "init");
  if (descriptor === undefined) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "The init command is unavailable in the runtime registry.\n",
    );
  }
  let input: ReturnType<typeof validateRegisteredContractValue>;
  try {
    input = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      descriptor.input,
      { schemaVersion: "1.0.0", projectRoot: parsed.projectRoot },
    );
  } catch {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "Init input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(() => runInit(input), descriptor.timeoutMs);
    return result(
      report.status === "blocked"
        ? CLI_EXIT_CODES.blocked
        : CLI_EXIT_CODES.success,
      parsed.json ? `${canonicalizeJson(report)}\n` : humanInitReport(report),
    );
  } catch (error) {
    if (error instanceof CliDeadlineError) {
      return result(
        CLI_EXIT_CODES.failure,
        "",
        "Init planning exceeded its registered deadline without producing a report.\n",
      );
    }
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "Init planning failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchDoctor(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseDoctorArguments(args, cwd);
  if ("exitCode" in parsed) {
    return parsed;
  }
  if (parsed.help) {
    return result(CLI_EXIT_CODES.success, doctorHelpText());
  }

  const descriptor = BUILTIN_REGISTRY.commands.find(({ id }) => id === "doctor");
  if (descriptor === undefined) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "The doctor command is unavailable in the runtime registry.\n",
    );
  }
  let input: ReturnType<typeof validateRegisteredContractValue>;
  try {
    input = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      descriptor.input,
      { schemaVersion: "1.0.0", projectRoot: parsed.projectRoot },
    );
  } catch {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "Doctor input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () =>
        runDoctor(input, {
          nodeVersion: options.nodeVersion ?? process.versions.node,
        }),
      descriptor.timeoutMs,
    );
    const exitCode =
      report.status === "blocked"
        ? CLI_EXIT_CODES.blocked
        : CLI_EXIT_CODES.success;
    return result(
      exitCode,
      parsed.json ? `${canonicalizeJson(report)}\n` : humanDoctorReport(report),
    );
  } catch (error) {
    if (error instanceof CliDeadlineError) {
      return result(
        CLI_EXIT_CODES.failure,
        "",
        "Doctor exceeded its registered deadline without producing a report.\n",
      );
    }
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "Doctor failed before it could produce a validated report.\n",
    );
  }
}

export async function runCli(
  args: readonly string[],
  options: CliRuntimeOptions = {},
): Promise<CliRunResult> {
  if (!Array.isArray(args) || !argumentsAreBounded(args)) {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "CLI arguments exceed the supported count or byte limit.\n",
    );
  }
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    return result(CLI_EXIT_CODES.success, helpText());
  }
  if (args[0] === "-V" || args[0] === "--version") {
    if (args.length !== 1) {
      return result(
        CLI_EXIT_CODES.usage,
        "",
        "Option --version does not accept arguments.\n",
      );
    }
    return result(
      CLI_EXIT_CODES.success,
      `${BUILTIN_REGISTRY.controlPlaneVersion}\n`,
    );
  }
  if (args[0] === "doctor") {
    return dispatchDoctor(args.slice(1), options);
  }
  if (args[0] === "init") {
    return dispatchInit(args.slice(1), options);
  }
  return result(
    CLI_EXIT_CODES.usage,
    "",
    `Unknown command.\n${helpText()}`,
  );
}
