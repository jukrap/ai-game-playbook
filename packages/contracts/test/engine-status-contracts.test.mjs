import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function report() {
  const value = {
    schemaVersion: "1.0.0",
    commandId: "engine.status",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("a"),
    engine: "godot",
    project: {
      status: "detected",
      requestedPath: "C:\\game",
      canonicalPath: "C:\\game",
      rootIdentityDigest: digest("b"),
      inspectionDigest: digest("c"),
      candidate: {
        completeness: "complete",
        observationDigest: digest("d"),
        version: {
          raw: "4.7",
          normalized: "4.7.0",
          precision: "major-minor",
        },
      },
    },
    executable: {
      status: "candidate",
      source: "explicit",
      candidate: {
        label: "Godot.exe",
        platform: "windows",
        bytes: 1024,
        digest: digest("e"),
        identityDigest: digest("f"),
      },
      versionProbePerformed: false,
    },
    compatibility: {
      targetVersion: "4.7.2",
      status: "major-minor-match",
      reason: "The project feature hint matches the pinned major/minor target.",
    },
    support: {
      grade: "planned",
      evidenceGrade: "implemented",
      reason: "No retained engine execution receipt exists.",
    },
    issues: [],
    statusDigest: digest("0"),
    mutationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
  };
  value.statusDigest = contracts.computeEngineStatusDigest({
    registryDigest: value.registryDigest,
    engine: value.engine,
    project: value.project,
    executable: value.executable,
    compatibility: value.compatibility,
    support: value.support,
    issues: value.issues,
  });
  return value;
}

test("engine status contracts derive a deterministic read-only report", () => {
  assert.equal(contracts.engineStatusRequestSchema.version, "1.0.0");
  assert.equal(contracts.engineStatusReportSchema.version, "1.0.0");
  const value = report();

  assert.equal(contracts.computeEngineStatusStatus(value.issues), "ready");
  assert.doesNotThrow(() => contracts.assertEngineStatusReportSemantics(value));
  assert.match(value.statusDigest, /^sha256:[0-9a-f]{64}$/u);
});

test("engine status semantics reject promotion and derived-state contradictions", () => {
  const promoted = report();
  promoted.support = {
    grade: "detected",
    evidenceGrade: "locally-executed",
    reason: "A candidate was observed.",
    receiptDigest: digest("1"),
  };
  assert.throws(
    () =>
      contracts.computeEngineStatusDigest({
        registryDigest: promoted.registryDigest,
        engine: promoted.engine,
        project: promoted.project,
        executable: promoted.executable,
        compatibility: promoted.compatibility,
        support: promoted.support,
        issues: promoted.issues,
      }),
    /support grade/u,
  );

  const mismatched = report();
  mismatched.compatibility = {
    ...mismatched.compatibility,
    status: "major-minor-mismatch",
  };
  assert.throws(
    () =>
      contracts.computeEngineStatusDigest({
        registryDigest: mismatched.registryDigest,
        engine: mismatched.engine,
        project: mismatched.project,
        executable: mismatched.executable,
        compatibility: mismatched.compatibility,
        support: mismatched.support,
        issues: mismatched.issues,
      }),
    /compatibility/u,
  );

  const stale = report();
  stale.status = "attention";
  assert.throws(
    () => contracts.assertEngineStatusReportSemantics(stale),
    /status/u,
  );
});

test("engine status digest binds every bounded observation", () => {
  const first = report();
  const changed = report();
  changed.executable = {
    ...changed.executable,
    candidate: { ...changed.executable.candidate, bytes: 1025 },
  };
  const changedDigest = contracts.computeEngineStatusDigest({
    registryDigest: changed.registryDigest,
    engine: changed.engine,
    project: changed.project,
    executable: changed.executable,
    compatibility: changed.compatibility,
    support: changed.support,
    issues: changed.issues,
  });

  assert.notEqual(first.statusDigest, changedDigest);
});
