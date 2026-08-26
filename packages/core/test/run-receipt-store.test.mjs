import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "@ai-game-playbook/registry";
import * as core from "../dist/index.js";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_RUN_ID = "223e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = "project.evidence-fixture";
const WORKFLOW_ID = "workflow.evidence-fixture";
const PLAN_DIGEST = contracts.sha256Digest("evidence fixture plan");
const INPUT_DIGEST = contracts.sha256Digest("evidence fixture input");
const RECEIPT_IDS = [
  "523e4567-e89b-42d3-a456-426614174000",
  "523e4567-e89b-42d3-a456-426614174001",
  "523e4567-e89b-42d3-a456-426614174002",
  "523e4567-e89b-42d3-a456-426614174003",
];
const AUTHORIZATION_IDS = [
  "623e4567-e89b-42d3-a456-426614174000",
  "623e4567-e89b-42d3-a456-426614174001",
  "623e4567-e89b-42d3-a456-426614174002",
  "623e4567-e89b-42d3-a456-426614174003",
];

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

function platform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function architecture() {
  return process.arch === "arm64" ? "arm64" : "x64";
}

async function fixture(t, { initialize = true } = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-receipt-store-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  const root = await core.canonicalizeProjectRoot(project);
  if (initialize) await core.initializeProjectState({ root });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return { project, root, sandbox };
}

function command() {
  const found = registry.BUILTIN_REGISTRY.commands.find(
    (candidate) => candidate.id === "doctor",
  );
  assert.ok(found);
  return found;
}

function receipt({
  ordinal = 0,
  runId = RUN_ID,
  receiptId = RECEIPT_IDS[ordinal],
  authorizationId = AUTHORIZATION_IDS[ordinal],
  projectIdentityDigest,
  previousReceiptDigest,
  artifacts = [],
  diagnostics = [],
  innerMessage = "Evidence receipt completed.",
} = {}) {
  const descriptor = command();
  const started = Date.UTC(2026, 7, 26, 12, 0, ordinal);
  const ended = started + 10;
  const value = {
    schemaVersion: "1.0.0",
    receiptId,
    ...(previousReceiptDigest === undefined ? {} : { previousReceiptDigest }),
    status: "succeeded",
    identity: {
      runId,
      workflowId: WORKFLOW_ID,
      stepId: `step.receipt-${ordinal + 1}`,
      attempt: ordinal + 1,
      phase: "command",
      projectId: PROJECT_ID,
      resolvedPlanDigest: PLAN_DIGEST,
    },
    authority: {
      command: {
        id: descriptor.id,
        version: descriptor.version,
        descriptorDigest: contracts.digestCanonicalJson(descriptor),
      },
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      handlerDigest: descriptor.handler.digest,
      inputDigest: INPUT_DIGEST,
      authorizationId,
      authorizationRequestDigest: contracts.sha256Digest(
        `authorization request ${ordinal}`,
      ),
      packDigests: [],
      approvalIds: [],
    },
    environment: {
      platform: platform(),
      architecture: architecture(),
      nodeVersion: process.versions.node,
      projectIdentityDigest,
    },
    timing: {
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: 10,
    },
    effects: {
      changedPaths: [],
      changedBytes: 0,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: [],
      publishTargets: [],
      durationMs: 10,
      outputBytes: 0,
      repairCycles: 0,
    },
    outcomes: {
      outer: { status: "passed", exitCode: 0, timedOut: false },
      inner: { status: "passed", code: "evidence-stored", message: innerMessage },
    },
    mutation: {
      status: "none",
      changedFiles: [],
      unexpectedDirtyFiles: [],
    },
    artifacts,
    diagnostics,
    recovery: { attempted: false, outcome: "not-run", actions: [] },
    receiptDigest: contracts.sha256Digest("placeholder"),
  };
  value.receiptDigest = contracts.computeRunReceiptDigest(value);
  return value;
}

function loadRequest(root, maxArtifactBytes = 0) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    runId: RUN_ID,
    projectId: PROJECT_ID,
    projectIdentityDigest: root.identityDigest,
    workflowId: WORKFLOW_ID,
    resolvedPlanDigest: PLAN_DIGEST,
    maxArtifactBytes,
  };
}

function queryRequest(root, overrides = {}) {
  return {
    root,
    registry: registry.BUILTIN_REGISTRY,
    maxEntries: 32,
    maxHeads: 8,
    maxTotalHeadBytes: 128 * 1024,
    ...overrides,
  };
}

function receiptStoreDirectory(project) {
  return join(project, ".ai-game-playbook", "evidence", "receipts");
}

async function currentHeadFile(project, runId = RUN_ID) {
  return join(receiptStoreDirectory(project), `${runId}.head.json`);
}

async function rewriteHead(project, mutate, runId = RUN_ID) {
  const path = await currentHeadFile(project, runId);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  const { headDigest: _headDigest, ...body } = parsed;
  const changedBody = mutate(body);
  const changed = {
    ...changedBody,
    headDigest: contracts.digestCanonicalJson({
      domain: "ai-game-playbook.run-receipt-head",
      version: "1",
      subject: changedBody,
    }),
  };
  await writeFile(path, `${contracts.canonicalizeJson(changed)}\n`);
}

test("run receipts persist as a canonical append-only head and reload", async (t) => {
  assert.equal(typeof core.persistRunReceipt, "function");
  assert.equal(typeof core.loadRunReceiptChain, "function");
  assert.equal(
    core.RUN_RECEIPT_STORE_PATH,
    ".ai-game-playbook/evidence/receipts",
  );

  const { project, root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const stored = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });

  assert.equal(Object.isFrozen(stored), true);
  assert.equal(stored.rootIdentityDigest, root.identityDigest);
  assert.equal(stored.chainLength, 1);
  assert.deepEqual(stored.receipt, firstReceipt);

  const storeDirectory = join(
    project,
    ".ai-game-playbook",
    "evidence",
    "receipts",
  );
  const files = (await readdir(storeDirectory)).sort();
  assert.equal(files.length, 2);
  assert.equal(files.some((name) => name.endsWith(".head.json")), true);
  assert.equal(files.some((name) => name.endsWith(".receipt.json")), true);
  for (const file of files) {
    const text = await readFile(join(storeDirectory, file), "utf8");
    assert.equal(text.endsWith("\n"), true);
    assert.equal(text.includes(project), false);
  }

  const loaded = await core.loadRunReceiptChain(loadRequest(root));
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.receipts), true);
  assert.equal(Object.isFrozen(loaded.receipts[0]), true);
  assert.equal(Object.isFrozen(loaded.receipts[0].authority), true);
  assert.equal(loaded.stored.chainLength, 1);
  assert.deepEqual(loaded.receipts, [firstReceipt]);

  const repeated = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });
  assert.equal(repeated.headDigest, stored.headDigest);
  assert.deepEqual((await readdir(storeDirectory)).sort(), files);
});

test("receipt chains append from same-process or reloaded authority", async (t) => {
  const { root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const first = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });
  const secondReceipt = receipt({
    ordinal: 1,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: firstReceipt.receiptDigest,
  });

  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: secondReceipt,
      previous: structuredClone(first),
      maxArtifactBytes: 0,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );

  const second = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: secondReceipt,
    previous: first,
    maxArtifactBytes: 0,
  });
  assert.equal(second.chainLength, 2);

  const reloaded = await core.loadRunReceiptChain(loadRequest(root));
  assert.deepEqual(reloaded.receipts, [firstReceipt, secondReceipt]);
  const thirdReceipt = receipt({
    ordinal: 2,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: secondReceipt.receiptDigest,
  });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: thirdReceipt,
    previous: reloaded.stored,
    maxArtifactBytes: 0,
  });

  const complete = await core.loadRunReceiptChain(loadRequest(root));
  assert.deepEqual(complete.receipts, [
    firstReceipt,
    secondReceipt,
    thirdReceipt,
  ]);
});

test("competing receipt successors cannot replace the accepted head", async (t) => {
  const { root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const first = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });
  const candidates = [1, 2].map((ordinal) =>
    receipt({
      ordinal,
      projectIdentityDigest: root.identityDigest,
      previousReceiptDigest: firstReceipt.receiptDigest,
    }),
  );

  const results = await Promise.allSettled(
    candidates.map((candidate) =>
      core.persistRunReceipt({
        root,
        registry: registry.BUILTIN_REGISTRY,
        receipt: candidate,
        previous: first,
        maxArtifactBytes: 0,
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "run-receipt-store-conflict");

  const loaded = await core.loadRunReceiptChain(loadRequest(root));
  assert.equal(loaded.receipts.length, 2);
  assert.equal(
    candidates.some(
      (candidate) =>
        candidate.receiptDigest === loaded.receipts[1].receiptDigest,
    ),
    true,
  );
});

test("receipt authority and load identity remain exact", async (t) => {
  const { root } = await fixture(t);
  const wrongProjectIdentity = receipt({
    projectIdentityDigest: contracts.sha256Digest("wrong project identity"),
  });
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: wrongProjectIdentity,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );

  const wrongEnvironment = receipt({
    projectIdentityDigest: root.identityDigest,
  });
  wrongEnvironment.environment.nodeVersion = "0.0.0";
  wrongEnvironment.receiptDigest =
    contracts.computeRunReceiptDigest(wrongEnvironment);
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: wrongEnvironment,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );

  const wrongAuthority = receipt({ projectIdentityDigest: root.identityDigest });
  wrongAuthority.authority.handlerDigest = contracts.sha256Digest("wrong handler");
  wrongAuthority.receiptDigest = contracts.computeRunReceiptDigest(wrongAuthority);

  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: wrongAuthority,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );

  const valid = receipt({ projectIdentityDigest: root.identityDigest });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: valid,
    maxArtifactBytes: 0,
  });
  await assert.rejects(
    core.loadRunReceiptChain({
      ...loadRequest(root),
      projectId: "project.other",
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );
  await assert.rejects(
    core.loadRunReceiptChain({
      ...loadRequest(root),
      projectIdentityDigest: contracts.sha256Digest("forged root identity"),
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );
  await assert.rejects(
    core.loadRunReceiptChain({
      ...loadRequest(root),
      undeclared: true,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
  await assert.rejects(
    core.loadRunReceiptChain({
      ...loadRequest(root),
      registry: structuredClone(registry.BUILTIN_REGISTRY),
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: valid,
      maxArtifactBytes: -1,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
});

test("run UUIDs use one lowercase path-safe spelling", async (t) => {
  const uppercase = await fixture(t);
  const uppercaseReceipt = receipt({
    projectIdentityDigest: uppercase.root.identityDigest,
  });
  uppercaseReceipt.identity.runId = RUN_ID.toUpperCase();
  uppercaseReceipt.receiptId = RECEIPT_IDS[0].toUpperCase();
  uppercaseReceipt.receiptDigest =
    contracts.computeRunReceiptDigest(uppercaseReceipt);
  await assert.rejects(
    core.persistRunReceipt({
      root: uppercase.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: uppercaseReceipt,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-receipt-invalid"),
  );
  assert.deepEqual(
    await readdir(
      join(
        uppercase.project,
        ".ai-game-playbook",
        "evidence",
        "receipts",
      ),
    ),
    [],
  );

  const pathUnsafe = await fixture(t);
  const pathUnsafeReceipt = receipt({
    projectIdentityDigest: pathUnsafe.root.identityDigest,
  });
  pathUnsafeReceipt.identity.runId = `urn:uuid:${RUN_ID}`;
  pathUnsafeReceipt.receiptDigest =
    contracts.computeRunReceiptDigest(pathUnsafeReceipt);
  await assert.rejects(
    core.persistRunReceipt({
      root: pathUnsafe.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: pathUnsafeReceipt,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-receipt-invalid"),
  );
  assert.deepEqual(
    await readdir(
      join(
        pathUnsafe.project,
        ".ai-game-playbook",
        "evidence",
        "receipts",
      ),
    ),
    [],
  );
});

test("receipt calls snapshot input and reject duplicate run attempts", async (t) => {
  const { root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const expected = structuredClone(firstReceipt);
  const request = {
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  };
  const pending = core.persistRunReceipt(request);
  firstReceipt.outcomes.inner.message = "mutated after dispatch";
  request.maxArtifactBytes = 1;
  const first = await pending;
  assert.deepEqual(first.receipt, expected);

  const duplicateAttempt = receipt({
    ordinal: 1,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: expected.receiptDigest,
  });
  duplicateAttempt.identity.stepId = expected.identity.stepId;
  duplicateAttempt.identity.attempt = expected.identity.attempt;
  duplicateAttempt.receiptDigest =
    contracts.computeRunReceiptDigest(duplicateAttempt);
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: duplicateAttempt,
      previous: first,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );

  const wrongPredecessor = receipt({
    ordinal: 2,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: contracts.sha256Digest("wrong predecessor"),
  });
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: wrongPredecessor,
      previous: first,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );
});

test("promoted artifact locators are bounded, reopenable, and drift-sensitive", async (t) => {
  const { project, root } = await fixture(t);
  await mkdir(join(project, "artifacts"));
  const content = "verified artifact\n";
  const artifactPath = "artifacts/verified.txt";
  await writeFile(join(project, "artifacts", "verified.txt"), content, "utf8");
  const artifact = {
    artifactId: "artifact.verified-output",
    kind: "command-output",
    path: artifactPath,
    digest: contracts.sha256Digest(content),
    bytes: Buffer.byteLength(content, "utf8"),
    complete: true,
    createdAt: new Date(Date.UTC(2026, 7, 26, 12, 0, 0, 10)).toISOString(),
    commandId: "doctor",
  };
  const draft = receipt({
    projectIdentityDigest: root.identityDigest,
    artifacts: [artifact],
  });
  const promoted = await core.promoteRunReceiptArtifacts({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: draft,
    maxArtifactBytes: artifact.bytes,
  });
  const value = promoted.receipt;

  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: value,
      maxArtifactBytes: artifact.bytes - 1,
    }),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );
  const stored = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: value,
    maxArtifactBytes: artifact.bytes,
  });
  assert.equal(stored.chainLength, 1);
  await core.loadRunReceiptChain(loadRequest(root, artifact.bytes));

  await writeFile(
    join(project, ...value.artifacts[0].path.split("/")),
    "changed artifact\n",
    "utf8",
  );
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(root, artifact.bytes)),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
});

test("idempotent append retries revalidate the durable head and artifacts", async (t) => {
  const { project, root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const first = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });
  await mkdir(join(project, "artifacts"));
  const content = "append artifact\n";
  const artifactPath = "artifacts/append.txt";
  await writeFile(join(project, "artifacts", "append.txt"), content, "utf8");
  const artifact = {
    artifactId: "artifact.append-output",
    kind: "command-output",
    path: artifactPath,
    digest: contracts.sha256Digest(content),
    bytes: Buffer.byteLength(content, "utf8"),
    complete: true,
    createdAt: new Date(Date.UTC(2026, 7, 26, 12, 0, 1, 10)).toISOString(),
    commandId: "doctor",
  };
  const secondDraft = receipt({
    ordinal: 1,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: firstReceipt.receiptDigest,
    artifacts: [artifact],
  });
  const secondReceipt = (
    await core.promoteRunReceiptArtifacts({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: secondDraft,
      maxArtifactBytes: artifact.bytes,
    })
  ).receipt;
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: secondReceipt,
    previous: first,
    maxArtifactBytes: artifact.bytes,
  });

  await writeFile(
    join(project, ...secondReceipt.artifacts[0].path.split("/")),
    "drifted\n",
    "utf8",
  );
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: secondReceipt,
      previous: first,
      maxArtifactBytes: artifact.bytes,
    }),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
});

test("artifact metadata cannot bypass completion or store boundaries", async (t) => {
  const missing = await fixture(t);
  const missingArtifact = {
    artifactId: "artifact.missing-output",
    kind: "command-output",
    path: "artifacts/missing.txt",
    digest: contracts.sha256Digest("missing artifact"),
    bytes: 16,
    complete: true,
    createdAt: new Date(Date.UTC(2026, 7, 26, 12, 0, 0, 10)).toISOString(),
    commandId: "doctor",
  };
  const missingReceipt = receipt({
    projectIdentityDigest: missing.root.identityDigest,
    artifacts: [missingArtifact],
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: missing.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: missingReceipt,
      maxArtifactBytes: missingArtifact.bytes,
    }),
    expectCoreError("run-receipt-store-artifact-invalid"),
  );
  assert.deepEqual(
    await readdir(
      join(
        missing.project,
        ".ai-game-playbook",
        "evidence",
        "receipts",
      ),
    ),
    [],
  );

  const incomplete = await fixture(t);
  const incompleteArtifact = {
    ...missingArtifact,
    artifactId: "artifact.incomplete-output",
    complete: false,
  };
  const incompleteReceipt = receipt({
    projectIdentityDigest: incomplete.root.identityDigest,
    artifacts: [incompleteArtifact],
  });
  await core.persistRunReceipt({
    root: incomplete.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: incompleteReceipt,
    maxArtifactBytes: 0,
  });
  const loaded = await core.loadRunReceiptChain(loadRequest(incomplete.root));
  assert.equal(loaded.receipts[0].artifacts[0].complete, false);

  const circular = await fixture(t);
  const circularArtifact = {
    ...missingArtifact,
    artifactId: "artifact.circular-output",
    path: `${core.RUN_RECEIPT_STORE_PATH}/forbidden.txt`,
  };
  const circularReceipt = receipt({
    projectIdentityDigest: circular.root.identityDigest,
    artifacts: [circularArtifact],
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: circular.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: circularReceipt,
      maxArtifactBytes: circularArtifact.bytes,
    }),
    expectCoreError("run-receipt-store-receipt-invalid"),
  );
  const caseVariantReceipt = receipt({
    ordinal: 1,
    projectIdentityDigest: circular.root.identityDigest,
    artifacts: [
      {
        ...circularArtifact,
        artifactId: "artifact.circular-case-output",
        path: ".AI-GAME-PLAYBOOK/EVIDENCE/RECEIPTS/forbidden.txt",
        createdAt: new Date(
          Date.UTC(2026, 7, 26, 12, 0, 1, 10),
        ).toISOString(),
      },
    ],
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: circular.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: caseVariantReceipt,
      maxArtifactBytes: circularArtifact.bytes,
    }),
    expectCoreError("run-receipt-store-receipt-invalid"),
  );
});

test("receipt count and byte budgets fail before durable writes", async (t) => {
  const { project, root } = await fixture(t);
  const tooManyArtifacts = Array.from(
    { length: core.RUN_RECEIPT_MAX_ARTIFACTS + 1 },
    (_, index) => ({
      artifactId: `artifact.incomplete-${index}`,
      kind: "command-output",
      path: `artifacts/incomplete-${index}.txt`,
      digest: contracts.sha256Digest(""),
      bytes: 0,
      complete: false,
      createdAt: new Date(
        Date.UTC(2026, 7, 26, 12, 0, 0, 10),
      ).toISOString(),
      commandId: "doctor",
    }),
  );
  const artifactHeavy = receipt({
    projectIdentityDigest: root.identityDigest,
    artifacts: tooManyArtifacts,
  });
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: artifactHeavy,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );

  const oversized = receipt({ projectIdentityDigest: root.identityDigest });
  oversized.diagnostics = Array.from({ length: 300 }, (_, index) => ({
    severity: "info",
    code: `oversized.diagnostic-${index}`,
    message: "x".repeat(4000),
    redacted: true,
  }));
  oversized.receiptDigest = contracts.computeRunReceiptDigest(oversized);
  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: oversized,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );
  assert.deepEqual(
    await readdir(
      join(project, ".ai-game-playbook", "evidence", "receipts"),
    ),
    [],
  );
});

test("missing stores, unsafe diagnostics, and corrupt heads fail closed", async (t) => {
  const missing = await fixture(t, { initialize: false });
  const missingReceipt = receipt({
    projectIdentityDigest: missing.root.identityDigest,
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: missing.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: missingReceipt,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-not-found"),
  );
  assert.deepEqual(await readdir(missing.project), []);

  const unsafe = await fixture(t);
  const unsafeReceipt = receipt({
    projectIdentityDigest: unsafe.root.identityDigest,
    diagnostics: [
      {
        severity: "warning",
        code: "unsafe-diagnostic",
        message: "Diagnostic was not reviewed for durable storage.",
        redacted: false,
      },
    ],
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: unsafe.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: unsafeReceipt,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-redaction-required"),
  );
  const pathLeak = receipt({
    ordinal: 1,
    projectIdentityDigest: unsafe.root.identityDigest,
    innerMessage: "Failure occurred under C:\\Users\\person\\project.",
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: unsafe.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: pathLeak,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-redaction-required"),
  );
  const freeTextLeak = receipt({
    ordinal: 2,
    projectIdentityDigest: unsafe.root.identityDigest,
  });
  freeTextLeak.effects.destinations = ["C:\\private\\upload-target"];
  freeTextLeak.receiptDigest = contracts.computeRunReceiptDigest(freeTextLeak);
  await assert.rejects(
    core.persistRunReceipt({
      root: unsafe.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: freeTextLeak,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-redaction-required"),
  );
  const credentialLeak = receipt({
    ordinal: 3,
    projectIdentityDigest: unsafe.root.identityDigest,
    innerMessage:
      "Credential eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturevalue must not persist under /root/private/token.txt.",
  });
  await assert.rejects(
    core.persistRunReceipt({
      root: unsafe.root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: credentialLeak,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-redaction-required"),
  );

  const valid = receipt({ projectIdentityDigest: unsafe.root.identityDigest });
  await core.persistRunReceipt({
    root: unsafe.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: valid,
    maxArtifactBytes: 0,
  });
  const storeDirectory = join(
    unsafe.project,
    ".ai-game-playbook",
    "evidence",
    "receipts",
  );
  const head = (await readdir(storeDirectory)).find((name) =>
    name.endsWith(".head.json"),
  );
  assert.ok(head);
  await writeFile(join(storeDirectory, head), '{"schemaVersion":"1.0.0"}\n');
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(unsafe.root)),
    expectCoreError("run-receipt-store-corrupt"),
  );
  assert.equal(
    await readFile(join(storeDirectory, head), "utf8"),
    '{"schemaVersion":"1.0.0"}\n',
  );
});

test("missing or changed receipt records are preserved as corruption", async (t) => {
  const { project, root } = await fixture(t);
  const value = receipt({ projectIdentityDigest: root.identityDigest });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: value,
    maxArtifactBytes: 0,
  });
  const storeDirectory = join(
    project,
    ".ai-game-playbook",
    "evidence",
    "receipts",
  );
  const record = (await readdir(storeDirectory)).find((name) =>
    name.endsWith(".receipt.json"),
  );
  assert.ok(record);
  const recordPath = join(storeDirectory, record);
  await writeFile(recordPath, '{"schemaVersion":"1.0.0"}\n');
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(root)),
    expectCoreError("run-receipt-store-corrupt"),
  );
  assert.equal(
    await readFile(recordPath, "utf8"),
    '{"schemaVersion":"1.0.0"}\n',
  );

  await rm(recordPath);
  await assert.rejects(
    core.loadRunReceiptChain(loadRequest(root)),
    expectCoreError("run-receipt-store-corrupt"),
  );
  assert.equal(
    (await readdir(storeDirectory)).some((name) => name.endsWith(".head.json")),
    true,
  );
});

test("receipt storage refuses a directory relocated outside the project", async (t) => {
  const { project, root, sandbox } = await fixture(t);
  const storeDirectory = join(
    project,
    ".ai-game-playbook",
    "evidence",
    "receipts",
  );
  const outside = join(sandbox, "outside-receipts");
  await mkdir(outside);
  await rm(storeDirectory, { recursive: true });
  await symlink(
    outside,
    storeDirectory,
    process.platform === "win32" ? "junction" : "dir",
  );
  const value = receipt({ projectIdentityDigest: root.identityDigest });

  await assert.rejects(
    core.persistRunReceipt({
      root,
      registry: registry.BUILTIN_REGISTRY,
      receipt: value,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-corrupt"),
  );
  assert.deepEqual(await readdir(outside), []);
});

test("receipt head queries are bounded, deterministic, and explicit about validation level", async (t) => {
  assert.equal(typeof core.queryRunReceiptHeads, "function");
  assert.equal(typeof core.loadQueriedRunReceiptChain, "function");
  assert.equal(core.RUN_RECEIPT_QUERY_MAX_ENTRIES, 16_384);
  assert.equal(core.RUN_RECEIPT_QUERY_MAX_HEADS, 1_024);
  assert.equal(core.RUN_RECEIPT_QUERY_MAX_TOTAL_HEAD_BYTES, 16 * 1024 * 1024);

  const { project, root } = await fixture(t);
  const empty = await core.queryRunReceiptHeads(queryRequest(root));
  assert.deepEqual(empty, {
    validationLevel: "head-and-latest-record-presence",
    rootIdentityDigest: root.identityDigest,
    registryDigest: registry.BUILTIN_REGISTRY.digest,
    entriesObserved: 0,
    headFilesObserved: 0,
    recordFilesObserved: 0,
    heads: [],
  });
  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(empty.heads), true);

  const value = receipt({ projectIdentityDigest: root.identityDigest });
  const stored = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: value,
    maxArtifactBytes: 0,
  });
  const query = await core.queryRunReceiptHeads(queryRequest(root));
  assert.deepEqual(query, {
    validationLevel: "head-and-latest-record-presence",
    rootIdentityDigest: root.identityDigest,
    registryDigest: registry.BUILTIN_REGISTRY.digest,
    entriesObserved: 2,
    headFilesObserved: 1,
    recordFilesObserved: 1,
    heads: [
      {
        runId: RUN_ID,
        projectId: PROJECT_ID,
        projectIdentityDigest: root.identityDigest,
        projectAuthority: "current",
        workflowId: WORKFLOW_ID,
        resolvedPlanDigest: PLAN_DIGEST,
        registryDigest: registry.BUILTIN_REGISTRY.digest,
        registryAuthority: "current",
        receiptId: value.receiptId,
        sequence: 0,
        chainLength: 1,
        receiptDigest: value.receiptDigest,
        endedAt: value.timing.endedAt,
        headDigest: stored.headDigest,
      },
    ],
  });
  assert.equal(Object.isFrozen(query), true);
  assert.equal(Object.isFrozen(query.heads), true);
  assert.equal(Object.isFrozen(query.heads[0]), true);
  assert.equal("receipts" in query, false);
  assert.equal(JSON.stringify(query).includes(project), false);

  const loaded = await core.loadQueriedRunReceiptChain({
    query,
    runId: RUN_ID,
    maxArtifactBytes: 0,
  });
  assert.deepEqual(loaded.receipts, [value]);

  const repeated = await core.queryRunReceiptHeads(queryRequest(root));
  assert.deepEqual(repeated, query);
});

test("receipt head query requests and query witnesses cannot be forged", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(
    core.queryRunReceiptHeads({
      ...queryRequest(root),
      unexpected: true,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
  await assert.rejects(
    core.queryRunReceiptHeads(
      queryRequest(root, {
        maxEntries: core.RUN_RECEIPT_QUERY_MAX_ENTRIES + 1,
      }),
    ),
    expectCoreError("invalid-run-receipt-store-request"),
  );
  await assert.rejects(
    core.queryRunReceiptHeads(
      queryRequest(root, {
        registry: JSON.parse(JSON.stringify(registry.BUILTIN_REGISTRY)),
      }),
    ),
    expectCoreError("invalid-run-receipt-store-request"),
  );

  const value = receipt({ projectIdentityDigest: root.identityDigest });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: value,
    maxArtifactBytes: 0,
  });
  const query = await core.queryRunReceiptHeads(queryRequest(root));
  const copied = JSON.parse(JSON.stringify(query));
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query: copied,
      runId: RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query,
      runId: SECOND_RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-not-found"),
  );
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query,
      runId: RUN_ID,
      maxArtifactBytes: 0,
      unexpected: true,
    }),
    expectCoreError("invalid-run-receipt-store-request"),
  );
});

test("receipt head query budgets fail without partial results", async (t) => {
  const { root } = await fixture(t);
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: root.identityDigest }),
    maxArtifactBytes: 0,
  });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({
      runId: SECOND_RUN_ID,
      receiptId: "723e4567-e89b-42d3-a456-426614174000",
      authorizationId: "823e4567-e89b-42d3-a456-426614174000",
      projectIdentityDigest: root.identityDigest,
    }),
    maxArtifactBytes: 0,
  });

  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(root, { maxEntries: 1 })),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(root, { maxHeads: 1 })),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(root, { maxTotalHeadBytes: 1 })),
    expectCoreError("run-receipt-store-budget-exceeded"),
  );
  const complete = await core.queryRunReceiptHeads(queryRequest(root));
  assert.deepEqual(
    complete.heads.map((head) => head.runId),
    [RUN_ID, SECOND_RUN_ID],
  );
});

test("receipt head query preserves stale and foreign authority without loading it", async (t) => {
  const stale = await fixture(t);
  await core.persistRunReceipt({
    root: stale.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: stale.root.identityDigest }),
    maxArtifactBytes: 0,
  });
  const staleRegistryDigest = contracts.sha256Digest("stale registry");
  await rewriteHead(stale.project, (head) => ({
    ...head,
    registryDigest: staleRegistryDigest,
  }));
  const staleQuery = await core.queryRunReceiptHeads(queryRequest(stale.root));
  assert.equal(staleQuery.heads[0].projectAuthority, "current");
  assert.equal(staleQuery.heads[0].registryAuthority, "stale");
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query: staleQuery,
      runId: RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );

  const foreign = await fixture(t);
  await core.persistRunReceipt({
    root: foreign.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: foreign.root.identityDigest }),
    maxArtifactBytes: 0,
  });
  const foreignDigest = contracts.sha256Digest("foreign project root");
  await rewriteHead(foreign.project, (head) => ({
    ...head,
    projectIdentityDigest: foreignDigest,
  }));
  const foreignQuery = await core.queryRunReceiptHeads(queryRequest(foreign.root));
  assert.equal(foreignQuery.heads[0].projectAuthority, "foreign");
  assert.equal(foreignQuery.heads[0].registryAuthority, "current");
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query: foreignQuery,
      runId: RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-mismatch"),
  );
});

test("receipt head query rejects unknown, non-file, mismatched, and incomplete entries", async (t) => {
  const unknown = await fixture(t);
  await writeFile(join(receiptStoreDirectory(unknown.project), "unexpected.tmp"), "x");
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(unknown.root)),
    expectCoreError("run-receipt-store-corrupt"),
  );

  const nonFile = await fixture(t);
  await mkdir(
    join(receiptStoreDirectory(nonFile.project), `${SECOND_RUN_ID}.head.json`),
  );
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(nonFile.root)),
    expectCoreError("run-receipt-store-corrupt"),
  );

  const mismatched = await fixture(t);
  await core.persistRunReceipt({
    root: mismatched.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: mismatched.root.identityDigest }),
    maxArtifactBytes: 0,
  });
  const originalHead = await readFile(
    await currentHeadFile(mismatched.project),
    "utf8",
  );
  await writeFile(
    await currentHeadFile(mismatched.project, SECOND_RUN_ID),
    originalHead,
  );
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(mismatched.root)),
    expectCoreError("run-receipt-store-corrupt"),
  );

  const incomplete = await fixture(t);
  await core.persistRunReceipt({
    root: incomplete.root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: incomplete.root.identityDigest }),
    maxArtifactBytes: 0,
  });
  const record = (await readdir(receiptStoreDirectory(incomplete.project))).find(
    (name) => name.endsWith(".receipt.json"),
  );
  assert.ok(record);
  await rm(join(receiptStoreDirectory(incomplete.project), record));
  await assert.rejects(
    core.queryRunReceiptHeads(queryRequest(incomplete.root)),
    expectCoreError("run-receipt-store-corrupt"),
  );
});

test("receipt head query does not promote malformed record content to full validation", async (t) => {
  const { project, root } = await fixture(t);
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: root.identityDigest }),
    maxArtifactBytes: 0,
  });
  const record = (await readdir(receiptStoreDirectory(project))).find((name) =>
    name.endsWith(".receipt.json"),
  );
  assert.ok(record);
  await writeFile(
    join(receiptStoreDirectory(project), record),
    '{"schemaVersion":"1.0.0"}\n',
  );

  const query = await core.queryRunReceiptHeads(queryRequest(root));
  assert.equal(query.validationLevel, "head-and-latest-record-presence");
  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query,
      runId: RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-corrupt"),
  );
});

test("receipt head query counts canonical records without claiming reachability", async (t) => {
  const { project, root } = await fixture(t);
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: receipt({ projectIdentityDigest: root.identityDigest }),
    maxArtifactBytes: 0,
  });
  await rm(await currentHeadFile(project));

  const query = await core.queryRunReceiptHeads(queryRequest(root));
  assert.equal(query.entriesObserved, 1);
  assert.equal(query.headFilesObserved, 0);
  assert.equal(query.recordFilesObserved, 1);
  assert.deepEqual(query.heads, []);
});

test("receipt chain load rejects a query made stale by an accepted append", async (t) => {
  const { root } = await fixture(t);
  const firstReceipt = receipt({ projectIdentityDigest: root.identityDigest });
  const first = await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: firstReceipt,
    maxArtifactBytes: 0,
  });
  const query = await core.queryRunReceiptHeads(queryRequest(root));
  const secondReceipt = receipt({
    ordinal: 1,
    projectIdentityDigest: root.identityDigest,
    previousReceiptDigest: firstReceipt.receiptDigest,
  });
  await core.persistRunReceipt({
    root,
    registry: registry.BUILTIN_REGISTRY,
    receipt: secondReceipt,
    previous: first,
    maxArtifactBytes: 0,
  });

  await assert.rejects(
    core.loadQueriedRunReceiptChain({
      query,
      runId: RUN_ID,
      maxArtifactBytes: 0,
    }),
    expectCoreError("run-receipt-store-conflict"),
  );
});
