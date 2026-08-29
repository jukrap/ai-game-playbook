import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as engineCommon from "../dist/index.js";

const sessionOperations = new Set([
  "mutate",
  "save",
  "compile-import",
  "test",
  "play",
  "input-replay",
  "logs",
  "capture",
  "profile",
  "build-export",
  "rollback",
]);

const mutationOperations = new Set(["mutate", "save", "rollback"]);

function digest(label) {
  return contracts.digestCanonicalJson({ label });
}

function request(operation) {
  return Object.freeze({
    schemaVersion: "1.0.0",
    requestId: "11111111-1111-4111-8111-111111111111",
    operation,
    operationVersion: "1.0.0",
    commandId: `engine.${operation}`,
    projectIdentityDigest: digest("project"),
    ...(sessionOperations.has(operation)
      ? { sessionIdentityDigest: digest("session") }
      : {}),
    ...(mutationOperations.has(operation)
      ? { featureContractDigest: digest("feature") }
      : {}),
    registryDigest: digest("registry"),
    approvalIds: [],
    payload: Object.freeze({
      schemaId: "urn:ai-game-playbook:schema:test-payload:1.0.0",
      schemaDigest: digest("payload-schema"),
      valueDigest: digest("payload-value"),
    }),
    deadlineAt: "2026-08-29T12:00:00.000Z",
    budgets: Object.freeze({
      maxDurationMs: 1_000,
      maxOutputBytes: 1_024,
      maxChangedFiles: 0,
      maxChangedBytes: 0,
      maxRepairCycles: 0,
    }),
  });
}

function resultFor(operationRequest) {
  return Object.freeze({
    schemaVersion: "1.0.0",
    requestId: operationRequest.requestId,
    operation: operationRequest.operation,
    projectIdentityDigest: operationRequest.projectIdentityDigest,
    ...(operationRequest.sessionIdentityDigest === undefined
      ? {}
      : { sessionIdentityDigest: operationRequest.sessionIdentityDigest }),
    support: "planned",
    evidenceGrade: "documented",
    status: "blocked",
    outer: Object.freeze({
      status: "blocked",
      timedOut: false,
      cancelled: false,
    }),
    inner: Object.freeze({
      status: "blocked",
      code: "engine-operation-not-implemented",
      message: "The fixture does not execute an engine operation.",
    }),
    diagnostics: Object.freeze([]),
    artifacts: Object.freeze([]),
    mutation: mutationOperations.has(operationRequest.operation)
      ? "not-started"
      : "not-applicable",
    receiptDigest: digest(`receipt-${operationRequest.operation}`),
    completedAt: "2026-08-29T11:59:00.000Z",
  });
}

function adapterFixture(onCall = () => {}) {
  const operations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(
      ({ method, operation }) => [
        method,
        async ({ request: operationRequest, signal }) => {
          onCall({ method, operation, request: operationRequest, signal });
          return resultFor(operationRequest);
        },
      ],
    ),
  );
  return engineCommon.createEngineAdapter({
    identity: {
      id: "godot",
      version: "0.0.0",
      protocolVersion: "1.0.0",
    },
    operations,
  });
}

function expectEngineError(code) {
  return (error) =>
    error?.name === "EngineCommonBoundaryError" && error?.code === code;
}

test("common adapter bindings cover every engine operation exactly once", () => {
  assert.deepEqual(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(
      ({ operation }) => operation,
    ),
    contracts.ENGINE_OPERATION_KINDS,
  );
  assert.equal(
    new Set(
      engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(
        ({ method }) => method,
      ),
    ).size,
    contracts.ENGINE_OPERATION_KINDS.length,
  );
});

test("factory creates one immutable same-process adapter authority", () => {
  const adapter = adapterFixture();

  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(Object.isFrozen(adapter.identity), true);
  assert.deepEqual(adapter.identity, {
    id: "godot",
    version: "0.0.0",
    protocolVersion: "1.0.0",
  });
  for (const { method } of engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS) {
    assert.equal(typeof adapter[method], "function");
  }

  const forged = Object.freeze({
    ...adapter,
    identity: Object.freeze({ ...adapter.identity }),
  });
  assert.throws(
    () => engineCommon.assertEngineAdapterAuthority(forged),
    expectEngineError("engine-adapter-authority-invalid"),
  );
  assert.doesNotThrow(() =>
    engineCommon.assertEngineAdapterAuthority(adapter),
  );
});

test("factory rejects missing, extra, and non-function operation slots", () => {
  const valid = adapterFixture();
  const operations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
      method,
      valid[method],
    ]),
  );
  const definition = (candidate) => ({
    identity: {
      id: "godot",
      version: "0.0.0",
      protocolVersion: "1.0.0",
    },
    operations: candidate,
  });

  const missing = { ...operations };
  delete missing.capture;
  assert.throws(
    () => engineCommon.createEngineAdapter(definition(missing)),
    expectEngineError("engine-adapter-definition-invalid"),
  );
  assert.throws(
    () =>
      engineCommon.createEngineAdapter(
        definition({ ...operations, privateEscape: () => {} }),
      ),
    expectEngineError("engine-adapter-definition-invalid"),
  );
  assert.throws(
    () =>
      engineCommon.createEngineAdapter(
        definition({ ...operations, capture: "not-a-function" }),
      ),
    expectEngineError("engine-adapter-definition-invalid"),
  );
});

test("dispatch routes every operation once and preserves exact request and signal", async () => {
  const calls = [];
  const adapter = adapterFixture((call) => calls.push(call));

  for (const operation of contracts.ENGINE_OPERATION_KINDS) {
    const operationRequest = request(operation);
    const controller = new AbortController();
    const result = await engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: operationRequest,
      signal: controller.signal,
    });

    assert.equal(result.operation, operation);
    const call = calls.at(-1);
    assert.equal(call.operation, operation);
    assert.notEqual(call.request, operationRequest);
    assert.deepEqual(call.request, operationRequest);
    assert.equal(Object.isFrozen(call.request), true);
    assert.equal(Object.isFrozen(call.request.payload), true);
    assert.equal(Object.isFrozen(call.request.approvalIds), true);
    assert.equal(call.signal, controller.signal);
  }

  assert.equal(calls.length, contracts.ENGINE_OPERATION_KINDS.length);
});

test("pre-cancelled dispatch never invokes an adapter method", async () => {
  let calls = 0;
  const adapter = adapterFixture(() => {
    calls += 1;
  });
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));

  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: request("inspect"),
      signal: controller.signal,
    }),
    expectEngineError("engine-adapter-cancelled-before-start"),
  );
  assert.equal(calls, 0);
});

test("dispatch rejects result correlation drift", async () => {
  const baseRequest = request("play");
  const validResult = resultFor(baseRequest);
  for (const [field, value] of [
    ["requestId", "22222222-2222-4222-8222-222222222222"],
    ["operation", "capture"],
    ["projectIdentityDigest", digest("other-project")],
    ["sessionIdentityDigest", digest("other-session")],
  ]) {
    const operations = Object.fromEntries(
      engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
        method,
        async () => Object.freeze({ ...validResult, [field]: value }),
      ]),
    );
    const adapter = engineCommon.createEngineAdapter({
      identity: {
        id: "godot",
        version: "0.0.0",
        protocolVersion: "1.0.0",
      },
      operations,
    });

    await assert.rejects(
      engineCommon.dispatchEngineAdapterOperation(adapter, {
        request: baseRequest,
        signal: new AbortController().signal,
      }),
      expectEngineError("engine-adapter-result-mismatch"),
      field,
    );
  }
});

test("factory and dispatch parsing never invoke accessors", async () => {
  let called = false;
  const identity = {
    id: "godot",
    version: "0.0.0",
    protocolVersion: "1.0.0",
  };
  Object.defineProperty(identity, "id", {
    enumerable: true,
    get() {
      called = true;
      return "godot";
    },
  });
  assert.throws(
    () =>
      engineCommon.createEngineAdapter({
        identity,
        operations: {},
      }),
    expectEngineError("engine-adapter-definition-invalid"),
  );
  assert.equal(called, false);

  const adapter = adapterFixture();
  const hostile = {
    request: request("inspect"),
    signal: new AbortController().signal,
  };
  Object.defineProperty(hostile, "request", {
    enumerable: true,
    get() {
      called = true;
      return request("inspect");
    },
  });
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, hostile),
    expectEngineError("engine-adapter-invocation-invalid"),
  );
  assert.equal(called, false);

  const valid = resultFor(request("inspect"));
  const hostileResult = { ...valid };
  Object.defineProperty(hostileResult, "requestId", {
    enumerable: true,
    get() {
      called = true;
      return valid.requestId;
    },
  });
  const resultOperations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
      method,
      async () => hostileResult,
    ]),
  );
  const resultAdapter = engineCommon.createEngineAdapter({
    identity: {
      id: "godot",
      version: "0.0.0",
      protocolVersion: "1.0.0",
    },
    operations: resultOperations,
  });
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(resultAdapter, {
      request: request("inspect"),
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-result-mismatch"),
  );
  assert.equal(called, false);
});

test("adapter data rejects primitive roots and custom array prototypes", async () => {
  let calls = 0;
  const adapter = adapterFixture(() => {
    calls += 1;
  });

  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: null,
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-operation-invalid"),
  );

  const approvalIds = [];
  Object.setPrototypeOf(approvalIds, Object.create(null));
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: { ...request("inspect"), approvalIds },
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-invocation-invalid"),
  );

  const fallback = adapterFixture();
  const resultless = engineCommon.createEngineAdapter({
    identity: fallback.identity,
    operations: Object.fromEntries(
      engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
        method,
        method === "inspect" ? async () => null : fallback[method],
      ]),
    ),
  });
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(resultless, {
      request: request("inspect"),
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-result-mismatch"),
  );
  assert.equal(calls, 0);
});

test("factory and dispatch reject proxies before invoking traps", async () => {
  let traps = 0;
  const trap = () => {
    traps += 1;
    throw new Error("proxy trap must not run");
  };
  const hostileDefinition = new Proxy(
    {},
    {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    },
  );
  assert.throws(
    () => engineCommon.createEngineAdapter(hostileDefinition),
    expectEngineError("engine-adapter-definition-invalid"),
  );
  assert.equal(traps, 0);

  const adapter = adapterFixture();
  const operations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
      method,
      adapter[method],
    ]),
  );
  operations.capture = new Proxy(operations.capture, {
    apply: trap,
    get: trap,
    getPrototypeOf: trap,
  });
  assert.throws(
    () =>
      engineCommon.createEngineAdapter({
        identity: adapter.identity,
        operations,
      }),
    expectEngineError("engine-adapter-definition-invalid"),
  );
  assert.equal(traps, 0);

  const hostileInvocation = new Proxy(
    {},
    {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    },
  );
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, hostileInvocation),
    expectEngineError("engine-adapter-invocation-invalid"),
  );
  assert.equal(traps, 0);

  const hostileRequest = new Proxy(
    {},
    {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    },
  );
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: hostileRequest,
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-invocation-invalid"),
  );
  assert.equal(traps, 0);

  const hostileSignal = new Proxy(new AbortController().signal, {
    get: trap,
    getPrototypeOf: trap,
  });
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: request("inspect"),
      signal: hostileSignal,
    }),
    expectEngineError("engine-adapter-invocation-invalid"),
  );
  assert.equal(traps, 0);

  const hostileResultField = new Proxy(
    {},
    {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    },
  );
  const hostileResult = {
    ...resultFor(request("inspect")),
    outer: hostileResultField,
  };
  const resultOperations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
      method,
      async () => hostileResult,
    ]),
  );
  const resultAdapter = engineCommon.createEngineAdapter({
    identity: adapter.identity,
    operations: resultOperations,
  });
  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(resultAdapter, {
      request: request("inspect"),
      signal: new AbortController().signal,
    }),
    expectEngineError("engine-adapter-result-mismatch"),
  );
  assert.equal(traps, 0);
});

test("handler failures propagate once without implicit retry", async () => {
  const expected = new Error("operation failed after admission");
  let calls = 0;
  const operations = Object.fromEntries(
    engineCommon.ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
      method,
      async () => {
        calls += 1;
        throw expected;
      },
    ]),
  );
  const adapter = engineCommon.createEngineAdapter({
    identity: {
      id: "godot",
      version: "0.0.0",
      protocolVersion: "1.0.0",
    },
    operations,
  });

  await assert.rejects(
    engineCommon.dispatchEngineAdapterOperation(adapter, {
      request: request("mutate"),
      signal: new AbortController().signal,
    }),
    (error) => error === expected,
  );
  assert.equal(calls, 1);
});
