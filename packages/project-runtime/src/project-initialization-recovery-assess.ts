import {
  PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID,
  PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
  assertProjectInitializationRecoveryReportSemantics,
  assertProjectInitializationRecoveryRequestSemantics,
  computeProjectInitializationRecoveryReportDigest,
  compareCanonicalText,
  parseStableId,
  type ProjectInitializationRecoveryReport,
  type ProjectInitializationRecoveryReportDigestInput,
  type ProjectInitializationRecoveryRequest,
  type ProjectInitializationRecoveryCandidate,
  type ProjectInitializationRecoveryDisposition,
  type ProjectInitializationRecoveryIssue,
  type ProjectInitializationRecoverySelected,
  type ProjectInitializationRecoveryStatus,
  type RunReceipt,
  type WorkflowCheckpointRecord,
} from "@ai-game-playbook/contracts";
import {
  WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES,
  WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS,
  WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES,
  RUN_RECEIPT_QUERY_MAX_ENTRIES,
  RUN_RECEIPT_QUERY_MAX_HEADS,
  RUN_RECEIPT_QUERY_MAX_TOTAL_HEAD_BYTES,
  CoreBoundaryError,
  PROJECT_INITIALIZATION_TARGETS,
  WORKFLOW_CHECKPOINT_STORE_PATH,
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  listProjectRootEntries,
  loadQueriedWorkflowCheckpointChain,
  loadQueriedRunReceiptChain,
  queryRunReceiptHeads,
  resolveProjectPath,
  queryWorkflowCheckpointHeads,
  type CanonicalProjectRoot,
  type StoredWorkflowCheckpoint,
  type RunReceiptHeadQuery,
  type WorkflowCheckpointHeadQuery,
  type WorkflowCheckpointHeadSummary,
} from "@ai-game-playbook/core";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";

const ROOT_ENTRY_LIMIT = 10_000;
const INITIALIZATION_WORKFLOW_ID = "workflow.project-initialization";
const TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "blocked",
  "cancelled",
  "expired",
  "archived",
]);

type PathObservation = "absent" | "present" | "invalid";

async function observePathWithKind(
  root: CanonicalProjectRoot,
  path: string,
  kind: "directory" | "file",
): Promise<PathObservation> {
  try {
    const resolved = await resolveProjectPath(root, path, {
      expectedType: kind,
      existence: "optional",
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
    return resolved.kind === "absent" ? "absent" : "present";
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return "absent";
    }
    return "invalid";
  }
}

function invalidControlLayout(
  storeStatus: "missing" | "present",
): {
  readonly storeStatus: "missing" | "present";
  readonly controlState: ProjectInitializationRecoveryReportDigestInput["controlState"];
  readonly issue: ProjectInitializationRecoveryIssue;
} {
  return Object.freeze({
    storeStatus,
    controlState: Object.freeze({
      status: "partial-untracked",
      disposition: "untracked-control-state",
      actionCode: "inspect-untracked-control-state",
    }),
    issue: Object.freeze({
      severity: "blocked",
      code: parseStableId("initialization-control-state-invalid"),
      subject: "control-state",
    }),
  });
}

async function inspectControlLayout(
  root: CanonicalProjectRoot,
  controlRoot: PathObservation,
  candidateCount: number,
): Promise<{
  readonly storeStatus: "missing" | "present";
  readonly controlState: ProjectInitializationRecoveryReportDigestInput["controlState"];
  readonly issue?: ProjectInitializationRecoveryIssue;
}> {
  const storeObservation = await observePathWithKind(
    root,
    WORKFLOW_CHECKPOINT_STORE_PATH,
    "directory",
  );
  const storeStatus =
    storeObservation === "present" ? "present" : "missing";
  if (storeObservation === "invalid") {
    return invalidControlLayout(storeStatus);
  }
  if (candidateCount > 0) {
    return Object.freeze({
      storeStatus,
      controlState: Object.freeze({ status: "tracked" }),
    });
  }
  if (controlRoot === "absent") {
    return Object.freeze({
      storeStatus: "missing",
      controlState: Object.freeze({ status: "absent" }),
    });
  }
  if (controlRoot === "invalid") {
    return invalidControlLayout(storeStatus);
  }
  let complete = true;
  for (const target of PROJECT_INITIALIZATION_TARGETS) {
    const observation = await observePathWithKind(
      root,
      target.path,
      target.kind,
    );
    if (observation === "invalid") {
      return invalidControlLayout(storeStatus);
    }
    if (observation === "absent") {
      complete = false;
      break;
    }
  }
  if (complete) {
    return Object.freeze({
      storeStatus,
      controlState: Object.freeze({ status: "initialized" }),
    });
  }
  return Object.freeze({
    storeStatus,
    controlState: Object.freeze({
      status: "partial-untracked",
      disposition: "untracked-control-state",
      actionCode: "inspect-untracked-control-state",
    }),
    issue: Object.freeze({
      severity: "attention",
      code: parseStableId("initialization-control-state-untracked"),
      subject: "control-state",
    }),
  });
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => entry === right[index])
  );
}

function receiptOutcomeMatchesAttempt(
  receipt: RunReceipt,
  attempt: WorkflowCheckpointRecord["attempts"][number],
): boolean {
  switch (attempt.outcome) {
    case "succeeded":
      return receipt.status === "succeeded";
    case "failed":
    case "continued":
      return receipt.status === "failed";
    case "blocked":
      return receipt.status === "blocked";
    case "cancelled":
      return receipt.status === "cancelled";
    case "rolled-back":
      return receipt.status === "succeeded";
    case "uncertain":
      return true;
  }
}

function receiptMatchesCheckpointChain(
  checkpoints: readonly WorkflowCheckpointRecord[],
  receipt: RunReceipt,
): boolean {
  const checkpoint = checkpoints.at(-1);
  const dispatched = checkpoints.at(-2);
  const attempt = checkpoint?.attempts.at(-1);
  const inFlight = dispatched?.inFlight;
  if (
    checkpoint === undefined ||
    dispatched === undefined ||
    attempt === undefined ||
    inFlight === undefined
  ) {
    return false;
  }
  const expectedPackDigests = BUILTIN_REGISTRY.packs
    .filter(({ provides }) => provides.commands.includes(inFlight.command.id))
    .map(({ digest }) => digest)
    .sort(compareCanonicalText);
  const startedAt = Date.parse(receipt.timing.startedAt);
  const endedAt = Date.parse(receipt.timing.endedAt);
  return (
    attempt.receiptDigest === receipt.receiptDigest &&
    checkpoint.receiptChainHead === receipt.receiptDigest &&
    attempt.stepId === inFlight.stepId &&
    attempt.ordinal === inFlight.ordinal &&
    attempt.attempt === inFlight.attempt &&
    attempt.phase === inFlight.phase &&
    receiptOutcomeMatchesAttempt(receipt, attempt) &&
    receipt.identity.runId === checkpoint.identity.runId &&
    receipt.identity.workflowId === checkpoint.identity.workflow.id &&
    receipt.identity.stepId === inFlight.stepId &&
    receipt.identity.attempt === inFlight.attempt &&
    receipt.identity.phase === inFlight.phase &&
    receipt.identity.projectId === checkpoint.identity.projectId &&
    receipt.identity.resolvedPlanDigest ===
      checkpoint.identity.workflow.resolvedPlanDigest &&
    receipt.identity.featureId === checkpoint.identity.featureId &&
    receipt.identity.featureContractDigest ===
      checkpoint.identity.featureContractDigest &&
    receipt.authority.command.id === inFlight.command.id &&
    receipt.authority.command.version === inFlight.command.version &&
    receipt.authority.command.descriptorDigest ===
      inFlight.command.descriptorDigest &&
    receipt.authority.registryDigest === checkpoint.identity.registryDigest &&
    receipt.authority.handlerDigest === inFlight.command.handlerDigest &&
    receipt.authority.inputDigest === inFlight.inputDigest &&
    receipt.authority.authorizationId === inFlight.authorizationId &&
    receipt.authority.authorizationRequestDigest ===
      inFlight.authorizationRequestDigest &&
    sameStringArray(receipt.authority.approvalIds, inFlight.approvalIds) &&
    sameStringArray(receipt.authority.packDigests, expectedPackDigests) &&
    receipt.environment.projectIdentityDigest ===
      (checkpoint.identity.projectRootIdentityDigest ??
        checkpoint.identity.projectIdentityDigest) &&
    receipt.environment.sessionIdentityDigest ===
      checkpoint.sessionIdentityDigest &&
    receipt.previousReceiptDigest === dispatched.receiptChainHead &&
    startedAt >= Date.parse(dispatched.updatedAt) &&
    endedAt <= Date.parse(checkpoint.updatedAt) &&
    receipt.artifacts.every(
      (artifact) =>
        artifact.commandId === inFlight.command.id &&
        Date.parse(artifact.createdAt) >= startedAt &&
        Date.parse(artifact.createdAt) <= endedAt,
    )
  );
}

interface ProjectInitializationRecoveryAssessmentMetadata {
  readonly root: CanonicalProjectRoot;
  readonly checkpointQuery?: WorkflowCheckpointHeadQuery;
  readonly selectedCheckpoint?: StoredWorkflowCheckpoint;
  readonly receiptQuery?: RunReceiptHeadQuery;
}

interface SelectedReceiptAssessment {
  readonly receipt: ProjectInitializationRecoverySelected["receipt"];
  readonly disposition?: ProjectInitializationRecoveryDisposition;
  readonly issue?: ProjectInitializationRecoveryIssue;
  readonly query?: RunReceiptHeadQuery;
}

const assessmentWitnesses = new WeakMap<
  object,
  ProjectInitializationRecoveryAssessmentMetadata
>();

function dispositionFor(
  head: WorkflowCheckpointHeadSummary,
): ProjectInitializationRecoveryDisposition {
  if (
    head.projectAuthority !== "current" ||
    head.registryAuthority !== "current"
  ) {
    return "authority-stale";
  }
  if (TERMINAL_STATUSES.has(head.status)) return "terminal";
  if (head.status === "uncertain" || head.inFlight?.sideEffect === "uncertain") {
    return "reconciliation-required";
  }
  if (
    head.status === "waiting-rollback" ||
    head.status === "rolling-back" ||
    head.inFlight?.sideEffect === "started" ||
    head.inFlight?.sideEffect === "confirmed" ||
    head.inFlight?.sideEffect === "rolled-back"
  ) {
    return "restart-recovery-required";
  }
  return "authorization-abandoned";
}

function actionFor(
  disposition: ProjectInitializationRecoveryDisposition,
): ReturnType<typeof parseStableId> {
  switch (disposition) {
    case "terminal":
      return parseStableId("no-recovery-action");
    case "authorization-abandoned":
      return parseStableId("review-abandoned-authorization");
    case "restart-recovery-required":
      return parseStableId("prepare-recovery-finalization");
    case "reconciliation-required":
      return parseStableId("reconcile-uncertain-initialization");
    case "authority-stale":
      return parseStableId("inspect-initialization-authority");
    case "corrupt":
      return parseStableId("repair-initialization-evidence");
  }
}

function candidateFromHead(
  head: WorkflowCheckpointHeadSummary,
): ProjectInitializationRecoveryCandidate {
  const disposition = dispositionFor(head);
  return deepFreeze({
    validationLevel: "head-and-latest-record-presence",
    runId: head.runId,
    checkpointId: head.checkpointId,
    sequence: head.sequence,
    checkpointDigest: head.checkpointDigest,
    headDigest: head.headDigest,
    status: head.status,
    disposition,
    actionCode: actionFor(disposition),
    projectId: head.projectId,
    projectIdentityDigest: head.projectIdentityDigest,
    ...(head.projectRootIdentityDigest === undefined
      ? {}
      : { projectRootIdentityDigest: head.projectRootIdentityDigest }),
    projectAuthority: head.projectAuthority,
    projectStage: head.projectStage,
    registryDigest: head.registryDigest,
    registryAuthority: head.registryAuthority,
    workflowId: INITIALIZATION_WORKFLOW_ID,
    workflowVersion: head.workflowVersion,
    resolvedPlanDigest: head.resolvedPlanDigest,
    inputDigest: head.inputDigest,
    ...(head.receiptChainHead === undefined
      ? {}
      : { receiptChainHead: head.receiptChainHead }),
    ...(head.inFlight === undefined ? {} : { inFlight: head.inFlight }),
    updatedAt: head.updatedAt,
  });
}

function candidateWithDisposition(
  candidate: ProjectInitializationRecoveryCandidate,
  disposition: ProjectInitializationRecoveryDisposition,
): ProjectInitializationRecoveryCandidate {
  return deepFreeze({
    ...candidate,
    disposition,
    actionCode: actionFor(disposition),
  });
}

function receiptIssue(
  code: string,
  runId: string,
  severity: "attention" | "blocked" = "blocked",
): ProjectInitializationRecoveryIssue {
  return Object.freeze({
    severity,
    code: parseStableId(code),
    subject: "receipt",
    runId,
  });
}

async function assessSelectedReceipt(
  root: CanonicalProjectRoot,
  storedCheckpoint: StoredWorkflowCheckpoint,
  checkpoints: readonly WorkflowCheckpointRecord[],
): Promise<SelectedReceiptAssessment> {
  const checkpoint = storedCheckpoint.checkpoint;
  let query: RunReceiptHeadQuery;
  try {
    query = await queryRunReceiptHeads({
      root,
      registry: BUILTIN_REGISTRY,
      maxEntries: RUN_RECEIPT_QUERY_MAX_ENTRIES,
      maxHeads: Math.min(
        RUN_RECEIPT_QUERY_MAX_HEADS,
        PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
      ),
      maxTotalHeadBytes: RUN_RECEIPT_QUERY_MAX_TOTAL_HEAD_BYTES,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "run-receipt-store-not-found" &&
      checkpoint.receiptChainHead === undefined &&
      checkpoint.inFlight?.sideEffect !== "started" &&
      checkpoint.inFlight?.sideEffect !== "confirmed" &&
      checkpoint.inFlight?.sideEffect !== "uncertain"
    ) {
      return Object.freeze({
        receipt: Object.freeze({ status: "not-declared" }),
      });
    }
    return Object.freeze({
      receipt: Object.freeze({ status: "contradictory" }),
      disposition: "corrupt",
      issue: receiptIssue(
        "initialization-receipt-store-invalid",
        checkpoint.identity.runId,
      ),
    });
  }
  const head = query.heads.find(
    ({ runId }) => runId === checkpoint.identity.runId,
  );
  if (head === undefined) {
    if (checkpoint.receiptChainHead !== undefined) {
      return Object.freeze({
        receipt: Object.freeze({ status: "missing" }),
        disposition: "corrupt",
        issue: receiptIssue(
          "initialization-receipt-missing",
          checkpoint.identity.runId,
        ),
        query,
      });
    }
    const sideEffect = checkpoint.inFlight?.sideEffect;
    return Object.freeze({
      receipt: Object.freeze({
        status:
          sideEffect === "started" ||
          sideEffect === "confirmed" ||
          sideEffect === "uncertain"
            ? "missing"
            : "not-declared",
      }),
      query,
    });
  }
  if (
    head.projectAuthority !== "current" ||
    head.registryAuthority !== "current" ||
    head.projectId !== checkpoint.identity.projectId ||
    head.projectIdentityDigest !== root.identityDigest ||
    head.workflowId !== checkpoint.identity.workflow.id ||
    head.resolvedPlanDigest !==
      checkpoint.identity.workflow.resolvedPlanDigest ||
    head.registryDigest !== checkpoint.identity.registryDigest
  ) {
    return Object.freeze({
      receipt: Object.freeze({
        status: "contradictory",
        chainLength: head.chainLength,
        receiptDigest: head.receiptDigest,
        headDigest: head.headDigest,
      }),
      disposition: "corrupt",
      issue: receiptIssue(
        "initialization-receipt-authority-mismatch",
        checkpoint.identity.runId,
      ),
      query,
    });
  }
  let loaded: Awaited<ReturnType<typeof loadQueriedRunReceiptChain>>;
  try {
    loaded = await loadQueriedRunReceiptChain({
      query,
      runId: checkpoint.identity.runId,
      maxArtifactBytes: 0,
    });
  } catch {
    return Object.freeze({
      receipt: Object.freeze({
        status: "contradictory",
        chainLength: head.chainLength,
        receiptDigest: head.receiptDigest,
        headDigest: head.headDigest,
      }),
      disposition: "corrupt",
      issue: receiptIssue(
        "initialization-receipt-chain-invalid",
        checkpoint.identity.runId,
      ),
      query,
    });
  }
  const receipt = loaded.stored.receipt;
  const bindingMatches =
    receipt.environment.projectIdentityDigest === root.identityDigest &&
    receiptMatchesCheckpointChain(checkpoints, receipt);
  const pointerMatches =
    checkpoint.receiptChainHead !== undefined &&
    checkpoint.receiptChainHead === receipt.receiptDigest;
  const pointer = Object.freeze({
    chainLength: loaded.stored.chainLength,
    receiptDigest: receipt.receiptDigest,
    headDigest: loaded.stored.headDigest,
  });
  if (!bindingMatches || !pointerMatches) {
    return Object.freeze({
      receipt: Object.freeze({ status: "contradictory", ...pointer }),
      disposition: "corrupt",
      issue: receiptIssue(
        checkpoint.receiptChainHead === undefined
          ? "initialization-receipt-not-declared"
          : "initialization-receipt-binding-mismatch",
        checkpoint.identity.runId,
      ),
      query,
    });
  }
  if (receipt.status === "uncertain") {
    return Object.freeze({
      receipt: Object.freeze({ status: "uncertain", ...pointer }),
      disposition: "reconciliation-required",
      issue: receiptIssue(
        "initialization-receipt-uncertain",
        checkpoint.identity.runId,
        "attention",
      ),
      query,
    });
  }
  return Object.freeze({
    receipt: Object.freeze({ status: "verified", ...pointer }),
    query,
  });
}

function summarizeCandidates(
  candidates: readonly ProjectInitializationRecoveryCandidate[],
): ProjectInitializationRecoveryReportDigestInput["summary"] {
  return Object.freeze({
    terminalCandidates: candidates.filter(
      ({ disposition }) => disposition === "terminal",
    ).length,
    attentionCandidates: candidates.filter(
      ({ disposition }) => disposition === "authorization-abandoned",
    ).length,
    recoveryCandidates: candidates.filter(({ disposition }) =>
      ["restart-recovery-required", "reconciliation-required"].includes(
        disposition,
      ),
    ).length,
    blockedCandidates: candidates.filter(({ disposition }) =>
      ["authority-stale", "corrupt"].includes(disposition),
    ).length,
    attentionIssues: 0,
    blockedIssues: 0,
  });
}

function statusFromSummary(
  summary: ProjectInitializationRecoveryReportDigestInput["summary"],
): ProjectInitializationRecoveryStatus {
  if (summary.blockedCandidates > 0 || summary.blockedIssues > 0) {
    return "blocked";
  }
  if (summary.recoveryCandidates > 0) return "recovery-required";
  if (summary.attentionCandidates > 0 || summary.attentionIssues > 0) {
    return "attention";
  }
  return "clear";
}

function codeForStatus(
  status: ProjectInitializationRecoveryStatus,
): ReturnType<typeof parseStableId> {
  return parseStableId(
    status === "clear"
      ? "initialization-recovery-clear"
      : status === "attention"
        ? "initialization-recovery-attention"
        : status === "recovery-required"
          ? "initialization-recovery-required"
          : "initialization-recovery-blocked",
  );
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function snapshotRequest(
  value: ProjectInitializationRecoveryRequest,
): ProjectInitializationRecoveryRequest {
  assertProjectInitializationRecoveryRequestSemantics(value);
  return Object.freeze({
    schemaVersion: "1.0.0",
    projectRoot: value.projectRoot,
    ...(value.runId === undefined ? {} : { runId: value.runId }),
  });
}

function finalizeReport(
  body: ProjectInitializationRecoveryReportDigestInput,
  metadata: ProjectInitializationRecoveryAssessmentMetadata,
): ProjectInitializationRecoveryReport {
  const report = deepFreeze({
    ...body,
    reportDigest: computeProjectInitializationRecoveryReportDigest(body),
  }) as ProjectInitializationRecoveryReport;
  assertProjectInitializationRecoveryReportSemantics(report);
  assessmentWitnesses.set(report, Object.freeze(metadata));
  return report;
}

export function assertProjectInitializationRecoveryAssessmentWitness(
  value: unknown,
): asserts value is ProjectInitializationRecoveryReport {
  if (
    value === null ||
    typeof value !== "object" ||
    assessmentWitnesses.get(value) === undefined
  ) {
    throw new TypeError(
      "project initialization recovery report must be an original same-process witness",
    );
  }
}

export async function runProjectInitializationRecoveryAssessment(
  value: ProjectInitializationRecoveryRequest,
): Promise<ProjectInitializationRecoveryReport> {
  const request = snapshotRequest(value);
  const root = await canonicalizeProjectRoot(request.projectRoot);
  const rootEntries = await listProjectRootEntries({
    root,
    maxEntries: ROOT_ENTRY_LIMIT,
  });
  let query: WorkflowCheckpointHeadQuery | undefined;
  let checkpointStoreInvalid = false;
  try {
    query = await queryWorkflowCheckpointHeads({
      root,
      registry: BUILTIN_REGISTRY,
      maxEntries: WORKFLOW_CHECKPOINT_QUERY_MAX_ENTRIES,
      maxHeads: Math.min(
        WORKFLOW_CHECKPOINT_QUERY_MAX_HEADS,
        PROJECT_INITIALIZATION_RECOVERY_MAX_CANDIDATES,
      ),
      maxTotalHeadBytes: WORKFLOW_CHECKPOINT_QUERY_MAX_TOTAL_HEAD_BYTES,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      [
        "workflow-checkpoint-store-budget-exceeded",
        "workflow-checkpoint-store-conflict",
        "workflow-checkpoint-store-corrupt",
      ].includes(error.code)
    ) {
      checkpointStoreInvalid = true;
    } else {
      throw error;
    }
  }
  await assertProjectRootIdentity(root);
  const controlRootEntry = rootEntries.find(
    ({ name }) => name === ".ai-game-playbook",
  );
  const controlRoot: PathObservation =
    controlRootEntry === undefined
      ? "absent"
      : controlRootEntry.kindHint === "directory"
        ? "present"
        : "invalid";
  const candidateEntries = (query?.heads ?? [])
    .filter(({ workflowId }) => workflowId === INITIALIZATION_WORKFLOW_ID)
    .map(candidateFromHead);
  let selection: ProjectInitializationRecoveryReportDigestInput["selection"] =
    Object.freeze({ status: "not-requested" });
  let selected: ProjectInitializationRecoverySelected | undefined;
  let selectedCheckpoint: StoredWorkflowCheckpoint | undefined;
  let receiptQuery: RunReceiptHeadQuery | undefined;
  const issueEntries: ProjectInitializationRecoveryIssue[] = [];
  if (checkpointStoreInvalid) {
    issueEntries.push(
      Object.freeze({
        severity: "blocked",
        code: parseStableId("initialization-checkpoint-store-invalid"),
        subject: "inventory",
      }),
    );
  }
  if (request.runId !== undefined) {
    const candidateIndex = candidateEntries.findIndex(
      ({ runId }) => runId === request.runId,
    );
    const observedCandidate = candidateEntries[candidateIndex];
    if (checkpointStoreInvalid) {
      selection = Object.freeze({ status: "blocked", runId: request.runId });
    } else if (observedCandidate === undefined) {
      selection = Object.freeze({ status: "not-found", runId: request.runId });
      issueEntries.push(
        Object.freeze({
          severity: "attention",
          code: parseStableId("initialization-run-not-found"),
          subject: "selector",
          runId: request.runId,
        }),
      );
    } else if (
      observedCandidate.projectAuthority !== "current" ||
      observedCandidate.registryAuthority !== "current"
    ) {
      selection = Object.freeze({ status: "blocked", runId: request.runId });
      issueEntries.push(
        Object.freeze({
          severity: "blocked",
          code: parseStableId("initialization-run-authority-blocked"),
          subject: "selector",
          runId: request.runId,
        }),
      );
    } else {
      const loadedCheckpoint = await loadQueriedWorkflowCheckpointChain({
        query: query!,
        runId: request.runId,
      });
      selectedCheckpoint = loadedCheckpoint.stored;
      const receiptAssessment = await assessSelectedReceipt(
        root,
        selectedCheckpoint,
        loadedCheckpoint.checkpoints,
      );
      receiptQuery = receiptAssessment.query;
      const candidate =
        receiptAssessment.disposition === undefined
          ? observedCandidate
          : candidateWithDisposition(
              observedCandidate,
              receiptAssessment.disposition,
            );
      candidateEntries[candidateIndex] = candidate;
      if (receiptAssessment.issue !== undefined) {
        issueEntries.push(receiptAssessment.issue);
      }
      selection = Object.freeze({ status: "assessed", runId: request.runId });
      selected = deepFreeze({
        runId: request.runId,
        disposition: candidate.disposition,
        actionCode: candidate.actionCode,
        checkpoint: {
          status: "verified",
          chainLength: selectedCheckpoint.chainLength,
          checkpointDigest:
            selectedCheckpoint.checkpoint.checkpointDigest,
          headDigest: selectedCheckpoint.headDigest,
        },
        receipt: receiptAssessment.receipt,
      });
    }
  }
  const activeMutationCandidates = candidateEntries.filter(
    (candidate) =>
      candidate.inFlight?.sideEffect === "started" ||
      candidate.inFlight?.sideEffect === "confirmed" ||
      candidate.inFlight?.sideEffect === "uncertain" ||
      candidate.status === "waiting-rollback" ||
      candidate.status === "rolling-back",
  ).length;
  if (activeMutationCandidates > 1) {
    issueEntries.push(
      Object.freeze({
        severity: "blocked",
        code: parseStableId("multiple-active-initialization-runs"),
        subject: "checkpoint",
      }),
    );
  }
  const candidates = Object.freeze(candidateEntries);
  const controlLayout = await inspectControlLayout(
    root,
    controlRoot,
    candidates.length,
  );
  if (controlLayout.issue !== undefined) {
    issueEntries.push(controlLayout.issue);
  }
  const issues = Object.freeze(
    issueEntries.sort((left, right) =>
      compareCanonicalText(
        `${left.severity}\u0000${left.code}\u0000${left.subject}\u0000${left.runId ?? ""}`,
        `${right.severity}\u0000${right.code}\u0000${right.subject}\u0000${right.runId ?? ""}`,
      ),
    ),
  );
  const baseSummary = summarizeCandidates(candidates);
  const summary = Object.freeze({
    ...baseSummary,
    attentionIssues: issues.filter(
      ({ severity }) => severity === "attention",
    ).length,
    blockedIssues: issues.filter(({ severity }) => severity === "blocked")
      .length,
  });
  const status = statusFromSummary(summary);
  const body: ProjectInitializationRecoveryReportDigestInput = {
    schemaVersion: "1.0.0",
    commandId: PROJECT_INITIALIZATION_RECOVERY_ASSESS_COMMAND_ID,
    status,
    code: codeForStatus(status),
    registryDigest: BUILTIN_REGISTRY.digest,
    projectRootIdentityDigest: root.identityDigest,
    validationLevel:
      selected === undefined
        ? "head-and-latest-record-presence"
        : "selected-full-chain",
    inventory: {
      storeStatus: checkpointStoreInvalid
        ? "invalid"
        : controlLayout.storeStatus,
      entriesObserved: query?.entriesObserved ?? 0,
      headFilesObserved: query?.headFilesObserved ?? 0,
      recordFilesObserved: query?.recordFilesObserved ?? 0,
      initializationCandidates: candidates.length,
    },
    controlState: controlLayout.controlState,
    selection,
    candidates,
    ...(selected === undefined ? {} : { selected }),
    issues,
    summary,
    finalizationReady: false,
    mutationPerformed: false,
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
  };
  return finalizeReport(body, {
    root,
    ...(query === undefined ? {} : { checkpointQuery: query }),
    ...(selectedCheckpoint === undefined ? {} : { selectedCheckpoint }),
    ...(receiptQuery === undefined ? {} : { receiptQuery }),
  });
}
