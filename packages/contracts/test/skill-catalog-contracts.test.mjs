import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const registryDigest = `sha256:${"a".repeat(64)}`;
const projectIdentityDigest = `sha256:${"b".repeat(64)}`;
const artifactDigest = `sha256:${"c".repeat(64)}`;

function entries() {
  return [
    {
      id: "project.inspection",
      name: "project-inspection",
      version: "1.0.0",
      invocation: "model",
      summary: "Inspect one local game project before planning changes.",
      capabilities: ["project.inspect"],
      requiredPermissions: ["read-project"],
      artifactPath: "skills/project-inspection/SKILL.md",
      artifactDigest,
      maxTokens: 800,
      targetPath: ".agents/skills/project-inspection/SKILL.md",
    },
  ];
}

function checks(targetStatus = "current", code = "skill-target-current") {
  return [
    {
      id: "project.inspection",
      name: "project-inspection",
      artifactPath: "skills/project-inspection/SKILL.md",
      artifactDigest,
      targetPath: ".agents/skills/project-inspection/SKILL.md",
      targetStatus,
      code,
      ...(targetStatus === "current"
        ? { actualDigest: artifactDigest, bytes: 1_620 }
        : targetStatus === "conflict" &&
            code === "skill-target-content-conflict"
          ? { actualDigest: `sha256:${"d".repeat(64)}`, bytes: 1_621 }
        : {}),
    },
  ];
}

test("skill list and check schemas are closed, project-bound, and write-free", () => {
  assert.equal(contracts.skillListRequestSchema.id, "skill-list-request");
  assert.equal(contracts.skillListReportSchema.id, "skill-list-report");
  assert.equal(contracts.skillCheckRequestSchema.id, "skill-check-request");
  assert.equal(contracts.skillCheckReportSchema.id, "skill-check-report");
  assert.equal(
    contracts.skillListRequestSchema.schema.additionalProperties,
    false,
  );
  assert.equal(
    contracts.skillCheckReportSchema.schema.additionalProperties,
    false,
  );
  assert.equal(
    contracts.skillListReportSchema.schema.properties.materializationAvailable
      .const,
    false,
  );
  assert.equal(
    contracts.skillCheckReportSchema.schema.properties.mutationPerformed.const,
    false,
  );
  assert.deepEqual(
    contracts.skillCheckReportSchema.schema.properties.status.enum,
    ["ready", "attention", "blocked"],
  );
});

test("skill catalog summary and digest bind exact registry entries", () => {
  const summary = contracts.summarizeSkillCatalogEntries(entries());
  const digest = contracts.computeSkillCatalogDigest({
    registryDigest,
    entries: entries(),
  });

  assert.deepEqual(summary, {
    registered: 1,
    modelInvoked: 1,
    userInvoked: 0,
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    digest,
    contracts.computeSkillCatalogDigest({
      registryDigest,
      entries: structuredClone(entries()),
    }),
  );
  assert.notEqual(
    digest,
    contracts.computeSkillCatalogDigest({
      registryDigest,
      entries: [{ ...entries()[0], maxTokens: 801 }],
    }),
  );
  assert.throws(
    () =>
      contracts.computeSkillCatalogDigest({
        registryDigest,
        entries: [{ ...entries()[0], undeclared: true }],
      }),
    TypeError,
  );
});

test("skill check summary and status preserve missing, conflict, and unsafe targets", () => {
  assert.deepEqual(contracts.summarizeSkillChecks(checks()), {
    total: 1,
    missing: 0,
    current: 1,
    conflict: 0,
    unsafe: 0,
  });
  assert.equal(contracts.computeSkillCheckStatus(checks()), "ready");
  assert.equal(
    contracts.computeSkillCheckStatus(
      checks("missing", "skill-target-missing"),
    ),
    "attention",
  );
  assert.equal(
    contracts.computeSkillCheckStatus(
      checks("conflict", "skill-target-content-conflict"),
    ),
    "blocked",
  );
  assert.equal(
    contracts.computeSkillCheckStatus(
      checks("unsafe", "skill-target-unsafe"),
    ),
    "blocked",
  );
  assert.throws(
    () =>
      contracts.computeSkillCheckStatus(
        checks("current", "skill-target-missing"),
      ),
    TypeError,
  );
});

test("skill report semantics reject unbound data and derived-state tampering", () => {
  const catalogEntries = entries();
  const catalogReport = {
    schemaVersion: "1.0.0",
    commandId: "skill.list",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest,
    project: {
      requestedPath: "D:\\games\\sample",
      canonicalPath: "D:\\games\\sample",
      identityDigest: projectIdentityDigest,
    },
    entries: catalogEntries,
    issues: [],
    summary: contracts.summarizeSkillCatalogEntries(catalogEntries),
    catalogDigest: contracts.computeSkillCatalogDigest({
      registryDigest,
      entries: catalogEntries,
    }),
    materializationAvailable: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  };
  assert.doesNotThrow(() =>
    contracts.assertSkillListReportSemantics(catalogReport),
  );
  assert.throws(
    () =>
      contracts.assertSkillListReportSemantics({
        ...catalogReport,
        project: { requestedPath: "D:\\games\\missing" },
      }),
    TypeError,
  );

  const observations = checks();
  const checkReport = {
    schemaVersion: "1.0.0",
    commandId: "skill.check",
    status: "ready",
    controlPlaneVersion: "0.0.0",
    registryDigest,
    project: catalogReport.project,
    checks: observations,
    issues: [],
    summary: contracts.summarizeSkillChecks(observations),
    checkDigest: contracts.computeSkillCheckDigest({
      registryDigest,
      projectIdentityDigest,
      checks: observations,
    }),
    materializationPerformed: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  };
  assert.doesNotThrow(() =>
    contracts.assertSkillCheckReportSemantics(checkReport),
  );
  assert.throws(
    () =>
      contracts.assertSkillCheckReportSemantics({
        ...checkReport,
        summary: { ...checkReport.summary, current: 0 },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertSkillCheckReportSemantics({
        ...checkReport,
        checkDigest: `sha256:${"d".repeat(64)}`,
      }),
    TypeError,
  );
});
