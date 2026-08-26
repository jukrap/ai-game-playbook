import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const registryDigest = `sha256:${"a".repeat(64)}`;
const projectIdentityDigest = `sha256:${"b".repeat(64)}`;

function targets() {
  return [
    {
      path: ".ai-game-playbook",
      kind: "directory",
      policy: "committed",
      content: "none",
      action: "create",
      code: "target-absent",
    },
    {
      path: ".ai-game-playbook/profile.json",
      kind: "file",
      policy: "committed",
      content: "project-profile",
      action: "create",
      code: "target-absent",
    },
  ];
}

test("init request and plan report schemas are versioned, closed, and plan-only", () => {
  assert.equal(contracts.initRequestSchema.id, "init-request");
  assert.equal(contracts.initReportSchema.id, "init-report");
  assert.equal(contracts.initRequestSchema.schema.additionalProperties, false);
  assert.equal(contracts.initReportSchema.schema.additionalProperties, false);
  assert.equal(
    contracts.initReportSchema.schema.properties.mutationPerformed.const,
    false,
  );
  assert.equal(
    contracts.initReportSchema.schema.properties.applySupported.const,
    false,
  );
  assert.deepEqual(
    contracts.initReportSchema.schema.properties.status.enum,
    ["ready", "blocked"],
  );
});

test("init plan summaries and status are derived from bounded target observations", () => {
  const summary = contracts.summarizeInitPlanTargets([
    ...targets(),
    {
      path: ".ai-game-playbook/policies",
      kind: "directory",
      policy: "committed",
      content: "none",
      action: "retain",
      code: "target-ready",
    },
    {
      path: ".ai-game-playbook/local",
      kind: "directory",
      policy: "local-only",
      content: "none",
      action: "conflict",
      code: "project-path-type-mismatch",
    },
  ]);

  assert.deepEqual(summary, { create: 2, retain: 1, conflict: 1 });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(contracts.computeInitPlanStatus(targets(), []), "ready");
  assert.equal(
    contracts.computeInitPlanStatus(targets(), [
      {
        code: "project-path-type-mismatch",
        path: ".ai-game-playbook/local",
        message: "A planned directory is occupied by another filesystem type.",
        nextAction: "Move the conflicting target and rerun init.",
      },
    ]),
    "blocked",
  );
  assert.throws(
    () =>
      contracts.summarizeInitPlanTargets(
        Array.from({ length: 33 }, (_, index) => ({
          ...targets()[0],
          path: `.ai-game-playbook/path-${index}`,
        })),
      ),
    RangeError,
  );
});

test("init plan digests bind registry, project identity, and ordered target intent", () => {
  const input = {
    registryDigest,
    projectIdentityDigest,
    targets: targets(),
  };
  const digest = contracts.computeInitPlanDigest(input);

  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    digest,
    contracts.computeInitPlanDigest(structuredClone(input)),
  );
  assert.notEqual(
    digest,
    contracts.computeInitPlanDigest({
      ...input,
      targets: input.targets.map((target, index) =>
        index === 0 ? { ...target, action: "retain" } : target,
      ),
    }),
  );
  assert.notEqual(
    digest,
    contracts.computeInitPlanDigest({
      ...input,
      projectIdentityDigest: `sha256:${"c".repeat(64)}`,
    }),
  );
  assert.throws(
    () =>
      contracts.computeInitPlanDigest({
        ...input,
        targets: [{ ...input.targets[0], undeclared: true }],
      }),
    TypeError,
  );
  assert.throws(
    () => contracts.computeInitPlanDigest({ ...input, undeclared: true }),
    TypeError,
  );
});

test("init report semantics reject summary, status, identity, and digest contradictions", () => {
  const report = {
    schemaVersion: "1.0.0",
    commandId: "init",
    mode: "plan-only",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest,
    project: {
      requestedPath: "D:\\games\\sample",
      canonicalPath: "D:\\games\\sample",
      identityDigest: projectIdentityDigest,
    },
    targets: targets(),
    issues: [],
    summary: { create: 2, retain: 0, conflict: 0 },
    planDigest: contracts.computeInitPlanDigest({
      registryDigest,
      projectIdentityDigest,
      targets: targets(),
    }),
    mutationPerformed: false,
    applySupported: false,
    externalInstallPlanned: false,
    networkAccessPlanned: false,
  };

  assert.doesNotThrow(() => contracts.assertInitReportSemantics(report));
  assert.throws(
    () =>
      contracts.assertInitReportSemantics({
        ...report,
        summary: { ...report.summary, create: 1 },
      }),
    TypeError,
  );
  assert.throws(
    () => contracts.assertInitReportSemantics({ ...report, status: "blocked" }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertInitReportSemantics({
        ...report,
        project: { ...report.project, identityDigest: undefined },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertInitReportSemantics({
        ...report,
        planDigest: `sha256:${"d".repeat(64)}`,
      }),
    TypeError,
  );
});
