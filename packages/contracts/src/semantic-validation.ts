import {
  isFeatureContractApprovalDigestValid,
  computeRunReceiptDigest,
  type AssetProvenance,
  type FeatureContract,
  type RunReceipt,
} from "./feature-evidence-contracts.js";
import {
  isCanonicalApprovalDestination,
  isCanonicalApprovalScope,
  type ApprovalGrant,
} from "./approval-contracts.js";
import { compareCanonicalText } from "./canonical-json.js";
import type { InputReplayTrace } from "./engine-evidence-contracts.js";
import type { EngineCapabilityReport } from "./project-engine-contracts.js";
import type { RunHandle } from "./run-engine-contracts.js";
import {
  isResolvedWorkflowPlanDigestValid,
  type ResolvedWorkflowCommand,
  type ResolvedWorkflowPlan,
} from "./workflow-runtime-contracts.js";
import {
  isWorkflowCheckpointDigestValid,
  type WorkflowCheckpointRecord,
} from "./workflow-checkpoint-contracts.js";

export type ContractSemanticIssueCode =
  | "approval-grant-destination-noncanonical"
  | "approval-grant-scope-noncanonical"
  | "approval-grant-timestamp-invalid"
  | "approval-grant-window-invalid"
  | "asset-provenance-approval-missing"
  | "asset-provenance-cost-overrun"
  | "asset-provenance-current-file-invalid"
  | "asset-provenance-hosted-provider-incomplete"
  | "asset-provenance-lineage-invalid"
  | "asset-provenance-promotion-invalid"
  | "asset-provenance-qa-invalid"
  | "asset-provenance-rights-invalid"
  | "feature-contract-approval-required"
  | "feature-contract-approval-timestamp-invalid"
  | "feature-contract-approval-window-invalid"
  | "feature-contract-digest-mismatch"
  | "feature-contract-rollback-contradiction"
  | "input-replay-event-identity-collision"
  | "input-replay-event-order-invalid"
  | "input-replay-event-overlap"
  | "input-replay-oracle-contradiction"
  | "engine-capability-duplicate-id"
  | "engine-capability-duplicate-operation"
  | "engine-capability-future-observation"
  | "engine-capability-editor-without-engine-evidence"
  | "engine-capability-observed-without-execution-evidence"
  | "engine-capability-observed-without-receipt"
  | "engine-capability-planned-without-reason"
  | "engine-capability-verified-without-receipt"
  | "engine-capability-verified-without-runtime-evidence"
  | "run-receipt-authority-canonical-invalid"
  | "run-receipt-digest-mismatch"
  | "run-receipt-duration-mismatch"
  | "run-receipt-effect-canonical-invalid"
  | "run-receipt-effect-duration-mismatch"
  | "run-receipt-effect-mutation-mismatch"
  | "run-receipt-feature-identity-invalid"
  | "run-receipt-invalid-timestamp"
  | "run-receipt-self-parent"
  | "run-receipt-success-contradiction"
  | "run-receipt-test-count-mismatch"
  | "run-receipt-test-pass-contradiction"
  | "run-handle-checkpoint-contradiction"
  | "run-handle-command-identity-collision"
  | "run-handle-timestamp-invalid"
  | "resolved-workflow-plan-canonical-invalid"
  | "resolved-workflow-plan-dependency-invalid"
  | "resolved-workflow-plan-digest-mismatch"
  | "resolved-workflow-plan-order-invalid"
  | "run-receipt-uncertain-mutation-contradiction"
  | "run-receipt-unexpected-dirty-success"
  | "workflow-checkpoint-attempt-invalid"
  | "workflow-checkpoint-canonical-invalid"
  | "workflow-checkpoint-chain-invalid"
  | "workflow-checkpoint-digest-mismatch"
  | "workflow-checkpoint-identity-invalid"
  | "workflow-checkpoint-state-invalid"
  | "workflow-checkpoint-time-invalid";

export interface ContractSemanticIssue {
  readonly code: ContractSemanticIssueCode;
  readonly path: string;
  readonly message: string;
}

function issue(
  code: ContractSemanticIssueCode,
  path: string,
  message: string,
): ContractSemanticIssue {
  return Object.freeze({ code, path, message });
}

function freezeIssues(
  issues: readonly ContractSemanticIssue[],
): readonly ContractSemanticIssue[] {
  return Object.freeze([...issues]);
}

function timestampMillis(value: string): number | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

function decimalMicros(value: string): bigint | undefined {
  const match = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,6}))?$/.exec(value);
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return BigInt(match[1]) * 1_000_000n + BigInt(fraction || "0");
}

function isStrictlyCanonical(values: readonly string[]): boolean {
  return values.every(
    (value, index) =>
      index === 0 ||
      compareCanonicalText(values[index - 1] ?? "", value) < 0,
  );
}

function commandPermissionsAreCanonical(
  command: ResolvedWorkflowCommand,
): boolean {
  return isStrictlyCanonical(command.permissions);
}

function bindingKey(binding: {
  readonly target: string;
  readonly source: string;
}): string {
  return `${binding.target}\u0000${binding.source}`;
}

export function checkWorkflowCheckpointSemantics(
  checkpoint: WorkflowCheckpointRecord,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  if (!isWorkflowCheckpointDigestValid(checkpoint)) {
    issues.push(
      issue(
        "workflow-checkpoint-digest-mismatch",
        "/checkpointDigest",
        "Workflow checkpoint digest does not attest the immutable record body.",
      ),
    );
  }

  const createdAt = timestampMillis(checkpoint.createdAt);
  const updatedAt = timestampMillis(checkpoint.updatedAt);
  const expiresAt = timestampMillis(checkpoint.expiresAt);
  const authorizationExpiresAt =
    checkpoint.inFlight === undefined
      ? undefined
      : timestampMillis(checkpoint.inFlight.authorizationExpiresAt);
  const resumable =
    checkpoint.status === "prepared" ||
    checkpoint.status === "running" ||
    checkpoint.status === "waiting-approval" ||
    checkpoint.status === "waiting-restart" ||
    checkpoint.status === "waiting-rollback" ||
    checkpoint.status === "rolling-back";
  if (
    createdAt === undefined ||
    updatedAt === undefined ||
    expiresAt === undefined ||
    createdAt > updatedAt ||
    (resumable && updatedAt >= expiresAt) ||
    (checkpoint.inFlight !== undefined &&
      (authorizationExpiresAt === undefined ||
        updatedAt === undefined ||
        ((checkpoint.status === "running" ||
          checkpoint.status === "rolling-back") &&
          updatedAt >= authorizationExpiresAt)))
  ) {
    issues.push(
      issue(
        "workflow-checkpoint-time-invalid",
        "/updatedAt",
        "Checkpoint timestamps must be ordered and resumable state must remain before expiry.",
      ),
    );
  }

  const hasParent = checkpoint.parentCheckpointDigest !== undefined;
  if (
    (checkpoint.sequence === 0 && hasParent) ||
    (checkpoint.sequence > 0 && !hasParent)
  ) {
    issues.push(
      issue(
        "workflow-checkpoint-chain-invalid",
        "/parentCheckpointDigest",
        "Only the initial checkpoint may omit its parent digest.",
      ),
    );
  }

  const hasFeatureId = checkpoint.identity.featureId !== undefined;
  const hasFeatureDigest =
    checkpoint.identity.featureContractDigest !== undefined;
  if (hasFeatureId !== hasFeatureDigest) {
    issues.push(
      issue(
        "workflow-checkpoint-identity-invalid",
        "/identity",
        "Feature identity and feature contract digest must be retained together.",
      ),
    );
  }

  let canonicalInvalid =
    !isStrictlyCanonical(checkpoint.evidenceKinds) ||
    !isStrictlyCanonical(checkpoint.artifactDigests);
  if (
    checkpoint.inFlight !== undefined &&
    (!isStrictlyCanonical(checkpoint.inFlight.approvalIds) ||
      !commandPermissionsAreCanonical(checkpoint.inFlight.command))
  ) {
    canonicalInvalid = true;
  }
  if (canonicalInvalid) {
    issues.push(
      issue(
        "workflow-checkpoint-canonical-invalid",
        "/evidenceKinds",
        "Checkpoint evidence, artifact, approval, and permission arrays must be strictly canonical.",
      ),
    );
  }

  const requiresInFlight =
    checkpoint.status === "running" ||
    checkpoint.status === "rolling-back" ||
    checkpoint.status === "uncertain";
  const inFlight = checkpoint.inFlight;
  const inFlightContradiction =
    requiresInFlight !== (inFlight !== undefined) ||
    (checkpoint.status === "running" &&
      inFlight !== undefined &&
      (inFlight.phase !== "command" ||
        (inFlight.sideEffect !== "not-started" &&
          inFlight.sideEffect !== "started"))) ||
    (checkpoint.status === "rolling-back" &&
      inFlight !== undefined &&
      (inFlight.phase !== "rollback" ||
        (inFlight.sideEffect !== "not-started" &&
          inFlight.sideEffect !== "started"))) ||
    (checkpoint.status === "uncertain" &&
      inFlight !== undefined &&
      inFlight.sideEffect !== "uncertain") ||
    (inFlight !== undefined && inFlight.ordinal !== checkpoint.nextOrdinal);
  if (inFlightContradiction) {
    issues.push(
      issue(
        "workflow-checkpoint-state-invalid",
        "/status",
        "Checkpoint status, cursor, phase, and in-flight side-effect state are inconsistent.",
      ),
    );
  }

  const attemptKeys = new Set<string>();
  let attemptInvalid = false;
  for (const attempt of checkpoint.attempts) {
    const key = `${attempt.ordinal}\u0000${attempt.attempt}\u0000${attempt.phase}`;
    if (attemptKeys.has(key) || attempt.ordinal > checkpoint.nextOrdinal) {
      attemptInvalid = true;
    }
    attemptKeys.add(key);
  }
  const lastAttempt = checkpoint.attempts.at(-1);
  if (
    attemptInvalid ||
    (lastAttempt === undefined) !==
      (checkpoint.receiptChainHead === undefined) ||
    (lastAttempt !== undefined &&
      checkpoint.receiptChainHead !== lastAttempt.receiptDigest)
  ) {
    issues.push(
      issue(
        "workflow-checkpoint-attempt-invalid",
        "/attempts",
        "Checkpoint attempts must be unique, cursor-bounded, and agree with the receipt chain head.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkResolvedWorkflowPlanSemantics(
  plan: ResolvedWorkflowPlan,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  if (!isResolvedWorkflowPlanDigestValid(plan)) {
    issues.push(
      issue(
        "resolved-workflow-plan-digest-mismatch",
        "/resolvedPlanDigest",
        "Resolved workflow plan digest does not attest the immutable plan body.",
      ),
    );
  }

  const stepIndexes = new Map<string, number>();
  let orderInvalid = false;
  let dependencyInvalid = false;
  let canonicalInvalid = !isStrictlyCanonical(plan.requiredEvidence);
  for (const [index, step] of plan.steps.entries()) {
    if (step.ordinal !== index || stepIndexes.has(step.id)) {
      orderInvalid = true;
    }
    stepIndexes.set(step.id, index);

    if (!isStrictlyCanonical(step.dependsOn)) {
      canonicalInvalid = true;
    }
    for (const dependency of step.dependsOn) {
      const dependencyIndex = stepIndexes.get(dependency);
      if (dependencyIndex === undefined || dependencyIndex >= index) {
        dependencyInvalid = true;
      }
    }

    const bindingKeys = step.bindings.map(bindingKey);
    const bindingTargets = step.bindings.map(({ target }) => target);
    if (
      !isStrictlyCanonical(bindingKeys) ||
      new Set(bindingTargets).size !== bindingTargets.length ||
      !commandPermissionsAreCanonical(step.command) ||
      (step.rollbackCommand !== undefined &&
        !commandPermissionsAreCanonical(step.rollbackCommand))
    ) {
      canonicalInvalid = true;
    }
  }

  if (orderInvalid) {
    issues.push(
      issue(
        "resolved-workflow-plan-order-invalid",
        "/steps",
        "Resolved workflow steps must have unique IDs and contiguous ordinals matching array order.",
      ),
    );
  }
  if (dependencyInvalid) {
    issues.push(
      issue(
        "resolved-workflow-plan-dependency-invalid",
        "/steps",
        "Every workflow dependency must identify an earlier resolved step.",
      ),
    );
  }
  if (canonicalInvalid) {
    issues.push(
      issue(
        "resolved-workflow-plan-canonical-invalid",
        "/steps",
        "Resolved workflow arrays and bindings must be strictly canonical and unambiguous.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkApprovalGrantSemantics(
  grant: ApprovalGrant,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const approvedAt = timestampMillis(grant.approvedAt);
  const expiresAt = timestampMillis(grant.budgets.expiresAt);
  if (approvedAt === undefined || expiresAt === undefined) {
    issues.push(
      issue(
        "approval-grant-timestamp-invalid",
        "/approvedAt",
        "Approval grant timestamps must be valid date-time values.",
      ),
    );
  } else if (approvedAt >= expiresAt) {
    issues.push(
      issue(
        "approval-grant-window-invalid",
        "/budgets/expiresAt",
        "Approval grant expiry must occur after approval time.",
      ),
    );
  }

  if (!isCanonicalApprovalScope(grant.scope)) {
    issues.push(
      issue(
        "approval-grant-scope-noncanonical",
        "/scope",
        "Approval grant scope arrays must be strictly sorted and unique.",
      ),
    );
  }
  if (
    grant.scope.destinations.some(
      (destination) => !isCanonicalApprovalDestination(destination),
    )
  ) {
    issues.push(
      issue(
        "approval-grant-destination-noncanonical",
        "/scope/destinations",
        "Approval destinations must be canonical HTTP or HTTPS origins.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkRunHandleSemantics(
  handle: RunHandle,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const createdAt = timestampMillis(handle.createdAt);
  const updatedAt = timestampMillis(handle.updatedAt);
  if (
    createdAt === undefined ||
    updatedAt === undefined ||
    updatedAt < createdAt
  ) {
    issues.push(
      issue(
        "run-handle-timestamp-invalid",
        "/updatedAt",
        "Run update time must be valid and cannot precede creation time.",
      ),
    );
  }

  if (new Set(Object.values(handle.commands)).size !== 3) {
    issues.push(
      issue(
        "run-handle-command-identity-collision",
        "/commands",
        "Run status, cancel, and resume commands must have distinct identities.",
      ),
    );
  }

  const terminal =
    handle.status === "succeeded" ||
    handle.status === "failed" ||
    handle.status === "blocked" ||
    handle.status === "cancelled" ||
    handle.status === "uncertain";
  const checkpointRequired =
    handle.status === "waiting-approval" || handle.status === "blocked";
  const checkpointContradiction =
    (terminal && handle.latestReceiptDigest === undefined) ||
    (checkpointRequired && handle.checkpointDigest === undefined) ||
    (handle.status === "queued" &&
      (handle.checkpointDigest !== undefined ||
        handle.latestReceiptDigest !== undefined));
  if (checkpointContradiction) {
    issues.push(
      issue(
        "run-handle-checkpoint-contradiction",
        "/status",
        "Run status is inconsistent with retained checkpoint or receipt evidence.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkInputReplayTraceSemantics(
  trace: InputReplayTrace,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const eventIdentities = new Set<string>();
  const actionEndTicks = new Map<string, number>();
  let previousTick: number | undefined;

  for (const [index, event] of trace.events.entries()) {
    const path = `/events/${index}`;
    if (previousTick !== undefined && event.tick < previousTick) {
      issues.push(
        issue(
          "input-replay-event-order-invalid",
          `${path}/tick`,
          "Replay events must be ordered by nondecreasing tick.",
        ),
      );
    }
    previousTick = event.tick;

    const identity = `${event.tick}:${event.action}`;
    if (eventIdentities.has(identity)) {
      issues.push(
        issue(
          "input-replay-event-identity-collision",
          path,
          "A replay cannot contain the same action more than once at one tick.",
        ),
      );
    }
    eventIdentities.add(identity);

    const previousActionEnd = actionEndTicks.get(event.action);
    if (previousActionEnd !== undefined && event.tick < previousActionEnd) {
      issues.push(
        issue(
          "input-replay-event-overlap",
          path,
          "Intervals for the same replay action must not overlap.",
        ),
      );
    }
    const endTick = event.tick + event.durationTicks;
    if (!Number.isSafeInteger(endTick)) {
      issues.push(
        issue(
          "input-replay-event-order-invalid",
          `${path}/durationTicks`,
          "Replay event duration exceeds the safe tick range.",
        ),
      );
    } else {
      actionEndTicks.set(event.action, endTick);
    }
  }

  if (trace.oracle.outcome === "passed" && trace.divergenceCount !== 0) {
    issues.push(
      issue(
        "input-replay-oracle-contradiction",
        "/divergenceCount",
        "A passing deterministic replay cannot report divergence.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkAssetProvenanceSemantics(
  asset: AssetProvenance,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const approvals = new Set(asset.approvals);
  const promoted = asset.state === "approved" || asset.state === "production";

  if (
    asset.source.kind === "hosted-provider" &&
    (asset.generation === undefined ||
      asset.transfer === undefined ||
      asset.cost === undefined)
  ) {
    issues.push(
      issue(
        "asset-provenance-hosted-provider-incomplete",
        "/source/kind",
        "Hosted-provider assets require generation, transfer, and cost records.",
      ),
    );
  }

  const requiredApprovals: Array<{
    readonly approvalId: AssetProvenance["approvals"][number];
    readonly path: string;
  }> = [];
  if (asset.transfer !== undefined) {
    requiredApprovals.push({
      approvalId: asset.transfer.approvalId,
      path: "/transfer/approvalId",
    });
  }
  if (asset.cost !== undefined) {
    requiredApprovals.push({
      approvalId: asset.cost.approvalId,
      path: "/cost/approvalId",
    });
    if (asset.cost.actual !== undefined) {
      const estimated = decimalMicros(asset.cost.estimated);
      const actual = decimalMicros(asset.cost.actual);
      if (estimated !== undefined && actual !== undefined && actual > estimated) {
        issues.push(
          issue(
            "asset-provenance-cost-overrun",
            "/cost/actual",
            "Actual provider cost exceeds the approved estimate.",
          ),
        );
      }
    }
  }

  const stageIds = new Set<string>();
  const knownLineageHashes = new Set<string>();
  const promotionHashes = new Set<string>();
  let previousStageStart: number | undefined;
  let hasPromotionStage = false;
  for (const [index, stage] of asset.lineage.entries()) {
    const path = `/lineage/${index}`;
    if (stageIds.has(stage.stageId)) {
      issues.push(
        issue(
          "asset-provenance-lineage-invalid",
          `${path}/stageId`,
          "Lineage stage IDs must be unique.",
        ),
      );
    }
    stageIds.add(stage.stageId);

    const startedAt = timestampMillis(stage.startedAt);
    const endedAt = timestampMillis(stage.endedAt);
    if (
      startedAt === undefined ||
      endedAt === undefined ||
      startedAt > endedAt ||
      (previousStageStart !== undefined && startedAt < previousStageStart)
    ) {
      issues.push(
        issue(
          "asset-provenance-lineage-invalid",
          path,
          "Lineage stages must have valid timestamps in chronological order.",
        ),
      );
    }
    if (startedAt !== undefined) {
      previousStageStart = startedAt;
    }

    if (index === 0) {
      for (const hash of stage.inputHashes) {
        knownLineageHashes.add(hash);
      }
    } else if (
      stage.inputHashes.length === 0 ||
      stage.inputHashes.some((hash) => !knownLineageHashes.has(hash))
    ) {
      issues.push(
        issue(
          "asset-provenance-lineage-invalid",
          `${path}/inputHashes`,
          "Every later lineage stage must consume an earlier known hash.",
        ),
      );
    }
    for (const hash of stage.outputHashes) {
      knownLineageHashes.add(hash);
      if (stage.operation === "promote") {
        promotionHashes.add(hash);
      }
    }
    hasPromotionStage ||= stage.operation === "promote";
  }

  const acquiredAt = timestampMillis(asset.source.acquiredAt);
  const firstStageStartedAt =
    asset.lineage[0] === undefined
      ? undefined
      : timestampMillis(asset.lineage[0].startedAt);
  if (
    acquiredAt !== undefined &&
    firstStageStartedAt !== undefined &&
    acquiredAt > firstStageStartedAt
  ) {
    issues.push(
      issue(
        "asset-provenance-lineage-invalid",
        "/source/acquiredAt",
        "Asset acquisition cannot occur after lineage processing begins.",
      ),
    );
  }

  const currentPaths = new Set<string>();
  for (const [index, file] of asset.currentFiles.entries()) {
    if (currentPaths.has(file.path)) {
      issues.push(
        issue(
          "asset-provenance-current-file-invalid",
          `/currentFiles/${index}/path`,
          "Current asset file paths must be unique.",
        ),
      );
    }
    currentPaths.add(file.path);
    if (promoted && !promotionHashes.has(file.digest)) {
      issues.push(
        issue(
          "asset-provenance-promotion-invalid",
          `/currentFiles/${index}/digest`,
          "Promoted current files must be produced by the recorded lineage.",
        ),
      );
    }
  }

  const qaIds = new Set<string>();
  for (const [index, result] of asset.qa.entries()) {
    const path = `/qa/${index}`;
    if (qaIds.has(result.checkId)) {
      issues.push(
        issue(
          "asset-provenance-qa-invalid",
          `${path}/checkId`,
          "QA check IDs must be unique.",
        ),
      );
    }
    qaIds.add(result.checkId);
    if (
      (result.outcome === "pass" || result.outcome === "waived") &&
      result.artifactHashes.length === 0
    ) {
      issues.push(
        issue(
          "asset-provenance-qa-invalid",
          `${path}/artifactHashes`,
          "Passing and waived QA must identify the checked artifacts.",
        ),
      );
    }
    if (
      result.artifactHashes.some((hash) => !knownLineageHashes.has(hash))
    ) {
      issues.push(
        issue(
          "asset-provenance-qa-invalid",
          `${path}/artifactHashes`,
          "QA artifacts must occur in the recorded lineage.",
        ),
      );
    }
    if (result.outcome === "waived") {
      if (result.waiverApprovalId === undefined) {
        issues.push(
          issue(
            "asset-provenance-qa-invalid",
            `${path}/waiverApprovalId`,
            "Waived QA requires a dedicated approval.",
          ),
        );
      } else {
        requiredApprovals.push({
          approvalId: result.waiverApprovalId,
          path: `${path}/waiverApprovalId`,
        });
      }
    }
  }

  for (const required of requiredApprovals) {
    if (!approvals.has(required.approvalId)) {
      issues.push(
        issue(
          "asset-provenance-approval-missing",
          required.path,
          `Approval ${required.approvalId} is not retained by the asset record.`,
        ),
      );
    }
  }

  if (promoted) {
    const hasRightsEvidence =
      asset.rights.identifier !== undefined ||
      asset.rights.textDigest !== undefined ||
      asset.rights.userAssertion !== undefined;
    if (
      asset.rights.commercialUse !== "allowed" ||
      asset.rights.redistribution === "unknown" ||
      !hasRightsEvidence
    ) {
      issues.push(
        issue(
          "asset-provenance-rights-invalid",
          "/rights",
          "Approved and production assets require explicit commercial rights evidence.",
        ),
      );
    }
    if (!hasPromotionStage || asset.approvals.length === 0) {
      issues.push(
        issue(
          "asset-provenance-promotion-invalid",
          "/state",
          "Approved and production assets require a promotion stage and retained approval.",
        ),
      );
    }
    if (
      !asset.qa.some(({ outcome }) => outcome === "pass") ||
      asset.qa.some(
        ({ outcome }) => outcome === "fail" || outcome === "unverified",
      )
    ) {
      issues.push(
        issue(
          "asset-provenance-qa-invalid",
          "/qa",
          "Approved and production assets require passing QA with no failed or unverified result.",
        ),
      );
    }
  }

  return freezeIssues(issues);
}

export function checkFeatureContractSemantics(
  contract: FeatureContract,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const approvalRequired =
    contract.status === "approved" ||
    contract.status === "active" ||
    contract.status === "completed" ||
    contract.status === "expired";

  if (approvalRequired && contract.approval === undefined) {
    issues.push(
      issue(
        "feature-contract-approval-required",
        "/approval",
        `Feature status ${contract.status} must retain its user approval.`,
      ),
    );
  }

  if (contract.approval !== undefined) {
    const approvedAt = timestampMillis(contract.approval.approvedAt);
    const expiresAt = timestampMillis(contract.approval.expiresAt);
    if (approvedAt === undefined || expiresAt === undefined) {
      issues.push(
        issue(
          "feature-contract-approval-timestamp-invalid",
          "/approval",
          "Approval timestamps must be valid date-time values.",
        ),
      );
    } else if (approvedAt >= expiresAt) {
      issues.push(
        issue(
          "feature-contract-approval-window-invalid",
          "/approval/expiresAt",
          "Approval expiry must occur after approval time.",
        ),
      );
    }

    if (!isFeatureContractApprovalDigestValid(contract)) {
      issues.push(
        issue(
          "feature-contract-digest-mismatch",
          "/approval/contractDigest",
          "Approval digest does not attest the immutable feature contract body.",
        ),
      );
    }
  }

  const rollbackContradiction =
    (contract.rollback.mode === "required" &&
      (!contract.rollback.preimageRequired ||
        contract.rollback.commandId === undefined ||
        contract.rollback.requiredEvidence.length === 0)) ||
    (contract.rollback.mode === "not-applicable" &&
      (contract.rollback.preimageRequired ||
        contract.rollback.commandId !== undefined ||
        contract.rollback.requiredEvidence.length > 0));
  if (rollbackContradiction) {
    issues.push(
      issue(
        "feature-contract-rollback-contradiction",
        "/rollback",
        "Rollback declarations must be internally consistent with their mode.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkRunReceiptSemantics(
  receipt: RunReceipt,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  if (computeRunReceiptDigest(receipt) !== receipt.receiptDigest) {
    issues.push(
      issue(
        "run-receipt-digest-mismatch",
        "/receiptDigest",
        "Receipt digest must attest the canonical receipt body without the digest field.",
      ),
    );
  }
  if (receipt.previousReceiptDigest === receipt.receiptDigest) {
    issues.push(
      issue(
        "run-receipt-self-parent",
        "/previousReceiptDigest",
        "A receipt cannot name itself as its previous receipt.",
      ),
    );
  }
  if (
    (receipt.identity.featureId === undefined) !==
    (receipt.identity.featureContractDigest === undefined)
  ) {
    issues.push(
      issue(
        "run-receipt-feature-identity-invalid",
        "/identity",
        "Feature identity and feature contract digest must be retained together.",
      ),
    );
  }
  if (
    !isStrictlyCanonical(receipt.authority.packDigests) ||
    !isStrictlyCanonical(receipt.authority.approvalIds)
  ) {
    issues.push(
      issue(
        "run-receipt-authority-canonical-invalid",
        "/authority",
        "Pack and approval authority arrays must be strictly canonical.",
      ),
    );
  }
  if (
    !isStrictlyCanonical(receipt.effects.changedPaths) ||
    !isStrictlyCanonical(receipt.effects.objectIds) ||
    !isStrictlyCanonical(receipt.effects.destinations) ||
    !isStrictlyCanonical(receipt.effects.dataClasses) ||
    !isStrictlyCanonical(receipt.effects.changeKinds) ||
    !isStrictlyCanonical(receipt.effects.publishTargets)
  ) {
    issues.push(
      issue(
        "run-receipt-effect-canonical-invalid",
        "/effects",
        "Actual effect arrays must be strictly canonical.",
      ),
    );
  }
  if (receipt.effects.durationMs !== receipt.timing.durationMs) {
    issues.push(
      issue(
        "run-receipt-effect-duration-mismatch",
        "/effects/durationMs",
        "Actual effect duration must equal the attested run duration.",
      ),
    );
  }
  const mutationPaths = [
    ...receipt.mutation.changedFiles.map(({ path }) => path),
    ...receipt.mutation.unexpectedDirtyFiles,
  ].sort(compareCanonicalText);
  if (
    new Set(mutationPaths).size !== mutationPaths.length ||
    mutationPaths.length !== receipt.effects.changedPaths.length ||
    mutationPaths.some(
      (path, index) => path !== receipt.effects.changedPaths[index],
    )
  ) {
    issues.push(
      issue(
        "run-receipt-effect-mutation-mismatch",
        "/effects/changedPaths",
        "Actual changed paths must exactly reconcile declared file mutations.",
      ),
    );
  }
  const startedAt = timestampMillis(receipt.timing.startedAt);
  const endedAt = timestampMillis(receipt.timing.endedAt);
  if (startedAt === undefined || endedAt === undefined || endedAt < startedAt) {
    issues.push(
      issue(
        "run-receipt-invalid-timestamp",
        "/timing",
        "Run timing must contain ordered valid timestamps.",
      ),
    );
  } else if (endedAt - startedAt !== receipt.timing.durationMs) {
    issues.push(
      issue(
        "run-receipt-duration-mismatch",
        "/timing/durationMs",
        "Run duration must equal the elapsed timestamp interval.",
      ),
    );
  }

  const tests = receipt.outcomes.tests;
  if (tests !== undefined) {
    if (tests.discovered !== tests.passed + tests.failed + tests.skipped) {
      issues.push(
        issue(
          "run-receipt-test-count-mismatch",
          "/outcomes/tests",
          "Discovered tests must equal passed, failed, and skipped tests.",
        ),
      );
    }
    if (
      tests.status === "passed" &&
      (tests.discovered === 0 || tests.passed === 0 || tests.failed !== 0)
    ) {
      issues.push(
        issue(
          "run-receipt-test-pass-contradiction",
          "/outcomes/tests/status",
          "A passing test outcome requires discovered and passed tests with no failures.",
        ),
      );
    }
  }

  if (
    receipt.status === "succeeded" &&
    (receipt.outcomes.outer.status !== "passed" ||
      receipt.outcomes.outer.timedOut ||
      (receipt.outcomes.outer.exitCode !== undefined &&
        receipt.outcomes.outer.exitCode !== 0) ||
      receipt.outcomes.inner.status !== "passed" ||
      (tests !== undefined && tests.status !== "passed") ||
      receipt.mutation.status === "uncertain")
  ) {
    issues.push(
      issue(
        "run-receipt-success-contradiction",
        "/status",
        "A succeeded receipt requires successful outer, inner, optional test, and mutation outcomes.",
      ),
    );
  }

  if (
    receipt.mutation.status === "uncertain" &&
    receipt.status !== "uncertain"
  ) {
    issues.push(
      issue(
        "run-receipt-uncertain-mutation-contradiction",
        "/mutation/status",
        "An uncertain mutation requires an uncertain receipt.",
      ),
    );
  }

  if (
    receipt.status === "succeeded" &&
    receipt.mutation.unexpectedDirtyFiles.length > 0
  ) {
    issues.push(
      issue(
        "run-receipt-unexpected-dirty-success",
        "/mutation/unexpectedDirtyFiles",
        "A receipt with unexpected dirty files cannot succeed.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkEngineCapabilityReportSemantics(
  report: EngineCapabilityReport,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const ids = new Set<string>();
  const operations = new Set<string>();
  const generatedAt = timestampMillis(report.generatedAt);

  for (const [index, capability] of report.capabilities.entries()) {
    const path = `/capabilities/${index}`;
    if (ids.has(capability.id)) {
      issues.push(
        issue(
          "engine-capability-duplicate-id",
          `${path}/id`,
          "Capability IDs must be unique within a report.",
        ),
      );
    }
    ids.add(capability.id);

    const operationIdentity = `${capability.operation}@${capability.operationVersion}`;
    if (operations.has(operationIdentity)) {
      issues.push(
        issue(
          "engine-capability-duplicate-operation",
          `${path}/operation`,
          "An operation and version may appear only once within a report.",
        ),
      );
    }
    operations.add(operationIdentity);

    const checkedAt = timestampMillis(capability.checkedAt);
    if (
      generatedAt !== undefined &&
      checkedAt !== undefined &&
      checkedAt > generatedAt
    ) {
      issues.push(
        issue(
          "engine-capability-future-observation",
          `${path}/checkedAt`,
          "A capability observation cannot occur after its report was generated.",
        ),
      );
    }

    if (
      capability.support === "planned" &&
      capability.degradeReason === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-planned-without-reason",
          `${path}/degradeReason`,
          "Planned support must state why the operation is not available.",
        ),
      );
    }
    if (
      (capability.support === "detected" || capability.support === "headless") &&
      capability.evidenceGrade !== "locally-executed" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-observed-without-execution-evidence",
          `${path}/evidenceGrade`,
          "Detected and headless support require locally executed or engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support === "editor-preview" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-editor-without-engine-evidence",
          `${path}/evidenceGrade`,
          "Editor-preview support requires engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support !== "planned" &&
      capability.support !== "verified" &&
      capability.latestReceiptDigest === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-observed-without-receipt",
          `${path}/latestReceiptDigest`,
          "Observed support requires a receipt digest.",
        ),
      );
    }
    if (
      capability.support === "verified" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-verified-without-runtime-evidence",
          `${path}/evidenceGrade`,
          "Verified support requires engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support === "verified" &&
      capability.latestReceiptDigest === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-verified-without-receipt",
          `${path}/latestReceiptDigest`,
          "Verified support requires a receipt digest.",
        ),
      );
    }
  }

  return freezeIssues(issues);
}
