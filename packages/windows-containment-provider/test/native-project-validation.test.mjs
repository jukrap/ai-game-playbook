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
import { dirname, join } from "node:path";
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
    error?.name === "WindowsContainmentProviderError" && error?.code === code;
}

function validationLine(event) {
  return `${contracts.GODOT_PROJECT_VALIDATION_OUTPUT_PREFIX}${JSON.stringify(event)}\n`;
}

function validationOutput(terminal = "passed") {
  const identity = {
    projectId: "golden.graybox.godot",
    sourceDigest: contracts.sha256Digest("fixture-project-source"),
    mainScene: "scenes/main.tscn",
  };
  return [
    validationLine({ event: "validation-started", ...identity }),
    validationLine(
      terminal === "passed"
        ? {
            event: "validation-passed",
            ...identity,
            resourceType: "PackedScene",
            rootType: "Node3D",
          }
        : {
            event: "validation-failed",
            ...identity,
            code: "main-scene-load-failed",
          },
    ),
  ].join("");
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

async function prepare(context, profile, behavior, output = "") {
  await writeFile(context.behaviorPath, `${behavior}\n`);
  await writeFile(context.validationPath, output);
  const binding = await engineCommon.captureEngineExecutionSnapshots({
    root: context.root,
    executable: context.executable,
    engine: "godot",
    projectInspectionDigest: contracts.digestCanonicalJson({
      profileId: profile.profileId,
      behavior,
      outputDigest: contracts.sha256Digest(output),
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
  const request = {
    runtime: context.runtime,
    admission,
    binding,
    root: context.root,
    executable: context.executable,
    runId: randomUUID(),
    expectationDigest: contracts.sha256Digest(
      `expectation:${profile.profileId}:${behavior}`,
    ),
  };
  return profile.operationId === "engine.project-import"
    ? await provider.prepareWindowsContainedGodotImportRun(request)
    : await provider.prepareWindowsContainedGodotValidationRun(request);
}

async function fixtureContext(t, prefix) {
  const sandbox = await mkdtemp(join(tmpdir(), prefix));
  const project = join(sandbox, "project");
  const validator = join(
    project,
    "addons",
    "ai_game_playbook",
    "validators",
    "project_validation.gd",
  );
  await mkdir(dirname(validator), { recursive: true });
  const projectFile = join(project, "project.godot");
  const behaviorPath = join(project, "fixture-behavior.txt");
  const validationPath = join(project, "fixture-validation.txt");
  await writeFile(projectFile, "config_version=5\n");
  await writeFile(validator, "extends SceneTree\n");
  await writeFile(behaviorPath, "project-import-success\n");
  await writeFile(validationPath, validationOutput());
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
    validationPath,
  };
}

test(
  "contained Godot project import permits only disposable cache changes",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t, "agpb-native-project-import-");
    const originalProject = await readFile(context.projectFile, "utf8");
    const profile = contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE;

    const succeeded = await provider.runWindowsContainedGodotImport({
      prepared: await prepare(
        context,
        profile,
        "project-import-success",
      ),
      signal: null,
    });
    assert.equal(succeeded.outcome, "succeeded");
    assert.equal(succeeded.effects.stagedProjectBaselinePreserved, true);
    assert.equal(succeeded.effects.sourceProjectPreserved, true);
    assert.equal(succeeded.effects.cleanup, "complete");
    assert.equal(succeeded.inputBindingDigest === null, false);

    const failed = await provider.runWindowsContainedGodotImport({
      prepared: await prepare(context, profile, "project-import-fail"),
      signal: null,
    });
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.process.exitCode, 7);

    const drifted = await provider.runWindowsContainedGodotImport({
      prepared: await prepare(
        context,
        profile,
        "project-import-mutate-staged",
      ),
      signal: null,
    });
    assert.equal(drifted.outcome, "failed");
    assert.equal(drifted.effects.stagedProjectBaselinePreserved, false);
    assert.equal(await readFile(context.projectFile, "utf8"), originalProject);
  },
);

test(
  "contained Godot validator transfers one bounded single-use transcript",
  { skip: !nativeAvailable, timeout: 240_000 },
  async (t) => {
    const context = await fixtureContext(t, "agpb-native-project-validation-");
    const profile =
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE;
    const passedOutput = validationOutput();
    const prepared = await prepare(
      context,
      profile,
      "project-validation-success",
      passedOutput,
    );
    await assert.rejects(
      provider.runWindowsContainedGodotReplay({ prepared, signal: null }),
      expectProviderError("invalid-engine-run-request"),
    );
    const execution = await provider.runWindowsContainedGodotValidation({
      prepared,
      signal: null,
    });
    assert.equal(execution.report.outcome, "succeeded");
    assert.deepEqual(execution.transcript, {
      status: "available",
      digest: contracts.sha256Digest(passedOutput),
      bytes: Buffer.byteLength(passedOutput),
    });
    assert.equal(JSON.stringify(execution).includes(passedOutput), false);
    assert.throws(
      () =>
        provider.consumeWindowsContainedGodotValidationTranscript(
          structuredClone(execution),
        ),
      expectProviderError("engine-run-output-invalid"),
    );
    assert.equal(
      provider.consumeWindowsContainedGodotValidationTranscript(execution),
      passedOutput,
    );
    assert.throws(
      () =>
        provider.consumeWindowsContainedGodotValidationTranscript(execution),
      expectProviderError("engine-run-output-invalid"),
    );

    const failedOutput = validationOutput("failed");
    const failed = await provider.runWindowsContainedGodotValidation({
      prepared: await prepare(
        context,
        profile,
        "project-validation-fail",
        failedOutput,
      ),
      signal: null,
    });
    assert.equal(failed.report.outcome, "failed");
    assert.equal(failed.report.process.exitCode, 2);
    assert.equal(
      provider.consumeWindowsContainedGodotValidationTranscript(failed),
      failedOutput,
    );

    for (const behavior of [
      "project-validation-idle",
      "project-validation-line-overflow",
      "project-validation-event-overflow",
      "project-validation-mutate-staged",
    ]) {
      const bounded = await provider.runWindowsContainedGodotValidation({
        prepared: await prepare(context, profile, behavior, passedOutput),
        signal: null,
      });
      assert.equal(bounded.report.outcome, "failed", behavior);
      assert.deepEqual(bounded.transcript, { status: "unavailable" }, behavior);
    }
  },
);
