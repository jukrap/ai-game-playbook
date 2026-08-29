import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";
import * as godot from "../dist/index.js";
import { authorizeHostTool } from "./host-tool-approval.mjs";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-headless-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
  );
  const root = await core.canonicalizeProjectRoot(project);
  await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root };
}

async function versionProbe(t) {
  const { project, root } = await fixture(t);
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
  assert.notEqual(report.status, "matched");
  return { project, projectId, report, root };
}

async function prepared(t) {
  const context = await versionProbe(t);
  const plan = await godot.prepareGodotHeadlessPreflightFromVersionProbe({
    runId: randomUUID(),
    projectId: context.projectId,
    projectStage: "vertical-slice",
    versionProbe: context.report,
  });
  return { ...context, plan };
}

function authorize(plan) {
  return authorizeHostTool({
    plan,
    createRequest: godot.createGodotHeadlessPreflightAuthorizationRequest,
    maxOutputBytes: contracts.GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    maxDurationMs: contracts.GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS,
  });
}

function expectGodotError(code, uncertain = false) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === uncertain;
}

test("headless preflight preparation binds an original version report and finite workflow", async (t) => {
  const { project, plan, report } = await prepared(t);

  assert.equal(plan.disposition, "ready");
  assert.equal(plan.commandId, "engine.headless-preflight");
  assert.equal(plan.workflow.id, "workflow.godot-headless-preflight");
  assert.equal(plan.workflow.stepId, "step.godot-headless-preflight");
  assert.equal(plan.input.versionProbeDigest, report.probeDigest);
  assert.equal(
    plan.input.invocationDigest,
    contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  );
  assert.deepEqual(plan.input.requirements, {
    filesystem: "deny-project-writes",
    network: "deny",
    childProcesses: "deny",
  });
  assert.deepEqual(plan.input.containment, plan.containment);
  assert.equal(plan.containment.decision, "block");
  assert.equal(plan.containment.evidenceGrade, "implemented");
  assert.equal(
    plan.containment.policyDigest,
    contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
  );
  assert.equal(
    plan.containment.providerCatalogDigest,
    core.PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
  );
  assert.match(plan.containment.assessmentDigest, /^sha256:[0-9a-f]{64}$/);
  assert.match(plan.containment.requestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(JSON.stringify(plan).includes(project), false);
  assert.equal(JSON.stringify(plan).includes(process.execPath), false);

  await assert.rejects(
    godot.prepareGodotHeadlessPreflightFromVersionProbe({
      runId: randomUUID(),
      projectId: plan.project.id,
      projectStage: "vertical-slice",
      versionProbe: structuredClone(report),
    }),
    expectGodotError("godot-headless-version-report-untrusted"),
  );
});

test("headless preflight authority binds host tool approval and registered workflow", async (t) => {
  const { plan } = await prepared(t);
  const { decision, request } = authorize(plan);

  assert.equal(request.commandId, "engine.headless-preflight");
  assert.deepEqual(request.workflow, {
    id: "workflow.godot-headless-preflight",
    stepId: "step.godot-headless-preflight",
    resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
  });
  assert.deepEqual(decision.challenge.permissions, [
    { permission: "host-tool-inspection", mode: "approval-required" },
    { permission: "read-project", mode: "automatic" },
    { permission: "test-build", mode: "automatic" },
  ]);
  assert.deepEqual(decision.lease.grantIds, [
    "approval.host-tool-inspection",
  ]);
  assert.equal(
    request.scope.objectIds.includes(plan.containment.assessmentDigest),
    true,
  );
  assert.equal(
    request.scope.objectIds.includes(plan.containment.providerCatalogDigest),
    true,
  );

  await assert.rejects(
    godot.runGodotHeadlessPreflight({
      plan,
      authorization: structuredClone(decision),
      signal: null,
    }),
    expectGodotError("godot-headless-authorization-invalid"),
  );
  assert.equal(decision.lease.state, "active");

  await assert.rejects(
    godot.runGodotHeadlessPreflight({
      plan: structuredClone(plan),
      authorization: decision,
      signal: null,
    }),
    expectGodotError("godot-headless-plan-untrusted"),
  );
  assert.equal(decision.lease.state, "active");
  decision.lease.settle({
    outcome: "failed",
    mutationUncertain: false,
    actual: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 0,
      outputBytes: 0,
      repairCycles: 0,
    },
  });
});

test("headless preflight starts no process and retains one canonical blocked receipt", async (t) => {
  const { project, projectId, root, plan } = await prepared(t);
  const projectFileBefore = await readFile(join(project, "project.godot"), "utf8");
  const topLevelBefore = (await readdir(project)).sort();
  const { decision } = authorize(plan);

  const report = await godot.runGodotHeadlessPreflight({
    plan,
    authorization: decision,
    signal: null,
  });

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.blockers, [
    "godot-headless-containment-unavailable",
    "godot-headless-version-unverified",
  ]);
  assert.deepEqual(report.preconditions, {
    version: "blocked",
    containment: "blocked",
  });
  assert.deepEqual(report.containment, plan.containment);
  assert.equal(report.execution.processStarted, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.networkAccessPerformed, false);
  assert.equal(report.mutationPerformed, false);
  assert.deepEqual(report.isolation, {
    filesystem: "unavailable",
    network: "unavailable",
    childProcesses: "unavailable",
    writablePaths: [],
  });
  assert.deepEqual(report.support, {
    grade: "planned",
    evidenceGrade: "implemented",
    reason: "No contained Godot project process was started.",
  });
  assert.equal(report.receipt.status, "retained");
  assert.equal(report.receipt.chainLength, 1);
  assert.equal(decision.lease.state, "settled");
  assert.doesNotThrow(() =>
    contracts.assertGodotHeadlessPreflightReportSemantics(report),
  );
  assert.equal(JSON.stringify(report).includes(project), false);
  assert.equal(JSON.stringify(report).includes(process.execPath), false);

  const loaded = await core.loadRunReceiptChain({
    root,
    registry: registry.BUILTIN_REGISTRY,
    runId: plan.runId,
    projectId,
    projectIdentityDigest: root.identityDigest,
    workflowId: plan.workflow.id,
    resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
    maxArtifactBytes: 0,
  });
  assert.equal(loaded.receipts.length, 1);
  const receipt = loaded.receipts[0];
  assert.equal(receipt.receiptId, report.receipt.receiptId);
  assert.equal(receipt.receiptDigest, report.receipt.receiptDigest);
  assert.equal(loaded.stored.headDigest, report.receipt.headDigest);
  assert.equal(receipt.status, "blocked");
  assert.equal(receipt.identity.workflowId, plan.workflow.id);
  assert.equal(receipt.identity.stepId, plan.workflow.stepId);
  assert.equal(receipt.authority.command.id, "engine.headless-preflight");
  assert.equal(
    receipt.authority.inputDigest,
    contracts.digestCanonicalJson(plan.input),
  );
  assert.equal(receipt.outcomes.outer.status, "blocked");
  assert.equal(receipt.outcomes.inner.status, "blocked");
  assert.equal(receipt.mutation.status, "none");
  assert.deepEqual(receipt.artifacts, []);
  assert.equal(
    receipt.diagnostics.some(
      ({ message }) =>
        message.includes(plan.containment.assessmentDigest) &&
        message.includes(plan.containment.providerCatalogDigest),
    ),
    true,
  );
  assert.equal("engine" in receipt.environment, false);
  assert.deepEqual((await readdir(project)).sort(), topLevelBefore);
  assert.equal(
    await readFile(join(project, "project.godot"), "utf8"),
    projectFileBefore,
  );
});

test("project marker drift blocks admission before receipt persistence", async (t) => {
  const { project, plan, root } = await prepared(t);
  const { decision } = authorize(plan);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.6")\n',
  );

  await assert.rejects(
    godot.runGodotHeadlessPreflight({
      plan,
      authorization: decision,
      signal: null,
    }),
    expectGodotError("godot-headless-plan-drift"),
  );
  assert.equal(decision.lease.state, "settled");
  await assert.rejects(
    core.loadRunReceiptChain({
      root,
      registry: registry.BUILTIN_REGISTRY,
      runId: plan.runId,
      projectId: plan.project.id,
      projectIdentityDigest: root.identityDigest,
      workflowId: plan.workflow.id,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    }),
    (error) => error?.code === "run-receipt-store-not-found",
  );
});

test("pre-dispatch cancellation settles authority and retains no receipt", async (t) => {
  const { plan, root } = await prepared(t);
  const { decision } = authorize(plan);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    godot.runGodotHeadlessPreflight({
      plan,
      authorization: decision,
      signal: controller.signal,
    }),
    expectGodotError("godot-headless-cancelled-before-admission"),
  );
  assert.equal(decision.lease.state, "settled");
  await assert.rejects(
    core.loadRunReceiptChain({
      root,
      registry: registry.BUILTIN_REGISTRY,
      runId: plan.runId,
      projectId: plan.project.id,
      projectIdentityDigest: root.identityDigest,
      workflowId: plan.workflow.id,
      resolvedPlanDigest: plan.workflow.resolvedPlanDigest,
      maxArtifactBytes: 0,
    }),
    (error) => error?.code === "run-receipt-store-not-found",
  );
});

test("project root replacement invalidates the containment witness before admission", async (t) => {
  const { project, plan } = await prepared(t);
  const { decision } = authorize(plan);
  const moved = `${project}-original`;
  await rename(project, moved);
  await mkdir(project);

  await assert.rejects(
    godot.runGodotHeadlessPreflight({
      plan,
      authorization: decision,
      signal: null,
    }),
    expectGodotError("godot-headless-containment-witness-invalid"),
  );
  assert.equal(decision.lease.state, "settled");
});
