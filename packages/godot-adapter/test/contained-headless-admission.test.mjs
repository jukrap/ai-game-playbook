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
import * as registry from "@ai-game-playbook/registry";
import * as provider from "@ai-game-playbook/windows-containment-provider";
import * as godot from "../dist/index.js";
import {
  authorizeHostTool,
  hostToolAuthorizationWindowMs,
} from "./host-tool-approval.mjs";

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

test("host tool approval window preserves admission delay before execution", () => {
  const executionDurationMs = 10_000;
  assert.equal(
    hostToolAuthorizationWindowMs(executionDurationMs),
    core.PERMISSION_REQUEST_MAX_APPROVAL_DELAY_MS + executionDurationMs,
  );
});

function expectGodotError(code) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === false;
}

async function versionProbe(t, executablePath = process.execPath) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-admission-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
  );
  await writeFile(join(project, "fixture-behavior.txt"), "success\n");
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const projectId = "sample.graybox";
  const discoveryPlan = await godot.prepareGodotExecutableDiscovery({
    runId: randomUUID(),
    projectId,
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
      sources: {
        configuredPaths: [executablePath],
        pathDirectories: [],
      },
    },
  });
  const discoveryAuthorization = authorizeHostTool({
    plan: discoveryPlan,
    createRequest: godot.createGodotExecutableDiscoveryAuthorizationRequest,
    maxOutputBytes: godot.GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
  });
  const discovery = await godot.runGodotExecutableDiscovery({
    plan: discoveryPlan,
    authorization: discoveryAuthorization.decision,
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
  const probeAuthorization = authorizeHostTool({
    plan: probePlan,
    createRequest: godot.createGodotVersionProbeAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
  });
  const report = await godot.runGodotVersionProbe({
    plan: probePlan,
    authorization: probeAuthorization.decision,
    signal: null,
  });
  return { project, projectId, report, root };
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

test("contained admission preparation never invokes accessors", async () => {
  let getterCalled = false;
  const hostile = {
    runId: randomUUID(),
    projectId: "sample.graybox",
    projectStage: "vertical-slice",
    containmentRuntime: null,
    launchWitness: null,
  };
  Object.defineProperty(hostile, "versionProbe", {
    enumerable: true,
    get() {
      getterCalled = true;
      return null;
    },
  });

  await assert.rejects(
    godot.prepareGodotContainedHeadlessAdmissionFromVersionProbe(hostile),
    expectGodotError("godot-contained-admission-preparation-invalid"),
  );
  assert.equal(getterCalled, false);
});

test(
  "Godot preparation remains blocked when the exact engine version is unverified",
  { skip: !nativeAvailable, timeout: 60_000 },
  async (t) => {
    const context = await versionProbe(t);
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const witness = await launchWitness(runtime, context.root.identityDigest);
    const plan =
      await godot.prepareGodotContainedHeadlessAdmissionFromVersionProbe({
        runId: randomUUID(),
        projectId: context.projectId,
        projectStage: "vertical-slice",
        versionProbe: context.report,
        containmentRuntime: runtime,
        launchWitness: witness,
      });

    assert.equal(plan.disposition, "blocked");
    assert.equal(plan.commandId, "engine.headless-preflight");
    assert.deepEqual(plan.blockers, [
      "godot-headless-version-unverified",
    ]);
    assert.deepEqual(plan.support, {
      grade: "planned",
      evidenceGrade: "locally-executed",
      reason: "The exact target Godot version was not verified.",
    });
    assert.deepEqual(plan.effects, {
      engineProcessStarted: false,
      projectMutationPerformed: false,
      networkAccessPerformed: false,
    });
    assert.equal(plan.containment.decision, "qualified");
    assert.equal(plan.containment.evidenceGrade, "locally-executed");
    assert.equal(
      JSON.stringify(plan).includes(
        JSON.stringify(context.project).slice(1, -1),
      ),
      false,
    );
    assert.equal("runGodotContainedHeadless" in godot, true);
    assert.throws(
      () =>
        godot.createGodotContainedHeadlessAuthorizationRequest({
          plan,
          deadlineAt: new Date(Date.now() + 1_000).toISOString(),
        }),
      expectGodotError("godot-contained-admission-plan-untrusted"),
    );
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedHeadlessAdmission(plan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedHeadlessAdmission(
        structuredClone(plan),
      ),
      expectGodotError("godot-contained-admission-plan-untrusted"),
    );
    await assert.rejects(
      godot.prepareGodotContainedHeadlessAdmissionFromVersionProbe({
        runId: randomUUID(),
        projectId: context.projectId,
        projectStage: "vertical-slice",
        versionProbe: context.report,
        containmentRuntime: runtime,
        launchWitness: witness,
      }),
      expectGodotError("godot-contained-admission-qualification-failed"),
    );
    await writeFile(join(context.project, "project.godot"), "changed\n");
    await assert.rejects(
      godot.assertPreparedGodotContainedHeadlessAdmission(plan),
      expectGodotError("godot-contained-admission-authority-invalid"),
    );
  },
);

async function readyContainedRun(t, behavior) {
  const context = await versionProbe(t, fixturePath);
  assert.equal(context.report.status, "matched");
  await writeFile(join(context.project, "fixture-behavior.txt"), `${behavior}\n`);
  const runtime = await provider.loadPackagedWindowsContainmentProviderRuntime();
  const witness = await launchWitness(runtime, context.root.identityDigest);
  const plan = await godot.prepareGodotContainedHeadlessAdmissionFromVersionProbe({
    runId: randomUUID(),
    projectId: context.projectId,
    projectStage: "vertical-slice",
    versionProbe: context.report,
    containmentRuntime: runtime,
    launchWitness: witness,
  });
  assert.equal(plan.disposition, "ready");
  const approval = authorizeHostTool({
    plan,
    createRequest: godot.createGodotContainedHeadlessAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    maxDurationMs: contracts.GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
    authorizationWindowMs: 20_000,
  });
  return { ...context, plan, approval };
}

test(
  "contained Godot startup retains a path-free successful receipt through the registered handler",
  { skip: !nativeAvailable, timeout: 120_000 },
  async (t) => {
    const context = await readyContainedRun(t, "success");
    const projectBefore = await readFile(
      join(context.project, "project.godot"),
      "utf8",
    );
    const behaviorBefore = await readFile(
      join(context.project, "fixture-behavior.txt"),
      "utf8",
    );

    assert.deepEqual(context.plan.blockers, []);
    assert.equal(context.plan.containment.decision, "qualified");
    assert.deepEqual(context.plan.input.containment, context.plan.containment);
    assert.equal(
      context.approval.request.scope.objectIds.includes(
        context.plan.containment.runRequestDigest,
      ),
      true,
    );

    const report = await godot.runGodotHeadlessPreflight({
      plan: context.plan,
      authorization: context.approval.decision,
      signal: null,
    });

    assert.equal(report.status, "succeeded");
    assert.equal(report.code, "godot-headless-preflight-passed");
    assert.equal(report.engineRun.outcome, "succeeded");
    assert.equal(report.execution.processStarted, true);
    assert.equal(report.externalProcessStarted, true);
    assert.equal(report.networkAccessPerformed, false);
    assert.equal(report.mutationPerformed, false);
    assert.deepEqual(report.isolation, {
      filesystem: "disposable-copy",
      network: "denied",
      childProcesses: "denied",
      writablePaths: [],
    });
    assert.deepEqual(report.support, {
      grade: "planned",
      evidenceGrade: "locally-executed",
      reason:
        "Contained startup evidence was retained, but engine support remains planned until validation uses an installed Godot release.",
    });
    assert.equal(context.approval.decision.lease.state, "settled");
    assert.doesNotThrow(() =>
      contracts.assertGodotHeadlessPreflightReportSemantics(report),
    );
    assert.equal(JSON.stringify(report).includes(context.project), false);
    assert.equal(JSON.stringify(report).includes(fixturePath), false);

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
    assert.equal(loaded.receipts[0].mutation.status, "none");
    assert.equal(
      loaded.receipts[0].authority.inputDigest,
      contracts.digestCanonicalJson(context.plan.input),
    );
    assert.equal(
      await readFile(join(context.project, "project.godot"), "utf8"),
      projectBefore,
    );
    assert.equal(
      await readFile(join(context.project, "fixture-behavior.txt"), "utf8"),
      behaviorBefore,
    );
    assert.throws(
      () =>
        godot.createGodotContainedHeadlessAuthorizationRequest({
          plan: context.plan,
          deadlineAt: new Date(Date.now() + 1_000).toISOString(),
        }),
      expectGodotError("godot-contained-authorization-invalid"),
    );
  },
);

test(
  "contained Godot process failure remains a failed receipt without source mutation",
  { skip: !nativeAvailable, timeout: 120_000 },
  async (t) => {
    const context = await readyContainedRun(t, "fail");
    const projectBefore = await readFile(
      join(context.project, "project.godot"),
      "utf8",
    );
    const report = await godot.runGodotContainedHeadless({
      plan: context.plan,
      authorization: context.approval.decision,
      signal: null,
    });

    assert.equal(report.status, "failed");
    assert.equal(report.code, "godot-headless-engine-process-failed");
    assert.equal(report.engineRun.outcome, "failed");
    assert.equal(report.engineRun.process.exitCode, 7);
    assert.equal(report.mutationPerformed, false);
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
    assert.equal(loaded.receipts[0].status, "failed");
    assert.equal(loaded.receipts[0].outcomes.outer.status, "failed");
    assert.equal(loaded.receipts[0].outcomes.outer.exitCode, 7);
    assert.equal(loaded.receipts[0].mutation.status, "none");
    assert.equal(
      await readFile(join(context.project, "project.godot"), "utf8"),
      projectBefore,
    );
  },
);

test(
  "in-flight cancellation waits for native cleanup and retains a cancelled receipt",
  { skip: !nativeAvailable, timeout: 120_000 },
  async (t) => {
    const context = await readyContainedRun(t, "hang");
    const projectBefore = await readFile(
      join(context.project, "project.godot"),
      "utf8",
    );
    const controller = new AbortController();
    const cancellationTimer = setTimeout(() => controller.abort(), 4_000);
    const report = await godot.runGodotContainedHeadless({
      plan: context.plan,
      authorization: context.approval.decision,
      signal: controller.signal,
    });
    clearTimeout(cancellationTimer);

    assert.equal(report.status, "cancelled");
    assert.equal(report.code, "godot-headless-engine-run-cancelled");
    assert.equal(report.engineRun.outcome, "cancelled");
    assert.equal(report.engineRun.termination.cause, "caller-cancelled");
    assert.equal(report.engineRun.termination.confirmed, true);
    assert.equal(
      report.engineRun.termination.requested,
      report.engineRun.process.started,
    );
    assert.equal(report.engineRun.effects.cleanup, "complete");
    assert.equal(report.authorization.status, "cancelled");
    assert.equal(report.authorization.mutationUncertain, false);
    assert.equal(context.approval.decision.lease.state, "settled");
    assert.doesNotThrow(() =>
      contracts.assertGodotHeadlessPreflightReportSemantics(report),
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
    assert.equal(loaded.receipts[0].status, "cancelled");
    assert.equal(loaded.receipts[0].outcomes.outer.status, "cancelled");
    assert.equal(loaded.receipts[0].outcomes.outer.timedOut, false);
    assert.equal(loaded.receipts[0].outcomes.inner.status, "cancelled");
    assert.equal(loaded.receipts[0].mutation.status, "none");
    assert.equal(
      await readFile(join(context.project, "project.godot"), "utf8"),
      projectBefore,
    );
  },
);
