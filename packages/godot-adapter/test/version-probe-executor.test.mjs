import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-version-probe-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
  );
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project };
}

async function manifest(project) {
  const names = (await readdir(project)).sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      content: await readFile(join(project, name), "utf8"),
    })),
  );
}

async function prepared(t) {
  const { project } = await fixture(t);
  const plan = await godot.prepareGodotVersionProbe({
    runId: crypto.randomUUID(),
    projectId: "sample.graybox",
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
    },
    executablePath: process.execPath,
  });
  return { project, plan };
}

function brokerFor(plan) {
  return core.createPermissionBroker({
    registry: registry.BUILTIN_REGISTRY,
    project: {
      id: plan.project.id,
      identityDigest: plan.project.identityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 0,
        maxChangedBytes: 0,
        maxDurationMs: 10_000,
        maxOutputBytes: contracts.GODOT_VERSION_PROBE_MAX_OUTPUT_BYTES,
        maxRepairCycles: 0,
      },
    },
    trustedApprovalKeys: [],
    now: () => Date.now(),
  });
}

function authorize(plan) {
  const now = Date.now();
  const request = godot.createGodotVersionProbeAuthorizationRequest({
    plan,
    deadlineAt: new Date(now + 9_000).toISOString(),
  });
  const decision = brokerFor(plan).authorize(request, []);
  assert.equal(decision.status, "authorized");
  return { decision, request };
}

function expectGodotError(code, uncertain = false) {
  return (error) =>
    error?.name === "GodotAdapterBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === uncertain;
}

test("version probe preparation binds static project and executable identities without paths", async (t) => {
  const { project, plan } = await prepared(t);

  assert.equal(plan.disposition, "ready");
  assert.equal(plan.commandId, "engine.version-probe");
  assert.equal(plan.project.identityDigest, plan.project.rootIdentityDigest);
  assert.equal(plan.input.statusDigest, plan.statusDigest);
  assert.equal(plan.input.executableDigest, plan.executable.digest);
  assert.equal(plan.input.executableIdentityDigest, plan.executable.identityDigest);
  assert.equal(plan.input.targetVersion, "4.7.2");
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.input), true);
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(project.replaceAll("\\", "\\\\")));
  assert.equal(JSON.stringify(plan).includes(process.execPath), false);

  assert.throws(
    () =>
      godot.createGodotVersionProbeAuthorizationRequest({
        plan: structuredClone(plan),
        deadlineAt: new Date(Date.now() + 9_000).toISOString(),
      }),
    expectGodotError("godot-version-plan-untrusted"),
  );
});

test("version probe authority is automatic but exact to one internal process command", async (t) => {
  const { plan } = await prepared(t);
  const { decision, request } = authorize(plan);

  assert.equal(request.commandId, "engine.version-probe");
  assert.deepEqual(request.scope.paths, ["project.godot"]);
  assert.deepEqual(decision.challenge.permissions, [
    { permission: "read-project", mode: "automatic" },
  ]);
  assert.equal(decision.challenge.inputDigest, contracts.digestCanonicalJson(plan.input));
  assert.equal(decision.challenge.project.identityDigest, plan.project.identityDigest);
  assert.equal(decision.lease.grantIds.length, 0);

  await assert.rejects(
    godot.runGodotVersionProbe({
      plan,
      authorization: structuredClone(decision),
      signal: null,
    }),
    expectGodotError("godot-version-authorization-invalid"),
  );
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

test("version probe executes one bounded --version process and settles without raw output", async (t) => {
  const { project, plan } = await prepared(t);
  const before = await manifest(project);
  const { decision } = authorize(plan);

  const report = await godot.runGodotVersionProbe({
    plan,
    authorization: decision,
    signal: null,
  });

  assert.equal(report.status, "invalid-output");
  assert.equal(report.code, "godot-version-output-format-invalid");
  assert.equal(report.process.code, "process.exited-zero");
  assert.equal(report.execution.processStarted, true);
  assert.deepEqual(report.isolation, {
    filesystem: "not-enforced",
    network: "not-enforced",
  });
  assert.equal(report.authorization.status, "failed");
  assert.ok(report.authorization.durationMs >= report.execution.durationMs);
  assert.equal(report.authorization.outputBytes, report.output.observedBytes);
  assert.equal(decision.lease.state, "settled");
  assert.equal("stdout" in report.output, false);
  assert.equal("path" in report.executable, false);
  assert.equal(JSON.stringify(report).includes(process.execPath), false);
  assert.doesNotThrow(() =>
    contracts.assertGodotVersionProbeReportSemantics(report),
  );
  assert.deepEqual(await manifest(project), before);
});

test("project marker drift fails before process dispatch and settles authority", async (t) => {
  const { project, plan } = await prepared(t);
  const { decision } = authorize(plan);
  await writeFile(
    join(project, "project.godot"),
    'config_version=5\nconfig/features=PackedStringArray("4.6")\n',
  );

  await assert.rejects(
    godot.runGodotVersionProbe({ plan, authorization: decision, signal: null }),
    expectGodotError("godot-version-plan-drift"),
  );
  assert.equal(decision.lease.state, "settled");
});

test("pre-dispatch cancellation settles authority without starting the executable", async (t) => {
  const { project, plan } = await prepared(t);
  const before = await manifest(project);
  const { decision } = authorize(plan);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    godot.runGodotVersionProbe({
      plan,
      authorization: decision,
      signal: controller.signal,
    }),
    expectGodotError("godot-version-cancelled-before-spawn"),
  );
  assert.equal(decision.lease.state, "settled");
  assert.deepEqual(await manifest(project), before);
});

test("executable drift fails before process dispatch and settles authority", async (t) => {
  const { project } = await fixture(t);
  const executable = join(project, "candidate.exe");
  await writeFile(executable, "first executable identity");
  const plan = await godot.prepareGodotVersionProbe({
    runId: crypto.randomUUID(),
    projectId: "sample.graybox",
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
    },
    executablePath: executable,
  });
  const { decision } = authorize(plan);
  await writeFile(executable, "second executable identity");

  await assert.rejects(
    godot.runGodotVersionProbe({ plan, authorization: decision, signal: null }),
    expectGodotError("godot-version-plan-drift"),
  );
  assert.equal(decision.lease.state, "settled");
});
