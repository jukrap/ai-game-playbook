import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { validFoundationProtocolFixtures } from "./fixtures/foundation-protocols.mjs";

const expectedIds = [
  "approval-grant",
  "build-artifact-evidence",
  "doctor-report",
  "doctor-request",
  "engine-capabilities-report",
  "engine-capabilities-request",
  "engine-diagnostic",
  "engine-operation-request",
  "engine-operation-result",
  "engine-project-identity",
  "engine-session-identity",
  "engine-status-report",
  "engine-status-request",
  "godot-executable-discovery-report",
  "godot-executable-discovery-request",
  "godot-headless-preflight-report",
  "godot-headless-preflight-request",
  "godot-version-probe-report",
  "godot-version-probe-request",
  "init-report",
  "init-request",
  "input-replay-trace",
  "pack-doctor-report",
  "pack-doctor-request",
  "pack-list-report",
  "pack-list-request",
  "process-containment-assessment-report",
  "process-containment-assessment-request",
  "process-containment-provider-descriptor",
  "process-containment-self-test-report",
  "process-containment-self-test-request",
  "project-inspect-report",
  "project-inspect-request",
  "resolved-workflow-plan",
  "run-handle",
  "runtime-frame-evidence",
  "skill-check-report",
  "skill-check-request",
  "skill-list-report",
  "skill-list-request",
  "task-routing-selection",
  "workflow-checkpoint",
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
    [
      "pack-list-request",
      {
        ...fixtures["pack-list-request"],
        sourceRoot: "D:\\packs",
      },
    ],
    [
      "pack-doctor-request",
      {
        ...fixtures["pack-doctor-request"],
        repair: true,
      },
    ],
    [
      "pack-list-report",
      {
        ...fixtures["pack-list-report"],
        artifactContentExposed: true,
      },
    ],
    [
      "pack-doctor-report",
      {
        ...fixtures["pack-doctor-report"],
        recoveryFinalizationPerformed: true,
      },
    ],
    ["run-handle", { ...fixtures["run-handle"], status: "done" }],
    [
      "resolved-workflow-plan",
      (() => {
        const invalid = structuredClone(fixtures["resolved-workflow-plan"]);
        delete invalid.steps[1].rollbackCommand;
        return invalid;
      })(),
    ],
    [
      "workflow-checkpoint",
      {
        ...fixtures["workflow-checkpoint"],
        status: "running",
      },
    ],
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
      "engine-capabilities-request",
      {
        ...fixtures["engine-capabilities-request"],
        executablePath: "D:\\tools\\Godot.exe",
      },
    ],
    [
      "engine-capabilities-report",
      {
        ...fixtures["engine-capabilities-report"],
        externalProcessStarted: true,
      },
    ],
    [
      "engine-capabilities-report",
      (() => {
        const fixture = structuredClone(fixtures["engine-capabilities-report"]);
        fixture.capabilityReport.capabilities[0].support = "detected";
        fixture.capabilityReport.capabilities[0].evidenceGrade =
          "locally-executed";
        fixture.capabilityReport.capabilities[0].latestReceiptDigest =
          fixture.registryDigest;
        return fixture;
      })(),
    ],
    [
      "engine-status-request",
      {
        ...fixtures["engine-status-request"],
        engine: "unity",
      },
    ],
    [
      "engine-status-request",
      {
        ...fixtures["engine-status-request"],
        executablePath: "D:\\tools\\Godot.exe",
      },
    ],
    [
      "engine-status-report",
      {
        ...fixtures["engine-status-report"],
        support: {
          grade: "detected",
          evidenceGrade: "locally-executed",
          reason: "Static evidence was observed.",
        },
      },
    ],
    [
      "engine-status-report",
      {
        ...fixtures["engine-status-report"],
        externalProcessStarted: true,
      },
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
    [
      "process-containment-assessment-report",
      {
        ...fixtures["process-containment-assessment-report"],
        decision: "allow",
      },
    ],
    [
      "process-containment-provider-descriptor",
      {
        ...fixtures["process-containment-provider-descriptor"],
        providerPath: "C:\\forbidden",
      },
    ],
    [
      "process-containment-self-test-request",
      {
        ...fixtures["process-containment-self-test-request"],
        maxDurationMs:
          contracts.PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS + 1,
      },
    ],
    [
      "process-containment-self-test-report",
      (() => {
        const fixture = structuredClone(
          fixtures["process-containment-self-test-report"],
        );
        [fixture.probes[1], fixture.probes[2]] = [
          fixture.probes[2],
          fixture.probes[1],
        ];
        return fixture;
      })(),
    ],
    [
      "process-containment-self-test-report",
      {
        ...fixtures["process-containment-self-test-report"],
        launchAuthority: true,
      },
    ],
    [
      "process-containment-self-test-report",
      {
        ...fixtures["process-containment-self-test-report"],
        effects: {
          ...fixtures["process-containment-self-test-report"].effects,
          projectMutationPerformed: true,
        },
      },
    ],
    [
      "process-containment-assessment-report",
      {
        ...fixtures["process-containment-assessment-report"],
        provider: {
          ...fixtures["process-containment-assessment-report"].provider,
          path: "C:\\tools\\sandbox.exe",
        },
      },
    ],
    [
      "godot-headless-preflight-request",
      {
        ...fixtures["godot-headless-preflight-request"],
        containment: {
          ...fixtures["godot-headless-preflight-request"].containment,
          decision: "allow",
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
