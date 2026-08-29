import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as engineCommon from "@ai-game-playbook/engine-common";
import * as godot from "../../godot-adapter/dist/index.js";
import * as provider from "../dist/index.js";

const scenarioUrl = new URL(
  "../../../golden/graybox/scenario.json",
  import.meta.url,
);

const providerPath = fileURLToPath(
  new URL(
    "../dist/native/win-x64/agpb-windows-containment.exe",
    import.meta.url,
  ),
);
const fixturePath = fileURLToPath(
  new URL(
    "../dist/test-native/win-x64/agpb-godot-fixture.exe",
    import.meta.url,
  ),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(providerPath) &&
  existsSync(fixturePath);

function expectProviderError(code) {
  return (error) =>
    error?.name === "WindowsContainmentProviderError" &&
    error?.code === code;
}

async function launchWitness(runtime, rootIdentityDigest) {
  const selfTestPlan = provider.prepareWindowsContainmentSelfTest({
    runtime,
    projectRootIdentityDigest: rootIdentityDigest,
  });
  const selfTestReport = await provider.runWindowsContainmentSelfTest({
    prepared: selfTestPlan,
  });
  const selfTestWitness = provider.consumeWindowsContainmentSelfTestReport({
    runtime,
    report: selfTestReport,
    projectRootIdentityDigest: rootIdentityDigest,
  });
  const launchPlan = await provider.prepareWindowsContainedSyntheticLaunch({
    runtime,
    selfTestWitness,
    projectRootIdentityDigest: rootIdentityDigest,
  });
  const launchReport = await provider.runWindowsContainedSyntheticLaunch({
    prepared: launchPlan,
  });
  return provider.consumeWindowsContainedSyntheticLaunchReport({
    runtime,
    report: launchReport,
    projectRootIdentityDigest: rootIdentityDigest,
  });
}

async function prepareRun(context, behavior) {
  await writeFile(context.behaviorPath, `${behavior}\n`);
  const witness = await launchWitness(context.runtime, context.root.identityDigest);
  const binding = await engineCommon.captureEngineExecutionSnapshots({
    root: context.root,
    executable: context.executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      engine: "godot",
      behavior,
    }),
  });
  const admission = await provider.createWindowsContainedEngineAdmission({
    runtime: context.runtime,
    launchWitness: witness,
    binding,
    root: context.root,
    executable: context.executable,
    operationId: "engine.headless-preflight",
    invocationDigest: contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  });
  return await provider.prepareWindowsContainedGodotEngineRun({
    runtime: context.runtime,
    admission,
    binding,
    root: context.root,
    executable: context.executable,
    runId: randomUUID(),
  });
}

function replayLine(event) {
  return `${godot.GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX}${JSON.stringify(event)}\n`;
}

function replayState(oracle) {
  return oracle.stateHashFields.map((path, index) => ({ path, value: index }));
}

function passedReplay(value) {
  const scenarioDigest = contracts.computePlaytestScenarioDigest(value);
  const oracles = [...value.checkpoints, ...value.terminal];
  const events = [
    {
      event: "replay-started",
      scenarioId: value.scenarioId,
      scenarioDigest,
      seed: value.initialState.seed,
    },
    ...oracles.map((oracle) => {
      const state = replayState(oracle);
      return {
        event: "oracle-passed",
        oracleId: oracle.oracleId,
        terminal: value.terminal.includes(oracle),
        tick: oracle.atTick ?? oracle.withinTicks.firstTick,
        state,
        stateHash: contracts.computeGodotDeterministicReplayStateHash(state),
      };
    }),
  ];
  events.push({
    event: "replay-passed",
    tick: events.at(-1).tick,
    scenarioDigest,
  });
  return events.map(replayLine).join("");
}

function failedReplay(value) {
  const scenarioDigest = contracts.computePlaytestScenarioDigest(value);
  return [
    replayLine({
      event: "replay-started",
      scenarioId: value.scenarioId,
      scenarioDigest,
      seed: value.initialState.seed,
    }),
    replayLine({
      event: "replay-failed",
      code: "oracle-failed",
      tick: value.checkpoints[0].atTick,
      scenarioDigest,
      oracleId: value.checkpoints[0].oracleId,
    }),
  ].join("");
}

async function prepareReplay(context, behavior, transcript, expectationDigest) {
  await writeFile(context.behaviorPath, `${behavior}\n`);
  await writeFile(context.replayPath, transcript);
  const witness = await launchWitness(context.runtime, context.root.identityDigest);
  const binding = await engineCommon.captureEngineExecutionSnapshots({
    root: context.root,
    executable: context.executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      engine: "godot",
      behavior,
      transcriptDigest: contracts.sha256Digest(transcript),
    }),
  });
  const admission = await provider.createWindowsContainedEngineAdmission({
    runtime: context.runtime,
    launchWitness: witness,
    binding,
    root: context.root,
    executable: context.executable,
    operationId: "engine.deterministic-replay",
    invocationDigest: contracts.GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  });
  return await provider.prepareWindowsContainedGodotReplayRun({
    runtime: context.runtime,
    admission,
    binding,
    root: context.root,
    executable: context.executable,
    runId: randomUUID(),
    expectationDigest,
  });
}

test("engine run preparation rejects accessors without invoking them", async () => {
  let called = false;
  const hostile = {
    runtime: null,
    admission: null,
    binding: null,
    root: null,
    executable: null,
  };
  Object.defineProperty(hostile, "runId", {
    enumerable: true,
    get() {
      called = true;
      return randomUUID();
    },
  });
  await assert.rejects(
    provider.prepareWindowsContainedGodotEngineRun(hostile),
    expectProviderError("invalid-engine-run-request"),
  );
  assert.equal(called, false);
});

test("engine run preparation rejects proxies without invoking traps", async () => {
  let called = false;
  const hostile = new Proxy(
    {
      runtime: null,
      admission: null,
      binding: null,
      root: null,
      executable: null,
      runId: randomUUID(),
    },
    {
      getPrototypeOf() {
        called = true;
        return Object.prototype;
      },
    },
  );
  await assert.rejects(
    provider.prepareWindowsContainedGodotEngineRun(hostile),
    expectProviderError("invalid-engine-run-request"),
  );
  assert.equal(called, false);
});

test(
  "native Godot dispatcher settles success and bounded fault profiles without touching source",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const sandbox = await mkdtemp(join(tmpdir(), "agpb-native-engine-run-"));
    const project = join(sandbox, "project");
    await mkdir(project);
    const projectFile = join(project, "project.godot");
    const behaviorPath = join(project, "fixture-behavior.txt");
    await writeFile(projectFile, "config_version=5\n");
    await writeFile(behaviorPath, "success\n");
    t.after(() => rm(sandbox, { recursive: true, force: true }));
    const root = await core.canonicalizeProjectRoot(project);
    const executable = await core.bindProcessExecutable({
      path: fixturePath,
      maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
      allowedEnvironmentKeys: [],
    });
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const context = { behaviorPath, executable, root, runtime };
    const originalProject = await readFile(projectFile, "utf8");

    const expectations = [
      ["success", "succeeded"],
      ["fail", "failed"],
      ["mutate-staged", "failed"],
      ["overflow-log", "failed"],
      ["profile-overflow", "failed"],
      ["hang", "failed"],
      ["spawn-child", "succeeded"],
    ];
    for (const [behavior, expectedOutcome] of expectations) {
      const prepared = await prepareRun(context, behavior);
      assert.doesNotThrow(() =>
        contracts.assertProcessContainmentEngineRunRequestSemantics(
          prepared.request,
        ),
      );
      assert.equal(JSON.stringify(prepared).includes(project), false);
      assert.equal(JSON.stringify(prepared).includes(fixturePath), false);

      if (behavior === "success") {
        await assert.rejects(
          provider.runWindowsContainedGodotEngine({
            prepared: structuredClone(prepared),
            signal: null,
          }),
          expectProviderError("invalid-engine-run-request"),
        );
        await assert.rejects(
          provider.runWindowsContainedGodotReplay({
            prepared,
            signal: null,
          }),
          expectProviderError("invalid-engine-run-request"),
        );
      }
      const report = await provider.runWindowsContainedGodotEngine({
        prepared,
        signal: null,
      });
      assert.equal(report.outcome, expectedOutcome, behavior);
      assert.doesNotThrow(() =>
        contracts.assertProcessContainmentEngineRunReportSemantics(report),
      );
      assert.equal(report.effects.sourceProjectPreserved, true, behavior);
      assert.equal(report.effects.sourceExecutablePreserved, true, behavior);
      assert.equal(report.effects.networkConnectionEstablished, false, behavior);
      assert.equal(report.effects.cleanup, "complete", behavior);
      assert.equal(JSON.stringify(report).includes(project), false);
      assert.equal(JSON.stringify(report).includes(fixturePath), false);
      assert.equal(JSON.stringify(report).includes("fixture-success"), false);
      assert.equal(await readFile(projectFile, "utf8"), originalProject, behavior);

      if (behavior === "mutate-staged") {
        assert.equal(report.effects.stagedProjectBaselinePreserved, false);
      }
      if (behavior === "overflow-log") {
        assert.equal(report.output.truncated, true);
      }
      if (behavior === "profile-overflow") {
        assert.equal(report.effects.profileBudgetPreserved, false);
      }
      if (behavior === "hang") {
        assert.equal(report.termination.requested, true);
        assert.equal(report.termination.confirmed, true);
        assert.equal(report.termination.cause, "engine-timeout");
      }
      if (behavior === "spawn-child") {
        assert.equal(report.effects.childProcessStarted, false);
        assert.equal(report.process.totalProcesses, 1);
      }
      await assert.rejects(
        provider.runWindowsContainedGodotEngine({ prepared, signal: null }),
        expectProviderError("engine-run-consumed"),
      );
    }

    const preCancelledPlan = await prepareRun(context, "success");
    const preCancelledController = new AbortController();
    preCancelledController.abort();
    await assert.rejects(
      provider.runWindowsContainedGodotEngine({
        prepared: preCancelledPlan,
        signal: preCancelledController.signal,
      }),
      expectProviderError("engine-run-cancelled-before-start"),
    );
    await assert.rejects(
      provider.runWindowsContainedGodotEngine({
        prepared: preCancelledPlan,
        signal: null,
      }),
      expectProviderError("engine-run-consumed"),
    );

    const cancellationPlan = await prepareRun(context, "hang");
    const controller = new AbortController();
    const cancellationTimer = setTimeout(() => controller.abort(), 4_000);
    const cancelled = await provider.runWindowsContainedGodotEngine({
      prepared: cancellationPlan,
      signal: controller.signal,
    });
    clearTimeout(cancellationTimer);
    assert.equal(cancelled.outcome, "cancelled");
    assert.deepEqual(cancelled.termination, {
      requested: true,
      confirmed: true,
      cause: "caller-cancelled",
    });
    assert.equal(cancelled.effects.sourceProjectPreserved, true);
    assert.equal(cancelled.effects.sourceExecutablePreserved, true);
    assert.equal(cancelled.effects.cleanup, "complete");
    assert.equal(cancelled.mutationUncertain, false);
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentEngineRunReportSemantics(cancelled),
    );
  },
);

test(
  "native Godot replay transfers one bounded transcript and enforces output activity and limits",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const sandbox = await mkdtemp(join(tmpdir(), "agpb-native-replay-run-"));
    const project = join(sandbox, "project");
    await mkdir(project);
    const projectFile = join(project, "project.godot");
    const behaviorPath = join(project, "fixture-behavior.txt");
    const replayPath = join(project, "fixture-replay.txt");
    await writeFile(projectFile, "config_version=5\n");
    await writeFile(behaviorPath, "replay-success\n");
    await writeFile(replayPath, "AGPB_GRAYBOX {}\n");
    t.after(() => rm(sandbox, { recursive: true, force: true }));

    const root = await core.canonicalizeProjectRoot(project);
    const executable = await core.bindProcessExecutable({
      path: fixturePath,
      maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
      allowedEnvironmentKeys: [],
    });
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const context = { behaviorPath, executable, replayPath, root, runtime };
    const scenario = JSON.parse(await readFile(scenarioUrl, "utf8"));
    const originalProject = await readFile(projectFile, "utf8");

    const passed = passedReplay(scenario);
    const passedExpectation =
      godot.createGodotDeterministicReplayExpectation(scenario);
    const prepared = await prepareReplay(
      context,
      "replay-success",
      passed,
      passedExpectation.expectationDigest,
    );
    assert.equal(
      prepared.request.profile.id,
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId,
    );
    assert.equal(prepared.request.inputBindingDigest, passedExpectation.expectationDigest);
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentEngineRunRequestSemantics(
        prepared.request,
      ),
    );
    await assert.rejects(
      provider.runWindowsContainedGodotReplay({
        prepared: structuredClone(prepared),
        signal: null,
      }),
      expectProviderError("invalid-engine-run-request"),
    );
    await assert.rejects(
      provider.runWindowsContainedGodotEngine({
        prepared,
        signal: null,
      }),
      expectProviderError("invalid-engine-run-request"),
    );

    const execution = await provider.runWindowsContainedGodotReplay({
      prepared,
      signal: null,
    });
    assert.equal(execution.report.outcome, "succeeded");
    assert.equal(execution.transcript.status, "available");
    assert.equal(execution.transcript.digest, contracts.sha256Digest(passed));
    assert.equal(execution.transcript.bytes, Buffer.byteLength(passed));
    assert.equal(JSON.stringify(execution).includes(passed), false);
    assert.equal(JSON.stringify(execution).includes(project), false);
    assert.equal(JSON.stringify(execution).includes(fixturePath), false);
    assert.throws(
      () =>
        provider.consumeWindowsContainedGodotReplayTranscript(
          structuredClone(execution),
        ),
      expectProviderError("engine-run-output-invalid"),
    );
    const passedTranscript =
      provider.consumeWindowsContainedGodotReplayTranscript(execution);
    assert.equal(passedTranscript, passed);
    assert.equal(
      godot.parseGodotDeterministicReplayOutput(
        passedTranscript,
        passedExpectation,
      ).status,
      "parsed",
    );
    assert.throws(
      () => provider.consumeWindowsContainedGodotReplayTranscript(execution),
      expectProviderError("engine-run-output-invalid"),
    );

    const failed = failedReplay(scenario);
    const failedExpectation =
      godot.createGodotDeterministicReplayExpectation(scenario);
    const failedExecution = await provider.runWindowsContainedGodotReplay({
      prepared: await prepareReplay(
        context,
        "replay-fail",
        failed,
        failedExpectation.expectationDigest,
      ),
      signal: null,
    });
    assert.equal(failedExecution.report.outcome, "failed");
    assert.equal(failedExecution.report.process.exitCode, 2);
    assert.equal(failedExecution.transcript.status, "available");
    const failedTranscript =
      provider.consumeWindowsContainedGodotReplayTranscript(failedExecution);
    assert.equal(failedTranscript, failed);
    assert.equal(
      godot.parseGodotDeterministicReplayOutput(
        failedTranscript,
        failedExpectation,
      ).status,
      "parsed",
    );

    const driftExpectation =
      godot.createGodotDeterministicReplayExpectation(scenario);
    const driftExecution = await provider.runWindowsContainedGodotReplay({
      prepared: await prepareReplay(
        context,
        "replay-mutate-staged",
        passed,
        driftExpectation.expectationDigest,
      ),
      signal: null,
    });
    assert.equal(driftExecution.report.outcome, "failed");
    assert.equal(
      driftExecution.report.effects.stagedProjectBaselinePreserved,
      false,
    );
    assert.deepEqual(driftExecution.transcript, { status: "unavailable" });

    const activityExpectation =
      godot.createGodotDeterministicReplayExpectation(scenario);
    const activityExecution = await provider.runWindowsContainedGodotReplay({
      prepared: await prepareReplay(
        context,
        "replay-activity",
        passed,
        activityExpectation.expectationDigest,
      ),
      signal: null,
    });
    assert.equal(activityExecution.report.outcome, "succeeded");
    assert.equal(activityExecution.report.durationMs >= 16_000, true);
    assert.deepEqual(activityExecution.report.termination, {
      requested: false,
      confirmed: true,
      cause: "none",
    });
    assert.match(
      provider.consumeWindowsContainedGodotReplayTranscript(activityExecution),
      /heartbeat-2/u,
    );

    for (const behavior of [
      "replay-line-overflow",
      "replay-event-overflow",
    ]) {
      const overflowExpectation =
        godot.createGodotDeterministicReplayExpectation(scenario);
      const overflowExecution = await provider.runWindowsContainedGodotReplay({
        prepared: await prepareReplay(
          context,
          behavior,
          passed,
          overflowExpectation.expectationDigest,
        ),
        signal: null,
      });
      assert.equal(overflowExecution.report.outcome, "failed", behavior);
      assert.equal(overflowExecution.report.output.truncated, true, behavior);
      assert.deepEqual(
        overflowExecution.transcript,
        { status: "unavailable" },
        behavior,
      );
    }

    const idleExpectation =
      godot.createGodotDeterministicReplayExpectation(scenario);
    const idleExecution = await provider.runWindowsContainedGodotReplay({
      prepared: await prepareReplay(
        context,
        "replay-idle",
        passed,
        idleExpectation.expectationDigest,
      ),
      signal: null,
    });
    assert.equal(idleExecution.report.outcome, "failed");
    assert.deepEqual(idleExecution.report.termination, {
      requested: true,
      confirmed: true,
      cause: "idle-timeout",
    });
    assert.deepEqual(idleExecution.transcript, { status: "unavailable" });
    assert.equal(await readFile(projectFile, "utf8"), originalProject);
  },
);
