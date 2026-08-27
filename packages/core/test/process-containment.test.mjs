import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-containment-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    sandbox,
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

test("containment assessment is path-free, effect-free, and fail-closed", async (t) => {
  const { project, root } = await fixture(t);
  const before = await readdir(project);

  const report = await core.assessProcessContainment({ root });

  assert.equal(report.decision, "block");
  assert.equal(report.provider.status, "unavailable");
  assert.equal(
    report.provider.catalogDigest,
    core.PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
  );
  assert.deepEqual(report.requirements, contracts.PROCESS_CONTAINMENT_REQUIREMENTS);
  assert.equal(report.projectRootIdentityDigest, root.identityDigest);
  assert.equal(report.probe.status, "not-run");
  assert.equal(report.probe.externalProcessStarted, false);
  assert.equal(report.probe.mutationPerformed, false);
  assert.equal(report.probe.networkAccessPerformed, false);
  assert.equal(JSON.stringify(report).includes(project), false);
  assert.deepEqual(await readdir(project), before);
  assertDeepFrozen(report);
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentAssessmentReportSemantics(report),
  );
  await core.assertProcessContainmentAssessmentWitness(report, root);
});

test("containment witness authority cannot be cloned or rebound", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const report = await core.assessProcessContainment({ root: first.root });

  await assert.rejects(
    core.assertProcessContainmentAssessmentWitness(
      structuredClone(report),
      first.root,
    ),
    expectCoreError("process-containment-witness-invalid"),
  );
  await assert.rejects(
    core.assertProcessContainmentAssessmentWitness(
      report,
      structuredClone(first.root),
    ),
    expectCoreError("process-containment-witness-invalid"),
  );
  await assert.rejects(
    core.assertProcessContainmentAssessmentWitness(report, second.root),
    expectCoreError("process-containment-witness-invalid"),
  );
});

test("containment assessment rejects accessors and provider injection without execution", async (t) => {
  const { root } = await fixture(t);
  let getterCalled = false;
  const accessorRequest = {};
  Object.defineProperty(accessorRequest, "root", {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error("must not execute");
    },
  });

  await assert.rejects(
    core.assessProcessContainment(accessorRequest),
    expectCoreError("invalid-process-containment-request"),
  );
  assert.equal(getterCalled, false);

  await assert.rejects(
    core.assessProcessContainment({ root, provider: { assess() {} } }),
    expectCoreError("invalid-process-containment-request"),
  );
});

test("containment witness revalidates project identity before use", async (t) => {
  const { sandbox, project, root } = await fixture(t);
  const report = await core.assessProcessContainment({ root });
  await rename(project, join(sandbox, "original-project"));
  await mkdir(project);

  await assert.rejects(
    core.assertProcessContainmentAssessmentWitness(report, root),
    expectCoreError("project-root-drift"),
  );
});
