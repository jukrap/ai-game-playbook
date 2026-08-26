import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  link,
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
import * as godot from "../dist/index.js";
import { authorizeHostTool } from "./host-tool-approval.mjs";

async function fixture(t, version = "4.7") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-discovery-"));
  const project = join(sandbox, "project");
  const tools = join(sandbox, "tools");
  await mkdir(project);
  await mkdir(tools);
  await writeFile(
    join(project, "project.godot"),
    `config_version=5\nconfig/features=PackedStringArray("${version}")\n`,
  );
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project, tools };
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

function pathExecutableName() {
  return process.platform === "win32" ? "godot.exe" : "godot4";
}

async function makeExecutable(path) {
  try {
    await link(process.execPath, path);
  } catch {
    await copyFile(process.execPath, path);
  }
  await chmod(path, 0o700);
}

function request(projectRoot, configuredPaths = [], pathDirectories = []) {
  return {
    schemaVersion: "1.0.0",
    projectRoot,
    engine: "godot",
    sources: { configuredPaths, pathDirectories },
  };
}

async function discover(projectRoot, configuredPaths = [], pathDirectories = []) {
  const plan = await godot.prepareGodotExecutableDiscovery({
    runId: crypto.randomUUID(),
    projectId: "sample.graybox",
    request: request(projectRoot, configuredPaths, pathDirectories),
  });
  const authorization = authorizeHostTool({
    plan,
    createRequest: godot.createGodotExecutableDiscoveryAuthorizationRequest,
    maxOutputBytes: godot.GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
  });
  const report = await godot.runGodotExecutableDiscovery({
    plan,
    authorization: authorization.decision,
  });
  return { authorization, plan, report };
}

test("discovery requires explicit host-tool approval and omits source paths", async (t) => {
  const { project, tools } = await fixture(t);
  const candidatePath = join(tools, pathExecutableName());
  await makeExecutable(candidatePath);
  const before = await manifest(project);

  const { authorization, plan, report } = await discover(
    project,
    [candidatePath],
    [tools],
  );

  assert.deepEqual(authorization.pending.challenge.permissions, [
    { permission: "host-tool-inspection", mode: "approval-required" },
    { permission: "read-project", mode: "automatic" },
  ]);
  assert.deepEqual(authorization.request.scope.paths, ["project.godot"]);
  assert.deepEqual(authorization.request.scope.objectIds, [
    plan.sources.sourceDigest,
  ]);
  assert.deepEqual(authorization.decision.lease.grantIds, [
    "approval.host-tool-inspection",
  ]);
  assert.equal(JSON.stringify(plan).includes(candidatePath), false);
  assert.equal(JSON.stringify(plan).includes(tools), false);
  assert.equal(report.status, "ready");
  assert.equal(report.project.ready, true);
  assert.equal(report.sources.configuredPathCount, 1);
  assert.equal(report.sources.pathDirectoryCount, 1);
  assert.equal(report.sources.consideredPathCount, 2);
  assert.equal(report.sources.acceptedPathCount, 1);
  assert.equal(report.sources.missingPathCount, 1);
  assert.equal(report.sources.acceptedCandidateCount, 1);
  assert.equal(report.candidates.length, 1);
  assert.deepEqual(report.candidates[0].sources, ["configured", "path"]);
  assert.equal(report.candidateSelectionAvailable, true);
  assert.equal(report.executionAuthorityGranted, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.recursiveSearchPerformed, false);
  assert.equal(report.authorization.permission, "host-tool-inspection");
  assert.deepEqual(report.authorization.grantIds, [
    "approval.host-tool-inspection",
  ]);
  assert.equal(JSON.stringify(report).includes(candidatePath), false);
  assert.equal(JSON.stringify(report).includes(tools), false);
  assert.doesNotThrow(() =>
    contracts.assertGodotExecutableDiscoveryReportSemantics(report),
  );
  assert.deepEqual(await manifest(project), before);
});

test("discovery separates missing and rejected exact candidates", async (t) => {
  const { sandbox, project } = await fixture(t);
  const missing = join(sandbox, "missing.exe");
  const directory = join(sandbox, "candidate-directory");
  await mkdir(directory);

  const { report } = await discover(project, [missing, directory]);

  assert.equal(report.status, "attention");
  assert.equal(report.sources.consideredPathCount, 2);
  assert.equal(report.sources.missingPathCount, 1);
  assert.equal(report.sources.rejectedPathCount, 1);
  assert.equal(report.sources.acceptedCandidateCount, 0);
  assert.deepEqual(report.candidates, []);
  assert.equal(report.candidateSelectionAvailable, false);
  assert.deepEqual(
    report.issues.map(({ code }) => code),
    ["godot-executable-candidate-rejected", "godot-executable-not-found"],
  );
  assert.equal(JSON.stringify(report).includes(missing), false);
  assert.equal(JSON.stringify(report).includes(directory), false);
});

test("an incompatible project is rejected before host approval or inspection", async (t) => {
  const { project, tools } = await fixture(t, "4.8");
  const candidatePath = join(tools, pathExecutableName());
  await makeExecutable(candidatePath);

  await assert.rejects(
    godot.prepareGodotExecutableDiscovery({
      runId: crypto.randomUUID(),
      projectId: "sample.graybox",
      request: request(project, [candidatePath]),
    }),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-discovery-project-not-ready",
  );
});

test("PATH discovery checks fixed direct names and never scans descendants", async (t) => {
  const { project, tools } = await fixture(t);
  const nested = join(tools, "nested");
  await mkdir(nested);
  await makeExecutable(join(nested, pathExecutableName()));

  const { report } = await discover(project, [], [tools]);

  assert.equal(report.status, "attention");
  assert.equal(report.sources.consideredPathCount, 2);
  assert.equal(report.sources.missingPathCount, 2);
  assert.deepEqual(report.candidates, []);
  assert.equal(report.recursiveSearchPerformed, false);
});

test("preparation rejects relative sources and never executes nested accessors", async (t) => {
  const { project } = await fixture(t);
  await assert.rejects(
    godot.prepareGodotExecutableDiscovery({
      runId: crypto.randomUUID(),
      projectId: "sample.graybox",
      request: request(project, ["relative-godot"]),
    }),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-discovery-source-invalid",
  );

  let getterCalled = false;
  const sources = {};
  Object.defineProperty(sources, "configuredPaths", {
    enumerable: true,
    get() {
      getterCalled = true;
      return [process.execPath];
    },
  });
  Object.defineProperty(sources, "pathDirectories", {
    enumerable: true,
    value: [],
  });
  await assert.rejects(() =>
    godot.prepareGodotExecutableDiscovery({
      runId: crypto.randomUUID(),
      projectId: "sample.graybox",
      request: {
        schemaVersion: "1.0.0",
        projectRoot: project,
        engine: "godot",
        sources,
      },
    }),
  );
  assert.equal(getterCalled, false);
});

test("cloned plans and authorization decisions cannot cross runtime boundaries", async (t) => {
  const { project } = await fixture(t);
  const plan = await godot.prepareGodotExecutableDiscovery({
    runId: crypto.randomUUID(),
    projectId: "sample.graybox",
    request: request(project, [process.execPath]),
  });
  assert.throws(
    () =>
      godot.createGodotExecutableDiscoveryAuthorizationRequest({
        plan: structuredClone(plan),
        deadlineAt: new Date(Date.now() + 9_000).toISOString(),
      }),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-discovery-plan-untrusted",
  );
  const { decision } = authorizeHostTool({
    plan,
    createRequest: godot.createGodotExecutableDiscoveryAuthorizationRequest,
    maxOutputBytes: godot.GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
  });
  await assert.rejects(
    godot.runGodotExecutableDiscovery({
      plan,
      authorization: structuredClone(decision),
    }),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-discovery-authorization-invalid",
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

test("only the original discovery report can prepare a selected version probe", async (t) => {
  const { project, tools } = await fixture(t);
  const candidatePath = join(tools, pathExecutableName());
  await makeExecutable(candidatePath);
  const { report: discovery } = await discover(project, [candidatePath]);
  const candidateIdentityDigest = discovery.candidates[0].identityDigest;

  const plan = await godot.prepareGodotVersionProbeFromDiscovery({
    runId: crypto.randomUUID(),
    projectId: "sample.graybox",
    request: {
      schemaVersion: "1.0.0",
      projectRoot: project,
      engine: "godot",
    },
    discovery,
    candidateIdentityDigest,
  });

  assert.equal(plan.commandId, "engine.version-probe");
  assert.equal(plan.executable.identityDigest, candidateIdentityDigest);
  assert.equal(plan.input.executableIdentityDigest, candidateIdentityDigest);
  assert.equal(JSON.stringify(plan).includes(candidatePath), false);

  await assert.rejects(
    godot.prepareGodotVersionProbeFromDiscovery({
      runId: crypto.randomUUID(),
      projectId: "sample.graybox",
      request: {
        schemaVersion: "1.0.0",
        projectRoot: project,
        engine: "godot",
      },
      discovery: structuredClone(discovery),
      candidateIdentityDigest,
    }),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-discovery-report-untrusted",
  );
});
