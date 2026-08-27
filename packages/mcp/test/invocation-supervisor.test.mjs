import assert from "node:assert/strict";
import test from "node:test";

import {
  McpInvocationSupervisor,
  McpInvocationSupervisorError,
} from "../dist/invocation-supervisor.js";

function isSupervisorError(code) {
  return (error) =>
    error instanceof McpInvocationSupervisorError && error.code === code;
}

test("invocation supervisor returns a result that settles before its deadline", async () => {
  const supervisor = new McpInvocationSupervisor();
  let operationSignal;

  const result = await supervisor.run(
    async (signal) => {
      operationSignal = signal;
      return "complete";
    },
    { timeoutMs: 1_000, graceMs: 0 },
  );

  assert.equal(result, "complete");
  assert.equal(operationSignal?.aborted, false);
  assert.equal(supervisor.state, "ready");
});

test("invocation supervisor refuses a pre-cancelled call before dispatch", async () => {
  const supervisor = new McpInvocationSupervisor();
  const caller = new AbortController();
  let started = false;
  caller.abort("private caller reason");

  await assert.rejects(
    supervisor.run(
      async () => {
        started = true;
        return "unexpected";
      },
      { timeoutMs: 1_000, graceMs: 0, callerSignal: caller.signal },
    ),
    (error) => {
      assert.equal(
        isSupervisorError("mcp-command-cancelled")(error),
        true,
      );
      assert.doesNotMatch(error.message, /private caller reason/u);
      return true;
    },
  );
  assert.equal(started, false);
  assert.equal(supervisor.state, "ready");
});

test("invocation supervisor aborts and waits for cooperative caller cancellation settlement", async () => {
  const supervisor = new McpInvocationSupervisor();
  const caller = new AbortController();
  let operationAbortReason;
  let observedAbort = false;
  let settled = false;
  let signalOperationStarted;
  const operationStarted = new Promise((resolve) => {
    signalOperationStarted = resolve;
  });

  const execution = supervisor.run(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            operationAbortReason = signal.reason;
            queueMicrotask(() => {
              settled = true;
              resolve("cancelled result");
            });
          },
          { once: true },
        );
        signalOperationStarted();
      }),
    { timeoutMs: 1_000, graceMs: 100, callerSignal: caller.signal },
  );

  await operationStarted;
  caller.abort("private caller reason");

  await assert.rejects(
    execution,
    isSupervisorError("mcp-command-cancelled"),
  );
  assert.equal(observedAbort, true);
  assert.equal(
    isSupervisorError("mcp-command-cancelled")(operationAbortReason),
    true,
  );
  assert.equal(settled, true);
  assert.equal(supervisor.state, "ready");
});

test("invocation supervisor aborts and waits for deadline settlement", async () => {
  const supervisor = new McpInvocationSupervisor();
  let operationAbortReason;
  let observedAbort = false;

  const execution = supervisor.run(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            observedAbort = true;
            operationAbortReason = signal.reason;
            resolve("late result");
          },
          { once: true },
        );
      }),
    { timeoutMs: 20, graceMs: 100 },
  );

  await assert.rejects(
    execution,
    isSupervisorError("mcp-command-deadline"),
  );
  assert.equal(observedAbort, true);
  assert.equal(
    isSupervisorError("mcp-command-deadline")(operationAbortReason),
    true,
  );
  assert.equal(supervisor.state, "ready");
});

test("uncertain cancellation permanently blocks the invocation supervisor", async () => {
  const supervisor = new McpInvocationSupervisor();
  const caller = new AbortController();
  let rejectOperation;
  let signalOperationStarted;
  let operationSignal;
  let secondStarted = false;
  const operationStarted = new Promise((resolve) => {
    signalOperationStarted = resolve;
  });

  const execution = supervisor.run(
    (signal) => {
      operationSignal = signal;
      signalOperationStarted();
      return new Promise((_resolve, reject) => {
        rejectOperation = reject;
      });
    },
    { timeoutMs: 1_000, graceMs: 20, callerSignal: caller.signal },
  );

  await operationStarted;
  caller.abort();
  await assert.rejects(
    execution,
    isSupervisorError("mcp-command-settlement-uncertain"),
  );
  assert.equal(operationSignal?.aborted, true);
  assert.equal(supervisor.state, "blocked");

  await assert.rejects(
    supervisor.run(
      async () => {
        secondStarted = true;
        return "unexpected";
      },
      { timeoutMs: 1_000, graceMs: 0 },
    ),
    isSupervisorError("mcp-command-settlement-uncertain"),
  );
  assert.equal(secondStarted, false);

  rejectOperation(new Error("late private failure"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(supervisor.state, "blocked");
});

test("an uncertain peer prevents an already-running invocation from returning success", async () => {
  const supervisor = new McpInvocationSupervisor();
  const caller = new AbortController();
  let releaseBlockingOperation;
  let releasePeerOperation;
  let peerSignal;
  let signalBlockingStarted;
  let signalPeerStarted;
  const blockingStarted = new Promise((resolve) => {
    signalBlockingStarted = resolve;
  });
  const peerStarted = new Promise((resolve) => {
    signalPeerStarted = resolve;
  });

  const blockingExecution = supervisor.run(
    () => {
      signalBlockingStarted();
      return new Promise((resolve) => {
        releaseBlockingOperation = resolve;
      });
    },
    { timeoutMs: 1_000, graceMs: 20, callerSignal: caller.signal },
  );
  const peerExecution = supervisor.run(
    (signal) => {
      peerSignal = signal;
      signalPeerStarted();
      return new Promise((resolve) => {
        releasePeerOperation = resolve;
      });
    },
    { timeoutMs: 1_000, graceMs: 20 },
  );

  await Promise.all([blockingStarted, peerStarted]);
  caller.abort();
  await assert.rejects(
    blockingExecution,
    isSupervisorError("mcp-command-settlement-uncertain"),
  );
  const peerWasAbortedWhenBlocked = peerSignal?.aborted;
  const peerAbortReason = peerSignal?.reason;
  releasePeerOperation("must not escape");
  await assert.rejects(
    peerExecution,
    isSupervisorError("mcp-command-settlement-uncertain"),
  );
  assert.equal(peerWasAbortedWhenBlocked, true);
  assert.equal(
    isSupervisorError("mcp-command-settlement-uncertain")(peerAbortReason),
    true,
  );

  releaseBlockingOperation("late result");
  await new Promise((resolve) => setImmediate(resolve));
});

test("operation failure wins when it settles before interruption", async () => {
  const supervisor = new McpInvocationSupervisor();
  const failure = new Error("operation failure");

  await assert.rejects(
    supervisor.run(
      async () => {
        throw failure;
      },
      { timeoutMs: 1_000, graceMs: 0 },
    ),
    (error) => error === failure,
  );
  assert.equal(supervisor.state, "ready");
});
