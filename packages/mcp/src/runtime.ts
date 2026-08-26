import {
  canonicalizeJson,
  type CommandDescriptor,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  runDoctor,
  runInit,
  runProjectInspect,
  runSkillCheck,
  runSkillList,
} from "@ai-game-playbook/cli";
import {
  assertValidatedRegistry,
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
  validateRegisteredContractValue,
  type McpToolSurface,
} from "@ai-game-playbook/registry";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { isAbsolute, resolve } from "node:path";

import { McpRuntimeBoundaryError } from "./errors.js";

export interface McpRuntimeTool {
  readonly commandId: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly timeoutMs: number;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly annotations: {
    readonly readOnlyHint: true;
    readonly destructiveHint: false;
    readonly idempotentHint: boolean;
    readonly openWorldHint: false;
  };
}

export interface McpRuntimePlan {
  readonly protocolRevision: "2026-07-28";
  readonly transport: "stdio";
  readonly lifecycle: "stateless";
  readonly controlPlaneVersion: string;
  readonly registryDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly projectRoot: string;
  readonly projectIdentityDigest: Sha256Digest;
  readonly hostDisclosureAcknowledged: true;
  readonly enabledTools: readonly McpRuntimeTool[];
}

export interface CreateMcpRuntimePlanOptions {
  readonly projectRoot: string;
  readonly enabledTools: readonly string[];
  readonly allowHostDisclosure: boolean;
}

export interface McpToolInvocationRequest {
  readonly name: string;
  readonly arguments: unknown;
}

interface RuntimePlanState {
  readonly root: CanonicalProjectRoot;
  readonly tools: ReadonlyMap<string, McpToolSurface>;
}

type CommandHandler = (input: unknown) => Promise<unknown>;

interface HandlerBinding {
  readonly packageName: "@ai-game-playbook/cli";
  readonly exportName:
    | "runDoctor"
    | "runInit"
    | "runProjectInspect"
    | "runSkillCheck"
    | "runSkillList";
  readonly invoke: CommandHandler;
}

class CommandDeadlineError extends Error {}

const runtimePlanStates = new WeakMap<object, RuntimePlanState>();
const WRITE_PERMISSIONS = new Set([
  "write-project-metadata",
  "write-project-source",
  "editor-control",
  "test-build",
  "install",
  "network",
  "external-transmission",
  "paid-call",
  "destructive",
  "publish-release",
]);
const HANDLERS: ReadonlyMap<string, HandlerBinding> = new Map<
  string,
  HandlerBinding
>([
  [
    "doctor",
    Object.freeze({
      packageName: "@ai-game-playbook/cli",
      exportName: "runDoctor",
      invoke: (input: unknown): Promise<unknown> => runDoctor(input),
    }),
  ],
  [
    "init",
    Object.freeze({
      packageName: "@ai-game-playbook/cli",
      exportName: "runInit",
      invoke: (input: unknown): Promise<unknown> => runInit(input),
    }),
  ],
  [
    "project.inspect",
    Object.freeze({
      packageName: "@ai-game-playbook/cli",
      exportName: "runProjectInspect",
      invoke: (input: unknown): Promise<unknown> => runProjectInspect(input),
    }),
  ],
  [
    "skill.check",
    Object.freeze({
      packageName: "@ai-game-playbook/cli",
      exportName: "runSkillCheck",
      invoke: (input: unknown): Promise<unknown> => runSkillCheck(input),
    }),
  ],
  [
    "skill.list",
    Object.freeze({
      packageName: "@ai-game-playbook/cli",
      exportName: "runSkillList",
      invoke: (input: unknown): Promise<unknown> => runSkillList(input),
    }),
  ],
]);

function keysAreExact(
  value: object,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function assertPlan(plan: McpRuntimePlan): RuntimePlanState {
  if (typeof plan !== "object" || plan === null) {
    throw new McpRuntimeBoundaryError(
      "mcp-runtime-plan-invalid",
      "MCP runtime plan was not issued by this process.",
    );
  }
  const state = runtimePlanStates.get(plan);
  if (state === undefined) {
    throw new McpRuntimeBoundaryError(
      "mcp-runtime-plan-invalid",
      "MCP runtime plan was not issued by this process.",
    );
  }
  return state;
}

function isReadOnlyTool(tool: McpToolSurface): boolean {
  const command = tool.meta.command;
  return (
    tool.annotations.readOnlyHint &&
    !tool.annotations.destructiveHint &&
    !tool.annotations.openWorldHint &&
    !tool.meta.requiresApply &&
    command.sideEffects.every(({ kind }) => kind === "none") &&
    command.permissions.every((permission) => !WRITE_PERMISSIONS.has(permission))
  );
}

function assertHandlerBinding(command: CommandDescriptor): HandlerBinding {
  const binding = HANDLERS.get(command.id);
  if (
    binding === undefined ||
    command.handler.package !== binding.packageName ||
    command.handler.export !== binding.exportName
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-handler-binding-invalid",
      "Registered command handler is outside the MCP runtime allowlist.",
    );
  }
  return binding;
}

function publicTool(tool: McpToolSurface): McpRuntimeTool {
  const command = tool.meta.command;
  return Object.freeze({
    commandId: tool.commandId,
    name: tool.name,
    title: tool.title,
    description: tool.description,
    timeoutMs: command.timeoutMs,
    inputDigest: tool.inputDigest,
    outputDigest: tool.outputDigest,
    annotations: Object.freeze({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: tool.annotations.idempotentHint,
      openWorldHint: false,
    }),
  });
}

function validateOptions(
  options: CreateMcpRuntimePlanOptions,
): CreateMcpRuntimePlanOptions {
  if (
    typeof options !== "object" ||
    options === null ||
    !keysAreExact(options, [
      "allowHostDisclosure",
      "enabledTools",
      "projectRoot",
    ]) ||
    typeof options.projectRoot !== "string" ||
    options.projectRoot.length === 0 ||
    options.projectRoot.length > 32_767 ||
    /[\u0000-\u001F\u007F]/u.test(options.projectRoot) ||
    !Array.isArray(options.enabledTools) ||
    options.enabledTools.length === 0 ||
    options.enabledTools.length > 32
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-tool-selection-invalid",
      "MCP tool selection does not satisfy the bounded runtime contract.",
    );
  }
  if (options.allowHostDisclosure !== true) {
    throw new McpRuntimeBoundaryError(
      "mcp-host-disclosure-required",
      "MCP startup requires explicit host disclosure acknowledgement.",
    );
  }
  return options;
}

export async function createMcpRuntimePlan(
  options: CreateMcpRuntimePlanOptions,
): Promise<McpRuntimePlan> {
  const validated = validateOptions(options);
  assertValidatedRegistry(BUILTIN_REGISTRY);
  const surface = BUILTIN_REGISTRY_SURFACES.mcp;
  if (
    surface.sourceRegistryDigest !== BUILTIN_REGISTRY.digest ||
    surface.data.protocolRevision !== "2026-07-28" ||
    surface.data.lifecycle !== "stateless" ||
    surface.data.extensions.length !== 0
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-runtime-plan-invalid",
      "Generated MCP surface does not match the builtin registry boundary.",
    );
  }

  const allTools = new Map(surface.data.tools.map((tool) => [tool.name, tool]));
  const selected: McpToolSurface[] = [];
  const seen = new Set<string>();
  for (const name of validated.enabledTools) {
    if (
      typeof name !== "string" ||
      name.length === 0 ||
      name.length > 128 ||
      seen.has(name)
    ) {
      throw new McpRuntimeBoundaryError(
        "mcp-tool-selection-invalid",
        "MCP tool selection is unknown, duplicated, or outside its budget.",
      );
    }
    seen.add(name);
    const tool = allTools.get(name);
    if (
      tool === undefined ||
      tool.meta.command !==
        BUILTIN_REGISTRY.commands.find(({ id }) => id === tool.commandId) ||
      tool.inputSchemaId !== tool.meta.command.input.schemaId ||
      tool.inputDigest !== tool.meta.command.input.digest ||
      tool.outputSchemaId !== tool.meta.command.output.schemaId ||
      tool.outputDigest !== tool.meta.command.output.digest ||
      !isReadOnlyTool(tool)
    ) {
      throw new McpRuntimeBoundaryError(
        "mcp-tool-selection-invalid",
        "MCP tool selection is not an exact generated read-only command.",
      );
    }
    assertHandlerBinding(tool.meta.command);
    selected.push(tool);
  }

  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(resolve(validated.projectRoot));
  } catch {
    throw new McpRuntimeBoundaryError(
      "mcp-project-boundary",
      "MCP runtime could not bind the selected project root.",
    );
  }
  const enabledTools = Object.freeze(selected.map(publicTool));
  const plan: McpRuntimePlan = Object.freeze({
    protocolRevision: "2026-07-28",
    transport: "stdio",
    lifecycle: "stateless",
    controlPlaneVersion: surface.data.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    surfaceDigest: surface.digest,
    projectRoot: root.canonicalPath,
    projectIdentityDigest: root.identityDigest,
    hostDisclosureAcknowledged: true,
    enabledTools,
  });
  runtimePlanStates.set(
    plan,
    Object.freeze({
      root,
      tools: new Map(selected.map((tool) => [tool.name, tool])),
    }),
  );
  return plan;
}

async function runWithDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CommandDeadlineError()), timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(operation), deadline]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function boundCommandInput(
  state: RuntimePlanState,
  command: CommandDescriptor,
  input: unknown,
): Promise<unknown> {
  let validated: unknown;
  try {
    validated = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      command.input,
      input,
    );
  } catch {
    throw new McpRuntimeBoundaryError(
      "mcp-command-input-invalid",
      "MCP tool input does not satisfy the exact registered command schema.",
    );
  }
  if (
    typeof validated !== "object" ||
    validated === null ||
    Array.isArray(validated) ||
    !("projectRoot" in validated) ||
    typeof validated.projectRoot !== "string"
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-project-boundary",
      "MCP tool input does not identify the bound project.",
    );
  }

  let requestedRoot: CanonicalProjectRoot;
  try {
    const requestedPath = isAbsolute(validated.projectRoot)
      ? validated.projectRoot
      : resolve(state.root.canonicalPath, validated.projectRoot);
    requestedRoot = await canonicalizeProjectRoot(requestedPath);
  } catch {
    throw new McpRuntimeBoundaryError(
      "mcp-project-boundary",
      "MCP tool input is outside the bound project.",
    );
  }
  if (
    !samePath(requestedRoot.canonicalPath, state.root.canonicalPath) ||
    requestedRoot.identityDigest !== state.root.identityDigest
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-project-boundary",
      "MCP tool input is outside the bound project.",
    );
  }
  await assertProjectRootIdentity(state.root);
  await assertProjectRootIdentity(requestedRoot);

  try {
    return validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      command.input,
      Object.freeze({
        ...(validated as Record<string, unknown>),
        projectRoot: state.root.canonicalPath,
      }),
    );
  } catch {
    throw new McpRuntimeBoundaryError(
      "mcp-command-input-invalid",
      "Bound MCP tool input does not satisfy the registered command schema.",
    );
  }
}

function errorResult(
  error: McpRuntimeBoundaryError,
): CallToolResult {
  const text = canonicalizeJson({ code: error.code, message: error.message });
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

function runtimeError(error: unknown): McpRuntimeBoundaryError {
  if (error instanceof McpRuntimeBoundaryError) {
    return error;
  }
  if (error instanceof CommandDeadlineError) {
    return new McpRuntimeBoundaryError(
      "mcp-command-deadline",
      "MCP command exceeded its registered deadline.",
    );
  }
  return new McpRuntimeBoundaryError(
    "mcp-runtime-failure",
    "MCP command did not produce a validated result.",
  );
}

export async function invokeMcpTool(
  plan: McpRuntimePlan,
  request: McpToolInvocationRequest,
): Promise<CallToolResult> {
  const state = assertPlan(plan);
  try {
    if (
      typeof request !== "object" ||
      request === null ||
      !keysAreExact(request, ["arguments", "name"]) ||
      typeof request.name !== "string"
    ) {
      throw new McpRuntimeBoundaryError(
        "mcp-command-input-invalid",
        "MCP invocation request is outside the bounded call contract.",
      );
    }
    const tool = state.tools.get(request.name);
    if (tool === undefined) {
      throw new McpRuntimeBoundaryError(
        "mcp-tool-unavailable",
        "MCP tool is not enabled for this runtime.",
      );
    }
    const command = tool.meta.command;
    const binding = assertHandlerBinding(command);
    const input = await boundCommandInput(state, command, request.arguments);
    const output = await runWithDeadline(
      () => binding.invoke(input),
      command.timeoutMs,
    );
    await assertProjectRootIdentity(state.root);

    let validatedOutput: unknown;
    try {
      validatedOutput = validateRegisteredContractValue(
        BUILTIN_REGISTRY,
        command.output,
        output,
      );
    } catch {
      throw new McpRuntimeBoundaryError(
        "mcp-command-output-invalid",
        "MCP command output does not satisfy its exact registered schema.",
      );
    }
    if (
      typeof validatedOutput !== "object" ||
      validatedOutput === null ||
      Array.isArray(validatedOutput)
    ) {
      throw new McpRuntimeBoundaryError(
        "mcp-command-output-invalid",
        "MCP structured output must be a registered object contract.",
      );
    }
    const text = canonicalizeJson(validatedOutput);
    if (Buffer.byteLength(text, "utf8") > command.budgets.maxOutputBytes) {
      throw new McpRuntimeBoundaryError(
        "mcp-output-budget-exceeded",
        "MCP command output exceeded its registered byte budget.",
      );
    }
    return {
      content: [{ type: "text", text }],
      structuredContent: validatedOutput as Record<string, unknown>,
    };
  } catch (error) {
    return errorResult(runtimeError(error));
  }
}

export function assertMcpRuntimePlan(
  plan: McpRuntimePlan,
): void {
  assertPlan(plan);
}

export function getMcpRuntimeToolSurface(
  plan: McpRuntimePlan,
  name: string,
): McpToolSurface {
  const state = assertPlan(plan);
  const tool = state.tools.get(name);
  if (tool === undefined) {
    throw new McpRuntimeBoundaryError(
      "mcp-tool-unavailable",
      "MCP tool is not enabled for this runtime.",
    );
  }
  return tool;
}
