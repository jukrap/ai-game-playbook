import {
  compareCanonicalText,
  isPortableProjectPath,
  sha256Digest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  deleteProjectFileCas,
  stageProjectFileCas,
  stageProjectFileCasDelete,
  writeProjectFileCas,
  type PermissionSettlement,
  type ProjectFileCasResult,
  type ProjectLaneLease,
  type StagedProjectFileCasDelete,
  type StagedProjectFileCasWrite,
} from "@ai-game-playbook/core";
import { performance } from "node:perf_hooks";

import {
  assertPackAuthorizationActive,
  validatePackExecutionAuthority,
} from "./authorization.js";
import { PackRuntimeError } from "./errors.js";
import {
  assertPreparedPackOperation,
  internalsForPreparedPackOperation,
  type PreparedArtifactContent,
} from "./prepared-plan.js";
import { preparePackOperation } from "./prepare.js";
import {
  createNextInstalledPackState,
  PACK_INSTALLED_STATE_MAX_BYTES,
  PACK_INSTALLED_STATE_PATH,
  serializeInstalledPackState,
  type InstalledPackState,
} from "./state.js";
import {
  createStartedPackTransaction,
  createTerminalPackTransaction,
  packTransactionRecordPath,
  serializePackTransactionRecord,
  writePackTransactionRecord,
  type PackTransactionOutcome,
  type PackTransactionStartedRecord,
} from "./transaction-journal.js";
import type {
  ExecutePackOperationRequest,
  PackChange,
  PackExecutionErrorSummary,
  PackExecutionResult,
  PreparedPackOperation,
} from "./types.js";

type MutableRecord = Record<string, unknown>;
type ArtifactStage = StagedProjectFileCasWrite | StagedProjectFileCasDelete;
type MutatingPackChange = Exclude<PackChange, { readonly kind: "unchanged" }>;
type FinalPackChange = Exclude<PackChange, { readonly kind: "delete" }>;

interface StagedArtifactChange {
  readonly change: MutatingPackChange;
  readonly stage: ArtifactStage;
}

interface StagedArtifactGuard {
  readonly change: FinalPackChange;
  readonly stage: StagedProjectFileCasWrite;
}

interface ExecutionTracker {
  readonly touchedPaths: Set<string>;
  readonly appliedPaths: string[];
  readonly rolledBackPaths: string[];
  changedBytes: number;
}

interface ExecutionFailure {
  readonly code: string;
  readonly path: string;
  readonly mutationUncertain: boolean;
}

interface TerminalWriteResult {
  readonly recordDigest?: Sha256Digest;
  readonly outcome: PackTransactionOutcome;
  readonly mutationUncertain: boolean;
  readonly failure?: ExecutionFailure;
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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function summarizeFailure(error: unknown, fallbackPath: string): ExecutionFailure {
  if (error instanceof PackRuntimeError || error instanceof CoreBoundaryError) {
    return Object.freeze({
      code: error.code,
      path: error.path,
      mutationUncertain: error.mutationUncertain,
    });
  }
  return Object.freeze({
    code: "pack-execution-failed",
    path: fallbackPath,
    mutationUncertain: false,
  });
}

function errorSummary(
  failure: ExecutionFailure | undefined,
): PackExecutionErrorSummary | undefined {
  return failure === undefined
    ? undefined
    : Object.freeze({ code: failure.code, path: failure.path });
}

function canonicalNowAtLeast(minimum?: string): string {
  const floor = minimum === undefined ? 0 : Date.parse(minimum) + 1;
  return new Date(Math.max(Date.now(), floor)).toISOString();
}

function mapPreparedContent(
  artifacts: readonly PreparedArtifactContent[],
  label: string,
): ReadonlyMap<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const artifact of artifacts) {
    if (result.has(artifact.target)) {
      throw new PackRuntimeError(
        "pack-plan-untrusted",
        artifact.target,
        `${label} contains a duplicate target`,
      );
    }
    result.set(artifact.target, new Uint8Array(artifact.content));
  }
  return result;
}

function verifyPreparedContents(
  plan: PreparedPackOperation,
  source: ReadonlyMap<string, Uint8Array>,
  preimages: ReadonlyMap<string, Uint8Array>,
): void {
  for (const change of plan.changes) {
    if (
      change.kind === "create" ||
      change.kind === "replace" ||
      change.kind === "unchanged"
    ) {
      const content = source.get(change.path);
      if (
        content === undefined ||
        content.byteLength !== change.bytes ||
        sha256Digest(content) !== change.afterDigest
      ) {
        throw new PackRuntimeError(
          "pack-plan-untrusted",
          change.path,
          "prepared postimage no longer matches its attested change",
        );
      }
    }
    if (
      change.kind === "replace" ||
      change.kind === "delete" ||
      change.kind === "unchanged"
    ) {
      const content = preimages.get(change.path);
      if (
        content === undefined ||
        sha256Digest(content) !== change.beforeDigest
      ) {
        throw new PackRuntimeError(
          "pack-plan-untrusted",
          change.path,
          "prepared rollback preimage no longer matches its attested change",
        );
      }
    }
  }
}

async function assertLaneOwned(lane: ProjectLaneLease): Promise<void> {
  try {
    await lane.assertOwned();
  } catch {
    throw new PackRuntimeError(
      "pack-lane-invalid",
      "$request.lane",
      "project lane ownership was lost during pack execution",
      true,
    );
  }
}

async function assertForwardAuthority(
  authority: Awaited<ReturnType<typeof validatePackExecutionAuthority>>,
): Promise<void> {
  assertPackAuthorizationActive(authority.authorization);
  await assertLaneOwned(authority.lane);
  assertPackAuthorizationActive(authority.authorization);
}

async function stageArtifactChange(
  plan: PreparedPackOperation,
  root: ReturnType<typeof internalsForPreparedPackOperation>["targetRoot"],
  change: MutatingPackChange,
  source: ReadonlyMap<string, Uint8Array>,
): Promise<ArtifactStage> {
  if (change.kind === "delete") {
    return stageProjectFileCasDelete({
      root,
      path: change.path,
      expectedDigest: change.beforeDigest,
      maxBytes: plan.limits.maxArtifactBytes,
      maxDirectoryEntries: plan.limits.maxDirectoryEntries,
    });
  }
  const content = source.get(change.path);
  if (content === undefined) {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      change.path,
      "prepared source content is unavailable",
    );
  }
  return stageProjectFileCas({
    root,
    path: change.path,
    content,
    expected:
      change.kind === "create"
        ? { mode: "absent" }
        : { mode: "digest", digest: change.beforeDigest },
    maxBytes: plan.limits.maxArtifactBytes,
    maxDirectoryEntries: plan.limits.maxDirectoryEntries,
  });
}

async function stageFinalArtifactGuard(
  plan: PreparedPackOperation,
  root: ReturnType<typeof internalsForPreparedPackOperation>["targetRoot"],
  change: FinalPackChange,
  source: ReadonlyMap<string, Uint8Array>,
): Promise<StagedProjectFileCasWrite> {
  const content = source.get(change.path);
  if (content === undefined) {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      change.path,
      "prepared final artifact content is unavailable",
    );
  }
  return stageProjectFileCas({
    root,
    path: change.path,
    content,
    expected: { mode: "digest", digest: change.afterDigest },
    maxBytes: plan.limits.maxArtifactBytes,
    maxDirectoryEntries: plan.limits.maxDirectoryEntries,
  });
}

async function abortStages(
  stateStage: StagedProjectFileCasWrite | undefined,
  artifactStages: readonly { readonly stage: ArtifactStage }[],
): Promise<ExecutionFailure | undefined> {
  const stages: ArtifactStage[] = [
    ...artifactStages.map(({ stage }) => stage).reverse(),
    ...(stateStage === undefined ? [] : [stateStage]),
  ];
  for (const stage of stages) {
    if (stage.state !== "staged") continue;
    try {
      await stage.abort();
    } catch (error) {
      const failure = summarizeFailure(error, stage.path);
      return Object.freeze({ ...failure, mutationUncertain: true });
    }
  }
  return undefined;
}

async function rollbackAppliedChanges(
  plan: PreparedPackOperation,
  root: ReturnType<typeof internalsForPreparedPackOperation>["targetRoot"],
  applied: readonly StagedArtifactChange[],
  preimages: ReadonlyMap<string, Uint8Array>,
  lane: ProjectLaneLease,
  tracker: ExecutionTracker,
): Promise<ExecutionFailure | undefined> {
  for (const { change } of [...applied].reverse()) {
    try {
      await assertLaneOwned(lane);
      if (change.kind === "create") {
        const result = await deleteProjectFileCas({
          root,
          path: change.path,
          expectedDigest: change.afterDigest,
          maxBytes: plan.limits.maxArtifactBytes,
          maxDirectoryEntries: plan.limits.maxDirectoryEntries,
        });
        tracker.changedBytes += result.bytes;
      } else {
        const content = preimages.get(change.path);
        if (content === undefined) {
          throw new PackRuntimeError(
            "pack-plan-untrusted",
            change.path,
            "rollback preimage is unavailable",
            true,
          );
        }
        const result = await writeProjectFileCas({
          root,
          path: change.path,
          content,
          expected:
            change.kind === "replace"
              ? { mode: "digest", digest: change.afterDigest }
              : { mode: "absent" },
          maxBytes: plan.limits.maxArtifactBytes,
          maxDirectoryEntries: plan.limits.maxDirectoryEntries,
        });
        tracker.changedBytes += result.bytes;
      }
      tracker.touchedPaths.add(change.path);
      tracker.rolledBackPaths.push(change.path);
    } catch (error) {
      const failure = summarizeFailure(error, change.path);
      tracker.touchedPaths.add(change.path);
      tracker.changedBytes +=
        change.kind === "create"
          ? change.bytes
          : (preimages.get(change.path)?.byteLength ?? change.bytes);
      return Object.freeze({ ...failure, mutationUncertain: true });
    }
  }
  return undefined;
}

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...values].sort(compareCanonicalText));
}

function actualEffects(
  tracker: ExecutionTracker,
  startedAt: number,
  mutationUncertain: boolean,
) {
  const durationMs = Math.max(
    0,
    Math.min(604_800_000, Math.ceil(performance.now() - startedAt)),
  );
  const changedPaths = sorted(tracker.touchedPaths);
  return {
    mutationUncertain,
    actual: {
      changedPaths,
      changedBytes: tracker.changedBytes,
      objectIds: [],
      destinations: [],
      dataClasses: [],
      changeKinds: changedPaths.length === 0 ? [] : (["config"] as const),
      publishTargets: [],
      durationMs,
      outputBytes: 0,
      repairCycles: 0,
    },
  };
}

function accountUncertainFileAttempt(
  plan: PreparedPackOperation,
  failure: ExecutionFailure | undefined,
  stateBytes: number,
  preimages: ReadonlyMap<string, Uint8Array>,
  tracker: ExecutionTracker,
): void {
  if (failure === undefined || !failure.mutationUncertain) return;
  if (!isPortableProjectPath(failure.path)) return;
  let attemptedBytes: number | undefined;
  if (failure.path === PACK_INSTALLED_STATE_PATH) {
    attemptedBytes = stateBytes;
  } else {
    const change = plan.changes.find(({ path }) => path === failure.path);
    if (change !== undefined) {
      attemptedBytes =
        change.kind === "delete"
          ? (preimages.get(change.path)?.byteLength ?? change.bytes)
          : change.bytes;
    }
  }
  if (attemptedBytes === undefined) return;
  tracker.touchedPaths.add(failure.path);
  tracker.changedBytes += attemptedBytes;
}

function settleAuthorization(
  authorization: Awaited<ReturnType<typeof validatePackExecutionAuthority>>["authorization"],
  tracker: ExecutionTracker,
  startedAt: number,
  outcome: "failed" | "succeeded" | "uncertain",
  mutationUncertain: boolean,
): PermissionSettlement {
  const effects = actualEffects(tracker, startedAt, mutationUncertain);
  try {
    return authorization.lease.settle({
      outcome: mutationUncertain ? "uncertain" : outcome,
      mutationUncertain,
      actual: effects.actual,
    });
  } catch (error) {
    throw new PackRuntimeError(
      "pack-execution-uncertain",
      "$settlement",
      "pack effects could not be settled with the permission broker",
      tracker.touchedPaths.size > 0 || mutationUncertain,
    );
  }
}

async function writeTerminalRecord(
  plan: PreparedPackOperation,
  started: PackTransactionStartedRecord,
  outcome: PackTransactionOutcome,
  mutationUncertain: boolean,
  tracker: ExecutionTracker,
  installedStateAfterDigest: Sha256Digest | undefined,
  failure: ExecutionFailure | undefined,
  root: ReturnType<typeof internalsForPreparedPackOperation>["targetRoot"],
  lane: ProjectLaneLease,
): Promise<TerminalWriteResult> {
  const terminalPath = packTransactionRecordPath(plan.runId, 1);
  try {
    await assertLaneOwned(lane);
  } catch (error) {
    return {
      outcome: "recovery-required",
      mutationUncertain: true,
      failure: summarizeFailure(error, "$request.lane"),
    };
  }
  tracker.touchedPaths.add(terminalPath);
  let record;
  try {
    record = createTerminalPackTransaction({
      started,
      outcome,
      mutationUncertain,
      touchedPaths: sorted(tracker.touchedPaths),
      appliedPaths: sorted(tracker.appliedPaths),
      rolledBackPaths: sorted(tracker.rolledBackPaths),
      ...(installedStateAfterDigest === undefined
        ? {}
        : { installedStateAfterDigest }),
      ...(failure === undefined
        ? {}
        : { error: { code: failure.code, path: failure.path } }),
      endedAt: canonicalNowAtLeast(started.startedAt),
    });
    const written = await writePackTransactionRecord(
      root,
      record,
      plan.limits.maxDirectoryEntries,
    );
    tracker.changedBytes += written.bytes;
    return {
      recordDigest: record.recordDigest,
      outcome,
      mutationUncertain,
      ...(failure === undefined ? {} : { failure }),
    };
  } catch (error) {
    const terminalFailure = summarizeFailure(error, terminalPath);
    if (!terminalFailure.mutationUncertain) {
      tracker.touchedPaths.delete(terminalPath);
    } else {
      tracker.changedBytes +=
        record === undefined
          ? 0
          : serializePackTransactionRecord(record).byteLength;
    }
    return {
      outcome: "recovery-required",
      mutationUncertain: true,
      failure: terminalFailure,
    };
  }
}

function executedResult(
  plan: PreparedPackOperation,
  status: Exclude<PackExecutionResult["status"], "no-op">,
  mutationUncertain: boolean,
  tracker: ExecutionTracker,
  settlement: PermissionSettlement,
  startedRecordDigest: Sha256Digest | undefined,
  terminalRecordDigest: Sha256Digest | undefined,
  nextState: InstalledPackState | undefined,
  stateFileDigest: Sha256Digest | undefined,
  failure: ExecutionFailure | undefined,
): PackExecutionResult {
  const result = {
    schemaVersion: "1.0.0" as const,
    status,
    operation: plan.operation,
    planDigest: plan.planDigest,
    mutationUncertain,
    transaction: {
      startedRecordPath: packTransactionRecordPath(plan.runId, 0),
      ...(startedRecordDigest === undefined ? {} : { startedRecordDigest }),
      terminalRecordPath: packTransactionRecordPath(plan.runId, 1),
      ...(terminalRecordDigest === undefined ? {} : { terminalRecordDigest }),
    },
    installedState: {
      beforeDigest: plan.installedState.digest,
      ...(nextState === undefined ? {} : { afterDigest: nextState.stateDigest }),
      ...(stateFileDigest === undefined ? {} : { fileDigest: stateFileDigest }),
    },
    effects: {
      changedPaths: sorted(tracker.touchedPaths),
      changedBytes: tracker.changedBytes,
      appliedPaths: sorted(tracker.appliedPaths),
      rolledBackPaths: sorted(tracker.rolledBackPaths),
    },
    settlement,
    ...(errorSummary(failure) === undefined
      ? {}
      : { error: errorSummary(failure) }),
  };
  return deepFreeze(result) as PackExecutionResult;
}

function noOpResult(plan: PreparedPackOperation): PackExecutionResult {
  return deepFreeze({
    schemaVersion: "1.0.0",
    status: "no-op",
    operation: plan.operation,
    planDigest: plan.planDigest,
    mutationUncertain: false,
    effects: {
      changedPaths: [],
      changedBytes: 0,
      appliedPaths: [],
      rolledBackPaths: [],
    },
  });
}

async function revalidateNoOpPlan(
  plan: PreparedPackOperation,
): Promise<void> {
  const internals = internalsForPreparedPackOperation(plan);
  let refreshed: PreparedPackOperation;
  try {
    refreshed = await preparePackOperation({
      operation: plan.operation,
      registry: internals.registry,
      targetRoot: internals.targetRoot,
      ...(internals.sourceRoot === undefined
        ? {}
        : { sourceRoot: internals.sourceRoot }),
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
      },
      runId: plan.runId,
      packId: plan.pack.id,
      limits: plan.limits,
    });
  } catch {
    throw new PackRuntimeError(
      "pack-plan-not-executable",
      "$request.plan",
      "write-free pack plan no longer matches the project",
    );
  }
  if (
    refreshed.disposition !== "no-op" ||
    refreshed.planDigest !== plan.planDigest
  ) {
    throw new PackRuntimeError(
      "pack-plan-not-executable",
      "$request.plan",
      "write-free pack plan became stale before completion",
    );
  }
}

export async function executePreparedPackOperation(
  value: ExecutePackOperationRequest,
): Promise<PackExecutionResult> {
  if (!isRecord(value) || !Object.hasOwn(value, "plan")) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$request",
      "pack execution request is malformed",
    );
  }
  const plan = value.plan;
  try {
    assertPreparedPackOperation(plan);
  } catch {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      "$request.plan",
      "pack execution requires a same-process prepared plan",
    );
  }
  if (plan.disposition === "conflicted") {
    throw new PackRuntimeError(
      "pack-plan-conflicted",
      "$request.plan",
      "a conflicted pack plan cannot execute",
    );
  }
  if (plan.disposition === "no-op") {
    if (!exactKeys(value, ["plan"])) {
      throw new PackRuntimeError(
        "invalid-pack-execution-request",
        "$request",
        "write-free pack completion accepts no mutation authority",
      );
    }
    await revalidateNoOpPlan(plan);
    return noOpResult(plan);
  }
  if (!exactKeys(value, ["plan", "authorization", "lane"])) {
    throw new PackRuntimeError(
      "invalid-pack-execution-request",
      "$request",
      "ready pack execution requires exact authorization and lane fields",
    );
  }

  const authority = await validatePackExecutionAuthority(
    plan,
    value.authorization,
    value.lane,
  );
  const startedClock = performance.now();
  const tracker: ExecutionTracker = {
    touchedPaths: new Set<string>(),
    appliedPaths: [],
    rolledBackPaths: [],
    changedBytes: 0,
  };
  const internals = internalsForPreparedPackOperation(plan);
  let source: ReadonlyMap<string, Uint8Array>;
  let preimages: ReadonlyMap<string, Uint8Array>;
  try {
    source = mapPreparedContent(internals.sourceArtifacts, "source artifacts");
    preimages = mapPreparedContent(internals.preimages, "preimages");
    verifyPreparedContents(plan, source, preimages);
  } catch (error) {
    const failure = summarizeFailure(error, "$execution.preflight");
    const settlement = settleAuthorization(
      authority.authorization,
      tracker,
      startedClock,
      "failed",
      false,
    );
    return executedResult(
      plan,
      "failed",
      false,
      tracker,
      settlement,
      undefined,
      undefined,
      undefined,
      undefined,
      failure,
    );
  }
  const startedAt = canonicalNowAtLeast();
  let nextState: InstalledPackState;
  let stateContent: Uint8Array;
  let started: PackTransactionStartedRecord;
  try {
    nextState = createNextInstalledPackState({
      operation: plan.operation,
      pack: plan.pack,
      ...(internals.manifest === undefined
        ? {}
        : { manifest: internals.manifest }),
      installed: internals.installed.state,
      sourceArtifacts: internals.sourceArtifacts,
      timestamp: startedAt,
    });
    stateContent = serializeInstalledPackState(nextState);
    if (stateContent.byteLength > PACK_INSTALLED_STATE_MAX_BYTES) {
      throw new PackRuntimeError(
        "pack-artifact-budget-exceeded",
        PACK_INSTALLED_STATE_PATH,
        "next installed state exceeds its fixed byte limit",
      );
    }
    started = createStartedPackTransaction({
      plan,
      authorizationId: authority.authorization.lease.authorizationId,
      requestDigest: authority.authorization.challenge.requestDigest,
      startedAt,
    });
  } catch (error) {
    const failure = summarizeFailure(error, "$execution.preflight");
    const settlement = settleAuthorization(
      authority.authorization,
      tracker,
      startedClock,
      "failed",
      false,
    );
    return executedResult(
      plan,
      "failed",
      false,
      tracker,
      settlement,
      undefined,
      undefined,
      undefined,
      undefined,
      failure,
    );
  }
  const startedPath = packTransactionRecordPath(plan.runId, 0);
  let startedRecordDigest: Sha256Digest | undefined;
  try {
    await assertForwardAuthority(authority);
    const written = await writePackTransactionRecord(
      internals.targetRoot,
      started,
      plan.limits.maxDirectoryEntries,
    );
    tracker.touchedPaths.add(startedPath);
    tracker.changedBytes += written.bytes;
    startedRecordDigest = started.recordDigest;
  } catch (error) {
    const failure = summarizeFailure(error, startedPath);
    if (failure.mutationUncertain) {
      tracker.touchedPaths.add(startedPath);
      tracker.changedBytes += serializePackTransactionRecord(started).byteLength;
    }
    const settlement = settleAuthorization(
      authority.authorization,
      tracker,
      startedClock,
      failure.mutationUncertain ? "uncertain" : "failed",
      failure.mutationUncertain,
    );
    return executedResult(
      plan,
      failure.mutationUncertain ? "recovery-required" : "failed",
      failure.mutationUncertain,
      tracker,
      settlement,
      undefined,
      undefined,
      undefined,
      undefined,
      failure,
    );
  }

  let stateStage: StagedProjectFileCasWrite | undefined;
  const stagedArtifacts: StagedArtifactChange[] = [];
  let stagingFailure: ExecutionFailure | undefined;
  try {
    await assertForwardAuthority(authority);
    stateStage = await stageProjectFileCas({
      root: internals.targetRoot,
      path: PACK_INSTALLED_STATE_PATH,
      content: stateContent,
      expected:
        plan.installedState.fileDigest === undefined
          ? { mode: "absent" }
          : { mode: "digest", digest: plan.installedState.fileDigest },
      maxBytes: PACK_INSTALLED_STATE_MAX_BYTES,
      maxDirectoryEntries: plan.limits.maxDirectoryEntries,
    });
    for (const change of plan.changes) {
      if (change.kind === "unchanged") continue;
      await assertForwardAuthority(authority);
      const stage = await stageArtifactChange(
        plan,
        internals.targetRoot,
        change,
        source,
      );
      stagedArtifacts.push({ change, stage });
    }
  } catch (error) {
    stagingFailure = summarizeFailure(error, "$execution.stage");
  }

  if (stagingFailure !== undefined) {
    const abortFailure = await abortStages(stateStage, stagedArtifacts);
    accountUncertainFileAttempt(
      plan,
      stagingFailure,
      stateContent.byteLength,
      preimages,
      tracker,
    );
    accountUncertainFileAttempt(
      plan,
      abortFailure,
      stateContent.byteLength,
      preimages,
      tracker,
    );
    const failure = abortFailure ?? stagingFailure;
    const uncertain =
      stagingFailure.mutationUncertain || abortFailure !== undefined;
    const terminal = await writeTerminalRecord(
      plan,
      started,
      uncertain ? "recovery-required" : "failed",
      uncertain,
      tracker,
      undefined,
      failure,
      internals.targetRoot,
      authority.lane,
    );
    const finalUncertain = uncertain || terminal.mutationUncertain;
    const settlement = settleAuthorization(
      authority.authorization,
      tracker,
      startedClock,
      finalUncertain ? "uncertain" : "failed",
      finalUncertain,
    );
    return executedResult(
      plan,
      finalUncertain ? "recovery-required" : "failed",
      finalUncertain,
      tracker,
      settlement,
      startedRecordDigest,
      terminal.recordDigest,
      undefined,
      undefined,
      terminal.failure ?? failure,
    );
  }

  const appliedStages: StagedArtifactChange[] = [];
  const guardStages: StagedArtifactGuard[] = [];
  let commitFailure: ExecutionFailure | undefined;
  for (const staged of stagedArtifacts) {
    try {
      await assertForwardAuthority(authority);
      const result = await staged.stage.commit();
      tracker.touchedPaths.add(staged.change.path);
      tracker.appliedPaths.push(staged.change.path);
      tracker.changedBytes += result.bytes;
      appliedStages.push(staged);
    } catch (error) {
      commitFailure = summarizeFailure(error, staged.change.path);
      if (commitFailure.mutationUncertain || staged.stage.state === "uncertain") {
        tracker.touchedPaths.add(staged.change.path);
        tracker.changedBytes +=
          staged.change.kind === "delete"
            ? (preimages.get(staged.change.path)?.byteLength ??
              staged.change.bytes)
            : staged.change.bytes;
        commitFailure = Object.freeze({
          ...commitFailure,
          mutationUncertain: true,
        });
      }
      break;
    }
  }

  if (commitFailure === undefined) {
    for (const change of plan.changes) {
      if (change.kind === "delete") continue;
      let guard: StagedProjectFileCasWrite | undefined;
      try {
        await assertForwardAuthority(authority);
        guard = await stageFinalArtifactGuard(
          plan,
          internals.targetRoot,
          change,
          source,
        );
        guardStages.push({ change, stage: guard });
        await assertForwardAuthority(authority);
        const result = await guard.commit();
        if (result.status !== "no-op") {
          tracker.touchedPaths.add(change.path);
          tracker.changedBytes += result.bytes;
          commitFailure = Object.freeze({
            code: "pack-execution-uncertain",
            path: change.path,
            mutationUncertain: true,
          });
          break;
        }
      } catch (error) {
        commitFailure = summarizeFailure(error, change.path);
        if (commitFailure.mutationUncertain || guard?.state === "uncertain") {
          tracker.touchedPaths.add(change.path);
          tracker.changedBytes += change.bytes;
          commitFailure = Object.freeze({
            ...commitFailure,
            mutationUncertain: true,
          });
        }
        break;
      }
    }
  }

  let stateResult: ProjectFileCasResult | undefined;
  if (commitFailure === undefined) {
    try {
      await assertForwardAuthority(authority);
      stateResult = await stateStage?.commit();
      if (stateResult === undefined) {
        throw new PackRuntimeError(
          "pack-execution-failed",
          PACK_INSTALLED_STATE_PATH,
          "installed state was not staged",
        );
      }
      tracker.touchedPaths.add(PACK_INSTALLED_STATE_PATH);
      tracker.changedBytes += stateResult.bytes;
    } catch (error) {
      commitFailure = summarizeFailure(error, PACK_INSTALLED_STATE_PATH);
      if (commitFailure.mutationUncertain || stateStage?.state === "uncertain") {
        tracker.touchedPaths.add(PACK_INSTALLED_STATE_PATH);
        tracker.changedBytes += stateContent.byteLength;
        commitFailure = Object.freeze({
          ...commitFailure,
          mutationUncertain: true,
        });
      }
    }
  }

  if (commitFailure !== undefined) {
    let rollbackFailure: ExecutionFailure | undefined;
    if (!commitFailure.mutationUncertain) {
      rollbackFailure = await rollbackAppliedChanges(
        plan,
        internals.targetRoot,
        appliedStages,
        preimages,
        authority.lane,
        tracker,
      );
    }
    const abortFailure = await abortStages(stateStage, [
      ...stagedArtifacts,
      ...guardStages,
    ]);
    accountUncertainFileAttempt(
      plan,
      abortFailure,
      stateContent.byteLength,
      preimages,
      tracker,
    );
    const uncertain =
      commitFailure.mutationUncertain ||
      rollbackFailure !== undefined ||
      abortFailure !== undefined;
    const rolledBack =
      !uncertain &&
      appliedStages.length > 0 &&
      tracker.rolledBackPaths.length === appliedStages.length;
    const outcome: PackTransactionOutcome = uncertain
      ? "recovery-required"
      : rolledBack
        ? "rolled-back"
        : "failed";
    const failure = rollbackFailure ?? abortFailure ?? commitFailure;
    const terminal = await writeTerminalRecord(
      plan,
      started,
      outcome,
      uncertain,
      tracker,
      undefined,
      failure,
      internals.targetRoot,
      authority.lane,
    );
    const finalUncertain = uncertain || terminal.mutationUncertain;
    const status = finalUncertain
      ? "recovery-required"
      : rolledBack
        ? "rolled-back"
        : "failed";
    const settlement = settleAuthorization(
      authority.authorization,
      tracker,
      startedClock,
      finalUncertain ? "uncertain" : "failed",
      finalUncertain,
    );
    return executedResult(
      plan,
      status,
      finalUncertain,
      tracker,
      settlement,
      startedRecordDigest,
      terminal.recordDigest,
      undefined,
      undefined,
      terminal.failure ?? failure,
    );
  }

  const terminal = await writeTerminalRecord(
    plan,
    started,
    "committed",
    false,
    tracker,
    nextState.stateDigest,
    undefined,
    internals.targetRoot,
    authority.lane,
  );
  const mutationUncertain = terminal.mutationUncertain;
  const settlement = settleAuthorization(
    authority.authorization,
    tracker,
    startedClock,
    mutationUncertain ? "uncertain" : "succeeded",
    mutationUncertain,
  );
  const brokerUncertain =
    settlement.status === "scope-violation" ||
    settlement.status === "uncertain";
  return executedResult(
    plan,
    mutationUncertain || brokerUncertain
      ? "recovery-required"
      : "succeeded",
    mutationUncertain || brokerUncertain,
    tracker,
    settlement,
    startedRecordDigest,
    terminal.recordDigest,
    nextState,
    stateResult?.afterDigest,
    terminal.failure,
  );
}
