import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const projectIdentityDigest = `sha256:${"1".repeat(64)}`;
const firstDigest = `sha256:${"2".repeat(64)}`;
const secondDigest = `sha256:${"3".repeat(64)}`;

function entry(id, version, manifestDigest, dependencies = []) {
  return { id, version, manifestDigest, dependencies };
}

function lockWith(packs) {
  const body = {
    schemaVersion: "1.0.0",
    projectId: "sample.graybox",
    projectIdentityDigest,
    packs,
  };
  return {
    ...body,
    lockDigest: contracts.computeProjectPackLockDigest(body),
  };
}

test("project pack lock schema is public, versioned, and closed", () => {
  assert.equal(contracts.projectPackLockSchema.id, "project-pack-lock");
  assert.equal(contracts.projectPackLockSchema.version, "1.0.0");
  assert.equal(contracts.projectPackLockSchema.schema.additionalProperties, false);
  assert.equal(
    contracts.PUBLIC_CONTRACT_SCHEMAS["project-pack-lock"],
    contracts.projectPackLockSchema,
  );
});

test("empty project pack locks are canonical, frozen, and self-attested", () => {
  const lock = contracts.createEmptyProjectPackLock({
    projectId: "sample.graybox",
    projectIdentityDigest,
  });

  assert.deepEqual(lock.packs, []);
  assert.equal(Object.isFrozen(lock), true);
  assert.equal(Object.isFrozen(lock.packs), true);
  assert.match(lock.lockDigest, /^sha256:[0-9a-f]{64}$/);
  assert.doesNotThrow(() => contracts.assertProjectPackLockSemantics(lock));
  assert.equal(
    lock.lockDigest,
    contracts.computeProjectPackLockDigest({
      schemaVersion: lock.schemaVersion,
      projectId: lock.projectId,
      projectIdentityDigest: lock.projectIdentityDigest,
      packs: lock.packs,
    }),
  );
});

test("project pack lock semantics bind canonical pack and dependency identities", () => {
  const lock = lockWith([
    entry("pack.core", "1.0.0", firstDigest),
    entry("pack.gameplay", "2.0.0", secondDigest, [
      {
        id: "pack.core",
        version: "1.0.0",
        manifestDigest: firstDigest,
      },
    ]),
  ]);
  assert.doesNotThrow(() => contracts.assertProjectPackLockSemantics(lock));

  assert.throws(
    () => lockWith([...lock.packs].reverse()),
    /canonical/,
  );
  const missing = lockWith([
    entry("pack.gameplay", "2.0.0", secondDigest, [
      {
        id: "pack.core",
        version: "1.0.0",
        manifestDigest: firstDigest,
      },
    ]),
  ]);
  assert.throws(
    () => contracts.assertProjectPackLockSemantics(missing),
    /dependency/,
  );
  const mismatched = lockWith([
    entry("pack.core", "1.0.0", firstDigest),
    entry("pack.gameplay", "2.0.0", secondDigest, [
      {
        id: "pack.core",
        version: "1.1.0",
        manifestDigest: firstDigest,
      },
    ]),
  ]);
  assert.throws(
    () => contracts.assertProjectPackLockSemantics(mismatched),
    /dependency/,
  );
});

test("project pack lock semantics reject duplicate, self, and digest drift", () => {
  assert.throws(
    () =>
      lockWith([
        entry("pack.core", "1.0.0", firstDigest),
        entry("pack.core", "1.0.1", secondDigest),
      ]),
    /canonical/,
  );
  const self = lockWith([
    entry("pack.core", "1.0.0", firstDigest, [
      {
        id: "pack.core",
        version: "1.0.0",
        manifestDigest: firstDigest,
      },
    ]),
  ]);
  assert.throws(
    () => contracts.assertProjectPackLockSemantics(self),
    /dependency/,
  );
  const valid = lockWith([entry("pack.core", "1.0.0", firstDigest)]);
  assert.throws(
    () =>
      contracts.assertProjectPackLockSemantics({
        ...valid,
        lockDigest: `sha256:${"f".repeat(64)}`,
      }),
    /digest/,
  );
  assert.throws(
    () =>
      contracts.computeProjectPackLockDigest({
        schemaVersion: "1.0.0",
        projectId: "sample.graybox",
        projectIdentityDigest,
        packs: [],
        undeclared: true,
      }),
    /fields/,
  );
});

test("project pack lock semantics reject indirect dependency cycles", () => {
  const cyclic = lockWith([
    entry("pack.core", "1.0.0", firstDigest, [
      {
        id: "pack.gameplay",
        version: "2.0.0",
        manifestDigest: secondDigest,
      },
    ]),
    entry("pack.gameplay", "2.0.0", secondDigest, [
      {
        id: "pack.core",
        version: "1.0.0",
        manifestDigest: firstDigest,
      },
    ]),
  ]);

  assert.throws(
    () => contracts.assertProjectPackLockSemantics(cyclic),
    /cycle/,
  );
});
