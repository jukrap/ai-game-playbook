import {
  PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
  PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
  PROCESS_CONTAINMENT_LAUNCH_MAX_VALIDITY_MS,
  PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST,
  assertProcessContainmentLaunchReportSemantics,
  assertProcessContainmentLaunchRequestSemantics,
  canonicalizeJson,
  computeProcessContainmentLaunchExecutableSnapshotDigest,
  computeProcessContainmentLaunchProjectSnapshotDigest,
  computeProcessContainmentLaunchReportDigest,
  computeProcessContainmentLaunchRequestDigest,
  digestCanonicalJson,
  isSha256Digest,
  sha256Digest,
  type ProcessContainmentLaunchEffects,
  type ProcessContainmentLaunchExecutableSnapshot,
  type ProcessContainmentLaunchOutputObservation,
  type ProcessContainmentLaunchProcessObservation,
  type ProcessContainmentLaunchProjectSnapshot,
  type ProcessContainmentLaunchReport,
  type ProcessContainmentLaunchReportDigestInput,
  type ProcessContainmentLaunchRequest,
  type ProcessContainmentLaunchTermination,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname } from "node:path";

import {
  assertWindowsContainmentProviderArtifactIdentity,
  requireWindowsContainmentProviderRuntimeAuthority,
  type WindowsContainmentProviderRuntime,
  type WindowsContainmentProviderRuntimeAuthority,
} from "./artifact.js";
import { WindowsContainmentProviderError } from "./errors.js";
import {
  assertWindowsContainmentSelfTestWitness,
  claimWindowsContainmentSelfTestWitnessForLaunch,
  safeWindowsContainmentProviderEnvironment,
  type WindowsContainmentSelfTestWitness,
} from "./self-test.js";

const NATIVE_OUTPUT_MAX_BYTES = 256 * 1024;
const NATIVE_ERROR_MAX_BYTES = 16 * 1024;
const NATIVE_PROCESS_TIMEOUT_MS =
  PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS +
  PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS +
  3_000;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const nativeErrorCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface PrepareWindowsContainedSyntheticLaunchRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly selfTestWitness: WindowsContainmentSelfTestWitness;
  readonly projectRootIdentityDigest: unknown;
}

export interface PreparedWindowsContainedSyntheticLaunch {
  readonly schemaVersion: "1.0.0";
  readonly request: ProcessContainmentLaunchRequest;
  readonly requestDigest: Sha256Digest;
}

export interface RunWindowsContainedSyntheticLaunchRequest {
  readonly prepared: PreparedWindowsContainedSyntheticLaunch;
}

export interface ConsumeWindowsContainedSyntheticLaunchReportRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly report: ProcessContainmentLaunchReport;
  readonly projectRootIdentityDigest: unknown;
}

export interface WindowsContainedSyntheticLaunchWitness {
  readonly schemaVersion: "1.0.0";
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly expiresAt: string;
}

export interface WindowsContainedSyntheticLaunchWitnessAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly expiresAt: string;
}

interface PreparedAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly runtimeAuthority: WindowsContainmentProviderRuntimeAuthority;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  consumed: boolean;
}

interface ReportAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly expiresAt: string;
  consumed: boolean;
}

interface WitnessAuthority
  extends WindowsContainedSyntheticLaunchWitnessAuthority {
  admissionClaimed: boolean;
}

interface NativeProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly overflowed: boolean;
  readonly timedOut: boolean;
}

interface NativeLaunchReport {
  readonly schemaVersion: "1.0.0";
  readonly operation: "synthetic-launch";
  readonly launchId: string;
  readonly requestDigest: Sha256Digest;
  readonly entryArtifactDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly invocationDigest: Sha256Digest;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly process: ProcessContainmentLaunchProcessObservation;
  readonly output: ProcessContainmentLaunchOutputObservation;
  readonly termination: ProcessContainmentLaunchTermination;
  readonly effects: ProcessContainmentLaunchEffects;
  readonly outcome: "succeeded" | "failed" | "uncertain";
  readonly mutationUncertain: boolean;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();
const reportAuthorities = new WeakMap<object, ReportAuthority>();
const witnessAuthorities = new WeakMap<object, WitnessAuthority>();

function fail(
  code:
    | "provider-host-unsupported"
    | "invalid-launch-request"
    | "launch-consumed"
    | "launch-expired"
    | "launch-process-failed"
    | "launch-output-invalid"
    | "launch-witness-invalid"
    | "launch-witness-consumed",
  message: string,
  mutationUncertain = false,
): never {
  throw new WindowsContainmentProviderError(
    code,
    message,
    mutationUncertain,
  );
}

function exactRecord(
  value: unknown,
  names: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail("invalid-launch-request", message);
  }
  const actualNames = Object.getOwnPropertyNames(value);
  if (
    actualNames.length !== names.length ||
    !names.every((name) => actualNames.includes(name))
  ) {
    return fail("invalid-launch-request", message);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail("invalid-launch-request", message);
    }
  }
  return value as Record<string, unknown>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function fixtureText(
  projectRootIdentityDigest: Sha256Digest,
  challengeDigest: Sha256Digest,
): string {
  return `agpb-synthetic-project-v1\n${projectRootIdentityDigest}\n${challengeDigest}\n`;
}

function expectedOutputText(
  challengeDigest: Sha256Digest,
  runtimeAuthority: WindowsContainmentProviderRuntimeAuthority,
  projectRootIdentityDigest: Sha256Digest,
  projectSnapshotDigest: Sha256Digest,
  projectManifestDigest: Sha256Digest,
  executableSnapshotDigest: Sha256Digest,
): string {
  return canonicalizeJson({
    challengeDigest,
    entryArtifactDigest: runtimeAuthority.artifactDigest,
    executableSnapshotDigest,
    projectManifestDigest,
    projectRootIdentityDigest,
    projectSnapshotDigest,
    schemaVersion: "1.0.0",
    status: "succeeded",
  });
}

export async function prepareWindowsContainedSyntheticLaunch(
  request: PrepareWindowsContainedSyntheticLaunchRequest,
): Promise<PreparedWindowsContainedSyntheticLaunch> {
  const value = exactRecord(
    request,
    ["runtime", "selfTestWitness", "projectRootIdentityDigest"],
    "Contained launch preparation contains undeclared fields.",
  );
  const runtime = value["runtime"] as WindowsContainmentProviderRuntime;
  const runtimeAuthority =
    requireWindowsContainmentProviderRuntimeAuthority(runtime);
  const selfTestWitness =
    value["selfTestWitness"] as WindowsContainmentSelfTestWitness;
  const projectRootIdentityDigest = value["projectRootIdentityDigest"];
  if (!isSha256Digest(projectRootIdentityDigest)) {
    return fail(
      "invalid-launch-request",
      "Contained launch project identity must be one SHA-256 digest.",
    );
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    return fail(
      "provider-host-unsupported",
      "Windows x64 is required for this contained launch.",
    );
  }
  await assertWindowsContainmentProviderArtifactIdentity(runtimeAuthority);
  assertWindowsContainmentSelfTestWitness(selfTestWitness);

  const issuedMs = Date.now();
  const selfTestExpiresMs = Date.parse(selfTestWitness.expiresAt);
  const expiresMs = Math.min(
    issuedMs + PROCESS_CONTAINMENT_LAUNCH_MAX_VALIDITY_MS,
    selfTestExpiresMs,
  );
  if (
    expiresMs - issuedMs <
    PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS +
      PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS
  ) {
    return fail(
      "launch-expired",
      "Fresh self-test authority cannot cover the complete launch window.",
    );
  }
  const issuedAt = new Date(issuedMs).toISOString();
  const expiresAt = new Date(expiresMs).toISOString();
  const launchId = randomUUID();
  const challengeDigest = digestCanonicalJson({
    domain: "ai-game-playbook/windows-contained-synthetic-launch-challenge",
    version: "1.0.0",
    nonce: randomUUID(),
    launchId,
    projectRootIdentityDigest,
    providerDescriptorDigest: runtime.descriptor.descriptorDigest,
    selfTestReportDigest: selfTestWitness.reportDigest,
    issuedAt,
  });
  const projectContent = fixtureText(
    projectRootIdentityDigest,
    challengeDigest,
  );
  const projectManifestDigest = sha256Digest(projectContent);
  const projectSnapshotInput = Object.freeze({
    kind: "synthetic-read-only" as const,
    projectRootIdentityDigest,
    manifestDigest: projectManifestDigest,
    fileCount: 1 as const,
    totalBytes: Buffer.byteLength(projectContent, "utf8"),
    capturedAt: issuedAt,
  });
  const projectSnapshot: ProcessContainmentLaunchProjectSnapshot =
    Object.freeze({
      schemaVersion: "1.0.0",
      ...projectSnapshotInput,
      snapshotDigest:
        computeProcessContainmentLaunchProjectSnapshotDigest(
          projectSnapshotInput,
        ),
    });
  const executableSnapshotInput = Object.freeze({
    kind: "provider-artifact-copy" as const,
    providerDescriptorDigest: runtime.descriptor.descriptorDigest,
    artifactDigest: runtimeAuthority.artifactDigest,
    artifactBytes: runtimeAuthority.artifactBytes,
    capturedAt: issuedAt,
  });
  const executableSnapshot: ProcessContainmentLaunchExecutableSnapshot =
    Object.freeze({
      schemaVersion: "1.0.0",
      ...executableSnapshotInput,
      snapshotDigest:
        computeProcessContainmentLaunchExecutableSnapshotDigest(
          executableSnapshotInput,
        ),
    });
  const expectedOutput = expectedOutputText(
    challengeDigest,
    runtimeAuthority,
    projectRootIdentityDigest,
    projectSnapshot.snapshotDigest,
    projectManifestDigest,
    executableSnapshot.snapshotDigest,
  );
  const launchRequest: ProcessContainmentLaunchRequest = deepFreeze({
    schemaVersion: "1.0.0",
    launchId,
    providerDescriptorDigest: runtime.descriptor.descriptorDigest,
    providerCatalogDigest: runtime.catalogDigest,
    host: { platform: "windows", architecture: "x64" },
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    selfTest: {
      requestDigest: selfTestWitness.requestDigest,
      reportDigest: selfTestWitness.reportDigest,
      expiresAt: selfTestWitness.expiresAt,
    },
    projectSnapshot,
    executableSnapshot,
    invocationDigest:
      PROCESS_CONTAINMENT_SYNTHETIC_LAUNCH_INVOCATION_DIGEST,
    challengeDigest,
    expectedOutputDigest: sha256Digest(expectedOutput),
    issuedAt,
    expiresAt,
    limits: {
      timeoutMs: PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
      maxOutputBytes: PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
      terminationGraceMs:
        PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS,
      maxProcesses: 1,
    },
  });
  assertProcessContainmentLaunchRequestSemantics(launchRequest);
  const requestDigest =
    computeProcessContainmentLaunchRequestDigest(launchRequest);
  const selfTestAuthority = claimWindowsContainmentSelfTestWitnessForLaunch(
    selfTestWitness,
    runtime,
    projectRootIdentityDigest,
  );
  if (
    selfTestAuthority.requestDigest !== launchRequest.selfTest.requestDigest ||
    selfTestAuthority.reportDigest !== launchRequest.selfTest.reportDigest ||
    selfTestAuthority.expiresAt !== launchRequest.selfTest.expiresAt
  ) {
    return fail(
      "invalid-launch-request",
      "Contained launch self-test authority changed during preparation.",
    );
  }
  const prepared: PreparedWindowsContainedSyntheticLaunch = Object.freeze({
    schemaVersion: "1.0.0",
    request: launchRequest,
    requestDigest,
  });
  preparedAuthorities.set(prepared, {
    runtime,
    runtimeAuthority,
    projectRootIdentityDigest,
    requestDigest,
    consumed: false,
  });
  return prepared;
}

async function runNativeLaunch(
  authority: WindowsContainmentProviderRuntimeAuthority,
  input: string,
): Promise<NativeProcessResult> {
  return await new Promise<NativeProcessResult>((resolve, reject) => {
    const child = spawn(authority.artifactPath, ["synthetic-launch"], {
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
      if (terminationTimer !== undefined) {
        clearTimeout(terminationTimer);
      }
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
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (terminationTimer !== undefined) {
          clearTimeout(terminationTimer);
        }
        reject(
          new WindowsContainmentProviderError(
            "launch-output-invalid",
            "Native contained launch output is not valid UTF-8.",
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
      }, PROCESS_CONTAINMENT_LAUNCH_TERMINATION_GRACE_MS);
      terminationTimer.unref();
    };
    timer = setTimeout(() => {
      timedOut = true;
      requestTermination();
    }, NATIVE_PROCESS_TIMEOUT_MS);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= NATIVE_OUTPUT_MAX_BYTES) {
        stdout.push(Buffer.from(chunk));
      } else {
        overflowed = true;
        requestTermination();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= NATIVE_ERROR_MAX_BYTES) {
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
      if (terminationTimer !== undefined) {
        clearTimeout(terminationTimer);
      }
      reject(
        new WindowsContainmentProviderError(
          "launch-process-failed",
          `Windows contained launch process failed before completion: ${error instanceof Error ? error.name : "Error"}.`,
          child.pid !== undefined,
        ),
      );
    });
    child.once("close", (exitCode, signal) => {
      finishBuffered(exitCode, signal);
    });
    child.stdin.on("error", () => {
      // Close/error observation decides the bounded process outcome.
    });
    child.stdin.end(input, "utf8");
  });
}

function nativeRecord(
  value: unknown,
  names: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail("launch-output-invalid", message, true);
  }
  const actual = Object.getOwnPropertyNames(value);
  if (
    actual.length !== names.length ||
    !names.every((name) => actual.includes(name))
  ) {
    return fail("launch-output-invalid", message, true);
  }
  return value as Record<string, unknown>;
}

function nativeInteger(
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

function nativeTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function nativeErrorCode(value: string): string | undefined {
  const lines = value.trim().split(/\r?\n/u);
  if (lines.length !== 1 || lines[0] === undefined || lines[0].length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(lines[0]) as unknown;
    const record =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.getPrototypeOf(parsed) === Object.prototype
        ? (parsed as Record<string, unknown>)
        : undefined;
    if (
      record === undefined ||
      Object.keys(record).sort().join("\0") !==
        "code\0schemaVersion\0status" ||
      record["schemaVersion"] !== "1.0.0" ||
      record["status"] !== "error" ||
      typeof record["code"] !== "string" ||
      !nativeErrorCodePattern.test(record["code"])
    ) {
      return undefined;
    }
    return record["code"];
  } catch {
    return undefined;
  }
}

function parseNativeProcess(value: unknown): ProcessContainmentLaunchProcessObservation {
  const record = nativeRecord(
    value,
    ["started", "exitCode", "totalProcesses", "activeProcesses"],
    "Native contained launch process observation is invalid.",
  );
  const started = record["started"];
  const exitCode = record["exitCode"];
  const totalProcesses = record["totalProcesses"];
  const activeProcesses = record["activeProcesses"];
  const validExitCode =
    exitCode === null ||
    nativeInteger(exitCode, -2_147_483_648, 4_294_967_295);
  const validCount = (candidate: unknown): boolean =>
    candidate === null || nativeInteger(candidate, 0, 1_024);
  if (
    typeof started !== "boolean" ||
    !validExitCode ||
    !validCount(totalProcesses) ||
    !validCount(activeProcesses) ||
    (typeof totalProcesses === "number" &&
      typeof activeProcesses === "number" &&
      activeProcesses > totalProcesses) ||
    (!started &&
      (exitCode !== null || totalProcesses !== null || activeProcesses !== null))
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch process observation is invalid.",
      true,
    );
  }
  return record as unknown as ProcessContainmentLaunchProcessObservation;
}

function parseNativeOutput(value: unknown): ProcessContainmentLaunchOutputObservation {
  const record = nativeRecord(
    value,
    [
      "expectedDigest",
      "observedDigest",
      "capturedBytes",
      "observedBytes",
      "truncated",
    ],
    "Native contained launch output observation is invalid.",
  );
  if (
    !isSha256Digest(record["expectedDigest"]) ||
    !isSha256Digest(record["observedDigest"]) ||
    !nativeInteger(
      record["capturedBytes"],
      0,
      PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES,
    ) ||
    !nativeInteger(
      record["observedBytes"],
      0,
      PROCESS_CONTAINMENT_LAUNCH_MAX_OUTPUT_BYTES + 1,
    ) ||
    typeof record["truncated"] !== "boolean"
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch output observation is invalid.",
      true,
    );
  }
  return record as unknown as ProcessContainmentLaunchOutputObservation;
}

function parseNativeTermination(value: unknown): ProcessContainmentLaunchTermination {
  const record = nativeRecord(
    value,
    ["requested", "confirmed"],
    "Native contained launch termination observation is invalid.",
  );
  if (
    typeof record["requested"] !== "boolean" ||
    typeof record["confirmed"] !== "boolean"
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch termination observation is invalid.",
      true,
    );
  }
  return record as unknown as ProcessContainmentLaunchTermination;
}

function parseNativeEffects(value: unknown): ProcessContainmentLaunchEffects {
  const record = nativeRecord(
    value,
    [
      "projectSnapshotPreserved",
      "executableSnapshotPreserved",
      "projectMutationPerformed",
      "networkConnectionEstablished",
      "childProcessStarted",
      "cleanup",
    ],
    "Native contained launch effects are invalid.",
  );
  if (
    typeof record["projectSnapshotPreserved"] !== "boolean" ||
    typeof record["executableSnapshotPreserved"] !== "boolean" ||
    typeof record["projectMutationPerformed"] !== "boolean" ||
    typeof record["networkConnectionEstablished"] !== "boolean" ||
    typeof record["childProcessStarted"] !== "boolean" ||
    (record["cleanup"] !== "complete" &&
      record["cleanup"] !== "incomplete" &&
      record["cleanup"] !== "uncertain")
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch effects are invalid.",
      true,
    );
  }
  return record as unknown as ProcessContainmentLaunchEffects;
}

function parseNativeReport(
  text: string,
  prepared: PreparedWindowsContainedSyntheticLaunch,
  authority: WindowsContainmentProviderRuntimeAuthority,
): NativeLaunchReport {
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length !== 1 || lines[0] === undefined || lines[0].length === 0) {
    return fail(
      "launch-output-invalid",
      "Native contained launch must emit exactly one JSON report.",
      true,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]);
  } catch {
    return fail(
      "launch-output-invalid",
      "Native contained launch report is not valid JSON.",
      true,
    );
  }
  const report = nativeRecord(
    parsed,
    [
      "schemaVersion",
      "operation",
      "launchId",
      "requestDigest",
      "entryArtifactDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "invocationDigest",
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
    "Native contained launch report is outside the protocol.",
  );
  if (
    report["schemaVersion"] !== "1.0.0" ||
    report["operation"] !== "synthetic-launch" ||
    report["launchId"] !== prepared.request.launchId ||
    report["requestDigest"] !== prepared.requestDigest ||
    report["entryArtifactDigest"] !== authority.artifactDigest ||
    report["projectSnapshotDigest"] !==
      prepared.request.projectSnapshot.snapshotDigest ||
    report["executableSnapshotDigest"] !==
      prepared.request.executableSnapshot.snapshotDigest ||
    report["invocationDigest"] !== prepared.request.invocationDigest ||
    !nativeTimestamp(report["startedAt"]) ||
    !nativeTimestamp(report["completedAt"]) ||
    !nativeInteger(
      report["durationMs"],
      1,
      PROCESS_CONTAINMENT_LAUNCH_MAX_DURATION_MS,
    ) ||
    (report["outcome"] !== "succeeded" &&
      report["outcome"] !== "failed" &&
      report["outcome"] !== "uncertain") ||
    typeof report["mutationUncertain"] !== "boolean"
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch binding or timing is invalid.",
      true,
    );
  }
  const startedAt = report["startedAt"];
  const completedAt = report["completedAt"];
  const durationMs = report["durationMs"];
  if (
    Date.parse(completedAt) - Date.parse(startedAt) !== durationMs ||
    Date.parse(startedAt) < Date.parse(prepared.request.issuedAt) ||
    Date.parse(completedAt) > Date.parse(prepared.request.expiresAt)
  ) {
    return fail(
      "launch-output-invalid",
      "Native contained launch timing escaped its request window.",
      true,
    );
  }
  return {
    schemaVersion: "1.0.0",
    operation: "synthetic-launch",
    launchId: prepared.request.launchId,
    requestDigest: prepared.requestDigest,
    entryArtifactDigest: authority.artifactDigest,
    projectSnapshotDigest:
      prepared.request.projectSnapshot.snapshotDigest,
    executableSnapshotDigest:
      prepared.request.executableSnapshot.snapshotDigest,
    invocationDigest: prepared.request.invocationDigest,
    startedAt,
    completedAt,
    durationMs,
    process: parseNativeProcess(report["process"]),
    output: parseNativeOutput(report["output"]),
    termination: parseNativeTermination(report["termination"]),
    effects: parseNativeEffects(report["effects"]),
    outcome: report["outcome"],
    mutationUncertain: report["mutationUncertain"],
  } as NativeLaunchReport;
}

export async function runWindowsContainedSyntheticLaunch(
  request: RunWindowsContainedSyntheticLaunchRequest,
): Promise<ProcessContainmentLaunchReport> {
  const value = exactRecord(
    request,
    ["prepared"],
    "Contained launch execution contains undeclared fields.",
  );
  const prepared =
    value["prepared"] as PreparedWindowsContainedSyntheticLaunch;
  const authority =
    prepared !== null && typeof prepared === "object"
      ? preparedAuthorities.get(prepared)
      : undefined;
  if (authority === undefined) {
    return fail(
      "invalid-launch-request",
      "Contained launch was not prepared by this process.",
    );
  }
  if (authority.consumed) {
    return fail("launch-consumed", "Contained launch preparation is one-use.");
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    return fail(
      "provider-host-unsupported",
      "Windows x64 is required for this contained launch.",
    );
  }
  if (Date.now() >= Date.parse(prepared.request.expiresAt)) {
    return fail("launch-expired", "Contained launch expired before dispatch.");
  }
  authority.consumed = true;
  await assertWindowsContainmentProviderArtifactIdentity(
    authority.runtimeAuthority,
  );
  const nativeInput = `${canonicalizeJson({
    schemaVersion: "1.0.0",
    operation: "synthetic-launch",
    launchId: prepared.request.launchId,
    requestDigest: prepared.requestDigest,
    entryArtifactDigest: authority.runtimeAuthority.artifactDigest,
    challengeDigest: prepared.request.challengeDigest,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    projectSnapshotDigest:
      prepared.request.projectSnapshot.snapshotDigest,
    projectManifestDigest: prepared.request.projectSnapshot.manifestDigest,
    projectFileCount: prepared.request.projectSnapshot.fileCount,
    projectTotalBytes: prepared.request.projectSnapshot.totalBytes,
    executableSnapshotDigest:
      prepared.request.executableSnapshot.snapshotDigest,
    executableArtifactBytes:
      prepared.request.executableSnapshot.artifactBytes,
    selfTestReportDigest: prepared.request.selfTest.reportDigest,
    invocationDigest: prepared.request.invocationDigest,
    expectedOutputDigest: prepared.request.expectedOutputDigest,
    issuedAt: prepared.request.issuedAt,
    expiresAt: prepared.request.expiresAt,
    maxDurationMs: prepared.request.limits.timeoutMs,
    maxOutputBytes: prepared.request.limits.maxOutputBytes,
    terminationGraceMs: prepared.request.limits.terminationGraceMs,
    maxProcesses: prepared.request.limits.maxProcesses,
  })}\n`;
  const processResult = await runNativeLaunch(
    authority.runtimeAuthority,
    nativeInput,
  );
  if (processResult.timedOut || processResult.overflowed) {
    return fail(
      "launch-process-failed",
      "Native contained launch exceeded its outer process boundary.",
      true,
    );
  }
  if (processResult.stderr.length !== 0) {
    const code = nativeErrorCode(processResult.stderr);
    return fail(
      "launch-output-invalid",
      code === undefined
        ? "Native contained launch emitted unexpected error output."
        : `Native contained launch rejected the request (${code}).`,
      true,
    );
  }
  if (processResult.signal !== null) {
    return fail(
      "launch-process-failed",
      "Native contained launch was terminated outside the protocol.",
      true,
    );
  }
  if (![0, 2, 3].includes(processResult.exitCode ?? -1)) {
    return fail(
      "launch-process-failed",
      "Native contained launch exited outside the protocol.",
      true,
    );
  }
  const native = parseNativeReport(
    processResult.stdout,
    prepared,
    authority.runtimeAuthority,
  );
  const expectedExit = native.outcome === "succeeded"
    ? 0
    : native.outcome === "failed"
      ? 2
      : 3;
  if (processResult.exitCode !== expectedExit) {
    return fail(
      "launch-output-invalid",
      "Native contained launch outcome contradicts its process exit.",
      true,
    );
  }
  try {
    await assertWindowsContainmentProviderArtifactIdentity(
      authority.runtimeAuthority,
    );
  } catch {
    return fail(
      "launch-process-failed",
      "Provider artifact identity changed during contained launch.",
      true,
    );
  }
  let report: ProcessContainmentLaunchReport;
  try {
    const reportInput: ProcessContainmentLaunchReportDigestInput = deepFreeze({
      launchId: prepared.request.launchId,
      request: prepared.request,
      requestDigest: prepared.requestDigest,
      providerDescriptorDigest:
        authority.runtime.descriptor.descriptorDigest,
      providerCatalogDigest: authority.runtime.catalogDigest,
      projectSnapshotDigest:
        prepared.request.projectSnapshot.snapshotDigest,
      executableSnapshotDigest:
        prepared.request.executableSnapshot.snapshotDigest,
      invocationDigest: prepared.request.invocationDigest,
      startedAt: native.startedAt,
      completedAt: native.completedAt,
      durationMs: native.durationMs,
      process: native.process,
      output: native.output,
      termination: native.termination,
      effects: native.effects,
      outcome: native.outcome,
      mutationUncertain: native.mutationUncertain,
    });
    report = deepFreeze({
      schemaVersion: "1.0.0",
      ...reportInput,
      reportDigest:
        computeProcessContainmentLaunchReportDigest(reportInput),
    });
    assertProcessContainmentLaunchReportSemantics(report);
  } catch {
    return fail(
      "launch-output-invalid",
      "Native contained launch report failed semantic validation.",
      true,
    );
  }
  reportAuthorities.set(report, {
    runtime: authority.runtime,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    projectSnapshotDigest:
      prepared.request.projectSnapshot.snapshotDigest,
    executableSnapshotDigest:
      prepared.request.executableSnapshot.snapshotDigest,
    requestDigest: authority.requestDigest,
    expiresAt: prepared.request.expiresAt,
    consumed: false,
  });
  return report;
}

export function consumeWindowsContainedSyntheticLaunchReport(
  request: ConsumeWindowsContainedSyntheticLaunchReportRequest,
): WindowsContainedSyntheticLaunchWitness {
  const value = exactRecord(
    request,
    ["runtime", "report", "projectRootIdentityDigest"],
    "Contained launch witness request contains undeclared fields.",
  );
  const runtime = value["runtime"] as WindowsContainmentProviderRuntime;
  requireWindowsContainmentProviderRuntimeAuthority(runtime);
  const report = value["report"] as ProcessContainmentLaunchReport;
  const authority =
    report !== null && typeof report === "object"
      ? reportAuthorities.get(report)
      : undefined;
  if (
    authority === undefined ||
    authority.runtime !== runtime ||
    value["projectRootIdentityDigest"] !==
      authority.projectRootIdentityDigest ||
    report.requestDigest !== authority.requestDigest ||
    report.outcome !== "succeeded" ||
    report.mutationUncertain
  ) {
    return fail(
      "launch-witness-invalid",
      "Contained launch report has no matching successful same-process authority.",
    );
  }
  if (authority.consumed) {
    return fail(
      "launch-witness-consumed",
      "Contained launch report authority is one-use.",
    );
  }
  if (Date.now() >= Date.parse(authority.expiresAt)) {
    return fail(
      "launch-expired",
      "Contained launch report expired before authority consumption.",
    );
  }
  assertProcessContainmentLaunchReportSemantics(report);
  authority.consumed = true;
  const witness: WindowsContainedSyntheticLaunchWitness = Object.freeze({
    schemaVersion: "1.0.0",
    providerDescriptorDigest: report.providerDescriptorDigest,
    providerCatalogDigest: report.providerCatalogDigest,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    projectSnapshotDigest: authority.projectSnapshotDigest,
    executableSnapshotDigest: authority.executableSnapshotDigest,
    requestDigest: authority.requestDigest,
    reportDigest: report.reportDigest,
    expiresAt: authority.expiresAt,
  });
  witnessAuthorities.set(witness, {
    runtime,
    providerDescriptorDigest: witness.providerDescriptorDigest,
    providerCatalogDigest: witness.providerCatalogDigest,
    projectRootIdentityDigest: witness.projectRootIdentityDigest,
    projectSnapshotDigest: witness.projectSnapshotDigest,
    executableSnapshotDigest: witness.executableSnapshotDigest,
    requestDigest: witness.requestDigest,
    reportDigest: witness.reportDigest,
    expiresAt: witness.expiresAt,
    admissionClaimed: false,
  });
  return witness;
}

function requireWindowsContainedSyntheticLaunchWitnessAuthority(
  witness: WindowsContainedSyntheticLaunchWitness,
): WitnessAuthority {
  const authority =
    witness !== null && typeof witness === "object"
      ? witnessAuthorities.get(witness)
      : undefined;
  if (
    authority === undefined ||
    witness.schemaVersion !== "1.0.0" ||
    witness.providerDescriptorDigest !== authority.providerDescriptorDigest ||
    witness.providerCatalogDigest !== authority.providerCatalogDigest ||
    witness.projectRootIdentityDigest !== authority.projectRootIdentityDigest ||
    witness.projectSnapshotDigest !== authority.projectSnapshotDigest ||
    witness.executableSnapshotDigest !== authority.executableSnapshotDigest ||
    witness.requestDigest !== authority.requestDigest ||
    witness.reportDigest !== authority.reportDigest ||
    witness.expiresAt !== authority.expiresAt
  ) {
    return fail(
      "launch-witness-invalid",
      "Contained launch witness was not created by this process.",
    );
  }
  if (authority.admissionClaimed) {
    return fail(
      "launch-witness-consumed",
      "Contained launch witness was already claimed by an engine admission.",
    );
  }
  if (Date.now() >= Date.parse(authority.expiresAt)) {
    return fail("launch-expired", "Contained launch witness has expired.");
  }
  return authority;
}

export function assertWindowsContainedSyntheticLaunchWitness(
  witness: WindowsContainedSyntheticLaunchWitness,
): void {
  requireWindowsContainedSyntheticLaunchWitnessAuthority(witness);
}

export function claimWindowsContainedSyntheticLaunchWitnessForEngineAdmission(
  witness: WindowsContainedSyntheticLaunchWitness,
  runtime: WindowsContainmentProviderRuntime,
  projectRootIdentityDigest: Sha256Digest,
): WindowsContainedSyntheticLaunchWitnessAuthority {
  requireWindowsContainmentProviderRuntimeAuthority(runtime);
  const authority =
    requireWindowsContainedSyntheticLaunchWitnessAuthority(witness);
  if (
    authority.runtime !== runtime ||
    authority.providerDescriptorDigest !== runtime.descriptor.descriptorDigest ||
    authority.providerCatalogDigest !== runtime.catalogDigest ||
    authority.projectRootIdentityDigest !== projectRootIdentityDigest
  ) {
    return fail(
      "launch-witness-invalid",
      "Contained launch witness does not match the engine admission authority.",
    );
  }
  authority.admissionClaimed = true;
  return Object.freeze({
    runtime: authority.runtime,
    providerDescriptorDigest: authority.providerDescriptorDigest,
    providerCatalogDigest: authority.providerCatalogDigest,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    projectSnapshotDigest: authority.projectSnapshotDigest,
    executableSnapshotDigest: authority.executableSnapshotDigest,
    requestDigest: authority.requestDigest,
    reportDigest: authority.reportDigest,
    expiresAt: authority.expiresAt,
  });
}
