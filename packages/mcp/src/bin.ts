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
import { BoundedMcpSessionTransport } from "./session-transport.js";

async function main(): Promise<void> {
  const options = parseMcpRuntimeArguments(process.argv.slice(2));
  const plan = await createMcpRuntimePlan(options);

  let handle: ReturnType<typeof serveStdio> | undefined;
  let closing = false;
  const close = (exitCode?: number): void => {
    if (exitCode !== undefined && process.exitCode === undefined) {
      process.exitCode = exitCode;
    }
    if (closing) {
      return;
    }
    closing = true;
    process.stdin.destroy();
    if (handle === undefined) {
      return;
    }
    void handle.close().catch(() => {
      process.exitCode = 1;
    });
  };

  handle = serveStdio(() => createMcpServer(plan), {
    legacy: "reject",
    transport: new BoundedMcpSessionTransport(
      new StdioServerTransport(process.stdin, process.stdout, {
        maxBufferSize: MCP_STDIO_MAX_BUFFER_BYTES,
      }),
    ),
    onerror: (): void => {
      if (closing) {
        return;
      }
      console.error("agpb-mcp: transport error");
      close(1);
    },
  });

  process.once("SIGINT", () => close());
  process.once("SIGTERM", () => close());
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
