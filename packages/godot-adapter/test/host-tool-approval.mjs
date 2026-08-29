import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";

const keyId = "approval.host-tool-local";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

export function hostToolAuthorizationWindowMs(maxDurationMs) {
  return core.PERMISSION_REQUEST_MAX_APPROVAL_DELAY_MS + maxDurationMs;
}

export function authorizeHostTool({
  plan,
  createRequest,
  maxOutputBytes,
  maxDurationMs = 10_000,
  authorizationWindowMs = hostToolAuthorizationWindowMs(maxDurationMs),
}) {
  const now = Date.now();
  const deadlineAt = new Date(now + authorizationWindowMs).toISOString();
  const request = createRequest({ plan, deadlineAt });
  const broker = core.createPermissionBroker({
    registry: registry.BUILTIN_REGISTRY,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 0,
        maxChangedBytes: 0,
        maxDurationMs,
        maxOutputBytes,
        maxRepairCycles: 0,
      },
    },
    trustedApprovalKeys: [{ keyId, publicKeyPem }],
    now: () => Date.now(),
  });
  const pending = broker.authorize(request, []);
  assert.equal(pending.status, "approval-required");
  assert.deepEqual(pending.missingPermissions, ["host-tool-inspection"]);
  const subject = core.createApprovalGrantSubject(pending.challenge, {
    grantId: "approval.host-tool-inspection",
    permission: "host-tool-inspection",
    approvedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + authorizationWindowMs - 1_000).toISOString(),
    maxUses: 1,
  });
  const signature = sign(
    null,
    Buffer.from(contracts.computeApprovalGrantSigningDigest(subject), "utf8"),
    privateKey,
  ).toString("base64url");
  const decision = broker.authorize(request, [
    {
      ...subject,
      signature: {
        algorithm: "ed25519",
        keyId,
        value: signature,
      },
    },
  ]);
  assert.equal(decision.status, "authorized");
  return { decision, pending, request };
}
