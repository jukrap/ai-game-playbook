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
import {
  BoundedMcpStdioInput,
  pipeMcpStdioInput,
} from "./stdio-input.js";

async function main(): Promise<void> {
  const options = parseMcpRuntimeArguments(process.argv.slice(2));
  const plan = await createMcpRuntimePlan(options);
  const boundedInput = new BoundedMcpStdioInput();

  let handle: ReturnType<typeof serveStdio> | undefined;
  let detachInput: (() => void) | undefined;
  let closing = false;
  const close = (exitCode?: number): void => {
    if (exitCode !== undefined && process.exitCode === undefined) {
      process.exitCode = exitCode;
    }
    if (closing) {
      return;
    }
    closing = true;
    detachInput?.();
    boundedInput.destroy();
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
      new StdioServerTransport(boundedInput, process.stdout, {
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
  detachInput = pipeMcpStdioInput(process.stdin, boundedInput);

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
