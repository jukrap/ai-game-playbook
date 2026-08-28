import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";

const initialNow = Date.parse("2026-08-28T02:00:00.000Z");
const projectIdentityDigest = `sha256:${"c".repeat(64)}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

const approvalInputSchema = contracts.defineContractSchema({
  id: "approval-session-test-input",
  version: "1.0.0",
  title: "Approval Session Test Input",
  schema: {
    type: "object",
    properties: {
      schemaVersion: { type: "string" },
      projectRoot: { type: "string", minLength: 1, maxLength: 512 },
      credentialMarker: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["schemaVersion", "projectRoot", "credentialMarker"],
    additionalProperties: false,
  },
});

function schemaRef(schema) {
  return { schemaId: schema.schemaId, digest: schema.digest };
}

function createRegistry({ controlPlaneVersion = "0.0.0" } = {}) {
  const definition = createValidRegistryDefinition();
  definition.controlPlaneVersion = controlPlaneVersion;
  definition.schemas.push(
    approvalInputSchema,
    contracts.approvalGrantSchema,
    contracts.approvalPromptSchema,
    contracts.approvalSessionChallengeSchema,
    contracts.approvalSessionResponseSchema,
  );
  const install = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  install.id = "pack.install-test";
  install.version = "1.0.0";
  install.summary = "Install content into exact approved project paths.";
  install.cli = { path: ["internal", "pack", "install-test"], aliases: [] };
  install.input = schemaRef(approvalInputSchema);
  install.capabilities = ["pack.install-test"];
  install.permissions = ["install"];
  install.sideEffects = [
    { kind: "filesystem", scope: "approved-paths", boundary: "local" },
  ];
  install.lane = "project-write";
  install.timeoutMs = 30_000;
  install.retry = { mode: "never", maxAttempts: 1 };
  install.budgets = {
    maxChangedFiles: 32,
    maxChangedBytes: 1_048_576,
    maxDurationMs: 30_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
  };
  install.handler = {
    package: "@ai-game-playbook/core",
    export: "installApprovalSessionFixture",
    digest: `sha256:${"8".repeat(64)}`,
  };
  definition.commands.push(install);
  return registry.validateRegistry(definition);
}

function createBroker(selectedRegistry, now) {
  return core.createPermissionBroker({
    registry: selectedRegistry,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 32,
        maxChangedBytes: 1_048_576,
        maxDurationMs: 900_000,
        maxOutputBytes: 4_194_304,
        maxRepairCycles: 3,
      },
    },
    trustedApprovalKeys: [
      { keyId: "approval.local-key", publicKeyPem },
    ],
    now,
  });
}

function request(overrides = {}) {
  return {
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    projectId: "sample.graybox",
    projectIdentityDigest,
    commandId: "pack.install-test",
    input: {
      schemaVersion: "1.0.0",
      projectRoot: "D:\\private\\game-project",
      credentialMarker: "fixture-private-value",
    },
    scope: {
      paths: ["gameplay/collectibles/item.gd"],
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
    },
    budgets: {
      maxChangedFiles: 32,
      maxChangedBytes: 1_048_576,
      maxDurationMs: 30_000,
      maxOutputBytes: 1_048_576,
      maxRepairCycles: 0,
    },
    deadlineAt: "2026-08-28T02:00:30.000Z",
    ...overrides,
  };
}

function createContext() {
  let currentNow = initialNow;
  const now = () => currentNow;
  const selectedRegistry = createRegistry();
  const broker = createBroker(selectedRegistry, now);
  const authorizationRequest = request();
  const session = core.createPermissionApprovalSession({
    broker,
    registry: selectedRegistry,
    request: authorizationRequest,
    hostId: "host.codex-local",
    expiresAt: "2026-08-28T02:00:10.000Z",
    grantTerms: [
      {
        permission: "install",
        expiresAt: "2026-08-28T02:00:20.000Z",
        maxUses: 1,
      },
    ],
    now,
  });
  return {
    broker,
    now,
    request: authorizationRequest,
    registry: selectedRegistry,
    session,
    setNow(value) {
      currentNow = value;
    },
  };
}

function response(session, decision = "approved", overrides = {}) {
  return {
    schemaVersion: "1.0.0",
    sessionId: session.presentation.session.sessionId,
    sessionDigest: session.presentation.session.sessionDigest,
    promptDigest: session.presentation.prompt.promptDigest,
    decision,
    ...overrides,
  };
}

function signatureFor(digest) {
  return sign(null, Buffer.from(digest, "utf8"), privateKey).toString(
    "base64url",
  );
}

function signer(overrides = {}) {
  return {
    keyId: "approval.local-key",
    sign(signingDigest) {
      return signatureFor(signingDigest);
    },
    ...overrides,
  };
}

function expectCoreError(code) {
  return (error) =>
    error?.name === "CoreBoundaryError" && error?.code === code;
}

function settleCancelled(authorization) {
  return authorization.lease.settle({
    outcome: "cancelled",
    mutationUncertain: false,
    actual: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 0,
      outputBytes: 0,
      repairCycles: 0,
    },
  });
}

test("approval session returns signed grants to the original broker once", async () => {
  const context = createContext();
  const { session } = context;
  let signingCalls = 0;
  const result = await core.resolvePermissionApprovalSession(
    session,
    response(session),
    signer({
      sign(signingDigest, signal) {
        signingCalls += 1;
        assert.equal(signal.aborted, false);
        return signatureFor(signingDigest);
      },
    }),
  );

  assert.equal(result.status, "authorized");
  assert.equal(result.session.status, "authorized");
  assert.equal(signingCalls, 1);
  assert.deepEqual(result.authorization.lease.grantIds, [
    `approval.session.${session.presentation.session.sessionId.replaceAll("-", "")}.install`,
  ]);
  assert.equal(
    result.authorization.challenge.requestDigest,
    session.presentation.session.requestDigest,
  );
  assert.equal(settleCancelled(result.authorization).status, "cancelled");
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session),
        signer(),
      ),
    expectCoreError("permission-approval-session-settled"),
  );
});

test("approval session accepts a bounded local signer bound to the broker key", async () => {
  const context = createContext();
  const localKey = core.createLocalApprovalSigningKey({
    keyId: "approval.local-key",
    privateKeyPem,
  });
  assert.deepEqual(core.getLocalApprovalTrustedKey(localKey), {
    keyId: "approval.local-key",
    publicKeyPem,
  });
  const localSigner = core.createLocalApprovalGrantSigner(localKey, {
    expiresAt: "2026-08-28T02:00:10.000Z",
    maxSignatures: 1,
    now: context.now,
  });

  const result = await core.resolvePermissionApprovalSession(
    context.session,
    response(context.session),
    localSigner,
  );

  assert.equal(result.status, "authorized");
  assert.equal(
    core.inspectLocalApprovalGrantSigner(localSigner).status,
    "exhausted",
  );
  settleCancelled(result.authorization);
  core.closeLocalApprovalSigningKey(localKey);
});

test("presentation is immutable, serializable, and carries no raw input authority", () => {
  const { session } = createContext();
  const serialized = JSON.stringify(session.presentation);

  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.presentation), true);
  assert.equal(Object.isFrozen(session.presentation.prompt), true);
  assert.equal(Object.isFrozen(session.presentation.session), true);
  assert.equal(serialized.includes("D:\\\\private"), false);
  assert.equal(serialized.includes("fixture-private-value"), false);
  assert.equal(serialized.includes("credentialMarker"), false);
  assert.equal(serialized.includes("signature"), false);
  assert.equal(serialized.includes("privateKey"), false);
  assert.throws(
    () =>
      core.createApprovalGrantSubjectFromPrompt(
        session.presentation.prompt,
        {
          grantId: "approval.copied-prompt",
          permission: "install",
          approvedAt: "2026-08-28T02:00:00.000Z",
          expiresAt: "2026-08-28T02:00:20.000Z",
          maxUses: 1,
        },
      ),
    expectCoreError("permission-prompt-invalid"),
  );
  assert.throws(
    () => core.inspectPermissionApprovalSession(structuredClone(session)),
    expectCoreError("permission-approval-session-invalid"),
  );
});

test("denial and cancellation settle without invoking a signer", async () => {
  for (const decision of ["denied", "cancelled"]) {
    const { session } = createContext();
    let calls = 0;
    const result = await core.resolvePermissionApprovalSession(
      session,
      response(session, decision),
      signer({
        sign() {
          calls += 1;
          throw new Error("must not run");
        },
      }),
    );

    assert.equal(result.status, decision);
    assert.equal(result.session.status, decision);
    assert.equal(calls, 0);
    assert.equal(core.inspectPermissionApprovalSession(session).status, decision);
  }
});

test("expired sessions do not validate or sign late approvals", async () => {
  const context = createContext();
  context.setNow(Date.parse("2026-08-28T02:00:10.000Z"));
  let calls = 0;
  const result = await core.resolvePermissionApprovalSession(
    context.session,
    { invalid: "late-response" },
    signer({
      sign() {
        calls += 1;
        throw new Error("must not run");
      },
    }),
  );

  assert.equal(result.status, "expired");
  assert.equal(result.session.status, "expired");
  assert.equal(
    result.session.terminalAt,
    context.session.presentation.session.expiresAt,
  );
  assert.equal(calls, 0);
});

test("tampered responses fail without consuming the pending session", async () => {
  const { session } = createContext();
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session, "denied", {
          promptDigest: `sha256:${"f".repeat(64)}`,
        }),
      ),
    expectCoreError("permission-approval-session-invalid"),
  );
  assert.equal(core.inspectPermissionApprovalSession(session).status, "pending");

  const denied = await core.resolvePermissionApprovalSession(
    session,
    response(session, "denied"),
  );
  assert.equal(denied.status, "denied");
});

test("approved signer failures are terminal and cannot be replayed", async () => {
  const { session } = createContext();
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session),
        signer({
          sign() {
            throw new Error("signer unavailable");
          },
        }),
      ),
    expectCoreError("permission-approval-session-signing-failed"),
  );
  assert.deepEqual(core.inspectPermissionApprovalSession(session), {
    sessionId: session.presentation.session.sessionId,
    promptDigest: session.presentation.prompt.promptDigest,
    sessionDigest: session.presentation.session.sessionDigest,
    status: "failed",
    terminalAt: "2026-08-28T02:00:00.000Z",
    failure: "signing-failed",
  });
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session),
        signer(),
      ),
    expectCoreError("permission-approval-session-settled"),
  );
});

test("a signer result that settles after the session deadline is rejected", async () => {
  const context = createContext();
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        context.session,
        response(context.session),
        signer({
          sign(signingDigest) {
            context.setNow(Date.parse("2026-08-28T02:00:10.000Z"));
            return signatureFor(signingDigest);
          },
        }),
      ),
    expectCoreError("permission-approval-session-signing-failed"),
  );
  const snapshot = core.inspectPermissionApprovalSession(context.session);
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.failure, "signing-failed");
});

test("broker rejection after signing is terminal", async () => {
  const { session } = createContext();
  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session),
        signer({ keyId: "approval.untrusted-key" }),
      ),
    expectCoreError("permission-grant-signature-invalid"),
  );
  const snapshot = core.inspectPermissionApprovalSession(session);
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.failure, "authorization-failed");
});

test("request drift after presentation is rejected by the original broker", async () => {
  const context = createContext();
  context.request.input.credentialMarker = "fixture-changed-value";

  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        context.session,
        response(context.session),
        signer(),
      ),
    expectCoreError("permission-grant-mismatch"),
  );
  const snapshot = core.inspectPermissionApprovalSession(context.session);
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.failure, "authorization-failed");
});

test("untrusted response objects are rejected without invoking accessors", async () => {
  const { session } = createContext();
  let accessorReads = 0;
  const accessor = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "1.0.0";
    },
  });

  await assert.rejects(
    () => core.resolvePermissionApprovalSession(session, accessor),
    expectCoreError("permission-approval-session-invalid"),
  );
  assert.equal(accessorReads, 0);
  assert.equal(core.inspectPermissionApprovalSession(session).status, "pending");
});

test("concurrent responses cannot both leave pending state", async () => {
  const { session } = createContext();
  let release;
  let started;
  const signerStarted = new Promise((resolve) => {
    started = resolve;
  });
  const signingRelease = new Promise((resolve) => {
    release = resolve;
  });
  const first = core.resolvePermissionApprovalSession(
    session,
    response(session),
    signer({
      async sign(signingDigest) {
        started(signingDigest);
        await signingRelease;
        return signatureFor(signingDigest);
      },
    }),
  );
  await signerStarted;

  await assert.rejects(
    () =>
      core.resolvePermissionApprovalSession(
        session,
        response(session, "cancelled"),
      ),
    expectCoreError("permission-approval-session-settled"),
  );
  assert.deepEqual(core.inspectPermissionApprovalSession(session), {
    sessionId: session.presentation.session.sessionId,
    promptDigest: session.presentation.prompt.promptDigest,
    sessionDigest: session.presentation.session.sessionDigest,
    status: "resolving",
  });
  release();
  const result = await first;
  assert.equal(result.status, "authorized");
  settleCancelled(result.authorization);
});

test("session creation rejects registry drift and incomplete grant terms", () => {
  const selectedRegistry = createRegistry();
  const now = () => initialNow;
  const broker = createBroker(selectedRegistry, now);
  const base = {
    broker,
    registry: selectedRegistry,
    request: request(),
    hostId: "host.codex-local",
    expiresAt: "2026-08-28T02:00:10.000Z",
    grantTerms: [
      {
        permission: "install",
        expiresAt: "2026-08-28T02:00:20.000Z",
        maxUses: 1,
      },
    ],
    now,
  };

  assert.throws(
    () =>
      core.createPermissionApprovalSession({
        ...base,
        registry: createRegistry({ controlPlaneVersion: "0.0.1" }),
      }),
    expectCoreError("permission-approval-session-invalid"),
  );
  assert.throws(
    () =>
      core.createPermissionApprovalSession({
        ...base,
        grantTerms: [],
      }),
    expectCoreError("permission-approval-session-invalid"),
  );
  assert.throws(
    () =>
      core.createPermissionApprovalSession({
        ...base,
        expiresAt: "2026-08-28T02:00:30.000Z",
      }),
    expectCoreError("permission-approval-session-invalid"),
  );
});

test("commands without explicit approval never create an approval session", () => {
  const selectedRegistry = createRegistry();
  const now = () => initialNow;
  const broker = createBroker(selectedRegistry, now);
  const readRequest = request({
    commandId: "project.inspect",
    input: { schemaVersion: "1.0.0" },
    scope: {
      paths: ["project.godot"],
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
    },
    budgets: {
      maxDurationMs: 10_000,
      maxOutputBytes: 1_048_576,
      maxRepairCycles: 0,
    },
    deadlineAt: "2026-08-28T02:00:10.000Z",
  });

  assert.throws(
    () =>
      core.createPermissionApprovalSession({
        broker,
        registry: selectedRegistry,
        request: readRequest,
        hostId: "host.codex-local",
        expiresAt: "2026-08-28T02:00:05.000Z",
        grantTerms: [
          {
            permission: "install",
            expiresAt: "2026-08-28T02:00:09.000Z",
            maxUses: 1,
          },
        ],
        now,
      }),
    expectCoreError("permission-approval-session-invalid"),
  );
  const authorization = broker.authorize(readRequest, []);
  assert.equal(authorization.status, "authorized");
  settleCancelled(authorization);
});
