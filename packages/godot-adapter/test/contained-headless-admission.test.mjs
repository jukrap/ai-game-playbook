import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as provider from "@ai-game-playbook/windows-containment-provider";
import * as godot from "../dist/index.js";
import { authorizeHostTool } from "./host-tool-approval.mjs";

const artifactPath = fileURLToPath(
  new URL(
    "../../windows-containment-provider/dist/native/win-x64/agpb-windows-containment.exe",
    import.meta.url,
  ),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(artifactPath);

function expectGodotError(code) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === false;
}

async function versionProbe(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-admission-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
  );
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
        configuredPaths: [process.execPath],
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
  "Godot preparation binds a fresh contained admission but exposes no dispatch",
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
      "godot-headless-contained-dispatch-unimplemented",
      "godot-headless-version-unverified",
    ]);
    assert.deepEqual(plan.support, {
      grade: "planned",
      evidenceGrade: "locally-executed",
      reason: "Contained Godot dispatch is not implemented.",
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
    assert.equal("runGodotContainedHeadless" in godot, false);
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
