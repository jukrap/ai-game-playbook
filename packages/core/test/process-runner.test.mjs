import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import * as core from "../dist/index.js";

let executablePromise;

function expectCoreError(code, uncertain) {
  return (error) =>
    error?.name === "CoreBoundaryError" &&
    error?.code === code &&
    (uncertain === undefined || error?.mutationUncertain === uncertain);
}

async function fixture(t) {
  const sandbox = await mkdtemp(join(tmpdir(), "agpb-core-process-"));
  const project = join(sandbox, "project");
  await mkdir(project);
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  return {
    sandbox,
    project,
    root: await core.canonicalizeProjectRoot(project),
  };
}

function boundNode() {
  executablePromise ??= core.bindProcessExecutable({
    path: process.execPath,
    maxBytes: 512 * 1024 * 1024,
    allowedEnvironmentKeys: ["AGPB_TEST_VALUE"],
  });
  return executablePromise;
}

async function request(root, arguments_, overrides = {}) {
  return {
    root,
    executable: await boundNode(),
    arguments: arguments_,
    workingDirectory: null,
    environment: {},
    limits: {
      timeoutMs: 5_000,
      idleTimeoutMs: 0,
      maxOutputBytes: 64 * 1024,
      terminationGraceMs: 100,
    },
    signal: null,
    ...overrides,
  };
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!processIsAlive(pid)) {
      return;
    }
    await delay(20);
  }
  assert.fail(`owned descendant ${pid} remained alive`);
}

async function waitForFile(path) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    await delay(20);
  }
  assert.fail(`file ${path} was not created by the child process`);
}

test("process executables are digest-bound with a portable environment allowlist", async () => {
  assert.equal(typeof core.bindProcessExecutable, "function");
  assert.equal(typeof core.assertProcessExecutableIdentity, "function");
  assert.equal(typeof core.runBoundedProcess, "function");

  const executable = await boundNode();
  assert.equal(executable.canonicalPath, await realpath(process.execPath));
  assert.match(executable.digest, /^sha256:[0-9a-f]{64}$/);
  assert.match(executable.identityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(executable.allowedEnvironmentKeys, ["AGPB_TEST_VALUE"]);
  assert.equal(Object.isFrozen(executable), true);
  assert.equal(Object.isFrozen(executable.allowedEnvironmentKeys), true);
  await core.assertProcessExecutableIdentity(executable);

  await assert.rejects(
    core.assertProcessExecutableIdentity(structuredClone(executable)),
    expectCoreError("invalid-process-executable", false),
  );
  await assert.rejects(
    core.bindProcessExecutable({
      path: "node",
      maxBytes: 1024,
      allowedEnvironmentKeys: [],
    }),
    expectCoreError("invalid-process-executable", false),
  );
  await assert.rejects(
    core.bindProcessExecutable({
      path: process.execPath,
      maxBytes: 512 * 1024 * 1024,
      allowedEnvironmentKeys: ["Path", "PATH"],
    }),
    expectCoreError("invalid-process-executable", false),
  );
  await assert.rejects(
    core.bindProcessExecutable({
      path: process.execPath,
      maxBytes: 512 * 1024 * 1024,
      allowedEnvironmentKeys: ["__proto__"],
    }),
    expectCoreError("invalid-process-executable", false),
  );
});

test("process executable binding rejects hidden fields and accessors without invoking them", async () => {
  let getterCalled = false;
  const accessorRequest = {
    maxBytes: 512 * 1024 * 1024,
    allowedEnvironmentKeys: [],
  };
  Object.defineProperty(accessorRequest, "path", {
    enumerable: true,
    get() {
      getterCalled = true;
      return process.execPath;
    },
  });
  await assert.rejects(
    core.bindProcessExecutable(accessorRequest),
    expectCoreError("invalid-process-executable", false),
  );
  assert.equal(getterCalled, false);

  for (const hiddenRequest of [
    (() => {
      const value = {
        path: process.execPath,
        maxBytes: 512 * 1024 * 1024,
        allowedEnvironmentKeys: [],
      };
      Object.defineProperty(value, "provider", { value: "hidden" });
      return value;
    })(),
    {
      path: process.execPath,
      maxBytes: 512 * 1024 * 1024,
      allowedEnvironmentKeys: [],
      [Symbol("authority")]: true,
    },
  ]) {
    await assert.rejects(
      core.bindProcessExecutable(hiddenRequest),
      expectCoreError("invalid-process-executable", false),
    );
  }

  getterCalled = false;
  const accessorAllowlist = [];
  Object.defineProperty(accessorAllowlist, "0", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "AGPB_TEST_VALUE";
    },
  });
  await assert.rejects(
    core.bindProcessExecutable({
      path: process.execPath,
      maxBytes: 512 * 1024 * 1024,
      allowedEnvironmentKeys: accessorAllowlist,
    }),
    expectCoreError("invalid-process-executable", false),
  );
  assert.equal(getterCalled, false);
});

test("bounded process requests reject hidden fields and accessors without invoking them", async (t) => {
  const { root } = await fixture(t);
  const base = await request(root, ["--version"]);
  let getterCalled = false;
  const accessorRequest = {};
  for (const [key, value] of Object.entries(base)) {
    Object.defineProperty(accessorRequest, key, {
      enumerable: true,
      ...(key === "root"
        ? {
            get() {
              getterCalled = true;
              return value;
            },
          }
        : { value }),
    });
  }
  await assert.rejects(
    core.runBoundedProcess(accessorRequest),
    expectCoreError("invalid-process-request", false),
  );
  assert.equal(getterCalled, false);

  for (const hiddenRequest of [
    (() => {
      const value = { ...base };
      Object.defineProperty(value, "provider", { value: "hidden" });
      return value;
    })(),
    { ...base, [Symbol("authority")]: true },
  ]) {
    await assert.rejects(
      core.runBoundedProcess(hiddenRequest),
      expectCoreError("invalid-process-request", false),
    );
  }

  for (const field of ["arguments", "environment", "limits"]) {
    getterCalled = false;
    const nested = field === "arguments" ? [] : {};
    const nestedKey =
      field === "arguments"
        ? "0"
        : field === "environment"
          ? "AGPB_TEST_VALUE"
          : "timeoutMs";
    Object.defineProperty(nested, nestedKey, {
      enumerable: true,
      get() {
        getterCalled = true;
        return field === "arguments"
          ? "--version"
          : field === "environment"
            ? "value"
            : 5_000;
      },
    });
    if (field === "limits") {
      Object.assign(nested, {
        idleTimeoutMs: 0,
        maxOutputBytes: 64 * 1024,
        terminationGraceMs: 100,
      });
    }
    await assert.rejects(
      core.runBoundedProcess({ ...base, [field]: nested }),
      expectCoreError("invalid-process-request", false),
    );
    assert.equal(getterCalled, false, `${field} getter must not run`);
  }
});

test("bounded processes use direct arguments, exact environment, and call-time snapshots", async (t) => {
  const { project, root } = await fixture(t);
  const previousParentSecret = process.env.AGPB_PARENT_SECRET;
  process.env.AGPB_PARENT_SECRET = "must-not-leak";
  t.after(() => {
    if (previousParentSecret === undefined) {
      delete process.env.AGPB_PARENT_SECRET;
    } else {
      process.env.AGPB_PARENT_SECRET = previousParentSecret;
    }
  });
  const previousSystemRoot = process.env.SystemRoot;
  if (process.platform === "win32") {
    process.env.SystemRoot = project;
    t.after(() => {
      if (previousSystemRoot === undefined) {
        delete process.env.SystemRoot;
      } else {
        process.env.SystemRoot = previousSystemRoot;
      }
    });
  }
  const literal = "literal; echo must-not-run && $()";
  const script = [
    "const payload = {",
    "  argument: process.argv[1],",
    "  environment: process.env.AGPB_TEST_VALUE,",
    "  inheritedPath: process.env.PATH ?? process.env.Path ?? null,",
    "  inheritedSecret: process.env.AGPB_PARENT_SECRET ?? null,",
    "  systemRoot: process.env.SystemRoot ?? null,",
    "  cwd: process.cwd(),",
    "};",
    "process.stdout.write(JSON.stringify(payload));",
    "process.stderr.write('diagnostic');",
    "process.exitCode = 7;",
  ].join("\n");
  const arguments_ = ["--input-type=commonjs", "-e", script, literal];
  const environment = { AGPB_TEST_VALUE: "call-time" };
  const pending = core.runBoundedProcess(
    await request(root, arguments_, { environment }),
  );
  arguments_[3] = "changed";
  environment.AGPB_TEST_VALUE = "changed";

  const result = await pending;
  const payload = JSON.parse(result.output.stdout);
  assert.equal(result.outcome, "exited");
  assert.equal(result.exitCode, 7);
  assert.equal(result.signal, null);
  assert.equal(payload.argument, literal);
  assert.equal(payload.environment, "call-time");
  assert.equal(payload.inheritedPath, process.platform === "win32" ? "" : null);
  assert.equal(
    payload.inheritedSecret,
    null,
  );
  if (process.platform === "win32") {
    assert.equal(typeof previousSystemRoot, "string");
    assert.equal(
      payload.systemRoot.toLowerCase(),
      previousSystemRoot.toLowerCase(),
    );
  } else {
    assert.equal(payload.systemRoot, null);
  }
  assert.equal(payload.cwd, root.canonicalPath);
  assert.equal(result.output.stderr, "diagnostic");
  assert.equal(result.output.truncated, false);
  assert.equal(result.output.capturedBytes, result.output.observedBytes);
  assert.equal(
    result.output.stdoutObservedBytes + result.output.stderrObservedBytes,
    result.output.observedBytes,
  );
  assert.equal(result.identity.rootIdentityDigest, root.identityDigest);
  assert.match(result.identity.identityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(result.termination.requested, false);
  assert.equal(result.mutationUncertain, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.output), true);
  assert.equal(Object.isFrozen(result.identity), true);
  assert.equal("arguments" in result, false);
  assert.equal("environment" in result, false);
});

test("process requests reject undeclared shell authority and environment drift", async (t) => {
  const { root } = await fixture(t);
  const base = await request(root, ["--version"]);

  await assert.rejects(
    core.runBoundedProcess({ ...base, shell: true }),
    expectCoreError("invalid-process-request", false),
  );
  await assert.rejects(
    core.runBoundedProcess({ ...base, environment: { PATH: "untrusted" } }),
    expectCoreError("invalid-process-request", false),
  );
  await assert.rejects(
    core.runBoundedProcess({
      ...base,
      limits: { ...base.limits, maxOutputBytes: 128 * 1024 * 1024 },
    }),
    expectCoreError("invalid-process-request", false),
  );
});

test("an already-cancelled process request never spawns", async (t) => {
  const { project, root } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const marker = join(project, "spawned.txt");
  const script = "require('node:fs').writeFileSync('spawned.txt', 'bad')";

  await assert.rejects(
    core.runBoundedProcess(
      await request(root, ["--input-type=commonjs", "-e", script], {
        signal: controller.signal,
      }),
    ),
    expectCoreError("process-cancelled-before-spawn", false),
  );
  await assert.rejects(readFile(marker), (error) => error?.code === "ENOENT");
});

test("an exhausted preflight duration budget never spawns", async (t) => {
  const { project, root } = await fixture(t);
  const marker = join(project, "late-spawn.txt");
  const script = "require('node:fs').writeFileSync('late-spawn.txt', 'bad')";
  const base = await request(root, ["--input-type=commonjs", "-e", script]);

  await assert.rejects(
    core.runBoundedProcess({
      ...base,
      limits: { ...base.limits, timeoutMs: 1 },
    }),
    expectCoreError("process-timeout-before-spawn", false),
  );
  await assert.rejects(readFile(marker), (error) => error?.code === "ENOENT");
});

test("output floods are capped and terminate the owned process", async (t) => {
  const { root } = await fixture(t);
  const script = [
    "const chunk = 'x'.repeat(16 * 1024);",
    "function flood() {",
    "  while (process.stdout.write(chunk)) {}",
    "  process.stdout.once('drain', flood);",
    "}",
    "flood();",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const base = await request(root, ["--input-type=commonjs", "-e", script]);
  const result = await core.runBoundedProcess({
    ...base,
    limits: { ...base.limits, maxOutputBytes: 1024 },
  });

  assert.equal(result.outcome, "output-limit");
  assert.equal(result.output.truncated, true);
  assert.equal(result.output.capturedBytes, 1024);
  assert.ok(result.output.observedBytes > 1024);
  assert.equal(Buffer.byteLength(result.output.stdout), 1024);
  assert.equal(result.termination.requested, true);
  assert.equal(result.termination.reason, "output-limit");
  assert.equal(result.termination.confirmed, true);
  assert.equal(result.mutationUncertain, true);
});

test("timeouts terminate the complete owned process tree", async (t) => {
  const { project, root } = await fixture(t);
  const script = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    "const child = spawn(process.execPath, [",
    "  '--input-type=commonjs',",
    "  '-e',",
    "  'setInterval(() => {}, 1000)',",
    "], { stdio: 'ignore' });",
    "writeFileSync('descendant.pid', String(child.pid));",
    "process.stdout.write('ready\\n');",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const base = await request(root, ["--input-type=commonjs", "-e", script]);
  const result = await core.runBoundedProcess({
    ...base,
    limits: { ...base.limits, timeoutMs: 5_000 },
  });

  assert.equal(result.outcome, "timed-out");
  assert.equal(result.termination.reason, "timed-out");
  assert.equal(result.termination.confirmed, true);
  assert.equal(result.mutationUncertain, true);
  const descendantPid = Number.parseInt(
    await readFile(join(project, "descendant.pid"), "utf8"),
    10,
  );
  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  await waitForProcessExit(descendantPid);
});

test("abort and idle timeout are distinct bounded outcomes", async (t) => {
  const { project, root } = await fixture(t);
  const script = [
    "const { writeFileSync } = require('node:fs');",
    "writeFileSync('started.flag', 'ready');",
    "setInterval(() => {}, 1000);",
  ].join("\n");

  const controller = new AbortController();
  const cancellation = core.runBoundedProcess(
    await request(root, ["--input-type=commonjs", "-e", script], {
      signal: controller.signal,
    }),
  );
  await waitForFile(join(project, "started.flag"));
  controller.abort();
  const cancelled = await cancellation;
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(cancelled.termination.confirmed, true);
  assert.equal(cancelled.mutationUncertain, true);

  const base = await request(root, ["--input-type=commonjs", "-e", script]);
  const idle = await core.runBoundedProcess({
    ...base,
    limits: { ...base.limits, idleTimeoutMs: 250 },
  });
  assert.equal(idle.outcome, "idle-timed-out");
  assert.equal(idle.termination.confirmed, true);
  assert.equal(idle.mutationUncertain, true);
});

test("bounded output activity refreshes the idle deadline", async (t) => {
  const { root } = await fixture(t);
  const script = [
    "let count = 0;",
    "const timer = setInterval(() => {",
    "  process.stdout.write('.');",
    "  count += 1;",
    "  if (count === 6) clearInterval(timer);",
    "}, 50);",
  ].join("\n");
  const base = await request(root, ["--input-type=commonjs", "-e", script]);
  const result = await core.runBoundedProcess({
    ...base,
    limits: { ...base.limits, idleTimeoutMs: 150 },
  });

  assert.equal(result.outcome, "exited");
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.stdout, "......");
  assert.equal(result.output.truncated, false);
});

test("an executable changed after binding is rejected before spawn", async (t) => {
  const { sandbox, root } = await fixture(t);
  const source =
    process.platform === "win32"
      ? join(process.env.SystemRoot, "System32", "where.exe")
      : "/bin/true";
  const target = join(
    sandbox,
    process.platform === "win32" ? "owned-tool.exe" : "owned-tool",
  );
  await copyFile(source, target);
  const executable = await core.bindProcessExecutable({
    path: target,
    maxBytes: 16 * 1024 * 1024,
    allowedEnvironmentKeys: [],
  });
  await writeFile(target, "changed after binding\n", "utf8");

  await assert.rejects(
    core.runBoundedProcess({
      root,
      executable,
      arguments: [],
      workingDirectory: null,
      environment: {},
      limits: {
        timeoutMs: 5_000,
        idleTimeoutMs: 0,
        maxOutputBytes: 1024,
        terminationGraceMs: 100,
      },
      signal: null,
    }),
    expectCoreError("process-executable-drift", false),
  );
});
