import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  "scripts/graybox_capture.gd",
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

async function preparedCapture(t, behavior = "capture-success") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-capture-"));
  const project = join(sandbox, "project");
  await cp(sourceProject, project, { recursive: true });
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  await mkdir(join(project, ".ai-game-playbook", "screenshots"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const scenario = JSON.parse(
    await readFile(join(project, "scenario.json"), "utf8"),
  );
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
  const plan = await godot.prepareGodotContainedRuntimeFrameCapture({
    runId:
      behavior === "capture-fail"
        ? "00000000-0000-4000-8000-00000000000f"
        : randomUUID().replace(/.$/u, "0"),
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
      godot.createGodotContainedRuntimeFrameCaptureAuthorizationRequest,
    maxChangedFiles: 1,
    maxChangedBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    maxOutputBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_OUTPUT_BYTES,
    maxDurationMs: contracts.GODOT_RUNTIME_FRAME_CAPTURE_COMMAND_TIMEOUT_MS,
    approvalPermissions: [
      "host-tool-inspection",
      "write-project-metadata",
    ],
    authorizationWindowMs: 20_000,
  });
  return { approval, plan, project, root, scenario };
}

async function loadCaptureCheckpoint(context) {
  return core.loadWorkflowCheckpoint({
    root: context.root,
    registry: registry.BUILTIN_REGISTRY,
    runId: context.plan.runId,
    project: {
      id: context.plan.project.id,
      identityDigest: context.plan.project.identityDigest,
      rootIdentityDigest: context.plan.project.identityDigest,
      stage: "vertical-slice",
    },
    inputDigest: contracts.digestCanonicalJson(context.plan.input),
  });
}

test("Godot runtime frame preparation never invokes accessors", async () => {
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
    godot.prepareGodotContainedRuntimeFrameCapture(hostile),
    expectGodotError("godot-capture-preparation-invalid"),
  );
  assert.equal(called, false);
});

test(
  "contained runtime frame capture promotes one receipt-backed artifact",
  { skip: !nativeAvailable, timeout: 180_000 },
  async (t) => {
    const context = await preparedCapture(t);
    const sourceBefore = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.equal(context.plan.commandId, "engine.runtime-frame-capture");
    assert.equal(
      context.plan.containment.profileDigest,
      contracts.GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE
        .profileDigest,
    );
    assert.equal(
      context.plan.scenario.digest,
      contracts.computePlaytestScenarioDigest(context.scenario),
    );
    assert.equal(
      context.approval.request.scope.paths.includes("fixture-behavior.txt"),
      false,
    );
    assert.deepEqual(context.approval.pending.missingPermissions, [
      "host-tool-inspection",
      "write-project-metadata",
    ]);
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedRuntimeFrameCapture(context.plan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedRuntimeFrameCapture(
        structuredClone(context.plan),
      ),
      expectGodotError("godot-capture-plan-untrusted"),
    );

    const frame = await godot.runGodotRuntimeFrameCapture({
      plan: context.plan,
      authorization: context.approval.decision,
      signal: null,
    });

    assert.equal(frame.origin, "standalone-player");
    assert.equal(frame.runId, context.plan.runId);
    assert.equal(frame.projectIdentityDigest, context.root.identityDigest);
    assert.equal(frame.engine, "godot");
    assert.equal(frame.engineVersion, "4.7.2");
    assert.deepEqual(frame.viewport, {
      width: 960,
      height: 540,
      scale: "1.000000",
    });
    assert.equal(context.approval.decision.lease.state, "settled");
    assert.equal(JSON.stringify(frame).includes(context.project), false);
    assert.equal(JSON.stringify(frame).includes(fixturePath), false);

    const loaded = await core.loadRunReceiptChain({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      runId: context.plan.runId,
      projectId: context.plan.project.id,
      projectIdentityDigest: context.root.identityDigest,
      workflowId: context.plan.workflow.id,
      resolvedPlanDigest: context.plan.workflow.resolvedPlanDigest,
      maxArtifactBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
    assert.equal(loaded.receipts.length, 1);
    const receipt = loaded.receipts[0];
    assert.equal(receipt.status, "succeeded");
    assert.equal(receipt.outcomes.outer.status, "passed");
    assert.equal(receipt.outcomes.inner.status, "passed");
    assert.equal(receipt.outcomes.inner.code, "godot-capture-passed");
    assert.equal(receipt.mutation.status, "committed");
    assert.deepEqual(receipt.effects.changedPaths, [
      context.plan.storage.sourcePath,
    ]);
    assert.equal(receipt.artifacts.length, 1);
    assert.equal(receipt.artifacts[0].kind, "runtime-frame-evidence");
    assert.equal(receipt.artifacts[0].digest, frame.artifactDigest);
    assert.equal(receipt.artifacts[0].bytes, frame.bytes);
    assert.equal(
      receipt.artifacts[0].sourcePath,
      context.plan.storage.sourcePath,
    );
    assert.match(receipt.artifacts[0].manifestDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(
      receipt.artifacts[0].path,
      /^\.ai-game-playbook\/evidence\/artifacts\/objects\//u,
    );
    const source = await readFile(
      join(context.project, ...receipt.artifacts[0].sourcePath.split("/")),
    );
    const object = await readFile(
      join(context.project, ...receipt.artifacts[0].path.split("/")),
    );
    assert.equal(contracts.sha256Digest(source), frame.artifactDigest);
    assert.deepEqual(object, source);
    await core.verifyRunReceiptArtifacts({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      receipts: loaded.receipts,
      maxArtifactBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
    const checkpoint = await loadCaptureCheckpoint(context);
    assert.equal(checkpoint.checkpoint.status, "succeeded");
    assert.deepEqual(checkpoint.checkpoint.evidenceKinds, [
      "run-receipt",
      "runtime-frame-evidence",
    ]);
    const sourceAfter = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.deepEqual(sourceAfter, sourceBefore);
    await assert.rejects(
      godot.runGodotRuntimeFrameCapture({
        plan: context.plan,
        authorization: context.approval.decision,
        signal: null,
      }),
      expectGodotError("godot-capture-authorization-invalid"),
    );
  },
);

test(
  "contained runtime frame failure retains a failed receipt without an artifact",
  { skip: !nativeAvailable, timeout: 180_000 },
  async (t) => {
    const context = await preparedCapture(t, "capture-fail");
    await assert.rejects(
      godot.runGodotRuntimeFrameCapture({
        plan: context.plan,
        authorization: context.approval.decision,
        signal: null,
      }),
      expectGodotError("godot-capture-execution-failed"),
    );
    assert.equal(context.approval.decision.lease.state, "settled");
    const loaded = await core.loadRunReceiptChain({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      runId: context.plan.runId,
      projectId: context.plan.project.id,
      projectIdentityDigest: context.root.identityDigest,
      workflowId: context.plan.workflow.id,
      resolvedPlanDigest: context.plan.workflow.resolvedPlanDigest,
      maxArtifactBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
    assert.equal(loaded.receipts.length, 1);
    assert.equal(loaded.receipts[0].status, "failed");
    assert.equal(loaded.receipts[0].outcomes.inner.status, "failed");
    assert.equal(
      loaded.receipts[0].outcomes.inner.code,
      "godot-capture-image-unavailable",
    );
    assert.deepEqual(loaded.receipts[0].artifacts, []);
    assert.deepEqual(loaded.receipts[0].effects.changedPaths, []);
    const checkpoint = await loadCaptureCheckpoint(context);
    assert.equal(checkpoint.checkpoint.status, "blocked");
    assert.deepEqual(checkpoint.checkpoint.evidenceKinds, []);
  },
);

test(
  "runtime frame capture refuses an occupied source path before engine execution",
  { skip: !nativeAvailable, timeout: 180_000 },
  async (t) => {
    const context = await preparedCapture(t);
    const source = join(
      context.project,
      ...context.plan.storage.sourcePath.split("/"),
    );
    const sentinel = Buffer.from("occupied-before-capture", "utf8");
    await writeFile(source, sentinel, { flag: "wx" });

    await assert.rejects(
      godot.runGodotRuntimeFrameCapture({
        plan: context.plan,
        authorization: context.approval.decision,
        signal: null,
      }),
      expectGodotError("godot-capture-storage-not-ready"),
    );

    assert.equal(context.approval.decision.lease.state, "settled");
    assert.deepEqual(await readFile(source), sentinel);
    await assert.rejects(
      core.loadRunReceiptChain({
        root: context.root,
        registry: registry.BUILTIN_REGISTRY,
        runId: context.plan.runId,
        projectId: context.plan.project.id,
        projectIdentityDigest: context.root.identityDigest,
        workflowId: context.plan.workflow.id,
        resolvedPlanDigest: context.plan.workflow.resolvedPlanDigest,
        maxArtifactBytes:
          contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
      }),
    );
  },
);

test(
  "runtime frame capture settles approval when initial checkpoint persistence conflicts",
  { skip: !nativeAvailable, timeout: 180_000 },
  async (t) => {
    const context = await preparedCapture(t);
    const inputDigest = contracts.digestCanonicalJson(context.plan.input);
    const conflicting = core.createWorkflowCheckpoint({
      registry: registry.BUILTIN_REGISTRY,
      workflowId: context.plan.workflow.id,
      project: {
        id: context.plan.project.id,
        identityDigest: context.plan.project.identityDigest,
        rootIdentityDigest: context.plan.project.identityDigest,
        stage: "vertical-slice",
      },
      runId: context.plan.runId,
      inputDigest,
      ttlMs: 60_000,
      now: () => Date.now() - 1_000,
    });
    await core.persistWorkflowCheckpoint({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      checkpoint: conflicting,
    });

    await assert.rejects(
      godot.runGodotRuntimeFrameCapture({
        plan: context.plan,
        authorization: context.approval.decision,
        signal: null,
      }),
    );

    assert.equal(context.approval.decision.lease.state, "settled");
    assert.equal((await core.inspectProjectLane({ root: context.root })).status, "free");
    assert.equal(
      existsSync(
        join(
          context.project,
          ...context.plan.storage.sourcePath.split("/"),
        ),
      ),
      false,
    );
    const checkpoint = await loadCaptureCheckpoint(context);
    assert.equal(checkpoint.checkpoint.status, "prepared");
    assert.equal(checkpoint.chainLength, 1);
  },
);
