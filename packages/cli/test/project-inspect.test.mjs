import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as cli from "../dist/index.js";
import * as contracts from "@ai-game-playbook/contracts";

const request = (projectRoot) => ({
  schemaVersion: "1.0.0",
  projectRoot,
});

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-project-inspect-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { sandbox, project };
}

async function writeProjectFile(project, path, content) {
  const segments = path.split("/");
  const file = segments.pop();
  assert.notEqual(file, undefined);
  if (segments.length > 0) {
    await mkdir(join(project, ...segments), { recursive: true });
  }
  await writeFile(join(project, ...segments, file), content);
}

async function projectManifest(root) {
  const entries = [];
  async function visit(absolute, relative) {
    const directory = await opendir(absolute);
    const children = [];
    for await (const child of directory) {
      children.push(child.name);
    }
    children.sort();
    for (const name of children) {
      const childAbsolute = join(absolute, name);
      const childRelative = relative === "" ? name : `${relative}/${name}`;
      const stats = await lstat(childAbsolute);
      if (stats.isSymbolicLink()) {
        entries.push({
          path: childRelative,
          kind: "link",
          target: await readlink(childAbsolute),
        });
      } else if (stats.isDirectory()) {
        entries.push({ path: childRelative, kind: "directory" });
        await visit(childAbsolute, childRelative);
      } else if (stats.isFile()) {
        const content = await readFile(childAbsolute);
        entries.push({
          path: childRelative,
          kind: "file",
          bytes: content.byteLength,
          digest: contracts.sha256Digest(content),
        });
      } else {
        entries.push({ path: childRelative, kind: "other" });
      }
    }
  }
  await visit(root, "");
  return entries;
}

function profile({ engine, version, markerPath, markerDigest }) {
  const projectId = "sample.graybox";
  return {
    schemaVersion: "1.0.0",
    projectId,
    projectRoot: ".",
    engine: {
      id: engine,
      version,
      projectIdentityDigest: contracts.computeGameProjectIdentityDigest({
        projectId,
        engine: { id: engine, version },
      }),
    },
    stage: {
      declared: "vertical-slice",
      detected: "vertical-slice",
      effective: "vertical-slice",
      confidence: "high",
      evidence: [
        {
          locator: markerPath,
          grade: "implemented",
          digest: markerDigest,
        },
      ],
      reason: "A playable vertical slice is declared and implemented.",
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

async function writeCanonicalProfile(project, value) {
  await writeProjectFile(
    project,
    ".ai-game-playbook/profile.json",
    `${contracts.canonicalizeJson(value)}\n`,
  );
}

test("project inspection returns an unbound blocked report for an unavailable root", async (t) => {
  assert.equal(typeof cli.runProjectInspect, "function");
  const { sandbox } = await fixture(t);
  const missing = join(sandbox, "missing");

  const report = await cli.runProjectInspect(request(missing));

  assert.equal(report.status, "blocked");
  assert.deepEqual(report.project, { requestedPath: missing });
  assert.equal(report.engine.status, "not-inspected");
  assert.equal(report.profile.status, "not-inspected");
  assert.equal(report.dirtyState.status, "not-inspected");
  assert.equal(report.instances.status, "not-inspected");
  assert.equal(report.inspectionDigest, undefined);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.externalProcessStarted, false);
  assert.equal(report.networkAccessPerformed, false);
  assert.doesNotThrow(() =>
    contracts.assertProjectInspectReportSemantics(report),
  );
});

test("empty project inspection preserves unknowns and performs zero writes", async (t) => {
  const { project } = await fixture(t);
  const before = await projectManifest(project);

  const report = await cli.runProjectInspect(request(project));
  const after = await projectManifest(project);

  assert.equal(report.status, "attention");
  assert.equal(report.engine.status, "none");
  assert.equal(report.profile.status, "missing");
  assert.equal(report.dirtyState.status, "not-versioned");
  assert.equal(report.instances.status, "not-observed");
  assert.equal(report.instances.selectionAllowed, false);
  assert.match(report.inspectionDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(after, before);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.issues), true);
  assert.doesNotThrow(() =>
    contracts.assertProjectInspectReportSemantics(report),
  );
});

test("Godot marker, profile, and version-control marker remain static evidence", async (t) => {
  const { project } = await fixture(t);
  const godotText = [
    "; Engine configuration file.",
    "config_version=5",
    "",
    '[application]',
    'config/features=PackedStringArray("4.7", "GL Compatibility")',
    "",
  ].join("\n");
  await writeProjectFile(project, "project.godot", godotText);
  await mkdir(join(project, ".git"));
  const markerDigest = contracts.sha256Digest(Buffer.from(godotText));
  await writeCanonicalProfile(
    project,
    profile({
      engine: "godot",
      version: "4.7.2",
      markerPath: "project.godot",
      markerDigest,
    }),
  );
  const before = await projectManifest(project);

  const report = await cli.runProjectInspect(request(project));

  assert.equal(report.engine.status, "detected");
  assert.equal(report.engine.candidates[0].engine, "godot");
  assert.deepEqual(report.engine.candidates[0].version, {
    raw: "4.7",
    normalized: "4.7.0",
    precision: "major-minor",
  });
  assert.equal(report.profile.status, "valid");
  assert.equal(report.dirtyState.status, "unknown");
  assert.equal(report.dirtyState.source, "marker-only");
  assert.equal(report.dirtyState.markerPath, ".git");
  assert.equal(report.status, "attention");
  assert.deepEqual(await projectManifest(project), before);
});

test("Unity inspection distinguishes complete and partial strict markers", async (t) => {
  await t.test("complete project and unbound lock signal", async (t) => {
    const { project } = await fixture(t);
    await mkdir(join(project, "Assets"));
    await writeProjectFile(
      project,
      "ProjectSettings/ProjectVersion.txt",
      "m_EditorVersion: 6000.3.1f1\nm_EditorVersionWithRevision: 6000.3.1f1 (abc)\n",
    );
    await writeProjectFile(project, "Packages/manifest.json", "{}\n");
    await writeProjectFile(project, "Temp/UnityLockfile", "lock\n");
    const before = await projectManifest(project);

    const report = await cli.runProjectInspect(request(project));

    assert.equal(report.engine.status, "detected");
    assert.equal(report.engine.candidates[0].engine, "unity");
    assert.equal(report.engine.candidates[0].completeness, "complete");
    assert.deepEqual(report.engine.candidates[0].version, {
      raw: "6000.3.1f1",
      normalized: "6000.3.1",
      precision: "exact",
    });
    assert.equal(report.instances.status, "unbound-signal");
    assert.equal(report.instances.selectionAllowed, false);
    assert.deepEqual(report.instances.signals.map(({ path }) => path), [
      "Temp/UnityLockfile",
    ]);
    assert.deepEqual(await projectManifest(project), before);
  });

  await t.test("partial project does not promote malformed version text", async (t) => {
    const { project } = await fixture(t);
    await mkdir(join(project, "Assets"));
    await writeProjectFile(
      project,
      "ProjectSettings/ProjectVersion.txt",
      "m_EditorVersion: latest\n",
    );

    const report = await cli.runProjectInspect(request(project));

    assert.equal(report.engine.status, "partial");
    assert.equal(report.engine.candidates[0].engine, "unity");
    assert.equal(report.engine.candidates[0].completeness, "partial");
    assert.deepEqual(report.engine.candidates[0].version, {
      precision: "unknown",
    });
    assert.equal(
      report.issues.some(({ code }) => code === "unity-version-unrecognized"),
      true,
    );
  });
});

test("Unreal inspection preserves descriptor identity and refuses ambiguity", async (t) => {
  const { project } = await fixture(t);
  await writeProjectFile(
    project,
    "Sample.uproject",
    '{\n  "FileVersion": 3,\n  "EngineAssociation": "5.8"\n}\n',
  );
  let report = await cli.runProjectInspect(request(project));

  assert.equal(report.engine.status, "detected");
  assert.equal(report.engine.candidates[0].engine, "unreal");
  assert.deepEqual(report.engine.candidates[0].version, {
    raw: "5.8",
    normalized: "5.8.0",
    precision: "major-minor",
  });

  await writeProjectFile(
    project,
    "Second.uproject",
    '{"EngineAssociation":"5.8"}\n',
  );
  report = await cli.runProjectInspect(request(project));
  assert.equal(report.engine.status, "ambiguous");
  assert.equal(report.engine.candidates.length, 2);
  assert.equal(report.status, "blocked");
  assert.equal(report.summary.blockedIssues > 0, true);
});

test("simultaneous complete engine families are blocked without selection", async (t) => {
  const { project } = await fixture(t);
  await writeProjectFile(project, "project.godot", "config_version=5\n");
  await mkdir(join(project, "Assets"));
  await writeProjectFile(
    project,
    "ProjectSettings/ProjectVersion.txt",
    "m_EditorVersion: 6000.3.1f1\n",
  );
  await writeProjectFile(project, "Packages/manifest.json", "{}\n");

  const report = await cli.runProjectInspect(request(project));

  assert.equal(report.engine.status, "ambiguous");
  assert.deepEqual(report.engine.candidates.map(({ engine }) => engine), [
    "godot",
    "unity",
  ]);
  assert.equal(report.status, "blocked");
  assert.equal(report.mutationReady, false);
});

test("profile inspection distinguishes canonical validity, mismatch, and bounded invalid data", async (t) => {
  async function godotFixture(t) {
    const value = await fixture(t);
    const marker = 'config/features=PackedStringArray("4.7")\n';
    await writeProjectFile(value.project, "project.godot", marker);
    return {
      ...value,
      markerDigest: contracts.sha256Digest(Buffer.from(marker)),
    };
  }

  await t.test("valid portable identity", async (t) => {
    const { project, markerDigest } = await godotFixture(t);
    await writeCanonicalProfile(
      project,
      profile({
        engine: "godot",
        version: "4.7.2",
        markerPath: "project.godot",
        markerDigest,
      }),
    );
    const report = await cli.runProjectInspect(request(project));
    assert.equal(report.profile.status, "valid");
    assert.match(report.profile.fileDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(report.profile.candidateDigest, /^sha256:[0-9a-f]{64}$/);
  });

  await t.test("marker version mismatch", async (t) => {
    const { project, markerDigest } = await godotFixture(t);
    await writeCanonicalProfile(
      project,
      profile({
        engine: "godot",
        version: "4.8.0",
        markerPath: "project.godot",
        markerDigest,
      }),
    );
    const report = await cli.runProjectInspect(request(project));
    assert.equal(report.profile.status, "mismatch");
    assert.equal(report.status, "blocked");
  });

  await t.test("marker engine mismatch", async (t) => {
    const { project, markerDigest } = await godotFixture(t);
    await writeCanonicalProfile(
      project,
      profile({
        engine: "unity",
        version: "6000.3.1",
        markerPath: "project.godot",
        markerDigest,
      }),
    );
    const report = await cli.runProjectInspect(request(project));
    assert.equal(report.profile.status, "mismatch");
    assert.equal(report.status, "blocked");
  });

  await t.test("invalid portable identity digest", async (t) => {
    const { project, markerDigest } = await godotFixture(t);
    const invalid = profile({
      engine: "godot",
      version: "4.7.2",
      markerPath: "project.godot",
      markerDigest,
    });
    invalid.engine.projectIdentityDigest = `sha256:${"0".repeat(64)}`;
    await writeCanonicalProfile(project, invalid);
    const report = await cli.runProjectInspect(request(project));
    assert.equal(report.profile.status, "invalid");
    assert.equal(report.status, "blocked");
    assert.equal(
      report.issues.some(({ code }) => code === "profile-identity-invalid"),
      true,
    );
  });

  for (const [name, content, hasDigest] of [
    ["malformed JSON", "{not-json}\n", true],
    ["noncanonical JSON", '{\n  "schemaVersion": "1.0.0"\n}\n', true],
    [
      "schema-invalid JSON",
      `${contracts.canonicalizeJson({ schemaVersion: "1.0.0" })}\n`,
      true,
    ],
    ["oversized JSON", `{"padding":"${"x".repeat(1_048_576)}"}\n`, false],
  ]) {
    await t.test(name, async (t) => {
      const { project } = await godotFixture(t);
      await writeProjectFile(project, ".ai-game-playbook/profile.json", content);
      const before = await projectManifest(project);

      const report = await cli.runProjectInspect(request(project));

      assert.equal(report.profile.status, "invalid");
      assert.equal(report.status, "blocked");
      assert.equal(report.profile.fileDigest !== undefined, hasDigest);
      assert.deepEqual(await projectManifest(project), before);
    });
  }
});
