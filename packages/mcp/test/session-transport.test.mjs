import assert from "node:assert/strict";
import test from "node:test";

import { serializeMessage } from "@modelcontextprotocol/server";

import { BoundedMcpSessionTransport } from "../dist/session-transport.js";

class FakeTransport {
  onclose;
  onerror;
  onmessage;
  closed = false;
  failSend = false;
  sent = [];

  async start() {}

  async send(message) {
    if (this.failSend) {
      throw new Error("send failure");
    }
    this.sent.push(message);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  receive(message) {
    this.onmessage?.(message);
  }
}

function request(id) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  };
}

function response(id) {
  return {
    jsonrpc: "2.0",
    id,
    result: {},
  };
}

function createHarness(budgets) {
  const inner = new FakeTransport();
  const transport = new BoundedMcpSessionTransport(inner, budgets);
  const errors = [];
  const received = [];
  transport.onerror = (error) => errors.push(error);
  transport.onmessage = (message) => received.push(message);
  return { errors, inner, received, transport };
}

test("session transport bounds aggregate serialized input bytes", async () => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  };
  const oneMessageBytes = Buffer.byteLength(
    serializeMessage(notification),
    "utf8",
  );
  const harness = createHarness({
    maxMessages: 4,
    maxPendingRequests: 2,
    maxSerializedInputBytes: oneMessageBytes,
  });
  await harness.transport.start();

  harness.inner.receive(notification);
  harness.inner.receive(notification);

  assert.equal(harness.received.length, 1);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.errors[0]?.message, "MCP STDIO session budget exceeded.");
  assert.equal(harness.inner.closed, true);
});

test("session transport rejects excess pending requests", async () => {
  const harness = createHarness({
    maxMessages: 8,
    maxPendingRequests: 2,
    maxSerializedInputBytes: 16_384,
  });
  await harness.transport.start();

  harness.inner.receive(request(1));
  harness.inner.receive(request(2));
  harness.inner.receive(request(3));

  assert.deepEqual(harness.received, [request(1), request(2)]);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.inner.closed, true);
});

test("session transport releases a request only after its response is sent", async () => {
  const harness = createHarness({
    maxMessages: 8,
    maxPendingRequests: 2,
    maxSerializedInputBytes: 16_384,
  });
  await harness.transport.start();

  harness.inner.receive(request(1));
  harness.inner.receive(request(2));
  await harness.transport.send(response(1));
  harness.inner.receive(request(3));
  harness.inner.receive(request(2));

  assert.deepEqual(harness.received, [request(1), request(2), request(3)]);
  assert.deepEqual(harness.inner.sent, [response(1)]);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.inner.closed, true);
});

test("session transport closes even when its error observer throws", async () => {
  const inner = new FakeTransport();
  const transport = new BoundedMcpSessionTransport(inner, {
    maxMessages: 1,
    maxPendingRequests: 1,
    maxSerializedInputBytes: 16_384,
  });
  transport.onerror = () => {
    throw new Error("observer failure");
  };
  transport.onmessage = () => {};
  await transport.start();

  inner.receive({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.doesNotThrow(() =>
    inner.receive({ jsonrpc: "2.0", method: "notifications/initialized" }),
  );
  assert.equal(inner.closed, true);
});

test("session transport retains pending authority when response send fails", async () => {
  const harness = createHarness({
    maxMessages: 4,
    maxPendingRequests: 1,
    maxSerializedInputBytes: 16_384,
  });
  await harness.transport.start();

  harness.inner.receive(request(1));
  harness.inner.failSend = true;
  await assert.rejects(
    () => harness.transport.send(response(1)),
    /send failure/u,
  );
  harness.inner.failSend = false;
  harness.inner.receive(request(2));

  assert.deepEqual(harness.received, [request(1)]);
  assert.deepEqual(harness.inner.sent, []);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.inner.closed, true);
});
