import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function report() {
  const value = {
    schemaVersion: "1.0.0",
    commandId: "engine.version-probe",
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("a"),
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    project: {
      id: "sample.graybox",
      identityDigest: digest("b"),
      rootIdentityDigest: digest("c"),
      inspectionDigest: digest("d"),
    },
    executable: {
      digest: digest("e"),
      identityDigest: digest("f"),
    },
    targetVersion: "4.7.2",
    targetReleaseStatus: "stable",
    status: "matched",
    code: "godot-version-target-match",
    process: {
      component: "process",
      status: "passed",
      code: "process.exited-zero",
      message: "Process exited successfully.",
      outer: { status: "passed", exitCode: 0, timedOut: false },
      mutationUncertain: false,
      outputTruncated: false,
      terminationConfirmed: true,
    },
    output: {
      stdoutDigest: digest("1"),
      stderrDigest: digest("2"),
      stdoutObservedBytes: 28,
      stderrObservedBytes: 0,
      capturedBytes: 28,
      observedBytes: 28,
      truncated: false,
    },
    version: {
      status: "parsed",
      version: "4.7.2",
      releaseStatus: "stable",
      qualifiers: ["official", "abcdef123"],
      outputDigest: digest("1"),
      exactTargetMatch: true,
    },
    execution: {
      startedAt: "2026-08-27T01:00:00.000Z",
      endedAt: "2026-08-27T01:00:00.010Z",
      durationMs: 10,
      processStarted: true,
    },
    isolation: {
      filesystem: "not-enforced",
      network: "not-enforced",
    },
    authorization: {
      authorizationId: "018f6f35-2c9e-7d1a-8a4b-123456789abe",
      requestDigest: digest("3"),
      status: "succeeded",
      mutationUncertain: false,
      violations: [],
      durationMs: 10,
      outputBytes: 28,
      settledAt: "2026-08-27T01:00:00.011Z",
    },
  };
  const { schemaVersion: _, commandId: __, ...digestInput } = value;
  return {
    ...value,
    probeDigest: contracts.computeGodotVersionProbeDigest(digestInput),
  };
}

test("Godot version probe contracts bind an internal process result without raw output", () => {
  assert.equal(contracts.godotVersionProbeRequestSchema.version, "1.0.0");
  assert.equal(contracts.godotVersionProbeReportSchema.version, "1.0.0");

  const value = report();
  assert.doesNotThrow(() => contracts.assertGodotVersionProbeReportSemantics(value));
  assert.equal("stdout" in value.output, false);
  assert.equal("path" in value.executable, false);
});

test("Godot version probe semantics reject forged outcome and digest relationships", () => {
  const value = report();
  assert.throws(
    () =>
      contracts.assertGodotVersionProbeReportSemantics({
        ...value,
        status: "mismatched",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertGodotVersionProbeReportSemantics({
        ...value,
        output: { ...value.output, stdoutDigest: digest("9") },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertGodotVersionProbeReportSemantics({
        ...value,
        isolation: { filesystem: "enforced", network: "not-enforced" },
      }),
    TypeError,
  );
});
