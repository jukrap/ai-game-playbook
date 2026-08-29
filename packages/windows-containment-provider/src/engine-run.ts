import {
  GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertProcessContainmentEngineRunReportSemantics,
  assertProcessContainmentEngineRunRequestSemantics,
  computeProcessContainmentEngineRunReportDigest,
  computeProcessContainmentEngineRunRequestDigest,
  isSha256Digest,
  parseStableId,
  type EngineExecutionSnapshotBinding,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineRunEffects,
  type ProcessContainmentEngineRunOutputObservation,
  type ProcessContainmentEngineRunProcessObservation,
  type ProcessContainmentEngineRunReport,
  type ProcessContainmentEngineRunReportDigestInput,
  type ProcessContainmentEngineRunRequest,
  type ProcessContainmentEngineRunTermination,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  assertEngineExecutionSnapshotAuthority,
  consumeEngineExecutionSourceHandoff,
  issueEngineExecutionSourceHandoff,
} from "@ai-game-playbook/engine-common";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, relative } from "node:path";

import {
  assertWindowsContainmentProviderArtifactIdentity,
  requireWindowsContainmentProviderRuntimeAuthority,
  type WindowsContainmentProviderRuntime,
  type WindowsContainmentProviderRuntimeAuthority,
} from "./artifact.js";
import {
  assertWindowsContainedEngineAdmission,
  claimWindowsContainedEngineAdmissionForDispatch,
} from "./admission.js";
import { WindowsContainmentProviderError } from "./errors.js";
import { safeWindowsContainmentProviderEnvironment } from "./self-test.js";

const NATIVE_ENGINE_RUN_MAX_INPUT_BYTES = 4 * 1024 * 1024;
const NATIVE_ENGINE_RUN_MAX_OUTPUT_BYTES = 256 * 1024;
const NATIVE_ENGINE_RUN_MAX_ERROR_BYTES = 16 * 1024;
const NATIVE_ENGINE_RUN_PROCESS_TIMEOUT_MS =
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS + 5_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const commandId = parseStableId("engine.headless-preflight");

export interface PrepareWindowsContainedGodotEngineRunRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly runId: string;
}

export interface PreparedWindowsContainedGodotEngineRun {
  readonly schemaVersion: "1.0.0";
  readonly request: ProcessContainmentEngineRunRequest;
  readonly requestDigest: Sha256Digest;
}

export interface RunWindowsContainedGodotEngineRequest {
  readonly prepared: PreparedWindowsContainedGodotEngineRun;
}

interface PreparedAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly runtimeAuthority: WindowsContainmentProviderRuntimeAuthority;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly requestDigest: Sha256Digest;
  consumed: boolean;
}

interface NativeProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly overflowed: boolean;
  readonly timedOut: boolean;
}

interface NativeEngineRunReport {
  readonly schemaVersion: "1.0.0";
  readonly operation: "godot-engine-run";
  readonly runId: string;
  readonly requestDigest: Sha256Digest;
  readonly entryArtifactDigest: Sha256Digest;
  readonly admissionDigest: Sha256Digest;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly invocationDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly process: ProcessContainmentEngineRunProcessObservation;
  readonly output: ProcessContainmentEngineRunOutputObservation;
  readonly termination: ProcessContainmentEngineRunTermination;
  readonly effects: ProcessContainmentEngineRunEffects;
  readonly outcome: "succeeded" | "failed" | "uncertain";
  readonly mutationUncertain: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();

function fail(
  code:
    | "provider-host-unsupported"
    | "invalid-engine-run-request"
    | "engine-run-consumed"
    | "engine-run-expired"
    | "engine-run-process-failed"
    | "engine-run-output-invalid",
  message: string,
  mutationUncertain = false,
): never {
  throw new WindowsContainmentProviderError(code, message, mutationUncertain);
}

function exactRecord(
  value: unknown,
  names: readonly string[],
  code: "invalid-engine-run-request" | "engine-run-output-invalid",
  message: string,
  mutationUncertain = false,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(code, message, mutationUncertain);
  }
  const actualNames = Object.getOwnPropertyNames(value);
  if (
    actualNames.length !== names.length ||
    !names.every((name) => actualNames.includes(name))
  ) {
    return fail(code, message, mutationUncertain);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail(code, message, mutationUncertain);
    }
  }
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isExecutableInsideProject(
  root: CanonicalProjectRoot,
  executable: BoundProcessExecutable,
): boolean {
  const path = relative(root.canonicalPath, executable.canonicalPath);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function preparationRequest(
  value: unknown,
): PrepareWindowsContainedGodotEngineRunRequest {
  const record = exactRecord(
    value,
    ["runtime", "admission", "binding", "root", "executable", "runId"],
    "invalid-engine-run-request",
    "Contained Godot run preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run requires one lowercase UUID run identity.",
    );
  }
  return Object.freeze({
    runtime: record["runtime"] as WindowsContainmentProviderRuntime,
    admission: record["admission"] as ProcessContainmentEngineAdmission,
    binding: record["binding"] as EngineExecutionSnapshotBinding,
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
    runId: record["runId"],
  });
}

function runRequest(value: unknown): RunWindowsContainedGodotEngineRequest {
  const record = exactRecord(
    value,
    ["prepared"],
    "invalid-engine-run-request",
    "Contained Godot run requires one exact prepared authority.",
  );
  return Object.freeze({
    prepared: record["prepared"] as PreparedWindowsContainedGodotEngineRun,
  });
}

export async function prepareWindowsContainedGodotEngineRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotEngineRun> {
  const input = preparationRequest(value);
  if (process.platform !== "win32" || process.arch !== "x64") {
    return fail(
      "provider-host-unsupported",
      "Windows x64 is required for a contained Godot run.",
    );
  }
  if (isExecutableInsideProject(input.root, input.executable)) {
    return fail(
      "invalid-engine-run-request",
      "The engine executable must remain outside the project source tree.",
    );
  }
  const runtimeAuthority =
    requireWindowsContainmentProviderRuntimeAuthority(input.runtime);
  await assertWindowsContainmentProviderArtifactIdentity(runtimeAuthority);
  await assertWindowsContainedEngineAdmission({
    admission: input.admission,
    runtime: input.runtime,
    binding: input.binding,
    root: input.root,
    executable: input.executable,
    operationId: commandId,
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  });
  if (
    input.admission.engine !== "godot" ||
    input.admission.operationId !== "engine.headless-preflight" ||
    input.admission.invocationDigest !== GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    input.admission.snapshotBindingDigest !== input.binding.bindingDigest ||
    input.admission.projectSnapshotDigest !== input.binding.project.snapshotDigest ||
    input.admission.executableSnapshotDigest !==
      input.binding.executable.snapshotDigest
  ) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run identities do not match the qualified admission.",
    );
  }
  const issuedMs = Date.now();
  const deadlineMs = Math.min(
    issuedMs + PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS,
    Date.parse(input.admission.expiresAt),
  );
  if (deadlineMs <= issuedMs) {
    return fail("engine-run-expired", "Contained Godot admission has expired.");
  }
  const request: ProcessContainmentEngineRunRequest = deepFreeze({
    schemaVersion: "1.0.0",
    runId: input.runId,
    admissionDigest: input.admission.admissionDigest,
    providerDescriptorDigest: input.runtime.descriptor.descriptorDigest,
    providerCatalogDigest: input.runtime.catalogDigest,
    host: { platform: "windows", architecture: "x64" },
    engine: "godot",
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    profile: {
      id: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
      digest: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
    },
    operationId: commandId,
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    snapshotBindingDigest: input.binding.bindingDigest,
    project: {
      rootIdentityDigest: input.root.identityDigest,
      snapshotDigest: input.binding.project.snapshotDigest,
      manifestDigest: input.binding.project.manifestDigest,
      fileCount: input.binding.project.fileCount,
      directoryCount: input.binding.project.directoryCount,
      totalBytes: input.binding.project.totalBytes,
    },
    executable: {
      snapshotDigest: input.binding.executable.snapshotDigest,
      digest: input.executable.digest,
      identityDigest: input.executable.identityDigest,
      bytes: input.executable.size,
    },
    issuedAt: new Date(issuedMs).toISOString(),
    startDeadline: new Date(deadlineMs).toISOString(),
    limits: {
      engineTimeoutMs: PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
      maxOutputBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
      terminationGraceMs:
        PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
      maxProcesses: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES,
      maxProjectFiles: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
      maxProjectDirectories:
        PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
      maxProjectFileBytes:
        PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
      maxProjectBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
      maxProfileBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
    },
  });
  assertProcessContainmentEngineRunRequestSemantics(request);
  const requestDigest = computeProcessContainmentEngineRunRequestDigest(request);
  const prepared: PreparedWindowsContainedGodotEngineRun = Object.freeze({
    schemaVersion: "1.0.0",
    request,
    requestDigest,
  });
  preparedAuthorities.set(prepared, {
    runtime: input.runtime,
    runtimeAuthority,
    admission: input.admission,
    binding: input.binding,
    root: input.root,
    executable: input.executable,
    requestDigest,
    consumed: false,
  });
  return prepared;
}

async function runNativeEngine(
  authority: WindowsContainmentProviderRuntimeAuthority,
  input: string,
): Promise<NativeProcessResult> {
  return await new Promise<NativeProcessResult>((resolve, reject) => {
    const child = spawn(authority.artifactPath, ["godot-engine-run"], {
      cwd: dirname(authority.artifactPath),
      detached: false,
      env: safeWindowsContainmentProviderEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    let timedOut = false;
    let settled = false;
    let terminationTimer: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout;
    const finish = (result: NativeProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      resolve(result);
    };
    const finishBuffered = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      try {
        finish({
          exitCode,
          signal,
          stdout: new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(stdout),
          ),
          stderr: new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(stderr),
          ),
          overflowed,
          timedOut,
        });
      } catch {
        reject(
          new WindowsContainmentProviderError(
            "engine-run-output-invalid",
            "Native engine run output is not valid UTF-8.",
            true,
          ),
        );
      }
    };
    const requestTermination = (): void => {
      if (terminationTimer !== undefined || settled) return;
      child.kill();
      terminationTimer = setTimeout(() => {
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finishBuffered(null, null);
      }, PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS);
      terminationTimer.unref();
    };
    timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, NATIVE_ENGINE_RUN_PROCESS_TIMEOUT_MS);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= NATIVE_ENGINE_RUN_MAX_OUTPUT_BYTES) {
        stdout.push(Buffer.from(chunk));
      } else {
        overflowed = true;
        requestTermination();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= NATIVE_ENGINE_RUN_MAX_ERROR_BYTES) {
        stderr.push(Buffer.from(chunk));
      } else {
        overflowed = true;
        requestTermination();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      reject(
        new WindowsContainmentProviderError(
          "engine-run-process-failed",
          `Native engine run process failed before settlement: ${error instanceof Error ? error.name : "Error"}.`,
          child.pid !== undefined,
        ),
      );
    });
    child.once("close", (exitCode, signal) => finishBuffered(exitCode, signal));
    child.stdin.on("error", () => {
      // Process close/error observation decides the bounded outcome.
    });
    child.stdin.end(input, "utf8");
  });
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function parseNativeProcess(
  value: unknown,
): ProcessContainmentEngineRunProcessObservation {
  const record = exactRecord(
    value,
    ["started", "startedAt", "exitCode", "totalProcesses", "activeProcesses"],
    "engine-run-output-invalid",
    "Native engine run process observation is outside the protocol.",
    true,
  );
  const started = record["started"];
  const startedAt = record["startedAt"];
  const exitCode = record["exitCode"];
  const totalProcesses = record["totalProcesses"];
  const activeProcesses = record["activeProcesses"];
  if (
    typeof started !== "boolean" ||
    (startedAt !== null && !timestamp(startedAt)) ||
    (exitCode !== null && !integer(exitCode, -2_147_483_648, 2_147_483_647)) ||
    (totalProcesses !== null && !integer(totalProcesses, 0, 1_024)) ||
    (activeProcesses !== null && !integer(activeProcesses, 0, 1_024))
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine run process observation is outside the protocol.",
      true,
    );
  }
  return Object.freeze({
    started,
    startedAt,
    exitCode,
    totalProcesses,
    activeProcesses,
  });
}

function parseNativeOutput(
  value: unknown,
): ProcessContainmentEngineRunOutputObservation {
  const record = exactRecord(
    value,
    ["logDigest", "capturedBytes", "observedBytes", "truncated"],
    "engine-run-output-invalid",
    "Native engine log observation is outside the protocol.",
    true,
  );
  if (
    !isSha256Digest(record["logDigest"]) ||
    !integer(record["capturedBytes"], 0, PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES) ||
    !integer(record["observedBytes"], 0, PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES) ||
    typeof record["truncated"] !== "boolean"
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine log observation is outside the protocol.",
      true,
    );
  }
  return Object.freeze({
    logDigest: record["logDigest"],
    capturedBytes: record["capturedBytes"],
    observedBytes: record["observedBytes"],
    truncated: record["truncated"],
  });
}

function parseNativeTermination(
  value: unknown,
): ProcessContainmentEngineRunTermination {
  const record = exactRecord(
    value,
    ["requested", "confirmed"],
    "engine-run-output-invalid",
    "Native engine termination observation is outside the protocol.",
    true,
  );
  if (
    typeof record["requested"] !== "boolean" ||
    typeof record["confirmed"] !== "boolean"
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine termination observation is outside the protocol.",
      true,
    );
  }
  return Object.freeze({
    requested: record["requested"],
    confirmed: record["confirmed"],
  });
}

function parseNativeEffects(value: unknown): ProcessContainmentEngineRunEffects {
  const names = [
    "sourceProjectPreserved",
    "sourceExecutablePreserved",
    "stagedProjectBaselinePreserved",
    "stagedExecutableBaselinePreserved",
    "profileBudgetPreserved",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ] as const;
  const record = exactRecord(
    value,
    names,
    "engine-run-output-invalid",
    "Native engine effects are outside the protocol.",
    true,
  );
  if (
    names.slice(0, -1).some((name) => typeof record[name] !== "boolean") ||
    (record["cleanup"] !== "complete" &&
      record["cleanup"] !== "incomplete" &&
      record["cleanup"] !== "uncertain")
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine effects are outside the protocol.",
      true,
    );
  }
  return Object.freeze({
    sourceProjectPreserved: record["sourceProjectPreserved"] as boolean,
    sourceExecutablePreserved: record["sourceExecutablePreserved"] as boolean,
    stagedProjectBaselinePreserved:
      record["stagedProjectBaselinePreserved"] as boolean,
    stagedExecutableBaselinePreserved:
      record["stagedExecutableBaselinePreserved"] as boolean,
    profileBudgetPreserved: record["profileBudgetPreserved"] as boolean,
    networkConnectionEstablished:
      record["networkConnectionEstablished"] as boolean,
    childProcessStarted: record["childProcessStarted"] as boolean,
    cleanup: record["cleanup"] as ProcessContainmentEngineRunEffects["cleanup"],
  });
}

function parseNativeReport(
  value: unknown,
  authority: PreparedAuthority,
  request: ProcessContainmentEngineRunRequest,
): NativeEngineRunReport {
  const record = exactRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "runId",
      "requestDigest",
      "entryArtifactDigest",
      "admissionDigest",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "profileDigest",
      "invocationDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "startedAt",
      "completedAt",
      "durationMs",
      "process",
      "output",
      "termination",
      "effects",
      "outcome",
      "mutationUncertain",
    ],
    "engine-run-output-invalid",
    "Native engine run report is outside the protocol.",
    true,
  );
  if (
    record["schemaVersion"] !== "1.0.0" ||
    record["operation"] !== "godot-engine-run" ||
    record["runId"] !== request.runId ||
    record["requestDigest"] !== authority.requestDigest ||
    record["entryArtifactDigest"] !== authority.runtimeAuthority.artifactDigest ||
    record["admissionDigest"] !== request.admissionDigest ||
    record["providerDescriptorDigest"] !== request.providerDescriptorDigest ||
    record["providerCatalogDigest"] !== request.providerCatalogDigest ||
    record["profileDigest"] !== request.profile.digest ||
    record["invocationDigest"] !== request.invocationDigest ||
    record["snapshotBindingDigest"] !== request.snapshotBindingDigest ||
    record["projectSnapshotDigest"] !== request.project.snapshotDigest ||
    record["executableSnapshotDigest"] !== request.executable.snapshotDigest ||
    !timestamp(record["startedAt"]) ||
    !timestamp(record["completedAt"]) ||
    !integer(record["durationMs"], 0, PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS) ||
    (record["outcome"] !== "succeeded" &&
      record["outcome"] !== "failed" &&
      record["outcome"] !== "uncertain") ||
    typeof record["mutationUncertain"] !== "boolean"
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine run report identities are outside the protocol.",
      true,
    );
  }
  return Object.freeze({
    schemaVersion: "1.0.0",
    operation: "godot-engine-run",
    runId: request.runId,
    requestDigest: authority.requestDigest,
    entryArtifactDigest: authority.runtimeAuthority.artifactDigest,
    admissionDigest: request.admissionDigest,
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    profileDigest: request.profile.digest,
    invocationDigest: request.invocationDigest,
    snapshotBindingDigest: request.snapshotBindingDigest,
    projectSnapshotDigest: request.project.snapshotDigest,
    executableSnapshotDigest: request.executable.snapshotDigest,
    startedAt: record["startedAt"],
    completedAt: record["completedAt"],
    durationMs: record["durationMs"],
    process: parseNativeProcess(record["process"]),
    output: parseNativeOutput(record["output"]),
    termination: parseNativeTermination(record["termination"]),
    effects: parseNativeEffects(record["effects"]),
    outcome: record["outcome"],
    mutationUncertain: record["mutationUncertain"],
  });
}

export async function runWindowsContainedGodotEngine(
  value: unknown,
): Promise<ProcessContainmentEngineRunReport> {
  const input = runRequest(value);
  const authority =
    input.prepared !== null && typeof input.prepared === "object"
      ? preparedAuthorities.get(input.prepared)
      : undefined;
  if (authority === undefined) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run lacks its same-process preparation authority.",
    );
  }
  if (authority.consumed) {
    return fail("engine-run-consumed", "Contained Godot run was already consumed.");
  }
  authority.consumed = true;
  try {
    assertProcessContainmentEngineRunRequestSemantics(input.prepared.request);
  } catch {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run request no longer matches its contract.",
    );
  }
  if (
    input.prepared.schemaVersion !== "1.0.0" ||
    input.prepared.requestDigest !== authority.requestDigest ||
    computeProcessContainmentEngineRunRequestDigest(input.prepared.request) !==
      authority.requestDigest
  ) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run no longer matches its preparation digest.",
    );
  }
  const request = input.prepared.request;
  if (Date.now() >= Date.parse(request.startDeadline)) {
    return fail("engine-run-expired", "Contained Godot run start window expired.");
  }
  await assertWindowsContainmentProviderArtifactIdentity(
    authority.runtimeAuthority,
  );
  await claimWindowsContainedEngineAdmissionForDispatch({
    admission: authority.admission,
    runtime: authority.runtime,
    binding: authority.binding,
    root: authority.root,
    executable: authority.executable,
    operationId: commandId,
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  });
  const handoff = await issueEngineExecutionSourceHandoff({
    binding: authority.binding,
    root: authority.root,
    executable: authority.executable,
    profileId: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  });
  if (
    handoff.profileDigest !== request.profile.digest ||
    handoff.bindingDigest !== request.snapshotBindingDigest ||
    handoff.projectSnapshotDigest !== request.project.snapshotDigest ||
    handoff.executableSnapshotDigest !== request.executable.snapshotDigest ||
    handoff.manifestDigest !== request.project.manifestDigest
  ) {
    return fail(
      "invalid-engine-run-request",
      "Private source handoff no longer matches the prepared run.",
    );
  }
  const source = consumeEngineExecutionSourceHandoff(handoff);
  const nativeRequest = {
    schemaVersion: "1.0.0",
    operation: "godot-engine-run",
    runId: request.runId,
    requestDigest: authority.requestDigest,
    entryArtifactDigest: authority.runtimeAuthority.artifactDigest,
    admissionDigest: request.admissionDigest,
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    policyDigest: request.policyDigest,
    profileId: request.profile.id,
    profileDigest: request.profile.digest,
    invocationDigest: request.invocationDigest,
    snapshotBindingDigest: request.snapshotBindingDigest,
    projectRootIdentityDigest: request.project.rootIdentityDigest,
    projectSnapshotDigest: request.project.snapshotDigest,
    projectManifestDigest: request.project.manifestDigest,
    projectFileCount: request.project.fileCount,
    projectDirectoryCount: request.project.directoryCount,
    projectTotalBytes: request.project.totalBytes,
    sourceProjectRoot: source.root.canonicalPath,
    projectDirectories: source.manifest.directories,
    projectFiles: source.manifest.files,
    executableSnapshotDigest: request.executable.snapshotDigest,
    sourceExecutablePath: source.executable.canonicalPath,
    sourceExecutableDigest: request.executable.digest,
    sourceExecutableIdentityDigest: request.executable.identityDigest,
    sourceExecutableBytes: request.executable.bytes,
    issuedAt: request.issuedAt,
    startDeadline: request.startDeadline,
    engineTimeoutMs: request.limits.engineTimeoutMs,
    maxOutputBytes: request.limits.maxOutputBytes,
    terminationGraceMs: request.limits.terminationGraceMs,
    maxProcesses: request.limits.maxProcesses,
    maxProjectFiles: request.limits.maxProjectFiles,
    maxProjectDirectories: request.limits.maxProjectDirectories,
    maxProjectFileBytes: request.limits.maxProjectFileBytes,
    maxProjectBytes: request.limits.maxProjectBytes,
    maxProfileBytes: request.limits.maxProfileBytes,
  };
  const nativeInput = `${JSON.stringify(nativeRequest)}\n`;
  if (Buffer.byteLength(nativeInput, "utf8") > NATIVE_ENGINE_RUN_MAX_INPUT_BYTES) {
    return fail(
      "invalid-engine-run-request",
      "Private source manifest exceeds the bounded native protocol.",
    );
  }
  const result = await runNativeEngine(authority.runtimeAuthority, nativeInput);
  if (result.overflowed || result.timedOut || result.signal !== null) {
    return fail(
      "engine-run-process-failed",
      "Native engine run did not settle within its outer process boundary.",
      true,
    );
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  if (
    lines.length !== 1 ||
    lines[0] === undefined ||
    lines[0].length === 0 ||
    result.stderr.trim().length !== 0
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native engine run did not return one path-free report.",
      true,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]) as unknown;
  } catch {
    return fail(
      "engine-run-output-invalid",
      "Native engine run report is not valid JSON.",
      true,
    );
  }
  const native = parseNativeReport(parsed, authority, request);
  const expectedExit = native.outcome === "succeeded" ? 0 : native.outcome === "failed" ? 2 : 3;
  if (result.exitCode !== expectedExit) {
    return fail(
      "engine-run-output-invalid",
      "Native engine run exit status contradicts its report.",
      true,
    );
  }

  let postSourcePreserved = true;
  try {
    await assertEngineExecutionSnapshotAuthority({
      binding: authority.binding,
      root: authority.root,
      executable: authority.executable,
    });
  } catch {
    postSourcePreserved = false;
  }
  const effects: ProcessContainmentEngineRunEffects = Object.freeze({
    ...native.effects,
    sourceProjectPreserved:
      native.effects.sourceProjectPreserved && postSourcePreserved,
    sourceExecutablePreserved:
      native.effects.sourceExecutablePreserved && postSourcePreserved,
  });
  const outcome = postSourcePreserved ? native.outcome : "uncertain";
  const mutationUncertain = postSourcePreserved
    ? native.mutationUncertain
    : true;
  const reportInput: ProcessContainmentEngineRunReportDigestInput = deepFreeze({
    runId: request.runId,
    request,
    requestDigest: authority.requestDigest,
    admissionDigest: request.admissionDigest,
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    engine: "godot",
    profileDigest: request.profile.digest,
    operationId: request.operationId,
    invocationDigest: request.invocationDigest,
    snapshotBindingDigest: request.snapshotBindingDigest,
    projectSnapshotDigest: request.project.snapshotDigest,
    executableSnapshotDigest: request.executable.snapshotDigest,
    startedAt: native.startedAt,
    completedAt: native.completedAt,
    durationMs: native.durationMs,
    process: native.process,
    output: native.output,
    termination: native.termination,
    effects,
    outcome,
    mutationUncertain,
  });
  const report: ProcessContainmentEngineRunReport = deepFreeze({
    schemaVersion: "1.0.0",
    ...reportInput,
    reportDigest: computeProcessContainmentEngineRunReportDigest(reportInput),
  });
  try {
    assertProcessContainmentEngineRunReportSemantics(report);
  } catch {
    return fail(
      "engine-run-output-invalid",
      "Native engine run report contradicts the public run contract.",
      true,
    );
  }
  return report;
}
