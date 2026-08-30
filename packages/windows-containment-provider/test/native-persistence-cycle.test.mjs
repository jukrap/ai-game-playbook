import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as engineCommon from "@ai-game-playbook/engine-common";
import * as godot from "../../godot-adapter/dist/index.js";
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
const fixtureSourceDigest = contracts.sha256Digest("fixture-project-source");

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
  return provider.consumeWindowsContainedSyntheticLaunchReport({
    runtime,
    report: launchReport,
    projectRootIdentityDigest: rootIdentityDigest,
  });
}

function expectation() {
  return godot.createGodotPersistenceCycleExpectation({
    projectId: "golden.graybox.godot",
    sourceDigest: fixtureSourceDigest,
    freshStateHash: godot.GODOT_GRAYBOX_FRESH_STATE_HASH,
    persistedStateHash: godot.GODOT_GRAYBOX_PERSISTED_STATE_HASH,
  });
}

async function fixtureContext(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-native-persistence-"));
  const project = join(sandbox, "project");
  await mkdir(project, { recursive: true });
  const projectFile = join(project, "project.godot");
  const behaviorPath = join(project, "fixture-behavior.txt");
  await writeFile(projectFile, "config_version=5\n");
  await writeFile(behaviorPath, "persistence-success\n");
  await writeFile(
    join(project, "manifest.json"),
    `${JSON.stringify({
      projectId: "golden.graybox.godot",
      sourceDigest: fixtureSourceDigest,
    })}\n`,
  );
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const root = await core.canonicalizeProjectRoot(project);
  const executable = await core.bindProcessExecutable({
    path: fixturePath,
    maxBytes: contracts.ENGINE_SNAPSHOT_MAX_FILE_BYTES,
    allowedEnvironmentKeys: [],
  });
  const runtime =
    await provider.loadPackagedWindowsContainmentProviderRuntime();
  return {
    behaviorPath,
    executable,
    projectFile,
    root,
    runtime,
  };
}

async function prepare(context, behavior, expected) {
  await writeFile(context.behaviorPath, `${behavior}\n`);
  const profile =
    contracts.GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE;
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
  return await provider.prepareWindowsContainedGodotPersistenceRun({
    runtime: context.runtime,
    admission,
    binding,
    root: context.root,
    executable: context.executable,
    runId: randomUUID(),
    expectationDigest: expected.expectationDigest,
  });
}

test(
  "contained Godot persistence cycle reuses one disposable profile across two serial processes",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const originalProject = await readFile(context.projectFile, "utf8");
    const expected = expectation();
    const prepared = await prepare(context, "persistence-success", expected);

    await assert.rejects(
      provider.runWindowsContainedGodotReplay({ prepared, signal: null }),
      expectProviderError("invalid-engine-run-request"),
    );
    const execution = await provider.runWindowsContainedGodotPersistence({
      prepared,
      signal: null,
    });

    assert.equal(execution.report.outcome, "succeeded");
    assert.deepEqual(execution.report.process, {
      started: true,
      startedAt: execution.report.process.startedAt,
      exitCode: 0,
      totalProcesses: 2,
      activeProcesses: 0,
    });
    assert.equal(execution.report.effects.cleanup, "complete");
    assert.equal(execution.report.effects.sourceProjectPreserved, true);
    assert.equal(execution.report.effects.sourceExecutablePreserved, true);
    assert.equal(execution.transcript.status, "available");
    assert.equal(JSON.stringify(execution).includes("graybox-save.json"), false);

    const transcript =
      provider.consumeWindowsContainedGodotPersistenceTranscript(execution);
    const parsed = godot.parseGodotPersistenceCycleOutput(
      transcript,
      expected,
    );
    assert.equal(parsed.status, "parsed");
    assert.equal(
      parsed.transcript.saveCompleted.saveDigest,
      parsed.transcript.loadCompleted.saveDigest,
    );
    assert.throws(
      () =>
        provider.consumeWindowsContainedGodotPersistenceTranscript(execution),
      expectProviderError("engine-run-output-invalid"),
    );
    assert.equal(await readFile(context.projectFile, "utf8"), originalProject);
  },
);

test(
  "contained Godot persistence cycle does not start load after a failed save phase",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const expected = expectation();
    const execution = await provider.runWindowsContainedGodotPersistence({
      prepared: await prepare(context, "persistence-save-fail", expected),
      signal: null,
    });

    assert.equal(execution.report.outcome, "failed");
    assert.equal(execution.report.process.exitCode, 2);
    assert.equal(execution.report.process.totalProcesses, 1);
    assert.equal(execution.report.process.activeProcesses, 0);
    assert.equal(execution.report.effects.cleanup, "complete");
  },
);

test(
  "contained Godot persistence cycle contains staged project mutation without source drift",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const originalProject = await readFile(context.projectFile, "utf8");
    const expected = expectation();
    const execution = await provider.runWindowsContainedGodotPersistence({
      prepared: await prepare(context, "persistence-mutate-staged", expected),
      signal: null,
    });

    assert.equal(execution.report.outcome, "failed");
    assert.equal(execution.report.mutationUncertain, false);
    assert.equal(execution.report.process.totalProcesses, 1);
    assert.equal(
      execution.report.effects.stagedProjectBaselinePreserved,
      false,
    );
    assert.equal(execution.report.effects.sourceProjectPreserved, true);
    assert.equal(execution.report.effects.cleanup, "complete");
    assert.deepEqual(execution.transcript, { status: "unavailable" });
    assert.equal(await readFile(context.projectFile, "utf8"), originalProject);
  },
);

test(
  "contained Godot persistence cycle distinguishes load failure, idle timeout, and output overflow",
  { skip: !nativeAvailable, timeout: 300_000 },
  async (t) => {
    const context = await fixtureContext(t);
    const expected = expectation();

    const loadFailure = await provider.runWindowsContainedGodotPersistence({
      prepared: await prepare(context, "persistence-load-fail", expected),
      signal: null,
    });
    assert.equal(loadFailure.report.outcome, "failed");
    assert.equal(loadFailure.report.process.exitCode, 2);
    assert.equal(loadFailure.report.process.totalProcesses, 2);

    const idle = await provider.runWindowsContainedGodotPersistence({
      prepared: await prepare(context, "persistence-load-idle", expected),
      signal: null,
    });
    assert.equal(idle.report.outcome, "failed");
    assert.equal(idle.report.process.totalProcesses, 2);
    assert.deepEqual(idle.report.termination, {
      requested: true,
      confirmed: true,
      cause: "idle-timeout",
    });
    assert.deepEqual(idle.transcript, { status: "unavailable" });

    const overflow = await provider.runWindowsContainedGodotPersistence({
      prepared: await prepare(context, "persistence-line-overflow", expected),
      signal: null,
    });
    assert.equal(overflow.report.outcome, "failed");
    assert.equal(overflow.report.output.truncated, true);
    assert.deepEqual(overflow.transcript, { status: "unavailable" });
  },
);
