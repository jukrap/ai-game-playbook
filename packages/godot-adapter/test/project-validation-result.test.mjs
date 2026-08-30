import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as godot from "../dist/index.js";

const manifestUrl = new URL(
  "../../../golden/graybox/godot/manifest.json",
  import.meta.url,
);

async function expectation() {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  return godot.createGodotProjectValidationExpectation({
    projectId: manifest.projectId,
    sourceDigest: manifest.sourceDigest,
    mainScene: manifest.mainScene,
  });
}

function line(event, ending = "\n") {
  return `${godot.GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX}${JSON.stringify(event)}${ending}`;
}

function output(expected, terminal = "passed", ending = "\n") {
  const identity = {
    projectId: expected.projectId,
    sourceDigest: expected.sourceDigest,
    mainScene: expected.mainScene,
  };
  return [
    line({ event: "validation-started", ...identity }, ending),
    line(
      terminal === "passed"
        ? {
            event: "validation-passed",
            ...identity,
            resourceType: "PackedScene",
            rootType: "Node3D",
          }
        : {
            event: "validation-failed",
            ...identity,
            code: "main-scene-load-failed",
          },
      ending,
    ),
  ].join("");
}

test("Godot project validator parser accepts one identity-bound terminal transcript", async () => {
  const expected = await expectation();
  const passedOutput = output(expected);
  const passed = godot.parseGodotProjectValidationOutput(
    passedOutput,
    expected,
  );
  assert.equal(passed.status, "parsed");
  assert.equal(passed.transcript.terminal.event, "validation-passed");
  assert.deepEqual(passed.transcript.wire, {
    outputDigest: contracts.sha256Digest(passedOutput),
    bytes: Buffer.byteLength(passedOutput),
    eventCount: 2,
    lineEnding: "lf",
  });
  assert.equal(passed.transcript.expectationDigest, expected.expectationDigest);
  assert.equal(JSON.stringify(passed).includes(passedOutput), false);
  assert.equal(Object.isFrozen(expected), true);
  assert.equal(Object.isFrozen(passed.transcript), true);

  const failed = godot.parseGodotProjectValidationOutput(
    output(expected, "failed", "\r\n"),
    expected,
  );
  assert.equal(failed.status, "parsed");
  assert.equal(failed.transcript.terminal.event, "validation-failed");
  assert.equal(failed.transcript.terminal.code, "main-scene-load-failed");
  assert.equal(failed.transcript.wire.lineEnding, "crlf");
});

test("Godot project validator parser rejects framing, prefix, and JSON ambiguity", async () => {
  const expected = await expectation();
  const valid = output(expected);
  const lines = valid.trimEnd().split("\n");
  const duplicate =
    `${godot.GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX}` +
    `{"event":"validation-started","event":"validation-started",` +
    `"projectId":"${expected.projectId}",` +
    `"sourceDigest":"${expected.sourceDigest}",` +
    `"mainScene":"${expected.mainScene}"}\n${lines[1]}\n`;

  for (const [candidate, code] of [
    [valid.slice(0, -1), "godot-project-validation-output-framing-invalid"],
    [
      valid.replace("\n", "\r\n"),
      "godot-project-validation-output-framing-invalid",
    ],
    [
      `engine diagnostic\n${valid}`,
      "godot-project-validation-output-event-count-invalid",
    ],
    [
      `${lines[0]}\n`,
      "godot-project-validation-output-event-count-invalid",
    ],
    [
      `${godot.GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX}{}\n${lines[1]}\n`,
      "godot-project-validation-output-json-invalid",
    ],
    [duplicate, "godot-project-validation-output-json-invalid"],
    [
      `${"x".repeat(contracts.GODOT_PROJECT_VALIDATION_MAX_LINE_BYTES + 1)}\n${lines[1]}\n`,
      "godot-project-validation-output-line-limit",
    ],
    [
      "x".repeat(contracts.GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES + 1),
      "godot-project-validation-output-byte-limit",
    ],
  ]) {
    assert.deepEqual(
      godot.parseGodotProjectValidationOutput(candidate, expected),
      { status: "invalid", code },
    );
  }
});

test("Godot project validator parser rejects event order, shape, and identity drift", async () => {
  const expected = await expectation();
  const validEvents = output(expected)
    .trimEnd()
    .split("\n")
    .map((entry) =>
      JSON.parse(
        entry.slice(godot.GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX.length),
      ),
    );

  const reversed = structuredClone(validEvents).reverse().map((event) => line(event)).join("");
  assert.deepEqual(
    godot.parseGodotProjectValidationOutput(reversed, expected),
    {
      status: "invalid",
      code: "godot-project-validation-output-event-sequence-invalid",
    },
  );

  const drifted = structuredClone(validEvents);
  drifted[1].sourceDigest = contracts.sha256Digest("other source");
  assert.deepEqual(
    godot.parseGodotProjectValidationOutput(
      drifted.map((event) => line(event)).join(""),
      expected,
    ),
    {
      status: "invalid",
      code: "godot-project-validation-output-identity-invalid",
    },
  );

  const malformed = structuredClone(validEvents);
  malformed[1].resourceType = "Texture2D";
  assert.deepEqual(
    godot.parseGodotProjectValidationOutput(
      malformed.map((event) => line(event)).join(""),
      expected,
    ),
    {
      status: "invalid",
      code: "godot-project-validation-output-event-shape-invalid",
    },
  );
});

test("Godot project validation expectation rejects accessors without invoking them", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  let invoked = false;
  const value = {
    projectId: manifest.projectId,
    sourceDigest: manifest.sourceDigest,
    mainScene: manifest.mainScene,
  };
  Object.defineProperty(value, "mainScene", {
    enumerable: true,
    get() {
      invoked = true;
      return manifest.mainScene;
    },
  });
  assert.throws(
    () => godot.createGodotProjectValidationExpectation(value),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-project-validation-expectation-invalid",
  );
  assert.equal(invoked, false);
});
