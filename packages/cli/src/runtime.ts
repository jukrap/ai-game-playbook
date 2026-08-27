import { canonicalizeJson } from "@ai-game-playbook/contracts";
import {
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import {
  runGodotEngineCapabilities,
  runGodotEngineStatus,
} from "@ai-game-playbook/godot-adapter";
import {
  runPackDoctor,
  runPackList,
} from "@ai-game-playbook/pack-runtime";
import { isAbsolute, resolve } from "node:path";

import { runDoctor } from "./doctor.js";
import { runInit } from "./init.js";
import { runProjectInspect } from "./project-inspect.js";
import { runSkillCheck } from "./skill-check.js";
import { runSkillList } from "./skill-list.js";
import { CliDeadlineError, runWithDeadline } from "./deadline.js";
import {
  snapshotDenseDataArray,
  snapshotOptionalDataRecord,
} from "./plain-data.js";

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
const CLI_RUNTIME_OPTION_KEYS = ["cwd", "nodeVersion"] as const;

function snapshotCliArguments(value: unknown): readonly string[] | undefined {
  const values = snapshotDenseDataArray(value, CLI_MAX_ARGUMENTS);
  if (values === undefined) return undefined;

  let bytes = 0;
  const snapshot: string[] = [];
  for (const argument of values) {
    if (typeof argument !== "string") {
      return undefined;
    }
    bytes += Buffer.byteLength(argument, "utf8");
    if (bytes > CLI_MAX_ARGUMENT_BYTES) {
      return undefined;
    }
    snapshot.push(argument);
  }
  return Object.freeze(snapshot);
}

function snapshotCliRuntimeOptions(
  value: unknown,
): CliRuntimeOptions | undefined {
  const record = snapshotOptionalDataRecord(value, CLI_RUNTIME_OPTION_KEYS);
  if (record === undefined) return undefined;

  const snapshot: { cwd?: string; nodeVersion?: string } = {};
  if (Object.hasOwn(record, "cwd")) {
    if (typeof record.cwd !== "string") return undefined;
    snapshot.cwd = record.cwd;
  }
  if (Object.hasOwn(record, "nodeVersion")) {
    if (typeof record.nodeVersion !== "string") return undefined;
    snapshot.nodeVersion = record.nodeVersion;
  }
  return Object.freeze(snapshot);
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

function projectInspectHelpText(): string {
  return [
    "Usage: agpb project inspect [--project <path>] [--json]",
    "",
    "Inspect static Godot, Unity, or Unreal project identity without mutation.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered inspection report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "This command does not run Git, enumerate processes, connect to an Editor, or change files.",
    "",
  ].join("\n");
}

function engineStatusHelpText(): string {
  return [
    "Usage: agpb engine status --engine godot [--project <path>] [--json]",
    "",
    "Inspect static Godot project compatibility without running or locating an engine.",
    "",
    "Options:",
    "  --engine godot   Select the implemented static Godot adapter",
    "  --project <path> Select a project root; defaults to the current directory",
    "  --json           Emit the registered engine status report as canonical JSON",
    "  -h, --help       Show command help",
    "",
    "Host executable discovery and explicit executable paths are unavailable on this surface.",
    "",
  ].join("\n");
}

function engineCapabilitiesHelpText(): string {
  return [
    "Usage: agpb engine capabilities --engine godot [--project <path>] [--json]",
    "",
    "Report identity-bound planned Godot operations and containment gaps without engine execution.",
    "",
    "Options:",
    "  --engine godot   Select the implemented static Godot adapter",
    "  --project <path> Select a project root; defaults to the current directory",
    "  --json           Emit the registered engine capabilities report as canonical JSON",
    "  -h, --help       Show command help",
    "",
    "This command does not discover executables, run containment self-tests, launch Godot, or raise support above planned.",
    "",
  ].join("\n");
}

function skillListHelpText(): string {
  return [
    "Usage: agpb skill list [--project <path>] [--json]",
    "",
    "List the bounded registry skill catalog without materialization.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered skill catalog report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "Skill installation is unavailable. This command never changes project files.",
    "",
  ].join("\n");
}

function skillCheckHelpText(): string {
  return [
    "Usage: agpb skill check [--project <path>] [--json]",
    "",
    "Inspect packaged skill targets in one project without mutation.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered skill check report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "This command reports missing, current, conflicting, and unsafe targets without repair.",
    "",
  ].join("\n");
}

function packListHelpText(): string {
  return [
    "Usage: agpb pack list [--project <path>] [--json]",
    "",
    "List bounded installed-pack metadata without reading artifact content.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered pack list report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "Pack installation and source selection are unavailable on this read-only surface.",
    "",
  ].join("\n");
}

function packDoctorHelpText(): string {
  return [
    "Usage: agpb pack doctor [--project <path>] [--json]",
    "",
    "Inspect bounded installed-pack ownership and recovery state without mutation.",
    "",
    "Options:",
    "  --project <path>  Select a project root; defaults to the current directory",
    "  --json            Emit the registered pack doctor report as canonical JSON",
    "  -h, --help        Show command help",
    "",
    "Repair and transaction finalization are unavailable on this read-only surface.",
    "",
  ].join("\n");
}

interface ParsedDoctorArguments {
  readonly json: boolean;
  readonly projectRoot: string;
  readonly help: boolean;
}

interface ParsedEngineStatusArguments {
  readonly json: boolean;
  readonly projectRoot: string;
  readonly engine: "godot";
  readonly help: boolean;
}

interface ParsedEngineCapabilitiesArguments {
  readonly json: boolean;
  readonly projectRoot: string;
  readonly engine: "godot";
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

function parseProjectInspectArguments(
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
      `Unknown project inspect option.\n${projectInspectHelpText()}`,
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

function parseEngineStatusArguments(
  args: readonly string[],
  cwd: string,
): ParsedEngineStatusArguments | CliRunResult {
  let json = false;
  let help = false;
  let projectValue: string | undefined;
  let engineValue: string | undefined;
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
    if (value === "--project" || value === "--engine") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          `Option ${value} requires one value.\n`,
        );
      }
      if (value === "--project") {
        if (projectValue !== undefined) {
          return result(
            CLI_EXIT_CODES.usage,
            "",
            "Option --project was repeated.\n",
          );
        }
        projectValue = next;
      } else {
        if (engineValue !== undefined) {
          return result(
            CLI_EXIT_CODES.usage,
            "",
            "Option --engine was repeated.\n",
          );
        }
        engineValue = next;
      }
      index += 1;
      continue;
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown engine status option.\n${engineStatusHelpText()}`,
    );
  }
  if (!help && engineValue === undefined) {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Option --engine godot is required.\n${engineStatusHelpText()}`,
    );
  }
  if (engineValue !== undefined && engineValue !== "godot") {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Only --engine godot is implemented.\n${engineStatusHelpText()}`,
    );
  }
  const projectRoot =
    projectValue === undefined
      ? cwd
      : isAbsolute(projectValue)
        ? projectValue
        : resolve(cwd, projectValue);
  return Object.freeze({ json, projectRoot, engine: "godot", help });
}

function parseEngineCapabilitiesArguments(
  args: readonly string[],
  cwd: string,
): ParsedEngineCapabilitiesArguments | CliRunResult {
  let json = false;
  let help = false;
  let projectValue: string | undefined;
  let engineValue: string | undefined;
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
    if (value === "--project" || value === "--engine") {
      const next = args[index + 1];
      if (next === undefined || next.startsWith("-")) {
        return result(
          CLI_EXIT_CODES.usage,
          "",
          `Option ${value} requires one value.\n`,
        );
      }
      if (value === "--project") {
        if (projectValue !== undefined) {
          return result(
            CLI_EXIT_CODES.usage,
            "",
            "Option --project was repeated.\n",
          );
        }
        projectValue = next;
      } else {
        if (engineValue !== undefined) {
          return result(
            CLI_EXIT_CODES.usage,
            "",
            "Option --engine was repeated.\n",
          );
        }
        engineValue = next;
      }
      index += 1;
      continue;
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown engine capabilities option.\n${engineCapabilitiesHelpText()}`,
    );
  }
  if (!help && engineValue === undefined) {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Option --engine godot is required.\n${engineCapabilitiesHelpText()}`,
    );
  }
  if (engineValue !== undefined && engineValue !== "godot") {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Only --engine godot is implemented.\n${engineCapabilitiesHelpText()}`,
    );
  }
  const projectRoot =
    projectValue === undefined
      ? cwd
      : isAbsolute(projectValue)
        ? projectValue
        : resolve(cwd, projectValue);
  return Object.freeze({ json, projectRoot, engine: "godot", help });
}

function parseSkillArguments(
  args: readonly string[],
  cwd: string,
  command: "list" | "check",
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
      `Unknown skill ${command} option.\n${command === "list" ? skillListHelpText() : skillCheckHelpText()}`,
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

function parsePackArguments(
  args: readonly string[],
  cwd: string,
  command: "list" | "doctor",
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
      `Unknown pack ${command} option.\n${command === "list" ? packListHelpText() : packDoctorHelpText()}`,
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

function humanProjectInspectReport(
  report: Awaited<ReturnType<typeof runProjectInspect>>,
): string {
  const lines = [
    "AI Game Playbook project inspect",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Engine: ${report.engine.status}`,
    `Profile: ${report.profile.status}`,
    `Dirty state: ${report.dirtyState.status}`,
    `Instances: ${report.instances.status} (selection disabled)`,
  ];
  for (const candidate of report.engine.candidates) {
    lines.push(
      `  ${candidate.engine} ${candidate.completeness} ${candidate.version.raw ?? "version unknown"}`,
    );
  }
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase().padEnd(9)} ${issue.path ?? issue.code}  ${issue.message}`,
      `          Next: ${issue.nextAction}`,
    );
  }
  if (report.inspectionDigest !== undefined) {
    lines.push("", `Inspection digest: ${report.inspectionDigest}`);
  }
  lines.push(
    "Static inspection only: no Git status, process inventory, Editor connection, or support-grade promotion.",
  );
  return `${lines.join("\n")}\n`;
}

function humanEngineStatusReport(
  report: Awaited<ReturnType<typeof runGodotEngineStatus>>,
): string {
  const lines = [
    "AI Game Playbook engine status",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Engine: ${report.engine}`,
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Project state: ${report.project.status}`,
    `Target version: ${report.compatibility.targetVersion}`,
    `Compatibility: ${report.compatibility.status}`,
    `Executable: ${report.executable.status}`,
    `Support: ${report.support.grade} (${report.support.evidenceGrade})`,
  ];
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase().padEnd(9)} ${issue.code}  ${issue.message}`,
      `          Next: ${issue.nextAction}`,
    );
  }
  lines.push(
    "",
    `Status digest: ${report.statusDigest}`,
    "Static project inspection only: no host executable read, process launch, Editor control, or support-grade promotion.",
  );
  return `${lines.join("\n")}\n`;
}

function humanEngineCapabilitiesReport(
  report: Awaited<ReturnType<typeof runGodotEngineCapabilities>>,
): string {
  const capabilities = report.capabilityReport?.capabilities ?? [];
  const lines = [
    "AI Game Playbook engine capabilities",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Engine: ${report.engine}`,
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Project state: ${report.project.status}`,
    `Identity-bound operations: ${capabilities.length}`,
    `Containment providers: ${report.containment.providerCount}`,
    `Containment: ${report.containment.status} (launch ${report.containment.launchAvailable ? "available" : "blocked"})`,
    `Support ceiling: ${report.supportGradeCeiling}`,
  ];
  for (const capability of capabilities) {
    lines.push(
      `  ${capability.operation.padEnd(14)} ${capability.support.padEnd(8)} ${capability.execution}`,
    );
  }
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase().padEnd(9)} ${issue.code}  ${issue.message}`,
      `          Next: ${issue.nextAction}`,
    );
  }
  lines.push(
    "",
    `Report digest: ${report.reportDigest}`,
    "Static reporting only: no executable discovery, containment self-test, engine process, Editor control, or support-grade promotion.",
  );
  return `${lines.join("\n")}\n`;
}

function humanSkillListReport(
  report: Awaited<ReturnType<typeof runSkillList>>,
): string {
  const lines = [
    "AI Game Playbook skill list",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Registered: ${report.summary.registered}`,
  ];
  for (const entry of report.entries) {
    lines.push(
      `  ${entry.id} ${entry.version} ${entry.invocation} -> ${entry.targetPath}`,
    );
  }
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase()} ${issue.code}  ${issue.message}`,
      `        Next: ${issue.nextAction}`,
    );
  }
  if (report.catalogDigest !== undefined) {
    lines.push("", `Catalog digest: ${report.catalogDigest}`);
  }
  lines.push("Materialization support: unavailable; no project state was changed.");
  return `${lines.join("\n")}\n`;
}

function humanSkillCheckReport(
  report: Awaited<ReturnType<typeof runSkillCheck>>,
): string {
  const lines = [
    "AI Game Playbook skill check",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Targets: missing ${report.summary.missing}, current ${report.summary.current}, conflict ${report.summary.conflict}, unsafe ${report.summary.unsafe}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `  ${check.targetStatus.toUpperCase().padEnd(8)} ${check.id} -> ${check.targetPath}`,
    );
  }
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase()} ${issue.code}  ${issue.message}`,
      `        Next: ${issue.nextAction}`,
    );
  }
  if (report.checkDigest !== undefined) {
    lines.push("", `Check digest: ${report.checkDigest}`);
  }
  lines.push("Inspection only: no skill was installed, replaced, or repaired.");
  return `${lines.join("\n")}\n`;
}

function humanPackListReport(
  report: Awaited<ReturnType<typeof runPackList>>,
): string {
  const lines = [
    "AI Game Playbook pack list",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Project state: ${report.project.state}`,
    `Installed state: ${report.installedState.status}`,
    `Installed packs: ${report.summary.installedPacks}`,
    `Dependencies: ${report.summary.dependencies}`,
    `Artifacts: ${report.summary.artifacts} (${report.summary.artifactBytes} bytes declared)`,
    `Owned directories: ${report.summary.ownedDirectories}`,
  ];
  for (const entry of report.entries) {
    lines.push(
      `  ${entry.id} ${entry.version} ${entry.digest} artifacts=${entry.artifactCount} directories=${entry.ownedDirectoryCount}`,
    );
  }
  for (const issue of report.issues) {
    lines.push(
      "",
      `${issue.severity.toUpperCase()} ${issue.packId ?? issue.code}  ${issue.message}`,
      `        Next: ${issue.nextAction}`,
    );
  }
  if (report.listDigest !== undefined) {
    lines.push("", `List digest: ${report.listDigest}`);
  }
  lines.push(
    "Inspection only: no artifact content or source location was exposed, and no project state was changed.",
  );
  return `${lines.join("\n")}\n`;
}

function humanPackDoctorReport(
  report: Awaited<ReturnType<typeof runPackDoctor>>,
): string {
  const lines = [
    "AI Game Playbook pack doctor",
    `Status: ${report.status}`,
    "Files changed: 0",
    `Project: ${report.project.canonicalPath ?? report.project.requestedPath}`,
    `Project state: ${report.project.state}`,
    `Installed state: ${report.installedState.status}`,
    `Transaction: ${report.transaction.status}`,
    `Installed packs: ${report.summary.installedPacks}`,
    `Registry: current ${report.summary.registryCurrent}, different ${report.summary.registryDifferent}, unavailable ${report.summary.registryUnavailable}`,
    `Artifacts: current ${report.summary.currentArtifacts}/${report.summary.declaredArtifacts}, missing ${report.summary.missingArtifacts}, modified ${report.summary.modifiedArtifacts}, unreadable ${report.summary.unreadableArtifacts}`,
    `Directories: current ${report.summary.currentDirectories}/${report.summary.declaredDirectories}, missing ${report.summary.missingDirectories}, modified ${report.summary.modifiedDirectories}, unreadable ${report.summary.unreadableDirectories}`,
  ];
  for (const pack of report.packs) {
    lines.push(
      `  ${pack.id} ${pack.version} registry=${pack.registryStatus} integrity=${pack.integrityStatus}`,
    );
  }
  if (report.transaction.recovery !== undefined) {
    lines.push(
      `Recovery: ${report.transaction.recovery.consistency}, action ${report.transaction.recovery.finalizationAction}, mutation uncertain ${report.transaction.recovery.mutationUncertain ? "yes" : "no"}`,
    );
  }
  for (const finding of report.findings) {
    lines.push(
      "",
      `${finding.severity.toUpperCase()} ${finding.packId ?? finding.code}  ${finding.message}`,
      `        Next: ${finding.nextAction}`,
    );
  }
  if (report.reportDigest !== undefined) {
    lines.push("", `Report digest: ${report.reportDigest}`);
  }
  lines.push(
    "Inspection only: no repair, transaction finalization, artifact-content disclosure, or project mutation was performed.",
  );
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

async function dispatchProjectInspect(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const cwd = options.cwd ?? process.cwd();
  const parsed = parseProjectInspectArguments(args, cwd);
  if ("exitCode" in parsed) {
    return parsed;
  }
  if (parsed.help) {
    return result(CLI_EXIT_CODES.success, projectInspectHelpText());
  }

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "project.inspect",
  );
  if (descriptor === undefined) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "The project inspect command is unavailable in the runtime registry.\n",
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
      "Project inspect input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runProjectInspect(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked"
        ? CLI_EXIT_CODES.blocked
        : CLI_EXIT_CODES.success,
      parsed.json
        ? `${canonicalizeJson(report)}\n`
        : humanProjectInspectReport(report),
    );
  } catch (error) {
    if (error instanceof CliDeadlineError) {
      return result(
        CLI_EXIT_CODES.failure,
        "",
        "Project inspection exceeded its registered deadline without producing a report.\n",
      );
    }
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "Project inspection failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchEngineStatus(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parseEngineStatusArguments(
    args,
    options.cwd ?? process.cwd(),
  );
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) return result(CLI_EXIT_CODES.success, engineStatusHelpText());

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.status",
  );
  if (descriptor === undefined) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "The engine status command is unavailable in the runtime registry.\n",
    );
  }
  let input: ReturnType<typeof validateRegisteredContractValue>;
  try {
    input = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      descriptor.input,
      {
        schemaVersion: "1.0.0",
        projectRoot: parsed.projectRoot,
        engine: parsed.engine,
      },
    );
  } catch {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "Engine status input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runGodotEngineStatus(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked"
        ? CLI_EXIT_CODES.blocked
        : CLI_EXIT_CODES.success,
      parsed.json
        ? `${canonicalizeJson(report)}\n`
        : humanEngineStatusReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Engine status exceeded its registered deadline without producing a report.\n"
        : "Engine status failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchEngineCapabilities(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parseEngineCapabilitiesArguments(
    args,
    options.cwd ?? process.cwd(),
  );
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) {
    return result(CLI_EXIT_CODES.success, engineCapabilitiesHelpText());
  }

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "engine.capabilities",
  );
  if (descriptor === undefined) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      "The engine capabilities command is unavailable in the runtime registry.\n",
    );
  }
  let input: ReturnType<typeof validateRegisteredContractValue>;
  try {
    input = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      descriptor.input,
      {
        schemaVersion: "1.0.0",
        projectRoot: parsed.projectRoot,
        engine: parsed.engine,
      },
    );
  } catch {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "Engine capabilities input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runGodotEngineCapabilities(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked"
        ? CLI_EXIT_CODES.blocked
        : CLI_EXIT_CODES.success,
      parsed.json
        ? `${canonicalizeJson(report)}\n`
        : humanEngineCapabilitiesReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Engine capabilities exceeded its registered deadline without producing a report.\n"
        : "Engine capabilities failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchSkillList(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parseSkillArguments(args, options.cwd ?? process.cwd(), "list");
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) return result(CLI_EXIT_CODES.success, skillListHelpText());

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "skill.list",
  );
  if (descriptor === undefined) {
    return result(CLI_EXIT_CODES.failure, "", "The skill list command is unavailable.\n");
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
      "Skill list input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runSkillList(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked" ? CLI_EXIT_CODES.blocked : CLI_EXIT_CODES.success,
      parsed.json ? `${canonicalizeJson(report)}\n` : humanSkillListReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Skill listing exceeded its registered deadline without producing a report.\n"
        : "Skill listing failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchSkillCheck(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parseSkillArguments(args, options.cwd ?? process.cwd(), "check");
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) return result(CLI_EXIT_CODES.success, skillCheckHelpText());

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "skill.check",
  );
  if (descriptor === undefined) {
    return result(CLI_EXIT_CODES.failure, "", "The skill check command is unavailable.\n");
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
      "Skill check input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runSkillCheck(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked" ? CLI_EXIT_CODES.blocked : CLI_EXIT_CODES.success,
      parsed.json ? `${canonicalizeJson(report)}\n` : humanSkillCheckReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Skill checking exceeded its registered deadline without producing a report.\n"
        : "Skill checking failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchPackList(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parsePackArguments(args, options.cwd ?? process.cwd(), "list");
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) return result(CLI_EXIT_CODES.success, packListHelpText());

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "pack.list",
  );
  if (descriptor === undefined) {
    return result(CLI_EXIT_CODES.failure, "", "The pack list command is unavailable.\n");
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
      "Pack list input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runPackList(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked" ? CLI_EXIT_CODES.blocked : CLI_EXIT_CODES.success,
      parsed.json ? `${canonicalizeJson(report)}\n` : humanPackListReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Pack listing exceeded its registered deadline without producing a report.\n"
        : "Pack listing failed before it could produce a validated report.\n",
    );
  }
}

async function dispatchPackDoctor(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<CliRunResult> {
  const parsed = parsePackArguments(args, options.cwd ?? process.cwd(), "doctor");
  if ("exitCode" in parsed) return parsed;
  if (parsed.help) return result(CLI_EXIT_CODES.success, packDoctorHelpText());

  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === "pack.doctor",
  );
  if (descriptor === undefined) {
    return result(CLI_EXIT_CODES.failure, "", "The pack doctor command is unavailable.\n");
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
      "Pack doctor input is outside the registered argument contract.\n",
    );
  }
  try {
    const report = await runWithDeadline(
      () => runPackDoctor(input),
      descriptor.timeoutMs,
    );
    return result(
      report.status === "blocked" ? CLI_EXIT_CODES.blocked : CLI_EXIT_CODES.success,
      parsed.json
        ? `${canonicalizeJson(report)}\n`
        : humanPackDoctorReport(report),
    );
  } catch (error) {
    return result(
      CLI_EXIT_CODES.failure,
      "",
      error instanceof CliDeadlineError
        ? "Pack doctor exceeded its registered deadline without producing a report.\n"
        : "Pack doctor failed before it could produce a validated report.\n",
    );
  }
}

export async function runCli(
  rawArgs: readonly string[],
  rawOptions: CliRuntimeOptions = {},
): Promise<CliRunResult> {
  const args = snapshotCliArguments(rawArgs);
  if (args === undefined) {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "CLI arguments must be a plain bounded string array.\n",
    );
  }
  const options = snapshotCliRuntimeOptions(rawOptions);
  if (options === undefined) {
    return result(
      CLI_EXIT_CODES.usage,
      "",
      "CLI runtime options must contain only plain cwd and nodeVersion strings.\n",
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
  if (args[0] === "engine") {
    if (args[1] === "capabilities") {
      return dispatchEngineCapabilities(args.slice(2), options);
    }
    if (args[1] === "status") {
      return dispatchEngineStatus(args.slice(2), options);
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown engine command.\n${engineCapabilitiesHelpText()}${engineStatusHelpText()}`,
    );
  }
  if (args[0] === "project") {
    if (args[1] === "inspect") {
      return dispatchProjectInspect(args.slice(2), options);
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown project command.\n${projectInspectHelpText()}`,
    );
  }
  if (args[0] === "pack") {
    if (args[1] === "list") {
      return dispatchPackList(args.slice(2), options);
    }
    if (args[1] === "doctor") {
      return dispatchPackDoctor(args.slice(2), options);
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown pack command.\n${packListHelpText()}${packDoctorHelpText()}`,
    );
  }
  if (args[0] === "skill") {
    if (args[1] === "list") {
      return dispatchSkillList(args.slice(2), options);
    }
    if (args[1] === "check") {
      return dispatchSkillCheck(args.slice(2), options);
    }
    return result(
      CLI_EXIT_CODES.usage,
      "",
      `Unknown skill command.\n${skillListHelpText()}${skillCheckHelpText()}`,
    );
  }
  return result(
    CLI_EXIT_CODES.usage,
    "",
    `Unknown command.\n${helpText()}`,
  );
}
