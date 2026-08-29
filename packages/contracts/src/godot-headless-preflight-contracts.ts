import { compareCanonicalText } from "./canonical-json.js";
import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  GODOT_VERSION_PROBE_STATUSES,
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
  type GodotVersionProbeStatus,
} from "./godot-version-probe-contracts.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { SemanticVersion } from "./semantic-version.js";
import { parseSemanticVersion } from "./semantic-version.js";
import { isStableId, type StableId } from "./stable-id.js";
import {
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  PROCESS_CONTAINMENT_REQUIREMENTS,
  computeProcessContainmentRequestDigest,
} from "./process-containment-assessment-contracts.js";

export const GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET = 1 as const;
export const GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES: number = 256 * 1024;
export const GODOT_HEADLESS_PREFLIGHT_PROCESS_TIMEOUT_MS: number = 10_000;
export const GODOT_HEADLESS_PREFLIGHT_IDLE_TIMEOUT_MS: number = 10_000;
export const GODOT_HEADLESS_PREFLIGHT_TERMINATION_GRACE_MS: number = 2_000;
export const GODOT_HEADLESS_PREFLIGHT_COMMAND_TIMEOUT_MS: number = 42_000;

const invocationSubject = Object.freeze({
  workingDirectory: "$stagedProject" as const,
  arguments: Object.freeze([
    "--headless",
    "--path",
    "$stagedProject",
    "--quit-after",
    String(GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET),
    "--log-file",
    "$profileLocalLog",
    "--no-header",
  ]),
  callerArguments: "denied" as const,
  environment: "provider-fixed-contained" as const,
});

export const GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/godot-headless-preflight-invocation",
    version: "1.0.0",
    ...invocationSubject,
  });

export type GodotHeadlessPreflightBlocker =
  | "godot-headless-containment-unavailable"
  | "godot-headless-version-unverified";

export type GodotHeadlessPreflightCode =
  | GodotHeadlessPreflightBlocker
  | "godot-headless-engine-process-failed"
  | "godot-headless-engine-run-uncertain"
  | "godot-headless-preflight-passed";

export interface GodotHeadlessPreflightCommandInput {
  readonly schemaVersion: "1.0.0";
  readonly engine: "godot";
  readonly versionProbeDigest: Sha256Digest;
  readonly versionProbeStatus: GodotVersionProbeStatus;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectInspectionDigest: Sha256Digest;
  readonly executableDigest: Sha256Digest;
  readonly executableIdentityDigest: Sha256Digest;
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly mode: "dynamic-main-scene";
  readonly frameBudget: typeof GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET;
  readonly invocationDigest: Sha256Digest;
  readonly containment: GodotHeadlessPreflightContainmentBinding;
  readonly requirements: {
    readonly filesystem: "deny-project-writes";
    readonly network: "deny";
    readonly childProcesses: "deny";
  };
}

export interface GodotHeadlessPreflightBlockedContainmentBinding {
  readonly assessmentDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly providerCatalogDigest: Sha256Digest;
  readonly decision: "block";
  readonly evidenceGrade: "implemented";
}

export interface GodotHeadlessPreflightQualifiedContainmentBinding {
  readonly admissionDigest: Sha256Digest;
  readonly runRequestDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly decision: "qualified";
  readonly evidenceGrade: "locally-executed";
  readonly expiresAt: string;
}

export type GodotHeadlessPreflightContainmentBinding =
  | GodotHeadlessPreflightBlockedContainmentBinding
  | GodotHeadlessPreflightQualifiedContainmentBinding;

export interface GodotHeadlessPreflightAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status:
    | "succeeded"
    | "failed"
    | "uncertain"
    | "scope-violation";
  readonly mutationUncertain: boolean;
  readonly violations: readonly StableId[];
  readonly approvalIds: readonly StableId[];
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly settledAt: string;
}

export interface GodotHeadlessPreflightReceiptPointer {
  readonly status: "retained";
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
}

export interface GodotHeadlessPreflightEngineRunEvidence {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly admissionDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly process: {
    readonly started: boolean;
    readonly exitCode: number | null;
    readonly totalProcesses: number | null;
    readonly activeProcesses: number | null;
  };
  readonly output: {
    readonly logDigest: Sha256Digest;
    readonly capturedBytes: number;
    readonly observedBytes: number;
    readonly truncated: boolean;
  };
  readonly termination: {
    readonly requested: boolean;
    readonly confirmed: boolean;
  };
  readonly effects: {
    readonly sourceProjectPreserved: boolean;
    readonly sourceExecutablePreserved: boolean;
    readonly stagedProjectBaselinePreserved: boolean;
    readonly stagedExecutableBaselinePreserved: boolean;
    readonly profileBudgetPreserved: boolean;
    readonly networkConnectionEstablished: boolean;
    readonly childProcessStarted: boolean;
    readonly cleanup: "complete" | "incomplete" | "uncertain";
  };
  readonly outcome: "succeeded" | "failed" | "uncertain";
  readonly mutationUncertain: boolean;
}

interface GodotHeadlessPreflightDigestBase {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
  };
  readonly executable: {
    readonly digest: Sha256Digest;
    readonly identityDigest: Sha256Digest;
  };
  readonly targetVersion: SemanticVersion;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly versionProbe: {
    readonly digest: Sha256Digest;
    readonly status: GodotVersionProbeStatus;
    readonly exactTargetMatch: boolean;
  };
  readonly mode: "dynamic-main-scene";
  readonly frameBudget: typeof GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET;
  readonly invocationDigest: Sha256Digest;
  readonly receipt: GodotHeadlessPreflightReceiptPointer;
  readonly mutationPerformed: boolean;
  readonly externalProcessStarted: boolean;
  readonly networkAccessPerformed: boolean;
}

export interface GodotHeadlessPreflightBlockedDigestInput
  extends GodotHeadlessPreflightDigestBase {
  readonly containment: GodotHeadlessPreflightBlockedContainmentBinding;
  readonly status: "blocked";
  readonly code: GodotHeadlessPreflightBlocker;
  readonly blockers: readonly GodotHeadlessPreflightBlocker[];
  readonly preconditions: {
    readonly version: "passed" | "blocked";
    readonly containment: "blocked";
  };
  readonly isolation: {
    readonly filesystem: "unavailable";
    readonly network: "unavailable";
    readonly childProcesses: "unavailable";
    readonly writablePaths: readonly string[];
  };
  readonly execution: {
    readonly processStarted: false;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly authorization: GodotHeadlessPreflightAuthorization;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "implemented";
    readonly reason: string;
  };
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
}

export interface GodotHeadlessPreflightExecutedDigestInput
  extends GodotHeadlessPreflightDigestBase {
  readonly containment: GodotHeadlessPreflightQualifiedContainmentBinding;
  readonly status: "succeeded" | "failed" | "uncertain";
  readonly code:
    | "godot-headless-engine-process-failed"
    | "godot-headless-engine-run-uncertain"
    | "godot-headless-preflight-passed";
  readonly blockers: readonly GodotHeadlessPreflightBlocker[];
  readonly preconditions: {
    readonly version: "passed";
    readonly containment: "passed";
  };
  readonly isolation: {
    readonly filesystem: "disposable-copy";
    readonly network: "denied";
    readonly childProcesses: "denied";
    readonly writablePaths: readonly string[];
  };
  readonly execution: {
    readonly processStarted: boolean;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly durationMs: number;
  };
  readonly authorization: GodotHeadlessPreflightAuthorization;
  readonly engineRun: GodotHeadlessPreflightEngineRunEvidence;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "locally-executed";
    readonly reason: string;
  };
}

export type GodotHeadlessPreflightDigestInput =
  | GodotHeadlessPreflightBlockedDigestInput
  | GodotHeadlessPreflightExecutedDigestInput;

export type GodotHeadlessPreflightReport = GodotHeadlessPreflightDigestInput & {
  readonly schemaVersion: "1.0.0";
  readonly commandId: "engine.headless-preflight";
  readonly preflightDigest: Sha256Digest;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function record(value: unknown): value is Record<string, unknown> {
  if (
    !(
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.getOwnPropertySymbols(value).length === 0
    )
  ) {
    return false;
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return false;
    }
  }
  return true;
}

function exactKeys(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => allowed.has(key))
  );
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function semanticVersion(value: unknown): value is SemanticVersion {
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}

function canonicalStableIds(value: unknown, maximum: number): value is StableId[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => isStableId(entry)) &&
    value.every(
      (entry, index) =>
        index === 0 ||
        compareCanonicalText(value[index - 1] as string, entry) < 0,
    )
  );
}

function validateContainmentBinding(
  value: unknown,
): GodotHeadlessPreflightContainmentBinding {
  if (!record(value)) {
    throw new TypeError(
      "Godot headless preflight containment binding is invalid",
    );
  }
  if (value["decision"] === "block") {
    if (
      !exactKeys(value, [
        "assessmentDigest",
        "decision",
        "evidenceGrade",
        "policyDigest",
        "providerCatalogDigest",
        "requestDigest",
      ]) ||
      !isSha256Digest(value["assessmentDigest"]) ||
      !isSha256Digest(value["requestDigest"]) ||
      value["policyDigest"] !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
      !isSha256Digest(value["providerCatalogDigest"]) ||
      value["evidenceGrade"] !== "implemented"
    ) {
      throw new TypeError(
        "Godot headless preflight containment binding is invalid",
      );
    }
    return value as unknown as GodotHeadlessPreflightBlockedContainmentBinding;
  }
  if (
    value["decision"] !== "qualified" ||
    !exactKeys(value, [
      "admissionDigest",
      "decision",
      "evidenceGrade",
      "executableSnapshotDigest",
      "expiresAt",
      "policyDigest",
      "profileDigest",
      "projectSnapshotDigest",
      "providerCatalogDigest",
      "providerDescriptorDigest",
      "runRequestDigest",
      "snapshotBindingDigest",
    ]) ||
    !isSha256Digest(value["admissionDigest"]) ||
    !isSha256Digest(value["runRequestDigest"]) ||
    value["policyDigest"] !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    !isSha256Digest(value["providerDescriptorDigest"]) ||
    !isSha256Digest(value["providerCatalogDigest"]) ||
    !isSha256Digest(value["profileDigest"]) ||
    !isSha256Digest(value["snapshotBindingDigest"]) ||
    !isSha256Digest(value["projectSnapshotDigest"]) ||
    !isSha256Digest(value["executableSnapshotDigest"]) ||
    value["evidenceGrade"] !== "locally-executed" ||
    !canonicalTimestamp(value["expiresAt"])
  ) {
    throw new TypeError(
      "Godot headless preflight containment binding is invalid",
    );
  }
  return value as unknown as GodotHeadlessPreflightQualifiedContainmentBinding;
}

function expectedContainmentRequestDigest(
  projectRootIdentityDigest: Sha256Digest,
): Sha256Digest {
  return computeProcessContainmentRequestDigest({
    schemaVersion: "1.0.0",
    workload: "engine-project-process",
    projectRootIdentityDigest,
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    requirements: PROCESS_CONTAINMENT_REQUIREMENTS,
  });
}

export function assertGodotHeadlessPreflightRequestSemantics(
  value: GodotHeadlessPreflightCommandInput,
): void {
  if (
    !record(value) ||
    !exactKeys(value, [
      "engine",
      "containment",
      "executableDigest",
      "executableIdentityDigest",
      "frameBudget",
      "invocationDigest",
      "mode",
      "projectInspectionDigest",
      "projectRootIdentityDigest",
      "requirements",
      "schemaVersion",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbeDigest",
      "versionProbeStatus",
    ]) ||
    value.schemaVersion !== "1.0.0" ||
    value.engine !== "godot" ||
    !isSha256Digest(value.versionProbeDigest) ||
    !GODOT_VERSION_PROBE_STATUSES.includes(value.versionProbeStatus) ||
    !isSha256Digest(value.projectRootIdentityDigest) ||
    !isSha256Digest(value.projectInspectionDigest) ||
    !isSha256Digest(value.executableDigest) ||
    !isSha256Digest(value.executableIdentityDigest) ||
    value.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    value.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    value.mode !== "dynamic-main-scene" ||
    value.frameBudget !== GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET ||
    value.invocationDigest !== GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    !record(value.requirements) ||
    !exactKeys(value.requirements, [
      "childProcesses",
      "filesystem",
      "network",
    ]) ||
    value.requirements.filesystem !== "deny-project-writes" ||
    value.requirements.network !== "deny" ||
    value.requirements.childProcesses !== "deny"
  ) {
    throw new TypeError("Godot headless preflight request is outside the contract");
  }
  const containment = validateContainmentBinding(value.containment);
  if (
    (containment.decision === "block" &&
      containment.requestDigest !==
        expectedContainmentRequestDigest(value.projectRootIdentityDigest)) ||
    (containment.decision === "qualified" &&
      value.versionProbeStatus !== "matched")
  ) {
    throw new TypeError(
      "Godot headless preflight containment binding is invalid",
    );
  }
}

function validateExecutionEvidence(
  value: unknown,
  containment: GodotHeadlessPreflightQualifiedContainmentBinding,
): GodotHeadlessPreflightEngineRunEvidence {
  if (
    !record(value) ||
    !exactKeys(value, [
      "admissionDigest",
      "effects",
      "executableSnapshotDigest",
      "mutationUncertain",
      "outcome",
      "output",
      "process",
      "profileDigest",
      "projectSnapshotDigest",
      "reportDigest",
      "requestDigest",
      "snapshotBindingDigest",
      "termination",
    ]) ||
    !isSha256Digest(value["requestDigest"]) ||
    !isSha256Digest(value["reportDigest"]) ||
    !isSha256Digest(value["admissionDigest"]) ||
    !isSha256Digest(value["profileDigest"]) ||
    !isSha256Digest(value["snapshotBindingDigest"]) ||
    !isSha256Digest(value["projectSnapshotDigest"]) ||
    !isSha256Digest(value["executableSnapshotDigest"]) ||
    (value["outcome"] !== "succeeded" &&
      value["outcome"] !== "failed" &&
      value["outcome"] !== "uncertain") ||
    typeof value["mutationUncertain"] !== "boolean" ||
    value["requestDigest"] !== containment.runRequestDigest ||
    value["admissionDigest"] !== containment.admissionDigest ||
    value["profileDigest"] !== containment.profileDigest ||
    value["snapshotBindingDigest"] !== containment.snapshotBindingDigest ||
    value["projectSnapshotDigest"] !== containment.projectSnapshotDigest ||
    value["executableSnapshotDigest"] !== containment.executableSnapshotDigest
  ) {
    throw new TypeError("Godot headless engine run evidence is invalid");
  }
  const process = value["process"];
  if (
    !record(process) ||
    !exactKeys(process, [
      "activeProcesses",
      "exitCode",
      "started",
      "totalProcesses",
    ]) ||
    typeof process["started"] !== "boolean" ||
    (process["exitCode"] !== null &&
      !boundedInteger(process["exitCode"], -2_147_483_648, 2_147_483_647)) ||
    (process["totalProcesses"] !== null &&
      !boundedInteger(process["totalProcesses"], 0, 1_024)) ||
    (process["activeProcesses"] !== null &&
      !boundedInteger(process["activeProcesses"], 0, 1_024))
  ) {
    throw new TypeError("Godot headless engine run process evidence is invalid");
  }
  const output = value["output"];
  if (
    !record(output) ||
    !exactKeys(output, [
      "capturedBytes",
      "logDigest",
      "observedBytes",
      "truncated",
    ]) ||
    !isSha256Digest(output["logDigest"]) ||
    !boundedInteger(output["capturedBytes"], 0, GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES) ||
    !boundedInteger(output["observedBytes"], 0, 67_108_864) ||
    typeof output["truncated"] !== "boolean" ||
    (output["capturedBytes"] as number) > (output["observedBytes"] as number)
  ) {
    throw new TypeError("Godot headless engine run output evidence is invalid");
  }
  const termination = value["termination"];
  if (
    !record(termination) ||
    !exactKeys(termination, ["confirmed", "requested"]) ||
    typeof termination["requested"] !== "boolean" ||
    typeof termination["confirmed"] !== "boolean"
  ) {
    throw new TypeError("Godot headless engine run termination evidence is invalid");
  }
  const effects = value["effects"];
  const effectBooleans = [
    "childProcessStarted",
    "networkConnectionEstablished",
    "profileBudgetPreserved",
    "sourceExecutablePreserved",
    "sourceProjectPreserved",
    "stagedExecutableBaselinePreserved",
    "stagedProjectBaselinePreserved",
  ] as const;
  if (
    !record(effects) ||
    !exactKeys(effects, [...effectBooleans, "cleanup"]) ||
    effectBooleans.some((name) => typeof effects[name] !== "boolean") ||
    (effects["cleanup"] !== "complete" &&
      effects["cleanup"] !== "incomplete" &&
      effects["cleanup"] !== "uncertain")
  ) {
    throw new TypeError("Godot headless engine run effects are invalid");
  }
  if (
    value["outcome"] === "succeeded" &&
    (value["mutationUncertain"] ||
      process["started"] !== true ||
      process["exitCode"] !== 0 ||
      process["totalProcesses"] !== 1 ||
      process["activeProcesses"] !== 0 ||
      output["truncated"] !== false ||
      effects["sourceProjectPreserved"] !== true ||
      effects["sourceExecutablePreserved"] !== true ||
      effects["stagedProjectBaselinePreserved"] !== true ||
      effects["stagedExecutableBaselinePreserved"] !== true ||
      effects["profileBudgetPreserved"] !== true ||
      effects["networkConnectionEstablished"] !== false ||
      effects["childProcessStarted"] !== false ||
      effects["cleanup"] !== "complete")
  ) {
    throw new TypeError("Godot headless engine run success is contradictory");
  }
  if (value["outcome"] === "uncertain" && !value["mutationUncertain"]) {
    throw new TypeError("Godot headless engine run uncertainty is contradictory");
  }
  return value as unknown as GodotHeadlessPreflightEngineRunEvidence;
}

function validateDigestInput(input: GodotHeadlessPreflightDigestInput): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "authorization",
      "blockers",
      "code",
      "containment",
      "controlPlaneVersion",
      "executable",
      "execution",
      "externalProcessStarted",
      "frameBudget",
      "invocationDigest",
      "isolation",
      "mode",
      "mutationPerformed",
      "networkAccessPerformed",
      "preconditions",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
    ], ["engineRun"]) ||
    !semanticVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    !uuidPattern.test(input.runId) ||
    input.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    input.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    input.mode !== "dynamic-main-scene" ||
    input.frameBudget !== GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET ||
    input.invocationDigest !== GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST ||
    (input.status !== "blocked" &&
      input.status !== "succeeded" &&
      input.status !== "failed" &&
      input.status !== "uncertain") ||
    typeof input.mutationPerformed !== "boolean" ||
    typeof input.externalProcessStarted !== "boolean" ||
    typeof input.networkAccessPerformed !== "boolean"
  ) {
    throw new TypeError("Godot headless preflight report identity is invalid");
  }
  const containment = validateContainmentBinding(input.containment);
  if (
    !record(input.project) ||
    !exactKeys(input.project, [
      "id",
      "identityDigest",
      "inspectionDigest",
      "rootIdentityDigest",
    ]) ||
    !isStableId(input.project.id) ||
    !isSha256Digest(input.project.identityDigest) ||
    input.project.identityDigest !== input.project.rootIdentityDigest ||
    !isSha256Digest(input.project.inspectionDigest) ||
    !record(input.executable) ||
    !exactKeys(input.executable, ["digest", "identityDigest"]) ||
    !isSha256Digest(input.executable.digest) ||
    !isSha256Digest(input.executable.identityDigest)
  ) {
    throw new TypeError("Godot headless preflight bindings are invalid");
  }
  if (
    containment.decision === "block" &&
    containment.requestDigest !==
      expectedContainmentRequestDigest(input.project.rootIdentityDigest)
  ) {
    throw new TypeError(
      "Godot headless preflight containment binding is invalid",
    );
  }
  if (
    !record(input.versionProbe) ||
    !exactKeys(input.versionProbe, ["digest", "exactTargetMatch", "status"]) ||
    !isSha256Digest(input.versionProbe.digest) ||
    !GODOT_VERSION_PROBE_STATUSES.includes(input.versionProbe.status) ||
    typeof input.versionProbe.exactTargetMatch !== "boolean"
  ) {
    throw new TypeError("Godot headless preflight blockers are contradictory");
  }
  const versionMatched =
    input.versionProbe.status === "matched" &&
    input.versionProbe.exactTargetMatch;
  if (
    input.versionProbe.exactTargetMatch !==
      (input.versionProbe.status === "matched") ||
    !canonicalStableIds(input.blockers, 2)
  ) {
    throw new TypeError("Godot headless preflight blockers are contradictory");
  }
  if (
    !record(input.preconditions) ||
    !exactKeys(input.preconditions, ["containment", "version"]) ||
    !record(input.isolation) ||
    !exactKeys(input.isolation, [
      "childProcesses",
      "filesystem",
      "network",
      "writablePaths",
    ]) ||
    !Array.isArray(input.isolation.writablePaths) ||
    input.isolation.writablePaths.length !== 0
  ) {
    throw new TypeError("Godot headless preflight containment is not fail-closed");
  }
  const execution = input.execution;
  if (
    !record(execution) ||
    !exactKeys(execution, [
      "durationMs",
      "endedAt",
      "processStarted",
      "startedAt",
    ]) ||
    typeof execution.processStarted !== "boolean" ||
    !canonicalTimestamp(execution.startedAt) ||
    !canonicalTimestamp(execution.endedAt) ||
    Date.parse(execution.endedAt) < Date.parse(execution.startedAt) ||
    !boundedInteger(execution.durationMs, 0, 604_800_000) ||
    Date.parse(execution.endedAt) - Date.parse(execution.startedAt) !==
      execution.durationMs
  ) {
    throw new TypeError("Godot headless preflight timing is contradictory");
  }
  const authorization = input.authorization;
  if (
    !record(authorization) ||
    !exactKeys(authorization, [
      "approvalIds",
      "authorizationId",
      "durationMs",
      "mutationUncertain",
      "outputBytes",
      "requestDigest",
      "settledAt",
      "status",
      "violations",
    ]) ||
    !uuidPattern.test(authorization.authorizationId) ||
    !isSha256Digest(authorization.requestDigest) ||
    (authorization.status !== "succeeded" &&
      authorization.status !== "failed" &&
      authorization.status !== "uncertain" &&
      authorization.status !== "scope-violation") ||
    typeof authorization.mutationUncertain !== "boolean" ||
    !canonicalStableIds(authorization.violations, 32) ||
    !canonicalStableIds(authorization.approvalIds, 128) ||
    authorization.approvalIds.length < 1 ||
    !boundedInteger(authorization.durationMs, 0, 604_800_000) ||
    authorization.durationMs !== execution.durationMs ||
    !boundedInteger(
      authorization.outputBytes,
      0,
      GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    ) ||
    !canonicalTimestamp(authorization.settledAt) ||
    Date.parse(authorization.settledAt) < Date.parse(execution.endedAt)
  ) {
    throw new TypeError("Godot headless preflight authorization is contradictory");
  }
  if (
    !record(input.support) ||
    !exactKeys(input.support, ["evidenceGrade", "grade", "reason"]) ||
    input.support.grade !== "planned" ||
    (input.support.evidenceGrade !== "implemented" &&
      input.support.evidenceGrade !== "locally-executed") ||
    typeof input.support.reason !== "string" ||
    input.support.reason.length < 1 ||
    input.support.reason.length > 500
  ) {
    throw new TypeError("Godot headless preflight support is invalid");
  }
  const blocked = input.status === "blocked";
  if (blocked) {
    if (
      containment.decision !== "block" ||
      input.blockers.length < 1 ||
      input.code !== input.blockers[0] ||
      !input.blockers.includes("godot-headless-containment-unavailable") ||
      input.blockers.includes("godot-headless-version-unverified") ===
        versionMatched ||
      input.preconditions.version !== (versionMatched ? "passed" : "blocked") ||
      input.preconditions.containment !== "blocked" ||
      input.isolation.filesystem !== "unavailable" ||
      input.isolation.network !== "unavailable" ||
      input.isolation.childProcesses !== "unavailable" ||
      input.support.evidenceGrade !== "implemented" ||
      execution.processStarted ||
      authorization.status !== "failed" ||
      authorization.mutationUncertain ||
      authorization.violations.length !== 0 ||
      authorization.outputBytes !== 0 ||
      input.mutationPerformed ||
      input.externalProcessStarted ||
      input.networkAccessPerformed ||
      Object.hasOwn(input, "engineRun")
    ) {
      throw new TypeError("Godot headless blocked report is contradictory");
    }
  } else {
    if (
      containment.decision !== "qualified" ||
      !versionMatched ||
      input.blockers.length !== 0 ||
      input.preconditions.version !== "passed" ||
      input.preconditions.containment !== "passed" ||
      input.isolation.filesystem !== "disposable-copy" ||
      input.isolation.network !== "denied" ||
      input.isolation.childProcesses !== "denied" ||
      input.support.evidenceGrade !== "locally-executed" ||
      !Object.hasOwn(input, "engineRun")
    ) {
      throw new TypeError("Godot headless contained report is contradictory");
    }
    const engineRun = validateExecutionEvidence(
      input.engineRun,
      containment,
    );
    const expectedStatus =
      authorization.status === "succeeded"
        ? "succeeded"
        : authorization.status === "failed"
          ? "failed"
          : "uncertain";
    const expectedCode =
      expectedStatus === "succeeded"
        ? "godot-headless-preflight-passed"
        : expectedStatus === "failed"
          ? "godot-headless-engine-process-failed"
          : "godot-headless-engine-run-uncertain";
    if (
      input.status !== expectedStatus ||
      input.code !== expectedCode ||
      (input.status !== "uncertain" && engineRun.outcome !== input.status) ||
      execution.processStarted !== engineRun.process.started ||
      input.externalProcessStarted !== engineRun.process.started ||
      input.networkAccessPerformed !==
        engineRun.effects.networkConnectionEstablished ||
      input.mutationPerformed !==
        (!engineRun.effects.sourceProjectPreserved ||
          !engineRun.effects.sourceExecutablePreserved) ||
      authorization.durationMs !== execution.durationMs ||
      authorization.outputBytes !== engineRun.output.capturedBytes ||
      (engineRun.mutationUncertain && !authorization.mutationUncertain) ||
      (authorization.status === "scope-violation") !==
        (authorization.violations.length > 0) ||
      (authorization.status === "uncertain" &&
        (!authorization.mutationUncertain ||
          !engineRun.mutationUncertain ||
          authorization.violations.length !== 0)) ||
      ((authorization.status === "succeeded" ||
        authorization.status === "failed") &&
        (authorization.mutationUncertain ||
          authorization.violations.length !== 0))
    ) {
      throw new TypeError("Godot headless contained outcome is contradictory");
    }
  }
  const receipt = input.receipt;
  if (
    !record(receipt) ||
    !exactKeys(receipt, [
      "chainLength",
      "headDigest",
      "receiptDigest",
      "receiptId",
      "status",
    ]) ||
    receipt.status !== "retained" ||
    !uuidPattern.test(receipt.receiptId) ||
    !isSha256Digest(receipt.receiptDigest) ||
    !isSha256Digest(receipt.headDigest) ||
    !boundedInteger(receipt.chainLength, 1, 4096)
  ) {
    throw new TypeError("Godot headless preflight retention is invalid");
  }
}

export function computeGodotHeadlessPreflightDigest(
  input: GodotHeadlessPreflightDigestInput,
): Sha256Digest {
  validateDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-headless-preflight",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotHeadlessPreflightReportSemantics(
  report: GodotHeadlessPreflightReport,
): void {
  if (
    !record(report) ||
    !exactKeys(report, [
      "authorization",
      "blockers",
      "code",
      "commandId",
      "containment",
      "controlPlaneVersion",
      "executable",
      "execution",
      "externalProcessStarted",
      "frameBudget",
      "invocationDigest",
      "isolation",
      "mode",
      "mutationPerformed",
      "networkAccessPerformed",
      "preconditions",
      "preflightDigest",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "schemaVersion",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
    ], ["engineRun"]) ||
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== "engine.headless-preflight" ||
    !isSha256Digest(report.preflightDigest)
  ) {
    throw new TypeError("Godot headless preflight report is outside the contract");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    preflightDigest,
    ...input
  } = report;
  if (
    preflightDigest !==
    computeGodotHeadlessPreflightDigest(
      input as GodotHeadlessPreflightDigestInput,
    )
  ) {
    throw new TypeError("Godot headless preflight digest does not attest its report");
  }
}

const requirements = closedObject(
  {
    filesystem: { const: "deny-project-writes" },
    network: { const: "deny" },
    childProcesses: { const: "deny" },
  },
  ["filesystem", "network", "childProcesses"],
);

const blockedContainmentBinding = closedObject(
  {
    assessmentDigest: reference("sha256Digest"),
    requestDigest: reference("sha256Digest"),
    policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
    providerCatalogDigest: reference("sha256Digest"),
    decision: { const: "block" },
    evidenceGrade: { const: "implemented" },
  },
  [
    "assessmentDigest",
    "requestDigest",
    "policyDigest",
    "providerCatalogDigest",
    "decision",
    "evidenceGrade",
  ],
);

const qualifiedContainmentBinding = closedObject(
  {
    admissionDigest: reference("sha256Digest"),
    runRequestDigest: reference("sha256Digest"),
    policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
    providerDescriptorDigest: reference("sha256Digest"),
    providerCatalogDigest: reference("sha256Digest"),
    profileDigest: reference("sha256Digest"),
    snapshotBindingDigest: reference("sha256Digest"),
    projectSnapshotDigest: reference("sha256Digest"),
    executableSnapshotDigest: reference("sha256Digest"),
    decision: { const: "qualified" },
    evidenceGrade: { const: "locally-executed" },
    expiresAt: reference("timestamp"),
  },
  [
    "admissionDigest",
    "runRequestDigest",
    "policyDigest",
    "providerDescriptorDigest",
    "providerCatalogDigest",
    "profileDigest",
    "snapshotBindingDigest",
    "projectSnapshotDigest",
    "executableSnapshotDigest",
    "decision",
    "evidenceGrade",
    "expiresAt",
  ],
);

const containmentBinding = {
  anyOf: [blockedContainmentBinding, qualifiedContainmentBinding],
} as const;

const requestProperties = {
  schemaVersion: { const: "1.0.0" },
  engine: { const: "godot" },
  versionProbeDigest: reference("sha256Digest"),
  versionProbeStatus: enumSchema(GODOT_VERSION_PROBE_STATUSES),
  projectRootIdentityDigest: reference("sha256Digest"),
  projectInspectionDigest: reference("sha256Digest"),
  executableDigest: reference("sha256Digest"),
  executableIdentityDigest: reference("sha256Digest"),
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  mode: { const: "dynamic-main-scene" },
  frameBudget: { const: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET },
  invocationDigest: { const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST },
  containment: containmentBinding,
  requirements,
} as const;

const requestRequired = Object.freeze(Object.keys(requestProperties));

export const godotHeadlessPreflightRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-headless-preflight-request",
    version: "1.0.0",
    title: "Godot Headless Preflight Request",
    description:
      "Binds one internal Godot main-scene preflight admission to exact project, executable, version, invocation, and deny-by-default containment requirements.",
    schema: contractRoot(requestProperties, requestRequired),
  });

const project = closedObject(
  {
    id: reference("stableId"),
    identityDigest: reference("sha256Digest"),
    rootIdentityDigest: reference("sha256Digest"),
    inspectionDigest: reference("sha256Digest"),
  },
  ["id", "identityDigest", "rootIdentityDigest", "inspectionDigest"],
);

const executable = closedObject(
  {
    digest: reference("sha256Digest"),
    identityDigest: reference("sha256Digest"),
  },
  ["digest", "identityDigest"],
);

const versionProbe = closedObject(
  {
    digest: reference("sha256Digest"),
    status: enumSchema(GODOT_VERSION_PROBE_STATUSES),
    exactTargetMatch: { type: "boolean" },
  },
  ["digest", "status", "exactTargetMatch"],
);

const blocker = enumSchema([
  "godot-headless-containment-unavailable",
  "godot-headless-version-unverified",
]);

const code = enumSchema([
  "godot-headless-containment-unavailable",
  "godot-headless-version-unverified",
  "godot-headless-engine-process-failed",
  "godot-headless-engine-run-uncertain",
  "godot-headless-preflight-passed",
]);

const preconditions = closedObject(
  {
    version: enumSchema(["passed", "blocked"]),
    containment: enumSchema(["passed", "blocked"]),
  },
  ["version", "containment"],
);

const isolation = closedObject(
  {
    filesystem: enumSchema(["unavailable", "disposable-copy"]),
    network: enumSchema(["unavailable", "denied"]),
    childProcesses: enumSchema(["unavailable", "denied"]),
    writablePaths: boundedArray(reference("portablePath"), { maximum: 0 }),
  },
  ["filesystem", "network", "childProcesses", "writablePaths"],
);

const execution = closedObject(
  {
    processStarted: { type: "boolean" },
    startedAt: reference("timestamp"),
    endedAt: reference("timestamp"),
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
  },
  ["processStarted", "startedAt", "endedAt", "durationMs"],
);

const authorization = closedObject(
  {
    authorizationId: reference("uuid"),
    requestDigest: reference("sha256Digest"),
    status: enumSchema([
      "succeeded",
      "failed",
      "uncertain",
      "scope-violation",
    ]),
    mutationUncertain: { type: "boolean" },
    violations: boundedArray(reference("stableId"), {
      maximum: 32,
      unique: true,
    }),
    approvalIds: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: 128,
      unique: true,
    }),
    durationMs: { type: "integer", minimum: 0, maximum: 604800000 },
    outputBytes: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    },
    settledAt: reference("timestamp"),
  },
  [
    "authorizationId",
    "requestDigest",
    "status",
    "mutationUncertain",
    "violations",
    "approvalIds",
    "durationMs",
    "outputBytes",
    "settledAt",
  ],
);

const receipt = closedObject(
  {
    status: { const: "retained" },
    receiptId: reference("uuid"),
    receiptDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    chainLength: { type: "integer", minimum: 1, maximum: 4096 },
  },
  ["status", "receiptId", "receiptDigest", "headDigest", "chainLength"],
);

const support = closedObject(
  {
    grade: { const: "planned" },
    evidenceGrade: enumSchema(["implemented", "locally-executed"]),
    reason: textSchema(500),
  },
  ["grade", "evidenceGrade", "reason"],
);

const engineRunProcess = closedObject(
  {
    started: { type: "boolean" },
    exitCode: {
      anyOf: [
        { type: "integer", minimum: -2_147_483_648, maximum: 2_147_483_647 },
        { type: "null" },
      ],
    },
    totalProcesses: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 1_024 },
        { type: "null" },
      ],
    },
    activeProcesses: {
      anyOf: [
        { type: "integer", minimum: 0, maximum: 1_024 },
        { type: "null" },
      ],
    },
  },
  ["started", "exitCode", "totalProcesses", "activeProcesses"],
);

const engineRunOutput = closedObject(
  {
    logDigest: reference("sha256Digest"),
    capturedBytes: {
      type: "integer",
      minimum: 0,
      maximum: GODOT_HEADLESS_PREFLIGHT_MAX_OUTPUT_BYTES,
    },
    observedBytes: { type: "integer", minimum: 0, maximum: 67_108_864 },
    truncated: { type: "boolean" },
  },
  ["logDigest", "capturedBytes", "observedBytes", "truncated"],
);

const engineRunTermination = closedObject(
  {
    requested: { type: "boolean" },
    confirmed: { type: "boolean" },
  },
  ["requested", "confirmed"],
);

const engineRunEffects = closedObject(
  {
    sourceProjectPreserved: { type: "boolean" },
    sourceExecutablePreserved: { type: "boolean" },
    stagedProjectBaselinePreserved: { type: "boolean" },
    stagedExecutableBaselinePreserved: { type: "boolean" },
    profileBudgetPreserved: { type: "boolean" },
    networkConnectionEstablished: { type: "boolean" },
    childProcessStarted: { type: "boolean" },
    cleanup: enumSchema(["complete", "incomplete", "uncertain"]),
  },
  [
    "sourceProjectPreserved",
    "sourceExecutablePreserved",
    "stagedProjectBaselinePreserved",
    "stagedExecutableBaselinePreserved",
    "profileBudgetPreserved",
    "networkConnectionEstablished",
    "childProcessStarted",
    "cleanup",
  ],
);

const engineRun = closedObject(
  {
    requestDigest: reference("sha256Digest"),
    reportDigest: reference("sha256Digest"),
    admissionDigest: reference("sha256Digest"),
    profileDigest: reference("sha256Digest"),
    snapshotBindingDigest: reference("sha256Digest"),
    projectSnapshotDigest: reference("sha256Digest"),
    executableSnapshotDigest: reference("sha256Digest"),
    process: engineRunProcess,
    output: engineRunOutput,
    termination: engineRunTermination,
    effects: engineRunEffects,
    outcome: enumSchema(["succeeded", "failed", "uncertain"]),
    mutationUncertain: { type: "boolean" },
  },
  [
    "requestDigest",
    "reportDigest",
    "admissionDigest",
    "profileDigest",
    "snapshotBindingDigest",
    "projectSnapshotDigest",
    "executableSnapshotDigest",
    "process",
    "output",
    "termination",
    "effects",
    "outcome",
    "mutationUncertain",
  ],
);

const reportProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: "engine.headless-preflight" },
  controlPlaneVersion: reference("semanticVersion"),
  registryDigest: reference("sha256Digest"),
  runId: reference("uuid"),
  project,
  executable,
  targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
  targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
  versionProbe,
  mode: { const: "dynamic-main-scene" },
  frameBudget: { const: GODOT_HEADLESS_PREFLIGHT_FRAME_BUDGET },
  invocationDigest: { const: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST },
  containment: containmentBinding,
  status: enumSchema(["blocked", "succeeded", "failed", "uncertain"]),
  code,
  blockers: boundedArray(blocker, { minimum: 0, maximum: 2, unique: true }),
  preconditions,
  isolation,
  execution,
  authorization,
  engineRun,
  receipt,
  support,
  mutationPerformed: { type: "boolean" },
  externalProcessStarted: { type: "boolean" },
  networkAccessPerformed: { type: "boolean" },
  preflightDigest: reference("sha256Digest"),
} as const;

const reportRequired = Object.freeze(
  Object.keys(reportProperties).filter((name) => name !== "engineRun"),
);

export const godotHeadlessPreflightReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-headless-preflight-report",
    version: "1.0.0",
    title: "Godot Headless Preflight Report",
    description:
      "Retains a permission-bound receipt for either a fail-closed blocked admission or one path-free contained Godot startup result without promoting engine support.",
    schema: {
      ...contractRoot(reportProperties, reportRequired),
      allOf: [
        {
          if: {
            type: "object",
            properties: { status: { const: "blocked" } },
            required: ["status"],
          },
          then: { type: "object", properties: { engineRun: false } },
          else: { type: "object", required: ["engineRun"] },
        },
      ],
    },
  });
