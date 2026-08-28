import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;

function challenge() {
  return {
    schemaVersion: "1.0.0",
    sessionId: "018f6f35-2c9e-7d1a-8a4b-123456789abe",
    hostId: "host.codex-local",
    promptDigest: digest,
    requestDigest: secondDigest,
    createdAt: "2026-08-28T02:00:00.000Z",
    expiresAt: "2026-08-28T02:00:10.000Z",
    grantTerms: [
      {
        grantId: "approval.session.install",
        permission: "install",
        expiresAt: "2026-08-28T02:00:20.000Z",
        maxUses: 1,
      },
    ],
  };
}

test("approval session challenge digest is deterministic and excludes itself", () => {
  const value = challenge();
  const first = contracts.computeApprovalSessionChallengeDigest(value);
  const second = contracts.computeApprovalSessionChallengeDigest({
    ...structuredClone(value),
    sessionDigest: secondDigest,
  });

  assert.equal(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(
    first,
    contracts.computeApprovalSessionChallengeDigest({
      ...value,
      hostId: "host.other",
    }),
  );
  assert.notEqual(
    first,
    contracts.computeApprovalSessionChallengeDigest({
      ...value,
      grantTerms: [
        {
          ...value.grantTerms[0],
          expiresAt: "2026-08-28T02:00:21.000Z",
        },
      ],
    }),
  );
});

test("approval session schemas are registered as foundation protocols", () => {
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["approval-session-challenge"],
    contracts.approvalSessionChallengeSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["approval-session-response"],
    contracts.approvalSessionResponseSchema,
  );
  assert.equal(contracts.approvalSessionChallengeSchema.version, "1.0.0");
  assert.equal(contracts.approvalSessionResponseSchema.version, "1.0.0");
});
