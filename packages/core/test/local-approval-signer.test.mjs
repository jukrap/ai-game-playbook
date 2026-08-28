import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  generateKeyPairSync,
  verify as verifySignature,
} from "node:crypto";
import test from "node:test";

import * as core from "../dist/index.js";

const initialNow = Date.parse("2026-08-28T05:00:00.000Z");
const digestA = `sha256:${"a".repeat(64)}`;
const digestB = `sha256:${"b".repeat(64)}`;

function fixtureKeyPair(type = "ed25519") {
  const pair =
    type === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    ...pair,
    privateKeyPem: pair.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    publicKeyPem: pair.publicKey.export({ type: "spki", format: "pem" }),
  };
}

function expectCoreError(code) {
  return (error) =>
    error?.name === "CoreBoundaryError" && error?.code === code;
}

function createFixtureKey() {
  const pair = fixtureKeyPair();
  const key = core.createLocalApprovalSigningKey({
    keyId: "approval.local-runtime",
    privateKeyPem: pair.privateKeyPem,
  });
  return { key, pair };
}

test("local approval key derives one broker trust binding without exposing private material", () => {
  const { key, pair } = createFixtureKey();
  const snapshot = core.inspectLocalApprovalSigningKey(key);
  const trustedKey = core.getLocalApprovalTrustedKey(key);

  assert.equal(Object.isFrozen(key), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(trustedKey), true);
  assert.deepEqual(Object.keys(key), ["keyId"]);
  assert.equal(snapshot.keyId, "approval.local-runtime");
  assert.equal(snapshot.status, "active");
  assert.match(snapshot.publicKeyFingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(trustedKey, {
    keyId: "approval.local-runtime",
    publicKeyPem: pair.publicKeyPem,
  });

  const serialized = JSON.stringify({ key, snapshot, trustedKey });
  assert.equal(serialized.includes(pair.privateKeyPem), false);
  assert.equal(serialized.includes("PRIVATE KEY"), false);
});

test("local signer returns valid Ed25519 signatures within exact lifetime and use bounds", () => {
  const { key, pair } = createFixtureKey();
  let currentNow = initialNow;
  const signer = core.createLocalApprovalGrantSigner(key, {
    expiresAt: "2026-08-28T05:01:00.000Z",
    maxSignatures: 2,
    now: () => currentNow,
  });
  const signal = new AbortController().signal;

  const first = signer.sign(digestA, signal);
  const second = signer.sign(digestB, signal);
  assert.equal(
    verifySignature(
      null,
      Buffer.from(digestA, "utf8"),
      pair.publicKey,
      Buffer.from(first, "base64url"),
    ),
    true,
  );
  assert.equal(
    verifySignature(
      null,
      Buffer.from(digestB, "utf8"),
      pair.publicKey,
      Buffer.from(second, "base64url"),
    ),
    true,
  );
  assert.deepEqual(core.inspectLocalApprovalGrantSigner(signer), {
    keyId: "approval.local-runtime",
    publicKeyFingerprint:
      core.inspectLocalApprovalSigningKey(key).publicKeyFingerprint,
    status: "exhausted",
    expiresAt: "2026-08-28T05:01:00.000Z",
    maxSignatures: 2,
    usedSignatures: 2,
    remainingSignatures: 0,
  });
  assert.throws(
    () => signer.sign(digestA, signal),
    expectCoreError("permission-approval-signer-exhausted"),
  );

  currentNow = Date.parse("2026-08-28T05:01:01.000Z");
  assert.equal(
    core.inspectLocalApprovalGrantSigner(signer).status,
    "expired",
  );
});

test("key import rejects ambiguous options and unsupported private keys without reading accessors", () => {
  const ed25519 = fixtureKeyPair();
  const rsa = fixtureKeyPair("rsa");
  let getterCalls = 0;
  const accessorOptions = { keyId: "approval.local-runtime" };
  Object.defineProperty(accessorOptions, "privateKeyPem", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ed25519.privateKeyPem;
    },
  });

  assert.throws(
    () => core.createLocalApprovalSigningKey(accessorOptions),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.equal(getterCalls, 0);
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey(
        new Proxy(
          {
            keyId: "approval.local-runtime",
            privateKeyPem: ed25519.privateKeyPem,
          },
          {
            get() {
              throw new Error("proxy trap must not run");
            },
          },
        ),
      ),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "approval.local-runtime",
        privateKeyPem: ed25519.privateKeyPem,
        extra: true,
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
  const symbolOptions = {
    keyId: "approval.local-runtime",
    privateKeyPem: ed25519.privateKeyPem,
  };
  symbolOptions[Symbol("private")] = true;
  assert.throws(
    () => core.createLocalApprovalSigningKey(symbolOptions),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "Approval.Invalid",
        privateKeyPem: ed25519.privateKeyPem,
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "approval.local-runtime",
        privateKeyPem: rsa.privateKeyPem,
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "approval.local-runtime",
        privateKeyPem: ed25519.privateKeyPem.replaceAll("\n", "\r\n"),
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "approval.local-runtime",
        privateKeyPem: `-----BEGIN PRIVATE KEY-----\nsecret-marker\n-----END PRIVATE KEY-----\n`,
      }),
    (error) =>
      expectCoreError("permission-approval-key-invalid")(error) &&
      !error.message.includes("secret-marker"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalSigningKey({
        keyId: "approval.local-runtime",
        privateKeyPem: "x".repeat(core.LOCAL_APPROVAL_KEY_MAX_PEM_BYTES + 1),
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
});

test("signer validation, cancellation, exhaustion and expiry fail closed", async () => {
  const { key } = createFixtureKey();
  let currentNow = initialNow;
  const createSigner = (overrides = {}) =>
    core.createLocalApprovalGrantSigner(key, {
      expiresAt: "2026-08-28T05:01:00.000Z",
      maxSignatures: 1,
      now: () => currentNow,
      ...overrides,
    });

  let signerGetterCalls = 0;
  const accessorSignerOptions = {
    expiresAt: "2026-08-28T05:01:00.000Z",
  };
  Object.defineProperty(accessorSignerOptions, "maxSignatures", {
    enumerable: true,
    get() {
      signerGetterCalls += 1;
      return 1;
    },
  });
  assert.throws(
    () => core.createLocalApprovalGrantSigner(key, accessorSignerOptions),
    expectCoreError("permission-approval-signer-invalid"),
  );
  assert.equal(signerGetterCalls, 0);
  assert.throws(
    () =>
      core.createLocalApprovalGrantSigner(
        key,
        new Proxy(
          {
            expiresAt: "2026-08-28T05:01:00.000Z",
            maxSignatures: 1,
          },
          {
            get() {
              throw new Error("proxy trap must not run");
            },
          },
        ),
      ),
    expectCoreError("permission-approval-signer-invalid"),
  );

  assert.throws(
    () => createSigner({ maxSignatures: 33 }),
    expectCoreError("permission-approval-signer-invalid"),
  );
  assert.throws(
    () => createSigner({ expiresAt: "2026-08-28T05:05:00.001Z" }),
    expectCoreError("permission-approval-signer-invalid"),
  );

  const signer = createSigner();
  assert.throws(
    () => signer.sign(`sha256:${"A".repeat(64)}`, new AbortController().signal),
    expectCoreError("permission-approval-signer-invalid"),
  );
  assert.throws(
    () => signer.sign(digestA, { aborted: false }),
    expectCoreError("permission-approval-signer-invalid"),
  );
  assert.throws(
    () =>
      signer.sign(
        digestA,
        new Proxy(new AbortController().signal, {}),
      ),
    expectCoreError("permission-approval-signer-invalid"),
  );
  const cancelled = new AbortController();
  cancelled.abort();
  assert.throws(
    () => signer.sign(digestA, cancelled.signal),
    expectCoreError("permission-approval-signing-cancelled"),
  );
  assert.equal(
    core.inspectLocalApprovalGrantSigner(signer).remainingSignatures,
    1,
  );

  const concurrent = await Promise.allSettled([
    Promise.resolve().then(() =>
      signer.sign(digestA, new AbortController().signal),
    ),
    Promise.resolve().then(() =>
      signer.sign(digestB, new AbortController().signal),
    ),
  ]);
  assert.deepEqual(
    concurrent.map(({ status }) => status).sort(),
    ["fulfilled", "rejected"],
  );
  assert.equal(
    concurrent.find(({ status }) => status === "rejected").reason.code,
    "permission-approval-signer-exhausted",
  );

  const expiring = createSigner();
  currentNow = Date.parse("2026-08-28T05:01:00.000Z");
  assert.throws(
    () => expiring.sign(digestA, new AbortController().signal),
    expectCoreError("permission-approval-signer-expired"),
  );

  let driftingNow = initialNow;
  const drifting = core.createLocalApprovalGrantSigner(key, {
    expiresAt: "2026-08-28T05:01:00.000Z",
    maxSignatures: 1,
    now: () => driftingNow,
  });
  driftingNow -= 1;
  assert.throws(
    () => core.inspectLocalApprovalGrantSigner(drifting),
    expectCoreError("permission-approval-signer-invalid"),
  );
});

test("copied handles are not authority and explicit close revokes future signing", () => {
  const { key } = createFixtureKey();
  const now = () => initialNow;
  const first = core.createLocalApprovalGrantSigner(key, {
    expiresAt: "2026-08-28T05:01:00.000Z",
    maxSignatures: 2,
    now,
  });
  const second = core.createLocalApprovalGrantSigner(key, {
    expiresAt: "2026-08-28T05:01:00.000Z",
    maxSignatures: 2,
    now,
  });
  const copiedKey = { ...key };
  const copiedSigner = { ...first };

  assert.throws(
    () => core.inspectLocalApprovalSigningKey(copiedKey),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalGrantSigner(copiedKey, {
        expiresAt: "2026-08-28T05:01:00.000Z",
        maxSignatures: 1,
        now,
      }),
    expectCoreError("permission-approval-key-invalid"),
  );
  assert.throws(
    () => copiedSigner.sign(digestA, new AbortController().signal),
    expectCoreError("permission-approval-signer-invalid"),
  );

  assert.equal(core.closeLocalApprovalGrantSigner(first).status, "closed");
  assert.throws(
    () => first.sign(digestA, new AbortController().signal),
    expectCoreError("permission-approval-signer-closed"),
  );
  assert.equal(core.closeLocalApprovalSigningKey(key).status, "closed");
  assert.throws(
    () => first.sign(digestA, new AbortController().signal),
    expectCoreError("permission-approval-signer-closed"),
  );
  assert.equal(core.inspectLocalApprovalGrantSigner(second).status, "key-closed");
  assert.throws(
    () => second.sign(digestA, new AbortController().signal),
    expectCoreError("permission-approval-key-closed"),
  );
  assert.throws(
    () =>
      core.createLocalApprovalGrantSigner(key, {
        expiresAt: "2026-08-28T05:01:00.000Z",
        maxSignatures: 1,
        now,
      }),
    expectCoreError("permission-approval-key-closed"),
  );
  assert.equal(core.closeLocalApprovalSigningKey(key).status, "closed");
});
