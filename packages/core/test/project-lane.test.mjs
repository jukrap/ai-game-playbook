import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as core from "../dist/index.js";

const PROJECT_IDENTITY_DIGEST =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const OTHER_PROJECT_IDENTITY_DIGEST =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";

function expectCoreError(code) {
  return (error) => error?.name === "CoreBoundaryError" && error?.code === code;
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-lane-"));
  const project = join(sandbox, "project");
  await mkdir(join(project, ".ai-game-playbook", "locks"), {
    recursive: true,
  });
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    project,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function request(root, overrides = {}) {
  return {
    root,
    projectIdentityDigest: PROJECT_IDENTITY_DIGEST,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    lane: "project-write",
    leaseDurationMs: 2_000,
    waitTimeoutMs: 0,
    pollIntervalMs: 20,
    signal: null,
    ...overrides,
  };
}

test("project mutation leases bind identity and release their fixed lock", async (t) => {
  assert.equal(typeof core.acquireProjectLane, "function");
  assert.equal(typeof core.inspectProjectLane, "function");
  assert.equal(
    core.PROJECT_LANE_LOCK_PATH,
    ".ai-game-playbook/locks/project-mutation.lock",
  );

  const { project, root } = await fixture(t);
  const lease = await core.acquireProjectLane(request(root));

  assert.equal(Object.isFrozen(lease), true);
  assert.equal(lease.state, "active");
  assert.equal(lease.acquisition, "fresh");
  assert.equal(lease.lane, "project-write");
  assert.equal(lease.projectIdentityDigest, PROJECT_IDENTITY_DIGEST);
  assert.equal(lease.rootIdentityDigest, root.identityDigest);
  assert.match(lease.leaseNonce, /^[0-9a-f-]{36}$/);
  assert.equal(typeof lease.assertOwned, "function");
  assert.equal(typeof lease.renew, "function");
  assert.equal(typeof lease.release, "function");

  const inspection = await core.inspectProjectLane({ root });
  assert.equal(Object.isFrozen(inspection), true);
  assert.equal(Object.isFrozen(inspection.lease), true);
  assert.equal(Object.isFrozen(inspection.lease?.ownerProcess), true);
  assert.equal(inspection.status, "held");
  assert.equal(inspection.ownerStatus, "current-runtime");
  assert.equal(inspection.lease?.leaseNonce, lease.leaseNonce);

  const lockPath = join(
    project,
    ...core.PROJECT_LANE_LOCK_PATH.split("/"),
  );
  const lockText = await readFile(lockPath, "utf8");
  assert.equal(lockText.includes(project), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
  }

  await lease.assertOwned();
  await lease.release();
  assert.equal(lease.state, "released");
  assert.deepEqual(await core.inspectProjectLane({ root }), {
    status: "free",
  });
  await assert.rejects(readFile(lockPath), (error) => error?.code === "ENOENT");
});

test("lane requests are exact, editor-bound, cancellable, and snapshotted", async (t) => {
  const { root } = await fixture(t);

  await assert.rejects(
    core.acquireProjectLane({ ...request(root), lane: "parallel-read" }),
    expectCoreError("invalid-project-lane-request"),
  );
  await assert.rejects(
    core.acquireProjectLane({ ...request(root), undeclared: true }),
    expectCoreError("invalid-project-lane-request"),
  );
  await assert.rejects(
    core.acquireProjectLane({ ...request(root), lane: "editor-bound" }),
    expectCoreError("invalid-project-lane-request"),
  );
  await assert.rejects(
    core.acquireProjectLane({
      ...request(root),
      lane: "build-bound",
      editorSessionIdentityDigest: OTHER_PROJECT_IDENTITY_DIGEST,
    }),
    expectCoreError("invalid-project-lane-request"),
  );

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    core.acquireProjectLane(request(root, { signal: controller.signal })),
    expectCoreError("project-lane-cancelled"),
  );
  assert.deepEqual(await core.inspectProjectLane({ root }), {
    status: "free",
  });

  const mutable = request(root);
  const acquisition = core.acquireProjectLane(mutable);
  mutable.projectIdentityDigest = OTHER_PROJECT_IDENTITY_DIGEST;
  mutable.runId = "223e4567-e89b-42d3-a456-426614174000";
  mutable.lane = "build-bound";
  const lease = await acquisition;
  assert.equal(lease.projectIdentityDigest, PROJECT_IDENTITY_DIGEST);
  assert.equal(lease.runId, "123e4567-e89b-42d3-a456-426614174000");
  assert.equal(lease.lane, "project-write");
  await lease.release();

  await assert.rejects(
    core.inspectProjectLane({ root, undeclared: true }),
    expectCoreError("invalid-project-lane-request"),
  );
});

test("one project lane serializes mutations while different projects remain independent", async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const firstLease = await core.acquireProjectLane(request(first.root));
  const secondProjectLease = await core.acquireProjectLane(
    request(second.root, {
      runId: "223e4567-e89b-42d3-a456-426614174000",
    }),
  );

  let waiterSettled = false;
  const waiterPromise = core
    .acquireProjectLane(
      request(first.root, {
        runId: "323e4567-e89b-42d3-a456-426614174000",
        waitTimeoutMs: 2_000,
      }),
    )
    .then((lease) => {
      waiterSettled = true;
      return lease;
    });
  await delay(100);
  assert.equal(waiterSettled, false);

  await assert.rejects(
    core.acquireProjectLane(
      request(first.root, {
        projectIdentityDigest: OTHER_PROJECT_IDENTITY_DIGEST,
      }),
    ),
    expectCoreError("project-lane-identity-mismatch"),
  );

  await firstLease.release();
  const waiterLease = await waiterPromise;
  assert.equal(waiterLease.state, "active");
  await waiterLease.release();
  await secondProjectLease.release();
});

test("a queued lane request can be cancelled without disturbing the owner", async (t) => {
  const { root } = await fixture(t);
  const owner = await core.acquireProjectLane(request(root));
  const controller = new AbortController();
  const queued = core.acquireProjectLane(
    request(root, {
      runId: "423e4567-e89b-42d3-a456-426614174000",
      waitTimeoutMs: 5_000,
      signal: controller.signal,
    }),
  );
  controller.abort();
  await assert.rejects(queued, expectCoreError("project-lane-cancelled"));

  const inspection = await core.inspectProjectLane({ root });
  assert.equal(inspection.status, "held");
  assert.equal(inspection.lease?.leaseNonce, owner.leaseNonce);
  await owner.release();
});

test("editor-bound lanes retain an exact session digest", async (t) => {
  const { root } = await fixture(t);
  const lease = await core.acquireProjectLane(
    request(root, {
      lane: "editor-bound",
      editorSessionIdentityDigest: OTHER_PROJECT_IDENTITY_DIGEST,
    }),
  );
  assert.equal(lease.lane, "editor-bound");
  assert.equal(
    lease.editorSessionIdentityDigest,
    OTHER_PROJECT_IDENTITY_DIGEST,
  );
  await lease.release();
});

test("lease renewal is compare-and-swap bound and tampering loses ownership", async (t) => {
  const { project, root } = await fixture(t);
  const lease = await core.acquireProjectLane(
    request(root, { leaseDurationMs: 1_000 }),
  );
  const firstHeartbeat = lease.heartbeatAt;
  const firstExpiry = lease.expiresAt;

  const renewed = await lease.renew();
  assert.ok(Date.parse(renewed.heartbeatAt) > Date.parse(firstHeartbeat));
  assert.ok(Date.parse(renewed.expiresAt) > Date.parse(firstExpiry));
  assert.equal(lease.heartbeatAt, renewed.heartbeatAt);
  assert.equal((await lease.assertOwned()).leaseNonce, lease.leaseNonce);

  const lockPath = join(
    project,
    ...core.PROJECT_LANE_LOCK_PATH.split("/"),
  );
  await writeFile(lockPath, "{}\n");
  await assert.rejects(
    lease.assertOwned(),
    expectCoreError("project-lane-lock-invalid"),
  );
  assert.equal(lease.state, "lost");
});

test("an expired lease is not reclaimed while its owner PID remains live", async (t) => {
  const { root } = await fixture(t);
  const owner = await core.acquireProjectLane(
    request(root, { leaseDurationMs: 500 }),
  );
  await delay(550);

  const inspection = await core.inspectProjectLane({ root });
  assert.equal(inspection.status, "expired-owner-alive");
  assert.equal(inspection.ownerStatus, "current-runtime");
  await assert.rejects(
    core.acquireProjectLane(
      request(root, {
        runId: "523e4567-e89b-42d3-a456-426614174000",
      }),
    ),
    expectCoreError("project-lane-busy"),
  );
  await assert.rejects(
    owner.assertOwned(),
    expectCoreError("project-lane-expired"),
  );
  await assert.rejects(
    owner.renew(),
    expectCoreError("project-lane-expired"),
  );
  assert.equal(owner.state, "active");
  await owner.release();
});

test("a dead owner lease is quarantined before a new run acquires the lane", async (t) => {
  const { project, root } = await fixture(t);
  const moduleUrl = new URL("../dist/index.js", import.meta.url).href;
  const childScript = [
    `import * as core from ${JSON.stringify(moduleUrl)};`,
    `const root = await core.canonicalizeProjectRoot(${JSON.stringify(project)});`,
    "const lease = await core.acquireProjectLane({",
    "  root,",
    `  projectIdentityDigest: ${JSON.stringify(PROJECT_IDENTITY_DIGEST)},`,
    "  runId: '623e4567-e89b-42d3-a456-426614174000',",
    "  lane: 'project-write',",
    "  leaseDurationMs: 2000,",
    "  waitTimeoutMs: 0,",
    "  pollIntervalMs: 20,",
    "  signal: null,",
    "});",
    "process.stdout.write(JSON.stringify({ expiresAt: lease.expiresAt }));",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", childScript],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert.equal(exitCode, 0, stderr);
  const childLease = JSON.parse(stdout);
  const freshDeadOwner = await core.inspectProjectLane({ root });
  assert.equal(freshDeadOwner.status, "held");
  assert.equal(freshDeadOwner.ownerStatus, "not-running");
  await assert.rejects(
    core.acquireProjectLane(
      request(root, {
        runId: "723e4567-e89b-42d3-a456-426614174000",
      }),
    ),
    expectCoreError("project-lane-busy"),
  );
  await delay(
    Math.max(0, Date.parse(childLease.expiresAt) - Date.now() + 75),
  );

  const stale = await core.inspectProjectLane({ root });
  assert.equal(stale.status, "recoverable-stale");
  assert.equal(stale.ownerStatus, "not-running");
  const recovered = await core.acquireProjectLane(
    request(root, {
      runId: "723e4567-e89b-42d3-a456-426614174001",
    }),
  );
  assert.equal(recovered.acquisition, "recovered-stale");
  assert.equal(recovered.recoveredLeaseDigest, stale.lockDigest);
  assert.notEqual(recovered.leaseNonce, stale.lease?.leaseNonce);
  await recovered.release();
});

test("a stale lock with a reused live PID remains fail-closed", async (t) => {
  const { project, root } = await fixture(t);
  await core.acquireProjectLane(
    request(root, { leaseDurationMs: 500 }),
  );
  const lockPath = join(
    project,
    ...core.PROJECT_LANE_LOCK_PATH.split("/"),
  );
  const record = JSON.parse(await readFile(lockPath, "utf8"));
  record.ownerProcess.instanceNonce =
    "823e4567-e89b-42d3-a456-426614174000";
  await writeFile(lockPath, `${contracts.canonicalizeJson(record)}\n`);
  await delay(550);

  const inspection = await core.inspectProjectLane({ root });
  assert.equal(inspection.status, "expired-owner-alive");
  assert.equal(inspection.ownerStatus, "alive-unverified");
  await assert.rejects(
    core.acquireProjectLane(
      request(root, {
        runId: "923e4567-e89b-42d3-a456-426614174000",
      }),
    ),
    expectCoreError("project-lane-busy"),
  );
});

test("malformed and oversized lock records remain in place and fail closed", async (t) => {
  const { project, root } = await fixture(t);
  const lockPath = join(
    project,
    ...core.PROJECT_LANE_LOCK_PATH.split("/"),
  );

  await writeFile(lockPath, "{}\n", { mode: 0o600 });
  await assert.rejects(
    core.inspectProjectLane({ root }),
    expectCoreError("project-lane-lock-invalid"),
  );
  await assert.rejects(
    core.acquireProjectLane(request(root)),
    expectCoreError("project-lane-lock-invalid"),
  );
  assert.equal(await readFile(lockPath, "utf8"), "{}\n");

  await rm(lockPath);
  await writeFile(lockPath, Buffer.alloc(16 * 1_024 + 1), { mode: 0o600 });
  await assert.rejects(
    core.inspectProjectLane({ root }),
    expectCoreError("project-lane-lock-invalid"),
  );
  assert.equal((await stat(lockPath)).size, 16 * 1_024 + 1);
});

test("lane storage must already exist and retain its bound directory identity", async (t) => {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-lane-storage-"));
  const uninitializedProject = join(sandbox, "uninitialized");
  await mkdir(uninitializedProject);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const uninitializedRoot = await core.canonicalizeProjectRoot(
    uninitializedProject,
  );
  await assert.rejects(
    core.acquireProjectLane(request(uninitializedRoot)),
    expectCoreError("project-path-not-found"),
  );
  await assert.rejects(
    core.inspectProjectLane({ root: uninitializedRoot }),
    expectCoreError("project-path-not-found"),
  );
  await assert.rejects(
    stat(join(uninitializedProject, ".ai-game-playbook")),
    (error) => error?.code === "ENOENT",
  );

  const { project, root } = await fixture(t);
  const lease = await core.acquireProjectLane(request(root));
  const locks = join(project, ".ai-game-playbook", "locks");
  await rename(locks, `${locks}-old`);
  await mkdir(locks);
  await assert.rejects(
    lease.assertOwned(),
    expectCoreError("project-lane-ownership-lost"),
  );
  assert.equal(lease.state, "lost");
});

test("released leases cannot be reused", async (t) => {
  const { root } = await fixture(t);
  const lease = await core.acquireProjectLane(request(root));
  await lease.release();
  await assert.rejects(
    lease.release(),
    expectCoreError("project-lane-state-invalid"),
  );
  await assert.rejects(
    lease.renew(),
    expectCoreError("project-lane-state-invalid"),
  );
});

test("POSIX lane records reject group or world-readable permissions", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX mode bits are not enforced on Windows");
    return;
  }
  const { project, root } = await fixture(t);
  await core.acquireProjectLane(request(root));
  const lockPath = join(
    project,
    ...core.PROJECT_LANE_LOCK_PATH.split("/"),
  );
  await chmod(lockPath, 0o644);
  await assert.rejects(
    core.inspectProjectLane({ root }),
    expectCoreError("project-lane-lock-invalid"),
  );
});
