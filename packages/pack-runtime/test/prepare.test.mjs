import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";
import * as packRuntime from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const runId = "018f6f35-2c9e-7d1a-8a4b-123456789abd";
const projectIdentityDigest = `sha256:${"c".repeat(64)}`;

function currentOperatingSystem() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function manifest({ content, version = "1.0.0", overrides = {} }) {
  const artifactDigest = contracts.sha256Digest(content);
  const value = {
    schemaVersion: "1.0.0",
    id: "tool.local-demo",
    version,
    kind: "integration",
    lifecycle: "experimental",
    compatibility: {
      controlPlane: { minimum: "0.0.0", maximumExclusive: "1.0.0" },
      operatingSystems: [currentOperatingSystem()],
      engines: [],
      hosts: [],
    },
    provides: {
      commands: [],
      skills: [],
      workflows: [],
      capabilities: [],
      schemas: [],
    },
    dependencies: [],
    permissions: [],
    network: { required: false, destinations: [] },
    artifacts: [
      {
        source: "dist/demo.txt",
        target: ".ai-game-playbook/packs/local-demo/demo.txt",
        digest: artifactDigest,
        mode: "file",
      },
    ],
    ownedPaths: [
      {
        path: ".ai-game-playbook/packs/local-demo/demo.txt",
        kind: "file",
        digest: artifactDigest,
      },
    ],
    lifecycleHooks: {},
    license: { status: "unresolved" },
    ...overrides,
  };
  value.digest = contracts.computePackManifestDigest(value);
  return value;
}

function validatedRegistry(...packs) {
  const definition = createValidRegistryDefinition();
  definition.packs.push(...packs);
  return registry.validateRegistry(definition);
}

async function fixture(t, content = "pack payload\n") {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-pack-prepare-"));
  const project = join(sandbox, "project");
  const source = join(sandbox, "source");
  await mkdir(join(project, ".ai-game-playbook", "packs", "local-demo"), {
    recursive: true,
  });
  await mkdir(join(source, "dist"), { recursive: true });
  await writeFile(join(source, "dist", "demo.txt"), content, "utf8");
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    content,
    project,
    source,
    target: join(
      project,
      ".ai-game-playbook",
      "packs",
      "local-demo",
      "demo.txt",
    ),
    targetRoot: await core.canonicalizeProjectRoot(project),
    sourceRoot: await core.canonicalizeProjectRoot(source),
  };
}

function request(f, pack, overrides = {}) {
  const value = {
    operation: "add",
    registry: validatedRegistry(pack),
    targetRoot: f.targetRoot,
    sourceRoot: f.sourceRoot,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    runId,
    packId: pack.id,
    limits: {
      maxArtifactBytes: 1024,
      maxTotalBytes: 4096,
      maxDirectoryEntries: 1000,
    },
    ...overrides,
  };
  if (value.operation === "remove") delete value.sourceRoot;
  return value;
}

async function writeInstalledState(f, packs) {
  const directory = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
  );
  await mkdir(directory, { recursive: true });
  const body = {
    schemaVersion: "1.0.0",
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
    },
    revision: 1,
    packs,
  };
  const state = {
    ...body,
    stateDigest: packRuntime.computeInstalledPackStateDigest(body),
  };
  const content = `${contracts.canonicalizeJson(state)}\n`;
  const path = join(directory, "installed.json");
  await writeFile(path, content, "utf8");
  return { path, content, digest: contracts.sha256Digest(content) };
}

function installedPack(pack, content, overrides = {}) {
  return {
    id: pack.id,
    version: pack.version,
    digest: pack.digest,
    dependencies: [],
    artifacts: [
      {
        path: pack.artifacts[0].target,
        digest: contracts.sha256Digest(content),
        bytes: Buffer.byteLength(content),
      },
    ],
    installedAt: "2026-08-26T06:00:00.000Z",
    updatedAt: "2026-08-26T06:00:00.000Z",
    ...overrides,
  };
}

function expectPackError(code) {
  return (error) => error?.name === "PackRuntimeError" && error?.code === code;
}

test("clean local add prepares an immutable write-free pack plan", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });

  assert.equal(typeof packRuntime.preparePackOperation, "function");
  assert.equal(typeof packRuntime.assertPreparedPackOperation, "function");
  const prepared = await packRuntime.preparePackOperation(request(f, pack));

  assert.equal(prepared.schemaVersion, "1.0.0");
  assert.equal(prepared.operation, "add");
  assert.equal(prepared.disposition, "ready");
  assert.equal(prepared.registryDigest, request(f, pack).registry.digest);
  assert.deepEqual(prepared.pack, {
    id: pack.id,
    version: pack.version,
    digest: pack.digest,
  });
  assert.deepEqual(prepared.changes, [
    {
      kind: "create",
      path: ".ai-game-playbook/packs/local-demo/demo.txt",
      afterDigest: contracts.sha256Digest(f.content),
      bytes: Buffer.byteLength(f.content),
    },
  ]);
  assert.deepEqual(prepared.conflicts, []);
  assert.equal(contracts.isSha256Digest(prepared.planDigest), true);
  assert.equal(Object.isFrozen(prepared), true);
  assert.doesNotThrow(() => packRuntime.assertPreparedPackOperation(prepared));
  assert.throws(
    () => packRuntime.assertPreparedPackOperation(structuredClone(prepared)),
    expectPackError("pack-plan-untrusted"),
  );

  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
  await assert.rejects(
    readFile(join(f.project, ".ai-game-playbook", "state", "packs", "installed.json")),
    (error) => error?.code === "ENOENT",
  );
  const serialized = JSON.stringify(prepared);
  assert.equal(serialized.includes(f.project), false);
  assert.equal(serialized.includes(f.source), false);
  assert.equal(serialized.includes(f.content), false);
});

test("preflight rejects artifact digest drift without touching the project", async (t) => {
  const f = await fixture(t, "tampered payload\n");
  const pack = manifest({ content: "expected payload\n" });

  await assert.rejects(
    packRuntime.preparePackOperation(request(f, pack)),
    expectPackError("pack-artifact-digest-mismatch"),
  );
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
});

test("preflight reports a non-owned target collision and preserves it", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  await writeFile(f.target, "user-owned\n", "utf8");

  const prepared = await packRuntime.preparePackOperation(request(f, pack));

  assert.equal(prepared.disposition, "conflicted");
  assert.deepEqual(prepared.changes, []);
  assert.deepEqual(prepared.conflicts, [
    {
      code: "non-owned-target",
      path: ".ai-game-playbook/packs/local-demo/demo.txt",
      actualDigest: contracts.sha256Digest("user-owned\n"),
    },
  ]);
  assert.equal(await readFile(f.target, "utf8"), "user-owned\n");
});

test("preflight rejects unvalidated authority and unsupported executable surfaces", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  const plainRegistry = createValidRegistryDefinition();
  plainRegistry.packs.push(pack);

  await assert.rejects(
    packRuntime.preparePackOperation({
      ...request(f, pack),
      registry: plainRegistry,
    }),
    expectPackError("pack-registry-untrusted"),
  );

  const hooked = manifest({
    content: f.content,
    overrides: {
      permissions: ["read-project"],
      lifecycleHooks: { install: "project.inspect" },
    },
  });
  await assert.rejects(
    packRuntime.preparePackOperation(request(f, hooked)),
    expectPackError("pack-surface-unsupported"),
  );
});

test("preflight reserves control-plane state and lock namespaces", async (t) => {
  const f = await fixture(t);
  for (const reservedTarget of [
    ".ai-game-playbook/state/packs/installed.json",
    ".ai-game-playbook/locks/project-mutation.lock",
    ".AI-GAME-PLAYBOOK/STATE/packs/installed.json",
  ]) {
    const pack = manifest({
      content: f.content,
      overrides: {
        artifacts: [
          {
            source: "dist/demo.txt",
            target: reservedTarget,
            digest: contracts.sha256Digest(f.content),
            mode: "file",
          },
        ],
        ownedPaths: [
          {
            path: reservedTarget,
            kind: "file",
            digest: contracts.sha256Digest(f.content),
          },
        ],
      },
    });

    await assert.rejects(
      packRuntime.preparePackOperation(request(f, pack)),
      expectPackError("pack-surface-unsupported"),
    );
  }
});

test("same manifest and clean owned hashes prepare a write-free reinstall", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  await writeFile(f.target, f.content, "utf8");
  const state = await writeInstalledState(f, [installedPack(pack, f.content)]);

  const prepared = await packRuntime.preparePackOperation(request(f, pack));

  assert.equal(prepared.disposition, "no-op");
  assert.equal(prepared.installedState.fileDigest, state.digest);
  assert.deepEqual(prepared.changes, [
    {
      kind: "unchanged",
      path: pack.artifacts[0].target,
      beforeDigest: contracts.sha256Digest(f.content),
      afterDigest: contracts.sha256Digest(f.content),
      bytes: Buffer.byteLength(f.content),
    },
  ]);
  assert.equal(await readFile(state.path, "utf8"), state.content);
  assert.equal(await readFile(f.target, "utf8"), f.content);
});

test("exact version update plans a replacement and preserves its rollback preimage", async (t) => {
  const oldContent = "old payload\n";
  const newContent = "new payload\n";
  const f = await fixture(t, newContent);
  const oldPack = manifest({ content: oldContent, version: "1.0.0" });
  const newPack = manifest({ content: newContent, version: "1.1.0" });
  await writeFile(f.target, oldContent, "utf8");
  await writeInstalledState(f, [installedPack(oldPack, oldContent)]);

  const prepared = await packRuntime.preparePackOperation(
    request(f, newPack, { operation: "update" }),
  );

  assert.equal(prepared.disposition, "ready");
  assert.deepEqual(prepared.changes, [
    {
      kind: "replace",
      path: newPack.artifacts[0].target,
      beforeDigest: contracts.sha256Digest(oldContent),
      afterDigest: contracts.sha256Digest(newContent),
      bytes: Buffer.byteLength(newContent),
    },
  ]);
  assert.equal(await readFile(f.target, "utf8"), oldContent);
});

test("single-pack update refuses to invalidate an installed dependent", async (t) => {
  const f = await fixture(t, "version one\n");
  const installed = manifest({ content: f.content, version: "1.0.0" });
  const nextContent = "version two\n";
  const nextPack = manifest({ content: nextContent, version: "2.0.0" });
  const dependentContent = "dependent payload\n";
  const dependentTarget = ".ai-game-playbook/packs/dependent/demo.txt";
  const dependent = manifest({
    content: dependentContent,
    overrides: {
      id: "tool.dependent",
      dependencies: [
        {
          id: nextPack.id,
          minimum: "2.0.0",
          maximumExclusive: "3.0.0",
          optional: false,
        },
      ],
      artifacts: [
        {
          source: "dist/dependent.txt",
          target: dependentTarget,
          digest: contracts.sha256Digest(dependentContent),
          mode: "file",
        },
      ],
      ownedPaths: [
        {
          path: dependentTarget,
          kind: "file",
          digest: contracts.sha256Digest(dependentContent),
        },
      ],
    },
  });
  await writeFile(f.target, f.content, "utf8");
  const dependentDirectory = join(
    f.project,
    ".ai-game-playbook",
    "packs",
    "dependent",
  );
  await mkdir(dependentDirectory, { recursive: true });
  await writeFile(join(dependentDirectory, "demo.txt"), dependentContent, "utf8");
  await writeFile(join(f.source, "dist", "demo.txt"), nextContent, "utf8");
  await writeInstalledState(f, [
    installedPack(dependent, dependentContent, {
      dependencies: [
        {
          id: installed.id,
          version: installed.version,
          digest: installed.digest,
        },
      ],
    }),
    installedPack(installed, f.content),
  ]);

  const prepared = await packRuntime.preparePackOperation(
    request(f, nextPack, {
      operation: "update",
      registry: validatedRegistry(nextPack, dependent),
    }),
  );

  assert.equal(prepared.disposition, "conflicted");
  assert.deepEqual(prepared.changes, []);
  assert.deepEqual(prepared.conflicts, [
    {
      code: "dependency-in-use",
      path: ".ai-game-playbook/state/packs/tool.dependent",
      packId: "tool.dependent",
    },
  ]);
  assert.equal(await readFile(f.target, "utf8"), f.content);
});

test("modified owned files and downgrade requests remain conflict-only", async (t) => {
  const oldContent = "old payload\n";
  const changedContent = "user edit\n";
  const newContent = "new payload\n";
  const f = await fixture(t, newContent);
  const oldPack = manifest({ content: oldContent, version: "1.0.0" });
  const newPack = manifest({ content: newContent, version: "1.1.0" });
  await writeInstalledState(f, [installedPack(oldPack, oldContent)]);
  await writeFile(f.target, changedContent, "utf8");

  const modified = await packRuntime.preparePackOperation(
    request(f, newPack, { operation: "update" }),
  );
  assert.equal(modified.disposition, "conflicted");
  assert.deepEqual(modified.changes, []);
  assert.deepEqual(modified.conflicts, [
    {
      code: "user-modified",
      path: oldPack.artifacts[0].target,
      expectedDigest: contracts.sha256Digest(oldContent),
      actualDigest: contracts.sha256Digest(changedContent),
    },
  ]);

  await writeFile(f.target, oldContent, "utf8");
  const newerInstalled = manifest({ content: oldContent, version: "2.0.0" });
  await writeInstalledState(f, [installedPack(newerInstalled, oldContent)]);
  const requestedOlder = manifest({ content: newContent, version: "1.5.0" });
  const downgrade = await packRuntime.preparePackOperation(
    request(f, requestedOlder, { operation: "update" }),
  );
  assert.equal(downgrade.disposition, "conflicted");
  assert.equal(downgrade.conflicts[0].code, "downgrade-refused");
  assert.equal(await readFile(f.target, "utf8"), oldContent);
});

test("remove plans only clean installed files and leaves state untouched", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  await writeFile(f.target, f.content, "utf8");
  const state = await writeInstalledState(f, [installedPack(pack, f.content)]);

  const prepared = await packRuntime.preparePackOperation(
    request(f, pack, { operation: "remove" }),
  );

  assert.equal(prepared.disposition, "ready");
  assert.deepEqual(prepared.changes, [
    {
      kind: "delete",
      path: pack.artifacts[0].target,
      beforeDigest: contracts.sha256Digest(f.content),
      bytes: Buffer.byteLength(f.content),
    },
  ]);
  assert.equal(await readFile(f.target, "utf8"), f.content);
  assert.equal(await readFile(state.path, "utf8"), state.content);
});

test("malformed installed state fails closed before source promotion", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  const stateDirectory = join(
    f.project,
    ".ai-game-playbook",
    "state",
    "packs",
  );
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(join(stateDirectory, "installed.json"), "{}\n", "utf8");

  await assert.rejects(
    packRuntime.preparePackOperation(request(f, pack)),
    expectPackError("pack-state-corrupt"),
  );
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");
});

test("preflight rejects installed artifact byte-count drift", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  await writeFile(f.target, f.content, "utf8");
  const installed = installedPack(pack, f.content);
  installed.artifacts[0].bytes += 1;
  await writeInstalledState(f, [installed]);

  await assert.rejects(
    packRuntime.preparePackOperation(
      request(f, pack, { operation: "remove" }),
    ),
    expectPackError("pack-state-corrupt"),
  );
  assert.equal(await readFile(f.target, "utf8"), f.content);
});

test("request budgets and project identity are snapshotted before filesystem I/O", async (t) => {
  const f = await fixture(t);
  const pack = manifest({ content: f.content });
  const input = request(f, pack);
  const pending = packRuntime.preparePackOperation(input);
  input.project.id = "mutated.project";
  input.limits.maxTotalBytes = 1;

  const prepared = await pending;
  assert.equal(prepared.project.id, "sample.graybox");
  assert.equal(prepared.limits.maxTotalBytes, 4096);
});

test("source links and missing target parents fail closed without writes", async (t) => {
  const f = await fixture(t);
  const outside = join(f.project, "outside-source");
  await mkdir(outside);
  await writeFile(join(outside, "demo.txt"), f.content, "utf8");
  await rm(join(f.source, "dist"), { recursive: true, force: true });
  await symlink(
    outside,
    join(f.source, "dist"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const pack = manifest({ content: f.content });

  await assert.rejects(
    packRuntime.preparePackOperation(request(f, pack)),
    expectPackError("pack-target-invalid"),
  );
  await assert.rejects(readFile(f.target), (error) => error?.code === "ENOENT");

  await rm(join(f.source, "dist"), { recursive: true, force: true });
  await mkdir(join(f.source, "dist"));
  await writeFile(join(f.source, "dist", "demo.txt"), f.content, "utf8");
  await rm(join(f.project, ".ai-game-playbook", "packs", "local-demo"), {
    recursive: true,
    force: true,
  });
  const missingParent = await packRuntime.preparePackOperation(request(f, pack));
  assert.equal(missingParent.disposition, "conflicted");
  assert.deepEqual(missingParent.conflicts, [
    {
      code: "target-parent-missing",
      path: pack.artifacts[0].target,
    },
  ]);
});
