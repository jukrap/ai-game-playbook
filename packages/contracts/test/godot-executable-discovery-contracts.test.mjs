import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = (character) => `sha256:${character.repeat(64)}`;

function report() {
  const value = {
    schemaVersion: "1.0.0",
    commandId: "engine.executable-discovery",
    controlPlaneVersion: "0.0.0",
    registryDigest: digest("a"),
    engine: "godot",
    project: {
      requestedPath: "D:\\games\\sample",
      ready: true,
      canonicalPath: "D:\\games\\sample",
      rootIdentityDigest: digest("b"),
      inspectionDigest: digest("c"),
      statusDigest: digest("d"),
    },
    sources: {
      configuredPathCount: 1,
      pathDirectoryCount: 2,
      consideredPathCount: 5,
      acceptedPathCount: 2,
      missingPathCount: 3,
      rejectedPathCount: 0,
      acceptedCandidateCount: 1,
      sourceDigest: digest("e"),
    },
    candidates: [
      {
        label: "Godot.exe",
        platform: "windows",
        sources: ["configured", "path"],
        bytes: 1024,
        digest: digest("f"),
        identityDigest: digest("1"),
      },
    ],
    issues: [],
    authorization: {
      authorizationId: "018f6f35-2c9e-7d1a-8a4b-123456789abe",
      requestDigest: digest("2"),
      permission: "host-tool-inspection",
      grantIds: ["approval.host-tool-inspection"],
      status: "succeeded",
      durationMs: 10,
      settledAt: "2026-08-27T01:00:00.010Z",
    },
    status: "ready",
    candidateSelectionAvailable: true,
    executionAuthorityGranted: false,
    rawPathsDisclosed: false,
    recursiveSearchPerformed: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    installPerformed: false,
  };
  const {
    schemaVersion: _,
    commandId: __,
    status: ___,
    candidateSelectionAvailable: ____,
    executionAuthorityGranted: _____,
    rawPathsDisclosed: ______,
    recursiveSearchPerformed: _______,
    mutationPerformed: ________,
    externalProcessStarted: _________,
    networkAccessPerformed: __________,
    installPerformed: ___________,
    ...digestInput
  } = value;
  return {
    ...value,
    discoveryDigest:
      contracts.computeGodotExecutableDiscoveryDigest(digestInput),
  };
}

test("Godot executable discovery contracts omit raw paths and execution authority", () => {
  assert.equal(
    contracts.godotExecutableDiscoveryRequestSchema.version,
    "1.0.0",
  );
  assert.equal(
    contracts.godotExecutableDiscoveryReportSchema.version,
    "1.0.0",
  );

  const value = report();
  assert.doesNotThrow(() =>
    contracts.assertGodotExecutableDiscoveryReportSemantics(value),
  );
  assert.equal("path" in value.candidates[0], false);
  assert.equal(value.executionAuthorityGranted, false);
  assert.equal(value.rawPathsDisclosed, false);
  assert.deepEqual(value.authorization.grantIds, [
    "approval.host-tool-inspection",
  ]);
});

test("Godot executable discovery semantics reject forged counts and authority", () => {
  const value = report();
  assert.throws(
    () =>
      contracts.assertGodotExecutableDiscoveryReportSemantics({
        ...value,
        sources: { ...value.sources, consideredPathCount: 6 },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertGodotExecutableDiscoveryReportSemantics({
        ...value,
        executionAuthorityGranted: true,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertGodotExecutableDiscoveryReportSemantics({
        ...value,
        candidates: [
          ...value.candidates,
          { ...value.candidates[0], sources: ["path"] },
        ],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertGodotExecutableDiscoveryReportSemantics({
        ...value,
        authorization: { ...value.authorization, grantIds: [] },
      }),
    TypeError,
  );
});
