import {
  compareCanonicalText,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  finalizeDetachedProjectDirectoryCasRemoval,
  type PermissionSettlement,
} from "@ai-game-playbook/core";
import { performance } from "node:perf_hooks";

import {
  clearActivePackTransactionRecord,
  PACK_ACTIVE_TRANSACTION_MAX_BYTES,
  PACK_ACTIVE_TRANSACTION_PATH,
  writeActivePackTransactionRecord,
} from "./active-transaction.js";
import { assertPackAuthorizationActive } from "./authorization.js";
import { PackRuntimeError } from "./errors.js";
import {
  internalsForPreparedPackRecoveryFinalization,
  type ActionablePackRecoveryFinalization,
  type PreparedPackRecoveryFinalization,
} from "./recovery-plan.js";
import { validatePackRecoveryAuthority } from "./recovery-authorization.js";
import {
  inspectPackTransactionRecovery,
  internalsForPackTransactionRecoveryReport,
} from "./recovery.js";
import { PACK_INSTALLED_STATE_PATH } from "./state.js";
import {
  createPackTransactionReconciliation,
  createTerminalPackTransaction,
  packTransactionRecordPath,
  PACK_TRANSACTION_DIRECTORY,
  PACK_TRANSACTION_MAX_RECORD_BYTES,
  serializePackTransactionRecord,
  writePackTransactionRecord,
  type PackTransactionReconciliationRecord,
  type PackTransactionStartedRecord,
  type PackTransactionTerminalRecord,
} from "./transaction-journal.js";

type MutableRecord = Record<string, unknown>;

interface RecoveryTracker {
  readonly touchedPaths: Set<string>;
  changedBytes: number;
}

interface RecoveryFailure {
  readonly code: string;
  readonly path: string;
  readonly mutationUncertain: boolean;
}

export interface FinalizePackTransactionRecoveryRequest {
  readonly plan: PreparedPackRecoveryFinalization;
  readonly authorization: unknown;
  readonly lane: unknown;
}

export interface PackRecoveryFinalizationResult {
  readonly schemaVersion: "1.0.0";
  readonly status: "failed" | "finalized" | "recovery-required" | "stale";
  readonly action: ActionablePackRecoveryFinalization;
  readonly finalOutcome: PreparedPackRecoveryFinalization["finalOutcome"];
  readonly reportDigest: Sha256Digest;
  readonly finalReportDigest?: Sha256Digest;
  readonly mutationUncertain: boolean;
  readonly effects: {
    readonly changedPaths: readonly string[];
    readonly changedBytes: number;
  };
  readonly settlement: PermissionSettlement;
  readonly journalRecordDigest?: Sha256Digest;
  readonly error?: {
    readonly code: string;
    readonly path: string;
  };
}

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(value: MutableRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...values].sort(compareCanonicalText));
}

function canonicalNowAtLeast(minimum: string): string {
  return new Date(Math.max(Date.now(), Date.parse(minimum) + 1)).toISOString();
}

function summarizeFailure(error: unknown, path: string): RecoveryFailure {
  if (error instanceof PackRuntimeError || error instanceof CoreBoundaryError) {
    return Object.freeze({
      code: error.code,
      path: error.path,
      mutationUncertain: error.mutationUncertain,
    });
  }
  return Object.freeze({
    code: "pack-execution-failed",
    path,
    mutationUncertain: false,
  });
}

async function assertForwardAuthority(
  authority: Awaited<ReturnType<typeof validatePackRecoveryAuthority>>,
): Promise<void> {
  assertPackAuthorizationActive(authority.authorization);
  try {
    await authority.lane.assertOwned();
  } catch {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "project lane ownership was lost during recovery finalization",
      true,
    );
  }
  assertPackAuthorizationActive(authority.authorization);
}

function actualEffects(tracker: RecoveryTracker, startedAt: number) {
  return {
    changedPaths: sorted(tracker.touchedPaths),
    changedBytes: tracker.changedBytes,
    objectIds: [],
    destinations: [],
    dataClasses: [],
    changeKinds:
      tracker.touchedPaths.size === 0 ? [] : (["config"] as const),
    publishTargets: [],
    durationMs: Math.max(
      0,
      Math.min(604_800_000, Math.ceil(performance.now() - startedAt)),
    ),
    outputBytes: 0,
    repairCycles: 0,
  };
}

function settle(
  authority: Awaited<ReturnType<typeof validatePackRecoveryAuthority>>,
  tracker: RecoveryTracker,
  startedAt: number,
  outcome: "failed" | "succeeded" | "uncertain",
  mutationUncertain: boolean,
): PermissionSettlement {
  try {
    return authority.authorization.lease.settle({
      outcome: mutationUncertain ? "uncertain" : outcome,
      mutationUncertain,
      actual: actualEffects(tracker, startedAt),
    });
  } catch {
    throw new PackRuntimeError(
      "pack-execution-uncertain",
      "$settlement",
      "pack recovery effects could not be settled with the permission broker",
      tracker.touchedPaths.size > 0 || mutationUncertain,
    );
  }
}

function result(
  plan: PreparedPackRecoveryFinalization,
  status: PackRecoveryFinalizationResult["status"],
  mutationUncertain: boolean,
  tracker: RecoveryTracker,
  settlement: PermissionSettlement,
  finalReportDigest?: Sha256Digest,
  journalRecordDigest?: Sha256Digest,
  failure?: RecoveryFailure,
): PackRecoveryFinalizationResult {
  return Object.freeze({
    schemaVersion: "1.0.0",
    status,
    action: plan.action,
    finalOutcome: plan.finalOutcome,
    reportDigest: plan.reportDigest,
    ...(finalReportDigest === undefined ? {} : { finalReportDigest }),
    mutationUncertain,
    effects: Object.freeze({
      changedPaths: sorted(tracker.touchedPaths),
      changedBytes: tracker.changedBytes,
    }),
    settlement,
    ...(journalRecordDigest === undefined ? {} : { journalRecordDigest }),
    ...(failure === undefined
      ? {}
      : { error: Object.freeze({ code: failure.code, path: failure.path }) }),
  });
}

function terminalTouchedPaths(
  started: PackTransactionStartedRecord,
  committed: boolean,
): readonly string[] {
  const paths = new Set<string>([
    PACK_ACTIVE_TRANSACTION_PATH,
    packTransactionRecordPath(started.runId, 0),
    packTransactionRecordPath(started.runId, 1),
  ]);
  if (committed) {
    paths.add(PACK_INSTALLED_STATE_PATH);
    for (const change of started.changes) paths.add(change.path);
    for (const change of started.directoryChanges ?? []) {
      if (change.kind === "retain") continue;
      paths.add(change.path);
      if (change.kind === "delete") {
        paths.add(change.tombstonePath);
        paths.add(`${change.tombstonePath}/owned`);
      }
    }
  }
  return sorted(paths);
}

function terminalAppliedPaths(
  started: PackTransactionStartedRecord,
): readonly string[] {
  const paths = new Set(
    started.changes
      .filter(({ kind }) => kind !== "unchanged")
      .map(({ path }) => path),
  );
  for (const change of started.directoryChanges ?? []) {
    if (change.kind === "create") {
      paths.add(change.path);
    } else if (change.kind === "delete") {
      paths.add(change.path);
      paths.add(change.tombstonePath);
      paths.add(`${change.tombstonePath}/owned`);
    }
  }
  return sorted(paths);
}

async function appendTerminal(
  plan: PreparedPackRecoveryFinalization,
  started: PackTransactionStartedRecord,
  root: ReturnType<
    typeof internalsForPreparedPackRecoveryFinalization
  >["reportInternals"]["root"],
  maxDirectoryEntries: number,
): Promise<PackTransactionTerminalRecord> {
  const committed = plan.finalOutcome === "committed";
  const terminal = createTerminalPackTransaction({
    started,
    outcome: committed ? "committed" : "failed",
    mutationUncertain: false,
    touchedPaths: terminalTouchedPaths(started, committed),
    appliedPaths: committed ? terminalAppliedPaths(started) : [],
    rolledBackPaths: [],
    ...(committed
      ? { installedStateAfterDigest: started.installedStateAfter.digest }
      : {}),
    endedAt: canonicalNowAtLeast(started.startedAt),
  });
  await writePackTransactionRecord(root, terminal, maxDirectoryEntries);
  return terminal;
}

async function appendReconciliation(
  plan: PreparedPackRecoveryFinalization,
  started: PackTransactionStartedRecord,
  terminal: PackTransactionTerminalRecord,
  authority: Awaited<ReturnType<typeof validatePackRecoveryAuthority>>,
  root: ReturnType<
    typeof internalsForPreparedPackRecoveryFinalization
  >["reportInternals"]["root"],
  maxDirectoryEntries: number,
): Promise<PackTransactionReconciliationRecord> {
  const reconciliation = createPackTransactionReconciliation({
    started,
    terminal,
    outcome: plan.finalOutcome === "committed" ? "committed" : "failed",
    observedState:
      plan.finalOutcome === "committed" ? "postimage" : "preimage",
    authorizationId: authority.authorization.lease.authorizationId,
    requestDigest: authority.authorization.challenge.requestDigest,
    recoveryReportDigest: plan.reportDigest,
    touchedPaths: plan.paths,
    reconciledAt: canonicalNowAtLeast(terminal.endedAt),
  });
  await writePackTransactionRecord(root, reconciliation, maxDirectoryEntries);
  return reconciliation;
}

async function restoreActiveBarrier(
  root: ReturnType<
    typeof internalsForPreparedPackRecoveryFinalization
  >["reportInternals"]["root"],
  active: NonNullable<
    ReturnType<
      typeof internalsForPackTransactionRecoveryReport
    >["active"]
  >,
  maxDirectoryEntries: number,
  lane: Awaited<ReturnType<typeof validatePackRecoveryAuthority>>["lane"],
  tracker: RecoveryTracker,
): Promise<RecoveryFailure | undefined> {
  try {
    await lane.assertOwned();
    const restored = await writeActivePackTransactionRecord({
      root,
      record: active.record,
      maxDirectoryEntries,
    });
    tracker.touchedPaths.add(PACK_ACTIVE_TRANSACTION_PATH);
    tracker.changedBytes += restored.bytes;
    return undefined;
  } catch (error) {
    tracker.touchedPaths.add(PACK_ACTIVE_TRANSACTION_PATH);
    tracker.changedBytes += PACK_ACTIVE_TRANSACTION_MAX_BYTES;
    return Object.freeze({
      ...summarizeFailure(error, PACK_ACTIVE_TRANSACTION_PATH),
      mutationUncertain: true,
    });
  }
}

export async function finalizePackTransactionRecovery(
  value: FinalizePackTransactionRecoveryRequest,
): Promise<PackRecoveryFinalizationResult> {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["plan", "authorization", "lane"])
  ) {
    throw new PackRuntimeError(
      "invalid-pack-recovery-request",
      "$request",
      "pack recovery finalization request is malformed",
    );
  }
  const plan = value.plan;
  const planInternals = internalsForPreparedPackRecoveryFinalization(plan);
  const authority = await validatePackRecoveryAuthority(
    plan,
    value.authorization,
    value.lane,
  );
  const startedAt = performance.now();
  const tracker: RecoveryTracker = {
    touchedPaths: new Set<string>(),
    changedBytes: 0,
  };
  const maxDirectoryEntries =
    planInternals.reportInternals.journal.started.limits.maxDirectoryEntries;

  let freshReport;
  try {
    await assertForwardAuthority(authority);
    freshReport = await inspectPackTransactionRecovery({
      root: planInternals.reportInternals.root,
      runId: plan.transactionRunId,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      maxDirectoryEntries,
    });
    await assertForwardAuthority(authority);
  } catch (error) {
    const failure = summarizeFailure(error, "$recovery.inspect");
    const mutationUncertain = failure.mutationUncertain;
    const settlement = settle(
      authority,
      tracker,
      startedAt,
      mutationUncertain ? "uncertain" : "failed",
      mutationUncertain,
    );
    return result(
      plan,
      mutationUncertain ? "recovery-required" : "stale",
      mutationUncertain,
      tracker,
      settlement,
      undefined,
      undefined,
      failure,
    );
  }
  if (
    freshReport.reportDigest !== plan.reportDigest ||
    freshReport.finalizationAction !== plan.action ||
    freshReport.finalizationOutcome !== plan.finalOutcome
  ) {
    const failure: RecoveryFailure = Object.freeze({
      code: "pack-recovery-stale",
      path: "$request.plan",
      mutationUncertain: false,
    });
    const settlement = settle(
      authority,
      tracker,
      startedAt,
      "failed",
      false,
    );
    return result(
      plan,
      "stale",
      false,
      tracker,
      settlement,
      freshReport.reportDigest,
      undefined,
      failure,
    );
  }

  const freshInternals = internalsForPackTransactionRecoveryReport(freshReport);
  const active = freshInternals.active;
  if (active === undefined) {
    const failure: RecoveryFailure = Object.freeze({
      code: "pack-recovery-stale",
      path: PACK_ACTIVE_TRANSACTION_PATH,
      mutationUncertain: false,
    });
    const settlement = settle(
      authority,
      tracker,
      startedAt,
      "failed",
      false,
    );
    return result(
      plan,
      "stale",
      false,
      tracker,
      settlement,
      freshReport.reportDigest,
      undefined,
      failure,
    );
  }

  let journalRecordDigest: Sha256Digest | undefined;
  let finalizedDirectoryCount = 0;
  try {
    for (const cleanup of freshReport.directoryCleanup) {
      await assertForwardAuthority(authority);
      await finalizeDetachedProjectDirectoryCasRemoval({
        root: freshInternals.root,
        path: cleanup.path,
        expectedIdentity: cleanup.expectedIdentity,
        tombstonePath: cleanup.tombstonePath,
        maxDirectoryEntries,
      });
      finalizedDirectoryCount += 1;
      tracker.touchedPaths.add(cleanup.path);
      tracker.touchedPaths.add(cleanup.tombstonePath);
      tracker.touchedPaths.add(`${cleanup.tombstonePath}/owned`);
    }
    if (plan.action === "append-started-and-terminal") {
      await assertForwardAuthority(authority);
      const written = await writePackTransactionRecord(
        freshInternals.root,
        freshInternals.journal.started,
        maxDirectoryEntries,
      );
      tracker.touchedPaths.add(written.path);
      tracker.changedBytes += written.bytes;
    }
    if (
      plan.action === "append-started-and-terminal" ||
      plan.action === "append-terminal"
    ) {
      await assertForwardAuthority(authority);
      const terminal = await appendTerminal(
        plan,
        freshInternals.journal.started,
        freshInternals.root,
        maxDirectoryEntries,
      );
      const terminalPath = packTransactionRecordPath(plan.transactionRunId, 1);
      tracker.touchedPaths.add(terminalPath);
      tracker.changedBytes += serializePackTransactionRecord(terminal).byteLength;
      journalRecordDigest = terminal.recordDigest;
    }
    if (plan.action === "append-reconciliation") {
      const terminal = freshInternals.journal.terminal;
      if (terminal === undefined) {
        throw new PackRuntimeError(
          "pack-recovery-stale",
          packTransactionRecordPath(plan.transactionRunId, 1),
          "recovery-required terminal disappeared before reconciliation",
        );
      }
      await assertForwardAuthority(authority);
      const reconciliation = await appendReconciliation(
        plan,
        freshInternals.journal.started,
        terminal,
        authority,
        freshInternals.root,
        maxDirectoryEntries,
      );
      const reconciliationPath = packTransactionRecordPath(
        plan.transactionRunId,
        2,
      );
      tracker.touchedPaths.add(reconciliationPath);
      tracker.changedBytes +=
        serializePackTransactionRecord(reconciliation).byteLength;
      journalRecordDigest = reconciliation.recordDigest;
    }

    await assertForwardAuthority(authority);
    const beforeClear = await inspectPackTransactionRecovery({
      root: freshInternals.root,
      runId: plan.transactionRunId,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      maxDirectoryEntries,
    });
    const beforeClearJournalMatches =
      beforeClear.startedRecordDigest === freshReport.startedRecordDigest &&
      (plan.action === "append-reconciliation"
        ? beforeClear.reconciliationRecordDigest === journalRecordDigest
        : plan.action === "append-started-and-terminal" ||
            plan.action === "append-terminal"
          ? beforeClear.terminalRecordDigest === journalRecordDigest
          : beforeClear.journalSnapshotDigest === plan.journalSnapshotDigest);
    if (
      !beforeClear.stable ||
      beforeClear.activeMarker !== "matching" ||
      beforeClear.finalizationAction !== "clear-marker" ||
      beforeClear.finalizationOutcome !== plan.finalOutcome ||
      !beforeClearJournalMatches
    ) {
      throw new PackRuntimeError(
        "pack-execution-uncertain",
        "$recovery.beforeClear",
        "recovery state changed before the active barrier could be cleared",
        true,
      );
    }
    await assertForwardAuthority(authority);
    const cleared = await clearActivePackTransactionRecord({
      root: freshInternals.root,
      active,
      maxDirectoryEntries,
    });
    tracker.touchedPaths.add(PACK_ACTIVE_TRANSACTION_PATH);
    tracker.changedBytes += cleared.bytes;
  } catch (error) {
    let failure = summarizeFailure(error, "$recovery.finalize");
    if (finalizedDirectoryCount > 0 && !failure.mutationUncertain) {
      failure = Object.freeze({ ...failure, mutationUncertain: true });
    }
    if (failure.mutationUncertain && plan.paths.includes(failure.path)) {
      tracker.touchedPaths.add(failure.path);
      if (failure.path === PACK_ACTIVE_TRANSACTION_PATH) {
        tracker.changedBytes += PACK_ACTIVE_TRANSACTION_MAX_BYTES;
      } else if (
        failure.path.startsWith(`${PACK_TRANSACTION_DIRECTORY}/`) &&
        failure.path.endsWith(".json")
      ) {
        tracker.changedBytes += PACK_TRANSACTION_MAX_RECORD_BYTES;
      }
    }
    const mutationUncertain = failure.mutationUncertain;
    const settlement = settle(
      authority,
      tracker,
      startedAt,
      mutationUncertain ? "uncertain" : "failed",
      mutationUncertain,
    );
    return result(
      plan,
      mutationUncertain ? "recovery-required" : "failed",
      mutationUncertain,
      tracker,
      settlement,
      freshReport.reportDigest,
      journalRecordDigest,
      failure,
    );
  }

  let finalReport;
  try {
    await assertForwardAuthority(authority);
    finalReport = await inspectPackTransactionRecovery({
      root: freshInternals.root,
      runId: plan.transactionRunId,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      maxDirectoryEntries,
    });
    if (
      finalReport.consistency !== "consistent" ||
      finalReport.finalizationAction !== "none" ||
      finalReport.finalizationOutcome !== plan.finalOutcome ||
      finalReport.startedRecordDigest !== freshReport.startedRecordDigest ||
      (plan.action === "append-reconciliation"
        ? finalReport.reconciliationRecordDigest !== journalRecordDigest
        : plan.action === "append-started-and-terminal" ||
            plan.action === "append-terminal"
          ? finalReport.terminalRecordDigest !== journalRecordDigest
          : finalReport.journalSnapshotDigest !== plan.journalSnapshotDigest)
    ) {
      throw new PackRuntimeError(
        "pack-execution-uncertain",
        "$recovery.verify",
        "recovery closure could not be verified after mutation",
        true,
      );
    }
  } catch (error) {
    let failure: RecoveryFailure = Object.freeze({
      ...summarizeFailure(error, "$recovery.verify"),
      mutationUncertain: true,
    });
    if (finalReport === undefined || finalReport.activeMarker === "absent") {
      failure =
        (await restoreActiveBarrier(
          freshInternals.root,
          active,
          maxDirectoryEntries,
          authority.lane,
          tracker,
        )) ?? failure;
    }
    const settlement = settle(
      authority,
      tracker,
      startedAt,
      "uncertain",
      true,
    );
    return result(
      plan,
      "recovery-required",
      true,
      tracker,
      settlement,
      finalReport?.reportDigest,
      journalRecordDigest,
      failure,
    );
  }

  const settlement = settle(
    authority,
    tracker,
    startedAt,
    "succeeded",
    false,
  );
  return result(
    plan,
    "finalized",
    false,
    tracker,
    settlement,
    finalReport.reportDigest,
    journalRecordDigest,
  );
}
