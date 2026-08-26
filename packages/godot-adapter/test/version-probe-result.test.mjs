import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as godot from "../dist/index.js";

function processIdentity() {
  const body = {
    pid: 4242,
    spawnedAt: "2026-08-27T03:00:00.001Z",
    processToken: "123e4567-e89b-42d3-a456-426614174200",
    executableDigest: contracts.sha256Digest("godot executable"),
    rootIdentityDigest: contracts.sha256Digest("godot project"),
  };
  return {
    ...body,
    identityDigest: contracts.digestCanonicalJson(body),
  };
}

function processResult({
  outcome = "exited",
  exitCode = 0,
  signal = null,
  stdout = "4.7.2.stable.official.ed1daf0bf\n",
  stderr = "",
  stopReason,
  outputTruncated = outcome === "output-limit",
} = {}) {
  const spawned = outcome !== "spawn-failed";
  const stopped = outcome !== "exited" && outcome !== "spawn-failed";
  const uncertain = outcome === "termination-uncertain";
  const reason =
    stopReason ?? (uncertain ? "timed-out" : stopped ? outcome : undefined);
  const stdoutBytes = Buffer.byteLength(stdout);
  const stderrBytes = Buffer.byteLength(stderr);
  const capturedBytes = stdoutBytes + stderrBytes;
  return {
    outcome,
    ...(spawned ? { identity: processIdentity() } : {}),
    startedAt: "2026-08-27T03:00:00.000Z",
    endedAt: "2026-08-27T03:00:00.010Z",
    durationMs: 10,
    exitCode,
    signal,
    ...(spawned ? {} : { spawnErrorCode: "ENOENT" }),
    output: {
      stdout,
      stderr,
      stdoutDigest: contracts.sha256Digest(stdout),
      stderrDigest: contracts.sha256Digest(stderr),
      stdoutObservedBytes: stdoutBytes,
      stderrObservedBytes: stderrBytes,
      capturedBytes,
      observedBytes: capturedBytes,
      truncated: outputTruncated,
    },
    termination: {
      requested: stopped,
      ...(reason === undefined ? {} : { reason }),
      escalated: stopped,
      confirmed: !uncertain,
    },
    mutationUncertain: stopped,
  };
}

test("Godot version output parser accepts one canonical bounded line", () => {
  assert.equal(typeof godot.parseGodotVersionOutput, "function");

  const exact = godot.parseGodotVersionOutput(
    "4.7.2.stable.official.ed1daf0bf\n",
  );
  assert.deepEqual(exact, {
    status: "parsed",
    version: "4.7.2",
    releaseStatus: "stable",
    qualifiers: ["official", "ed1daf0bf"],
    outputDigest: contracts.sha256Digest(
      "4.7.2.stable.official.ed1daf0bf\n",
    ),
    exactTargetMatch: true,
  });
  assert.equal(Object.isFrozen(exact), true);
  assert.equal(Object.isFrozen(exact.qualifiers), true);

  const zeroPatch = godot.parseGodotVersionOutput(
    "4.7.stable.mono.double.custom_build.012345678\r\n",
  );
  assert.equal(zeroPatch.status, "parsed");
  assert.equal(zeroPatch.version, "4.7.0");
  assert.deepEqual(zeroPatch.qualifiers, [
    "mono",
    "double",
    "custom_build",
    "012345678",
  ]);
  assert.equal(zeroPatch.exactTargetMatch, false);

  const prerelease = godot.parseGodotVersionOutput(
    "4.7.2.rc1.official.abcdef123\n",
  );
  assert.equal(prerelease.status, "parsed");
  assert.equal(prerelease.releaseStatus, "rc1");
  assert.equal(prerelease.exactTargetMatch, false);
});

test("Godot version output parser rejects ambiguous or hostile text without reflection", () => {
  for (const [value, code] of [
    ["4.7.2.stable.official.ed1daf0bf", "godot-version-output-framing-invalid"],
    ["v4.7.2.stable.official.ed1daf0bf\n", "godot-version-output-format-invalid"],
    ["4.07.2.stable.official.ed1daf0bf\n", "godot-version-output-format-invalid"],
    ["4.7.2.stable\n", "godot-version-output-format-invalid"],
    [" 4.7.2.stable.official.ed1daf0bf\n", "godot-version-output-format-invalid"],
    ["4.7.2.stable.official.ed1daf0bf\nsecond\n", "godot-version-output-framing-invalid"],
    ["4.7.2.stable.official.\u001b[31m\n", "godot-version-output-control-invalid"],
    [`4.7.2.stable.${"x".repeat(600)}\n`, "godot-version-output-byte-limit"],
  ]) {
    const parsed = godot.parseGodotVersionOutput(value);
    assert.deepEqual(parsed, { status: "invalid", code });
    assert.equal(JSON.stringify(parsed).includes(value), false);
  }
});

test("version probe result separates match, mismatch, output, and process outcomes", () => {
  assert.equal(typeof godot.classifyGodotVersionProbeResult, "function");

  const matched = godot.classifyGodotVersionProbeResult(processResult());
  assert.equal(matched.status, "matched");
  assert.equal(matched.code, "godot-version-target-match");
  assert.equal(matched.version.version, "4.7.2");
  assert.equal(matched.process.code, "process.exited-zero");
  assert.equal("stdout" in matched, false);
  assert.equal(JSON.stringify(matched).includes("official.ed1daf0bf"), false);

  const mismatch = godot.classifyGodotVersionProbeResult(
    processResult({ stdout: "4.8.stable.official.abcdef123\n" }),
  );
  assert.equal(mismatch.status, "mismatched");
  assert.equal(mismatch.code, "godot-version-target-mismatch");
  assert.equal(mismatch.version.version, "4.8.0");

  const invalid = godot.classifyGodotVersionProbeResult(
    processResult({ stdout: "not-godot\n" }),
  );
  assert.deepEqual(
    { status: invalid.status, code: invalid.code },
    {
      status: "invalid-output",
      code: "godot-version-output-format-invalid",
    },
  );
  assert.equal("version" in invalid, false);

  const diagnostic = godot.classifyGodotVersionProbeResult(
    processResult({ stderr: "unexpected diagnostic" }),
  );
  assert.equal(diagnostic.status, "invalid-output");
  assert.equal(diagnostic.code, "godot-version-diagnostic-output");

  const failed = godot.classifyGodotVersionProbeResult(
    processResult({ exitCode: 7, stdout: "" }),
  );
  assert.equal(failed.status, "process-failed");
  assert.equal(failed.code, "process.exit-nonzero");

  const cancelled = godot.classifyGodotVersionProbeResult(
    processResult({
      outcome: "cancelled",
      exitCode: null,
      signal: "SIGTERM",
      stdout: "",
      stopReason: "cancelled",
    }),
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.code, "process.cancelled");

  const uncertain = godot.classifyGodotVersionProbeResult(
    processResult({
      outcome: "termination-uncertain",
      exitCode: null,
      signal: null,
      stdout: "",
      stopReason: "timed-out",
    }),
  );
  assert.equal(uncertain.status, "uncertain");
  assert.equal(uncertain.code, "process.termination-uncertain");
  assert.equal(uncertain.process.mutationUncertain, true);
});

test("version probe classification rejects forged process observations", () => {
  const forged = processResult();
  forged.output.stdoutDigest = contracts.sha256Digest("different bytes");
  assert.throws(
    () => godot.classifyGodotVersionProbeResult(forged),
    (error) =>
      error?.name === "EvidenceNormalizationError" &&
      error?.code === "invalid-process-result-observation",
  );
});
