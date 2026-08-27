import {
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  serializeMessage,
  type JSONRPCMessage,
  type MessageExtraInfo,
  type RequestId,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/server";

export interface McpSessionBudgets {
  readonly maxMessages: number;
  readonly maxPendingRequests: number;
  readonly maxSerializedInputBytes: number;
}

export const MCP_STDIO_MAX_SESSION_SERIALIZED_INPUT_BYTES: number =
  16 * 1_024 * 1_024;
export const MCP_STDIO_MAX_SESSION_MESSAGES = 1_024;
export const MCP_STDIO_MAX_PENDING_REQUESTS = 32;

const DEFAULT_SESSION_BUDGETS: McpSessionBudgets = Object.freeze({
  maxMessages: MCP_STDIO_MAX_SESSION_MESSAGES,
  maxPendingRequests: MCP_STDIO_MAX_PENDING_REQUESTS,
  maxSerializedInputBytes: MCP_STDIO_MAX_SESSION_SERIALIZED_INPUT_BYTES,
});

function validateBudgets(budgets: McpSessionBudgets): McpSessionBudgets {
  if (
    !Number.isSafeInteger(budgets.maxMessages) ||
    budgets.maxMessages <= 0 ||
    !Number.isSafeInteger(budgets.maxPendingRequests) ||
    budgets.maxPendingRequests <= 0 ||
    budgets.maxPendingRequests > budgets.maxMessages ||
    !Number.isSafeInteger(budgets.maxSerializedInputBytes) ||
    budgets.maxSerializedInputBytes <= 0
  ) {
    throw new TypeError("MCP STDIO session budgets are invalid.");
  }
  return Object.freeze({
    maxMessages: budgets.maxMessages,
    maxPendingRequests: budgets.maxPendingRequests,
    maxSerializedInputBytes: budgets.maxSerializedInputBytes,
  });
}

export class BoundedMcpSessionTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <Message extends JSONRPCMessage>(
    message: Message,
    extra?: MessageExtraInfo,
  ) => void;

  private failed = false;
  private receivedInputBytes = 0;
  private receivedMessages = 0;
  private readonly budgets: McpSessionBudgets;
  private readonly pendingRequests = new Set<RequestId>();

  constructor(
    private readonly transport: Transport,
    budgets: McpSessionBudgets = DEFAULT_SESSION_BUDGETS,
  ) {
    this.budgets = validateBudgets(budgets);
  }

  readonly setProtocolVersion = (version: string): void => {
    this.transport.setProtocolVersion?.(version);
  };

  readonly setSupportedProtocolVersions = (versions: string[]): void => {
    this.transport.setSupportedProtocolVersions?.(versions);
  };

  async start(): Promise<void> {
    this.transport.onclose = (): void => {
      try {
        this.onclose?.();
      } catch (error) {
        this.reportError(
          error instanceof Error
            ? error
            : new Error("MCP STDIO session close observer failed."),
        );
      }
    };
    this.transport.onerror = (error: Error): void => {
      this.reportError(error);
    };
    this.transport.onmessage = <Message extends JSONRPCMessage>(
      message: Message,
      extra?: MessageExtraInfo,
    ): void => {
      if (this.failed) {
        return;
      }
      let messageBytes: number;
      try {
        messageBytes = Buffer.byteLength(serializeMessage(message), "utf8");
      } catch {
        this.fail();
        return;
      }
      if (
        this.receivedMessages >= this.budgets.maxMessages ||
        messageBytes >
          this.budgets.maxSerializedInputBytes - this.receivedInputBytes
      ) {
        this.fail();
        return;
      }
      if (
        isJSONRPCRequest(message) &&
        (this.pendingRequests.has(message.id) ||
          this.pendingRequests.size >= this.budgets.maxPendingRequests)
      ) {
        this.fail();
        return;
      }
      this.receivedInputBytes += messageBytes;
      this.receivedMessages += 1;
      if (isJSONRPCRequest(message)) {
        this.pendingRequests.add(message.id);
      }
      this.onmessage?.(message, extra);
    };
    await this.transport.start();
  }

  async send(
    message: JSONRPCMessage,
    options?: TransportSendOptions,
  ): Promise<void> {
    await this.transport.send(message, options);
    if (
      (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) &&
      message.id !== undefined &&
      message.id !== null
    ) {
      this.pendingRequests.delete(message.id);
    }
  }

  async close(): Promise<void> {
    this.pendingRequests.clear();
    await this.transport.close();
  }

  private fail(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.reportError(new Error("MCP STDIO session budget exceeded."));
    void this.close().catch((error: unknown) => {
      this.reportError(
        error instanceof Error
          ? error
          : new Error("MCP STDIO session close failed."),
      );
    });
  }

  private reportError(error: Error): void {
    try {
      this.onerror?.(error);
    } catch {}
  }
}
