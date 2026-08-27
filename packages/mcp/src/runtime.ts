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
  runSkillCheck,
  runSkillList,
} from "@ai-game-playbook/cli";
import {
  runGodotEngineCapabilities,
  runGodotEngineStatus,
} from "@ai-game-playbook/godot-adapter";
import {
  runPackDoctor,
  runPackList,
} from "@ai-game-playbook/pack-runtime";
import { runProjectInspect } from "@ai-game-playbook/project-runtime";
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
import {
  McpInvocationSupervisor,
  McpInvocationSupervisorError,
} from "./invocation-supervisor.js";
import {
  MCP_PROJECT_ROOT_MAX_BYTES,
  isBoundedUtf8String,
  isMcpToolName,
  snapshotDenseDataArray,
  snapshotExactDataRecord,
} from "./plain-data.js";

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
  readonly supervisor: McpInvocationSupervisor;
  readonly tools: ReadonlyMap<string, McpToolSurface>;
}

interface CommandHandlerContext {
  readonly signal: AbortSignal;
}

type CommandHandler = (
  input: unknown,
  context: CommandHandlerContext,
) => Promise<unknown>;

interface HandlerBinding {
  readonly packageName:
    | "@ai-game-playbook/cli"
    | "@ai-game-playbook/godot-adapter"
    | "@ai-game-playbook/pack-runtime"
    | "@ai-game-playbook/project-runtime";
  readonly exportName:
    | "runDoctor"
    | "runGodotEngineCapabilities"
    | "runGodotEngineStatus"
    | "runInit"
    | "runPackDoctor"
    | "runPackList"
    | "runProjectInspect"
    | "runSkillCheck"
    | "runSkillList";
  readonly invoke: CommandHandler;
}

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
    "engine.capabilities",
    Object.freeze({
      packageName: "@ai-game-playbook/godot-adapter",
      exportName: "runGodotEngineCapabilities",
      invoke: (input: unknown): Promise<unknown> =>
        runGodotEngineCapabilities(input),
    }),
  ],
  [
    "engine.status",
    Object.freeze({
      packageName: "@ai-game-playbook/godot-adapter",
      exportName: "runGodotEngineStatus",
      invoke: (input: unknown): Promise<unknown> => runGodotEngineStatus(input),
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
    "pack.doctor",
    Object.freeze({
      packageName: "@ai-game-playbook/pack-runtime",
      exportName: "runPackDoctor",
      invoke: (input: unknown): Promise<unknown> => runPackDoctor(input),
    }),
  ],
  [
    "pack.list",
    Object.freeze({
      packageName: "@ai-game-playbook/pack-runtime",
      exportName: "runPackList",
      invoke: (input: unknown): Promise<unknown> => runPackList(input),
    }),
  ],
  [
    "project.inspect",
    Object.freeze({
      packageName: "@ai-game-playbook/project-runtime",
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
  options: unknown,
): CreateMcpRuntimePlanOptions {
  const record = snapshotExactDataRecord(options, [
    "allowHostDisclosure",
    "enabledTools",
    "projectRoot",
  ]);
  const enabledTools = snapshotDenseDataArray(record?.enabledTools, 32);
  if (
    record === undefined ||
    !isBoundedUtf8String(
      record.projectRoot,
      MCP_PROJECT_ROOT_MAX_BYTES,
    ) ||
    record.projectRoot.length === 0 ||
    /[\u0000-\u001F\u007F]/u.test(record.projectRoot) ||
    enabledTools === undefined ||
    enabledTools.length === 0 ||
    enabledTools.some((tool) => !isMcpToolName(tool))
  ) {
    throw new McpRuntimeBoundaryError(
      "mcp-tool-selection-invalid",
      "MCP tool selection does not satisfy the bounded runtime contract.",
    );
  }
  if (record.allowHostDisclosure !== true) {
    throw new McpRuntimeBoundaryError(
      "mcp-host-disclosure-required",
      "MCP startup requires explicit host disclosure acknowledgement.",
    );
  }
  return Object.freeze({
    projectRoot: record.projectRoot,
    enabledTools: enabledTools as readonly string[],
    allowHostDisclosure: true,
  });
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
      !isMcpToolName(name) ||
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
      supervisor: new McpInvocationSupervisor(),
      tools: new Map(selected.map((tool) => [tool.name, tool])),
    }),
  );
  return plan;
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
  if (error instanceof McpInvocationSupervisorError) {
    return new McpRuntimeBoundaryError(error.code, error.message);
  }
  return new McpRuntimeBoundaryError(
    "mcp-runtime-failure",
    "MCP command did not produce a validated result.",
  );
}

function assertInvocationActive(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof McpInvocationSupervisorError) {
    throw signal.reason;
  }
  throw new McpInvocationSupervisorError("mcp-command-cancelled");
}

async function invokeMcpToolControlled(
  plan: McpRuntimePlan,
  request: McpToolInvocationRequest,
  callerSignal?: AbortSignal,
): Promise<CallToolResult> {
  const state = assertPlan(plan);
  try {
    state.supervisor.assertReady(callerSignal);
    const record = snapshotExactDataRecord(request, ["arguments", "name"]);
    if (
      record === undefined ||
      !isMcpToolName(record.name)
    ) {
      throw new McpRuntimeBoundaryError(
        "mcp-command-input-invalid",
        "MCP invocation request is outside the bounded call contract.",
      );
    }
    const tool = state.tools.get(record.name);
    if (tool === undefined) {
      throw new McpRuntimeBoundaryError(
        "mcp-tool-unavailable",
        "MCP tool is not enabled for this runtime.",
      );
    }
    const command = tool.meta.command;
    const binding = assertHandlerBinding(command);
    const runOptions =
      callerSignal === undefined
        ? {
            timeoutMs: command.timeoutMs,
            graceMs: command.cancellation.graceMs,
          }
        : {
            timeoutMs: command.timeoutMs,
            graceMs: command.cancellation.graceMs,
            callerSignal,
          };
    return await state.supervisor.run(
      async (signal) => {
        assertInvocationActive(signal);
        const input = await boundCommandInput(
          state,
          command,
          record.arguments,
        );
        assertInvocationActive(signal);
        const output = await binding.invoke(
          input,
          Object.freeze({ signal }),
        );
        assertInvocationActive(signal);
        await assertProjectRootIdentity(state.root);
        assertInvocationActive(signal);

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
        if (
          Buffer.byteLength(text, "utf8") > command.budgets.maxOutputBytes
        ) {
          throw new McpRuntimeBoundaryError(
            "mcp-output-budget-exceeded",
            "MCP command output exceeded its registered byte budget.",
          );
        }
        return {
          content: [{ type: "text", text }],
          structuredContent: validatedOutput as Record<string, unknown>,
        };
      },
      runOptions,
    );
  } catch (error) {
    return errorResult(runtimeError(error));
  }
}

export async function invokeMcpTool(
  plan: McpRuntimePlan,
  request: McpToolInvocationRequest,
): Promise<CallToolResult> {
  return invokeMcpToolControlled(plan, request);
}

export async function invokeMcpToolWithSignal(
  plan: McpRuntimePlan,
  request: McpToolInvocationRequest,
  callerSignal: AbortSignal,
): Promise<CallToolResult> {
  return invokeMcpToolControlled(plan, request, callerSignal);
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
