import {
  digestCanonicalJson,
  sha256Digest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";
import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { isAbsolute, join, normalize } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

import { CoreBoundaryError } from "./errors.js";
import {
  assertProcessExecutableIdentity,
  PROCESS_MAX_ENVIRONMENT_KEYS,
  type BoundProcessExecutable,
} from "./process-executable.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ResolvedProjectPath,
} from "./project-path.js";

export const PROCESS_MAX_ARGUMENTS: number = 256;
export const PROCESS_MAX_ARGUMENT_BYTES: number = 128 * 1024;
export const PROCESS_MAX_ENVIRONMENT_BYTES: number = 64 * 1024;
export const PROCESS_MAX_OUTPUT_BYTES: number = 64 * 1024 * 1024;
export const PROCESS_MAX_DURATION_MS: number = 7 * 24 * 60 * 60 * 1000;
export const PROCESS_MAX_TERMINATION_GRACE_MS: number = 30_000;

export type ProcessStopReason =
  | "cancelled"
  | "idle-timed-out"
  | "output-limit"
  | "timed-out";

export type BoundedProcessOutcome =
  | "exited"
  | "spawn-failed"
  | "termination-uncertain"
  | ProcessStopReason;

export interface BoundedProcessLimits {
  readonly timeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly maxOutputBytes: number;
  readonly terminationGraceMs: number;
}

export interface BoundedProcessRequest {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly arguments: readonly unknown[];
  readonly workingDirectory: unknown | null;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly limits: BoundedProcessLimits;
  readonly signal: AbortSignal | null;
}

export interface OwnedProcessIdentity {
  readonly pid: number;
  readonly spawnedAt: string;
  readonly processToken: string;
  readonly executableDigest: Sha256Digest;
  readonly rootIdentityDigest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
}

export interface BoundedProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutDigest: Sha256Digest;
  readonly stderrDigest: Sha256Digest;
  readonly stdoutObservedBytes: number;
  readonly stderrObservedBytes: number;
  readonly capturedBytes: number;
  readonly observedBytes: number;
  readonly truncated: boolean;
}

export interface ProcessTerminationReport {
  readonly requested: boolean;
  readonly reason?: ProcessStopReason;
  readonly escalated: boolean;
  readonly confirmed: boolean;
}

export interface BoundedProcessResult {
  readonly outcome: BoundedProcessOutcome;
  readonly identity?: OwnedProcessIdentity;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnErrorCode?: string;
  readonly output: BoundedProcessOutput;
  readonly termination: ProcessTerminationReport;
  readonly mutationUncertain: boolean;
}

interface ValidatedProcessRequest {
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly arguments: readonly string[];
  readonly workingDirectory: string | null;
  readonly environment: Readonly<Record<string, string>>;
  readonly limits: BoundedProcessLimits;
  readonly signal: AbortSignal | null;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface CloseObservation {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface TerminationObservation {
  readonly escalated: boolean;
  readonly confirmed: boolean;
  readonly close?: CloseObservation;
}

interface OutputCapture {
  readonly stdoutChunks: Buffer[];
  readonly stderrChunks: Buffer[];
  stdoutBytes: number;
  stderrBytes: number;
  capturedBytes: number;
  observedBytes: number;
  truncated: boolean;
}

interface WindowsEnvironmentBaseline {
  readonly systemRoot: string;
  readonly windir: string;
  readonly systemDrive: string;
}

const environmentKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const blockedEnvironmentKeys = new Set(["__proto__", "constructor", "prototype"]);
const windowsMaskedEnvironmentKeys = Object.freeze([
  "APPDATA",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "LOGONSERVER",
  "PATH",
  "PATHEXT",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "PUBLIC",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
] as const);

function readEnvironmentCaseInsensitive(name: string): string | undefined {
  const actualKey = Object.keys(process.env).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return actualKey === undefined ? undefined : process.env[actualKey];
}

function captureWindowsEnvironmentBaseline():
  | WindowsEnvironmentBaseline
  | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }
  const systemRootValue = readEnvironmentCaseInsensitive("SystemRoot");
  const windirValue = readEnvironmentCaseInsensitive("WINDIR");
  const systemDrive = readEnvironmentCaseInsensitive("SystemDrive");
  if (
    systemRootValue === undefined ||
    windirValue === undefined ||
    systemDrive === undefined ||
    systemRootValue.includes("\0") ||
    windirValue.includes("\0") ||
    !isAbsolute(systemRootValue) ||
    !isAbsolute(windirValue) ||
    systemRootValue.startsWith("\\\\") ||
    windirValue.startsWith("\\\\") ||
    !/^[A-Za-z]:$/.test(systemDrive)
  ) {
    return undefined;
  }
  const systemRoot = normalize(systemRootValue);
  const windir = normalize(windirValue);
  if (
    systemRoot.toLowerCase() !== windir.toLowerCase() ||
    !systemRoot.toLowerCase().startsWith(systemDrive.toLowerCase())
  ) {
    return undefined;
  }
  return Object.freeze({ systemRoot, windir, systemDrive });
}

const windowsEnvironmentBaseline = captureWindowsEnvironmentBaseline();

function deferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error("deferred resolver was not initialized");
  }
  return { promise, resolve: resolvePromise };
}

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidProcessRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-process-request",
    "$process",
    message,
  );
}

function validateArguments(value: readonly unknown[]): readonly string[] {
  if (!Array.isArray(value) || value.length > PROCESS_MAX_ARGUMENTS) {
    invalidProcessRequest("process argument count exceeds the runtime boundary");
  }
  const arguments_: string[] = [];
  let totalBytes = 0;
  for (const argument of value) {
    if (
      typeof argument !== "string" ||
      argument.includes("\0") ||
      argument.length > 32767
    ) {
      invalidProcessRequest("process arguments must be bounded NUL-free strings");
    }
    totalBytes += Buffer.byteLength(argument, "utf8");
    if (totalBytes > PROCESS_MAX_ARGUMENT_BYTES) {
      invalidProcessRequest("process arguments exceed the byte boundary");
    }
    arguments_.push(argument);
  }
  return Object.freeze(arguments_);
}

function validateEnvironment(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  if (
    typeof value !== "object" ||
    value === null ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    invalidProcessRequest("process environment must be a plain exact object");
  }
  const output = Object.create(null) as Record<string, string>;
  const foldedKeys = new Set<string>();
  let totalBytes = 0;
  const keys = Object.keys(value);
  if (keys.length > PROCESS_MAX_ENVIRONMENT_KEYS) {
    invalidProcessRequest("process environment key count exceeds the boundary");
  }
  for (const key of keys) {
    const environmentValue = value[key];
    if (
      key.length > 128 ||
      !environmentKeyPattern.test(key) ||
      blockedEnvironmentKeys.has(key.toLowerCase()) ||
      typeof environmentValue !== "string" ||
      environmentValue.includes("\0") ||
      environmentValue.length > 32767
    ) {
      invalidProcessRequest("process environment contains an invalid entry");
    }
    const folded = key.toLowerCase();
    if (foldedKeys.has(folded)) {
      invalidProcessRequest("process environment contains a portable key collision");
    }
    foldedKeys.add(folded);
    totalBytes +=
      Buffer.byteLength(key, "utf8") +
      Buffer.byteLength(environmentValue, "utf8") +
      1;
    if (totalBytes > PROCESS_MAX_ENVIRONMENT_BYTES) {
      invalidProcessRequest("process environment exceeds the byte boundary");
    }
    output[key] = environmentValue;
  }
  return Object.freeze(output);
}

function validateLimits(value: BoundedProcessLimits): BoundedProcessLimits {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(value, [
      "timeoutMs",
      "idleTimeoutMs",
      "maxOutputBytes",
      "terminationGraceMs",
    ]) ||
    !Number.isSafeInteger(value.timeoutMs) ||
    value.timeoutMs < 1 ||
    value.timeoutMs > PROCESS_MAX_DURATION_MS ||
    !Number.isSafeInteger(value.idleTimeoutMs) ||
    value.idleTimeoutMs < 0 ||
    value.idleTimeoutMs > value.timeoutMs ||
    !Number.isSafeInteger(value.maxOutputBytes) ||
    value.maxOutputBytes < 1 ||
    value.maxOutputBytes > PROCESS_MAX_OUTPUT_BYTES ||
    !Number.isSafeInteger(value.terminationGraceMs) ||
    value.terminationGraceMs < 0 ||
    value.terminationGraceMs > PROCESS_MAX_TERMINATION_GRACE_MS
  ) {
    invalidProcessRequest("process limits are invalid or exceed runtime ceilings");
  }
  return Object.freeze({
    timeoutMs: value.timeoutMs,
    idleTimeoutMs: value.idleTimeoutMs,
    maxOutputBytes: value.maxOutputBytes,
    terminationGraceMs: value.terminationGraceMs,
  });
}

function validateProcessRequest(
  value: BoundedProcessRequest,
): ValidatedProcessRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(value, [
      "root",
      "executable",
      "arguments",
      "workingDirectory",
      "environment",
      "limits",
      "signal",
    ])
  ) {
    invalidProcessRequest("process request contains undeclared fields");
  }
  if (
    value.workingDirectory !== null &&
    typeof value.workingDirectory !== "string"
  ) {
    invalidProcessRequest("working directory must be null or a portable path");
  }
  if (
    value.signal !== null &&
    !(value.signal instanceof AbortSignal)
  ) {
    invalidProcessRequest("process signal must be an AbortSignal or null");
  }
  return {
    root: value.root,
    executable: value.executable,
    arguments: validateArguments(value.arguments),
    workingDirectory: value.workingDirectory,
    environment: validateEnvironment(value.environment),
    limits: validateLimits(value.limits),
    signal: value.signal,
  };
}

function assertAllowedEnvironment(request: ValidatedProcessRequest): void {
  const allowed = new Set(
    request.executable.allowedEnvironmentKeys.map((key) => key.toLowerCase()),
  );
  for (const key of Object.keys(request.environment)) {
    if (!allowed.has(key.toLowerCase())) {
      invalidProcessRequest("process environment requests a key outside the allowlist");
    }
  }
}

function createSpawnEnvironment(
  requested: Readonly<Record<string, string>>,
): NodeJS.ProcessEnv {
  if (process.platform !== "win32") {
    return { ...requested };
  }

  const environment: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of windowsMaskedEnvironmentKeys) {
    environment[key] = "";
  }

  if (windowsEnvironmentBaseline === undefined) {
    invalidProcessRequest("required Windows process baseline is unavailable");
  }
  delete environment["SYSTEMROOT"];
  delete environment["SYSTEMDRIVE"];
  environment["SystemRoot"] = windowsEnvironmentBaseline.systemRoot;
  environment["WINDIR"] = windowsEnvironmentBaseline.windir;
  environment["SystemDrive"] = windowsEnvironmentBaseline.systemDrive;

  for (const [key, value] of Object.entries(requested)) {
    const maskedKey = Object.keys(environment).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (maskedKey !== undefined && maskedKey !== key) {
      delete environment[maskedKey];
    }
    environment[key] = value;
  }
  return environment;
}

function sameResolvedDirectory(
  left: ResolvedProjectPath,
  right: ResolvedProjectPath,
): boolean {
  return (
    left.absolutePath === right.absolutePath &&
    left.targetIdentity?.device === right.targetIdentity?.device &&
    left.targetIdentity?.inode === right.targetIdentity?.inode
  );
}

async function resolveWorkingDirectory(
  request: ValidatedProcessRequest,
): Promise<string> {
  await assertProjectRootIdentity(request.root);
  if (request.workingDirectory === null) {
    await assertProcessExecutableIdentity(request.executable);
    await assertProjectRootIdentity(request.root);
    return request.root.canonicalPath;
  }
  const before = await resolveProjectPath(
    request.root,
    request.workingDirectory,
    { expectedType: "directory", existence: "required" },
  );
  await assertProcessExecutableIdentity(request.executable);
  const after = await resolveProjectPath(
    request.root,
    request.workingDirectory,
    { expectedType: "directory", existence: "required" },
  );
  if (!sameResolvedDirectory(before, after)) {
    throw new CoreBoundaryError(
      "process-working-directory-drift",
      "$process.workingDirectory",
      "working directory changed during process preflight",
    );
  }
  return after.absolutePath;
}

function captureOutput(
  capture: OutputCapture,
  stream: "stderr" | "stdout",
  chunk: Buffer,
  maxOutputBytes: number,
): boolean {
  capture.observedBytes += chunk.byteLength;
  if (stream === "stdout") {
    capture.stdoutBytes += chunk.byteLength;
  } else {
    capture.stderrBytes += chunk.byteLength;
  }
  const remaining = maxOutputBytes - capture.capturedBytes;
  if (remaining > 0) {
    const captured = Buffer.from(chunk.subarray(0, remaining));
    if (stream === "stdout") {
      capture.stdoutChunks.push(captured);
    } else {
      capture.stderrChunks.push(captured);
    }
    capture.capturedBytes += captured.byteLength;
  }
  if (capture.observedBytes > maxOutputBytes) {
    capture.truncated = true;
    return false;
  }
  return true;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

async function waitForClose(
  closePromise: Promise<CloseObservation>,
  timeoutMs: number,
): Promise<CloseObservation | undefined> {
  return resolveWithin(closePromise, timeoutMs);
}

function resolveWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    }, timeoutMs);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(undefined);
        }
      },
    );
  });
}

async function waitForGroupExit(pid: number): Promise<boolean> {
  const deadline = performance.now() + 1_000;
  while (groupExists(pid) && performance.now() < deadline) {
    await delay(20);
  }
  return !groupExists(pid);
}

async function terminatePosixProcessTree(
  pid: number,
  graceMs: number,
  closePromise: Promise<CloseObservation>,
): Promise<TerminationObservation> {
  let escalated = false;
  let signalSucceeded = signalGroup(pid, "SIGTERM");
  if (graceMs > 0) {
    await delay(graceMs);
  }
  if (groupExists(pid)) {
    escalated = true;
    signalSucceeded = signalGroup(pid, "SIGKILL") && signalSucceeded;
  }
  const close = await waitForClose(
    closePromise,
    Math.max(1_000, Math.min(5_000, graceMs || 1_000)),
  );
  const groupExited = await waitForGroupExit(pid);
  return {
    escalated,
    confirmed: signalSucceeded && groupExited && close !== undefined,
    ...(close === undefined ? {} : { close }),
  };
}

async function runTaskkill(pid: number, timeoutMs: number): Promise<boolean> {
  if (windowsEnvironmentBaseline === undefined) {
    return false;
  }
  const systemRoot = windowsEnvironmentBaseline.systemRoot;
  const taskkillPath = join(systemRoot, "System32", "taskkill.exe");
  let killer: ChildProcess;
  try {
    killer = spawn(taskkillPath, ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot },
    });
  } catch {
    return false;
  }
  const completed = await resolveWithin(
    new Promise<boolean>((resolve) => {
      killer.once("error", () => resolve(false));
      killer.once("close", (code) => resolve(code === 0));
    }),
    timeoutMs,
  );
  if (!completed && killer.exitCode === null) {
    killer.kill();
  }
  return completed ?? false;
}

async function terminateWindowsProcessTree(
  pid: number,
  graceMs: number,
  closePromise: Promise<CloseObservation>,
): Promise<TerminationObservation> {
  const killed = await runTaskkill(
    pid,
    Math.max(1_000, Math.min(5_000, graceMs || 1_000)),
  );
  const close = await waitForClose(
    closePromise,
    Math.max(1_000, Math.min(5_000, graceMs || 1_000)),
  );
  return {
    escalated: true,
    confirmed: killed && close !== undefined,
    ...(close === undefined ? {} : { close }),
  };
}

async function terminateProcessTree(
  pid: number,
  graceMs: number,
  closePromise: Promise<CloseObservation>,
): Promise<TerminationObservation> {
  return process.platform === "win32"
    ? terminateWindowsProcessTree(pid, graceMs, closePromise)
    : terminatePosixProcessTree(pid, graceMs, closePromise);
}

function normalizeSpawnErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]{1,64}$/.test(error.code)
  ) {
    return error.code;
  }
  return "UNKNOWN";
}

function isAborted(signal: AbortSignal | null): boolean {
  return signal?.aborted === true;
}

function outputFromCapture(capture: OutputCapture): BoundedProcessOutput {
  const stdout = Buffer.concat(capture.stdoutChunks);
  const stderr = Buffer.concat(capture.stderrChunks);
  return Object.freeze({
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    stdoutDigest: sha256Digest(stdout),
    stderrDigest: sha256Digest(stderr),
    stdoutObservedBytes: capture.stdoutBytes,
    stderrObservedBytes: capture.stderrBytes,
    capturedBytes: capture.capturedBytes,
    observedBytes: capture.observedBytes,
    truncated: capture.truncated,
  });
}

function createIdentity(
  pid: number,
  spawnedAt: string,
  executable: BoundProcessExecutable,
  root: CanonicalProjectRoot,
): OwnedProcessIdentity {
  const processToken = randomUUID();
  return Object.freeze({
    pid,
    spawnedAt,
    processToken,
    executableDigest: executable.digest,
    rootIdentityDigest: root.identityDigest,
    identityDigest: digestCanonicalJson({
      pid,
      spawnedAt,
      processToken,
      executableDigest: executable.digest,
      rootIdentityDigest: root.identityDigest,
    }),
  });
}

function createResult(
  startedAt: string,
  startedMonotonic: number,
  outcome: BoundedProcessOutcome,
  capture: OutputCapture,
  termination: ProcessTerminationReport,
  close: CloseObservation | undefined,
  identity: OwnedProcessIdentity | undefined,
  spawnErrorCode?: string,
): BoundedProcessResult {
  return Object.freeze({
    outcome,
    ...(identity === undefined ? {} : { identity }),
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.ceil(performance.now() - startedMonotonic)),
    exitCode: close?.exitCode ?? null,
    signal: close?.signal ?? null,
    ...(spawnErrorCode === undefined ? {} : { spawnErrorCode }),
    output: outputFromCapture(capture),
    termination,
    mutationUncertain:
      outcome !== "exited" && outcome !== "spawn-failed",
  });
}

async function executeBoundedProcess(
  request: ValidatedProcessRequest,
): Promise<BoundedProcessResult> {
  const startedAt = new Date().toISOString();
  const startedMonotonic = performance.now();
  if (isAborted(request.signal)) {
    throw new CoreBoundaryError(
      "process-cancelled-before-spawn",
      "$process.signal",
      "process request was cancelled before spawn",
    );
  }
  const workingDirectory = await resolveWorkingDirectory(request);
  assertAllowedEnvironment(request);
  const spawnEnvironment = createSpawnEnvironment(request.environment);
  if (isAborted(request.signal)) {
    throw new CoreBoundaryError(
      "process-cancelled-before-spawn",
      "$process.signal",
      "process request was cancelled during preflight",
    );
  }
  const remainingDurationMs =
    request.limits.timeoutMs -
    Math.ceil(performance.now() - startedMonotonic);
  if (remainingDurationMs < 1) {
    throw new CoreBoundaryError(
      "process-timeout-before-spawn",
      "$process.limits.timeoutMs",
      "process budget expired during identity preflight",
    );
  }

  const capture: OutputCapture = {
    stdoutChunks: [],
    stderrChunks: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    capturedBytes: 0,
    observedBytes: 0,
    truncated: false,
  };
  let child: ChildProcess;
  try {
    child = spawn(
      request.executable.canonicalPath,
      request.arguments,
      {
        cwd: workingDirectory,
        env: spawnEnvironment,
        detached: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        windowsVerbatimArguments: false,
      },
    );
  } catch (error) {
    return createResult(
      startedAt,
      startedMonotonic,
      "spawn-failed",
      capture,
      Object.freeze({
        requested: false,
        escalated: false,
        confirmed: true,
      }),
      undefined,
      undefined,
      normalizeSpawnErrorCode(error),
    );
  }

  const spawnEvent = deferred<{ readonly error?: unknown }>();
  const closeEvent = deferred<CloseObservation>();
  const stopEvent = deferred<ProcessStopReason>();
  let stopReason: ProcessStopReason | undefined;
  let runtimeError = false;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let idleHandle: NodeJS.Timeout | undefined;

  const requestStop = (reason: ProcessStopReason): void => {
    if (stopReason !== undefined) {
      return;
    }
    stopReason = reason;
    stopEvent.resolve(reason);
  };
  const resetIdleTimer = (): void => {
    if (idleHandle !== undefined) {
      clearTimeout(idleHandle);
    }
    if (request.limits.idleTimeoutMs > 0 && stopReason === undefined) {
      idleHandle = setTimeout(
        () => requestStop("idle-timed-out"),
        request.limits.idleTimeoutMs,
      );
    }
  };
  const onAbort = (): void => requestStop("cancelled");
  const onStdout = (chunk: Buffer): void => {
    resetIdleTimer();
    if (
      !captureOutput(
        capture,
        "stdout",
        chunk,
        request.limits.maxOutputBytes,
      )
    ) {
      requestStop("output-limit");
    }
  };
  const onStderr = (chunk: Buffer): void => {
    resetIdleTimer();
    if (
      !captureOutput(
        capture,
        "stderr",
        chunk,
        request.limits.maxOutputBytes,
      )
    ) {
      requestStop("output-limit");
    }
  };
  const onInitialError = (error: unknown): void => {
    spawnEvent.resolve({ error });
  };
  child.once("spawn", () => spawnEvent.resolve({}));
  child.once("error", onInitialError);
  child.once("close", (exitCode, signal) => {
    closeEvent.resolve({ exitCode, signal });
  });
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  request.signal?.addEventListener("abort", onAbort, { once: true });

  const spawned = await spawnEvent.promise;
  child.removeListener("error", onInitialError);
  if (spawned.error !== undefined || child.pid === undefined) {
    request.signal?.removeEventListener("abort", onAbort);
    child.stdout?.removeListener("data", onStdout);
    child.stderr?.removeListener("data", onStderr);
    return createResult(
      startedAt,
      startedMonotonic,
      "spawn-failed",
      capture,
      Object.freeze({
        requested: false,
        escalated: false,
        confirmed: true,
      }),
      undefined,
      undefined,
      normalizeSpawnErrorCode(spawned.error),
    );
  }

  const pid = child.pid;
  const identity = createIdentity(
    pid,
    new Date().toISOString(),
    request.executable,
    request.root,
  );
  child.on("error", () => {
    runtimeError = true;
    requestStop("cancelled");
  });
  timeoutHandle = setTimeout(
    () => requestStop("timed-out"),
    remainingDurationMs,
  );
  resetIdleTimer();
  if (isAborted(request.signal)) {
    requestStop("cancelled");
  }

  const first = await Promise.race([
    closeEvent.promise.then((close) => ({ kind: "close" as const, close })),
    stopEvent.promise.then((reason) => ({ kind: "stop" as const, reason })),
  ]);

  let close: CloseObservation | undefined;
  let outcome: BoundedProcessOutcome;
  let termination: ProcessTerminationReport;
  if (first.kind === "close" && stopReason === undefined && !runtimeError) {
    close = first.close;
    outcome = "exited";
    termination = Object.freeze({
      requested: false,
      escalated: false,
      confirmed: true,
    });
  } else {
    const reason = stopReason ?? "cancelled";
    const observed = await terminateProcessTree(
      pid,
      request.limits.terminationGraceMs,
      closeEvent.promise,
    );
    close = observed.close;
    outcome = observed.confirmed && !runtimeError
      ? reason
      : "termination-uncertain";
    termination = Object.freeze({
      requested: true,
      reason,
      escalated: observed.escalated,
      confirmed: observed.confirmed && !runtimeError,
    });
    if (!termination.confirmed) {
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }
  }

  if (timeoutHandle !== undefined) {
    clearTimeout(timeoutHandle);
  }
  if (idleHandle !== undefined) {
    clearTimeout(idleHandle);
  }
  request.signal?.removeEventListener("abort", onAbort);
  child.stdout?.removeListener("data", onStdout);
  child.stderr?.removeListener("data", onStderr);

  return createResult(
    startedAt,
    startedMonotonic,
    outcome,
    capture,
    termination,
    close,
    identity,
  );
}

export function runBoundedProcess(
  value: BoundedProcessRequest,
): Promise<BoundedProcessResult> {
  try {
    const request = validateProcessRequest(value);
    return executeBoundedProcess(request);
  } catch (error) {
    return Promise.reject(error);
  }
}
