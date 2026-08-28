import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
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
  async () => {
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const projectRootIdentityDigest = contracts.digestCanonicalJson({
      project: "contained-launch-fixture",
    });
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
  },
);
