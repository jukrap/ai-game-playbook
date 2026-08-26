#!/usr/bin/env node

import {
  serveStdio,
  StdioServerTransport,
} from "@modelcontextprotocol/server/stdio";

import { parseMcpRuntimeArguments } from "./arguments.js";
import { McpRuntimeBoundaryError } from "./errors.js";
import { createMcpRuntimePlan } from "./runtime.js";
import {
  createMcpServer,
  MCP_STDIO_MAX_BUFFER_BYTES,
} from "./server.js";

async function main(): Promise<void> {
  const options = parseMcpRuntimeArguments(process.argv.slice(2));
  const plan = await createMcpRuntimePlan(options);
  const handle = serveStdio(() => createMcpServer(plan), {
    legacy: "reject",
    transport: new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: MCP_STDIO_MAX_BUFFER_BYTES,
    }),
    onerror: (): void => {
      console.error("agpb-mcp: transport error");
    },
  });

  let closing = false;
  const close = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    void handle.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

try {
  await main();
} catch (error) {
  const code =
    error instanceof McpRuntimeBoundaryError
      ? error.code
      : "mcp-runtime-failure";
  console.error(`agpb-mcp: ${code}`);
  process.exitCode = 2;
}
