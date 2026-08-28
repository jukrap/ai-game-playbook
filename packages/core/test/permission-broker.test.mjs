import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

import { createValidRegistryDefinition } from "../../registry/test/fixtures/registry.mjs";
import { validPublicContractFixtures } from "../../registry/test/fixtures/public-contracts.mjs";

const now = Date.parse("2026-08-26T02:00:00.000Z");
const projectIdentityDigest = `sha256:${"c".repeat(64)}`;
const planDigest = `sha256:${"e".repeat(64)}`;
const editorSessionIdentityDigest = `sha256:${"f".repeat(64)}`;
const runId = "018f6f35-2c9e-7d1a-8a4b-123456789abd";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });

function featureContract() {
  const feature = structuredClone(validPublicContractFixtures["feature-contract"]);
  feature.approval.contractDigest =
    contracts.computeFeatureContractApprovalDigest(feature);
  return feature;
}

function brokerRegistry({
  approvalCheckpoint = false,
  inspectBudgetOverrides = {},
  workflowBudgetOverrides = {},
} = {}) {
  const definition = createValidRegistryDefinition();
  definition.schemas.push(contracts.approvalGrantSchema);
  definition.schemas.push(contracts.approvalPromptSchema);
  const inspect = definition.commands.find(({ id }) => id === "project.inspect");
  inspect.budgets = { ...inspect.budgets, ...inspectBudgetOverrides };
  const network = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  network.id = "provider.fetch";
  network.version = "1.0.0";
  network.summary = "Fetch data from one approved origin.";
  network.cli = { path: ["provider", "fetch"], aliases: [] };
  network.capabilities = ["provider.fetch"];
  network.permissions = ["network"];
  network.sideEffects = [
    { kind: "network", scope: "approved-origin", boundary: "network" },
  ];
  network.retry = { mode: "never", maxAttempts: 1 };
  network.handler = {
    package: "@ai-game-playbook/core",
    export: "fetchProviderData",
    digest: `sha256:${"9".repeat(64)}`,
  };
  const install = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  install.id = "pack.install-test";
  install.version = "1.0.0";
  install.summary = "Install content into explicitly approved project paths.";
  install.cli = { path: ["pack", "install-test"], aliases: [] };
  install.capabilities = ["pack.install-test"];
  install.permissions = ["install"];
  install.sideEffects = [
    { kind: "filesystem", scope: "approved-paths", boundary: "local" },
  ];
  install.lane = "project-write";
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
    export: "installPackContent",
    digest: `sha256:${"8".repeat(64)}`,
  };
  const hostInspection = structuredClone(
    definition.commands.find(({ id }) => id === "project.inspect"),
  );
  hostInspection.id = "engine.host-tool-inspect";
  hostInspection.version = "1.0.0";
  hostInspection.summary = "Inspect exact local host-tool identities.";
  hostInspection.cli = {
    path: ["internal", "engine", "host-tool-inspect"],
    aliases: [],
  };
  hostInspection.capabilities = ["engine.host-tool-inspect"];
  hostInspection.permissions = ["read-project", "host-tool-inspection"];
  hostInspection.sideEffects = [
    { kind: "none", scope: "exact-host-tools", boundary: "local" },
  ];
  hostInspection.handler = {
    package: "@ai-game-playbook/core",
    export: "inspectHostTools",
    digest: `sha256:${"7".repeat(64)}`,
  };
  definition.commands.push(network, install, hostInspection);
  const verifyStep = definition.workflows[0].steps.find(
    ({ id }) => id === "step.verify",
  );
  verifyStep.approvalCheckpoint = approvalCheckpoint;
  definition.workflows[0].budgets = {
    ...definition.workflows[0].budgets,
    ...workflowBudgetOverrides,
  };
  return registry.validateRegistry(definition);
}

function createBroker(overrides = {}) {
  return core.createPermissionBroker({
    registry: brokerRegistry(),
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
        maxCost: { currency: "USD", amount: "10.000000" },
      },
    },
    trustedApprovalKeys: [
      { keyId: "approval.local-key", publicKeyPem },
    ],
    now: () => now,
    ...overrides,
  });
}

function scope(overrides = {}) {
  return {
    paths: ["gameplay/collectibles/item.gd"],
    objectIds: [],
    destinations: [],
    dataClasses: [],
    changeKinds: [],
    publishTargets: [],
    ...overrides,
  };
}

function budgets(overrides = {}) {
  return {
    maxDurationMs: 30_000,
    maxOutputBytes: 1_048_576,
    maxRepairCycles: 0,
    ...overrides,
  };
}

function request(commandId, overrides = {}) {
  return {
    runId,
    projectId: "sample.graybox",
    projectIdentityDigest,
    commandId,
    input: { schemaVersion: "1.0.0" },
    scope: scope(),
    budgets: budgets(),
    deadlineAt: "2026-08-26T02:00:30.000Z",
    ...overrides,
  };
}

function signedGrant(challenge, permission, overrides = {}) {
  const subject = core.createApprovalGrantSubject(challenge, {
    grantId: `approval.${permission.replaceAll("-", ".")}`,
    permission,
    approvedAt: "2026-08-26T01:59:00.000Z",
    expiresAt: "2026-08-26T02:05:00.000Z",
    maxUses: 1,
    ...overrides,
  });
  const signature = sign(
    null,
    Buffer.from(contracts.computeApprovalGrantSigningDigest(subject), "utf8"),
    privateKey,
  ).toString("base64url");
  return {
    ...subject,
    signature: {
      algorithm: "ed25519",
      keyId: "approval.local-key",
      value: signature,
    },
  };
}

function expectCoreError(code) {
  return (error) =>
    error?.name === "CoreBoundaryError" && error?.code === code;
}

test("permission broker auto-authorizes bounded reads from a validated registry", () => {
  assert.equal(typeof core.createPermissionBroker, "function");
  const broker = createBroker();
  const decision = broker.authorize(request("project.inspect"), []);

  assert.equal(decision.status, "authorized");
  assert.deepEqual(decision.challenge.permissions, [
    { permission: "read-project", mode: "automatic" },
  ]);
  assert.deepEqual(decision.lease.grantIds, []);
  assert.equal(Object.isFrozen(decision.challenge), true);
  assert.equal(Object.isFrozen(decision.challenge.scope), true);
});

test("host-tool inspection requires one exact object-scoped approval", () => {
  assert.equal(contracts.PERMISSION_CLASSES.includes("host-tool-inspection"), true);
  const broker = createBroker();
  const hostRequest = request("engine.host-tool-inspect", {
    scope: scope({ objectIds: [`sha256:${"1".repeat(64)}`] }),
  });
  const pending = broker.authorize(hostRequest, []);

  assert.equal(pending.status, "approval-required");
  assert.deepEqual(pending.missingPermissions, ["host-tool-inspection"]);
  assert.deepEqual(pending.challenge.permissions, [
    { permission: "host-tool-inspection", mode: "approval-required" },
    { permission: "read-project", mode: "automatic" },
  ]);

  const grant = signedGrant(pending.challenge, "host-tool-inspection");
  const authorized = broker.authorize(hostRequest, [grant]);
  assert.equal(authorized.status, "authorized");
  assert.deepEqual(authorized.lease.grantIds, [grant.grantId]);

  assert.throws(
    () =>
      createBroker().authorize(
        request("engine.host-tool-inspect", {
          scope: scope({ objectIds: [] }),
        }),
        [],
      ),
    expectCoreError("permission-scope-invalid"),
  );
});

test("source and test authority require a current feature and registered workflow", () => {
  const broker = createBroker();
  const feature = featureContract();
  const verifyRequest = request("verify", {
    featureContract: feature,
    input: feature,
    workflow: {
      id: "workflow.verify-feature",
      stepId: "step.verify",
      resolvedPlanDigest: planDigest,
    },
  });
  const verified = broker.authorize(verifyRequest, []);
  assert.equal(verified.status, "authorized");
  assert.deepEqual(
    verified.challenge.permissions.map(({ mode }) => mode),
    ["automatic", "automatic"],
  );
  assert.equal(
    verified.challenge.inputDigest,
    contracts.digestCanonicalJson(feature),
  );
  assert.equal("input" in verified.challenge, false);

  assert.throws(
    () => broker.authorize(request("verify", { featureContract: feature }), []),
    expectCoreError("permission-workflow-invalid"),
  );
  assert.throws(
    () =>
      createBroker().authorize(
        request("engine.rollback", {
          featureContract: feature,
          input: feature,
          editorSessionIdentityDigest,
          scope: scope({
            paths: ["outside/not-approved.gd"],
            changeKinds: ["source"],
          }),
          budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
        }),
        [],
      ),
    expectCoreError("permission-feature-scope-invalid"),
  );

  assert.throws(
    () =>
      createBroker().authorize(
        request("engine.rollback", {
          featureContract: feature,
          input: feature,
          editorSessionIdentityDigest,
          scope: scope({
            objectIds: ["scene.collectible.001"],
            changeKinds: ["scene"],
          }),
          budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
        }),
        [],
      ),
    expectCoreError("permission-feature-scope-invalid"),
  );

  const differentInput = featureContract();
  differentInput.playerOutcome = "A different requested outcome.";
  differentInput.approval.contractDigest =
    contracts.computeFeatureContractApprovalDigest(differentInput);
  assert.throws(
    () =>
      broker.authorize(
        {
          ...verifyRequest,
          input: differentInput,
        },
        [],
      ),
    expectCoreError("permission-feature-invalid"),
  );
});

test("workflow authority accepts only the rollback command declared by the bound step", () => {
  const rollbackRegistry = brokerRegistry({
    workflowBudgetOverrides: {
      maxChangedFiles: 1,
      maxChangedBytes: 1024,
    },
  });
  const broker = createBroker({ registry: rollbackRegistry });
  const feature = featureContract();
  const rollbackRequest = request("engine.rollback", {
    featureContract: feature,
    input: feature,
    workflow: {
      id: "workflow.verify-feature",
      stepId: "step.verify",
      resolvedPlanDigest: planDigest,
    },
    editorSessionIdentityDigest,
    scope: scope({ changeKinds: ["source"] }),
    budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
  });
  const pending = broker.authorize(rollbackRequest, []);
  assert.equal(pending.status, "approval-required");
  const grant = signedGrant(pending.challenge, "editor-control");
  assert.equal(broker.authorize(rollbackRequest, [grant]).status, "authorized");

  assert.throws(
    () =>
      createBroker({ registry: rollbackRegistry }).authorize(
        {
          ...rollbackRequest,
          workflow: {
            ...rollbackRequest.workflow,
            stepId: "step.inspect",
          },
        },
        [],
      ),
    expectCoreError("permission-workflow-invalid"),
  );
});

test("filesystem installation requires at least one explicit target path", () => {
  const broker = createBroker();
  assert.throws(
    () =>
      broker.authorize(
        request("pack.install-test", {
          scope: scope({ paths: [] }),
          budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
        }),
        [],
      ),
    expectCoreError("permission-scope-invalid"),
  );

  assert.throws(
    () =>
      broker.authorize(
        request("pack.install-test", {
          scope: scope({
            paths: [".ai-game-playbook/packs/example"],
            objectIds: ["scene.collectible.001"],
          }),
          budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
        }),
        [],
      ),
    expectCoreError("permission-scope-invalid"),
  );
});

test("automatic test execution cannot imply filesystem or editor mutation", () => {
  const feature = featureContract();
  const verifyRequest = request("verify", {
    featureContract: feature,
    input: feature,
    workflow: {
      id: "workflow.verify-feature",
      stepId: "step.verify",
      resolvedPlanDigest: planDigest,
    },
  });
  const broker = createBroker();
  const decision = broker.authorize(verifyRequest, []);
  assert.equal(decision.status, "authorized");
  const settlement = decision.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: {
      changedPaths: ["gameplay/collectibles/item.gd"],
      changedBytes: 1,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 1,
      outputBytes: 0,
      repairCycles: 0,
    },
  });
  assert.equal(settlement.status, "scope-violation");
  assert.ok(
    settlement.violations.includes("undeclared-filesystem-mutation"),
  );

  assert.throws(
    () =>
      createBroker().authorize(
        {
          ...verifyRequest,
          scope: scope({ objectIds: ["scene.collectible.001"] }),
        },
        [],
      ),
    expectCoreError("permission-scope-invalid"),
  );
});

test("scope dimensions require their matching permission classes", () => {
  const broker = createBroker();
  const invalidRequests = [
    request("project.inspect", {
      scope: scope({ objectIds: ["scene.collectible.001"] }),
    }),
    request("project.inspect", {
      scope: scope({ changeKinds: ["source"] }),
    }),
    request("project.inspect", {
      scope: scope({ destinations: ["https://api.example.com"] }),
    }),
    request("project.inspect", {
      scope: scope({ dataClasses: ["project.source"] }),
    }),
    request("project.inspect", {
      scope: scope({ provider: "example", model: "example-v1" }),
    }),
    request("project.inspect", {
      scope: scope({ publishTargets: ["release.production"] }),
    }),
    request("project.inspect", { editorSessionIdentityDigest }),
  ];

  for (const invalidRequest of invalidRequests) {
    assert.throws(
      () => broker.authorize(invalidRequest, []),
      expectCoreError("permission-scope-invalid"),
    );
  }
});

test("workflow approval checkpoints turn test execution into a one-use grant", () => {
  const broker = createBroker({
    registry: brokerRegistry({ approvalCheckpoint: true }),
  });
  const feature = featureContract();
  const verifyRequest = request("verify", {
    featureContract: feature,
    input: feature,
    workflow: {
      id: "workflow.verify-feature",
      stepId: "step.verify",
      resolvedPlanDigest: planDigest,
    },
  });
  const pending = broker.authorize(verifyRequest, []);
  assert.equal(pending.status, "approval-required");
  assert.deepEqual(pending.missingPermissions, ["test-build"]);
  const grant = signedGrant(pending.challenge, "test-build");
  assert.equal(broker.authorize(verifyRequest, [grant]).status, "authorized");
});

test("explicit approvals are exact, signed, single-use, and consumed atomically", () => {
  const broker = createBroker();
  const networkRequest = request("provider.fetch", {
    scope: scope({ destinations: ["https://api.example.com"], paths: [] }),
  });
  const pending = broker.authorize(networkRequest, []);
  assert.equal(pending.status, "approval-required");
  assert.deepEqual(pending.missingPermissions, ["network"]);

  const grant = signedGrant(pending.challenge, "network");
  const authorized = broker.authorize(networkRequest, [grant]);
  assert.equal(authorized.status, "authorized");
  assert.deepEqual(authorized.lease.grantIds, [grant.grantId]);

  assert.throws(
    () => broker.authorize(networkRequest, [grant]),
    expectCoreError("permission-lease-state-invalid"),
  );
  const completed = authorized.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: ["https://api.example.com"],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 10,
      outputBytes: 10,
      repairCycles: 0,
    },
  });
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.actual.destinations, ["https://api.example.com"]);
  assert.equal(completed.actual.durationMs, 10);
  assert.equal(Object.isFrozen(completed.actual), true);
  assert.equal(Object.isFrozen(completed.actual.destinations), true);

  assert.throws(
    () => broker.authorize(networkRequest, [grant]),
    expectCoreError("permission-grant-exhausted"),
  );
  assert.throws(
    () =>
      broker.authorize(
        {
          ...networkRequest,
          scope: scope({ destinations: ["https://other.example.com"], paths: [] }),
        },
        [grant],
      ),
    expectCoreError("permission-grant-mismatch"),
  );

  const freshBroker = createBroker();
  const freshPending = freshBroker.authorize(networkRequest, []);
  const tampered = signedGrant(freshPending.challenge, "network");
  tampered.scope = {
    ...tampered.scope,
    destinations: ["https://other.example.com"],
  };
  assert.throws(
    () => freshBroker.authorize(networkRequest, [tampered]),
    expectCoreError("permission-grant-signature-invalid"),
  );
});

test("wrong project, expired approvals, and budget expansion fail closed", () => {
  const broker = createBroker();
  assert.throws(
    () =>
      broker.authorize(
        request("project.inspect", { projectId: "other.project" }),
        [],
      ),
    expectCoreError("permission-project-mismatch"),
  );
  assert.throws(
    () =>
      broker.authorize(
        request("project.inspect", {
          budgets: budgets({ maxOutputBytes: 8_388_608 }),
        }),
        [],
    ),
    expectCoreError("permission-budget-exceeded"),
  );
  const resourceBroker = createBroker({
    registry: brokerRegistry({
      inspectBudgetOverrides: { maxMemoryBytes: 268_435_456 },
    }),
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
        maxMemoryBytes: 536_870_912,
        maxCost: { currency: "USD", amount: "10.000000" },
      },
    },
  });
  assert.throws(
    () =>
      resourceBroker.authorize(
        request("project.inspect", {
          budgets: budgets({ maxMemoryBytes: 268_435_456 }),
        }),
        [],
      ),
    expectCoreError("permission-budget-exceeded"),
  );
  assert.throws(
    () =>
      broker.authorize(
        request("project.inspect", {
          input: { schemaVersion: "1.0.0", undeclared: true },
        }),
        [],
      ),
    expectCoreError("permission-input-invalid"),
  );

  const networkRequest = request("provider.fetch", {
    scope: scope({ destinations: ["https://api.example.com"], paths: [] }),
  });
  const pending = broker.authorize(networkRequest, []);
  const expired = signedGrant(pending.challenge, "network", {
    approvedAt: "2026-08-26T01:00:00.000Z",
    expiresAt: "2026-08-26T01:30:00.000Z",
  });
  assert.throws(
    () => broker.authorize(networkRequest, [expired]),
    expectCoreError("permission-grant-expired"),
  );

  const feature = featureContract();
  feature.approval.expiresAt = "2026-08-26T02:00:10.000Z";
  feature.approval.contractDigest =
    contracts.computeFeatureContractApprovalDigest(feature);
  assert.throws(
    () =>
      broker.authorize(
        request("verify", {
          featureContract: feature,
          input: feature,
          workflow: {
            id: "workflow.verify-feature",
            stepId: "step.verify",
            resolvedPlanDigest: planDigest,
          },
        }),
        [],
      ),
    expectCoreError("permission-feature-invalid"),
  );
});

test("settlement rejects undeclared effects and erects an uncertainty barrier", () => {
  const broker = createBroker();
  const feature = featureContract();
  const rollbackRequest = request("engine.rollback", {
    featureContract: feature,
    input: feature,
    editorSessionIdentityDigest,
    scope: scope({ changeKinds: ["source"] }),
    budgets: budgets({ maxChangedFiles: 1, maxChangedBytes: 1024 }),
  });
  const pending = broker.authorize(rollbackRequest, []);
  assert.equal(pending.status, "approval-required");
  assert.deepEqual(pending.missingPermissions, ["editor-control"]);
  const grant = signedGrant(pending.challenge, "editor-control", {
    maxUses: 2,
  });
  const decision = broker.authorize(rollbackRequest, [grant]);
  assert.equal(decision.status, "authorized");

  const settlement = decision.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: {
      changedPaths: ["outside/not-approved.gd"],
      changedBytes: 10,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: ["source"],
      publishTargets: [],
      durationMs: 10,
      outputBytes: 0,
      repairCycles: 0,
    },
  });
  assert.equal(settlement.status, "scope-violation");
  assert.equal(settlement.mutationUncertain, true);
  assert.throws(
    () => broker.authorize(rollbackRequest, [grant]),
    expectCoreError("permission-reconciliation-required"),
  );

  const inspection = broker.authorize(request("project.inspect"), []);
  assert.equal(inspection.status, "authorized");
  assert.throws(
    () => decision.lease.settle(settlement),
    expectCoreError("permission-lease-state-invalid"),
  );
});

test("malformed or uncertain side-effect settlement blocks another side effect", () => {
  const broker = createBroker();
  const networkRequest = request("provider.fetch", {
    scope: scope({ destinations: ["https://api.example.com"], paths: [] }),
  });
  const pending = broker.authorize(networkRequest, []);
  const grant = signedGrant(pending.challenge, "network");
  const decision = broker.authorize(networkRequest, [grant]);
  assert.equal(decision.status, "authorized");
  assert.throws(
    () => decision.lease.settle({ outcome: "succeeded" }),
    (error) =>
      expectCoreError("invalid-permission-request")(error) &&
      error.mutationUncertain === true,
  );
  assert.throws(
    () => broker.authorize(networkRequest, []),
    expectCoreError("permission-reconciliation-required"),
  );
});

test("read-only settlement cannot report mutation as success", () => {
  const broker = createBroker();
  const decision = broker.authorize(request("project.inspect"), []);
  assert.equal(decision.status, "authorized");
  const settlement = decision.lease.settle({
    outcome: "succeeded",
    mutationUncertain: false,
    actual: {
      changedPaths: ["gameplay/collectibles/item.gd"],
      changedBytes: 1,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: ["source"],
      publishTargets: [],
      durationMs: 1,
      outputBytes: 0,
      repairCycles: 0,
    },
  });
  assert.equal(settlement.status, "scope-violation");
  assert.equal(settlement.mutationUncertain, true);
  assert.ok(settlement.violations.includes("undeclared-mutation"));
});

test("permission broker rejects registry-shaped values that bypassed validation", () => {
  assert.throws(
    () => createBroker({ registry: createValidRegistryDefinition() }),
    TypeError,
  );
});

test("permission broker rejects unusable or failing clocks at the boundary", () => {
  for (const clock of [
    () => Number.MAX_SAFE_INTEGER,
    () => {
      throw new Error("clock unavailable");
    },
  ]) {
    const broker = createBroker({ now: clock });
    assert.throws(
      () => broker.authorize(request("project.inspect"), []),
      expectCoreError("invalid-permission-broker-options"),
    );
  }
});

test("approval prompt presents exact bounded authority without raw input", () => {
  const broker = createBroker();
  const installRequest = request("pack.install-test", {
    scope: scope({
      paths: [".agents/skills/gameplay.vertical-slice"],
    }),
    budgets: budgets({ maxChangedFiles: 16, maxChangedBytes: 65_536 }),
  });
  const challenge = broker.prepare(installRequest);
  const prompt = core.createPermissionApprovalPrompt(challenge);

  assert.equal(prompt.requestDigest, challenge.requestDigest);
  assert.equal(prompt.inputDigest, challenge.inputDigest);
  assert.equal("input" in prompt, false);
  assert.deepEqual(prompt.permissions, [
    {
      permission: "install",
      mode: "approval-required",
      impactClasses: [
        "project-files-change",
        "software-installation",
      ],
    },
  ]);
  assert.equal(
    prompt.promptDigest,
    contracts.computeApprovalPromptDigest(prompt),
  );
  assert.equal(Object.isFrozen(prompt), true);
  assert.equal(Object.isFrozen(prompt.project), true);
  assert.equal(Object.isFrozen(prompt.scope), true);
  assert.equal(Object.isFrozen(prompt.scope.paths), true);
  assert.equal(Object.isFrozen(prompt.budgets), true);
  assert.equal(Object.isFrozen(prompt.permissions), true);
  assert.equal(Object.isFrozen(prompt.permissions[0]), true);
  assert.equal(Object.isFrozen(prompt.permissions[0].impactClasses), true);
});

test("approval prompt is deterministic but only its original instance carries authority", () => {
  const broker = createBroker();
  const installRequest = request("pack.install-test", {
    scope: scope({
      paths: [".agents/skills/gameplay.vertical-slice"],
    }),
    budgets: budgets({ maxChangedFiles: 16, maxChangedBytes: 65_536 }),
  });
  const firstChallenge = broker.prepare(installRequest);
  const secondChallenge = broker.prepare(installRequest);
  const firstPrompt = core.createPermissionApprovalPrompt(firstChallenge);
  const secondPrompt = core.createPermissionApprovalPrompt(secondChallenge);
  const serializedPrompt = structuredClone(firstPrompt);
  const options = {
    grantId: "approval.install.once",
    permission: "install",
    approvedAt: "2026-08-26T01:59:00.000Z",
    expiresAt: "2026-08-26T02:05:00.000Z",
    maxUses: 1,
  };

  assert.deepEqual(firstPrompt, secondPrompt);
  assert.deepEqual(
    registry.validateRegisteredContractValue(
      brokerRegistry(),
      {
        schemaId: contracts.approvalPromptSchema.schemaId,
        digest: contracts.approvalPromptSchema.digest,
      },
      serializedPrompt,
    ),
    firstPrompt,
  );
  assert.deepEqual(
    core.createApprovalGrantSubjectFromPrompt(firstPrompt, options),
    core.createApprovalGrantSubject(firstChallenge, options),
  );
  assert.throws(
    () =>
      core.createApprovalGrantSubjectFromPrompt(
        serializedPrompt,
        options,
      ),
    expectCoreError("permission-prompt-invalid"),
  );
  assert.throws(
    () =>
      core.createApprovalGrantSubjectFromPrompt({ ...firstPrompt }, options),
    expectCoreError("permission-prompt-invalid"),
  );
});

test("approval presentation rejects untrusted objects without invoking them", () => {
  let accessorReads = 0;
  const accessor = Object.defineProperty({}, "schemaVersion", {
    enumerable: true,
    get() {
      accessorReads += 1;
      return "1.0.0";
    },
  });
  let proxyReads = 0;
  const proxy = new Proxy(
    {},
    {
      get() {
        proxyReads += 1;
        return undefined;
      },
    },
  );

  assert.throws(
    () => core.createPermissionApprovalPrompt(accessor),
    expectCoreError("permission-prompt-invalid"),
  );
  assert.throws(
    () => core.createPermissionApprovalPrompt(proxy),
    expectCoreError("permission-prompt-invalid"),
  );
  assert.equal(accessorReads, 0);
  assert.equal(proxyReads, 0);
});
