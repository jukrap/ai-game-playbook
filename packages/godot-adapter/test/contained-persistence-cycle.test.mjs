import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";
import * as provider from "@ai-game-playbook/windows-containment-provider";
import * as godot from "../dist/index.js";
import { authorizeHostTool } from "./host-tool-approval.mjs";

const sourceProject = fileURLToPath(
  new URL("../../../golden/graybox/godot", import.meta.url),
);
const providerPath = fileURLToPath(
  new URL(
    "../../windows-containment-provider/dist/native/win-x64/agpb-windows-containment.exe",
    import.meta.url,
  ),
);
const fixturePath = fileURLToPath(
  new URL(
    "../../windows-containment-provider/dist/test-native/win-x64/agpb-godot-fixture.exe",
    import.meta.url,
  ),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(providerPath) &&
  existsSync(fixturePath);
const sourcePaths = [
  "addons/ai_game_playbook/validators/project_validation.gd",
  "manifest.json",
  "project.godot",
  "scenario.json",
  "scenes/main.tscn",
  "scripts/graybox_game.gd",
  "scripts/graybox_persistence.gd",
  "scripts/graybox_replay.gd",
];

function expectGodotError(code, mutationUncertain = false) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === mutationUncertain;
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

async function preparedPersistenceCycle(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-persistence-"));
  const project = join(sandbox, "project");
  await cp(sourceProject, project, { recursive: true });
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));

  const projectId = "golden.graybox.godot";
  const discoveryPlan = await godot.prepareGodotExecutableDiscovery({
    runId: randomUUID(),
    projectId,
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
      sources: {
        configuredPaths: [fixturePath],
        pathDirectories: [],
      },
    },
  });
  const discoveryApproval = authorizeHostTool({
    plan: discoveryPlan,
    createRequest: godot.createGodotExecutableDiscoveryAuthorizationRequest,
    maxOutputBytes: godot.GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
  });
  const discovery = await godot.runGodotExecutableDiscovery({
    plan: discoveryPlan,
    authorization: discoveryApproval.decision,
  });
  const probePlan = await godot.prepareGodotVersionProbeFromDiscovery({
    runId: randomUUID(),
    projectId,
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
    },
    discovery,
    candidateIdentityDigest: discovery.candidates[0].identityDigest,
  });
  const probeApproval = authorizeHostTool({
    plan: probePlan,
    createRequest: godot.createGodotVersionProbeAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
  });
  const versionProbe = await godot.runGodotVersionProbe({
    plan: probePlan,
    authorization: probeApproval.decision,
    signal: null,
  });
  assert.equal(versionProbe.status, "matched");

  const runtime = await provider.loadPackagedWindowsContainmentProviderRuntime();
  const witness = await launchWitness(runtime, root.identityDigest);
  const plan = await godot.prepareGodotContainedPersistenceCycle({
    runId: randomUUID(),
    projectId,
    projectStage: "vertical-slice",
    versionProbe,
    containmentRuntime: runtime,
    launchWitness: witness,
  });
  const approval = authorizeHostTool({
    plan,
    createRequest: godot.createGodotContainedPersistenceCycleAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_PERSISTENCE_CYCLE_MAX_OUTPUT_BYTES,
    maxDurationMs: contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_TIMEOUT_MS,
    authorizationWindowMs: 20_000,
  });
  return { approval, plan, project, root };
}

test("Godot persistence preparation never invokes accessors", async () => {
  let called = false;
  const hostile = {
    runId: randomUUID(),
    projectId: "golden.graybox.godot",
    projectStage: "vertical-slice",
    versionProbe: null,
    containmentRuntime: null,
  };
  Object.defineProperty(hostile, "launchWitness", {
    enumerable: true,
    get() {
      called = true;
      return null;
    },
  });
  await assert.rejects(
    godot.prepareGodotContainedPersistenceCycle(hostile),
    expectGodotError("godot-persistence-preparation-invalid"),
  );
  assert.equal(called, false);
});

test("Godot persistence command rejects unprepared public input", async () => {
  await assert.rejects(
    godot.runGodotPersistenceCycle({}),
    expectGodotError("godot-persistence-execution-invalid"),
  );
});

test(
  "contained Godot persistence retains one two-process result and private transcript",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await preparedPersistenceCycle(t);
    const sourceBefore = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );

    assert.equal(
      context.plan.commandId,
      contracts.GODOT_PERSISTENCE_CYCLE_COMMAND_ID,
    );
    assert.equal(
      context.plan.persistence.expectationDigest,
      context.plan.input.expectationDigest,
    );
    assert.equal(
      context.plan.containment.profileDigest,
      contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE.profileDigest,
    );
    assert.deepEqual(context.approval.request.scope.paths, sourcePaths);
    assert.equal(
      context.approval.request.scope.paths.includes("fixture-behavior.txt"),
      false,
    );
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedPersistenceCycle(context.plan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedPersistenceCycle(
        structuredClone(context.plan),
      ),
      expectGodotError("godot-persistence-plan-untrusted"),
    );

    const runRequest = {
      plan: context.plan,
      authorization: context.approval.decision,
      signal: null,
    };
    assert.equal(
      godot.isGodotContainedPersistenceCycleRunRequest(runRequest),
      true,
    );
    assert.equal(
      godot.isGodotContainedPersistenceCycleRunRequest(
        { ...runRequest, plan: structuredClone(context.plan) },
      ),
      false,
    );
    const report = await godot.runGodotPersistenceCycle(runRequest);

    assert.equal(report.status, "succeeded");
    assert.equal(report.code, "godot-persistence-cycle-passed");
    assert.equal(report.transcript.status, "validated");
    assert.equal(report.transcript.eventCount, 5);
    assert.equal(report.transcript.terminal, "persistence-cycle-passed");
    assert.equal(report.transcript.terminalCode, "passed");
    assert.match(report.transcript.saveDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(report.transcript.saveBytes > 0, true);
    assert.equal(report.transcript.bytes, report.engineRun.output.capturedBytes);
    assert.equal(report.engineRun.outcome, "succeeded");
    assert.equal(report.engineRun.process.exitCode, 0);
    assert.equal(report.engineRun.process.totalProcesses, 2);
    assert.equal(report.engineRun.process.activeProcesses, 0);
    assert.equal(report.engineRun.effects.sourceProjectPreserved, true);
    assert.equal(report.engineRun.effects.sourceExecutablePreserved, true);
    assert.equal(report.engineRun.effects.cleanup, "complete");
    assert.equal(report.support.grade, "planned");
    assert.equal(report.support.liveValidated, false);
    assert.equal(context.approval.decision.lease.state, "settled");
    await assert.rejects(
      godot.assertPreparedGodotContainedPersistenceCycle(context.plan),
      expectGodotError("godot-persistence-plan-drift"),
    );
    await assert.rejects(
      godot.runGodotPersistenceCycle(runRequest),
      expectGodotError("godot-persistence-authorization-invalid"),
    );
    assert.doesNotThrow(() =>
      contracts.assertGodotPersistenceCycleReportSemantics(report),
    );
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(context.project), false);
    assert.equal(serialized.includes(fixturePath), false);
    assert.equal(serialized.includes("user://"), false);
    assert.equal(serialized.includes("graybox-save.json"), false);

    const transcript =
      godot.consumeGodotContainedPersistenceCycleTranscript(report);
    assert.equal(transcript.transcriptDigest, report.transcript.transcriptDigest);
    assert.equal(transcript.wire.eventCount, 5);
    assert.equal(transcript.terminal.event, "persistence-cycle-passed");
    assert.equal(
      transcript.saveCompleted.saveDigest,
      transcript.loadCompleted.saveDigest,
    );
    assert.throws(
      () => godot.consumeGodotContainedPersistenceCycleTranscript(report),
      expectGodotError("godot-persistence-transcript-unavailable"),
    );
    assert.throws(
      () =>
        godot.consumeGodotContainedPersistenceCycleTranscript(
          structuredClone(report),
        ),
      expectGodotError("godot-persistence-transcript-unavailable"),
    );

    const loaded = await core.loadRunReceiptChain({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      runId: context.plan.runId,
      projectId: context.plan.project.id,
      projectIdentityDigest: context.root.identityDigest,
      workflowId: context.plan.workflow.id,
      resolvedPlanDigest: context.plan.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    });
    assert.equal(loaded.receipts.length, 1);
    assert.equal(loaded.receipts[0].status, "succeeded");
    assert.equal(loaded.receipts[0].outcomes.outer.status, "passed");
    assert.equal(loaded.receipts[0].outcomes.inner.status, "passed");
    assert.equal(
      loaded.receipts[0].outcomes.inner.code,
      "godot-persistence-cycle-passed",
    );
    assert.equal(
      loaded.receipts[0].authority.inputDigest,
      contracts.digestCanonicalJson(context.plan.input),
    );
    assert.deepEqual(loaded.receipts[0].effects.changedPaths, []);
    assert.deepEqual(loaded.receipts[0].artifacts, []);

    const sourceAfter = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.deepEqual(sourceAfter, sourceBefore);
  },
);
