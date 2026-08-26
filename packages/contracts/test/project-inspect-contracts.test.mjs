import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const registryDigest = `sha256:${"a".repeat(64)}`;
const rootIdentityDigest = `sha256:${"b".repeat(64)}`;
const markerDigest = `sha256:${"c".repeat(64)}`;
const profileFileDigest = `sha256:${"d".repeat(64)}`;

function profile() {
  const projectId = "sample.graybox";
  const engine = { id: "godot", version: "4.7.2" };
  return {
    schemaVersion: "1.0.0",
    projectId,
    projectRoot: ".",
    engine: {
      ...engine,
      projectIdentityDigest: contracts.computeGameProjectIdentityDigest({
        projectId,
        engine,
      }),
    },
    stage: {
      declared: "vertical-slice",
      detected: "vertical-slice",
      effective: "vertical-slice",
      confidence: "high",
      evidence: [
        {
          locator: "project.godot",
          grade: "implemented",
          digest: markerDigest,
        },
      ],
      reason: "The project declares a playable vertical slice.",
    },
    teamSize: 1,
    gameShape: "offline-single-player-3d",
    targets: [
      {
        platform: "windows",
        architecture: "x64",
        configuration: "development",
      },
    ],
    budgets: {
      maxChangedFiles: 24,
      maxChangedBytes: 262144,
      maxDurationMs: 900000,
      maxOutputBytes: 4194304,
      maxRepairCycles: 3,
    },
    coreLoop: ["move", "collect", "win"],
    pillars: ["responsive movement", "clear feedback"],
    exclusions: ["multiplayer", "web export"],
  };
}

function engineCandidate() {
  const subject = {
    engine: "godot",
    completeness: "complete",
    markers: [
      {
        path: "project.godot",
        kind: "file",
        digest: markerDigest,
      },
    ],
    version: {
      raw: "4.7",
      normalized: "4.7.0",
      precision: "major-minor",
    },
  };
  return {
    ...subject,
    observationDigest:
      contracts.computeProjectEngineCandidateDigest(subject),
  };
}

function reportFields() {
  const candidateProfile = profile();
  const engine = {
    status: "detected",
    candidates: [engineCandidate()],
  };
  const profileAssessment = {
    status: "valid",
    path: ".ai-game-playbook/profile.json",
    fileDigest: profileFileDigest,
    candidateDigest: contracts.digestCanonicalJson(candidateProfile),
    candidate: candidateProfile,
    reason: "The committed profile is canonical and matches the engine marker.",
  };
  const dirtyState = {
    status: "unknown",
    source: "marker-only",
    markerPath: ".git",
    reason: "A version-control marker exists but no trusted status observer ran.",
  };
  const instances = {
    status: "not-observed",
    selectionAllowed: false,
    signals: [],
    reason: "No host process observer ran during static inspection.",
  };
  const issues = [
    {
      severity: "attention",
      code: "dirty-state-unknown",
      message: "The working tree state was not observed.",
      nextAction: "Inspect the working tree with a trusted version-control tool.",
    },
    {
      severity: "attention",
      code: "instance-state-not-observed",
      message: "Editor and runtime processes were not observed.",
      nextAction: "Use an approved host observer before binding an engine session.",
    },
  ];
  return {
    project: {
      requestedPath: "D:\\games\\sample",
      canonicalPath: "D:\\games\\sample",
      rootIdentityDigest,
    },
    engine,
    profile: profileAssessment,
    dirtyState,
    instances,
    issues,
  };
}

function report() {
  const fields = reportFields();
  const summary = contracts.summarizeProjectInspection(fields);
  return {
    schemaVersion: "1.0.0",
    commandId: "project.inspect",
    status: contracts.computeProjectInspectionStatus(summary),
    controlPlaneVersion: "0.0.0",
    registryDigest,
    ...fields,
    summary,
    inspectionDigest: contracts.computeProjectInspectionDigest({
      registryDigest,
      projectIdentityDigest: rootIdentityDigest,
      engine: fields.engine,
      profile: fields.profile,
      dirtyState: fields.dirtyState,
      instances: fields.instances,
      issues: fields.issues,
    }),
    mutationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  };
}

test("project inspection request and report schemas are versioned, closed, and read-only", () => {
  assert.equal(contracts.projectInspectRequestSchema.id, "project-inspect-request");
  assert.equal(contracts.projectInspectReportSchema.id, "project-inspect-report");
  assert.equal(
    contracts.projectInspectRequestSchema.schema.additionalProperties,
    false,
  );
  assert.equal(
    contracts.projectInspectReportSchema.schema.additionalProperties,
    false,
  );
  assert.deepEqual(
    contracts.projectInspectReportSchema.schema.properties.status.enum,
    ["ready", "attention", "blocked"],
  );
  assert.equal(
    contracts.projectInspectReportSchema.schema.properties.mutationPerformed
      .const,
    false,
  );
  assert.equal(
    contracts.projectInspectReportSchema.schema.properties.externalProcessStarted
      .const,
    false,
  );
  assert.equal(
    contracts.projectInspectReportSchema.schema.properties.networkAccessPerformed
      .const,
    false,
  );
});

test("portable game project identity binds the project ID and declared engine", () => {
  const input = {
    projectId: "sample.graybox",
    engine: { id: "godot", version: "4.7.2" },
  };
  const digest = contracts.computeGameProjectIdentityDigest(input);

  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    digest,
    contracts.computeGameProjectIdentityDigest(structuredClone(input)),
  );
  assert.notEqual(
    digest,
    contracts.computeGameProjectIdentityDigest({
      ...input,
      engine: { ...input.engine, version: "4.7.3" },
    }),
  );
  assert.throws(
    () =>
      contracts.computeGameProjectIdentityDigest({
        ...input,
        undeclared: true,
      }),
    TypeError,
  );
});

test("engine observations and report digests bind ordered exact evidence", () => {
  const candidate = engineCandidate();
  const { observationDigest: _, ...candidateSubject } = candidate;
  const fields = reportFields();
  const first = contracts.computeProjectInspectionDigest({
    registryDigest,
    projectIdentityDigest: rootIdentityDigest,
    engine: fields.engine,
    profile: fields.profile,
    dirtyState: fields.dirtyState,
    instances: fields.instances,
    issues: fields.issues,
  });

  assert.match(candidate.observationDigest, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(
    candidate.observationDigest,
    contracts.computeProjectEngineCandidateDigest({
      ...candidateSubject,
      markers: [
        {
          ...candidate.markers[0],
          digest: `sha256:${"e".repeat(64)}`,
        },
      ],
    }),
  );
  assert.equal(
    first,
    contracts.computeProjectInspectionDigest(structuredClone({
      registryDigest,
      projectIdentityDigest: rootIdentityDigest,
      engine: fields.engine,
      profile: fields.profile,
      dirtyState: fields.dirtyState,
      instances: fields.instances,
      issues: fields.issues,
    })),
  );
  assert.notEqual(
    first,
    contracts.computeProjectInspectionDigest({
      registryDigest,
      projectIdentityDigest: rootIdentityDigest,
      engine: fields.engine,
      profile: fields.profile,
      dirtyState: fields.dirtyState,
      instances: fields.instances,
      issues: [...fields.issues].reverse(),
    }),
  );
});

test("inspection summary and status preserve attention and blocked ambiguity", () => {
  const fields = reportFields();
  const summary = contracts.summarizeProjectInspection(fields);

  assert.deepEqual(summary, {
    engineCandidates: 1,
    completeEngineCandidates: 1,
    attentionIssues: 2,
    blockedIssues: 0,
  });
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(contracts.computeProjectInspectionStatus(summary), "attention");
  assert.equal(
    contracts.computeProjectInspectionStatus({
      ...summary,
      attentionIssues: 0,
      blockedIssues: 1,
    }),
    "blocked",
  );
  assert.equal(
    contracts.computeProjectInspectionStatus({
      ...summary,
      attentionIssues: 0,
    }),
    "ready",
  );

  const unrealSubject = {
    engine: "unreal",
    completeness: "complete",
    markers: [
      {
        path: "Sample.uproject",
        kind: "file",
        digest: `sha256:${"e".repeat(64)}`,
      },
    ],
    version: {
      raw: "5.8",
      normalized: "5.8.0",
      precision: "major-minor",
    },
  };
  const ambiguousFields = {
    ...fields,
    engine: {
      status: "ambiguous",
      candidates: [
        ...fields.engine.candidates,
        {
          ...unrealSubject,
          observationDigest:
            contracts.computeProjectEngineCandidateDigest(unrealSubject),
        },
      ],
    },
    issues: [
      {
        severity: "blocked",
        code: "engine-project-ambiguous",
        message: "More than one engine project candidate was found.",
        nextAction: "Select a root containing exactly one game project.",
      },
    ],
  };
  const ambiguous = contracts.summarizeProjectInspection(ambiguousFields);
  assert.deepEqual(ambiguous, {
    engineCandidates: 2,
    completeEngineCandidates: 2,
    attentionIssues: 0,
    blockedIssues: 1,
  });
  assert.equal(contracts.computeProjectInspectionStatus(ambiguous), "blocked");
});

test("project inspection report semantics reject derived-state contradictions", () => {
  const valid = report();

  assert.doesNotThrow(() =>
    contracts.assertProjectInspectReportSemantics(valid),
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...valid,
        status: "ready",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...valid,
        summary: { ...valid.summary, attentionIssues: 1 },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...valid,
        profile: {
          ...valid.profile,
          candidateDigest: `sha256:${"f".repeat(64)}`,
        },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...valid,
        inspectionDigest: `sha256:${"0".repeat(64)}`,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...valid,
        mutationReady: true,
      }),
    TypeError,
  );
});

test("unbound inspection reports cannot carry observations or an attested digest", () => {
  const fields = {
    project: { requestedPath: "D:\\games\\missing" },
    engine: { status: "not-inspected", candidates: [] },
    profile: {
      status: "not-inspected",
      path: ".ai-game-playbook/profile.json",
      reason: "The project root is unavailable.",
    },
    dirtyState: {
      status: "not-inspected",
      source: "none",
      reason: "The project root is unavailable.",
    },
    instances: {
      status: "not-inspected",
      selectionAllowed: false,
      signals: [],
      reason: "The project root is unavailable.",
    },
    issues: [
      {
        severity: "blocked",
        code: "project-root-unavailable",
        message: "The selected project root is unavailable.",
        nextAction: "Select one existing local game project directory.",
      },
    ],
  };
  const summary = contracts.summarizeProjectInspection(fields);
  const unbound = {
    schemaVersion: "1.0.0",
    commandId: "project.inspect",
    status: "blocked",
    controlPlaneVersion: "0.0.0",
    registryDigest,
    ...fields,
    summary,
    mutationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
  };

  assert.doesNotThrow(() =>
    contracts.assertProjectInspectReportSemantics(unbound),
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...unbound,
        inspectionDigest: `sha256:${"1".repeat(64)}`,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.assertProjectInspectReportSemantics({
        ...unbound,
        project: {
          ...unbound.project,
          canonicalPath: "D:\\games\\missing",
        },
      }),
    TypeError,
  );
});
