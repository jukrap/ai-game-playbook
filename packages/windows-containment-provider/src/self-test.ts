import {
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS,
  PROCESS_CONTAINMENT_SELF_TEST_MAX_VALIDITY_MS,
  PROCESS_CONTAINMENT_SELF_TEST_PROBES,
  PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  assertProcessContainmentSelfTestReportSemantics,
  assertProcessContainmentSelfTestRequestSemantics,
  canonicalizeJson,
  computeProcessContainmentSelfTestReportDigest,
  computeProcessContainmentSelfTestRequestDigest,
  digestCanonicalJson,
  isSha256Digest,
  type ProcessContainmentSelfTestEffects,
  type ProcessContainmentSelfTestProbeOutcome,
  type ProcessContainmentSelfTestProbeResult,
  type ProcessContainmentSelfTestReport,
  type ProcessContainmentSelfTestReportDigestInput,
  type ProcessContainmentSelfTestRequest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, normalize, parse } from "node:path";

import {
  assertWindowsContainmentProviderArtifactIdentity,
  requireWindowsContainmentProviderRuntimeAuthority,
  type WindowsContainmentProviderRuntime,
  type WindowsContainmentProviderRuntimeAuthority,
} from "./artifact.js";
import { WindowsContainmentProviderError } from "./errors.js";

const NATIVE_OUTPUT_MAX_BYTES = 256 * 1024;
const NATIVE_ERROR_MAX_BYTES = 16 * 1024;
const NATIVE_PROCESS_TIMEOUT_MS =
  PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS + 5_000;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const codePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export interface PrepareWindowsContainmentSelfTestRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly projectRootIdentityDigest: unknown;
}

export interface PreparedWindowsContainmentSelfTest {
  readonly schemaVersion: "1.0.0";
  readonly request: ProcessContainmentSelfTestRequest;
  readonly requestDigest: Sha256Digest;
}

export interface RunWindowsContainmentSelfTestRequest {
  readonly prepared: PreparedWindowsContainmentSelfTest;
}

export interface ConsumeWindowsContainmentSelfTestReportRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly report: ProcessContainmentSelfTestReport;
  readonly projectRootIdentityDigest: unknown;
}

export interface WindowsContainmentSelfTestWitness {
  readonly schemaVersion: "1.0.0";
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
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
  readonly requestDigest: Sha256Digest;
  readonly expiresAt: string;
  consumed: boolean;
}

interface WitnessAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly expiresAt: string;
  launchClaimed: boolean;
}

export interface WindowsContainmentSelfTestLaunchAuthority {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly expiresAt: string;
}

interface NativeProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly overflowed: boolean;
  readonly timedOut: boolean;
}

interface NativeObservation {
  readonly attempted: boolean;
  readonly operationDenied: boolean | null;
  readonly sentinelControlPassed: boolean | null;
  readonly sentinelReached: boolean | null;
  readonly nativeCode: number | null;
  readonly exitCode: number | null;
  readonly totalProcesses: number | null;
  readonly activeProcesses: number | null;
  readonly profileRemoved: boolean | null;
  readonly fixtureRemoved: boolean | null;
}

interface NativeProbe {
  readonly id: string;
  readonly expected: string;
  readonly outcome: ProcessContainmentSelfTestProbeOutcome;
  readonly code: string;
  readonly observation: NativeObservation;
}

interface NativeReport {
  readonly schemaVersion: "1.0.0";
  readonly operation: "self-test";
  readonly selfTestId: string;
  readonly requestDigest: Sha256Digest;
  readonly entryArtifactDigest: Sha256Digest;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly probes: readonly NativeProbe[];
  readonly effects: ProcessContainmentSelfTestEffects;
  readonly outcome: "verified" | "rejected";
}

interface RawObservation {
  readonly attempted: unknown;
  readonly operationDenied: unknown;
  readonly sentinelControlPassed: unknown;
  readonly sentinelReached: unknown;
  readonly nativeCode: unknown;
  readonly exitCode: unknown;
  readonly totalProcesses: unknown;
  readonly activeProcesses: unknown;
  readonly profileRemoved: unknown;
  readonly fixtureRemoved: unknown;
}

interface RawProbe {
  readonly id: unknown;
  readonly expected: unknown;
  readonly outcome: unknown;
  readonly code: unknown;
  readonly observation: unknown;
}

interface RawEffects {
  readonly containedProcessStarted: unknown;
  readonly projectMutationPerformed: unknown;
  readonly networkConnectionEstablished: unknown;
  readonly childProcessStarted: unknown;
  readonly cleanup: unknown;
}

interface RawNativeReport {
  readonly schemaVersion: unknown;
  readonly operation: unknown;
  readonly selfTestId: unknown;
  readonly requestDigest: unknown;
  readonly entryArtifactDigest: unknown;
  readonly startedAt: unknown;
  readonly completedAt: unknown;
  readonly durationMs: unknown;
  readonly probes: unknown;
  readonly effects: unknown;
  readonly outcome: unknown;
}

interface RawPrepareRequest {
  readonly runtime: unknown;
  readonly projectRootIdentityDigest: unknown;
}

interface RawRunRequest {
  readonly prepared: unknown;
}

interface RawConsumeRequest {
  readonly runtime: unknown;
  readonly report: unknown;
  readonly projectRootIdentityDigest: unknown;
}

const preparedAuthorities = new WeakMap<object, PreparedAuthority>();
const reportAuthorities = new WeakMap<object, ReportAuthority>();
const witnessAuthorities = new WeakMap<object, WitnessAuthority>();

function fail(
  code:
    | "provider-host-unsupported"
    | "provider-host-environment-invalid"
    | "invalid-self-test-request"
    | "self-test-consumed"
    | "self-test-expired"
    | "self-test-process-failed"
    | "self-test-output-invalid"
    | "self-test-witness-invalid"
    | "self-test-witness-consumed",
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
    return fail("invalid-self-test-request", message);
  }
  const actualNames = Object.getOwnPropertyNames(value);
  if (
    actualNames.length !== names.length ||
    !names.every((name) => actualNames.includes(name))
  ) {
    return fail("invalid-self-test-request", message);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail("invalid-self-test-request", message);
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

function canonicalTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function safeWindowsContainmentProviderEnvironment(): NodeJS.ProcessEnv {
  const localPath = (name: string): string => {
    const actual = Object.keys(process.env).find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
    const value = actual === undefined ? undefined : process.env[actual];
    if (
      value === undefined ||
      value.length === 0 ||
      value.includes("\0") ||
      !isAbsolute(value) ||
      value.startsWith("\\\\")
    ) {
      return fail(
        "provider-host-environment-invalid",
        "Windows containment provider requires bounded local host paths.",
      );
    }
    return normalize(value);
  };
  const systemRoot = localPath("SystemRoot");
  const windir = localPath("WINDIR");
  const temporary = localPath("TEMP");
  const temporaryAlias = localPath("TMP");
  const userProfile = localPath("USERPROFILE");
  const localAppData = localPath("LOCALAPPDATA");
  const driveRoot = parse(systemRoot).root;
  if (
    systemRoot.toLowerCase() !== windir.toLowerCase() ||
    temporary.toLowerCase() !== temporaryAlias.toLowerCase() ||
    !/^[A-Za-z]:\\$/u.test(driveRoot)
  ) {
    return fail(
      "provider-host-environment-invalid",
      "Windows containment provider host path identities are inconsistent.",
    );
  }
  const output: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  output["LOCALAPPDATA"] = localAppData;
  output["NUMBER_OF_PROCESSORS"] = String(
    process.env["NUMBER_OF_PROCESSORS"] ?? 1,
  );
  output["OS"] = "Windows_NT";
  output["PROCESSOR_ARCHITECTURE"] = "AMD64";
  output["SystemDrive"] = driveRoot.slice(0, 2);
  output["SystemRoot"] = systemRoot;
  output["TEMP"] = temporary;
  output["TMP"] = temporary;
  output["USERPROFILE"] = userProfile;
  output["WINDIR"] = systemRoot;
  return output;
}

async function runNativeSelfTest(
  authority: WindowsContainmentProviderRuntimeAuthority,
  input: string,
): Promise<NativeProcessResult> {
  return await new Promise<NativeProcessResult>((resolve, reject) => {
    const child = spawn(authority.artifactPath, ["self-test"], {
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

    const finish = (result: NativeProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, NATIVE_PROCESS_TIMEOUT_MS);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= NATIVE_OUTPUT_MAX_BYTES) {
        stdout.push(Buffer.from(chunk));
      } else {
        overflowed = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= NATIVE_ERROR_MAX_BYTES) {
        stderr.push(Buffer.from(chunk));
      } else {
        overflowed = true;
        child.kill();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new WindowsContainmentProviderError(
          "self-test-process-failed",
          `Windows containment self-test process failed before completion: ${error instanceof Error ? error.name : "Error"}.`,
          false,
        ),
      );
    });
    child.once("close", (exitCode, signal) => {
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
        reject(
          new WindowsContainmentProviderError(
            "self-test-output-invalid",
            "Native self-test output is not valid UTF-8.",
          ),
        );
      }
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
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test output is outside the protocol.",
    );
  }
  const actual = Object.getOwnPropertyNames(value);
  if (
    actual.length !== names.length ||
    !names.every((name) => actual.includes(name))
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test output is outside the protocol.",
    );
  }
  return value as Record<string, unknown>;
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function nullableInteger(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isSafeInteger(value))
  );
}

function parseObservation(value: unknown): NativeObservation {
  const observation = nativeRecord(value, [
    "attempted",
    "operationDenied",
    "sentinelControlPassed",
    "sentinelReached",
    "nativeCode",
    "exitCode",
    "totalProcesses",
    "activeProcesses",
    "profileRemoved",
    "fixtureRemoved",
  ]) as unknown as RawObservation;
  if (
    typeof observation.attempted !== "boolean" ||
    !nullableBoolean(observation.operationDenied) ||
    !nullableBoolean(observation.sentinelControlPassed) ||
    !nullableBoolean(observation.sentinelReached) ||
    !nullableInteger(observation.nativeCode) ||
    !nullableInteger(observation.exitCode) ||
    !nullableInteger(observation.totalProcesses) ||
    !nullableInteger(observation.activeProcesses) ||
    !nullableBoolean(observation.profileRemoved) ||
    !nullableBoolean(observation.fixtureRemoved)
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test observation is outside the protocol.",
    );
  }
  return observation as unknown as NativeObservation;
}

function parseNativeReport(
  text: string,
  prepared: PreparedWindowsContainmentSelfTest,
  authority: WindowsContainmentProviderRuntimeAuthority,
): NativeReport {
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length !== 1 || lines[0] === undefined || lines[0].length === 0) {
    return fail(
      "self-test-output-invalid",
      "Native self-test must emit exactly one JSON report.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0]);
  } catch {
    return fail(
      "self-test-output-invalid",
      "Native self-test report is not valid JSON.",
    );
  }
  const report = nativeRecord(parsed, [
    "schemaVersion",
    "operation",
    "selfTestId",
    "requestDigest",
    "entryArtifactDigest",
    "startedAt",
    "completedAt",
    "durationMs",
    "probes",
    "effects",
    "outcome",
  ]) as unknown as RawNativeReport;
  if (
    report.schemaVersion !== "1.0.0" ||
    report.operation !== "self-test" ||
    report.selfTestId !== prepared.request.selfTestId ||
    report.requestDigest !== prepared.requestDigest ||
    report.entryArtifactDigest !== authority.artifactDigest ||
    typeof report.startedAt !== "string" ||
    typeof report.completedAt !== "string" ||
    !timestampPattern.test(report.startedAt) ||
    !timestampPattern.test(report.completedAt) ||
    new Date(report.startedAt).toISOString() !== report.startedAt ||
    new Date(report.completedAt).toISOString() !== report.completedAt ||
    typeof report.durationMs !== "number" ||
    !Number.isSafeInteger(report.durationMs) ||
    report.durationMs < 1 ||
    report.durationMs > prepared.request.maxDurationMs ||
    Date.parse(report.completedAt) - Date.parse(report.startedAt) !==
      report.durationMs ||
    Date.parse(report.startedAt) < Date.parse(prepared.request.issuedAt) ||
    Date.parse(report.completedAt) > Date.parse(prepared.request.expiresAt) ||
    (report.outcome !== "verified" && report.outcome !== "rejected") ||
    !Array.isArray(report.probes) ||
    report.probes.length !== PROCESS_CONTAINMENT_SELF_TEST_PROBES.length
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test report binding or timing is invalid.",
    );
  }
  const probes: NativeProbe[] = report.probes.map((candidate, index) => {
    const expected = PROCESS_CONTAINMENT_SELF_TEST_PROBES[index];
    const probe = nativeRecord(candidate, [
      "id",
      "expected",
      "outcome",
      "code",
      "observation",
    ]) as unknown as RawProbe;
    if (
      expected === undefined ||
      probe.id !== expected.id ||
      probe.expected !== expected.expected ||
      (probe.outcome !== "passed" &&
        probe.outcome !== "failed" &&
        probe.outcome !== "unavailable" &&
        probe.outcome !== "cancelled" &&
        probe.outcome !== "uncertain") ||
      typeof probe.code !== "string" ||
      probe.code.length > 96 ||
      !codePattern.test(probe.code)
    ) {
      return fail(
        "self-test-output-invalid",
        "Native self-test probe order or value is invalid.",
      );
    }
    return {
      id: probe.id,
      expected: probe.expected,
      outcome: probe.outcome,
      code: probe.code,
      observation: parseObservation(probe.observation),
    } as NativeProbe;
  });
  const effects = nativeRecord(report.effects, [
    "containedProcessStarted",
    "projectMutationPerformed",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ]) as unknown as RawEffects;
  if (
    typeof effects.containedProcessStarted !== "boolean" ||
    typeof effects.projectMutationPerformed !== "boolean" ||
    typeof effects.networkConnectionEstablished !== "boolean" ||
    typeof effects.childProcessStarted !== "boolean" ||
    (effects.cleanup !== "complete" &&
      effects.cleanup !== "incomplete" &&
      effects.cleanup !== "uncertain")
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test effects are invalid.",
    );
  }
  return {
    schemaVersion: "1.0.0",
    operation: "self-test",
    selfTestId: report.selfTestId,
    requestDigest: report.requestDigest,
    entryArtifactDigest: report.entryArtifactDigest,
    startedAt: report.startedAt,
    completedAt: report.completedAt,
    durationMs: report.durationMs,
    probes,
    effects: effects as unknown as ProcessContainmentSelfTestEffects,
    outcome: report.outcome,
  } as NativeReport;
}

export function prepareWindowsContainmentSelfTest(
  request: PrepareWindowsContainmentSelfTestRequest,
): PreparedWindowsContainmentSelfTest {
  const value = exactRecord(
    request,
    ["runtime", "projectRootIdentityDigest"],
    "Self-test preparation request contains undeclared fields.",
  ) as unknown as RawPrepareRequest;
  const runtime = value.runtime as WindowsContainmentProviderRuntime;
  const runtimeAuthority =
    requireWindowsContainmentProviderRuntimeAuthority(runtime);
  const projectRootIdentityDigest = value.projectRootIdentityDigest;
  if (!isSha256Digest(projectRootIdentityDigest)) {
    return fail(
      "invalid-self-test-request",
      "Self-test project identity must be one SHA-256 digest.",
    );
  }
  const issuedMs = Math.floor(Date.now());
  const issuedAt = canonicalTimestamp(issuedMs);
  const expiresAt = canonicalTimestamp(
    issuedMs + PROCESS_CONTAINMENT_SELF_TEST_MAX_VALIDITY_MS,
  );
  const selfTestId = randomUUID();
  const challengeDigest = digestCanonicalJson({
    domain: "ai-game-playbook/windows-containment-self-test-challenge",
    version: "1.0.0",
    nonce: randomUUID(),
    selfTestId,
    projectRootIdentityDigest,
    providerDescriptorDigest: runtime.descriptor.descriptorDigest,
    issuedAt,
  });
  const fixtureIdentityDigest = digestCanonicalJson({
    domain: "ai-game-playbook/windows-containment-self-test-fixture",
    version: "1.0.0",
    fixture: "read-only-project-with-hard-link-alias",
    projectRootIdentityDigest,
    challengeDigest,
  });
  const selfTestRequest: ProcessContainmentSelfTestRequest = deepFreeze({
    schemaVersion: "1.0.0",
    selfTestId,
    providerDescriptorDigest: runtime.descriptor.descriptorDigest,
    providerCatalogDigest: runtime.catalogDigest,
    host: { platform: "windows", architecture: "x64" },
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    selfTestSuiteDigest: PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
    challengeDigest,
    fixtureIdentityDigest,
    issuedAt,
    expiresAt,
    maxDurationMs: PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS,
  });
  assertProcessContainmentSelfTestRequestSemantics(selfTestRequest);
  const requestDigest =
    computeProcessContainmentSelfTestRequestDigest(selfTestRequest);
  const prepared: PreparedWindowsContainmentSelfTest = Object.freeze({
    schemaVersion: "1.0.0",
    request: selfTestRequest,
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

export async function runWindowsContainmentSelfTest(
  request: RunWindowsContainmentSelfTestRequest,
): Promise<ProcessContainmentSelfTestReport> {
  const value = exactRecord(
    request,
    ["prepared"],
    "Self-test execution request contains undeclared fields.",
  ) as unknown as RawRunRequest;
  const prepared = value.prepared as PreparedWindowsContainmentSelfTest;
  const authority =
    prepared !== null && typeof prepared === "object"
      ? preparedAuthorities.get(prepared)
      : undefined;
  if (authority === undefined) {
    return fail(
      "invalid-self-test-request",
      "Self-test was not prepared by this process.",
    );
  }
  if (authority.consumed) {
    return fail("self-test-consumed", "Self-test preparation is one-use.");
  }
  if (process.platform !== "win32" || process.arch !== "x64") {
    return fail(
      "provider-host-unsupported",
      "Windows x64 is required for this containment provider.",
    );
  }
  if (Date.now() >= Date.parse(prepared.request.expiresAt)) {
    return fail("self-test-expired", "Self-test request expired before launch.");
  }
  authority.consumed = true;
  await assertWindowsContainmentProviderArtifactIdentity(
    authority.runtimeAuthority,
  );
  const nativeInput = `${canonicalizeJson({
    schemaVersion: "1.0.0",
    operation: "self-test",
    selfTestId: prepared.request.selfTestId,
    requestDigest: prepared.requestDigest,
    entryArtifactDigest: authority.runtimeAuthority.artifactDigest,
    challengeDigest: prepared.request.challengeDigest,
    fixtureIdentityDigest: prepared.request.fixtureIdentityDigest,
    issuedAt: prepared.request.issuedAt,
    expiresAt: prepared.request.expiresAt,
    maxDurationMs: prepared.request.maxDurationMs,
  })}\n`;
  const processResult = await runNativeSelfTest(
    authority.runtimeAuthority,
    nativeInput,
  );
  if (processResult.timedOut || processResult.overflowed) {
    return fail(
      "self-test-process-failed",
      "Native self-test exceeded its process boundary.",
      true,
    );
  }
  if (processResult.signal !== null || ![0, 2].includes(processResult.exitCode ?? -1)) {
    return fail(
      "self-test-process-failed",
      "Native self-test exited outside the protocol.",
      processResult.exitCode === null,
    );
  }
  if (processResult.stderr.length !== 0) {
    return fail(
      "self-test-output-invalid",
      "Native self-test emitted unexpected error output.",
    );
  }
  const native = parseNativeReport(
    processResult.stdout,
    prepared,
    authority.runtimeAuthority,
  );
  if (
    (native.outcome === "verified" && processResult.exitCode !== 0) ||
    (native.outcome === "rejected" && processResult.exitCode !== 2)
  ) {
    return fail(
      "self-test-output-invalid",
      "Native self-test outcome contradicts its process exit.",
    );
  }
  await assertWindowsContainmentProviderArtifactIdentity(
    authority.runtimeAuthority,
  );

  const probes: readonly ProcessContainmentSelfTestProbeResult[] =
    Object.freeze(
      native.probes.map((probe) =>
        Object.freeze({
          id: probe.id,
          expected: probe.expected,
          outcome: probe.outcome,
          observationDigest: digestCanonicalJson({
            domain:
              "ai-game-playbook/windows-containment-self-test-observation",
            version: "1.0.0",
            id: probe.id,
            expected: probe.expected,
            code: probe.code,
            observation: probe.observation,
          }),
        }),
      ) as readonly ProcessContainmentSelfTestProbeResult[],
    );
  const reportInput: ProcessContainmentSelfTestReportDigestInput = deepFreeze({
    selfTestId: prepared.request.selfTestId,
    request: prepared.request,
    requestDigest: prepared.requestDigest,
    providerDescriptorDigest:
      authority.runtime.descriptor.descriptorDigest,
    providerCatalogDigest: authority.runtime.catalogDigest,
    host: prepared.request.host,
    workload: prepared.request.workload,
    policyDigest: prepared.request.policyDigest,
    selfTestSuiteDigest: prepared.request.selfTestSuiteDigest,
    startedAt: native.startedAt,
    completedAt: native.completedAt,
    durationMs: native.durationMs,
    probes,
    effects: native.effects,
    outcome: native.outcome,
  });
  const report: ProcessContainmentSelfTestReport = deepFreeze({
    schemaVersion: "1.0.0",
    ...reportInput,
    reportDigest:
      computeProcessContainmentSelfTestReportDigest(reportInput),
  });
  assertProcessContainmentSelfTestReportSemantics(report);
  reportAuthorities.set(report, {
    runtime: authority.runtime,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    requestDigest: authority.requestDigest,
    expiresAt: prepared.request.expiresAt,
    consumed: false,
  });
  return report;
}

export function consumeWindowsContainmentSelfTestReport(
  request: ConsumeWindowsContainmentSelfTestReportRequest,
): WindowsContainmentSelfTestWitness {
  const value = exactRecord(
    request,
    ["runtime", "report", "projectRootIdentityDigest"],
    "Self-test witness request contains undeclared fields.",
  ) as unknown as RawConsumeRequest;
  const runtime = value.runtime as WindowsContainmentProviderRuntime;
  requireWindowsContainmentProviderRuntimeAuthority(runtime);
  const report = value.report as ProcessContainmentSelfTestReport;
  const authority =
    report !== null && typeof report === "object"
      ? reportAuthorities.get(report)
      : undefined;
  if (
    authority === undefined ||
    authority.runtime !== runtime ||
    value.projectRootIdentityDigest !==
      authority.projectRootIdentityDigest ||
    report.requestDigest !== authority.requestDigest ||
    report.outcome !== "verified"
  ) {
    return fail(
      "self-test-witness-invalid",
      "Self-test report has no matching same-process authority.",
    );
  }
  if (authority.consumed) {
    return fail(
      "self-test-witness-consumed",
      "Self-test report authority is one-use.",
    );
  }
  if (Date.now() >= Date.parse(authority.expiresAt)) {
    return fail(
      "self-test-expired",
      "Self-test report expired before authority consumption.",
    );
  }
  assertProcessContainmentSelfTestReportSemantics(report);
  authority.consumed = true;
  const witness: WindowsContainmentSelfTestWitness = Object.freeze({
    schemaVersion: "1.0.0",
    providerDescriptorDigest: report.providerDescriptorDigest,
    providerCatalogDigest: report.providerCatalogDigest,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    requestDigest: authority.requestDigest,
    reportDigest: report.reportDigest,
    expiresAt: authority.expiresAt,
  });
  witnessAuthorities.set(witness, {
    runtime,
    providerDescriptorDigest: report.providerDescriptorDigest,
    providerCatalogDigest: report.providerCatalogDigest,
    projectRootIdentityDigest: authority.projectRootIdentityDigest,
    requestDigest: authority.requestDigest,
    reportDigest: report.reportDigest,
    expiresAt: authority.expiresAt,
    launchClaimed: false,
  });
  return witness;
}

export function assertWindowsContainmentSelfTestWitness(
  witness: WindowsContainmentSelfTestWitness,
): void {
  const authority =
    witness !== null && typeof witness === "object"
      ? witnessAuthorities.get(witness)
      : undefined;
  if (authority === undefined) {
    return fail(
      "self-test-witness-invalid",
      "Self-test witness was not created by this process.",
    );
  }
  if (authority.launchClaimed) {
    return fail(
      "self-test-witness-consumed",
      "Self-test witness was already claimed by a launch.",
    );
  }
  if (Date.now() >= Date.parse(authority.expiresAt)) {
    return fail("self-test-expired", "Self-test witness has expired.");
  }
}

export function claimWindowsContainmentSelfTestWitnessForLaunch(
  witness: WindowsContainmentSelfTestWitness,
  runtime: WindowsContainmentProviderRuntime,
  projectRootIdentityDigest: Sha256Digest,
): WindowsContainmentSelfTestLaunchAuthority {
  const authority =
    witness !== null && typeof witness === "object"
      ? witnessAuthorities.get(witness)
      : undefined;
  if (
    authority === undefined ||
    authority.runtime !== runtime ||
    authority.projectRootIdentityDigest !== projectRootIdentityDigest ||
    authority.providerDescriptorDigest !==
      runtime.descriptor.descriptorDigest ||
    authority.providerCatalogDigest !== runtime.catalogDigest ||
    authority.requestDigest !== witness.requestDigest ||
    authority.reportDigest !== witness.reportDigest ||
    authority.expiresAt !== witness.expiresAt
  ) {
    return fail(
      "self-test-witness-invalid",
      "Self-test witness does not match the launch runtime or project identity.",
    );
  }
  if (authority.launchClaimed) {
    return fail(
      "self-test-witness-consumed",
      "Self-test witness was already claimed by a launch.",
    );
  }
  if (Date.now() >= Date.parse(authority.expiresAt)) {
    return fail("self-test-expired", "Self-test witness has expired.");
  }
  authority.launchClaimed = true;
  return Object.freeze({
    requestDigest: authority.requestDigest,
    reportDigest: authority.reportDigest,
    expiresAt: authority.expiresAt,
  });
}
