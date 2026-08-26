import {
  canonicalizeJson,
  compareCanonicalText,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  readProjectFileSnapshot,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";

import {
  loadActivePackTransactionRecord,
  type LoadedActivePackTransaction,
} from "./active-transaction.js";
import { PackRuntimeError } from "./errors.js";
import { PACK_INSTALLED_STATE_MAX_BYTES, PACK_INSTALLED_STATE_PATH } from "./state.js";
import {
  loadPackTransactionJournal,
  type LoadedPackTransactionJournal,
  type PackTransactionOutcome,
  type PackTransactionStartedRecord,
} from "./transaction-journal.js";
import type { PackChange } from "./types.js";

type MutableRecord = Record<string, unknown>;

export type PackRecoveryExpectedFile =
  | { readonly kind: "absent" }
  | { readonly kind: "file"; readonly digest: Sha256Digest };

export type PackRecoveryActualFile =
  | { readonly kind: "absent" }
  | {
      readonly kind: "file";
      readonly digest: Sha256Digest;
      readonly bytes: number;
    }
  | { readonly kind: "unreadable"; readonly errorCode: string };

export type PackRecoveryObservationMatch =
  | "after"
  | "before"
  | "both"
  | "neither";

export type PackRecoveryFinalizationAction =
  | "append-reconciliation"
  | "append-started-and-terminal"
  | "append-terminal"
  | "blocked"
  | "clear-marker"
  | "none";

export type PackRecoveryFinalizationOutcome =
  | "committed"
  | "failed"
  | "rolled-back";

export interface PackRecoveryObservation {
  readonly path: string;
  readonly role: "artifact" | "installed-state";
  readonly before: PackRecoveryExpectedFile;
  readonly after: PackRecoveryExpectedFile;
  readonly actual: PackRecoveryActualFile;
  readonly match: PackRecoveryObservationMatch;
}

export interface InspectPackTransactionRecoveryRequest {
  readonly root: unknown;
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly maxDirectoryEntries: number;
}

export interface PackTransactionRecoveryReport {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
  };
  readonly journal:
    | "marker-only"
    | "reconciled"
    | "started-only"
    | "terminal";
  readonly journalSnapshotDigest: Sha256Digest;
  readonly startedRecordDigest: Sha256Digest;
  readonly terminalRecordDigest?: Sha256Digest;
  readonly reconciliationRecordDigest?: Sha256Digest;
  readonly activeMarker: "absent" | "matching" | "other";
  readonly activeMarkerFileDigest?: Sha256Digest;
  readonly observedState: "mixed" | "postimage" | "preimage";
  readonly consistency:
    | "consistent"
    | "contradictory"
    | "incomplete"
    | "unresolved";
  readonly stable: boolean;
  readonly mutationUncertain: boolean;
  readonly recordedOutcome?: PackTransactionOutcome;
  readonly safeTerminalOutcome?: "committed" | "failed";
  readonly finalizationAction: PackRecoveryFinalizationAction;
  readonly finalizationOutcome?: PackRecoveryFinalizationOutcome;
  readonly observations: readonly PackRecoveryObservation[];
  readonly reportDigest: Sha256Digest;
}

interface ObservationBudget {
  bytes: number;
}

type PackRecoveryJournalSource = "journal" | "marker";

interface PackRecoveryJournalSnapshot {
  readonly journal: LoadedPackTransactionJournal;
  readonly source: PackRecoveryJournalSource;
}

interface PackRecoveryReportInternals {
  readonly root: CanonicalProjectRoot;
  readonly active: LoadedActivePackTransaction | undefined;
  readonly journal: LoadedPackTransactionJournal;
  readonly source: PackRecoveryJournalSource;
}

const recoveryReportInternals = new WeakMap<
  PackTransactionRecoveryReport,
  PackRecoveryReportInternals
>();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function validateRequest(
  value: InspectPackTransactionRecoveryRequest,
): InspectPackTransactionRecoveryRequest {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["root", "runId", "project", "maxDirectoryEntries"]) ||
    !UUID_PATTERN.test(value.runId) ||
    !isRecord(value.project) ||
    !exactKeys(value.project, ["id", "identityDigest"]) ||
    !isStableId(value.project.id) ||
    !isSha256Digest(value.project.identityDigest) ||
    !Number.isSafeInteger(value.maxDirectoryEntries) ||
    value.maxDirectoryEntries < 1 ||
    value.maxDirectoryEntries > 100_000
  ) {
    throw new PackRuntimeError(
      "invalid-pack-recovery-request",
      "$request",
      "pack transaction recovery request is invalid",
    );
  }
  return Object.freeze({
    root: value.root,
    runId: value.runId,
    project: Object.freeze({ ...value.project }),
    maxDirectoryEntries: value.maxDirectoryEntries,
  });
}

function absent(): PackRecoveryExpectedFile {
  return Object.freeze({ kind: "absent" });
}

function file(digest: Sha256Digest): PackRecoveryExpectedFile {
  return Object.freeze({ kind: "file", digest });
}

function expectedForChange(
  change: PackChange,
): readonly [PackRecoveryExpectedFile, PackRecoveryExpectedFile] {
  if (change.kind === "create") return Object.freeze([absent(), file(change.afterDigest)]);
  if (change.kind === "delete") return Object.freeze([file(change.beforeDigest), absent()]);
  return Object.freeze([file(change.beforeDigest), file(change.afterDigest)]);
}

function expectedMatches(
  expected: PackRecoveryExpectedFile,
  actual: PackRecoveryActualFile,
): boolean {
  return (
    (expected.kind === "absent" && actual.kind === "absent") ||
    (expected.kind === "file" &&
      actual.kind === "file" &&
      expected.digest === actual.digest)
  );
}

function observationMatch(
  before: PackRecoveryExpectedFile,
  after: PackRecoveryExpectedFile,
  actual: PackRecoveryActualFile,
): PackRecoveryObservationMatch {
  const matchesBefore = expectedMatches(before, actual);
  const matchesAfter = expectedMatches(after, actual);
  if (matchesBefore && matchesAfter) return "both";
  if (matchesBefore) return "before";
  if (matchesAfter) return "after";
  return "neither";
}

async function observeFile(
  root: CanonicalProjectRoot,
  path: string,
  maxBytes: number,
  maxDirectoryEntries: number,
): Promise<PackRecoveryActualFile> {
  try {
    const snapshot = await readProjectFileSnapshot({
      root,
      path,
      maxBytes,
      maxDirectoryEntries,
    });
    return Object.freeze({
      kind: "file",
      digest: snapshot.digest,
      bytes: snapshot.bytes,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return Object.freeze({ kind: "absent" });
    }
    if (error instanceof CoreBoundaryError) {
      return Object.freeze({ kind: "unreadable", errorCode: error.code });
    }
    return Object.freeze({
      kind: "unreadable",
      errorCode: "filesystem-operation-failed",
    });
  }
}

async function collectObservations(
  root: CanonicalProjectRoot,
  started: PackTransactionStartedRecord,
  requestMaxDirectoryEntries: number,
): Promise<readonly PackRecoveryObservation[]> {
  const maxDirectoryEntries = Math.min(
    requestMaxDirectoryEntries,
    started.limits.maxDirectoryEntries,
  );
  const budget: ObservationBudget = { bytes: 0 };
  const observations: PackRecoveryObservation[] = [];
  for (const change of started.changes) {
    const [before, after] = expectedForChange(change);
    const actual = await observeFile(
      root,
      change.path,
      started.limits.maxArtifactBytes,
      maxDirectoryEntries,
    );
    if (actual.kind === "file") {
      budget.bytes += actual.bytes;
      if (budget.bytes > started.limits.maxTotalBytes) {
        throw new PackRuntimeError(
          "pack-recovery-budget-exceeded",
          change.path,
          "recovery observation exceeded the transaction byte budget",
        );
      }
    }
    observations.push(
      Object.freeze({
        path: change.path,
        role: "artifact",
        before,
        after,
        actual,
        match: observationMatch(before, after, actual),
      }),
    );
  }

  const beforeState =
    started.installedState.fileDigest === undefined
      ? absent()
      : file(started.installedState.fileDigest);
  const afterState = file(started.installedStateAfter.fileDigest);
  const actualState = await observeFile(
    root,
    PACK_INSTALLED_STATE_PATH,
    PACK_INSTALLED_STATE_MAX_BYTES,
    maxDirectoryEntries,
  );
  observations.push(
    Object.freeze({
      path: PACK_INSTALLED_STATE_PATH,
      role: "installed-state",
      before: beforeState,
      after: afterState,
      actual: actualState,
      match: observationMatch(beforeState, afterState, actualState),
    }),
  );
  observations.sort((left, right) => compareCanonicalText(left.path, right.path));
  return Object.freeze(observations);
}

function observedState(
  observations: readonly PackRecoveryObservation[],
): PackTransactionRecoveryReport["observedState"] {
  if (
    observations.every(
      ({ match }) => match === "before" || match === "both",
    )
  ) {
    return "preimage";
  }
  if (
    observations.every(
      ({ match }) => match === "after" || match === "both",
    )
  ) {
    return "postimage";
  }
  return "mixed";
}

function activeMarkerStatus(
  active: LoadedActivePackTransaction | undefined,
  started: PackTransactionStartedRecord,
): PackTransactionRecoveryReport["activeMarker"] {
  if (active === undefined) return "absent";
  return active.record.runId === started.runId &&
    active.record.planDigest === started.planDigest &&
    active.record.startedRecordDigest === started.recordDigest
    ? "matching"
    : "other";
}

function sameActiveMarker(
  before: LoadedActivePackTransaction | undefined,
  after: LoadedActivePackTransaction | undefined,
): boolean {
  return before?.fileDigest === after?.fileDigest;
}

function freezeReport(
  report: PackTransactionRecoveryReport,
): PackTransactionRecoveryReport {
  return Object.freeze({
    ...report,
    project: Object.freeze({ ...report.project }),
    observations: Object.freeze([...report.observations]),
  });
}

export function computePackTransactionRecoveryReportDigest(
  report: Omit<PackTransactionRecoveryReport, "reportDigest"> &
    Partial<Pick<PackTransactionRecoveryReport, "reportDigest">>,
): Sha256Digest {
  const { reportDigest: _reportDigest, ...body } = report;
  return digestCanonicalJson({
    domain: "ai-game-playbook.pack-transaction-recovery-report",
    version: "1",
    report: body,
  });
}

export function internalsForPackTransactionRecoveryReport(
  report: PackTransactionRecoveryReport,
): PackRecoveryReportInternals {
  const internals = recoveryReportInternals.get(report);
  if (
    internals === undefined ||
    computePackTransactionRecoveryReportDigest(report) !== report.reportDigest
  ) {
    throw new PackRuntimeError(
      "pack-recovery-report-untrusted",
      "$request.report",
      "pack recovery requires a same-process attested inspection report",
    );
  }
  return internals;
}

export function computePackRecoveryJournalSnapshotDigest(
  journal: LoadedPackTransactionJournal,
  source: PackRecoveryJournalSource,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook.pack-recovery-journal-snapshot",
    version: "1",
    source,
    startedRecordDigest: journal.started.recordDigest,
    terminalRecordDigest: journal.terminal?.recordDigest ?? null,
    reconciliationRecordDigest: journal.reconciliation?.recordDigest ?? null,
  });
}

async function loadRecoveryJournalSnapshot(
  root: CanonicalProjectRoot,
  request: InspectPackTransactionRecoveryRequest,
  active: LoadedActivePackTransaction | undefined,
): Promise<PackRecoveryJournalSnapshot> {
  try {
    return Object.freeze({
      journal: await loadPackTransactionJournal({
        root,
        runId: request.runId,
        project: request.project,
        maxDirectoryEntries: request.maxDirectoryEntries,
      }),
      source: "journal" as const,
    });
  } catch (error) {
    if (
      error instanceof PackRuntimeError &&
      error.code === "pack-transaction-not-found" &&
      active?.record.runId === request.runId
    ) {
      return Object.freeze({
        journal: Object.freeze({ started: active.record.started }),
        source: "marker" as const,
      });
    }
    throw error;
  }
}

export async function inspectPackTransactionRecovery(
  value: InspectPackTransactionRecoveryRequest,
): Promise<PackTransactionRecoveryReport> {
  const request = validateRequest(value);
  const root = request.root as CanonicalProjectRoot;
  const activeBefore = await loadActivePackTransactionRecord({
    root,
    project: request.project,
    maxDirectoryEntries: request.maxDirectoryEntries,
  });
  const journalBefore = await loadRecoveryJournalSnapshot(
    root,
    request,
    activeBefore,
  );
  const first = await collectObservations(
    root,
    journalBefore.journal.started,
    request.maxDirectoryEntries,
  );
  const second = await collectObservations(
    root,
    journalBefore.journal.started,
    request.maxDirectoryEntries,
  );
  const activeAfter = await loadActivePackTransactionRecord({
    root,
    project: request.project,
    maxDirectoryEntries: request.maxDirectoryEntries,
  });
  const journalAfter = await loadRecoveryJournalSnapshot(
    root,
    request,
    activeAfter,
  );
  const stable =
    canonicalizeJson(first) === canonicalizeJson(second) &&
    sameActiveMarker(activeBefore, activeAfter) &&
    computePackRecoveryJournalSnapshotDigest(
      journalBefore.journal,
      journalBefore.source,
    ) ===
      computePackRecoveryJournalSnapshotDigest(
        journalAfter.journal,
        journalAfter.source,
      );
  const journal = journalAfter.journal;
  const markerOnly = journalAfter.source === "marker";
  const observations = second;
  const observed = observedState(observations);
  const marker = activeMarkerStatus(activeAfter, journal.started);
  const recordedOutcome = journal.terminal?.outcome;

  let consistency: PackTransactionRecoveryReport["consistency"];
  let mutationUncertain: boolean;
  let safeTerminalOutcome: "committed" | "failed" | undefined;
  let finalizationAction: PackRecoveryFinalizationAction = "blocked";
  let finalizationOutcome: PackRecoveryFinalizationOutcome | undefined;
  if (!stable || marker === "other") {
    consistency = "unresolved";
    mutationUncertain = true;
  } else if (markerOnly) {
    if (observed === "preimage" && marker === "matching") {
      consistency = "incomplete";
      mutationUncertain = false;
      safeTerminalOutcome = "failed";
      finalizationAction = "append-started-and-terminal";
      finalizationOutcome = "failed";
    } else {
      consistency = "unresolved";
      mutationUncertain = true;
    }
  } else if (journal.terminal === undefined) {
    if (
      marker === "matching" &&
      (observed === "preimage" || observed === "postimage")
    ) {
      consistency = "incomplete";
      mutationUncertain = false;
      safeTerminalOutcome = observed === "postimage" ? "committed" : "failed";
      finalizationAction = "append-terminal";
      finalizationOutcome = safeTerminalOutcome;
    } else {
      consistency = "unresolved";
      mutationUncertain = true;
    }
  } else if (journal.reconciliation !== undefined) {
    const expected =
      journal.reconciliation.outcome === "committed"
        ? "postimage"
        : "preimage";
    finalizationOutcome = journal.reconciliation.outcome;
    if (observed === expected && marker === "absent") {
      consistency = "consistent";
      mutationUncertain = false;
      finalizationAction = "none";
    } else if (observed === expected && marker === "matching") {
      consistency = "incomplete";
      mutationUncertain = true;
      finalizationAction = "clear-marker";
    } else {
      consistency = "contradictory";
      mutationUncertain = true;
      finalizationAction = "blocked";
    }
  } else if (journal.terminal.outcome === "recovery-required") {
    if (
      marker === "matching" &&
      (observed === "preimage" || observed === "postimage")
    ) {
      consistency = "incomplete";
      mutationUncertain = true;
      safeTerminalOutcome = observed === "postimage" ? "committed" : "failed";
      finalizationAction = "append-reconciliation";
      finalizationOutcome = safeTerminalOutcome;
    } else {
      consistency = "unresolved";
      mutationUncertain = true;
    }
  } else {
    const expected =
      journal.terminal.outcome === "committed" ? "postimage" : "preimage";
    finalizationOutcome = journal.terminal.outcome;
    if (observed === expected && marker === "absent") {
      consistency = "consistent";
      mutationUncertain = false;
      finalizationAction = "none";
    } else if (observed === expected && marker === "matching") {
      consistency = "incomplete";
      mutationUncertain = true;
      finalizationAction = "clear-marker";
    } else {
      consistency = "contradictory";
      mutationUncertain = true;
      finalizationAction = "blocked";
    }
  }

  const journalSnapshotDigest = computePackRecoveryJournalSnapshotDigest(
    journal,
    journalAfter.source,
  );
  const body = {
    schemaVersion: "1.0.0",
    runId: request.runId,
    project: Object.freeze({
      ...request.project,
      rootIdentityDigest: root.identityDigest,
    }),
    journal: markerOnly
      ? "marker-only"
      : journal.terminal === undefined
        ? "started-only"
        : journal.reconciliation === undefined
          ? "terminal"
          : "reconciled",
    journalSnapshotDigest,
    startedRecordDigest: journal.started.recordDigest,
    ...(journal.terminal === undefined
      ? {}
      : { terminalRecordDigest: journal.terminal.recordDigest }),
    ...(journal.reconciliation === undefined
      ? {}
      : { reconciliationRecordDigest: journal.reconciliation.recordDigest }),
    activeMarker: marker,
    ...(activeAfter === undefined
      ? {}
      : { activeMarkerFileDigest: activeAfter.fileDigest }),
    observedState: observed,
    consistency,
    stable,
    mutationUncertain,
    ...(recordedOutcome === undefined ? {} : { recordedOutcome }),
    ...(safeTerminalOutcome === undefined ? {} : { safeTerminalOutcome }),
    finalizationAction,
    ...(finalizationOutcome === undefined ? {} : { finalizationOutcome }),
    observations,
  } satisfies Omit<PackTransactionRecoveryReport, "reportDigest">;
  const report = freezeReport({
    ...body,
    reportDigest: computePackTransactionRecoveryReportDigest(body),
  });
  recoveryReportInternals.set(
    report,
    Object.freeze({
      root,
      active: activeAfter,
      journal,
      source: journalAfter.source,
    }),
  );
  return report;
}
