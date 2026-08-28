import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("pack recovery command contracts are closed and registry-addressable", () => {
  assert.equal(contracts.PACK_RECOVERY_COMMAND_ID, "pack.recover");
  assert.equal(contracts.PACK_RECOVERY_WORKFLOW_ID, "workflow.pack-recover");
  assert.equal(contracts.PACK_RECOVERY_WORKFLOW_STEP_ID, "step.pack-recover");
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["pack-recovery-input"],
    contracts.packRecoveryCommandInputSchema,
  );
  assert.equal(
    contracts.FOUNDATION_PROTOCOL_SCHEMAS["pack-recovery-output"],
    contracts.packRecoveryCommandOutputSchema,
  );
  assert.equal(
    contracts.packRecoveryCommandInputSchema.schema.additionalProperties,
    false,
  );
  assert.equal(
    contracts.packRecoveryCommandOutputSchema.schema.additionalProperties,
    false,
  );
});

test("pack recovery input separates execution and transaction identities", () => {
  assert.deepEqual(
    contracts.packRecoveryCommandInputSchema.schema.required,
    [
      "schemaVersion",
      "recoveryRunId",
      "transactionRunId",
      "reportDigest",
      "journalSnapshotDigest",
      "action",
      "finalOutcome",
      "planDigest",
    ],
  );
  assert.deepEqual(
    contracts.packRecoveryCommandInputSchema.schema.properties.action.enum,
    [
      "append-reconciliation",
      "append-started-and-terminal",
      "append-terminal",
      "clear-marker",
    ],
  );
});

test("pack recovery output requires durable receipt identity", () => {
  assert.equal(
    contracts.packRecoveryCommandOutputSchema.schema.required.includes(
      "receiptDigest",
    ),
    true,
  );
  assert.deepEqual(
    contracts.packRecoveryCommandOutputSchema.schema.properties.status.enum,
    ["failed", "finalized", "recovery-required", "stale"],
  );
});
