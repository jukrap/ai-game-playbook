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
import * as godot from "../dist/index.js";

async function fixture(t, version = "4.7") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-godot-capabilities-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  await writeFile(
    join(project, "project.godot"),
    `config_version=5\nconfig/features=PackedStringArray("${version}")\n`,
    "utf8",
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

function request(projectRoot) {
  return {
    schemaVersion: "1.0.0",
    projectRoot,
    engine: "godot",
  };
}

test("Godot capabilities expose all operations as planned without effects", async (t) => {
  const { project } = await fixture(t);
  const before = await manifest(project);

  const report = await godot.runGodotEngineCapabilities(request(project));

  assert.equal(report.commandId, "engine.capabilities");
  assert.equal(report.status, "attention");
  assert.equal(report.project.status, "detected");
  assert.equal(report.project.identitySource, "derived-static");
  assert.equal(report.project.observedVersion, "4.7.0");
  assert.equal(report.containment.registration, "compiled");
  assert.equal(report.containment.dynamicRegistration, false);
  assert.equal(report.containment.providerCount, 0);
  assert.equal(report.containment.status, "unavailable");
  assert.equal(report.containment.selfTestPerformed, false);
  assert.equal(report.containment.launchAvailable, false);
  assert.equal(report.containment.decision, "block");
  assert.equal(report.supportGradeCeiling, "planned");
  assert.deepEqual(
    report.capabilityReport.capabilities.map(({ operation }) => operation),
    contracts.ENGINE_OPERATION_KINDS,
  );
  assert.equal(
    report.capabilityReport.capabilities.every(
      ({ support, evidenceGrade, latestReceiptDigest }) =>
        support === "planned" &&
        evidenceGrade === "documented" &&
        latestReceiptDigest === undefined,
    ),
    true,
  );
  assert.equal(report.capabilityReport.sessionIdentity, undefined);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.networkAccessPerformed, false);
  assert.equal(report.editorControlPerformed, false);
  assert.equal(report.selfTestPerformed, false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.containment), true);
  assert.equal(Object.isFrozen(report.capabilityReport.capabilities[0]), true);
  assert.deepEqual(await manifest(project), before);
  assert.doesNotThrow(() =>
    contracts.assertEngineCapabilitiesReportSemantics(report),
  );
});

test("Godot capabilities preserve blocked and unbound project states", async (t) => {
  const { sandbox, project } = await fixture(t, "4.8");

  const incompatible = await godot.runGodotEngineCapabilities(request(project));
  assert.equal(incompatible.status, "blocked");
  assert.equal(incompatible.project.status, "detected");
  assert.equal(incompatible.capabilityReport, undefined);
  assert.equal(incompatible.supportGradeCeiling, "planned");

  const unavailable = await godot.runGodotEngineCapabilities(
    request(join(sandbox, "missing")),
  );
  assert.equal(unavailable.status, "blocked");
  assert.equal(unavailable.project.status, "blocked");
  assert.equal(unavailable.project.projectId, undefined);
  assert.equal(unavailable.capabilityReport, undefined);
  assert.doesNotThrow(() =>
    contracts.assertEngineCapabilitiesReportSemantics(unavailable),
  );
});

test("Godot capabilities refuse ambiguous multi-engine roots", async (t) => {
  const { project } = await fixture(t);
  await writeFile(
    join(project, "Sample.uproject"),
    '{"EngineAssociation":"5.8"}\n',
    "utf8",
  );

  const report = await godot.runGodotEngineCapabilities(request(project));

  assert.equal(report.status, "blocked");
  assert.equal(report.project.status, "ambiguous");
  assert.equal(report.capabilityReport, undefined);
  assert.equal(report.externalProcessStarted, false);
});

test("registered Godot capabilities reject executable and provider authority", async (t) => {
  const { project } = await fixture(t);

  for (const extra of [
    { executablePath: process.execPath },
    { providerDescriptor: {} },
    { selfTestReport: {} },
    { launchHandle: {} },
  ]) {
    await assert.rejects(() =>
      godot.runGodotEngineCapabilities({ ...request(project), ...extra }),
    );
  }

  await assert.rejects(
    godot.runGodotEngineCapabilities(request(project), {}),
    (error) =>
      error?.name === "GodotAdapterBoundaryError" &&
      error?.code === "godot-capabilities-options-invalid",
  );
});

test("Godot capabilities reject accessors and inherited authority without invoking them", async (t) => {
  const { project } = await fixture(t);
  let getterCalled = false;
  const accessor = {
    schemaVersion: "1.0.0",
    engine: "godot",
  };
  Object.defineProperty(accessor, "projectRoot", {
    enumerable: true,
    get() {
      getterCalled = true;
      return project;
    },
  });
  await assert.rejects(() => godot.runGodotEngineCapabilities(accessor));
  assert.equal(getterCalled, false);

  const inherited = Object.create({ executablePath: process.execPath });
  Object.assign(inherited, request(project));
  await assert.rejects(() => godot.runGodotEngineCapabilities(inherited));
});
