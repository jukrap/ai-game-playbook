import assert from "node:assert/strict";
import {
  appendFile,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as provider from "../dist/index.js";
import { createWindowsContainmentProviderRuntime } from "../dist/artifact.js";

function fakeWindowsX64Executable() {
  const value = Buffer.alloc(256);
  value.writeUInt16LE(0x5a4d, 0);
  value.writeUInt32LE(0x80, 0x3c);
  value.writeUInt32LE(0x0000_4550, 0x80);
  value.writeUInt16LE(0x8664, 0x84);
  return value;
}

async function fixture(t) {
  const canonicalTempRoot = await realpath(tmpdir());
  const root = await mkdtemp(
    join(canonicalTempRoot, "agpb-windows-provider-"),
  );
  const artifactPath = join(root, "provider.exe");
  await writeFile(artifactPath, fakeWindowsX64Executable());
  t.after(() => rm(root, { recursive: true, force: true }));
  return { artifactPath };
}

function expectProviderError(code) {
  return (error) =>
    error?.name === "WindowsContainmentProviderError" &&
    error?.code === code;
}

test("artifact identity produces one immutable compiled descriptor", async (t) => {
  const { artifactPath } = await fixture(t);
  const runtime = await createWindowsContainmentProviderRuntime({
    artifactPath,
  });

  assert.equal(runtime.schemaVersion, "1.0.0");
  assert.equal(runtime.registration, "compiled");
  assert.equal(runtime.dynamicRegistration, false);
  assert.equal(
    runtime.descriptor.providerId,
    provider.WINDOWS_CONTAINMENT_PROVIDER_ID,
  );
  assert.deepEqual(runtime.descriptor.host, {
    platform: "windows",
    architecture: "x64",
  });
  assert.equal(
    runtime.descriptor.implementation.entryArtifactDigest,
    runtime.descriptor.implementation.selfTestArtifactDigest,
  );
  assert.equal(
    runtime.catalogDigest,
    contracts.computeProcessContainmentProviderCatalogDigest([
      runtime.descriptor,
    ]),
  );
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentProviderDescriptorSemantics(
      runtime.descriptor,
    ),
  );
  assert.equal(JSON.stringify(runtime).includes(artifactPath), false);
  assert.equal(Object.isFrozen(runtime), true);
  assert.equal(Object.isFrozen(runtime.descriptor), true);
});

test("artifact boundary rejects relative paths, non-PE data, and accessors", async (t) => {
  const { artifactPath } = await fixture(t);

  await assert.rejects(
    createWindowsContainmentProviderRuntime({
      artifactPath: "provider.exe",
    }),
    expectProviderError("invalid-provider-artifact-request"),
  );

  const invalidPath = join(tmpdir(), `agpb-invalid-${Date.now()}.exe`);
  await writeFile(invalidPath, "not-a-portable-executable");
  t.after(() => rm(invalidPath, { force: true }));
  await assert.rejects(
    createWindowsContainmentProviderRuntime({
      artifactPath: invalidPath,
    }),
    expectProviderError("provider-artifact-invalid"),
  );

  let getterCalled = false;
  const accessor = {};
  Object.defineProperty(accessor, "artifactPath", {
    enumerable: true,
    get() {
      getterCalled = true;
      return artifactPath;
    },
  });
  await assert.rejects(
    createWindowsContainmentProviderRuntime(accessor),
    expectProviderError("invalid-provider-artifact-request"),
  );
  assert.equal(getterCalled, false);
});

test("engine admission parsing never invokes accessors", async () => {
  let getterCalled = false;
  const hostile = {
    launchWitness: null,
    binding: null,
    root: null,
    executable: null,
    operationId: "engine.headless-preflight",
    invocationDigest: contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  };
  Object.defineProperty(hostile, "runtime", {
    enumerable: true,
    get() {
      getterCalled = true;
      return null;
    },
  });

  await assert.rejects(
    provider.createWindowsContainedEngineAdmission(hostile),
    expectProviderError("invalid-engine-admission-request"),
  );
  assert.equal(getterCalled, false);
});

test("prepared self-test binds project, provider, catalog, challenge, and expiry", async (t) => {
  const { artifactPath } = await fixture(t);
  const runtime = await createWindowsContainmentProviderRuntime({
    artifactPath,
  });
  const projectRootIdentityDigest = contracts.digestCanonicalJson({
    project: "fixture",
  });
  const prepared = provider.prepareWindowsContainmentSelfTest({
    runtime,
    projectRootIdentityDigest,
  });

  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentSelfTestRequestSemantics(
      prepared.request,
    ),
  );
  assert.equal(
    prepared.requestDigest,
    contracts.computeProcessContainmentSelfTestRequestDigest(
      prepared.request,
    ),
  );
  assert.equal(
    prepared.request.providerDescriptorDigest,
    runtime.descriptor.descriptorDigest,
  );
  assert.equal(prepared.request.providerCatalogDigest, runtime.catalogDigest);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.request), true);

  const clone = structuredClone(prepared);
  await assert.rejects(
    provider.runWindowsContainmentSelfTest({ prepared: clone }),
    expectProviderError("invalid-self-test-request"),
  );
});

test("artifact drift is rejected before a prepared self-test can spawn", async (t) => {
  const { artifactPath } = await fixture(t);
  const runtime = await createWindowsContainmentProviderRuntime({
    artifactPath,
  });
  const prepared = provider.prepareWindowsContainmentSelfTest({
    runtime,
    projectRootIdentityDigest: contracts.digestCanonicalJson({
      project: "drift-fixture",
    }),
  });
  await appendFile(artifactPath, Buffer.from([0]));

  if (process.platform === "win32" && process.arch === "x64") {
    await assert.rejects(
      provider.runWindowsContainmentSelfTest({ prepared }),
      expectProviderError("provider-artifact-drift"),
    );
  } else {
    await assert.rejects(
      provider.runWindowsContainmentSelfTest({ prepared }),
      expectProviderError("provider-host-unsupported"),
    );
  }
});
