export type McpInvocationSupervisorErrorCode =
  | "mcp-command-cancelled"
  | "mcp-command-deadline"
  | "mcp-command-settlement-uncertain";

export interface McpInvocationRunOptions {
  readonly timeoutMs: number;
  readonly graceMs: number;
  readonly callerSignal?: AbortSignal;
}

type Interruption = "blocked" | "cancelled" | "deadline";

type OperationOutcome<T> =
  | { readonly type: "fulfilled"; readonly value: T }
  | { readonly type: "rejected"; readonly error: unknown };

type FirstOutcome<T> =
  | OperationOutcome<T>
  | { readonly type: "interrupted"; readonly interruption: Interruption };

const ERROR_MESSAGES: Readonly<
  Record<McpInvocationSupervisorErrorCode, string>
> = Object.freeze({
  "mcp-command-cancelled": "MCP command was cancelled by its caller.",
  "mcp-command-deadline": "MCP command exceeded its registered deadline.",
  "mcp-command-settlement-uncertain":
    "MCP command cancellation did not reach a settled state.",
});

export class McpInvocationSupervisorError extends Error {
  readonly code: McpInvocationSupervisorErrorCode;

  constructor(code: McpInvocationSupervisorErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "McpInvocationSupervisorError";
    this.code = code;
  }
}

function validateOptions(options: McpInvocationRunOptions): void {
  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isSafeInteger(options.graceMs) ||
    options.graceMs < 0 ||
    (options.callerSignal !== undefined &&
      !(options.callerSignal instanceof AbortSignal))
  ) {
    throw new TypeError("MCP invocation control options are invalid.");
  }
}

function interruptionError(
  interruption: Interruption,
): McpInvocationSupervisorError {
  return new McpInvocationSupervisorError(
    interruption === "blocked"
      ? "mcp-command-settlement-uncertain"
      : interruption === "cancelled"
        ? "mcp-command-cancelled"
        : "mcp-command-deadline",
  );
}

async function waitForSettlement<T>(
  outcome: Promise<OperationOutcome<T>>,
  graceMs: number,
): Promise<OperationOutcome<T> | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const graceExpired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), graceMs);
  });
  try {
    return await Promise.race([outcome, graceExpired]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export class McpInvocationSupervisor {
  readonly #blockListeners = new Set<() => void>();
  #state: "ready" | "blocked" = "ready";

  get state(): "ready" | "blocked" {
    return this.#state;
  }

  #assertStateReady(): void {
    if (this.#state === "blocked") {
      throw new McpInvocationSupervisorError(
        "mcp-command-settlement-uncertain",
      );
    }
  }

  #block(): void {
    if (this.#state === "blocked") {
      return;
    }
    this.#state = "blocked";
    for (const listener of [...this.#blockListeners]) {
      try {
        listener();
      } catch {}
    }
  }

  assertReady(callerSignal?: AbortSignal): void {
    this.#assertStateReady();
    if (callerSignal?.aborted === true) {
      throw new McpInvocationSupervisorError("mcp-command-cancelled");
    }
  }

  async run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    options: McpInvocationRunOptions,
  ): Promise<T> {
    validateOptions(options);
    this.assertReady(options.callerSignal);

    const operationController = new AbortController();
    let deadlineTimer: NodeJS.Timeout | undefined;
    let interruption: Interruption | undefined;
    let removeCallerListener: (() => void) | undefined;
    let removeBlockListener: (() => void) | undefined;
    let signalInterruption: ((value: FirstOutcome<T>) => void) | undefined;
    const interrupted = new Promise<FirstOutcome<T>>((resolve) => {
      signalInterruption = resolve;
    });
    const interrupt = (value: Interruption): void => {
      if (interruption !== undefined) {
        return;
      }
      interruption = value;
      signalInterruption?.({ type: "interrupted", interruption: value });
    };

    if (options.callerSignal !== undefined) {
      const onCallerAbort = (): void => interrupt("cancelled");
      options.callerSignal.addEventListener("abort", onCallerAbort, {
        once: true,
      });
      removeCallerListener = (): void =>
        options.callerSignal?.removeEventListener("abort", onCallerAbort);
      if (options.callerSignal.aborted) {
        interrupt("cancelled");
      }
    }
    const onSupervisorBlock = (): void => {
      interrupt("blocked");
      operationController.abort(
        new McpInvocationSupervisorError(
          "mcp-command-settlement-uncertain",
        ),
      );
    };
    this.#blockListeners.add(onSupervisorBlock);
    removeBlockListener = (): void => {
      this.#blockListeners.delete(onSupervisorBlock);
    };

    const cleanupInterruption = (): void => {
      removeCallerListener?.();
      removeBlockListener?.();
      if (deadlineTimer !== undefined) {
        clearTimeout(deadlineTimer);
      }
    };

    if (interruption !== undefined) {
      cleanupInterruption();
      const error = interruptionError(interruption);
      operationController.abort(error);
      throw error;
    }

    deadlineTimer = setTimeout(() => interrupt("deadline"), options.timeoutMs);
    const operationOutcome: Promise<OperationOutcome<T>> = Promise.resolve()
      .then(() => operation(operationController.signal))
      .then(
        (value): OperationOutcome<T> => ({ type: "fulfilled", value }),
        (error: unknown): OperationOutcome<T> => ({
          type: "rejected",
          error,
        }),
      );

    const first = await Promise.race<FirstOutcome<T>>([
      operationOutcome,
      interrupted,
    ]);
    if (first.type === "fulfilled") {
      cleanupInterruption();
      this.#assertStateReady();
      return first.value;
    }
    if (first.type === "rejected") {
      cleanupInterruption();
      this.#assertStateReady();
      throw first.error;
    }

    cleanupInterruption();
    const error = interruptionError(first.interruption);
    operationController.abort(error);
    const settlement = await waitForSettlement(
      operationOutcome,
      options.graceMs,
    );
    if (settlement === undefined) {
      this.#block();
      throw new McpInvocationSupervisorError(
        "mcp-command-settlement-uncertain",
      );
    }
    this.#assertStateReady();
    throw error;
  }
}
