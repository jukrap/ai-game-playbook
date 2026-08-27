import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import * as stdioInput from "../dist/stdio-input.js";

const { BoundedMcpStdioInput } = stdioInput;

test("stdio raw input forwards the exact byte boundary", async () => {
  const input = new BoundedMcpStdioInput(4);
  const chunks = [];
  input.on("data", (chunk) => chunks.push(chunk));
  const ended = once(input, "end");

  input.end(Buffer.from("test", "utf8"));
  await ended;

  assert.equal(Buffer.concat(chunks).toString("utf8"), "test");
});

test("stdio raw input rejects the chunk that crosses its byte boundary", async () => {
  const input = new BoundedMcpStdioInput(4);
  const chunks = [];
  input.on("data", (chunk) => chunks.push(chunk));
  const failed = once(input, "error");

  input.write(Buffer.from("test", "utf8"));
  input.end(Buffer.from("x", "utf8"));
  const [error] = await failed;

  assert.equal(error.message, "MCP STDIO raw input budget exceeded.");
  assert.equal(Buffer.concat(chunks).toString("utf8"), "test");
});

test("stdio raw input rejects invalid budgets before reading", () => {
  for (const budget of [0, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => new BoundedMcpStdioInput(budget),
      /MCP STDIO raw input budget is invalid\./u,
    );
  }
});

test("stdio raw input binding propagates source failure and detaches", async () => {
  const source = new PassThrough();
  const input = new BoundedMcpStdioInput(4);
  const failed = once(input, "error");
  const closed = new Promise((resolve) => input.once("close", resolve));

  assert.equal(typeof stdioInput.pipeMcpStdioInput, "function");
  const detach = stdioInput.pipeMcpStdioInput(source, input);
  source.destroy(new Error("source failure"));

  const [error] = await failed;
  await closed;
  detach();

  assert.equal(error.message, "source failure");
  assert.equal(source.listenerCount("error"), 0);
});

test("stdio raw input binding detaches after normal EOF", async () => {
  const source = new PassThrough();
  const input = new BoundedMcpStdioInput(4);
  const chunks = [];
  input.on("data", (chunk) => chunks.push(chunk));
  const closed = new Promise((resolve) => input.once("close", resolve));

  const detach = stdioInput.pipeMcpStdioInput(source, input);
  source.end(Buffer.from("test", "utf8"));
  await closed;
  detach();

  assert.equal(Buffer.concat(chunks).toString("utf8"), "test");
  assert.equal(source.listenerCount("error"), 0);
});
