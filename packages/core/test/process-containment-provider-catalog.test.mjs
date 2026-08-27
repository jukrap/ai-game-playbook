import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-provider-catalog-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function expectCoreError(code) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    error?.mutationUncertain === false;
}

function assertDeepFrozen(value) {
  if (value === null || typeof value !== "object") {
    return;
  }
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    assertDeepFrozen(child);
  }
}

test("compiled containment provider catalog is empty, deterministic, and immutable", () => {
  const catalog = core.inspectProcessContainmentProviderCatalog();

  assert.deepEqual(Object.keys(catalog), [
    "schemaVersion",
    "registration",
    "dynamicRegistration",
    "providers",
    "catalogDigest",
  ]);
  assert.equal(catalog.schemaVersion, "1.0.0");
  assert.equal(catalog.registration, "compiled");
  assert.equal(catalog.dynamicRegistration, false);
  assert.deepEqual(catalog.providers, []);
  assert.equal(
    catalog.catalogDigest,
    contracts.computeProcessContainmentProviderCatalogDigest([]),
  );
  assert.equal(
    catalog.catalogDigest,
    core.PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
  );
  assertDeepFrozen(catalog);
  assert.equal(JSON.stringify(catalog).includes("\\"), false);

  assert.throws(
    () => catalog.providers.push({ providerId: "injected" }),
    TypeError,
  );
  const clone = structuredClone(catalog);
  clone.providers.push({ providerId: "injected" });
  assert.deepEqual(core.inspectProcessContainmentProviderCatalog().providers, []);
});

test("assessment uses the compiled catalog and rejects catalog or self-test injection", async (t) => {
  const { project, root } = await fixture(t);
  const before = await readdir(project);
  const catalog = core.inspectProcessContainmentProviderCatalog();

  const report = await core.assessProcessContainment({ root });
  assert.equal(report.decision, "block");
  assert.equal(report.provider.status, "unavailable");
  assert.equal(report.provider.catalogDigest, catalog.catalogDigest);
  assert.equal(report.probe.status, "not-run");
  assert.equal(report.probe.externalProcessStarted, false);
  assert.deepEqual(await readdir(project), before);

  for (const request of [
    { root, catalog },
    { root, provider: { descriptorDigest: "injected" } },
    { root, selfTestReport: { outcome: "verified" } },
  ]) {
    await assert.rejects(
      core.assessProcessContainment(request),
      expectCoreError("invalid-process-containment-request"),
    );
  }
  assert.deepEqual(await readdir(project), before);
});
