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
  maxChangedFiles = 0,
  maxChangedBytes = 0,
  approvalPermissions = ["host-tool-inspection"],
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
        maxChangedFiles,
        maxChangedBytes,
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
  assert.deepEqual(pending.missingPermissions, approvalPermissions);
  const grants = approvalPermissions.map((permission) => {
    const subject = core.createApprovalGrantSubject(pending.challenge, {
      grantId: `approval.${permission}`,
      permission,
      approvedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + authorizationWindowMs - 1_000).toISOString(),
      maxUses: 1,
    });
    const signature = sign(
      null,
      Buffer.from(
        contracts.computeApprovalGrantSigningDigest(subject),
        "utf8",
      ),
      privateKey,
    ).toString("base64url");
    return {
      ...subject,
      signature: {
        algorithm: "ed25519",
        keyId,
        value: signature,
      },
    };
  });
  const decision = broker.authorize(request, grants);
  assert.equal(decision.status, "authorized");
  return { decision, pending, request };
}
