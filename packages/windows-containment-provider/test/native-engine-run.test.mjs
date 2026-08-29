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
import * as provider from "../dist/index.js";

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
          }),
          expectProviderError("invalid-engine-run-request"),
        );
      }
      const report = await provider.runWindowsContainedGodotEngine({ prepared });
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
      }
      if (behavior === "spawn-child") {
        assert.equal(report.effects.childProcessStarted, false);
        assert.equal(report.process.totalProcesses, 1);
      }
      await assert.rejects(
        provider.runWindowsContainedGodotEngine({ prepared }),
        expectProviderError("engine-run-consumed"),
      );
    }
  },
);
