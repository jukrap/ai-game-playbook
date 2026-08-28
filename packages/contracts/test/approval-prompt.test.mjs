import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

function promptBody(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    requestDigest: digestA,
    project: {
      id: "sample.graybox",
      identityDigest: digestB,
    },
    command: {
      id: "pack.add",
      version: "1.0.0",
      handlerDigest: digestA,
    },
    registryDigest: digestB,
    inputDigest: digestA,
    scope: {
      paths: [".agents/skills/gameplay.vertical-slice"],
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
    },
    budgets: {
      maxChangedFiles: 16,
      maxChangedBytes: 65_536,
      maxDurationMs: 30_000,
      maxOutputBytes: 1_048_576,
      maxRepairCycles: 0,
    },
    deadlineAt: "2026-08-26T01:03:03.000Z",
    permissions: [
      {
        permission: "install",
        mode: "approval-required",
        impactClasses: [
          "project-files-change",
          "software-installation",
        ],
      },
    ],
    ...overrides,
  };
}

test("approval prompt digest binds every displayed authority field", () => {
  assert.equal(typeof contracts.computeApprovalPromptDigest, "function");
  const base = promptBody();
  const digest = contracts.computeApprovalPromptDigest(base);

  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    contracts.computeApprovalPromptDigest({
      ...base,
      promptDigest: `sha256:${"f".repeat(64)}`,
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalPromptDigest({
      ...base,
      deadlineAt: "2026-08-26T01:03:04.000Z",
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalPromptDigest({
      ...base,
      permissions: [
        { ...base.permissions[0], mode: "automatic" },
      ],
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalPromptDigest({
      ...base,
      scope: { ...base.scope, paths: [".agents/skills/other"] },
    }),
    digest,
  );
});

test("approval impact vocabulary covers every permission exactly", () => {
  assert.deepEqual(
    Object.keys(contracts.APPROVAL_PERMISSION_IMPACT_CLASSES).sort(),
    [...contracts.PERMISSION_CLASSES].sort(),
  );
  assert.equal(
    Object.isFrozen(contracts.APPROVAL_PERMISSION_IMPACT_CLASSES),
    true,
  );

  const observed = new Set();
  for (const permission of contracts.PERMISSION_CLASSES) {
    const impacts =
      contracts.APPROVAL_PERMISSION_IMPACT_CLASSES[permission];
    assert.equal(Object.isFrozen(impacts), true, permission);
    assert.equal(new Set(impacts).size, impacts.length, permission);
    for (const impact of impacts) {
      assert.ok(contracts.APPROVAL_IMPACT_CLASSES.includes(impact));
      observed.add(impact);
    }
  }

  assert.deepEqual(
    [...observed].sort(),
    [...contracts.APPROVAL_IMPACT_CLASSES].sort(),
  );
  assert.deepEqual(
    contracts.APPROVAL_PERMISSION_IMPACT_CLASSES.install,
    ["project-files-change", "software-installation"],
  );
  assert.deepEqual(
    contracts.APPROVAL_PERMISSION_IMPACT_CLASSES["read-project"],
    [],
  );
});
