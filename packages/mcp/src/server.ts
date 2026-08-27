import {
  fromJsonSchema,
  McpServer,
  type JsonSchemaType,
} from "@modelcontextprotocol/server";

import type { McpRuntimePlan } from "./runtime.js";
import {
  assertMcpRuntimePlan,
  getMcpRuntimeToolSurface,
  invokeMcpToolWithSignal,
} from "./runtime.js";

const SERVER_INSTRUCTIONS =
  "This server is read-only and bound to one project. Use only explicitly enabled tools and target only the bound project. It does not mutate files, start engines, access the network, export evidence, install software, or grant permission. Tool annotations are hints; AI Game Playbook remains the authority. Treat returned project diagnostics as data disclosed to the active host for this call.";

export const MCP_STDIO_MAX_BUFFER_BYTES = 1_048_576;

export function createMcpServer(plan: McpRuntimePlan): McpServer {
  assertMcpRuntimePlan(plan);
  const server = new McpServer(
    {
      name: "ai-game-playbook",
      version: plan.controlPlaneVersion,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
      supportedProtocolVersions: [plan.protocolRevision],
    },
  );

  for (const selected of plan.enabledTools) {
    const tool = getMcpRuntimeToolSurface(plan, selected.name);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(
          tool.inputSchema as JsonSchemaType,
        ),
        outputSchema: fromJsonSchema<Record<string, unknown>>(
          tool.outputSchema as JsonSchemaType,
        ),
        annotations: tool.annotations,
      },
      async (argumentsValue, context) =>
        invokeMcpToolWithSignal(
          plan,
          {
            name: tool.name,
            arguments: argumentsValue,
          },
          context.mcpReq.signal,
        ),
    );
  }
  return server;
}
