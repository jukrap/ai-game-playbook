import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { validFoundationProtocolFixtures } from "./fixtures/foundation-protocols.mjs";

const expectedIds = [
  "approval-grant",
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
    [
      "approval-grant",
      {
        ...fixtures["approval-grant"],
        budgets: { ...fixtures["approval-grant"].budgets, maxUses: 2 },
      },
    ],
    [
      "approval-grant",
      {
        ...fixtures["approval-grant"],
        scope: { ...fixtures["approval-grant"].scope, destinations: [] },
      },
    ],
    [
      "approval-grant",
      {
        ...fixtures["approval-grant"],
        permission: "editor-control",
      },
    ],
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
      "run-handle",
      {
        ...fixtures["run-handle"],
        status: "waiting-approval",
      },
    ],
    [
      "run-handle",
      {
        ...fixtures["run-handle"],
        status: "queued",
      },
    ],
    [
      "run-handle",
      (() => {
        const { latestReceiptDigest: _, ...terminalWithoutReceipt } = {
          ...fixtures["run-handle"],
          status: "blocked",
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
      "engine-session-identity",
      (() => {
        const { nonceDigest: _, ...withoutNonce } =
          fixtures["engine-session-identity"];
        return withoutNonce;
      })(),
    ],
    [
      "engine-session-identity",
      (() => {
        const { editorInstanceId: _, ...withoutEditorInstance } =
          fixtures["engine-session-identity"];
        return withoutEditorInstance;
      })(),
    ],
    [
      "engine-operation-request",
      {
        ...fixtures["engine-operation-request"],
        operation: "mutate",
      },
    ],
    [
      "engine-operation-request",
      {
        ...fixtures["engine-operation-request"],
        operation: "play",
      },
    ],
    [
      "engine-operation-request",
      {
        ...fixtures["engine-operation-request"],
        operation: "capture",
      },
    ],
    [
      "engine-operation-result",
      (() => {
        const { receiptDigest: _, ...withoutReceipt } =
          fixtures["engine-operation-result"];
        return withoutReceipt;
      })(),
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        operation: "play",
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
        support: "planned",
      },
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        evidenceGrade: "implemented",
      },
    ],
    [
      "engine-operation-result",
      {
        ...fixtures["engine-operation-result"],
        support: "editor-preview",
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
        support: "planned",
      },
    ],
    [
      "build-artifact-evidence",
      {
        ...fixtures["build-artifact-evidence"],
        support: "headless",
        evidenceGrade: "implemented",
      },
    ],
    [
      "build-artifact-evidence",
      {
        ...fixtures["build-artifact-evidence"],
        support: "editor-preview",
        evidenceGrade: "locally-executed",
      },
    ],
    [
      "build-artifact-evidence",
      (() => {
        const fixture = structuredClone(fixtures["build-artifact-evidence"]);
        delete fixture.startup.logsDigest;
        return fixture;
      })(),
    ],
    [
      "build-artifact-evidence",
      (() => {
        const fixture = structuredClone(fixtures["build-artifact-evidence"]);
        delete fixture.startup.exitCode;
        return fixture;
      })(),
    ],
    [
      "build-artifact-evidence",
      {
        ...fixtures["build-artifact-evidence"],
        startup: {
          attempted: false,
          outcome: "passed",
          durationMs: 0,
          logsDigest: fixtures["build-artifact-evidence"].startup.logsDigest,
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

test("build evidence separates an unattempted startup from verified execution", () => {
  const validate = validator().compile(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["build-artifact-evidence"].schema,
  );
  const fixture = structuredClone(
    validFoundationProtocolFixtures["build-artifact-evidence"],
  );
  delete fixture.scenarioReceiptDigest;
  fixture.support = "headless";
  fixture.evidenceGrade = "locally-executed";
  fixture.startup = {
    attempted: false,
    outcome: "not-run",
    durationMs: 0,
  };

  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
});

test("engine sessions distinguish editor and standalone runtime instances", () => {
  const validate = validator().compile(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["engine-session-identity"].schema,
  );
  const fixture = validFoundationProtocolFixtures["engine-session-identity"];
  const { editorInstanceId: _, ...withoutEditorInstance } = fixture;
  const runtime = {
    ...withoutEditorInstance,
    executionKind: "runtime",
    runtimeInstanceId: "runtime.graybox-primary",
  };

  assert.equal(
    validate(runtime),
    true,
    JSON.stringify(validate.errors),
  );

  const { runtimeInstanceId: __, ...runtimeWithoutInstance } = runtime;
  assert.equal(validate(runtimeWithoutInstance), false);

  assert.equal(
    validate({
      ...withoutEditorInstance,
      executionKind: "packaged",
    }),
    false,
  );
});

test("every foundation protocol rejects a mismatched schema version", () => {
  const ajv = validator();

  for (const [id, fixture] of Object.entries(validFoundationProtocolFixtures)) {
    const validate = ajv.compile(
      contracts.FOUNDATION_PROTOCOL_SCHEMAS[id].schema,
    );
    assert.equal(
      validate({ ...fixture, schemaVersion: "999.0.0" }),
      false,
      `${id} accepted a mismatched schema version`,
    );
  }
});
