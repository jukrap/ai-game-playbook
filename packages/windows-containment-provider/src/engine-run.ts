import {
  GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
  GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
  GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE,
  GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
  GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertProcessContainmentEngineRunReportSemantics,
  assertProcessContainmentEngineRunRequestSemantics,
  computeProcessContainmentEngineRunReportDigest,
  computeProcessContainmentEngineRunRequestDigest,
  isSha256Digest,
  type EngineExecutionSnapshotBinding,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineRunEffects,
  type ProcessContainmentEngineRunOutputObservation,
  type ProcessContainmentEngineRunProcessObservation,
  type ProcessContainmentEngineRunReport,
  type ProcessContainmentEngineRunReportDigestInput,
  type ProcessContainmentEngineRunRequest,
  type ProcessContainmentEngineRunTermination,
  type ProcessContainmentEngineExecutionProfile,
  type ProcessContainmentEngineExecutionProfileId,
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
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative } from "node:path";
import { isProxy } from "node:util/types";

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
const NATIVE_ENGINE_STRUCTURED_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const NATIVE_ENGINE_RUN_MAX_ERROR_BYTES = 16 * 1024;
const NATIVE_ENGINE_RUN_CANCELLATION_WAIT_MS = 2_000;
const NATIVE_ENGINE_RUN_CANCELLATION_PROCESS_TIMEOUT_MS = 3_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface PrepareWindowsContainedGodotEngineRunRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly runId: string;
}

export interface PrepareWindowsContainedGodotReplayRunRequest
  extends PrepareWindowsContainedGodotEngineRunRequest {
  readonly expectationDigest: Sha256Digest;
}

export type PrepareWindowsContainedGodotImportRunRequest =
  PrepareWindowsContainedGodotReplayRunRequest;

export type PrepareWindowsContainedGodotValidationRunRequest =
  PrepareWindowsContainedGodotReplayRunRequest;

export type PrepareWindowsContainedGodotPersistenceRunRequest =
  PrepareWindowsContainedGodotReplayRunRequest;

export interface PreparedWindowsContainedGodotEngineRun {
  readonly schemaVersion: "1.0.0";
  readonly request: ProcessContainmentEngineRunRequest;
  readonly requestDigest: Sha256Digest;
}

export interface RunWindowsContainedGodotEngineRequest {
  readonly prepared: PreparedWindowsContainedGodotEngineRun;
  readonly signal: AbortSignal | null;
}

export type PreparedWindowsContainedGodotReplayRun =
  PreparedWindowsContainedGodotEngineRun;

export type PreparedWindowsContainedGodotImportRun =
  PreparedWindowsContainedGodotEngineRun;

export type PreparedWindowsContainedGodotValidationRun =
  PreparedWindowsContainedGodotEngineRun;

export type PreparedWindowsContainedGodotPersistenceRun =
  PreparedWindowsContainedGodotEngineRun;

export type RunWindowsContainedGodotReplayRequest =
  RunWindowsContainedGodotEngineRequest;

export type RunWindowsContainedGodotImportRequest =
  RunWindowsContainedGodotEngineRequest;

export type RunWindowsContainedGodotValidationRequest =
  RunWindowsContainedGodotEngineRequest;

export type RunWindowsContainedGodotPersistenceRequest =
  RunWindowsContainedGodotEngineRequest;

export interface WindowsContainedGodotReplayExecution {
  readonly schemaVersion: "1.0.0";
  readonly report: ProcessContainmentEngineRunReport;
  readonly transcript:
    | {
        readonly status: "available";
        readonly digest: Sha256Digest;
        readonly bytes: number;
      }
    | { readonly status: "unavailable" };
}

export type WindowsContainedGodotValidationExecution =
  WindowsContainedGodotReplayExecution;

export type WindowsContainedGodotPersistenceExecution =
  WindowsContainedGodotReplayExecution;

interface ContainedEngineRunResult {
  readonly report: ProcessContainmentEngineRunReport;
  readonly transcript?: string;
}

interface PreparedAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly runtimeAuthority: WindowsContainmentProviderRuntimeAuthority;
  readonly admission: ProcessContainmentEngineAdmission;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly profile: ProcessContainmentEngineExecutionProfile;
  readonly inputBindingDigest: Sha256Digest | null;
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
  readonly operationId: ProcessContainmentEngineRunRequest["operationId"];
  readonly profileDigest: Sha256Digest;
  readonly profileContractDigest: Sha256Digest;
  readonly profileCatalogDigest: Sha256Digest;
  readonly invocationDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest | null;
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
  readonly outcome: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly mutationUncertain: boolean;
}

interface ReplayTranscriptAttestation {
  readonly process: ProcessContainmentEngineRunProcessObservation;
  readonly output: ProcessContainmentEngineRunOutputObservation;
  readonly termination: ProcessContainmentEngineRunTermination;
  readonly effects: ProcessContainmentEngineRunEffects;
  readonly outcome: "succeeded" | "failed" | "cancelled" | "uncertain";
  readonly mutationUncertain: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();
const replayTranscripts = new WeakMap<object, string>();
const validationTranscripts = new WeakMap<object, string>();
const persistenceTranscripts = new WeakMap<object, string>();

function fail(
  code:
    | "provider-host-unsupported"
    | "invalid-engine-run-request"
    | "engine-run-consumed"
    | "engine-run-expired"
    | "engine-run-cancelled-before-start"
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
    isProxy(value) ||
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

function replayPreparationRequest(
  value: unknown,
  label = "replay",
): PrepareWindowsContainedGodotReplayRunRequest {
  const record = exactRecord(
    value,
    [
      "runtime",
      "admission",
      "binding",
      "root",
      "executable",
      "runId",
      "expectationDigest",
    ],
    "invalid-engine-run-request",
    `Contained Godot ${label} preparation contains undeclared fields.`,
  );
  if (
    typeof record["runId"] !== "string" ||
    !uuidPattern.test(record["runId"]) ||
    !isSha256Digest(record["expectationDigest"])
  ) {
    return fail(
      "invalid-engine-run-request",
      `Contained Godot ${label} requires canonical run and expectation identities.`,
    );
  }
  return Object.freeze({
    runtime: record["runtime"] as WindowsContainmentProviderRuntime,
    admission: record["admission"] as ProcessContainmentEngineAdmission,
    binding: record["binding"] as EngineExecutionSnapshotBinding,
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
    runId: record["runId"],
    expectationDigest: record["expectationDigest"],
  });
}

function runRequest(value: unknown): RunWindowsContainedGodotEngineRequest {
  const record = exactRecord(
    value,
    ["prepared", "signal"],
    "invalid-engine-run-request",
    "Contained Godot run requires one exact prepared authority.",
  );
  if (record["signal"] !== null && !(record["signal"] instanceof AbortSignal)) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot cancellation signal is outside the runtime boundary.",
    );
  }
  return Object.freeze({
    prepared: record["prepared"] as PreparedWindowsContainedGodotEngineRun,
    signal: record["signal"] as AbortSignal | null,
  });
}

export async function prepareWindowsContainedGodotEngineRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotEngineRun> {
  const input = preparationRequest(value);
  return await prepareWindowsContainedGodotEngineRunForProfile(
    input,
    GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
    null,
  );
}

export async function prepareWindowsContainedGodotReplayRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotReplayRun> {
  const input = replayPreparationRequest(value);
  return await prepareWindowsContainedGodotEngineRunForProfile(
    input,
    GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
    input.expectationDigest,
  );
}

export async function prepareWindowsContainedGodotImportRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotImportRun> {
  const input = replayPreparationRequest(value, "project import");
  return await prepareWindowsContainedGodotEngineRunForProfile(
    input,
    GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    input.expectationDigest,
  );
}

export async function prepareWindowsContainedGodotValidationRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotValidationRun> {
  const input = replayPreparationRequest(value, "project validation");
  return await prepareWindowsContainedGodotEngineRunForProfile(
    input,
    GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    input.expectationDigest,
  );
}

export async function prepareWindowsContainedGodotPersistenceRun(
  value: unknown,
): Promise<PreparedWindowsContainedGodotPersistenceRun> {
  const input = replayPreparationRequest(value, "persistence cycle");
  return await prepareWindowsContainedGodotEngineRunForProfile(
    input,
    GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE,
    input.expectationDigest,
  );
}

async function prepareWindowsContainedGodotEngineRunForProfile(
  input: PrepareWindowsContainedGodotEngineRunRequest,
  profile: ProcessContainmentEngineExecutionProfile,
  inputBindingDigest: Sha256Digest | null,
): Promise<PreparedWindowsContainedGodotEngineRun> {
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
    operationId: profile.operationId,
    invocationDigest: profile.invocationDigest,
  });
  if (
    input.admission.engine !== "godot" ||
    input.admission.operationId !== profile.operationId ||
    input.admission.invocationDigest !== profile.invocationDigest ||
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
    issuedMs + profile.limits.startValidityMs,
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
      id: profile.profileId,
      digest: profile.profileDigest,
      contractDigest: profile.contractDigest,
      catalogDigest:
        PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
    },
    operationId: profile.operationId,
    invocationDigest: profile.invocationDigest,
    inputBindingDigest,
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
    limits: { ...profile.limits },
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
    profile,
    inputBindingDigest,
    requestDigest,
    consumed: false,
  });
  return prepared;
}

async function signalNativeEngineCancellation(
  authority: WindowsContainmentProviderRuntimeAuthority,
  runId: string,
  requestDigest: Sha256Digest,
  cancellationId: string,
): Promise<boolean> {
  const expiresAt = new Date(
    Date.now() + NATIVE_ENGINE_RUN_CANCELLATION_WAIT_MS,
  ).toISOString();
  const input = `${JSON.stringify({
    schemaVersion: "1.0.0",
    operation: "godot-engine-cancel",
    runId,
    requestDigest,
    entryArtifactDigest: authority.artifactDigest,
    cancellationId,
    expiresAt,
  })}\n`;
  return await new Promise<boolean>((resolve) => {
    const child = spawn(authority.artifactPath, ["godot-engine-cancel"], {
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
    let invalid = false;
    let settled = false;
    const finish = (acknowledged: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(acknowledged);
    };
    const timer = setTimeout(() => {
      invalid = true;
      child.kill();
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      finish(false);
    }, NATIVE_ENGINE_RUN_CANCELLATION_PROCESS_TIMEOUT_MS);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= NATIVE_ENGINE_RUN_MAX_ERROR_BYTES) {
        stdout.push(Buffer.from(chunk));
      } else {
        invalid = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= NATIVE_ENGINE_RUN_MAX_ERROR_BYTES) {
        stderr.push(Buffer.from(chunk));
      } else {
        invalid = true;
        child.kill();
      }
    });
    child.once("error", () => finish(false));
    child.once("close", (exitCode, signal) => {
      if (
        invalid ||
        signal !== null ||
        exitCode !== 0 ||
        Buffer.concat(stderr).toString("utf8").trim().length !== 0
      ) {
        finish(false);
        return;
      }
      try {
        const lines = new TextDecoder("utf-8", { fatal: true })
          .decode(Buffer.concat(stdout))
          .trim()
          .split(/\r?\n/u);
        if (lines.length !== 1 || lines[0] === undefined) {
          finish(false);
          return;
        }
        const report = exactRecord(
          JSON.parse(lines[0]) as unknown,
          [
            "schemaVersion",
            "operation",
            "runId",
            "requestDigest",
            "entryArtifactDigest",
            "cancellationId",
            "acknowledged",
          ],
          "engine-run-output-invalid",
          "Native cancellation acknowledgement is outside the protocol.",
        );
        finish(
          report["schemaVersion"] === "1.0.0" &&
            report["operation"] === "godot-engine-cancel" &&
            report["runId"] === runId &&
            report["requestDigest"] === requestDigest &&
            report["entryArtifactDigest"] === authority.artifactDigest &&
            report["cancellationId"] === cancellationId &&
            report["acknowledged"] === true,
        );
      } catch {
        finish(false);
      }
    });
    child.stdin.on("error", () => {
      // Process close/error observation decides the bounded outcome.
    });
    child.stdin.end(input, "utf8");
  }).catch(() => false);
}

async function runNativeEngine(
  authority: WindowsContainmentProviderRuntimeAuthority,
  input: string,
  runId: string,
  requestDigest: Sha256Digest,
  cancellationId: string,
  signal: AbortSignal | null,
  maximumResponseBytes: number,
  processTimeoutMs: number,
  terminationGraceMs: number,
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
    let hardStopTimer: NodeJS.Timeout | undefined;
    let cancellationTask: Promise<boolean> | undefined;
    let timer: NodeJS.Timeout;
    const requestCancellation = (): Promise<boolean> => {
      cancellationTask ??= signalNativeEngineCancellation(
        authority,
        runId,
        requestDigest,
        cancellationId,
      );
      return cancellationTask;
    };
    const abortListener = (): void => {
      void requestCancellation();
    };
    const finish = async (result: NativeProcessResult): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      if (hardStopTimer !== undefined) clearTimeout(hardStopTimer);
      signal?.removeEventListener("abort", abortListener);
      if (cancellationTask !== undefined) {
        await cancellationTask;
      }
      resolve(result);
    };
    const finishBuffered = (
      exitCode: number | null,
      exitSignal: NodeJS.Signals | null,
    ): void => {
      try {
        void finish({
          exitCode,
          signal: exitSignal,
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
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (terminationTimer !== undefined) clearTimeout(terminationTimer);
        if (hardStopTimer !== undefined) clearTimeout(hardStopTimer);
        signal?.removeEventListener("abort", abortListener);
        const failure = new WindowsContainmentProviderError(
          "engine-run-output-invalid",
          "Native engine run output is not valid UTF-8.",
          true,
        );
        void (async () => {
          if (cancellationTask !== undefined) {
            await cancellationTask;
          }
          reject(failure);
        })();
      }
    };
    const requestTermination = (): void => {
      if (terminationTimer !== undefined || settled) return;
      void requestCancellation();
      terminationTimer = setTimeout(() => {
        child.kill();
        hardStopTimer = setTimeout(() => {
          child.stdin.destroy();
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
          finishBuffered(null, null);
        }, terminationGraceMs);
        hardStopTimer.unref();
      }, terminationGraceMs);
      terminationTimer.unref();
    };
    timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, processTimeoutMs);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= maximumResponseBytes) {
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
      if (terminationTimer !== undefined) {
        // The emergency timer still owns bounded settlement after a failed kill.
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (terminationTimer !== undefined) clearTimeout(terminationTimer);
      if (hardStopTimer !== undefined) clearTimeout(hardStopTimer);
      signal?.removeEventListener("abort", abortListener);
      const failure = new WindowsContainmentProviderError(
        "engine-run-process-failed",
        `Native engine run process failed before settlement: ${error instanceof Error ? error.name : "Error"}.`,
        child.pid !== undefined,
      );
      void (async () => {
        if (cancellationTask !== undefined) {
          await cancellationTask;
        }
        reject(failure);
      })();
    });
    child.once("close", (exitCode, signal) => finishBuffered(exitCode, signal));
    child.stdin.on("error", () => {
      // Process close/error observation decides the bounded outcome.
    });
    child.stdin.end(input, "utf8");
    signal?.addEventListener("abort", abortListener, { once: true });
    if (signal?.aborted === true) abortListener();
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
  request: ProcessContainmentEngineRunRequest,
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
    !integer(record["capturedBytes"], 0, request.limits.maxOutputBytes) ||
    !integer(record["observedBytes"], 0, request.limits.maxProfileBytes) ||
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
    ["requested", "confirmed", "cause"],
    "engine-run-output-invalid",
    "Native engine termination observation is outside the protocol.",
    true,
  );
  if (
    typeof record["requested"] !== "boolean" ||
    typeof record["confirmed"] !== "boolean" ||
    (record["cause"] !== "none" &&
      record["cause"] !== "engine-timeout" &&
      record["cause"] !== "idle-timeout" &&
      record["cause"] !== "caller-cancelled" &&
      record["cause"] !== "safety-boundary")
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
    cause: record["cause"],
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
      "operationId",
      "profileDigest",
      "profileContractDigest",
      "profileCatalogDigest",
      "invocationDigest",
      "inputBindingDigest",
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
    record["operationId"] !== request.operationId ||
    record["profileDigest"] !== request.profile.digest ||
    record["profileContractDigest"] !== request.profile.contractDigest ||
    record["profileCatalogDigest"] !== request.profile.catalogDigest ||
    record["invocationDigest"] !== request.invocationDigest ||
    record["inputBindingDigest"] !== request.inputBindingDigest ||
    record["snapshotBindingDigest"] !== request.snapshotBindingDigest ||
    record["projectSnapshotDigest"] !== request.project.snapshotDigest ||
    record["executableSnapshotDigest"] !== request.executable.snapshotDigest ||
    !timestamp(record["startedAt"]) ||
    !timestamp(record["completedAt"]) ||
    !integer(record["durationMs"], 0, request.limits.maxReportDurationMs) ||
    (record["outcome"] !== "succeeded" &&
      record["outcome"] !== "failed" &&
      record["outcome"] !== "cancelled" &&
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
    operationId: request.operationId,
    profileDigest: request.profile.digest,
    profileContractDigest: request.profile.contractDigest,
    profileCatalogDigest: request.profile.catalogDigest,
    invocationDigest: request.invocationDigest,
    inputBindingDigest: request.inputBindingDigest,
    snapshotBindingDigest: request.snapshotBindingDigest,
    projectSnapshotDigest: request.project.snapshotDigest,
    executableSnapshotDigest: request.executable.snapshotDigest,
    startedAt: record["startedAt"],
    completedAt: record["completedAt"],
    durationMs: record["durationMs"],
    process: parseNativeProcess(record["process"]),
    output: parseNativeOutput(record["output"], request),
    termination: parseNativeTermination(record["termination"]),
    effects: parseNativeEffects(record["effects"]),
    outcome: record["outcome"],
    mutationUncertain: record["mutationUncertain"],
  });
}

function structuredOutputCanTransfer(
  report: ReplayTranscriptAttestation,
  expectedProcesses: number,
): boolean {
  const exitOutcomeMatches =
    (report.process.exitCode === 0 && report.outcome === "succeeded") ||
    (report.process.exitCode === 2 && report.outcome === "failed");
  return (
    report.process.started &&
    report.process.totalProcesses === expectedProcesses &&
    report.process.activeProcesses === 0 &&
    exitOutcomeMatches &&
    !report.output.truncated &&
    !report.termination.requested &&
    report.termination.confirmed &&
    report.termination.cause === "none" &&
    report.effects.sourceProjectPreserved &&
    report.effects.sourceExecutablePreserved &&
    report.effects.stagedProjectBaselinePreserved &&
    report.effects.stagedExecutableBaselinePreserved &&
    report.effects.profileBudgetPreserved &&
    !report.effects.networkConnectionEstablished &&
    !report.effects.childProcessStarted &&
    report.effects.cleanup === "complete" &&
    !report.mutationUncertain
  );
}

function parseStructuredOutput(
  value: unknown,
  native: NativeEngineRunReport,
  request: ProcessContainmentEngineRunRequest,
): string | undefined {
  if (value === null) {
    if (structuredOutputCanTransfer(native, request.limits.maxProcesses)) {
      return fail(
        "engine-run-output-invalid",
        "Native run omitted bounded structured output after a clean exit.",
        true,
      );
    }
    return undefined;
  }
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > NATIVE_ENGINE_STRUCTURED_MAX_OUTPUT_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native structured output encoding is outside the protocol.",
      true,
    );
  }
  const bytes = Buffer.from(value, "base64");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (
    bytes.toString("base64") !== value ||
    bytes.byteLength < 1 ||
    bytes.byteLength > request.limits.maxOutputBytes ||
    native.output.truncated ||
    native.output.capturedBytes !== bytes.byteLength ||
    native.output.observedBytes !== bytes.byteLength ||
    native.output.logDigest !== digest ||
    !structuredOutputCanTransfer(native, request.limits.maxProcesses)
  ) {
    return fail(
      "engine-run-output-invalid",
      "Native structured output contradicts its bounded output attestation.",
      true,
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(
      "engine-run-output-invalid",
      "Native structured output is not valid UTF-8.",
      true,
    );
  }
}

async function runWindowsContainedGodotEngineForProfile(
  value: unknown,
  expectedProfileId: ProcessContainmentEngineExecutionProfileId,
): Promise<ContainedEngineRunResult> {
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
  if (authority.profile.profileId !== expectedProfileId) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run was prepared for a different execution profile.",
    );
  }
  if (authority.consumed) {
    return fail("engine-run-consumed", "Contained Godot run was already consumed.");
  }
  authority.consumed = true;
  if (input.signal?.aborted === true) {
    return fail(
      "engine-run-cancelled-before-start",
      "Contained Godot run was cancelled before native dispatch.",
    );
  }
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
  if (
    request.profile.id !== authority.profile.profileId ||
    request.profile.digest !== authority.profile.profileDigest ||
    request.profile.contractDigest !== authority.profile.contractDigest ||
    request.inputBindingDigest !== authority.inputBindingDigest
  ) {
    return fail(
      "invalid-engine-run-request",
      "Contained Godot run profile no longer matches its preparation authority.",
    );
  }
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
    operationId: authority.profile.operationId,
    invocationDigest: authority.profile.invocationDigest,
  });
  const handoff = await issueEngineExecutionSourceHandoff({
    binding: authority.binding,
    root: authority.root,
    executable: authority.executable,
    profileId: authority.profile.profileId,
  });
  if (
    handoff.profileDigest !== request.profile.digest ||
    handoff.profileContractDigest !== request.profile.contractDigest ||
    handoff.profileCatalogDigest !== request.profile.catalogDigest ||
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
  const cancellationId = randomUUID();
  const nativeRequest = {
    schemaVersion: "1.0.0",
    operation: "godot-engine-run",
    runId: request.runId,
    cancellationId,
    requestDigest: authority.requestDigest,
    entryArtifactDigest: authority.runtimeAuthority.artifactDigest,
    admissionDigest: request.admissionDigest,
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    policyDigest: request.policyDigest,
    operationId: request.operationId,
    profileId: request.profile.id,
    profileDigest: request.profile.digest,
    profileContractDigest: request.profile.contractDigest,
    profileCatalogDigest: request.profile.catalogDigest,
    invocationDigest: request.invocationDigest,
    inputBindingDigest: request.inputBindingDigest,
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
    startValidityMs: request.limits.startValidityMs,
    processTimeoutMs: request.limits.processTimeoutMs,
    idleTimeoutMs: request.limits.idleTimeoutMs,
    maxOutputBytes: request.limits.maxOutputBytes,
    terminationGraceMs: request.limits.terminationGraceMs,
    maxProcesses: request.limits.maxProcesses,
    maxProjectFiles: request.limits.maxProjectFiles,
    maxProjectDirectories: request.limits.maxProjectDirectories,
    maxProjectFileBytes: request.limits.maxProjectFileBytes,
    maxProjectBytes: request.limits.maxProjectBytes,
    maxProfileBytes: request.limits.maxProfileBytes,
    maxReportDurationMs: request.limits.maxReportDurationMs,
    outputKind: authority.profile.output.kind,
    outputPrefix: authority.profile.output.prefix,
    maxLineBytes: authority.profile.output.maxLineBytes,
    maxEvents: authority.profile.output.maxEvents,
    retainRawOutput: authority.profile.output.retainRawOutput,
  };
  const nativeInput = `${JSON.stringify(nativeRequest)}\n`;
  if (Buffer.byteLength(nativeInput, "utf8") > NATIVE_ENGINE_RUN_MAX_INPUT_BYTES) {
    return fail(
      "invalid-engine-run-request",
      "Private source manifest exceeds the bounded native protocol.",
    );
  }
  const result = await runNativeEngine(
    authority.runtimeAuthority,
    nativeInput,
    request.runId,
    authority.requestDigest,
    cancellationId,
    input.signal,
    authority.profile.output.kind === "prefixed-json-lines"
      ? NATIVE_ENGINE_STRUCTURED_MAX_OUTPUT_BYTES
      : NATIVE_ENGINE_RUN_MAX_OUTPUT_BYTES,
    request.limits.maxReportDurationMs + 5_000,
    request.limits.terminationGraceMs,
  );
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
  let nativeValue = parsed;
  let encodedStructuredOutput: unknown;
  if (authority.profile.output.kind === "prefixed-json-lines") {
    const envelope = exactRecord(
      parsed,
      ["schemaVersion", "operation", "report", "structuredOutputBase64"],
      "engine-run-output-invalid",
      "Native structured output envelope is outside the protocol.",
      true,
    );
    if (
      envelope["schemaVersion"] !== "1.0.0" ||
      envelope["operation"] !== "godot-engine-structured-output-envelope"
    ) {
      return fail(
        "engine-run-output-invalid",
        "Native structured output envelope identity is outside the protocol.",
        true,
      );
    }
    nativeValue = envelope["report"];
    encodedStructuredOutput = envelope["structuredOutputBase64"];
  }
  const native = parseNativeReport(nativeValue, authority, request);
  const transcript =
    authority.profile.output.kind === "prefixed-json-lines"
      ? parseStructuredOutput(encodedStructuredOutput, native, request)
      : undefined;
  const expectedExit =
    native.outcome === "succeeded"
      ? 0
      : native.outcome === "failed"
        ? 2
        : native.outcome === "cancelled"
          ? 4
          : 3;
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
    profileContractDigest: request.profile.contractDigest,
    profileCatalogDigest: request.profile.catalogDigest,
    operationId: request.operationId,
    invocationDigest: request.invocationDigest,
    inputBindingDigest: request.inputBindingDigest,
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
  const transferableTranscript =
    transcript !== undefined &&
    structuredOutputCanTransfer(report, request.limits.maxProcesses)
      ? transcript
      : undefined;
  return Object.freeze({
    report,
    ...(transferableTranscript === undefined
      ? {}
      : { transcript: transferableTranscript }),
  });
}

export async function runWindowsContainedGodotEngine(
  value: unknown,
): Promise<ProcessContainmentEngineRunReport> {
  const result = await runWindowsContainedGodotEngineForProfile(
    value,
    GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.profileId,
  );
  if (result.transcript !== undefined) {
    return fail(
      "engine-run-output-invalid",
      "Headless preflight unexpectedly returned replay output.",
      true,
    );
  }
  return result.report;
}

export async function runWindowsContainedGodotImport(
  value: unknown,
): Promise<ProcessContainmentEngineRunReport> {
  const result = await runWindowsContainedGodotEngineForProfile(
    value,
    GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.profileId,
  );
  if (result.transcript !== undefined) {
    return fail(
      "engine-run-output-invalid",
      "Project import unexpectedly returned structured output.",
      true,
    );
  }
  return result.report;
}

export async function runWindowsContainedGodotReplay(
  value: unknown,
): Promise<WindowsContainedGodotReplayExecution> {
  const result = await runWindowsContainedGodotEngineForProfile(
    value,
    GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.profileId,
  );
  const execution: WindowsContainedGodotReplayExecution = Object.freeze({
    schemaVersion: "1.0.0",
    report: result.report,
    transcript:
      result.transcript === undefined
        ? Object.freeze({ status: "unavailable" as const })
        : Object.freeze({
            status: "available" as const,
            digest: result.report.output.logDigest,
            bytes: result.report.output.capturedBytes,
          }),
  });
  if (result.transcript !== undefined) {
    replayTranscripts.set(execution, result.transcript);
  }
  return execution;
}

export function consumeWindowsContainedGodotReplayTranscript(
  execution: unknown,
): string {
  const transcript =
    execution !== null && typeof execution === "object"
      ? replayTranscripts.get(execution)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "engine-run-output-invalid",
      "Godot replay transcript is unavailable, cloned, or already consumed.",
    );
  }
  replayTranscripts.delete(execution as object);
  return transcript;
}

export async function runWindowsContainedGodotValidation(
  value: unknown,
): Promise<WindowsContainedGodotValidationExecution> {
  const result = await runWindowsContainedGodotEngineForProfile(
    value,
    GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.profileId,
  );
  const execution: WindowsContainedGodotValidationExecution = Object.freeze({
    schemaVersion: "1.0.0",
    report: result.report,
    transcript:
      result.transcript === undefined
        ? Object.freeze({ status: "unavailable" as const })
        : Object.freeze({
            status: "available" as const,
            digest: result.report.output.logDigest,
            bytes: result.report.output.capturedBytes,
          }),
  });
  if (result.transcript !== undefined) {
    validationTranscripts.set(execution, result.transcript);
  }
  return execution;
}

export function consumeWindowsContainedGodotValidationTranscript(
  execution: unknown,
): string {
  const transcript =
    execution !== null && typeof execution === "object"
      ? validationTranscripts.get(execution)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "engine-run-output-invalid",
      "Godot project validation transcript is unavailable, cloned, or already consumed.",
    );
  }
  validationTranscripts.delete(execution as object);
  return transcript;
}

export async function runWindowsContainedGodotPersistence(
  value: unknown,
): Promise<WindowsContainedGodotPersistenceExecution> {
  const result = await runWindowsContainedGodotEngineForProfile(
    value,
    GODOT_PERSISTENCE_CYCLE_ENGINE_EXECUTION_PROFILE.profileId,
  );
  const execution: WindowsContainedGodotPersistenceExecution = Object.freeze({
    schemaVersion: "1.0.0",
    report: result.report,
    transcript:
      result.transcript === undefined
        ? Object.freeze({ status: "unavailable" as const })
        : Object.freeze({
            status: "available" as const,
            digest: result.report.output.logDigest,
            bytes: result.report.output.capturedBytes,
          }),
  });
  if (result.transcript !== undefined) {
    persistenceTranscripts.set(execution, result.transcript);
  }
  return execution;
}

export function consumeWindowsContainedGodotPersistenceTranscript(
  execution: unknown,
): string {
  const transcript =
    execution !== null && typeof execution === "object"
      ? persistenceTranscripts.get(execution)
      : undefined;
  if (transcript === undefined) {
    return fail(
      "engine-run-output-invalid",
      "Godot persistence transcript is unavailable, cloned, or already consumed.",
    );
  }
  persistenceTranscripts.delete(execution as object);
  return transcript;
}
