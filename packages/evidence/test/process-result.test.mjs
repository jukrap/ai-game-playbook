import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as core from "@ai-game-playbook/core";
import * as evidence from "../dist/index.js";
import { processResult } from "./fixtures/process-result.mjs";

test("process normalization distinguishes every bounded runner outcome", () => {
  const cases = [
    {
      name: "zero exit",
      input: processResult(),
      status: "passed",
      code: "process.exited-zero",
      outer: { status: "passed", exitCode: 0, timedOut: false },
    },
    {
      name: "nonzero exit",
      input: processResult({ exitCode: 17 }),
      status: "failed",
      code: "process.exit-nonzero",
      outer: { status: "failed", exitCode: 17, timedOut: false },
    },
    {
      name: "signal",
      input: processResult({ exitCode: null, signal: "SIGSEGV" }),
      status: "failed",
      code: "process.signalled",
      outer: { status: "failed", timedOut: false },
    },
    {
      name: "spawn failure",
      input: processResult({ outcome: "spawn-failed", exitCode: null }),
      status: "failed",
      code: "process.spawn-failed",
      outer: { status: "failed", timedOut: false },
    },
    {
      name: "timeout",
      input: processResult({ outcome: "timed-out", exitCode: null, signal: "SIGKILL" }),
      status: "failed",
      code: "process.timed-out",
      outer: { status: "failed", timedOut: true },
    },
    {
      name: "idle timeout",
      input: processResult({
        outcome: "idle-timed-out",
        exitCode: null,
        signal: "SIGTERM",
      }),
      status: "failed",
      code: "process.idle-timed-out",
      outer: { status: "failed", timedOut: true },
    },
    {
      name: "output limit",
      input: processResult({
        outcome: "output-limit",
        exitCode: null,
        signal: "SIGTERM",
      }),
      status: "failed",
      code: "process.output-limit",
      outer: { status: "failed", timedOut: false },
    },
    {
      name: "cancelled",
      input: processResult({
        outcome: "cancelled",
        exitCode: null,
        signal: "SIGTERM",
      }),
      status: "cancelled",
      code: "process.cancelled",
      outer: { status: "cancelled", timedOut: false },
    },
    {
      name: "uncertain termination",
      input: processResult({
        outcome: "termination-uncertain",
        exitCode: null,
        stopReason: "timed-out",
      }),
      status: "uncertain",
      code: "process.termination-uncertain",
      outer: { status: "uncertain", timedOut: true },
    },
  ];

  for (const fixture of cases) {
    const actual = evidence.normalizeProcessResult(fixture.input);
    assert.equal(actual.component, "process", fixture.name);
    assert.equal(actual.status, fixture.status, fixture.name);
    assert.equal(actual.code, fixture.code, fixture.name);
    assert.deepEqual(actual.outer, fixture.outer, fixture.name);
    assert.equal(
      actual.mutationUncertain,
      fixture.input.mutationUncertain,
      fixture.name,
    );
    assert.equal(
      actual.outputTruncated,
      fixture.input.output.truncated,
      fixture.name,
    );
    assert.equal(
      actual.terminationConfirmed,
      fixture.input.termination.confirmed,
      fixture.name,
    );
  }
});

test("process normalization rejects contradictory or open observations", () => {
  const invalid = [
    { ...processResult(), extra: true },
    { ...processResult(), mutationUncertain: true },
    {
      ...processResult({ outcome: "spawn-failed", exitCode: null }),
      identity: processResult().identity,
    },
    {
      ...processResult({ outcome: "output-limit", exitCode: null, signal: "SIGTERM" }),
      output: { ...processResult().output, truncated: false },
    },
    {
      ...processResult(),
      output: {
        ...processResult().output,
        stdoutDigest: "sha256:not-a-digest",
      },
    },
  ];

  for (const value of invalid) {
    assert.throws(
      () => evidence.normalizeProcessResult(value),
      (error) =>
        error?.name === "EvidenceNormalizationError" &&
        error?.code === "invalid-process-result-observation",
    );
  }
});

test("process normalization snapshots input and returns deeply frozen fixed text", () => {
  const input = processResult({ exitCode: 3 });
  const normalized = evidence.normalizeProcessResult(input);
  input.exitCode = 0;
  input.output.truncated = true;

  assert.deepEqual(normalized.outer, {
    status: "failed",
    exitCode: 3,
    timedOut: false,
  });
  assert.equal(normalized.message, "Process exited with a nonzero code.");
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.outer), true);
  assert.throws(() => {
    normalized.outer.status = "passed";
  }, TypeError);
});

test("process normalization accepts an actual bounded process result", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-evidence-process-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = await core.canonicalizeProjectRoot(project);
  const executable = await core.bindProcessExecutable({
    path: process.execPath,
    maxBytes: 512 * 1024 * 1024,
    allowedEnvironmentKeys: [],
  });
  const result = await core.runBoundedProcess({
    root,
    executable,
    arguments: ["-e", "process.exit(0)"],
    workingDirectory: null,
    environment: {},
    limits: {
      timeoutMs: 5_000,
      idleTimeoutMs: 0,
      maxOutputBytes: 64 * 1024,
      terminationGraceMs: 100,
    },
    signal: null,
  });

  const normalized = evidence.normalizeProcessResult(result);
  assert.equal(normalized.status, "passed");
  assert.equal(normalized.code, "process.exited-zero");
  assert.deepEqual(normalized.outer, {
    status: "passed",
    exitCode: 0,
    timedOut: false,
  });
});
