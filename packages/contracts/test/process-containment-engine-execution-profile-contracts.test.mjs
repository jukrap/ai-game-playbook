import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

function digestInput(profile) {
  const { contractDigest: _contractDigest, ...input } = structuredClone(profile);
  return input;
}

function rawContractDigest(profile) {
  return contracts.digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-execution-profile",
    version: "1.0.0",
    profile: digestInput(profile),
  });
}

test("engine execution profile catalog fixes both Godot launch tuples", () => {
  assert.deepEqual(
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
      ({ profileId }) => profileId,
    ),
    ["godot-deterministic-replay-v1", "godot-headless-preflight-v1"],
  );

  const preflight = contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE;
  assert.equal(
    preflight.profileDigest,
    "sha256:e378585ddf388513ec5ae6e03a1a99645f16fe8909aa86dfddba5cca645c92f7",
  );
  assert.equal(
    preflight.profileDigest,
    contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  );
  assert.equal(
    preflight.invocationDigest,
    contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  );
  assert.deepEqual(preflight.launch.arguments, [
    "--headless",
    "--path",
    "$stagedProject",
    "--quit-after",
    "1",
    "--log-file",
    "$profileLocalLog",
    "--no-header",
  ]);
  assert.equal(
    preflight.limits.processTimeoutMs,
    contracts.PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
  );
  assert.equal(
    preflight.limits.maxOutputBytes,
    contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
  );

  const replay = contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE;
  assert.equal(replay.operationId, "engine.deterministic-replay");
  assert.equal(
    replay.invocationDigest,
    contracts.GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  );
  assert.deepEqual(replay.launch.arguments, [
    "--headless",
    "--path",
    "$stagedProject",
    "--log-file",
    "$profileLocalLog",
    "--no-header",
    "--",
    "--agpb-replay",
  ]);
  assert.equal(
    replay.limits.processTimeoutMs,
    contracts.GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS,
  );
  assert.equal(
    replay.limits.idleTimeoutMs,
    contracts.GODOT_DETERMINISTIC_REPLAY_IDLE_TIMEOUT_MS,
  );
  assert.equal(
    replay.limits.maxOutputBytes,
    contracts.GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  );
  assert.deepEqual(replay.output, {
    kind: "prefixed-json-lines",
    prefix: contracts.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
    maxLineBytes: contracts.GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
    maxEvents: contracts.GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
    retainRawOutput: false,
  });
});

test("execution profiles are immutable, schema-backed, and canonically resolved", () => {
  for (const profile of contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES) {
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.launch), true);
    assert.equal(Object.isFrozen(profile.launch.arguments), true);
    assert.equal(Object.isFrozen(profile.limits), true);
    assert.equal(Object.isFrozen(profile.output), true);
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(
        structuredClone(profile),
      ),
    );
    assert.equal(
      contracts.getProcessContainmentEngineExecutionProfile(profile.profileId),
      profile,
    );
    assert.equal(
      contracts.computeProcessContainmentEngineExecutionProfileContractDigest(
        digestInput(profile),
      ),
      profile.contractDigest,
    );
  }

  assert.equal(
    contracts.processContainmentEngineExecutionProfileSchema.id,
    "process-containment-engine-execution-profile",
  );
  assert.match(
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.equal(
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    "sha256:3465d6ed6df65a2185d41a53ade8c75dd735694d19568c3c755da0dcd6948b36",
  );
  assert.equal(
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_DIGEST,
    "sha256:87bc6b4e9638a68789e3bf50b76cdcaf48d9444b1c0bee517aecfd273116a01f",
  );
  assert.throws(
    () =>
      contracts.getProcessContainmentEngineExecutionProfile(
        "godot-caller-selected-v1",
      ),
    TypeError,
  );
});

test("profile semantics reject tuple substitution even with a recomputed digest", () => {
  const replay = structuredClone(
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  );
  replay.launch.arguments[7] = "--caller-selected";
  replay.contractDigest = rawContractDigest(replay);
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(replay),
    TypeError,
  );

  const largerBudget = structuredClone(
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  );
  largerBudget.limits.maxOutputBytes += 1;
  largerBudget.contractDigest = rawContractDigest(largerBudget);
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(
        largerBudget,
      ),
    TypeError,
  );

  const exposedOutput = structuredClone(
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  );
  exposedOutput.output.retainRawOutput = true;
  assert.throws(
    () =>
      contracts.computeProcessContainmentEngineExecutionProfileContractDigest(
        digestInput(exposedOutput),
      ),
    TypeError,
  );

  const accessor = structuredClone(
    contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
  );
  Object.defineProperty(accessor, "engine", {
    enumerable: true,
    get() {
      return "godot";
    },
  });
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(accessor),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(
        new Proxy(
          contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
          {},
        ),
      ),
    TypeError,
  );

  const oversizedField = structuredClone(
    contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
  );
  oversizedField["x".repeat(2_048)] = true;
  assert.throws(
    () =>
      contracts.assertProcessContainmentEngineExecutionProfileSemantics(
        oversizedField,
      ),
    (error) =>
      error instanceof TypeError && error.message.length < 200,
  );
});

test("contract digest binds every execution budget independently of legacy profile identity", () => {
  const replay = contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE;
  const changed = digestInput(replay);
  changed.limits.idleTimeoutMs += 1;
  assert.notEqual(
    rawContractDigest({ ...changed, contractDigest: replay.contractDigest }),
    replay.contractDigest,
  );
  assert.throws(
    () =>
      contracts.computeProcessContainmentEngineExecutionProfileContractDigest(
        changed,
      ),
    TypeError,
  );
  assert.equal(
    changed.profileDigest,
    replay.profileDigest,
    "the full execution contract must add stronger binding than profile identity",
  );
});
