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
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";
import type {
  WorkflowCheckpointSideEffect,
  WorkflowCheckpointStatus,
} from "./workflow-checkpoint-contracts.js";
import type { ProjectStage } from "./contract-vocabulary.js";

export const PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID =
  "project.initialization-recovery.assess" as const;
export const PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES = 64;
export const PROJECT_INITIALIZATION_RECOVERY_MAX_ISSUES = 64;

export type ProjectInitializationRecoveryStatus =
  | "clear"
  | "attention"
  | "recovery-required"
  | "blocked";
export type ProjectInitializationRecoveryDisposition =
  | "terminal"
  | "authorization-abandoned"
  | "restart-recovery-required"
  | "reconciliation-required"
  | "authority-stale"
  | "corrupt";
export const PROJECT_INITIALIZATION_RECOVERY_STATUSES: readonly ProjectInitializationRecoveryStatus[] =
  Object.freeze(["clear", "attention", "recovery-required", "blocked"]);
export const PROJECT_INITIALIZATION_RECOVERY_DISPOSITIONS: readonly ProjectInitializationRecoveryDisposition[] =
  Object.freeze([
    "terminal",
    "authorization-abandoned",
    "restart-recovery-required",
    "reconciliation-required",
    "authority-stale",
    "corrupt",
  ]);
export type ProjectInitializationRecoveryValidationLevel =
  | "head-and-latest-record-presence"
  | "selected-full-chain";
export type ProjectInitializationRecoveryStoreStatus =
  | "missing"
  | "present"
  | "invalid";
export type ProjectInitializationRecoveryControlStateStatus =
  | "absent"
  | "initialized"
  | "tracked"
  | "partial-untracked";
export type ProjectInitializationRecoverySelectionStatus =
  | "not-requested"
  | "not-found"
  | "assessed"
  | "blocked";
export type ProjectInitializationRecoveryReceiptStatus =
  | "not-declared"
  | "missing"
  | "verified"
  | "uncertain"
  | "contradictory";

export interface ProjectInitializationRecoveryRequest {
  readonly schemaVersion: "1.0.0";
  readonly projectRoot: string;
  readonly runId?: string;
}

export interface ProjectInitializationRecoveryCandidate {
  readonly validationLevel: "head-and-latest-record-presence";
  readonly runId: string;
  readonly checkpointId: string;
  readonly sequence: number;
  readonly checkpointDigest: Sha256Digest;
  readonly headDigest: Sha256Digest;
  readonly status: WorkflowCheckpointStatus;
  readonly disposition: ProjectInitializationRecoveryDisposition;
  readonly actionCode: StableId;
  readonly projectId: StableId;
  readonly projectIdentityDigest: Sha256Digest;
  readonly projectRootIdentityDigest?: Sha256Digest;
  readonly projectAuthority: "current" | "foreign" | "unbound";
  readonly projectStage: ProjectStage;
  readonly registryDigest: Sha256Digest;
  readonly registryAuthority: "current" | "stale";
  readonly workflowId: "workflow.project-initialization";
  readonly workflowVersion: string;
  readonly resolvedPlanDigest: Sha256Digest;
  readonly inputDigest: Sha256Digest;
  readonly receiptChainHead?: Sha256Digest;
  readonly inFlight?: {
    readonly phase: "command" | "rollback";
    readonly sideEffect: WorkflowCheckpointSideEffect;
  };
  readonly updatedAt: string;
}

export interface ProjectInitializationRecoveryIssue {
  readonly severity: "attention" | "blocked";
  readonly code: StableId;
  readonly subject:
    | "inventory"
    | "selector"
    | "checkpoint"
    | "receipt"
    | "control-state";
  readonly runId?: string;
}

export interface ProjectInitializationRecoverySelected {
  readonly runId: string;
  readonly disposition: ProjectInitializationRecoveryDisposition;
  readonly actionCode: StableId;
  readonly checkpoint: {
    readonly status: "verified";
    readonly chainLength: number;
    readonly checkpointDigest: Sha256Digest;
    readonly headDigest: Sha256Digest;
  };
  readonly receipt: {
    readonly status: ProjectInitializationRecoveryReceiptStatus;
    readonly chainLength?: number;
    readonly receiptDigest?: Sha256Digest;
    readonly headDigest?: Sha256Digest;
  };
}

export interface ProjectInitializationRecoveryReportDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly commandId: typeof PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID;
  readonly status: ProjectInitializationRecoveryStatus;
  readonly code: StableId;
  readonly registryDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly validationLevel: ProjectInitializationRecoveryValidationLevel;
  readonly inventory: {
    readonly storeStatus: ProjectInitializationRecoveryStoreStatus;
    readonly entriesObserved: number;
    readonly headFilesObserved: number;
    readonly recordFilesObserved: number;
    readonly initializationCandidates: number;
  };
  readonly controlState: {
    readonly status: ProjectInitializationRecoveryControlStateStatus;
    readonly disposition?: "untracked-control-state";
    readonly actionCode?: "inspect-untracked-control-state";
  };
  readonly selection: {
    readonly status: ProjectInitializationRecoverySelectionStatus;
    readonly runId?: string;
  };
  readonly candidates: readonly ProjectInitializationRecoveryCandidate[];
  readonly selected?: ProjectInitializationRecoverySelected;
  readonly issues: readonly ProjectInitializationRecoveryIssue[];
  readonly summary: {
    readonly terminalCandidates: number;
    readonly attentionCandidates: number;
    readonly recoveryCandidates: number;
    readonly blockedCandidates: number;
    readonly attentionIssues: number;
    readonly blockedIssues: number;
  };
  readonly finalizationReady: false;
  readonly mutationPerformed: false;
  readonly externalProcessStarted: false;
  readonly networkAccessPerformed: false;
  readonly editorControlPerformed: false;
}

export interface ProjectInitializationRecoveryReport
  extends ProjectInitializationRecoveryReportDigestInput {
  readonly reportDigest: Sha256Digest;
}

type DataRecord = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const WORKFLOW_STATUSES = new Set<WorkflowCheckpointStatus>([
  "prepared",
  "waiting-approval",
  "running",
  "waiting-rollback",
  "rolling-back",
  "uncertain",
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "expired",
  "archived",
]);
const PROJECT_STAGES = new Set<ProjectStage>([
  "concept",
  "risk-prototype",
  "vertical-slice",
  "stabilization",
  "release-candidate",
]);
const SIDE_EFFECTS = new Set<WorkflowCheckpointSideEffect>([
  "not-started",
  "started",
  "confirmed",
  "rolled-back",
  "uncertain",
]);
const STATUS_CODES: Readonly<Record<ProjectInitializationRecoveryStatus, StableId>> =
  Object.freeze({
    clear: "initialization-recovery-clear" as StableId,
    attention: "initialization-recovery-attention" as StableId,
    "recovery-required": "initialization-recovery-required" as StableId,
    blocked: "initialization-recovery-blocked" as StableId,
  });
const DISPOSITION_ACTIONS: Readonly<
  Record<ProjectInitializationRecoveryDisposition, StableId>
> = Object.freeze({
  terminal: "no-recovery-action" as StableId,
  "authorization-abandoned": "review-abandoned-authorization" as StableId,
  "restart-recovery-required": "prepare-recovery-finalization" as StableId,
  "reconciliation-required":
    "reconcile-uncertain-initialization" as StableId,
  "authority-stale": "inspect-initialization-authority" as StableId,
  corrupt: "repair-initialization-evidence" as StableId,
});

function dataRecord(value: unknown, message: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw new TypeError(message);
  }
  return value as DataRecord;
}

function dataArray(value: unknown, message: string): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Object.getOwnPropertyNames(value);
  const expected = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    "length",
  ];
  if (
    names.length !== expected.length ||
    !expected.every((name) => names.includes(name)) ||
    expected.slice(0, -1).some((name) => {
      const descriptor = descriptors[name];
      return (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    })
  ) {
    throw new TypeError(message);
  }
  return value;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[] = [],
  message = "recovery assessment fields are not exact",
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.has(key))
  ) {
    throw new TypeError(message);
  }
}

function boundedInteger(
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

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function canonicalProjectRoot(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function assertProjectInitializationRecoveryRequestSemantics(
  value: ProjectInitializationRecoveryRequest,
): void {
  const request = dataRecord(value, "recovery assessment request is invalid");
  exactKeys(
    request,
    ["schemaVersion", "projectRoot"],
    ["runId"],
    "recovery assessment request fields are not exact",
  );
  if (
    request["schemaVersion"] !== "1.0.0" ||
    !canonicalProjectRoot(request["projectRoot"]) ||
    (request["runId"] !== undefined && !canonicalUuid(request["runId"]))
  ) {
    throw new TypeError("recovery assessment request is invalid");
  }
}

function validateInventory(value: unknown): ProjectInitializationRecoveryReportDigestInput["inventory"] {
  const inventory = dataRecord(value, "recovery inventory is invalid");
  exactKeys(inventory, [
    "storeStatus",
    "entriesObserved",
    "headFilesObserved",
    "recordFilesObserved",
    "initializationCandidates",
  ]);
  if (
    !["missing", "present", "invalid"].includes(
      inventory["storeStatus"] as string,
    ) ||
    !boundedInteger(inventory["entriesObserved"], 0, 16_384) ||
    !boundedInteger(inventory["headFilesObserved"], 0, 1_024) ||
    !boundedInteger(inventory["recordFilesObserved"], 0, 16_384) ||
    !boundedInteger(
      inventory["initializationCandidates"],
      0,
      PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
    ) ||
    (inventory["storeStatus"] === "missing" &&
      (inventory["entriesObserved"] !== 0 ||
        inventory["headFilesObserved"] !== 0 ||
        inventory["recordFilesObserved"] !== 0 ||
        inventory["initializationCandidates"] !== 0))
  ) {
    throw new TypeError("recovery inventory is contradictory");
  }
  return inventory as unknown as ProjectInitializationRecoveryReportDigestInput["inventory"];
}

function validateControlState(value: unknown): ProjectInitializationRecoveryReportDigestInput["controlState"] {
  const control = dataRecord(value, "recovery control state is invalid");
  exactKeys(control, ["status"], ["disposition", "actionCode"]);
  const partial = control["status"] === "partial-untracked";
  if (
    !["absent", "initialized", "tracked", "partial-untracked"].includes(
      control["status"] as string,
    ) ||
    Object.hasOwn(control, "disposition") !== partial ||
    Object.hasOwn(control, "actionCode") !== partial ||
    (partial &&
      (control["disposition"] !== "untracked-control-state" ||
        control["actionCode"] !== "inspect-untracked-control-state"))
  ) {
    throw new TypeError("recovery control state is contradictory");
  }
  return control as unknown as ProjectInitializationRecoveryReportDigestInput["controlState"];
}

function validateCandidate(value: unknown): ProjectInitializationRecoveryCandidate {
  const candidate = dataRecord(value, "recovery candidate is invalid");
  const required = [
    "validationLevel",
    "runId",
    "checkpointId",
    "sequence",
    "checkpointDigest",
    "headDigest",
    "status",
    "disposition",
    "actionCode",
    "projectId",
    "projectIdentityDigest",
    "projectAuthority",
    "projectStage",
    "registryDigest",
    "registryAuthority",
    "workflowId",
    "workflowVersion",
    "resolvedPlanDigest",
    "inputDigest",
    "updatedAt",
  ];
  exactKeys(candidate, required, [
    "projectRootIdentityDigest",
    "receiptChainHead",
    "inFlight",
  ]);
  const disposition = candidate[
    "disposition"
  ] as ProjectInitializationRecoveryDisposition;
  if (
    candidate["validationLevel"] !==
      "head-and-latest-record-presence" ||
    !canonicalUuid(candidate["runId"]) ||
    !canonicalUuid(candidate["checkpointId"]) ||
    !boundedInteger(candidate["sequence"], 0, 1_000_000) ||
    !isSha256Digest(candidate["checkpointDigest"]) ||
    !isSha256Digest(candidate["headDigest"]) ||
    !WORKFLOW_STATUSES.has(candidate["status"] as WorkflowCheckpointStatus) ||
    !PROJECT_INITIALIZATION_RECOVERY_DISPOSITIONS.includes(disposition) ||
    candidate["actionCode"] !== DISPOSITION_ACTIONS[disposition] ||
    !isStableId(candidate["projectId"]) ||
    !isSha256Digest(candidate["projectIdentityDigest"]) ||
    !["current", "foreign", "unbound"].includes(
      candidate["projectAuthority"] as string,
    ) ||
    !PROJECT_STAGES.has(candidate["projectStage"] as ProjectStage) ||
    !isSha256Digest(candidate["registryDigest"]) ||
    !["current", "stale"].includes(candidate["registryAuthority"] as string) ||
    candidate["workflowId"] !== "workflow.project-initialization" ||
    typeof candidate["workflowVersion"] !== "string" ||
    candidate["workflowVersion"].length < 1 ||
    candidate["workflowVersion"].length > 256 ||
    !isSha256Digest(candidate["resolvedPlanDigest"]) ||
    !isSha256Digest(candidate["inputDigest"]) ||
    !canonicalTimestamp(candidate["updatedAt"]) ||
    (candidate["projectRootIdentityDigest"] !== undefined &&
      !isSha256Digest(candidate["projectRootIdentityDigest"])) ||
    (candidate["receiptChainHead"] !== undefined &&
      !isSha256Digest(candidate["receiptChainHead"])) ||
    (candidate["projectAuthority"] === "unbound") !==
      (candidate["projectRootIdentityDigest"] === undefined) ||
    (candidate["registryAuthority"] === "stale" &&
      disposition !== "authority-stale" &&
      disposition !== "corrupt") ||
    (candidate["projectAuthority"] !== "current" &&
      disposition !== "authority-stale" &&
      disposition !== "corrupt") ||
    (disposition === "authority-stale" &&
      candidate["registryAuthority"] === "current" &&
      candidate["projectAuthority"] === "current")
  ) {
    throw new TypeError("recovery candidate identity is contradictory");
  }
  if (candidate["inFlight"] !== undefined) {
    const inFlight = dataRecord(
      candidate["inFlight"],
      "recovery candidate in-flight state is invalid",
    );
    exactKeys(inFlight, ["phase", "sideEffect"]);
    if (
      !["command", "rollback"].includes(inFlight["phase"] as string) ||
      !SIDE_EFFECTS.has(inFlight["sideEffect"] as WorkflowCheckpointSideEffect)
    ) {
      throw new TypeError("recovery candidate in-flight state is invalid");
    }
  }
  return candidate as unknown as ProjectInitializationRecoveryCandidate;
}

function validateIssue(value: unknown): ProjectInitializationRecoveryIssue {
  const issue = dataRecord(value, "recovery issue is invalid");
  exactKeys(issue, ["severity", "code", "subject"], ["runId"]);
  if (
    !["attention", "blocked"].includes(issue["severity"] as string) ||
    !isStableId(issue["code"]) ||
    !["inventory", "selector", "checkpoint", "receipt", "control-state"].includes(
      issue["subject"] as string,
    ) ||
    (issue["runId"] !== undefined && !canonicalUuid(issue["runId"]))
  ) {
    throw new TypeError("recovery issue is invalid");
  }
  return issue as unknown as ProjectInitializationRecoveryIssue;
}

function validateSelection(value: unknown): ProjectInitializationRecoveryReportDigestInput["selection"] {
  const selection = dataRecord(value, "recovery selection is invalid");
  exactKeys(selection, ["status"], ["runId"]);
  const status = selection["status"] as ProjectInitializationRecoverySelectionStatus;
  if (
    !["not-requested", "not-found", "assessed", "blocked"].includes(status) ||
    (status === "not-requested") !== (selection["runId"] === undefined) ||
    (selection["runId"] !== undefined && !canonicalUuid(selection["runId"]))
  ) {
    throw new TypeError("recovery selection is contradictory");
  }
  return selection as unknown as ProjectInitializationRecoveryReportDigestInput["selection"];
}

function validateSelected(value: unknown): ProjectInitializationRecoverySelected {
  const selected = dataRecord(value, "selected recovery assessment is invalid");
  exactKeys(selected, [
    "runId",
    "disposition",
    "actionCode",
    "checkpoint",
    "receipt",
  ]);
  const disposition = selected[
    "disposition"
  ] as ProjectInitializationRecoveryDisposition;
  if (
    !canonicalUuid(selected["runId"]) ||
    !PROJECT_INITIALIZATION_RECOVERY_DISPOSITIONS.includes(disposition) ||
    selected["actionCode"] !== DISPOSITION_ACTIONS[disposition]
  ) {
    throw new TypeError("selected recovery identity is invalid");
  }
  const checkpoint = dataRecord(
    selected["checkpoint"],
    "selected checkpoint verification is invalid",
  );
  exactKeys(checkpoint, [
    "status",
    "chainLength",
    "checkpointDigest",
    "headDigest",
  ]);
  if (
    checkpoint["status"] !== "verified" ||
    !boundedInteger(checkpoint["chainLength"], 1, 4096) ||
    !isSha256Digest(checkpoint["checkpointDigest"]) ||
    !isSha256Digest(checkpoint["headDigest"])
  ) {
    throw new TypeError("selected checkpoint verification is invalid");
  }
  const receipt = dataRecord(
    selected["receipt"],
    "selected receipt verification is invalid",
  );
  exactKeys(
    receipt,
    ["status"],
    ["chainLength", "receiptDigest", "headDigest"],
  );
  const receiptStatus = receipt[
    "status"
  ] as ProjectInitializationRecoveryReceiptStatus;
  const pointerFields = ["chainLength", "receiptDigest", "headDigest"];
  const pointerCount = pointerFields.filter((field) =>
    Object.hasOwn(receipt, field),
  ).length;
  if (
    !["not-declared", "missing", "verified", "uncertain", "contradictory"].includes(
      receiptStatus,
    ) ||
    (pointerCount !== 0 && pointerCount !== pointerFields.length) ||
    (pointerCount === pointerFields.length &&
      (!boundedInteger(receipt["chainLength"], 1, 4096) ||
        !isSha256Digest(receipt["receiptDigest"]) ||
        !isSha256Digest(receipt["headDigest"]))) ||
    (["verified", "uncertain"].includes(receiptStatus) && pointerCount !== 3) ||
    (["not-declared", "missing"].includes(receiptStatus) && pointerCount !== 0)
  ) {
    throw new TypeError("selected receipt verification is contradictory");
  }
  return selected as unknown as ProjectInitializationRecoverySelected;
}

function issueKey(issue: ProjectInitializationRecoveryIssue): string {
  return `${issue.severity}\u0000${issue.code}\u0000${issue.subject}\u0000${issue.runId ?? ""}`;
}

function validateReportBody(
  value: unknown,
): ProjectInitializationRecoveryReportDigestInput {
  const report = dataRecord(value, "recovery assessment report is invalid");
  const required = [
    "schemaVersion",
    "commandId",
    "status",
    "code",
    "registryDigest",
    "projectRootIdentityDigest",
    "validationLevel",
    "inventory",
    "controlState",
    "selection",
    "candidates",
    "issues",
    "summary",
    "finalizationReady",
    "mutationPerformed",
    "externalProcessStarted",
    "networkAccessPerformed",
    "editorControlPerformed",
  ];
  exactKeys(report, required, ["selected"]);
  const status = report["status"] as ProjectInitializationRecoveryStatus;
  if (
    report["schemaVersion"] !== "1.0.0" ||
    report["commandId"] !==
      PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID ||
    !PROJECT_INITIALIZATION_RECOVERY_STATUSES.includes(status) ||
    report["code"] !== STATUS_CODES[status] ||
    !isSha256Digest(report["registryDigest"]) ||
    !isSha256Digest(report["projectRootIdentityDigest"]) ||
    !["head-and-latest-record-presence", "selected-full-chain"].includes(
      report["validationLevel"] as string,
    ) ||
    report["finalizationReady"] !== false ||
    report["mutationPerformed"] !== false ||
    report["externalProcessStarted"] !== false ||
    report["networkAccessPerformed"] !== false ||
    report["editorControlPerformed"] !== false
  ) {
    throw new TypeError("recovery assessment report identity or effects are invalid");
  }
  const inventory = validateInventory(report["inventory"]);
  const controlState = validateControlState(report["controlState"]);
  const selection = validateSelection(report["selection"]);
  const candidateValues = dataArray(
    report["candidates"],
    "recovery candidates are invalid",
  );
  if (candidateValues.length > PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES) {
    throw new TypeError("recovery candidate budget was exceeded");
  }
  const candidates = candidateValues.map(validateCandidate);
  if (
    candidates.some(
      (candidate, index) =>
        index > 0 &&
        compareCanonicalText(candidates[index - 1]!.runId, candidate.runId) >= 0,
    ) ||
    inventory.initializationCandidates !== candidates.length
  ) {
    throw new TypeError("recovery candidates are not canonical");
  }
  const issueValues = dataArray(report["issues"], "recovery issues are invalid");
  if (issueValues.length > PROJECT_INITIALIZATION_RECOVERY_MAX_ISSUES) {
    throw new TypeError("recovery issue budget was exceeded");
  }
  const issues = issueValues.map(validateIssue);
  if (
    issues.some(
      (issue, index) =>
        index > 0 &&
        compareCanonicalText(issueKey(issues[index - 1]!), issueKey(issue)) >= 0,
    )
  ) {
    throw new TypeError("recovery issues are not canonical");
  }
  const selected =
    report["selected"] === undefined
      ? undefined
      : validateSelected(report["selected"]);
  if (
    (selection.status === "assessed") !== (selected !== undefined) ||
    (selected !== undefined &&
      (selection.runId !== selected.runId ||
        !candidates.some(
          (candidate) =>
            candidate.runId === selected.runId &&
            candidate.disposition === selected.disposition &&
            candidate.actionCode === selected.actionCode &&
            candidate.checkpointDigest ===
              selected.checkpoint.checkpointDigest &&
            candidate.headDigest === selected.checkpoint.headDigest,
        ))) ||
    (report["validationLevel"] === "selected-full-chain") !==
      (selected !== undefined)
  ) {
    throw new TypeError("recovery selection and full-chain evidence contradict");
  }
  const terminalCandidates = candidates.filter(
    ({ disposition }) => disposition === "terminal",
  ).length;
  const attentionCandidates = candidates.filter(
    ({ disposition }) => disposition === "authorization-abandoned",
  ).length;
  const recoveryCandidates = candidates.filter(({ disposition }) =>
    ["restart-recovery-required", "reconciliation-required"].includes(
      disposition,
    ),
  ).length;
  const blockedCandidates = candidates.filter(({ disposition }) =>
    ["authority-stale", "corrupt"].includes(disposition),
  ).length;
  const attentionIssues = issues.filter(
    ({ severity }) => severity === "attention",
  ).length;
  const blockedIssues = issues.length - attentionIssues;
  const summary = dataRecord(report["summary"], "recovery summary is invalid");
  exactKeys(summary, [
    "terminalCandidates",
    "attentionCandidates",
    "recoveryCandidates",
    "blockedCandidates",
    "attentionIssues",
    "blockedIssues",
  ]);
  if (
    summary["terminalCandidates"] !== terminalCandidates ||
    summary["attentionCandidates"] !== attentionCandidates ||
    summary["recoveryCandidates"] !== recoveryCandidates ||
    summary["blockedCandidates"] !== blockedCandidates ||
    summary["attentionIssues"] !== attentionIssues ||
    summary["blockedIssues"] !== blockedIssues
  ) {
    throw new TypeError("recovery summary is contradictory");
  }
  const derivedStatus: ProjectInitializationRecoveryStatus =
    blockedCandidates > 0 ||
    blockedIssues > 0 ||
    inventory.storeStatus === "invalid" ||
    selection.status === "blocked"
      ? "blocked"
      : recoveryCandidates > 0
        ? "recovery-required"
        : attentionCandidates > 0 ||
            attentionIssues > 0 ||
            controlState.status === "partial-untracked" ||
            selection.status === "not-found"
          ? "attention"
          : "clear";
  if (
    status !== derivedStatus ||
    (inventory.storeStatus === "missing" && candidates.length !== 0) ||
    (controlState.status === "tracked") !== (candidates.length > 0)
  ) {
    throw new TypeError("recovery status contradicts its evidence");
  }
  return report as unknown as ProjectInitializationRecoveryReportDigestInput;
}

export function computeProjectInitializationRecoveryReportDigest(
  value: ProjectInitializationRecoveryReportDigestInput,
): Sha256Digest {
  const body = validateReportBody(value);
  return digestCanonicalJson({
    domain: "ai-game-playbook/project-initialization-recovery-report",
    version: "1.0.0",
    ...body,
  });
}

export function assertProjectInitializationRecoveryReportSemantics(
  value: ProjectInitializationRecoveryReport,
): void {
  const report = dataRecord(value, "recovery assessment report is invalid");
  const required = [
    "schemaVersion",
    "commandId",
    "status",
    "code",
    "registryDigest",
    "projectRootIdentityDigest",
    "validationLevel",
    "inventory",
    "controlState",
    "selection",
    "candidates",
    "issues",
    "summary",
    "finalizationReady",
    "mutationPerformed",
    "externalProcessStarted",
    "networkAccessPerformed",
    "editorControlPerformed",
    "reportDigest",
  ];
  exactKeys(report, required, ["selected"]);
  if (!isSha256Digest(report["reportDigest"])) {
    throw new TypeError("recovery assessment report digest is invalid");
  }
  const { reportDigest, ...body } = report;
  if (
    reportDigest !==
    computeProjectInitializationRecoveryReportDigest(
      body as unknown as ProjectInitializationRecoveryReportDigestInput,
    )
  ) {
    throw new TypeError("recovery assessment report digest does not match");
  }
}

const recoveryCandidate = closedObject(
  {
    validationLevel: { const: "head-and-latest-record-presence" },
    runId: reference("uuid"),
    checkpointId: reference("uuid"),
    sequence: { type: "integer", minimum: 0, maximum: 1_000_000 },
    checkpointDigest: reference("sha256Digest"),
    headDigest: reference("sha256Digest"),
    status: enumSchema([...WORKFLOW_STATUSES]),
    disposition: enumSchema(PROJECT_INITIALIZATION_RECOVERY_DISPOSITIONS),
    actionCode: reference("stableId"),
    projectId: reference("stableId"),
    projectIdentityDigest: reference("sha256Digest"),
    projectRootIdentityDigest: reference("sha256Digest"),
    projectAuthority: enumSchema(["current", "foreign", "unbound"]),
    projectStage: reference("projectStage"),
    registryDigest: reference("sha256Digest"),
    registryAuthority: enumSchema(["current", "stale"]),
    workflowId: { const: "workflow.project-initialization" },
    workflowVersion: reference("semanticVersion"),
    resolvedPlanDigest: reference("sha256Digest"),
    inputDigest: reference("sha256Digest"),
    receiptChainHead: reference("sha256Digest"),
    inFlight: closedObject(
      {
        phase: enumSchema(["command", "rollback"]),
        sideEffect: enumSchema([...SIDE_EFFECTS]),
      },
      ["phase", "sideEffect"],
    ),
    updatedAt: reference("timestamp"),
  },
  [
    "validationLevel",
    "runId",
    "checkpointId",
    "sequence",
    "checkpointDigest",
    "headDigest",
    "status",
    "disposition",
    "actionCode",
    "projectId",
    "projectIdentityDigest",
    "projectAuthority",
    "projectStage",
    "registryDigest",
    "registryAuthority",
    "workflowId",
    "workflowVersion",
    "resolvedPlanDigest",
    "inputDigest",
    "updatedAt",
  ],
);

const recoveryIssue = closedObject(
  {
    severity: enumSchema(["attention", "blocked"]),
    code: reference("stableId"),
    subject: enumSchema([
      "inventory",
      "selector",
      "checkpoint",
      "receipt",
      "control-state",
    ]),
    runId: reference("uuid"),
  },
  ["severity", "code", "subject"],
);

const recoverySelected = closedObject(
  {
    runId: reference("uuid"),
    disposition: enumSchema(PROJECT_INITIALIZATION_RECOVERY_DISPOSITIONS),
    actionCode: reference("stableId"),
    checkpoint: closedObject(
      {
        status: { const: "verified" },
        chainLength: { type: "integer", minimum: 1, maximum: 4096 },
        checkpointDigest: reference("sha256Digest"),
        headDigest: reference("sha256Digest"),
      },
      ["status", "chainLength", "checkpointDigest", "headDigest"],
    ),
    receipt: closedObject(
      {
        status: enumSchema([
          "not-declared",
          "missing",
          "verified",
          "uncertain",
          "contradictory",
        ]),
        chainLength: { type: "integer", minimum: 1, maximum: 4096 },
        receiptDigest: reference("sha256Digest"),
        headDigest: reference("sha256Digest"),
      },
      ["status"],
    ),
  },
  ["runId", "disposition", "actionCode", "checkpoint", "receipt"],
);

export const projectInitializationRecoveryRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-initialization-recovery-request",
    version: "1.0.0",
    title: "Project Initialization Recovery Assessment Request",
    description:
      "Selects one local project and optionally one exact initialization run for a bounded read-only recovery assessment.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        projectRoot: textSchema(4096),
        runId: reference("uuid"),
      },
      ["schemaVersion", "projectRoot"],
    ),
  });

export const projectInitializationRecoveryReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "project-initialization-recovery-report",
    version: "1.0.0",
    title: "Project Initialization Recovery Assessment Report",
    description:
      "Reports bounded checkpoint and receipt recovery observations without granting mutation or finalization authority.",
    schema: contractRoot(
      {
        schemaVersion: { const: "1.0.0" },
        commandId: {
          const: PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID,
        },
        status: enumSchema(PROJECT_INITIALIZATION_RECOVERY_STATUSES),
        code: reference("stableId"),
        registryDigest: reference("sha256Digest"),
        projectRootIdentityDigest: reference("sha256Digest"),
        validationLevel: enumSchema([
          "head-and-latest-record-presence",
          "selected-full-chain",
        ]),
        inventory: closedObject(
          {
            storeStatus: enumSchema(["missing", "present", "invalid"]),
            entriesObserved: {
              type: "integer",
              minimum: 0,
              maximum: 16_384,
            },
            headFilesObserved: {
              type: "integer",
              minimum: 0,
              maximum: 1_024,
            },
            recordFilesObserved: {
              type: "integer",
              minimum: 0,
              maximum: 16_384,
            },
            initializationCandidates: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
            },
          },
          [
            "storeStatus",
            "entriesObserved",
            "headFilesObserved",
            "recordFilesObserved",
            "initializationCandidates",
          ],
        ),
        controlState: closedObject(
          {
            status: enumSchema([
              "absent",
              "initialized",
              "tracked",
              "partial-untracked",
            ]),
            disposition: { const: "untracked-control-state" },
            actionCode: { const: "inspect-untracked-control-state" },
          },
          ["status"],
        ),
        selection: closedObject(
          {
            status: enumSchema([
              "not-requested",
              "not-found",
              "assessed",
              "blocked",
            ]),
            runId: reference("uuid"),
          },
          ["status"],
        ),
        candidates: boundedArray(recoveryCandidate, {
          maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
        }),
        selected: recoverySelected,
        issues: boundedArray(recoveryIssue, {
          maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_ISSUES,
        }),
        summary: closedObject(
          {
            terminalCandidates: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
            },
            attentionCandidates: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
            },
            recoveryCandidates: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
            },
            blockedCandidates: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
            },
            attentionIssues: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_ISSUES,
            },
            blockedIssues: {
              type: "integer",
              minimum: 0,
              maximum: PROJECT_INITIALIZATION_RECOVERY_MAX_ISSUES,
            },
          },
          [
            "terminalCandidates",
            "attentionCandidates",
            "recoveryCandidates",
            "blockedCandidates",
            "attentionIssues",
            "blockedIssues",
          ],
        ),
        finalizationReady: { const: false },
        mutationPerformed: { const: false },
        externalProcessStarted: { const: false },
        networkAccessPerformed: { const: false },
        editorControlPerformed: { const: false },
        reportDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "code",
        "registryDigest",
        "projectRootIdentityDigest",
        "validationLevel",
        "inventory",
        "controlState",
        "selection",
        "candidates",
        "issues",
        "summary",
        "finalizationReady",
        "mutationPerformed",
        "externalProcessStarted",
        "networkAccessPerformed",
        "editorControlPerformed",
        "reportDigest",
      ],
    ),
  });
