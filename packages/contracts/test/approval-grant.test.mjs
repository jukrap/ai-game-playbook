import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

function grant(overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    grantId: "approval.network-once",
    permission: "network",
    projectId: "sample.graybox",
    projectIdentityDigest: digestA,
    command: {
      id: "evidence.export",
      version: "1.0.0",
      handlerDigest: digestB,
    },
    registryDigest: digestA,
    scope: {
      paths: [],
      objectIds: [],
      destinations: ["https://api.example.com"],
      dataClasses: [],
      publishTargets: [],
    },
    budgets: {
      expiresAt: "2026-08-26T01:07:03.000Z",
      maxUses: 1,
      execution: {
        maxDurationMs: 60_000,
        maxOutputBytes: 1_048_576,
        maxRepairCycles: 0,
      },
    },
    requestDigest: digestB,
    approvedBy: "user",
    approvedAt: "2026-08-26T01:02:03.000Z",
    signature: {
      algorithm: "ed25519",
      keyId: "approval.local-key",
      value: "A".repeat(86),
    },
    ...overrides,
  };
}

test("approval grant signing digest covers authority and excludes only signature", () => {
  assert.equal(typeof contracts.computeApprovalGrantSigningDigest, "function");
  const base = grant();
  const digest = contracts.computeApprovalGrantSigningDigest(base);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    contracts.computeApprovalGrantSigningDigest({
      ...base,
      signature: { ...base.signature, value: "B".repeat(86) },
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalGrantSigningDigest({
      ...base,
      permission: "external-transmission",
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalGrantSigningDigest({
      ...base,
      scope: {
        ...base.scope,
        destinations: ["https://other.example.com"],
      },
    }),
    digest,
  );
  assert.notEqual(
    contracts.computeApprovalGrantSigningDigest({
      ...base,
      budgets: {
        ...base.budgets,
        execution: { ...base.budgets.execution, maxDurationMs: 60_001 },
      },
    }),
    digest,
  );
});

test("approval grant semantics require ordered time and canonical scope", () => {
  assert.deepEqual(contracts.checkApprovalGrantSemantics(grant()), []);

  assert.deepEqual(
    contracts
      .checkApprovalGrantSemantics(
        grant({
          budgets: {
            ...grant().budgets,
            expiresAt: "2026-08-26T01:02:03.000Z",
          },
        }),
      )
      .map(({ code }) => code),
    ["approval-grant-window-invalid"],
  );
  assert.deepEqual(
    contracts
      .checkApprovalGrantSemantics(
        grant({
          scope: {
            ...grant().scope,
            destinations: [
              "https://z.example.com",
              "https://a.example.com",
            ],
          },
        }),
      )
      .map(({ code }) => code),
    ["approval-grant-scope-noncanonical"],
  );
  assert.deepEqual(
    contracts
      .checkApprovalGrantSemantics(
        grant({
          scope: {
            ...grant().scope,
            destinations: ["https://api.example.com:443"],
          },
        }),
      )
      .map(({ code }) => code),
    ["approval-grant-destination-noncanonical"],
  );
});
