import { isProxy } from "node:util/types";

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
  GODOT_PROJECT_IMPORT_INVOCATION_DIGEST,
  GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
  GODOT_PROJECT_VALIDATION_INVOCATION_DIGEST,
  GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  type GodotProjectValidationFailureCode,
} from "./godot-project-validation-contracts.js";
import {
  GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS,
  GODOT_VERSION_PROBE_TARGET_VERSION,
} from "./godot-version-probe-contracts.js";
import {
  GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
  GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
  PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  type ProcessContainmentEngineExecutionProfile,
} from "./process-containment-engine-execution-profile-contracts.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import {
  parseSemanticVersion,
  type SemanticVersion,
} from "./semantic-version.js";
import { isStableId, type StableId } from "./stable-id.js";

export const GODOT_PROJECT_VALIDATION_WORKFLOW_ID =
  "workflow.godot-project-validation" as const;
export const GODOT_PROJECT_IMPORT_COMMAND_ID = "engine.project-import" as const;
export const GODOT_PROJECT_VALIDATION_COMMAND_ID =
  "engine.project-validation" as const;
export const GODOT_PROJECT_IMPORT_STEP_ID =
  "step.godot-project-import" as const;
export const GODOT_PROJECT_VALIDATION_STEP_ID =
  "step.godot-project-validation" as const;

export type GodotProjectPhaseStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "uncertain";

export type GodotProjectImportReportCode =
  | "godot-project-import-passed"
  | "godot-project-import-process-failed"
  | "godot-project-import-cancelled"
  | "godot-project-import-uncertain";

export const GODOT_PROJECT_IMPORT_REPORT_CODES: readonly GodotProjectImportReportCode[] =
  Object.freeze([
    "godot-project-import-cancelled",
    "godot-project-import-passed",
    "godot-project-import-process-failed",
    "godot-project-import-uncertain",
  ] as const);

export type GodotProjectValidationOutputInvalidCode =
  | "godot-project-validation-output-byte-limit"
  | "godot-project-validation-output-event-count-invalid"
  | "godot-project-validation-output-event-sequence-invalid"
  | "godot-project-validation-output-event-shape-invalid"
  | "godot-project-validation-output-framing-invalid"
  | "godot-project-validation-output-identity-invalid"
  | "godot-project-validation-output-json-invalid"
  | "godot-project-validation-output-line-limit"
  | "godot-project-validation-output-prefix-invalid"
  | "godot-project-validation-exit-outcome-mismatch";

export const GODOT_PROJECT_VALIDATION_OUTPUT_INVALID_CODES: readonly GodotProjectValidationOutputInvalidCode[] =
  Object.freeze([
    "godot-project-validation-exit-outcome-mismatch",
    "godot-project-validation-output-byte-limit",
    "godot-project-validation-output-event-count-invalid",
    "godot-project-validation-output-event-sequence-invalid",
    "godot-project-validation-output-event-shape-invalid",
    "godot-project-validation-output-framing-invalid",
    "godot-project-validation-output-identity-invalid",
    "godot-project-validation-output-json-invalid",
    "godot-project-validation-output-line-limit",
    "godot-project-validation-output-prefix-invalid",
  ] as const);

export type GodotProjectValidationReportCode =
  | GodotProjectValidationOutputInvalidCode
  | `godot-project-validation-${GodotProjectValidationFailureCode}`
  | "godot-project-validation-passed"
  | "godot-project-validation-process-failed"
  | "godot-project-validation-cancelled"
  | "godot-project-validation-uncertain"
  | "godot-project-validation-transcript-unavailable";

export const GODOT_PROJECT_VALIDATION_REPORT_CODES: readonly GodotProjectValidationReportCode[] =
  Object.freeze([
    ...GODOT_PROJECT_VALIDATION_OUTPUT_INVALID_CODES,
    "godot-project-validation-cancelled",
    "godot-project-validation-main-scene-instantiate-failed",
    "godot-project-validation-main-scene-load-failed",
    "godot-project-validation-main-scene-missing",
    "godot-project-validation-main-scene-not-packed",
    "godot-project-validation-main-scene-path-invalid",
    "godot-project-validation-manifest-invalid",
    "godot-project-validation-manifest-missing",
    "godot-project-validation-passed",
    "godot-project-validation-process-failed",
    "godot-project-validation-project-identity-mismatch",
    "godot-project-validation-transcript-unavailable",
    "godot-project-validation-uncertain",
  ] as const);

export interface GodotProjectWorkflowBinding {
  readonly id: typeof GODOT_PROJECT_VALIDATION_WORKFLOW_ID;
  readonly version: "1.0.0";
  readonly resolvedPlanDigest: Sha256Digest;
  readonly stepId:
    | typeof GODOT_PROJECT_IMPORT_STEP_ID
    | typeof GODOT_PROJECT_VALIDATION_STEP_ID;
}

export interface GodotProjectReportProjectIdentity {
  readonly id: StableId;
  readonly identityDigest: Sha256Digest;
  readonly inspectionDigest: Sha256Digest;
  readonly sourceDigest: Sha256Digest;
  readonly sourceManifestDigest: Sha256Digest;
  readonly mainScene: "scenes/main.tscn";
}

export interface GodotProjectReportExecutableIdentity {
  readonly digest: Sha256Digest;
  readonly identityDigest: Sha256Digest;
}

export interface GodotProjectReportVersionProbe {
  readonly digest: Sha256Digest;
  readonly status: "matched";
  readonly exactTargetMatch: true;
}

export interface GodotProjectPhaseContainmentBinding {
  readonly admissionDigest: Sha256Digest;
  readonly runRequestDigest: Sha256Digest;
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly profileDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly decision: "qualified";
  readonly evidenceGrade: "locally-executed";
  readonly expiresAt: string;
}

export interface GodotProjectPhaseAuthorization {
  readonly authorizationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status:
    | "succeeded"
    | "failed"
    | "cancelled"
    | "uncertain"
    | "scope-violation";
  readonly mutationUncertain: boolean;
  readonly violations: readonly StableId[];
  readonly approvalIds: readonly StableId[];
  readonly durationMs: number;
  readonly outputBytes: number;
  readonly settledAt: string;
}

export interface GodotProjectPhaseReceiptPointer {
  readonly status: "retained";
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly chainLength: number;
}

export interface GodotProjectPhaseEngineRunEvidence {
  readonly requestDigest: Sha256Digest;
  readonly reportDigest: Sha256Digest;
  readonly admissionDigest: Sha256Digest;
  readonly profileId:
    | typeof GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.profileId
    | typeof GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.profileId;
  readonly profileDigest: Sha256Digest;
  readonly profileCatalogDigest: typeof PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST;
  readonly operationId:
    | typeof GODOT_PROJECT_IMPORT_COMMAND_ID
    | typeof GODOT_PROJECT_VALIDATION_COMMAND_ID;
  readonly invocationDigest: Sha256Digest;
  readonly inputBindingDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly process: {
    readonly started: boolean;
    readonly startedAt: string | null;
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
    readonly cause:
      | "none"
      | "engine-timeout"
      | "idle-timeout"
      | "caller-cancelled"
      | "safety-boundary";
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
  readonly outcome: GodotProjectPhaseStatus;
  readonly mutationUncertain: boolean;
}

export interface GodotProjectPhaseExecution {
  readonly processStarted: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
}

export interface GodotProjectSupportBoundary {
  readonly grade: "planned";
  readonly evidenceGrade: "locally-executed";
  readonly liveValidated: false;
  readonly reason: string;
}

interface GodotProjectPhaseReportBase {
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly runId: string;
  readonly workflow: GodotProjectWorkflowBinding;
  readonly project: GodotProjectReportProjectIdentity;
  readonly executable: GodotProjectReportExecutableIdentity;
  readonly targetVersion: typeof GODOT_VERSION_PROBE_TARGET_VERSION;
  readonly targetReleaseStatus: typeof GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS;
  readonly versionProbe: GodotProjectReportVersionProbe;
  readonly expectationDigest: Sha256Digest;
  readonly containment: GodotProjectPhaseContainmentBinding;
  readonly execution: GodotProjectPhaseExecution;
  readonly authorization: GodotProjectPhaseAuthorization;
  readonly engineRun: GodotProjectPhaseEngineRunEvidence;
  readonly receipt: GodotProjectPhaseReceiptPointer;
  readonly support: GodotProjectSupportBoundary;
  readonly mutationPerformed: boolean;
  readonly externalProcessStarted: boolean;
  readonly networkAccessPerformed: boolean;
}

export interface GodotProjectImportReportDigestInput
  extends GodotProjectPhaseReportBase {
  readonly status: GodotProjectPhaseStatus;
  readonly code: GodotProjectImportReportCode;
}

export interface GodotProjectImportReport
  extends GodotProjectImportReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: typeof GODOT_PROJECT_IMPORT_COMMAND_ID;
  readonly reportDigest: Sha256Digest;
}

export interface GodotProjectValidationValidatedTranscriptSummary {
  readonly status: "validated";
  readonly transcriptDigest: Sha256Digest;
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly eventCount: 2;
  readonly terminal: "validation-passed" | "validation-failed";
  readonly terminalCode: "passed" | GodotProjectValidationFailureCode;
  readonly rootType?: string;
}

export interface GodotProjectValidationRejectedTranscriptSummary {
  readonly status: "rejected";
  readonly outputDigest: Sha256Digest;
  readonly bytes: number;
  readonly code: GodotProjectValidationOutputInvalidCode;
}

export interface GodotProjectValidationUnavailableTranscriptSummary {
  readonly status: "unavailable";
}

export type GodotProjectValidationTranscriptSummary =
  | GodotProjectValidationValidatedTranscriptSummary
  | GodotProjectValidationRejectedTranscriptSummary
  | GodotProjectValidationUnavailableTranscriptSummary;

export interface GodotProjectImportPhasePointer {
  readonly reportDigest: Sha256Digest;
  readonly engineRunReportDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly sourceManifestDigest: Sha256Digest;
  readonly receiptId: string;
  readonly receiptDigest: Sha256Digest;
  readonly receiptHeadDigest: Sha256Digest;
  readonly receiptChainLength: number;
  readonly completedAt: string;
}

export interface GodotProjectValidationReportDigestInput
  extends GodotProjectPhaseReportBase {
  readonly importPhase: GodotProjectImportPhasePointer;
  readonly status: GodotProjectPhaseStatus;
  readonly code: GodotProjectValidationReportCode;
  readonly transcript: GodotProjectValidationTranscriptSummary;
}

export interface GodotProjectValidationReport
  extends GodotProjectValidationReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: typeof GODOT_PROJECT_VALIDATION_COMMAND_ID;
  readonly reportDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const phaseStatuses = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
  "uncertain",
] as const);
const terminationCauses = Object.freeze([
  "none",
  "engine-timeout",
  "idle-timeout",
  "caller-cancelled",
  "safety-boundary",
] as const);

function invalid(message: string): never {
  throw new TypeError(message);
}

function record(value: unknown): value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return false;
  }
  return Object.getOwnPropertyNames(value).every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return (
      descriptor !== undefined &&
      "value" in descriptor &&
      descriptor.enumerable === true
    );
  });
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const names = Object.keys(value);
  return (
    names.length === required.length &&
    required.every((name) => Object.hasOwn(value, name))
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
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

function semanticVersion(value: unknown): value is SemanticVersion {
  if (typeof value !== "string") return false;
  try {
    return parseSemanticVersion(value).value === value;
  } catch {
    return false;
  }
}

function stableIds(value: unknown, minimum: number, maximum: number): boolean {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length < minimum ||
    value.length > maximum ||
    Object.getOwnPropertyNames(value).length !== value.length + 1
  ) {
    return false;
  }
  const seen = new Set<string>();
  let previous: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true ||
      !isStableId(descriptor.value) ||
      seen.has(descriptor.value) ||
      (previous !== undefined && previous >= descriptor.value)
    ) {
      return false;
    }
    previous = descriptor.value;
    seen.add(descriptor.value);
  }
  return true;
}

function validateWorkflow(
  value: unknown,
  stepId:
    | typeof GODOT_PROJECT_IMPORT_STEP_ID
    | typeof GODOT_PROJECT_VALIDATION_STEP_ID,
): asserts value is GodotProjectWorkflowBinding {
  if (
    !record(value) ||
    !exactKeys(value, ["id", "resolvedPlanDigest", "stepId", "version"]) ||
    value["id"] !== GODOT_PROJECT_VALIDATION_WORKFLOW_ID ||
    value["version"] !== "1.0.0" ||
    value["stepId"] !== stepId ||
    !isSha256Digest(value["resolvedPlanDigest"])
  ) {
    invalid("Godot project workflow binding is invalid");
  }
}

function validateProject(
  value: unknown,
): asserts value is GodotProjectReportProjectIdentity {
  if (
    !record(value) ||
    !exactKeys(value, [
      "id",
      "identityDigest",
      "inspectionDigest",
      "mainScene",
      "sourceDigest",
      "sourceManifestDigest",
    ]) ||
    !isStableId(value["id"]) ||
    !isSha256Digest(value["identityDigest"]) ||
    !isSha256Digest(value["inspectionDigest"]) ||
    !isSha256Digest(value["sourceDigest"]) ||
    !isSha256Digest(value["sourceManifestDigest"]) ||
    value["mainScene"] !== "scenes/main.tscn"
  ) {
    invalid("Godot project report identity is invalid");
  }
}

function validateContainment(
  value: unknown,
  profile: ProcessContainmentEngineExecutionProfile,
): asserts value is GodotProjectPhaseContainmentBinding {
  if (
    !record(value) ||
    !exactKeys(value, [
      "admissionDigest",
      "decision",
      "evidenceGrade",
      "executableSnapshotDigest",
      "expiresAt",
      "policyDigest",
      "profileCatalogDigest",
      "profileDigest",
      "projectSnapshotDigest",
      "providerCatalogDigest",
      "providerDescriptorDigest",
      "runRequestDigest",
      "snapshotBindingDigest",
    ]) ||
    value["decision"] !== "qualified" ||
    value["evidenceGrade"] !== "locally-executed" ||
    value["policyDigest"] !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    value["profileCatalogDigest"] !==
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    value["profileDigest"] !== profile.profileDigest ||
    !timestamp(value["expiresAt"]) ||
    [
      value["admissionDigest"],
      value["executableSnapshotDigest"],
      value["projectSnapshotDigest"],
      value["providerCatalogDigest"],
      value["providerDescriptorDigest"],
      value["runRequestDigest"],
      value["snapshotBindingDigest"],
    ].some((entry) => !isSha256Digest(entry))
  ) {
    invalid("Godot project containment binding is invalid");
  }
}

function validateEngineRun(
  value: unknown,
  profile: ProcessContainmentEngineExecutionProfile,
  maxOutputBytes: number,
): asserts value is GodotProjectPhaseEngineRunEvidence {
  if (
    !record(value) ||
    !exactKeys(value, [
      "admissionDigest",
      "effects",
      "executableSnapshotDigest",
      "inputBindingDigest",
      "invocationDigest",
      "mutationUncertain",
      "operationId",
      "outcome",
      "output",
      "process",
      "profileCatalogDigest",
      "profileDigest",
      "profileId",
      "projectSnapshotDigest",
      "reportDigest",
      "requestDigest",
      "snapshotBindingDigest",
      "termination",
    ]) ||
    value["profileId"] !== profile.profileId ||
    value["profileDigest"] !== profile.profileDigest ||
    value["profileCatalogDigest"] !==
      PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST ||
    value["operationId"] !== profile.operationId ||
    value["invocationDigest"] !== profile.invocationDigest ||
    !phaseStatuses.includes(value["outcome"] as GodotProjectPhaseStatus) ||
    typeof value["mutationUncertain"] !== "boolean" ||
    [
      value["admissionDigest"],
      value["executableSnapshotDigest"],
      value["inputBindingDigest"],
      value["projectSnapshotDigest"],
      value["reportDigest"],
      value["requestDigest"],
      value["snapshotBindingDigest"],
    ].some((entry) => !isSha256Digest(entry))
  ) {
    invalid("Godot project engine run evidence is invalid");
  }
  const candidate = value as unknown as GodotProjectPhaseEngineRunEvidence;
  const process = candidate.process;
  const output = candidate.output;
  const termination = candidate.termination;
  const effects = candidate.effects;
  if (
    !record(process) ||
    !exactKeys(process, [
      "activeProcesses",
      "exitCode",
      "started",
      "startedAt",
      "totalProcesses",
    ]) ||
    typeof process.started !== "boolean" ||
    (process.startedAt !== null && !timestamp(process.startedAt)) ||
    process.started !== (process.startedAt !== null) ||
    (process.exitCode !== null &&
      !integer(process.exitCode, -2_147_483_648, 2_147_483_647)) ||
    (process.totalProcesses !== null &&
      !integer(process.totalProcesses, 0, 1_024)) ||
    (process.activeProcesses !== null &&
      !integer(process.activeProcesses, 0, 1_024)) ||
    !record(output) ||
    !exactKeys(output, [
      "capturedBytes",
      "logDigest",
      "observedBytes",
      "truncated",
    ]) ||
    !isSha256Digest(output.logDigest) ||
    !integer(output.capturedBytes, 0, maxOutputBytes) ||
    !integer(output.observedBytes, 0, 67_108_864) ||
    typeof output.truncated !== "boolean" ||
    output.capturedBytes > output.observedBytes ||
    output.truncated !== (output.observedBytes > output.capturedBytes) ||
    !record(termination) ||
    !exactKeys(termination, ["cause", "confirmed", "requested"]) ||
    typeof termination.requested !== "boolean" ||
    typeof termination.confirmed !== "boolean" ||
    !terminationCauses.includes(termination.cause) ||
    !record(effects) ||
    !exactKeys(effects, [
      "childProcessStarted",
      "cleanup",
      "networkConnectionEstablished",
      "profileBudgetPreserved",
      "sourceExecutablePreserved",
      "sourceProjectPreserved",
      "stagedExecutableBaselinePreserved",
      "stagedProjectBaselinePreserved",
    ]) ||
    [
      effects.childProcessStarted,
      effects.networkConnectionEstablished,
      effects.profileBudgetPreserved,
      effects.sourceExecutablePreserved,
      effects.sourceProjectPreserved,
      effects.stagedExecutableBaselinePreserved,
      effects.stagedProjectBaselinePreserved,
    ].some((entry) => typeof entry !== "boolean") ||
    (effects.cleanup !== "complete" &&
      effects.cleanup !== "incomplete" &&
      effects.cleanup !== "uncertain")
  ) {
    invalid("Godot project engine run evidence is invalid");
  }
  const processInvalid =
    (process.totalProcesses === null) !== (process.activeProcesses === null) ||
    (process.totalProcesses !== null &&
      process.activeProcesses !== null &&
      process.activeProcesses > process.totalProcesses) ||
    (!process.started &&
      (process.exitCode !== null ||
        process.totalProcesses !== 0 ||
        process.activeProcesses !== 0));
  const safeEffects =
    effects.sourceProjectPreserved &&
    effects.sourceExecutablePreserved &&
    effects.stagedProjectBaselinePreserved &&
    effects.stagedExecutableBaselinePreserved &&
    effects.profileBudgetPreserved &&
    !effects.networkConnectionEstablished &&
    !effects.childProcessStarted &&
    effects.cleanup === "complete" &&
    process.activeProcesses === 0;
  const success =
    process.started &&
    process.exitCode === 0 &&
    process.totalProcesses === 1 &&
    !output.truncated &&
    !termination.requested &&
    termination.confirmed &&
    termination.cause === "none" &&
    safeEffects;
  const cancelled =
    termination.cause === "caller-cancelled" &&
    termination.confirmed &&
    !output.truncated &&
    safeEffects;
  const uncertaintySignal =
    !effects.sourceProjectPreserved ||
    !effects.sourceExecutablePreserved ||
    effects.networkConnectionEstablished ||
    effects.childProcessStarted ||
    effects.cleanup !== "complete" ||
    (process.started && !termination.confirmed) ||
    (process.started && process.exitCode === null) ||
    (process.started && process.totalProcesses === null) ||
    (process.totalProcesses !== null &&
      process.totalProcesses > profile.limits.maxProcesses) ||
    (process.activeProcesses !== null && process.activeProcesses > 0);
  const failureSignal =
    !process.started ||
    process.exitCode !== 0 ||
    output.truncated ||
    !effects.stagedProjectBaselinePreserved ||
    !effects.stagedExecutableBaselinePreserved ||
    !effects.profileBudgetPreserved ||
    termination.cause === "engine-timeout" ||
    termination.cause === "idle-timeout" ||
    termination.cause === "safety-boundary";
  if (
    processInvalid ||
    (candidate.outcome === "succeeded" &&
      (!success || candidate.mutationUncertain)) ||
    (candidate.outcome === "failed" &&
      (!failureSignal ||
        cancelled ||
        uncertaintySignal ||
        candidate.mutationUncertain)) ||
    (candidate.outcome === "cancelled" &&
      (!cancelled || candidate.mutationUncertain)) ||
    (candidate.outcome === "uncertain" &&
      (!uncertaintySignal || !candidate.mutationUncertain))
  ) {
    invalid("Godot project engine run evidence is contradictory");
  }
}

function validateAuthorization(
  value: unknown,
  execution: GodotProjectPhaseExecution,
  outputBytes: number,
  maximumOutputBytes: number,
): asserts value is GodotProjectPhaseAuthorization {
  if (
    !record(value) ||
    !exactKeys(value, [
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
    !uuidPattern.test(String(value["authorizationId"])) ||
    !isSha256Digest(value["requestDigest"]) ||
    ![
      "succeeded",
      "failed",
      "cancelled",
      "uncertain",
      "scope-violation",
    ].includes(String(value["status"])) ||
    typeof value["mutationUncertain"] !== "boolean" ||
    !stableIds(value["violations"], 0, 32) ||
    !stableIds(value["approvalIds"], 1, 128) ||
    value["durationMs"] !== execution.durationMs ||
    value["outputBytes"] !== outputBytes ||
    !integer(value["outputBytes"], 0, maximumOutputBytes) ||
    !timestamp(value["settledAt"]) ||
    Date.parse(value["settledAt"]) < Date.parse(execution.endedAt)
  ) {
    invalid("Godot project authorization settlement is invalid");
  }
}

function validateReceipt(
  value: unknown,
): asserts value is GodotProjectPhaseReceiptPointer {
  if (
    !record(value) ||
    !exactKeys(value, [
      "chainLength",
      "headDigest",
      "receiptDigest",
      "receiptId",
      "status",
    ]) ||
    value["status"] !== "retained" ||
    !uuidPattern.test(String(value["receiptId"])) ||
    !isSha256Digest(value["receiptDigest"]) ||
    !isSha256Digest(value["headDigest"]) ||
    !integer(value["chainLength"], 1, 4_096)
  ) {
    invalid("Godot project receipt pointer is invalid");
  }
}

interface PhaseValidationOptions {
  readonly stepId:
    | typeof GODOT_PROJECT_IMPORT_STEP_ID
    | typeof GODOT_PROJECT_VALIDATION_STEP_ID;
  readonly profile: ProcessContainmentEngineExecutionProfile;
  readonly maxOutputBytes: number;
}

function validatePhaseBase(
  input: GodotProjectPhaseReportBase,
  options: PhaseValidationOptions,
): void {
  if (
    !record(input) ||
    !uuidPattern.test(input.runId) ||
    !semanticVersion(input.controlPlaneVersion) ||
    !isSha256Digest(input.registryDigest) ||
    input.targetVersion !== GODOT_VERSION_PROBE_TARGET_VERSION ||
    input.targetReleaseStatus !== GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS ||
    !isSha256Digest(input.expectationDigest)
  ) {
    invalid("Godot project report base identity is invalid");
  }
  validateWorkflow(input.workflow, options.stepId);
  validateProject(input.project);
  if (
    !record(input.executable) ||
    !exactKeys(input.executable, ["digest", "identityDigest"]) ||
    !isSha256Digest(input.executable.digest) ||
    !isSha256Digest(input.executable.identityDigest) ||
    !record(input.versionProbe) ||
    !exactKeys(input.versionProbe, ["digest", "exactTargetMatch", "status"]) ||
    !isSha256Digest(input.versionProbe.digest) ||
    input.versionProbe.status !== "matched" ||
    input.versionProbe.exactTargetMatch !== true
  ) {
    invalid("Godot project executable or version identity is invalid");
  }
  validateContainment(input.containment, options.profile);
  validateEngineRun(input.engineRun, options.profile, options.maxOutputBytes);
  if (
    !record(input.execution) ||
    !exactKeys(input.execution, [
      "durationMs",
      "endedAt",
      "processStarted",
      "startedAt",
    ]) ||
    typeof input.execution.processStarted !== "boolean" ||
    !timestamp(input.execution.startedAt) ||
    !timestamp(input.execution.endedAt) ||
    Date.parse(input.execution.endedAt) < Date.parse(input.execution.startedAt) ||
    Date.parse(input.execution.endedAt) -
      Date.parse(input.execution.startedAt) !==
      input.execution.durationMs ||
    !integer(
      input.execution.durationMs,
      0,
      options.profile.limits.maxReportDurationMs,
    ) ||
    Date.parse(input.execution.startedAt) >
      Date.parse(input.containment.expiresAt)
  ) {
    invalid("Godot project execution timing is invalid");
  }
  validateAuthorization(
    input.authorization,
    input.execution,
    input.engineRun.output.capturedBytes,
    options.maxOutputBytes,
  );
  validateReceipt(input.receipt);
  if (
    input.execution.processStarted !== input.engineRun.process.started ||
    input.externalProcessStarted !== input.engineRun.process.started ||
    input.networkAccessPerformed !==
      input.engineRun.effects.networkConnectionEstablished ||
    input.mutationPerformed !==
      (!input.engineRun.effects.sourceProjectPreserved ||
        !input.engineRun.effects.sourceExecutablePreserved) ||
    input.engineRun.inputBindingDigest !== input.expectationDigest ||
    input.engineRun.requestDigest !== input.containment.runRequestDigest ||
    input.engineRun.admissionDigest !== input.containment.admissionDigest ||
    input.engineRun.profileDigest !== input.containment.profileDigest ||
    input.engineRun.snapshotBindingDigest !==
      input.containment.snapshotBindingDigest ||
    input.engineRun.projectSnapshotDigest !==
      input.containment.projectSnapshotDigest ||
    input.engineRun.executableSnapshotDigest !==
      input.containment.executableSnapshotDigest ||
    (input.engineRun.mutationUncertain &&
      !input.authorization.mutationUncertain) ||
    (input.authorization.status === "scope-violation") !==
      (input.authorization.violations.length > 0) ||
    !record(input.support) ||
    !exactKeys(input.support, [
      "evidenceGrade",
      "grade",
      "liveValidated",
      "reason",
    ]) ||
    input.support.grade !== "planned" ||
    input.support.evidenceGrade !== "locally-executed" ||
    input.support.liveValidated !== false ||
    typeof input.support.reason !== "string" ||
    input.support.reason.length < 1 ||
    input.support.reason.length > 500
  ) {
    invalid("Godot project report base is contradictory");
  }
}

function expectedImportOutcome(
  engineRun: GodotProjectPhaseEngineRunEvidence,
): {
  readonly status: GodotProjectPhaseStatus;
  readonly code: GodotProjectImportReportCode;
} {
  if (engineRun.outcome === "succeeded") {
    return { status: "succeeded", code: "godot-project-import-passed" };
  }
  if (engineRun.outcome === "cancelled") {
    return { status: "cancelled", code: "godot-project-import-cancelled" };
  }
  if (engineRun.outcome === "uncertain") {
    return { status: "uncertain", code: "godot-project-import-uncertain" };
  }
  return { status: "failed", code: "godot-project-import-process-failed" };
}

function applyAuthorizationOutcome<Code extends string>(
  observed: {
    readonly status: GodotProjectPhaseStatus;
    readonly code: Code;
  },
  authorization: GodotProjectPhaseAuthorization,
  uncertainCode: Code,
): { readonly status: GodotProjectPhaseStatus; readonly code: Code } {
  if (
    authorization.status === "uncertain" ||
    authorization.status === "scope-violation"
  ) {
    return { status: "uncertain", code: uncertainCode };
  }
  return observed;
}

function validateImportInput(input: GodotProjectImportReportDigestInput): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "authorization",
      "code",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "expectationDigest",
      "externalProcessStarted",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
      "workflow",
    ]) ||
    !GODOT_PROJECT_IMPORT_REPORT_CODES.includes(input.code) ||
    !phaseStatuses.includes(input.status)
  ) {
    invalid("Godot project import report is outside the contract");
  }
  validatePhaseBase(input, {
    stepId: GODOT_PROJECT_IMPORT_STEP_ID,
    profile: GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    maxOutputBytes: GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
  });
  const expected = applyAuthorizationOutcome(
    expectedImportOutcome(input.engineRun),
    input.authorization,
    "godot-project-import-uncertain",
  );
  if (
    input.status !== expected.status ||
    input.code !== expected.code ||
    input.receipt.chainLength !== 1 ||
    (expected.status === "uncertain" &&
      !input.authorization.mutationUncertain) ||
    (expected.status !== "uncertain" &&
      input.authorization.status !== expected.status)
  ) {
    invalid("Godot project import outcome is contradictory");
  }
}

function validateTranscript(
  value: unknown,
): asserts value is GodotProjectValidationTranscriptSummary {
  if (!record(value) || typeof value["status"] !== "string") {
    invalid("Godot project validation transcript summary is invalid");
  }
  if (value["status"] === "unavailable") {
    if (!exactKeys(value, ["status"])) {
      invalid("Godot project validation unavailable transcript is invalid");
    }
    return;
  }
  if (value["status"] === "rejected") {
    if (
      !exactKeys(value, ["bytes", "code", "outputDigest", "status"]) ||
      !isSha256Digest(value["outputDigest"]) ||
      !integer(
        value["bytes"],
        1,
        GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
      ) ||
      !GODOT_PROJECT_VALIDATION_OUTPUT_INVALID_CODES.includes(
        value["code"] as GodotProjectValidationOutputInvalidCode,
      )
    ) {
      invalid("Godot project validation rejected transcript is invalid");
    }
    return;
  }
  if (
    value["status"] !== "validated" ||
    !isSha256Digest(value["transcriptDigest"]) ||
    !isSha256Digest(value["outputDigest"]) ||
    !integer(value["bytes"], 1, GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES) ||
    value["eventCount"] !== 2 ||
    (value["terminal"] !== "validation-passed" &&
      value["terminal"] !== "validation-failed")
  ) {
    invalid("Godot project validation transcript is invalid");
  }
  if (value["terminal"] === "validation-passed") {
    if (
      !exactKeys(value, [
        "bytes",
        "eventCount",
        "outputDigest",
        "rootType",
        "status",
        "terminal",
        "terminalCode",
        "transcriptDigest",
      ]) ||
      value["terminalCode"] !== "passed" ||
      typeof value["rootType"] !== "string" ||
      value["rootType"].length < 1 ||
      value["rootType"].length > 128
    ) {
      invalid("Godot project validation pass transcript is invalid");
    }
    return;
  }
  if (
    !exactKeys(value, [
      "bytes",
      "eventCount",
      "outputDigest",
      "status",
      "terminal",
      "terminalCode",
      "transcriptDigest",
    ]) ||
    ![
      "main-scene-instantiate-failed",
      "main-scene-load-failed",
      "main-scene-missing",
      "main-scene-not-packed",
      "main-scene-path-invalid",
      "manifest-invalid",
      "manifest-missing",
      "project-identity-mismatch",
    ].includes(String(value["terminalCode"]))
  ) {
    invalid("Godot project validation failure transcript is invalid");
  }
}

function expectedValidationOutcome(
  transcript: GodotProjectValidationTranscriptSummary,
  engineRun: GodotProjectPhaseEngineRunEvidence,
): {
  readonly status: GodotProjectPhaseStatus;
  readonly code: GodotProjectValidationReportCode;
} {
  if (transcript.status === "validated") {
    return transcript.terminal === "validation-passed"
      ? { status: "succeeded", code: "godot-project-validation-passed" }
      : {
          status: "failed",
          code: `godot-project-validation-${transcript.terminalCode}`,
        };
  }
  if (transcript.status === "rejected") {
    return { status: "failed", code: transcript.code };
  }
  if (engineRun.outcome === "cancelled") {
    return {
      status: "cancelled",
      code: "godot-project-validation-cancelled",
    };
  }
  if (engineRun.outcome === "uncertain") {
    return {
      status: "uncertain",
      code: "godot-project-validation-uncertain",
    };
  }
  if (engineRun.outcome === "succeeded") {
    return {
      status: "uncertain",
      code: "godot-project-validation-transcript-unavailable",
    };
  }
  return {
    status: "failed",
    code: "godot-project-validation-process-failed",
  };
}

function validateImportPointer(
  value: unknown,
): asserts value is GodotProjectImportPhasePointer {
  if (
    !record(value) ||
    !exactKeys(value, [
      "completedAt",
      "engineRunReportDigest",
      "projectSnapshotDigest",
      "receiptChainLength",
      "receiptDigest",
      "receiptHeadDigest",
      "receiptId",
      "reportDigest",
      "sourceManifestDigest",
    ]) ||
    !timestamp(value["completedAt"]) ||
    !uuidPattern.test(String(value["receiptId"])) ||
    !integer(value["receiptChainLength"], 1, 4_095) ||
    [
      value["engineRunReportDigest"],
      value["projectSnapshotDigest"],
      value["receiptDigest"],
      value["receiptHeadDigest"],
      value["reportDigest"],
      value["sourceManifestDigest"],
    ].some((entry) => !isSha256Digest(entry))
  ) {
    invalid("Godot project import phase pointer is invalid");
  }
}

function validateValidationInput(
  input: GodotProjectValidationReportDigestInput,
): void {
  if (
    !record(input) ||
    !exactKeys(input, [
      "authorization",
      "code",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "expectationDigest",
      "externalProcessStarted",
      "importPhase",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "runId",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "transcript",
      "versionProbe",
      "workflow",
    ]) ||
    !GODOT_PROJECT_VALIDATION_REPORT_CODES.includes(input.code) ||
    !phaseStatuses.includes(input.status)
  ) {
    invalid("Godot project validation report is outside the contract");
  }
  validatePhaseBase(input, {
    stepId: GODOT_PROJECT_VALIDATION_STEP_ID,
    profile: GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    maxOutputBytes: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  });
  validateTranscript(input.transcript);
  validateImportPointer(input.importPhase);
  const observed = expectedValidationOutcome(input.transcript, input.engineRun);
  const expected = applyAuthorizationOutcome(
    observed,
    input.authorization,
    "godot-project-validation-uncertain",
  );
  const transcriptDigestMatches =
    input.transcript.status === "unavailable" ||
    input.transcript.outputDigest === input.engineRun.output.logDigest;
  const transcriptOutcomeMatches =
    input.transcript.status !== "validated" ||
    (input.transcript.terminal === "validation-passed"
      ? input.engineRun.outcome === "succeeded" &&
        input.engineRun.process.exitCode === 0
      : input.engineRun.outcome === "failed" &&
        input.engineRun.process.exitCode === 2);
  if (
    input.status !== expected.status ||
    input.code !== expected.code ||
    input.project.sourceManifestDigest !==
      input.importPhase.sourceManifestDigest ||
    input.importPhase.receiptChainLength !== 1 ||
    input.receipt.chainLength !== 2 ||
    input.receipt.chainLength !==
      input.importPhase.receiptChainLength + 1 ||
    input.receipt.headDigest === input.importPhase.receiptHeadDigest ||
    Date.parse(input.execution.startedAt) <
      Date.parse(input.importPhase.completedAt) ||
    !transcriptDigestMatches ||
    !transcriptOutcomeMatches ||
    (expected.status === "uncertain" &&
      !input.authorization.mutationUncertain) ||
    (expected.status !== "uncertain" &&
      input.authorization.status !== expected.status)
  ) {
    invalid("Godot project validation outcome is contradictory");
  }
}

export function computeGodotProjectImportReportDigest(
  input: GodotProjectImportReportDigestInput,
): Sha256Digest {
  validateImportInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-import-report",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotProjectImportReportSemantics(
  value: unknown,
): asserts value is GodotProjectImportReport {
  if (
    !record(value) ||
    !exactKeys(value, [
      "authorization",
      "code",
      "commandId",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "expectationDigest",
      "externalProcessStarted",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "reportDigest",
      "runId",
      "schemaVersion",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "versionProbe",
      "workflow",
    ])
  ) {
    invalid("Godot project import report is outside the contract");
  }
  const report = value as unknown as GodotProjectImportReport;
  if (
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== GODOT_PROJECT_IMPORT_COMMAND_ID ||
    !isSha256Digest(report.reportDigest)
  ) {
    invalid("Godot project import report identity is invalid");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    reportDigest,
    ...input
  } = report;
  if (
    computeGodotProjectImportReportDigest(input) !== reportDigest
  ) {
    invalid("Godot project import report digest is invalid");
  }
}

export function computeGodotProjectValidationReportDigest(
  input: GodotProjectValidationReportDigestInput,
): Sha256Digest {
  validateValidationInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-project-validation-report",
    version: "1.0.0",
    ...input,
  });
}

export function assertGodotProjectValidationReportSemantics(
  value: unknown,
): asserts value is GodotProjectValidationReport {
  if (
    !record(value) ||
    !exactKeys(value, [
      "authorization",
      "code",
      "commandId",
      "containment",
      "controlPlaneVersion",
      "engineRun",
      "executable",
      "execution",
      "expectationDigest",
      "externalProcessStarted",
      "importPhase",
      "mutationPerformed",
      "networkAccessPerformed",
      "project",
      "receipt",
      "registryDigest",
      "reportDigest",
      "runId",
      "schemaVersion",
      "status",
      "support",
      "targetReleaseStatus",
      "targetVersion",
      "transcript",
      "versionProbe",
      "workflow",
    ])
  ) {
    invalid("Godot project validation report is outside the contract");
  }
  const report = value as unknown as GodotProjectValidationReport;
  if (
    report.schemaVersion !== "1.0.0" ||
    report.commandId !== GODOT_PROJECT_VALIDATION_COMMAND_ID ||
    !isSha256Digest(report.reportDigest)
  ) {
    invalid("Godot project validation report identity is invalid");
  }
  const {
    schemaVersion: _schemaVersion,
    commandId: _commandId,
    reportDigest,
    ...input
  } = report;
  if (
    computeGodotProjectValidationReportDigest(input) !== reportDigest
  ) {
    invalid("Godot project validation report digest is invalid");
  }
}

const digestFields = (names: readonly string[]) =>
  Object.fromEntries(
    names.map((name) => [name, reference("sha256Digest")]),
  ) as Record<string, ReturnType<typeof reference>>;
const nullableInteger = (minimum: number, maximum: number) => ({
  anyOf: [{ type: "integer", minimum, maximum }, { type: "null" }],
});

function containmentSchema(profile: ProcessContainmentEngineExecutionProfile) {
  return closedObject(
    {
      ...digestFields([
        "admissionDigest",
        "runRequestDigest",
        "providerDescriptorDigest",
        "providerCatalogDigest",
        "snapshotBindingDigest",
        "projectSnapshotDigest",
        "executableSnapshotDigest",
      ]),
      policyDigest: { const: PROCESS_CONTAINMENT_POLICY_DIGEST },
      profileDigest: { const: profile.profileDigest },
      profileCatalogDigest: {
        const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      },
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
      "profileCatalogDigest",
      "snapshotBindingDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "decision",
      "evidenceGrade",
      "expiresAt",
    ],
  );
}

function engineRunSchema(
  profile: ProcessContainmentEngineExecutionProfile,
  maxOutputBytes: number,
) {
  return closedObject(
    {
      ...digestFields([
        "requestDigest",
        "reportDigest",
        "admissionDigest",
        "profileDigest",
        "inputBindingDigest",
        "snapshotBindingDigest",
        "projectSnapshotDigest",
        "executableSnapshotDigest",
      ]),
      profileId: { const: profile.profileId },
      profileCatalogDigest: {
        const: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
      },
      operationId: { const: profile.operationId },
      invocationDigest: { const: profile.invocationDigest },
      process: closedObject(
        {
          started: { type: "boolean" },
          startedAt: { anyOf: [reference("timestamp"), { type: "null" }] },
          exitCode: nullableInteger(-2_147_483_648, 2_147_483_647),
          totalProcesses: nullableInteger(0, 1_024),
          activeProcesses: nullableInteger(0, 1_024),
        },
        [
          "started",
          "startedAt",
          "exitCode",
          "totalProcesses",
          "activeProcesses",
        ],
      ),
      output: closedObject(
        {
          logDigest: reference("sha256Digest"),
          capturedBytes: {
            type: "integer",
            minimum: 0,
            maximum: maxOutputBytes,
          },
          observedBytes: {
            type: "integer",
            minimum: 0,
            maximum: 67_108_864,
          },
          truncated: { type: "boolean" },
        },
        ["logDigest", "capturedBytes", "observedBytes", "truncated"],
      ),
      termination: closedObject(
        {
          requested: { type: "boolean" },
          confirmed: { type: "boolean" },
          cause: enumSchema(terminationCauses),
        },
        ["requested", "confirmed", "cause"],
      ),
      effects: closedObject(
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
      ),
      outcome: enumSchema(phaseStatuses),
      mutationUncertain: { type: "boolean" },
    },
    [
      "requestDigest",
      "reportDigest",
      "admissionDigest",
      "profileId",
      "profileDigest",
      "profileCatalogDigest",
      "operationId",
      "invocationDigest",
      "inputBindingDigest",
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
}

function authorizationSchema(maxOutputBytes: number) {
  return closedObject(
    {
      authorizationId: reference("uuid"),
      requestDigest: reference("sha256Digest"),
      status: enumSchema([
        "succeeded",
        "failed",
        "cancelled",
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
      durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
      outputBytes: {
        type: "integer",
        minimum: 0,
        maximum: maxOutputBytes,
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
}

const receiptSchema = closedObject(
  {
    status: { const: "retained" },
    receiptId: reference("uuid"),
    receiptDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    chainLength: { type: "integer", minimum: 1, maximum: 4_096 },
  },
  ["status", "receiptId", "receiptDigest", "headDigest", "chainLength"],
);

function phaseProperties(
  stepId:
    | typeof GODOT_PROJECT_IMPORT_STEP_ID
    | typeof GODOT_PROJECT_VALIDATION_STEP_ID,
  profile: ProcessContainmentEngineExecutionProfile,
  maxOutputBytes: number,
) {
  return {
    controlPlaneVersion: reference("semanticVersion"),
    registryDigest: reference("sha256Digest"),
    runId: reference("uuid"),
    workflow: closedObject(
      {
        id: { const: GODOT_PROJECT_VALIDATION_WORKFLOW_ID },
        version: { const: "1.0.0" },
        resolvedPlanDigest: reference("sha256Digest"),
        stepId: { const: stepId },
      },
      ["id", "version", "resolvedPlanDigest", "stepId"],
    ),
    project: closedObject(
      {
        id: reference("stableId"),
        identityDigest: reference("sha256Digest"),
        inspectionDigest: reference("sha256Digest"),
        sourceDigest: reference("sha256Digest"),
        sourceManifestDigest: reference("sha256Digest"),
        mainScene: { const: "scenes/main.tscn" },
      },
      [
        "id",
        "identityDigest",
        "inspectionDigest",
        "sourceDigest",
        "sourceManifestDigest",
        "mainScene",
      ],
    ),
    executable: closedObject(
      {
        digest: reference("sha256Digest"),
        identityDigest: reference("sha256Digest"),
      },
      ["digest", "identityDigest"],
    ),
    targetVersion: { const: GODOT_VERSION_PROBE_TARGET_VERSION },
    targetReleaseStatus: { const: GODOT_VERSION_PROBE_TARGET_RELEASE_STATUS },
    versionProbe: closedObject(
      {
        digest: reference("sha256Digest"),
        status: { const: "matched" },
        exactTargetMatch: { const: true },
      },
      ["digest", "status", "exactTargetMatch"],
    ),
    expectationDigest: reference("sha256Digest"),
    containment: containmentSchema(profile),
    execution: closedObject(
      {
        processStarted: { type: "boolean" },
        startedAt: reference("timestamp"),
        endedAt: reference("timestamp"),
        durationMs: { type: "integer", minimum: 0, maximum: 604_800_000 },
      },
      ["processStarted", "startedAt", "endedAt", "durationMs"],
    ),
    authorization: authorizationSchema(maxOutputBytes),
    engineRun: engineRunSchema(profile, maxOutputBytes),
    receipt: receiptSchema,
    support: closedObject(
      {
        grade: { const: "planned" },
        evidenceGrade: { const: "locally-executed" },
        liveValidated: { const: false },
        reason: textSchema(500),
      },
      ["grade", "evidenceGrade", "liveValidated", "reason"],
    ),
    mutationPerformed: { type: "boolean" },
    externalProcessStarted: { type: "boolean" },
    networkAccessPerformed: { type: "boolean" },
  } as const;
}

const importProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: GODOT_PROJECT_IMPORT_COMMAND_ID },
  ...phaseProperties(
    GODOT_PROJECT_IMPORT_STEP_ID,
    GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    GODOT_PROJECT_IMPORT_MAX_OUTPUT_BYTES,
  ),
  status: enumSchema(phaseStatuses),
  code: enumSchema(GODOT_PROJECT_IMPORT_REPORT_CODES),
  reportDigest: reference("sha256Digest"),
} as const;

export const godotProjectImportReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-project-import-report",
    version: "1.0.0",
    title: "Godot Project Import Report",
    description:
      "Retains one permission-bound, path-free contained Godot import phase and its durable receipt without promoting engine support.",
    schema: contractRoot(importProperties, Object.keys(importProperties)),
  });

const validationTranscriptSchema = {
  oneOf: [
    closedObject({ status: { const: "unavailable" } }, ["status"]),
    closedObject(
      {
        status: { const: "rejected" },
        outputDigest: reference("sha256Digest"),
        bytes: {
          type: "integer",
          minimum: 1,
          maximum: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
        },
        code: enumSchema(GODOT_PROJECT_VALIDATION_OUTPUT_INVALID_CODES),
      },
      ["status", "outputDigest", "bytes", "code"],
    ),
    closedObject(
      {
        status: { const: "validated" },
        transcriptDigest: reference("sha256Digest"),
        outputDigest: reference("sha256Digest"),
        bytes: {
          type: "integer",
          minimum: 1,
          maximum: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
        },
        eventCount: { const: 2 },
        terminal: { const: "validation-passed" },
        terminalCode: { const: "passed" },
        rootType: textSchema(128),
      },
      [
        "status",
        "transcriptDigest",
        "outputDigest",
        "bytes",
        "eventCount",
        "terminal",
        "terminalCode",
        "rootType",
      ],
    ),
    closedObject(
      {
        status: { const: "validated" },
        transcriptDigest: reference("sha256Digest"),
        outputDigest: reference("sha256Digest"),
        bytes: {
          type: "integer",
          minimum: 1,
          maximum: GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
        },
        eventCount: { const: 2 },
        terminal: { const: "validation-failed" },
        terminalCode: enumSchema([
          "main-scene-instantiate-failed",
          "main-scene-load-failed",
          "main-scene-missing",
          "main-scene-not-packed",
          "main-scene-path-invalid",
          "manifest-invalid",
          "manifest-missing",
          "project-identity-mismatch",
        ]),
      },
      [
        "status",
        "transcriptDigest",
        "outputDigest",
        "bytes",
        "eventCount",
        "terminal",
        "terminalCode",
      ],
    ),
  ],
};

const validationProperties = {
  schemaVersion: { const: "1.0.0" },
  commandId: { const: GODOT_PROJECT_VALIDATION_COMMAND_ID },
  ...phaseProperties(
    GODOT_PROJECT_VALIDATION_STEP_ID,
    GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    GODOT_PROJECT_VALIDATION_MAX_OUTPUT_BYTES,
  ),
  importPhase: closedObject(
    {
      reportDigest: reference("sha256Digest"),
      engineRunReportDigest: reference("sha256Digest"),
      projectSnapshotDigest: reference("sha256Digest"),
      sourceManifestDigest: reference("sha256Digest"),
      receiptId: reference("uuid"),
      receiptDigest: reference("sha256Digest"),
      receiptHeadDigest: reference("sha256Digest"),
      receiptChainLength: {
        type: "integer",
        minimum: 1,
        maximum: 4_095,
      },
      completedAt: reference("timestamp"),
    },
    [
      "reportDigest",
      "engineRunReportDigest",
      "projectSnapshotDigest",
      "sourceManifestDigest",
      "receiptId",
      "receiptDigest",
      "receiptHeadDigest",
      "receiptChainLength",
      "completedAt",
    ],
  ),
  status: enumSchema(phaseStatuses),
  code: enumSchema(GODOT_PROJECT_VALIDATION_REPORT_CODES),
  transcript: validationTranscriptSchema,
  reportDigest: reference("sha256Digest"),
} as const;

export const godotProjectValidationReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "godot-project-validation-report",
    version: "1.0.0",
    title: "Godot Project Validation Report",
    description:
      "Retains one permission-bound Godot scene validation phase only after an attested successful import predecessor, without retaining raw paths or output.",
    schema: contractRoot(
      validationProperties,
      Object.keys(validationProperties),
    ),
  });
