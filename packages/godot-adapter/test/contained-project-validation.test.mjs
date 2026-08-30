import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
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
  "addons/ai_game_playbook/validators/project_validation.gd",
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

function authorizationWindowMs(plan) {
  return Math.max(1_000, Date.parse(plan.containment.expiresAt) - Date.now() - 1_000);
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

async function preparedProject(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-project-validation-"));
  const project = join(sandbox, "project");
  await cp(sourceProject, project, { recursive: true });
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
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
  return { project, projectId, root, runtime, versionProbe };
}

test("Godot project import preparation never invokes accessors", async () => {
  let called = false;
  const hostile = {
    runId: randomUUID(),
    projectId: "golden.graybox.godot",
    projectStage: "vertical-slice",
    versionProbe: null,
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
    godot.prepareGodotContainedProjectImport(hostile),
    expectGodotError("godot-project-import-preparation-invalid"),
  );
  assert.equal(called, false);
});

test(
  "contained Godot project validation chains import and semantic evidence",
  { skip: !nativeAvailable, timeout: 180_000 },
  async (t) => {
    const context = await preparedProject(t);
    const sourceBefore = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    const runId = randomUUID();
    const importWitness = await launchWitness(
      context.runtime,
      context.root.identityDigest,
    );
    const importPlan = await godot.prepareGodotContainedProjectImport({
      runId,
      projectId: context.projectId,
      projectStage: "vertical-slice",
      versionProbe: context.versionProbe,
      containmentRuntime: context.runtime,
      launchWitness: importWitness,
    });
    assert.equal(importPlan.commandId, contracts.GODOT_PROJECT_IMPORT_COMMAND_ID);
    assert.equal(
      importPlan.containment.profileDigest,
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.profileDigest,
    );
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedProjectImport(importPlan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedProjectImport(
        structuredClone(importPlan),
      ),
      expectGodotError("godot-project-import-plan-untrusted"),
    );
    const importApproval = authorizeHostTool({
      plan: importPlan,
      createRequest:
        godot.createGodotContainedProjectImportAuthorizationRequest,
      maxOutputBytes: contracts.GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
      maxDurationMs: contracts.GODOT_PROJECT_IMPORT_COMMAND_TIMEOUT_MS,
      authorizationWindowMs: authorizationWindowMs(importPlan),
    });
    assert.equal(
      importApproval.request.scope.paths.includes("fixture-behavior.txt"),
      false,
    );
    const importReport = await godot.runGodotContainedProjectImport({
      plan: importPlan,
      authorization: importApproval.decision,
      signal: null,
    });
    assert.equal(importReport.status, "succeeded");
    assert.equal(importReport.code, "godot-project-import-passed");
    assert.equal(importReport.engineRun.outcome, "succeeded");
    assert.equal(importReport.engineRun.process.exitCode, 0);
    assert.equal(importReport.support.grade, "planned");
    assert.equal(importReport.support.liveValidated, false);
    assert.equal(importApproval.decision.lease.state, "settled");
    assert.doesNotThrow(() =>
      contracts.assertGodotProjectImportReportSemantics(importReport),
    );

    const validationWitness = await launchWitness(
      context.runtime,
      context.root.identityDigest,
    );
    await assert.rejects(
      godot.prepareGodotContainedProjectValidation({
        importReport: structuredClone(importReport),
        containmentRuntime: context.runtime,
        launchWitness: validationWitness,
      }),
      expectGodotError("godot-project-validation-import-untrusted"),
    );
    const validationPlan = await godot.prepareGodotContainedProjectValidation({
      importReport,
      containmentRuntime: context.runtime,
      launchWitness: validationWitness,
    });
    assert.equal(
      validationPlan.commandId,
      contracts.GODOT_PROJECT_VALIDATION_COMMAND_ID,
    );
    assert.equal(
      validationPlan.importPhase.reportDigest,
      importReport.reportDigest,
    );
    assert.equal(
      validationPlan.containment.profileDigest,
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.profileDigest,
    );
    await assert.doesNotReject(
      godot.assertPreparedGodotContainedProjectValidation(validationPlan),
    );
    await assert.rejects(
      godot.assertPreparedGodotContainedProjectValidation(
        structuredClone(validationPlan),
      ),
      expectGodotError("godot-project-validation-plan-untrusted"),
    );
    const validationApproval = authorizeHostTool({
      plan: validationPlan,
      createRequest:
        godot.createGodotContainedProjectValidationAuthorizationRequest,
      maxOutputBytes: contracts.GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
      maxDurationMs: contracts.GODOT_PROJECT_VALIDATION_COMMAND_TIMEOUT_MS,
      authorizationWindowMs: authorizationWindowMs(validationPlan),
    });
    const validationReport = await godot.runGodotContainedProjectValidation({
      plan: validationPlan,
      authorization: validationApproval.decision,
      signal: null,
    });
    assert.equal(validationReport.status, "succeeded");
    assert.equal(validationReport.code, "godot-project-validation-passed");
    assert.equal(validationReport.transcript.status, "validated");
    assert.equal(validationReport.transcript.terminal, "validation-passed");
    assert.equal(validationReport.transcript.rootType, "Node3D");
    assert.equal(validationReport.engineRun.outcome, "succeeded");
    assert.equal(validationReport.engineRun.process.exitCode, 0);
    assert.equal(validationReport.support.grade, "planned");
    assert.equal(validationReport.support.liveValidated, false);
    assert.equal(validationApproval.decision.lease.state, "settled");
    assert.doesNotThrow(() =>
      contracts.assertGodotProjectValidationReportSemantics(validationReport),
    );
    assert.equal(JSON.stringify(importReport).includes(context.project), false);
    assert.equal(JSON.stringify(validationReport).includes(context.project), false);
    assert.equal(JSON.stringify(validationReport).includes(fixturePath), false);

    const transcript =
      godot.consumeGodotContainedProjectValidationTranscript(validationReport);
    assert.equal(
      transcript.transcriptDigest,
      validationReport.transcript.transcriptDigest,
    );
    assert.equal(transcript.terminal.event, "validation-passed");
    assert.throws(
      () =>
        godot.consumeGodotContainedProjectValidationTranscript(validationReport),
      expectGodotError("godot-project-validation-transcript-unavailable"),
    );
    assert.throws(
      () =>
        godot.consumeGodotContainedProjectValidationTranscript(
          structuredClone(validationReport),
        ),
      expectGodotError("godot-project-validation-transcript-unavailable"),
    );

    const loaded = await core.loadRunReceiptChain({
      root: context.root,
      registry: registry.BUILTIN_REGISTRY,
      runId,
      projectId: importPlan.project.id,
      projectIdentityDigest: context.root.identityDigest,
      workflowId: importPlan.workflow.id,
      resolvedPlanDigest: importPlan.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    });
    assert.equal(loaded.receipts.length, 2);
    const [importReceipt, validationReceipt] = loaded.receipts;
    assert.equal(importReceipt.identity.stepId, "step.godot-project-import");
    assert.equal(importReceipt.status, "succeeded");
    assert.equal(validationReceipt.identity.stepId, "step.godot-project-validation");
    assert.equal(validationReceipt.status, "succeeded");
    assert.equal(
      validationReceipt.previousReceiptDigest,
      importReceipt.receiptDigest,
    );
    assert.equal(
      validationReport.receipt.chainLength,
      importReport.receipt.chainLength + 1,
    );
    const sourceAfter = await Promise.all(
      sourcePaths.map((path) => readFile(join(context.project, path))),
    );
    assert.deepEqual(sourceAfter, sourceBefore);
  },
);
