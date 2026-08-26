import { McpRuntimeBoundaryError } from "./errors.js";

export interface McpRuntimeArguments {
  readonly projectRoot: string;
  readonly enabledTools: readonly string[];
  readonly allowHostDisclosure: true;
}

const MAX_ARGUMENTS = 64;
const MAX_ARGUMENT_LENGTH = 32_767;
const MAX_ENABLED_TOOLS = 32;

function invalidArguments(): never {
  throw new McpRuntimeBoundaryError(
    "mcp-arguments-invalid",
    "MCP runtime arguments do not satisfy the bounded startup contract.",
  );
}

function boundedArgument(value: string | undefined): string {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > MAX_ARGUMENT_LENGTH ||
    /[\u0000-\u001F\u007F]/u.test(value)
  ) {
    invalidArguments();
  }
  return value;
}

export function parseMcpRuntimeArguments(
  argv: readonly string[],
): McpRuntimeArguments {
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > MAX_ARGUMENTS) {
    invalidArguments();
  }
  for (const value of argv) {
    boundedArgument(value);
  }

  let projectRoot: string | undefined;
  let allowHostDisclosure = false;
  const enabledTools: string[] = [];
  const seenTools = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--project-root") {
      if (projectRoot !== undefined) {
        invalidArguments();
      }
      projectRoot = boundedArgument(argv[index + 1]);
      index += 1;
      continue;
    }
    if (option === "--enable-tool") {
      const tool = boundedArgument(argv[index + 1]);
      if (
        tool.length > 128 ||
        !/^agpb_[a-z][a-z0-9_]*$/u.test(tool) ||
        seenTools.has(tool) ||
        enabledTools.length >= MAX_ENABLED_TOOLS
      ) {
        invalidArguments();
      }
      seenTools.add(tool);
      enabledTools.push(tool);
      index += 1;
      continue;
    }
    if (option === "--allow-host-disclosure") {
      if (allowHostDisclosure) {
        invalidArguments();
      }
      allowHostDisclosure = true;
      continue;
    }
    invalidArguments();
  }

  if (
    projectRoot === undefined ||
    enabledTools.length === 0 ||
    !allowHostDisclosure
  ) {
    invalidArguments();
  }

  return Object.freeze({
    projectRoot,
    enabledTools: Object.freeze(enabledTools),
    allowHostDisclosure: true,
  });
}
