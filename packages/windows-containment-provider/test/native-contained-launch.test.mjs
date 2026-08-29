import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as engineCommon from "@ai-game-playbook/engine-common";
import * as provider from "../dist/index.js";

const artifactPath = fileURLToPath(
  new URL(
    "../dist/native/win-x64/agpb-windows-containment.exe",
    import.meta.url,
  ),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(artifactPath);

function expectProviderError(code) {
  return (error) =>
    error?.name === "WindowsContainmentProviderError" &&
    error?.code === code;
}

test(
  "fresh self-test authority admits one bounded synthetic contained launch",
  { skip: !nativeAvailable, timeout: 60_000 },
  async (t) => {
    const sandbox = await mkdtemp(join(tmpdir(), "agpb-engine-admission-"));
    const project = join(sandbox, "project");
    await mkdir(join(project, "scenes"), { recursive: true });
    await writeFile(join(project, "project.godot"), "config_version=5\n");
    await writeFile(
      join(project, "scenes", "main.tscn"),
      "[gd_scene format=3]\n",
    );
    t.after(() => rm(sandbox, { recursive: true, force: true }));
    const root = await core.canonicalizeProjectRoot(project);
    const executable = await core.bindProcessExecutable({
      path: process.execPath,
      maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
      allowedEnvironmentKeys: [],
    });
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const projectRootIdentityDigest = root.identityDigest;
    const selfTestPlan = provider.prepareWindowsContainmentSelfTest({
      runtime,
      projectRootIdentityDigest,
    });
    const selfTestReport = await provider.runWindowsContainmentSelfTest({
      prepared: selfTestPlan,
    });
    const selfTestWitness = provider.consumeWindowsContainmentSelfTestReport({
      runtime,
      report: selfTestReport,
      projectRootIdentityDigest,
    });

    const prepared =
      await provider.prepareWindowsContainedSyntheticLaunch({
        runtime,
        selfTestWitness,
        projectRootIdentityDigest,
      });
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentLaunchRequestSemantics(
        prepared.request,
      ),
    );
    assert.equal(
      prepared.requestDigest,
      contracts.computeProcessContainmentLaunchRequestDigest(
        prepared.request,
      ),
    );
    assert.equal(
      prepared.request.projectSnapshot.projectRootIdentityDigest,
      projectRootIdentityDigest,
    );
    assert.equal(
      prepared.request.executableSnapshot.artifactDigest,
      runtime.descriptor.implementation.entryArtifactDigest,
    );
    assert.equal(Object.isFrozen(prepared), true);
    assert.equal(Object.isFrozen(prepared.request), true);

    await assert.rejects(
      provider.runWindowsContainedSyntheticLaunch({
        prepared: structuredClone(prepared),
      }),
      expectProviderError("invalid-launch-request"),
    );
    await assert.rejects(
      provider.prepareWindowsContainedSyntheticLaunch({
        runtime,
        selfTestWitness,
        projectRootIdentityDigest,
      }),
      expectProviderError("self-test-witness-consumed"),
    );

    const report = await provider.runWindowsContainedSyntheticLaunch({
      prepared,
    });
    assert.equal(report.outcome, "succeeded");
    assert.equal(report.mutationUncertain, false);
    assert.deepEqual(report.process, {
      started: true,
      exitCode: 0,
      totalProcesses: 1,
      activeProcesses: 0,
    });
    assert.deepEqual(report.termination, {
      requested: false,
      confirmed: true,
    });
    assert.deepEqual(report.effects, {
      projectSnapshotPreserved: true,
      executableSnapshotPreserved: true,
      projectMutationPerformed: false,
      networkConnectionEstablished: false,
      childProcessStarted: false,
      cleanup: "complete",
    });
    assert.equal(
      report.output.observedDigest,
      prepared.request.expectedOutputDigest,
    );
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentLaunchReportSemantics(report),
    );
    assert.equal(JSON.stringify(report).includes("\\"), false);

    const witness = provider.consumeWindowsContainedSyntheticLaunchReport({
      runtime,
      report,
      projectRootIdentityDigest,
    });
    assert.doesNotThrow(() =>
      provider.assertWindowsContainedSyntheticLaunchWitness(witness),
    );
    assert.throws(
      () =>
        provider.assertWindowsContainedSyntheticLaunchWitness(
          structuredClone(witness),
        ),
      expectProviderError("launch-witness-invalid"),
    );
    assert.throws(
      () =>
        provider.consumeWindowsContainedSyntheticLaunchReport({
          runtime,
          report,
          projectRootIdentityDigest,
        }),
      expectProviderError("launch-witness-consumed"),
    );
    await assert.rejects(
      provider.runWindowsContainedSyntheticLaunch({ prepared }),
      expectProviderError("launch-consumed"),
    );

    const binding = await engineCommon.captureEngineExecutionSnapshots({
      root,
      executable,
      engine: "godot",
      projectInspectionDigest: contracts.digestCanonicalJson({
        engine: "godot",
        project: "inspected",
      }),
    });
    const admission =
      await provider.createWindowsContainedEngineAdmission({
        runtime,
        launchWitness: witness,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      });
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentEngineAdmissionSemantics(admission),
    );
    assert.equal(admission.engine, "godot");
    assert.equal(admission.snapshotBindingDigest, binding.bindingDigest);
    assert.equal(admission.projectRootIdentityDigest, root.identityDigest);
    assert.equal(JSON.stringify(admission).includes(project), false);
    await assert.doesNotReject(
      provider.assertWindowsContainedEngineAdmission({
        admission,
        runtime,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      }),
    );
    await assert.rejects(
      provider.assertWindowsContainedEngineAdmission({
        admission: structuredClone(admission),
        runtime,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      }),
      expectProviderError("engine-admission-invalid"),
    );
    await assert.rejects(
      provider.createWindowsContainedEngineAdmission({
        runtime,
        launchWitness: witness,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      }),
      expectProviderError("launch-witness-consumed"),
    );
    await assert.doesNotReject(
      provider.claimWindowsContainedEngineAdmissionForDispatch({
        admission,
        runtime,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      }),
    );
    await assert.rejects(
      provider.claimWindowsContainedEngineAdmissionForDispatch({
        admission,
        runtime,
        binding,
        root,
        executable,
        operationId: "engine.headless-preflight",
        invocationDigest:
          contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      }),
      expectProviderError("engine-admission-consumed"),
    );
  },
);
