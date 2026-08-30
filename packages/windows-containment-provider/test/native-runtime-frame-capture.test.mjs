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
import * as evidence from "../../evidence/dist/index.js";
import * as provider from "../dist/index.js";

const providerPath = fileURLToPath(
  new URL("../dist/native/win-x64/agpb-windows-containment.exe", import.meta.url),
);
const fixturePath = fileURLToPath(
  new URL("../dist/test-native/win-x64/agpb-godot-fixture.exe", import.meta.url),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(providerPath) &&
  existsSync(fixturePath);

function expectProviderError(code) {
  return (error) =>
    error?.name === "WindowsContainmentProviderError" && error?.code === code;
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
  assert.equal(launchReport.outcome, "succeeded");
  return provider.consumeWindowsContainedSyntheticLaunchReport({
    runtime,
    report: launchReport,
    projectRootIdentityDigest: rootIdentityDigest,
  });
}

async function fixtureContext(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-native-capture-"));
  const project = join(sandbox, "project");
  await mkdir(project, { recursive: true });
  const projectFile = join(project, "project.godot");
  const behaviorPath = join(project, "fixture-behavior.txt");
  await writeFile(projectFile, "config_version=5\n");
  await writeFile(behaviorPath, "capture-success\n");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = await core.canonicalizeProjectRoot(project);
  const executable = await core.bindProcessExecutable({
    path: fixturePath,
    maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    allowedEnvironmentKeys: [],
  });
  const runtime =
    await provider.loadPackagedWindowsContainmentProviderRuntime();
  return { behaviorPath, executable, projectFile, root, runtime };
}

async function prepare(context, behavior) {
  await writeFile(context.behaviorPath, `${behavior}\n`);
  const profile =
    contracts.GODOT_RUNTIME_FRAME_CAPTURE_ENGINE_EXECUTION_PROFILE;
  const binding = await engineCommon.captureEngineExecutionSnapshots({
    root: context.root,
    executable: context.executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      profileId: profile.profileId,
      behavior,
    }),
  });
  const launchAuthority = await launchWitness(
    context.runtime,
    context.root.identityDigest,
  );
  const admission = await provider.createWindowsContainedEngineAdmission({
    runtime: context.runtime,
    launchWitness: launchAuthority,
    binding,
    root: context.root,
    executable: context.executable,
    operationId: profile.operationId,
    invocationDigest: profile.invocationDigest,
  });
  return await provider.prepareWindowsContainedGodotCaptureRun({
    runtime: context.runtime,
    admission,
    binding,
    root: context.root,
    executable: context.executable,
    runId: randomUUID(),
    expectationDigest: contracts.digestCanonicalJson({ behavior }),
  });
}

test(
  "contained runtime frame capture transfers one path-free PNG payload once",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const originalProject = await readFile(context.projectFile, "utf8");
    const prepared = await prepare(context, "capture-success");

    await assert.rejects(
      provider.runWindowsContainedGodotReplay({ prepared, signal: null }),
      expectProviderError("invalid-engine-run-request"),
    );
    const execution = await provider.runWindowsContainedGodotCapture({
      prepared,
      signal: null,
    });

    assert.equal(execution.report.outcome, "succeeded");
    assert.equal(execution.report.process.exitCode, 0);
    assert.equal(execution.report.process.totalProcesses, 1);
    assert.equal(execution.report.process.activeProcesses, 0);
    assert.equal(execution.report.effects.cleanup, "complete");
    assert.equal(execution.report.effects.sourceProjectPreserved, true);
    assert.equal(execution.report.effects.sourceExecutablePreserved, true);
    assert.equal(execution.transcript.status, "available");
    assert.equal(execution.artifact.status, "available");
    assert.equal(execution.artifact.kind, "runtime-frame");
    assert.equal(execution.artifact.format, "png");
    assert.equal(JSON.stringify(execution).includes("runtime-frame.png"), false);
    assert.equal(JSON.stringify(execution).includes("contentBase64"), false);

    const payload = provider.consumeWindowsContainedGodotCapturePayload(execution);
    assert.match(payload.transcript, /^AGPB_RUNTIME_FRAME /u);
    assert.equal(
      contracts.sha256Digest(payload.artifact),
      execution.artifact.digest,
    );
    assert.equal(payload.artifact.byteLength, execution.artifact.bytes);
    const inspected = evidence.inspectArtifactBytes({
      expectation: {
        format: "png",
        maxWidth: 960,
        maxHeight: 540,
        maxPixels: 960 * 540,
        maxDecodedBytes: 4 * 960 * 540,
      },
      content: payload.artifact,
      maxBytes: contracts.GODOT_RUNTIME_FRAME_CAPTURE_MAX_ARTIFACT_BYTES,
    });
    assert.equal(inspected.status, "passed");
    assert.throws(
      () => provider.consumeWindowsContainedGodotCapturePayload(execution),
      expectProviderError("engine-run-output-invalid"),
    );
    assert.throws(
      () =>
        provider.consumeWindowsContainedGodotCapturePayload(
          structuredClone(execution),
        ),
      expectProviderError("engine-run-output-invalid"),
    );
    assert.equal(await readFile(context.projectFile, "utf8"), originalProject);
  },
);

test(
  "contained runtime frame capture withholds missing, oversized, and failed artifacts",
  { skip: !nativeAvailable, timeout: 300_000 },
  async (t) => {
    const context = await fixtureContext(t);
    for (const behavior of ["capture-missing", "capture-oversize", "capture-fail"]) {
      const execution = await provider.runWindowsContainedGodotCapture({
        prepared: await prepare(context, behavior),
        signal: null,
      });
      assert.equal(
        execution.report.outcome,
        behavior === "capture-fail" ? "failed" : "succeeded",
        behavior,
      );
      assert.equal(execution.transcript.status, "available", behavior);
      assert.deepEqual(execution.artifact, { status: "unavailable" }, behavior);
      const payload = provider.consumeWindowsContainedGodotCapturePayload(execution);
      assert.match(payload.transcript, /^AGPB_RUNTIME_FRAME /u, behavior);
      assert.equal(payload.artifact, undefined, behavior);
    }
  },
);

test(
  "contained runtime frame capture withholds bytes after staged drift or output overflow",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const originalProject = await readFile(context.projectFile, "utf8");

    const drift = await provider.runWindowsContainedGodotCapture({
      prepared: await prepare(context, "capture-mutate-staged"),
      signal: null,
    });
    assert.equal(drift.report.outcome, "failed");
    assert.equal(drift.report.effects.stagedProjectBaselinePreserved, false);
    assert.equal(drift.report.effects.sourceProjectPreserved, true);
    assert.deepEqual(drift.artifact, { status: "unavailable" });

    const overflow = await provider.runWindowsContainedGodotCapture({
      prepared: await prepare(context, "capture-line-overflow"),
      signal: null,
    });
    assert.equal(overflow.report.outcome, "failed");
    assert.equal(overflow.report.output.truncated, true);
    assert.deepEqual(overflow.artifact, { status: "unavailable" });
    assert.equal(await readFile(context.projectFile, "utf8"), originalProject);
  },
);
