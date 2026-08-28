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
  "native provider proves the ordered containment suite and one-use witness",
  { skip: !nativeAvailable, timeout: 45_000 },
  async () => {
    const runtime =
      await provider.loadPackagedWindowsContainmentProviderRuntime();
    const projectRootIdentityDigest = contracts.digestCanonicalJson({
      project: "native-integration-fixture",
    });
    const prepared = provider.prepareWindowsContainmentSelfTest({
      runtime,
      projectRootIdentityDigest,
    });
    const report = await provider.runWindowsContainmentSelfTest({ prepared });

    assert.equal(report.outcome, "verified");
    assert.deepEqual(
      report.probes.map(({ id, expected, outcome }) => ({
        id,
        expected,
        outcome,
      })),
      contracts.PROCESS_CONTAINMENT_SELF_TEST_PROBES.map(
        ({ id, expected }) => ({ id, expected, outcome: "passed" }),
      ),
    );
    assert.deepEqual(report.effects, {
      containedProcessStarted: true,
      projectMutationPerformed: false,
      networkConnectionEstablished: false,
      childProcessStarted: false,
      cleanup: "complete",
    });
    assert.doesNotThrow(() =>
      contracts.assertProcessContainmentSelfTestReportSemantics(report),
    );
    assert.equal(JSON.stringify(report).includes("\\"), false);

    const witness = provider.consumeWindowsContainmentSelfTestReport({
      runtime,
      report,
      projectRootIdentityDigest,
    });
    assert.doesNotThrow(() =>
      provider.assertWindowsContainmentSelfTestWitness(witness),
    );
    assert.throws(
      () =>
        provider.assertWindowsContainmentSelfTestWitness(
          structuredClone(witness),
        ),
      expectProviderError("self-test-witness-invalid"),
    );
    assert.throws(
      () =>
        provider.consumeWindowsContainmentSelfTestReport({
          runtime,
          report,
          projectRootIdentityDigest,
        }),
      expectProviderError("self-test-witness-consumed"),
    );
    await assert.rejects(
      provider.runWindowsContainmentSelfTest({ prepared }),
      expectProviderError("self-test-consumed"),
    );
  },
);
