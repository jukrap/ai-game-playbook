import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import { rgbaPng } from "../../evidence/test/fixtures/png.mjs";
import * as godot from "../dist/index.js";

const scenarioUrl = new URL(
  "../../../golden/graybox/scenario.json",
  import.meta.url,
);
const runId = "123e4567-e89b-42d3-a456-426614174300";

async function scenario() {
  return JSON.parse(await readFile(scenarioUrl, "utf8"));
}

function stateFor(oracle) {
  return oracle.stateHashFields.map((path, index) => ({ path, value: index }));
}

function captureLine(event) {
  return `${godot.GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX}${JSON.stringify(event)}\n`;
}

function replayEvents(value) {
  const oracles = [...value.checkpoints, ...value.terminal].map((oracle) => {
    const state = stateFor(oracle);
    return {
      event: "oracle-passed",
      oracleId: oracle.oracleId,
      terminal: value.terminal.includes(oracle),
      tick: oracle.atTick ?? oracle.withinTicks.firstTick,
      state,
      stateHash: contracts.computeGodotDeterministicReplayStateHash(state),
    };
  });
  const terminalTick = oracles.at(-1).tick;
  return {
    oracles,
    terminalTick,
    replayTerminal: {
      event: "replay-passed",
      tick: terminalTick,
      scenarioDigest: contracts.computePlaytestScenarioDigest(value),
    },
  };
}

function captureStarted(expectation) {
  return {
    event: "capture-started",
    runId: expectation.runId,
    scenarioId: expectation.scenarioId,
    scenarioDigest: expectation.scenarioDigest,
    seed: expectation.seed,
    inputBindingDigest: expectation.inputBindingDigest,
    sceneId: expectation.sceneId,
    cameraId: expectation.cameraId,
  };
}

function capturePassed(expectation, replay, artifact) {
  return {
    event: "capture-passed",
    runId: expectation.runId,
    tick: replay.terminalTick,
    scenarioDigest: expectation.scenarioDigest,
    stateDigest: [...replay.oracles].reverse().find(({ terminal }) => terminal)
      .stateHash,
    inputBindingDigest: expectation.inputBindingDigest,
    sceneId: expectation.sceneId,
    cameraId: expectation.cameraId,
    renderer: expectation.renderer,
    renderingDriver: "opengl3",
    displayServer: "windows",
    engineVersion: expectation.engineVersion,
    engineStatus: expectation.engineStatus,
    viewport: expectation.viewport,
    artifactDigest: contracts.sha256Digest(artifact),
    artifactBytes: artifact.byteLength,
  };
}

function successfulOutput(value, expectation, artifact) {
  const replay = replayEvents(value);
  return [
    captureStarted(expectation),
    ...replay.oracles,
    replay.replayTerminal,
    capturePassed(expectation, replay, artifact),
  ]
    .map(captureLine)
    .join("");
}

function parseSuccess(value, expectation, artifact) {
  const output = successfulOutput(value, expectation, artifact);
  const parsed = godot.parseGodotRuntimeFrameCaptureOutput(output, expectation);
  assert.equal(parsed.status, "parsed");
  return { output, parsed };
}

function runtimeFramePng(width = 960, height = 540) {
  return Uint8Array.from(rgbaPng({ width, height }));
}

function expectGodotError(code) {
  return (error) => error?.name === "GodotAdapterBoundaryError" && error?.code === code;
}

test("Godot runtime frame expectation binds one exact scenario and runtime profile", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });

  assert.equal(expectation.scenarioDigest, godot.GODOT_GRAYBOX_SCENARIO_DIGEST);
  assert.equal(expectation.cameraId, "camera.follow");
  assert.equal(expectation.renderer, "gl_compatibility");
  assert.deepEqual(expectation.viewport, {
    width: 960,
    height: 540,
    scale: "1.000000",
  });
  assert.equal(expectation.engineVersion, "4.7.2");
  assert.equal(expectation.engineStatus, "stable");
  assert.equal(Object.isFrozen(expectation), true);
  assert.equal(Object.isFrozen(expectation.viewport), true);
  assert.equal(contracts.isSha256Digest(expectation.inputBindingDigest), true);
  assert.equal(contracts.isSha256Digest(expectation.expectationDigest), true);

  assert.throws(
    () =>
      godot.parseGodotRuntimeFrameCaptureOutput(
        "",
        structuredClone(expectation),
      ),
    expectGodotError("godot-capture-expectation-invalid"),
  );
  assert.throws(
    () =>
      godot.createGodotRuntimeFrameCaptureExpectation({
        runId: "not-a-run-id",
        scenario: value,
      }),
    expectGodotError("godot-capture-expectation-invalid"),
  );
});

test("Godot runtime frame parser accepts a complete replay-bound capture transcript", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });
  const artifact = runtimeFramePng();
  const { output, parsed } = parseSuccess(value, expectation, artifact);

  assert.equal(parsed.transcript.replayTerminal.event, "replay-passed");
  assert.equal(parsed.transcript.captureTerminal.event, "capture-passed");
  assert.equal(parsed.transcript.captureTerminal.artifactDigest, contracts.sha256Digest(artifact));
  assert.equal(parsed.transcript.captureTerminal.artifactBytes, artifact.byteLength);
  assert.equal(parsed.transcript.wire.outputDigest, contracts.sha256Digest(output));
  assert.equal(parsed.transcript.wire.bytes, Buffer.byteLength(output));
  assert.equal(
    parsed.transcript.wire.eventCount,
    value.checkpoints.length + value.terminal.length + 3,
  );
  assert.equal(Object.isFrozen(parsed.transcript), true);
  assert.equal(Object.isFrozen(parsed.transcript.captureTerminal.viewport), true);
  assert.equal(JSON.stringify(parsed).includes("runtime-frame.png"), false);
});

test("Godot runtime frame parser keeps replay and capture failures distinct", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });
  const first = value.checkpoints[0];
  const replayFailure = [
    captureStarted(expectation),
    {
      event: "replay-failed",
      code: "oracle-failed",
      tick: first.atTick,
      scenarioDigest: expectation.scenarioDigest,
      oracleId: first.oracleId,
    },
  ]
    .map(captureLine)
    .join("");
  const failedReplay = godot.parseGodotRuntimeFrameCaptureOutput(
    replayFailure,
    expectation,
  );
  assert.equal(failedReplay.status, "parsed");
  assert.equal(failedReplay.transcript.replayTerminal.event, "replay-failed");
  assert.equal(failedReplay.transcript.captureTerminal, undefined);

  const replay = replayEvents(value);
  const captureFailure = [
    captureStarted(expectation),
    ...replay.oracles,
    replay.replayTerminal,
    {
      event: "capture-failed",
      runId: expectation.runId,
      code: "display-unavailable",
      tick: replay.terminalTick,
      scenarioDigest: expectation.scenarioDigest,
    },
  ]
    .map(captureLine)
    .join("");
  const failedCapture = godot.parseGodotRuntimeFrameCaptureOutput(
    captureFailure,
    expectation,
  );
  assert.equal(failedCapture.status, "parsed");
  assert.equal(failedCapture.transcript.replayTerminal.event, "replay-passed");
  assert.deepEqual(failedCapture.transcript.captureTerminal, {
    event: "capture-failed",
    runId: expectation.runId,
    code: "display-unavailable",
    tick: replay.terminalTick,
    scenarioDigest: expectation.scenarioDigest,
  });
});

test("Godot runtime frame parser rejects framing and identity drift fail-closed", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });
  const artifact = runtimeFramePng();
  const valid = successfulOutput(value, expectation, artifact);
  const lines = valid.trimEnd().split("\n");

  const duplicateKey = lines[0].replace(
    '{"event":"capture-started",',
    '{"event":"capture-started","event":"capture-started",',
  );
  const replayHash = replayEvents(value).oracles[0].stateHash;
  const terminalDriftLines = [...lines];
  const terminalDrift = JSON.parse(
    terminalDriftLines.at(-1).slice(
      godot.GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX.length,
    ),
  );
  terminalDrift.stateDigest = contracts.sha256Digest("terminal drift");
  terminalDriftLines[terminalDriftLines.length - 1] = captureLine(terminalDrift).trimEnd();
  const pathLikeDisplayLines = [...lines];
  const pathLikeDisplay = JSON.parse(
    pathLikeDisplayLines.at(-1).slice(
      godot.GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX.length,
    ),
  );
  pathLikeDisplay.displayServer = "C:\\Users\\name";
  pathLikeDisplayLines[pathLikeDisplayLines.length - 1] = captureLine(pathLikeDisplay).trimEnd();
  for (const [output, expected] of [
    [valid.slice(0, -1), { code: "godot-capture-output-framing-invalid" }],
    [`engine diagnostic\n${valid}`, { code: "godot-capture-output-prefix-invalid" }],
    [valid.replace("\n", "\r\n"), { code: "godot-capture-output-framing-invalid" }],
    [valid.replace("\n", "\u0000\n"), { code: "godot-capture-output-control-invalid" }],
    [
      "x".repeat(expectation.maximumOutputBytes + 1),
      { code: "godot-capture-output-byte-limit" },
    ],
    [
      `${godot.GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX}${"x".repeat(
        contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_LINE_BYTES,
      )}\n`,
      { code: "godot-capture-output-line-limit" },
    ],
    [
      `${`${godot.GODOT_RUNTIME_FRAME_CAPTURE_OUTPUT_PREFIX}{}\n`.repeat(
        contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_EVENTS + 1,
      )}`,
      { code: "godot-capture-output-line-limit" },
    ],
    [
      `${duplicateKey}\n${lines.slice(1).join("\n")}\n`,
      { code: "godot-capture-output-json-invalid" },
    ],
    [
      valid.replace(expectation.runId, "123e4567-e89b-42d3-a456-426614174301"),
      { code: "godot-capture-output-start-mismatch" },
    ],
    [
      valid.replace(replayHash, contracts.sha256Digest("oracle drift")),
      {
        code: "godot-capture-output-replay-invalid",
        replayCode: "godot-replay-output-state-hash-invalid",
      },
    ],
    [
      `${terminalDriftLines.join("\n")}\n`,
      { code: "godot-capture-output-capture-terminal-invalid" },
    ],
    [
      `${pathLikeDisplayLines.join("\n")}\n`,
      { code: "godot-capture-output-capture-terminal-invalid" },
    ],
  ]) {
    const parsed = godot.parseGodotRuntimeFrameCaptureOutput(output, expectation);
    assert.equal(parsed.status, "invalid");
    assert.equal(parsed.code, expected.code);
    if (expected.replayCode !== undefined) {
      assert.equal(parsed.replayCode, expected.replayCode);
    }
  }
});

test("Godot runtime frame artifact requires exact attestation and RGBA8 viewport shape", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });
  const artifact = runtimeFramePng();
  const { parsed } = parseSuccess(value, expectation, artifact);
  const attestation = {
    digest: contracts.sha256Digest(artifact),
    bytes: artifact.byteLength,
  };
  const assessed = godot.assessGodotRuntimeFrameArtifact({
    transcript: parsed.transcript,
    attestation,
    content: artifact,
  });

  assert.equal(assessed.status, "validated");
  assert.equal(assessed.format.kind, "png");
  assert.equal(assessed.format.width, 960);
  assert.equal(assessed.format.height, 540);
  assert.equal(
    assessed.format.decodedBytes,
    godot.GODOT_RUNTIME_FRAME_CAPTURE_MAX_DECODED_BYTES,
  );
  assert.equal(Object.isFrozen(assessed), true);
  assert.equal(Object.isFrozen(assessed.format), true);

  const identityMismatch = godot.assessGodotRuntimeFrameArtifact({
    transcript: parsed.transcript,
    attestation: { ...attestation, digest: contracts.sha256Digest("wrong") },
    content: artifact,
  });
  assert.equal(identityMismatch.code, "godot-capture-artifact-identity-mismatch");
  assert.throws(
    () =>
      godot.assessGodotRuntimeFrameArtifact({
        transcript: structuredClone(parsed.transcript),
        attestation,
        content: artifact,
      }),
    expectGodotError("godot-capture-artifact-request-invalid"),
  );
  assert.throws(
    () =>
      godot.assessGodotRuntimeFrameArtifact({
        transcript: parsed.transcript,
        attestation,
        content: Buffer.from(artifact),
      }),
    expectGodotError("godot-capture-artifact-request-invalid"),
  );

  const wrongShape = runtimeFramePng(959, 540);
  const wrongShapeTranscript = parseSuccess(value, expectation, wrongShape).parsed
    .transcript;
  assert.equal(
    godot.assessGodotRuntimeFrameArtifact({
      transcript: wrongShapeTranscript,
      attestation: {
        digest: contracts.sha256Digest(wrongShape),
        bytes: wrongShape.byteLength,
      },
      content: wrongShape,
    }).code,
    "godot-capture-artifact-png-shape-invalid",
  );

  const invalidPng = Uint8Array.from(new Array(8).fill(0));
  const invalidTranscript = parseSuccess(value, expectation, invalidPng).parsed
    .transcript;
  assert.equal(
    godot.assessGodotRuntimeFrameArtifact({
      transcript: invalidTranscript,
      attestation: {
        digest: contracts.sha256Digest(invalidPng),
        bytes: invalidPng.byteLength,
      },
      content: invalidPng,
    }).code,
    "godot-capture-artifact-invalid-png",
  );
});

test("Godot runtime frame evidence requires original validated transcript and artifact", async () => {
  const value = await scenario();
  const expectation = godot.createGodotRuntimeFrameCaptureExpectation({
    runId,
    scenario: value,
  });
  const content = runtimeFramePng();
  const { parsed } = parseSuccess(value, expectation, content);
  const artifact = godot.assessGodotRuntimeFrameArtifact({
    transcript: parsed.transcript,
    attestation: {
      digest: contracts.sha256Digest(content),
      bytes: content.byteLength,
    },
    content,
  });
  assert.equal(artifact.status, "validated");

  const request = {
    transcript: parsed.transcript,
    artifact,
    projectIdentityDigest: contracts.sha256Digest("project identity"),
    sessionIdentityDigest: contracts.sha256Digest("session identity"),
    capturedAt: "2026-08-30T03:00:00.000Z",
  };
  registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    {
      schemaId: contracts.runtimeFrameEvidenceSchema.schemaId,
      digest: contracts.runtimeFrameEvidenceSchema.digest,
    },
    {
      schemaVersion: "1.0.0",
      artifactDigest: parsed.transcript.captureTerminal.artifactDigest,
      bytes: parsed.transcript.captureTerminal.artifactBytes,
      complete: true,
      origin: "standalone-player",
      runId: parsed.transcript.captureTerminal.runId,
      tick: parsed.transcript.captureTerminal.tick,
      stateDigest: parsed.transcript.captureTerminal.stateDigest,
      inputTraceDigest: parsed.transcript.captureTerminal.inputBindingDigest,
      projectIdentityDigest: request.projectIdentityDigest,
      sessionIdentityDigest: request.sessionIdentityDigest,
      engine: "godot",
      engineVersion: parsed.transcript.captureTerminal.engineVersion,
      renderer: parsed.transcript.captureTerminal.renderer,
      sceneId: parsed.transcript.captureTerminal.sceneId,
      cameraId: parsed.transcript.captureTerminal.cameraId,
      viewport: parsed.transcript.captureTerminal.viewport,
      seed: parsed.transcript.started.seed,
      capturedAt: request.capturedAt,
    },
  );
  const frame = godot.createGodotRuntimeFrameEvidence(request);
  assert.equal(frame.origin, "standalone-player");
  assert.equal(frame.artifactDigest, artifact.digest);
  assert.equal(frame.bytes, artifact.bytes);
  assert.equal(frame.inputTraceDigest, expectation.inputBindingDigest);
  assert.equal(frame.projectIdentityDigest, request.projectIdentityDigest);
  assert.equal(frame.sessionIdentityDigest, request.sessionIdentityDigest);
  assert.equal(Object.isFrozen(frame), true);
  assert.equal(Object.isFrozen(frame.viewport), true);
  assert.equal(JSON.stringify(frame).includes("runtime-frame.png"), false);
  assert.equal(JSON.stringify(frame).includes("content"), false);

  assert.throws(
    () =>
      godot.createGodotRuntimeFrameEvidence({
        ...request,
        transcript: structuredClone(parsed.transcript),
      }),
    expectGodotError("godot-capture-frame-evidence-invalid"),
  );
  assert.throws(
    () =>
      godot.createGodotRuntimeFrameEvidence({
        ...request,
        artifact: structuredClone(artifact),
      }),
    expectGodotError("godot-capture-frame-evidence-invalid"),
  );
});
