import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { validFoundationProtocolFixtures } from "./fixtures/foundation-protocols.mjs";

const expectedIds = [
  "build-artifact-evidence",
  "engine-diagnostic",
  "engine-operation-request",
  "engine-operation-result",
  "engine-project-identity",
  "engine-session-identity",
  "input-replay-trace",
  "run-handle",
  "runtime-frame-evidence",
  "task-routing-selection",
];

function validator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv, { mode: "full" });
  return ajv;
}

test("foundation protocol schemas are complete, versioned, and strictly valid", () => {
  assert.deepEqual(
    Object.keys(contracts.FOUNDATION_PROTOCOL_SCHEMAS).sort(),
    expectedIds,
  );
  const ajv = validator();

  for (const [id, entry] of Object.entries(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS,
  )) {
    assert.equal(entry.id, id);
    assert.equal(entry.version, "1.0.0");
    const validate = ajv.compile(entry.schema);
    assert.equal(
      validate(validFoundationProtocolFixtures[id]),
      true,
      `${id}: ${JSON.stringify(validate.errors)}`,
    );
  }
});

test("foundation protocol schemas reject unsafe lifecycle and evidence shapes", () => {
  const fixtures = validFoundationProtocolFixtures;
  const invalidCases = [
    ["run-handle", { ...fixtures["run-handle"], status: "done" }],
    [
      "run-handle",
      (() => {
        const { latestReceiptDigest: _, ...terminalWithoutReceipt } = {
          ...fixtures["run-handle"],
          status: "succeeded",
        };
        return terminalWithoutReceipt;
      })(),
    ],
    [
      "engine-session-identity",
      {
        ...fixtures["engine-session-identity"],
        process: { ...fixtures["engine-session-identity"].process, pid: 0 },
      },
    ],
    [
      "engine-operation-request",
      {
        ...fixtures["engine-operation-request"],
        operation: "mutate",
      },
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        outer: {
          ...fixtures["engine-operation-result"].outer,
          timedOut: true,
        },
      },
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        support: "verified",
      },
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        mutation: "committed",
      },
    ],
    [
      "runtime-frame-evidence",
      { ...fixtures["runtime-frame-evidence"], complete: false },
    ],
    [
      "task-routing-selection",
      { ...fixtures["task-routing-selection"], skills: [] },
    ],
    [
      "task-routing-selection",
      {
        ...fixtures["task-routing-selection"],
        roleLenses: ["lens.one", "lens.two", "lens.three", "lens.four"],
      },
    ],
    [
      "input-replay-trace",
      {
        ...fixtures["input-replay-trace"],
        events: [
          { ...fixtures["input-replay-trace"].events[0], value: 1 },
        ],
      },
    ],
    [
      "input-replay-trace",
      {
        ...fixtures["input-replay-trace"],
        divergenceCount: 1,
      },
    ],
    [
      "build-artifact-evidence",
      {
        ...fixtures["build-artifact-evidence"],
        startup: {
          ...fixtures["build-artifact-evidence"].startup,
          outcome: "failed",
        },
      },
    ],
    [
      "build-artifact-evidence",
      {
        ...fixtures["build-artifact-evidence"],
        startup: {
          ...fixtures["build-artifact-evidence"].startup,
          exitCode: 17,
        },
      },
    ],
  ];
  const ajv = validator();

  for (const [id, fixture] of invalidCases) {
    const validate = ajv.compile(
      contracts.FOUNDATION_PROTOCOL_SCHEMAS[id].schema,
    );
    assert.equal(validate(fixture), false, `${id} accepted unsafe evidence`);
  }
});
