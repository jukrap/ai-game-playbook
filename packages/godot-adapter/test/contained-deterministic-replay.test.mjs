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
const artifactPath = fileURLToPath(
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
  existsSync(artifactPath) &&
  existsSync(fixturePath);
const sourcePaths = [
  "manifest.json",
  "project.godot",
  "scenario.json",
  "scenes/main.tscn",
  "scripts/graybox_game.gd",
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

async function preparedReplay(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-replay-"));
  const project = join(sandbox, "project");
  await cp(sourceProject, project, { recursive: true });
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const scenario = JSON.parse(await readFile(join(project, "scenario.json"), "utf8"));
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
  const plan = await godot.prepareGodotContainedDeterministicReplay({
    runId: randomUUID(),
    projectId,
    projectStage: "vertical-slice",
    versionProbe,
    scenario,
    containmentRuntime: runtime,
    launchWitness: witness,
  });
  const approval = authorizeHostTool({
    plan,
    createRequest:
      godot.createGodotContainedDeterministicReplayAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
    maxDurationMs:
      contracts.GODOT_DETERMINISTIC_REPLAY_COMMAND_TIMEOUT_MS,
    authorizationWindowMs: 20_000,
  });
  return { approval, plan, project, root, scenario };
}

test("Godot replay preparation never invokes accessors", async () => {
  let called = false;
  const hostile = {
    runId: randomUUID(),
    projectId: "golden.graybox.godot",
    projectStage: "vertical-slice",
    versionProbe: null,
    scenario: null,
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
    godot.prepareGodotContainedDeterministicReplay(hostile),
    expectGodotError("godot-replay-preparation-invalid"),
  );
  assert.equal(called, false);
});

test(
  "contained deterministic replay retains one canonical result and private transcript",
  { skip: !nativeAvailable, timeout: 120_000 },
  async (t) => {
    const context = await preparedReplay(t);
    const sourceBefore = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.equal(context.plan.commandId, "engine.deterministic-replay");
    assert.equal(
      context.plan.scenario.digest,
      contracts.computePlaytestScenarioDigest(context.scenario),
    );
    assert.equal(
      context.plan.containment.profileDigest,
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE
        .profileDigest,
    );
    assert.equal(
      context.approval.request.scope.paths.includes("fixture-behavior.txt"),
      false,
    );
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedDeterministicReplay(context.plan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedDeterministicReplay(
        structuredClone(context.plan),
      ),
      expectGodotError("godot-replay-plan-untrusted"),
    );

    const report = await godot.runGodotDeterministicReplay({
      plan: context.plan,
      authorization: context.approval.decision,
      signal: null,
    });

    assert.equal(report.status, "succeeded");
    assert.equal(report.code, "godot-replay-passed");
    assert.equal(report.transcript.status, "validated");
    assert.equal(report.transcript.terminal, "replay-passed");
    assert.equal(report.engineRun.outcome, "succeeded");
    assert.equal(report.engineRun.process.exitCode, 0);
    assert.equal(report.support.grade, "planned");
    assert.equal(report.support.liveValidated, false);
    assert.equal(context.approval.decision.lease.state, "settled");
    assert.doesNotThrow(() =>
      contracts.assertGodotDeterministicReplayReportSemantics(report),
    );
    assert.equal(JSON.stringify(report).includes(context.project), false);
    assert.equal(JSON.stringify(report).includes(fixturePath), false);

    const transcript =
      godot.consumeGodotContainedDeterministicReplayTranscript(report);
    assert.equal(transcript.transcriptDigest, report.transcript.transcriptDigest);
    assert.equal(transcript.terminal.event, "replay-passed");
    assert.throws(
      () => godot.consumeGodotContainedDeterministicReplayTranscript(report),
      expectGodotError("godot-replay-transcript-unavailable"),
    );
    assert.throws(
      () =>
        godot.consumeGodotContainedDeterministicReplayTranscript(
          structuredClone(report),
        ),
      expectGodotError("godot-replay-transcript-unavailable"),
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
      "godot-replay-passed",
    );
    assert.equal(
      loaded.receipts[0].authority.inputDigest,
      contracts.digestCanonicalJson(context.plan.input),
    );
    const sourceAfter = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.deepEqual(sourceAfter, sourceBefore);
  },
);
