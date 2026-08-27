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

import {
  PACK_INSPECTION_MAX_DECLARED_BYTES,
  canonicalizeJson,
  parseStableId,
  sha256Digest,
} from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as packRuntime from "../dist/index.js";
import {
  createActivePackTransactionRecord,
  writeActivePackTransactionRecord,
} from "../dist/active-transaction.js";
import { createPackDirectoryOwnershipMarker } from "../dist/directory-ownership.js";
import { createStartedPackTransaction } from "../dist/transaction-journal.js";

const packDigest = `sha256:${"a".repeat(64)}`;
const secondDigest = `sha256:${"b".repeat(64)}`;
const runId = "11111111-1111-4111-8111-111111111111";
const authorizationId = "22222222-2222-4222-8222-222222222222";

async function fixture(t, initialize = true) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-pack-inspection-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  const root = await core.canonicalizeProjectRoot(project);
  if (initialize) await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root };
}

async function treeSnapshot(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const snapshot = [];
  for (const entry of entries) {
    const parent = entry.parentPath.slice(root.length + 1);
    const path = parent.length === 0 ? entry.name : join(parent, entry.name);
    snapshot.push({
      path,
      kind: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
      content: entry.isFile()
        ? await readFile(join(root, path), "base64")
        : undefined,
    });
  }
  return snapshot.sort((left, right) => left.path.localeCompare(right.path));
}

function statePath(project) {
  return join(
    project,
    ...packRuntime.PACK_INSTALLED_STATE_PATH.split("/"),
  );
}

async function writeInstalledState(
  fixtureValue,
  { content = Buffer.from("managed artifact\n", "utf8"), directory = false } = {},
) {
  const id = parseStableId("pack.sample");
  const artifactPath = directory
    ? "addons/sample/artifact.txt"
    : "managed/artifact.txt";
  const artifactNative = join(fixtureValue.project, ...artifactPath.split("/"));
  await mkdir(join(artifactNative, ".."), { recursive: true });
  await writeFile(artifactNative, content);
  const directories = [];
  if (directory) {
    const marker = createPackDirectoryOwnershipMarker(
      { id, digest: packDigest },
      "addons/sample",
    );
    await writeFile(
      join(fixtureValue.project, ...marker.descriptor.path.split("/")),
      marker.content,
    );
    directories.push(marker.descriptor);
  }
  const record = {
    id,
    version: "1.2.3",
    digest: packDigest,
    dependencies: [],
    artifacts: [
      {
        path: artifactPath,
        digest: sha256Digest(content),
        bytes: content.byteLength,
      },
    ],
    directories,
    installedAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
  };
  const body = {
    schemaVersion: "1.1.0",
    project: {
      id: parseStableId("project.sample"),
      identityDigest: fixtureValue.root.identityDigest,
    },
    revision: 1,
    packs: [record],
  };
  const state = {
    ...body,
    stateDigest: packRuntime.computeInstalledPackStateDigest(body),
  };
  await writeFile(statePath(fixtureValue.project), `${canonicalizeJson(state)}\n`);
  return { artifactNative, artifactPath, directories, record, state };
}

async function writeMarkerOnlyTransaction(fixtureValue) {
  const empty = packRuntime.createEmptyInstalledPackState({
    id: parseStableId("project.sample"),
    identityDigest: fixtureValue.root.identityDigest,
  });
  const plan = {
    schemaVersion: "1.0.0",
    operation: "add",
    disposition: "ready",
    runId,
    project: {
      id: parseStableId("project.sample"),
      identityDigest: fixtureValue.root.identityDigest,
      rootIdentityDigest: fixtureValue.root.identityDigest,
    },
    registryDigest: secondDigest,
    pack: {
      id: parseStableId("pack.sample"),
      version: "1.2.3",
      digest: packDigest,
    },
    installedState: {
      revision: 0,
      digest: empty.stateDigest,
    },
    limits: {
      maxArtifactBytes: 1_024,
      maxTotalBytes: 1_024,
      maxDirectoryEntries: 1_000,
    },
    directoryChanges: [],
    changes: [],
    conflicts: [],
    planDigest: secondDigest,
  };
  const started = createStartedPackTransaction({
    plan,
    authorizationId,
    requestDigest: packDigest,
    installedStateAfter: {
      revision: 1,
      digest: packDigest,
      fileDigest: secondDigest,
    },
    startedAt: "2026-08-27T00:00:00.000Z",
  });
  const active = createActivePackTransactionRecord(started);
  await writeActivePackTransactionRecord({
    root: fixtureValue.root,
    record: active,
    maxDirectoryEntries: 1_000,
  });
  return active;
}

test("pack inspection handlers expose one immutable request boundary", () => {
  assert.equal(typeof packRuntime.runPackList, "function");
  assert.equal(typeof packRuntime.runPackDoctor, "function");
  assert.equal(packRuntime.runPackList.length, 1);
  assert.equal(packRuntime.runPackDoctor.length, 1);
});

test("pack inspection requests reject source selection and repair authority", async (t) => {
  const f = await fixture(t);
  await assert.rejects(() =>
    packRuntime.runPackList({
      schemaVersion: "1.0.0",
      projectRoot: f.project,
      sourceRoot: "D:\\packs",
    }),
  );
  await assert.rejects(() =>
    packRuntime.runPackDoctor({
      schemaVersion: "1.0.0",
      projectRoot: f.project,
      repair: true,
    }),
  );
});

test("pack list preserves uninitialized and initialized-empty states without writes", async (t) => {
  const uninitialized = await fixture(t, false);
  const beforeUninitialized = await treeSnapshot(uninitialized.project);
  const first = await packRuntime.runPackList({
    schemaVersion: "1.0.0",
    projectRoot: uninitialized.project,
  });
  assert.equal(first.status, "attention");
  assert.equal(first.project.state, "uninitialized");
  assert.equal(first.installedState.status, "not-inspected");
  assert.deepEqual(first.entries, []);
  assert.equal(first.mutationPerformed, false);
  assert.deepEqual(await treeSnapshot(uninitialized.project), beforeUninitialized);

  const initialized = await fixture(t);
  const beforeInitialized = await treeSnapshot(initialized.project);
  const second = await packRuntime.runPackList({
    schemaVersion: "1.0.0",
    projectRoot: initialized.project,
  });
  assert.equal(second.status, "ready");
  assert.equal(second.installedState.status, "empty");
  assert.equal(second.summary.installedPacks, 0);
  assert.deepEqual(await treeSnapshot(initialized.project), beforeInitialized);
});

test("pack list returns identity and counts without artifact paths or content", async (t) => {
  const f = await fixture(t);
  const installed = await writeInstalledState(f);
  const before = await treeSnapshot(f.project);

  const report = await packRuntime.runPackList({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });

  assert.equal(report.status, "ready");
  assert.equal(report.installedState.status, "present");
  assert.deepEqual(report.entries, [
    {
      id: "pack.sample",
      version: "1.2.3",
      digest: packDigest,
      dependencyCount: 0,
      artifactCount: 1,
      artifactBytes: installed.record.artifacts[0].bytes,
      ownedDirectoryCount: 0,
      installedAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-27T00:01:00.000Z",
    },
  ]);
  const serialized = canonicalizeJson(report);
  assert.equal(serialized.includes(installed.artifactPath), false);
  assert.equal(serialized.includes("managed artifact"), false);
  assert.equal(report.artifactContentExposed, false);
  assert.equal(report.sourceLocationExposed, false);
  assert.deepEqual(await treeSnapshot(f.project), before);
});

test("pack list blocks malformed installed state and surviving transaction markers", async (t) => {
  const corrupt = await fixture(t);
  await writeFile(statePath(corrupt.project), '{"invalid":true}\n');
  const malformed = await packRuntime.runPackList({
    schemaVersion: "1.0.0",
    projectRoot: corrupt.project,
  });
  assert.equal(malformed.status, "blocked");
  assert.equal(malformed.installedState.status, "invalid");
  assert.deepEqual(malformed.entries, []);

  const active = await fixture(t);
  await writeMarkerOnlyTransaction(active);
  const before = await treeSnapshot(active.project);
  const blocked = await packRuntime.runPackList({
    schemaVersion: "1.0.0",
    projectRoot: active.project,
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(
    blocked.issues.some(({ code }) => code === "pack-transaction-present"),
    true,
  );
  assert.deepEqual(await treeSnapshot(active.project), before);
});

test("pack doctor verifies owned artifacts and blocks missing or modified bytes", async (t) => {
  const f = await fixture(t);
  const installed = await writeInstalledState(f);
  const before = await treeSnapshot(f.project);

  const current = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });
  assert.equal(current.status, "attention");
  assert.equal(current.packs[0].registryStatus, "unavailable");
  assert.equal(current.packs[0].integrityStatus, "current");
  assert.equal(current.summary.currentArtifacts, 1);
  assert.deepEqual(await treeSnapshot(f.project), before);

  await writeFile(installed.artifactNative, "modified artifact\n");
  const modified = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });
  assert.equal(modified.status, "blocked");
  assert.equal(modified.packs[0].integrityStatus, "drifted");
  assert.equal(modified.summary.modifiedArtifacts, 1);

  await rm(installed.artifactNative);
  const missing = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });
  assert.equal(missing.status, "blocked");
  assert.equal(missing.summary.missingArtifacts, 1);
});

test("pack doctor verifies owned directory markers without exposing their bytes", async (t) => {
  const f = await fixture(t);
  const installed = await writeInstalledState(f, { directory: true });
  const markerNative = join(
    f.project,
    ...installed.directories[0].path.split("/"),
  );

  const current = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });
  assert.equal(current.packs[0].directories.current, 1);
  assert.equal(current.artifactContentExposed, false);

  await writeFile(markerNative, "modified marker\n");
  const modified = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });
  assert.equal(modified.status, "blocked");
  assert.equal(modified.packs[0].directories.modified, 1);
});

test("pack doctor stops before path reads when declared bytes exceed its budget", async (t) => {
  const f = await fixture(t);
  const bytes = Math.floor(PACK_INSPECTION_MAX_DECLARED_BYTES / 2) + 1;
  const record = {
    id: parseStableId("pack.sample"),
    version: "1.2.3",
    digest: packDigest,
    dependencies: [],
    artifacts: [
      { path: "managed/a.bin", digest: packDigest, bytes },
      { path: "managed/b.bin", digest: secondDigest, bytes },
    ],
    directories: [],
    installedAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z",
  };
  const body = {
    schemaVersion: "1.1.0",
    project: {
      id: parseStableId("project.sample"),
      identityDigest: f.root.identityDigest,
    },
    revision: 1,
    packs: [record],
  };
  const state = {
    ...body,
    stateDigest: packRuntime.computeInstalledPackStateDigest(body),
  };
  await writeFile(statePath(f.project), `${canonicalizeJson(state)}\n`);
  const before = await treeSnapshot(f.project);

  const report = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.packs[0].integrityStatus, "not-inspected");
  assert.equal(report.summary.declaredArtifacts, 2);
  assert.equal(report.summary.currentArtifacts, 0);
  assert.equal(
    report.findings.some(
      ({ code }) => code === "pack-inspection-budget-exceeded",
    ),
    true,
  );
  assert.deepEqual(await treeSnapshot(f.project), before);
});

test("pack doctor summarizes marker-only recovery without finalizing it", async (t) => {
  const f = await fixture(t);
  await writeMarkerOnlyTransaction(f);
  const before = await treeSnapshot(f.project);

  const report = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.transaction.status, "recovery-required");
  assert.equal(report.transaction.runId, runId);
  assert.equal(report.transaction.recovery.stable, true);
  assert.equal(report.transaction.recovery.consistency, "incomplete");
  assert.equal(report.transaction.recovery.observedState, "preimage");
  assert.equal(
    report.transaction.recovery.finalizationAction,
    "append-started-and-terminal",
  );
  assert.equal(report.recoveryFinalizationPerformed, false);
  assert.equal(report.mutationPerformed, false);
  assert.deepEqual(await treeSnapshot(f.project), before);
});

test("pack doctor blocks malformed markers without attempting recovery", async (t) => {
  const f = await fixture(t);
  await writeInstalledState(f);
  const activePath = join(
    f.project,
    ...packRuntime.PACK_ACTIVE_TRANSACTION_PATH.split("/"),
  );
  await writeFile(activePath, '{"transaction":"malformed"}\n');
  const before = await treeSnapshot(f.project);

  const report = await packRuntime.runPackDoctor({
    schemaVersion: "1.0.0",
    projectRoot: f.project,
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.transaction.status, "invalid");
  assert.equal(report.packs[0].integrityStatus, "not-inspected");
  assert.equal(report.summary.currentArtifacts, 0);
  assert.equal(report.recoveryFinalizationPerformed, false);
  assert.deepEqual(await treeSnapshot(f.project), before);
});
