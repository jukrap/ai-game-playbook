import type { PermissionClass } from "./contract-vocabulary.js";
import { PERMISSION_CLASSES } from "./contract-vocabulary.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";

export type ApprovalSessionDecision =
  | "approved"
  | "denied"
  | "cancelled";

export interface ApprovalSessionGrantTerm {
  readonly grantId: StableId;
  readonly permission: PermissionClass;
  readonly expiresAt: string;
  readonly maxUses: number;
}

export interface ApprovalSessionChallenge {
  readonly schemaVersion: SemanticVersion;
  readonly sessionId: string;
  readonly hostId: StableId;
  readonly promptDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly grantTerms: readonly ApprovalSessionGrantTerm[];
  readonly sessionDigest: Sha256Digest;
}

export type ApprovalSessionChallengeDigestInput = Omit<
  ApprovalSessionChallenge,
  "sessionDigest"
> &
  Partial<Pick<ApprovalSessionChallenge, "sessionDigest">>;

export interface ApprovalSessionResponse {
  readonly schemaVersion: SemanticVersion;
  readonly sessionId: string;
  readonly sessionDigest: Sha256Digest;
  readonly promptDigest: Sha256Digest;
  readonly decision: ApprovalSessionDecision;
}

export function computeApprovalSessionChallengeDigest(
  challenge: ApprovalSessionChallengeDigestInput,
): Sha256Digest {
  const { sessionDigest: _sessionDigest, ...subject } = challenge;
  return digestCanonicalJson({
    domain: "ai-game-playbook.approval-session-challenge",
    version: "1",
    subject,
  });
}

const grantTerm = {
  oneOf: PERMISSION_CLASSES.map((permission) =>
    closedObject(
      {
        grantId: reference("stableId"),
        permission: { const: permission },
        expiresAt: reference("timestamp"),
        maxUses:
          permission === "editor-control"
            ? { type: "integer", minimum: 1, maximum: 10_000 }
            : { const: 1 },
      },
      ["grantId", "permission", "expiresAt", "maxUses"],
    ),
  ),
};

const grantTermUniquenessConstraints = PERMISSION_CLASSES.map(
  (permission) => ({
    type: "object",
    properties: {
      grantTerms: {
        type: "array",
        contains: {
          type: "object",
          properties: { permission: { const: permission } },
          required: ["permission"],
        },
        minContains: 0,
        maxContains: 1,
      },
    },
    required: ["grantTerms"],
  }),
);

export const approvalSessionChallengeSchema: VersionedContractSchema =
  defineContractSchema({
    id: "approval-session-challenge",
    version: "1.0.0",
    title: "Approval Session Challenge",
    description:
      "Binds one host presentation window to exact approval prompt and grant-use terms without carrying execution or signing authority.",
    schema: {
      ...contractRoot(
        {
          schemaVersion: reference("semanticVersion"),
          sessionId: reference("uuid"),
          hostId: reference("stableId"),
          promptDigest: reference("sha256Digest"),
          requestDigest: reference("sha256Digest"),
          createdAt: reference("timestamp"),
          expiresAt: reference("timestamp"),
          grantTerms: boundedArray(grantTerm, {
            minimum: 1,
            maximum: PERMISSION_CLASSES.length,
            unique: true,
          }),
          sessionDigest: reference("sha256Digest"),
        },
        [
          "schemaVersion",
          "sessionId",
          "hostId",
          "promptDigest",
          "requestDigest",
          "createdAt",
          "expiresAt",
          "grantTerms",
          "sessionDigest",
        ],
      ),
      allOf: grantTermUniquenessConstraints,
    },
  });

export const approvalSessionResponseSchema: VersionedContractSchema =
  defineContractSchema({
    id: "approval-session-response",
    version: "1.0.0",
    title: "Approval Session Response",
    description:
      "Returns one bounded host decision for an exact approval session without carrying grants, signatures, or command input.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        sessionId: reference("uuid"),
        sessionDigest: reference("sha256Digest"),
        promptDigest: reference("sha256Digest"),
        decision: enumSchema(["approved", "denied", "cancelled"]),
      },
      [
        "schemaVersion",
        "sessionId",
        "sessionDigest",
        "promptDigest",
        "decision",
      ],
    ),
  });
