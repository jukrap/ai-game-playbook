import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "@ai-game-playbook/core";
import * as registry from "@ai-game-playbook/registry";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";
import {
  CODEX_APPROVAL_HOST_ID,
  CodexApprovalBoundaryError,
  createCodexApprovalPresenter,
  runCodexApprovalSession,
} from "../dist/index.js";

const projectIdentityDigest = `sha256:${"c".repeat(64)}`;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });

const approvalInputSchema = contracts.defineContractSchema({
  id: "codex-approval-port-test-input",
  version: "1.0.0",
  title: "Codex Approval Port Test Input",
  schema: {
    type: "object",
    properties: {
      schemaVersion: { type: "string" },
      projectMarker: { type: "string", minLength: 1, maxLength: 128 },
      credentialMarker: { type: "string", minLength: 1, maxLength: 128 },
    },
    required: ["schemaVersion", "projectMarker", "credentialMarker"],
    additionalProperties: false,
  },
});

function schemaRef(schema) {
  return { schemaId: schema.schemaId, digest: schema.digest };
}

function createRegistry() {
  const definition = createValidRegistryDefinition();
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
  install.id = "pack.codex-approval-test";
  install.version = "1.0.0";
  install.summary = "Install content after one exact host decision.";
  install.cli = {
    path: ["internal", "pack", "codex-approval-test"],
    aliases: [],
  };
  install.input = schemaRef(approvalInputSchema);
  install.capabilities = ["pack.codex-approval-test"];
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
    package: "@ai-game-playbook/codex-adapter",
    export: "codexApprovalPortTestFixture",
    digest: `sha256:${"8".repeat(64)}`,
  };
  definition.commands.push(install);
  return registry.validateRegistry(definition);
}

function createContext({
  hostId = CODEX_APPROVAL_HOST_ID,
  sessionTtlMs = 2_000,
} = {}) {
  const selectedRegistry = createRegistry();
  const start = Date.now();
  const deadlineAt = new Date(start + sessionTtlMs + 5_000).toISOString();
  const broker = core.createPermissionBroker({
    registry: selectedRegistry,
    project: {
      id: "sample.graybox",
      identityDigest: projectIdentityDigest,
      stage: "vertical-slice",
      budgets: {
        maxChangedFiles: 32,
        maxChangedBytes: 1_048_576,
        maxDurationMs: 30_000,
        maxOutputBytes: 1_048_576,
        maxRepairCycles: 3,
      },
    },
    trustedApprovalKeys: [
      { keyId: "approval.codex-local", publicKeyPem },
    ],
    now: Date.now,
  });
  const request = {
    runId: "018f6f35-2c9e-7d1a-8a4b-123456789abd",
    projectId: "sample.graybox",
    projectIdentityDigest,
    commandId: "pack.codex-approval-test",
    input: {
      schemaVersion: "1.0.0",
      projectMarker: "fixture-project",
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
    deadlineAt,
  };
  const session = core.createPermissionApprovalSession({
    broker,
    registry: selectedRegistry,
    request,
    hostId,
    expiresAt: new Date(start + sessionTtlMs).toISOString(),
    grantTerms: [
      {
        permission: "install",
        expiresAt: new Date(start + sessionTtlMs + 2_000).toISOString(),
        maxUses: 1,
      },
    ],
    now: Date.now,
  });
  return { session };
}

function signer(overrides = {}) {
  return {
    keyId: "approval.codex-local",
    sign(signingDigest) {
      return sign(
        null,
        Buffer.from(signingDigest, "utf8"),
        privateKey,
      ).toString("base64url");
    },
    ...overrides,
  };
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

function expectAdapterError(code) {
  return (error) =>
    error instanceof CodexApprovalBoundaryError && error.code === code;
}

test("Codex presenter receives only immutable authority-free presentation", async () => {
  const { session } = createContext();
  let signingCalls = 0;
  const presenter = createCodexApprovalPresenter((presentation, signal) => {
    const serialized = JSON.stringify(presentation);
    assert.equal(signal.aborted, false);
    assert.equal(Object.isFrozen(presentation), true);
    assert.equal(Object.isFrozen(presentation.prompt), true);
    assert.equal(Object.isFrozen(presentation.session), true);
    assert.equal(serialized.includes("fixture-project"), false);
    assert.equal(serialized.includes("fixture-private-value"), false);
    assert.equal(serialized.includes("credentialMarker"), false);
    assert.equal(serialized.includes("signature"), false);
    return "approved";
  });

  const result = await runCodexApprovalSession(
    session,
    presenter,
    signer({
      sign(signingDigest, signal) {
        signingCalls += 1;
        assert.equal(signal.aborted, false);
        assert.match(signingDigest, /^sha256:[0-9a-f]{64}$/u);
        return sign(
          null,
          Buffer.from(signingDigest, "utf8"),
          privateKey,
        ).toString("base64url");
      },
    }),
  );

  assert.equal(result.status, "authorized");
  assert.equal(signingCalls, 1);
  assert.equal(presenter.hostId, CODEX_APPROVAL_HOST_ID);
  assert.equal(Object.isFrozen(presenter), true);
  assert.equal(settleCancelled(result.authorization).status, "cancelled");
});

test("Codex approval can use a bounded local signer without exposing key material to the presenter", async () => {
  const { session } = createContext();
  const localKey = core.createLocalApprovalSigningKey({
    keyId: "approval.codex-local",
    privateKeyPem,
  });
  const localSigner = core.createLocalApprovalGrantSigner(localKey, {
    expiresAt: session.presentation.session.expiresAt,
    maxSignatures: session.presentation.session.grantTerms.length,
  });
  let serializedPresentation = "";

  const result = await runCodexApprovalSession(
    session,
    createCodexApprovalPresenter((presentation) => {
      serializedPresentation = JSON.stringify(presentation);
      return "approved";
    }),
    localSigner,
  );

  assert.equal(result.status, "authorized");
  assert.equal(
    core.inspectLocalApprovalGrantSigner(localSigner).status,
    "exhausted",
  );
  assert.equal(serializedPresentation.includes(privateKeyPem), false);
  assert.equal(serializedPresentation.includes("PRIVATE KEY"), false);
  settleCancelled(result.authorization);
  core.closeLocalApprovalGrantSigner(localSigner);
  core.closeLocalApprovalSigningKey(localKey);
});

test("copied presenters and sessions for another host are rejected", async () => {
  const presenter = createCodexApprovalPresenter(() => "cancelled");
  const copiedContext = createContext();
  await assert.rejects(
    () =>
      runCodexApprovalSession(
        copiedContext.session,
        { ...presenter },
        signer(),
      ),
    expectAdapterError("codex-approval-presenter-invalid"),
  );
  assert.equal(
    core.inspectPermissionApprovalSession(copiedContext.session).status,
    "pending",
  );

  const foreignContext = createContext({ hostId: "host.other-local" });
  await assert.rejects(
    () => runCodexApprovalSession(foreignContext.session, presenter, signer()),
    expectAdapterError("codex-approval-host-mismatch"),
  );
  assert.equal(
    core.inspectPermissionApprovalSession(foreignContext.session).status,
    "pending",
  );
});

test("proxied host capabilities and cancellation signals are rejected", async () => {
  assert.throws(
    () => createCodexApprovalPresenter(new Proxy(() => "cancelled", {})),
    expectAdapterError("codex-approval-presenter-invalid"),
  );

  const { session } = createContext();
  const presenter = createCodexApprovalPresenter(() => "cancelled");
  const proxiedSignal = new Proxy(new AbortController().signal, {});
  await assert.rejects(
    () => runCodexApprovalSession(session, presenter, signer(), proxiedSignal),
    expectAdapterError("codex-approval-session-invalid"),
  );
  assert.equal(core.inspectPermissionApprovalSession(session).status, "pending");
});

test("denial and user cancellation never invoke the signer", async () => {
  for (const decision of ["denied", "cancelled"]) {
    const { session } = createContext();
    let signingCalls = 0;
    const result = await runCodexApprovalSession(
      session,
      createCodexApprovalPresenter(() => decision),
      signer({
        sign() {
          signingCalls += 1;
          throw new Error("must not sign");
        },
      }),
    );
    assert.equal(result.status, decision);
    assert.equal(signingCalls, 0);
  }
});

test("caller cancellation aborts an in-flight host presentation", async () => {
  const { session } = createContext();
  const caller = new AbortController();
  let hostSignal;
  let started;
  const presented = new Promise((resolve) => {
    started = resolve;
  });
  const presenter = createCodexApprovalPresenter((_presentation, signal) => {
    hostSignal = signal;
    started();
    return new Promise(() => {});
  });
  const running = runCodexApprovalSession(
    session,
    presenter,
    signer(),
    caller.signal,
  );
  await presented;
  caller.abort("private caller reason");

  const result = await running;
  assert.equal(result.status, "cancelled");
  assert.equal(hostSignal.aborted, true);
});

test("an already cancelled caller never invokes the host", async () => {
  const { session } = createContext();
  const caller = new AbortController();
  caller.abort("private caller reason");
  let calls = 0;
  const result = await runCodexApprovalSession(
    session,
    createCodexApprovalPresenter(() => {
      calls += 1;
      return "approved";
    }),
    signer(),
    caller.signal,
  );

  assert.equal(result.status, "cancelled");
  assert.equal(calls, 0);
});

test("an approval returned with caller cancellation cannot reach the signer", async () => {
  const { session } = createContext();
  const caller = new AbortController();
  let signingCalls = 0;
  const result = await runCodexApprovalSession(
    session,
    createCodexApprovalPresenter(() => {
      caller.abort("private caller reason");
      return "approved";
    }),
    signer({
      sign() {
        signingCalls += 1;
        throw new Error("must not sign");
      },
    }),
    caller.signal,
  );

  assert.equal(result.status, "cancelled");
  assert.equal(signingCalls, 0);
});

test("presentation deadline aborts the host and expires without signing", async () => {
  const { session } = createContext({ sessionTtlMs: 500 });
  let hostSignal;
  let signingCalls = 0;
  const result = await runCodexApprovalSession(
    session,
    createCodexApprovalPresenter((_presentation, signal) => {
      hostSignal = signal;
      return new Promise(() => {});
    }),
    signer({
      sign() {
        signingCalls += 1;
        throw new Error("must not sign");
      },
    }),
  );

  assert.equal(result.status, "expired");
  assert.equal(hostSignal.aborted, true);
  assert.equal(signingCalls, 0);
});

test("host failure and invalid decisions close the session without signing", async () => {
  for (const [handler, code] of [
    [() => Promise.reject(new Error("private host failure")), "codex-approval-host-failed"],
    [() => "allow", "codex-approval-decision-invalid"],
    [() => ({ decision: "approved" }), "codex-approval-decision-invalid"],
  ]) {
    const { session } = createContext();
    let signingCalls = 0;
    await assert.rejects(
      () =>
        runCodexApprovalSession(
          session,
          createCodexApprovalPresenter(handler),
          signer({
            sign() {
              signingCalls += 1;
              throw new Error("must not sign");
            },
          }),
        ),
      expectAdapterError(code),
    );
    assert.equal(core.inspectPermissionApprovalSession(session).status, "cancelled");
    assert.equal(signingCalls, 0);
  }
});

test("one session cannot open two concurrent Codex presentations", async () => {
  const { session } = createContext();
  let calls = 0;
  let release;
  let started;
  const presented = new Promise((resolve) => {
    started = resolve;
  });
  const waitForRelease = new Promise((resolve) => {
    release = resolve;
  });
  const presenter = createCodexApprovalPresenter(async () => {
    calls += 1;
    started();
    await waitForRelease;
    return "cancelled";
  });
  const first = runCodexApprovalSession(session, presenter, signer());
  await presented;

  await assert.rejects(
    () => runCodexApprovalSession(session, presenter, signer()),
    expectAdapterError("codex-approval-session-active"),
  );
  assert.equal(calls, 1);
  release();
  assert.equal((await first).status, "cancelled");
});
