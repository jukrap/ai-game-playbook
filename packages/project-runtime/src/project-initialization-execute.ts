import {
  PROJECT_INITIALIZATION_COMMAND_ID,
  PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS,
  PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
  PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES,
  PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_BYTES,
  PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES,
  assertProjectInitializationReportSemantics,
  canonicalizeJson,
  compareCanonicalText,
  computeProjectInitializationReportDigest,
  computeRunReceiptDigest,
  digestCanonicalJson,
  isStableId,
  parsePortableProjectPath,
  parseSemanticVersion,
  parseStableId,
  projectInitializationCommandInputSchema,
  projectInitializationReportSchema,
  runReceiptSchema,
  type PermissionClass,
  type PortableProjectPath,
  type ProjectInitializationReport,
  type ProjectInitializationReportDigestInput,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
  type WorkflowCheckpointRecord,
  workflowCheckpointSchema,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  RUN_RECEIPT_STORE_PATH,
  WORKFLOW_CHECKPOINT_STORE_PATH,
  PROJECT_STATE_DIRECTORIES,
  acquireProjectLane,
  assertAuthorizedPermissionDecision,
  createProjectDirectoryCas,
  createWorkflowCheckpoint,
  deleteProjectDirectoryCas,
  deleteProjectFileCas,
  persistRunReceipt,
  persistWorkflowCheckpoint,
  readProjectDirectoryIdentity,
  readProjectFileSnapshot,
  resolveProjectPath,
  stageProjectDirectoryCasCreate,
  stageProjectFileCas,
  beginWorkflowStep,
  markWorkflowStepStarted,
  settleWorkflowStep,
  type AuthorizedPermissionDecision,
  type PermissionActualEffects,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
  type ProjectDirectoryIdentity,
  type ProjectLaneLease,
  type StagedProjectDirectoryCasCreate,
  type StagedProjectFileCasWrite,
  type StoredRunReceipt,
  type StoredWorkflowCheckpoint,
} from "@ai-game-playbook/core";
import {
  resolveWorkflowPlan,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldImmediate } from "node:timers/promises";

import { ProjectRuntimeError } from "./errors.js";
import {
  PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
  assertPreparedProjectInitialization,
  createProjectInitializationCommandInput,
  internalsForPreparedProjectInitialization,
  prepareProjectInitialization,
  type PreparedProjectInitialization,
  type PreparedProjectInitializationTarget,
} from "./project-initialization.js";

const INITIALIZATION_WORKFLOW_ID = parseStableId(
  "workflow.project-initialization",
);
const INITIALIZATION_STEP_ID = parseStableId("step.project-initialize");
const INITIALIZATION_CHECKPOINT_TTL_MS = 86_400_000;
const INITIALIZATION_LANE_LEASE_MS = 30_000;
const INITIALIZATION_LANE_WAIT_MS = 5_000;
const INITIALIZATION_LANE_POLL_MS = 25;
const CONTROL_STATE_DIRECTORIES = Object.freeze(
  PROJECT_STATE_DIRECTORIES.map((path) => parsePortableProjectPath(path)),
);
const CONTROL_STATE_PATHS = new Set<string>(CONTROL_STATE_DIRECTORIES);
const BOOTSTRAP_PATHS = Object.freeze([
  ".ai-game-playbook",
  ".ai-game-playbook/locks",
]);

type DataRecord = Record<string, unknown>;
type TargetStage =
  | {
      readonly target: PreparedProjectInitializationTarget;
      readonly kind: "directory";
      readonly stage: StagedProjectDirectoryCasCreate;
    }
  | {
      readonly target: PreparedProjectInitializationTarget;
      readonly kind: "file";
      readonly stage: StagedProjectFileCasWrite;
    };

interface AppliedTarget {
  readonly target: PreparedProjectInitializationTarget;
  readonly identity?: ProjectDirectoryIdentity;
  readonly digest?: Sha256Digest;
}

interface ExecutionFailure {
  readonly code: StableId;
  readonly at: StableId;
  readonly mutationUncertain: boolean;
}

interface ExecutionTracker {
  readonly touchedPaths: Set<PortableProjectPath>;
  readonly applied: AppliedTarget[];
  readonly rolledBackPaths: Set<PortableProjectPath>;
  changedBytes: number;
}

interface CreatedControlDirectory {
  readonly path: PortableProjectPath;
  readonly identity: ProjectDirectoryIdentity;
}

interface ControlInitializationState {
  readonly createdDirectories: CreatedControlDirectory[];
  durableCheckpoint: boolean;
}

export interface CreateProjectInitializationAuthorizationRequest {
  readonly plan: unknown;
  readonly deadlineAt: string;
}

export interface ExecutePreparedProjectInitializationRequest {
  readonly plan: unknown;
  readonly authorization: unknown;
  readonly signal: AbortSignal | null;
}

function runtimeError(
  code: ConstructorParameters<typeof ProjectRuntimeError>[0],
  path: string,
  message: string,
  mutationUncertain = false,
): never {
  throw new ProjectRuntimeError(code, path, message, mutationUncertain);
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    runtimeError(
      "invalid-project-initialization-execution-request",
      path,
      "expected a plain data object",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    runtimeError(
      "invalid-project-initialization-execution-request",
      path,
      "request fields must be enumerable data properties",
    );
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    runtimeError(
      "invalid-project-initialization-execution-request",
      path,
      "request contains undeclared or missing fields",
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sortedPaths(
  values: Iterable<string>,
): readonly PortableProjectPath[] {
  return Object.freeze(
    [...values]
      .sort(compareCanonicalText)
      .map((path) => parsePortableProjectPath(path)),
  );
}

function commandAndWorkflow(plan: PreparedProjectInitialization): {
  readonly command: ReturnType<
    typeof internalsForPreparedProjectInitialization
  >["registry"]["commands"][number];
  readonly workflow: ReturnType<typeof resolveWorkflowPlan>;
} {
  const { registry } = internalsForPreparedProjectInitialization(plan);
  const command = registry.commands.find(
    ({ id }) => id === PROJECT_INITIALIZATION_COMMAND_ID,
  );
  const descriptor = registry.workflows.find(
    ({ id }) => id === INITIALIZATION_WORKFLOW_ID,
  );
  const workflow = resolveWorkflowPlan(
    registry,
    INITIALIZATION_WORKFLOW_ID,
    plan.project.stage,
  );
  const step = descriptor?.steps[0];
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.input.schemaId !== projectInitializationCommandInputSchema.schemaId ||
    command.input.digest !== projectInitializationCommandInputSchema.digest ||
    command.output.schemaId !== projectInitializationReportSchema.schemaId ||
    command.output.digest !== projectInitializationReportSchema.digest ||
    command.lane !== "project-write" ||
    command.permissions.length !== 1 ||
    command.permissions[0] !== "write-project-metadata" ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "filesystem" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/project-runtime" ||
    command.handler.export !== "executePreparedProjectInitialization" ||
    descriptor === undefined ||
    descriptor.lifecycle !== "internal" ||
    descriptor.resumePolicy !== "never" ||
    descriptor.steps.length !== 1 ||
    step?.id !== INITIALIZATION_STEP_ID ||
    step.commandId !== PROJECT_INITIALIZATION_COMMAND_ID ||
    step.approvalCheckpoint !== true ||
    step.onFailure !== "stop" ||
    workflow.steps.length !== 1 ||
    workflow.steps[0]?.command.id !== PROJECT_INITIALIZATION_COMMAND_ID
  ) {
    runtimeError(
      "project-initialization-authorization-invalid",
      "$registry",
      "registry initialization authority is not the exact bounded internal workflow",
    );
  }
  return Object.freeze({ command, workflow });
}

function authorizationPaths(
  plan: PreparedProjectInitialization,
): readonly PortableProjectPath[] {
  return sortedPaths(
    plan.targets
      .filter(({ action }) => action === "create")
      .map(({ path }) => path),
  );
}

export function createProjectInitializationAuthorizationRequest(
  value: CreateProjectInitializationAuthorizationRequest,
): PermissionAuthorizationRequest {
  const record = dataRecord(value, "$request");
  exactKeys(record, ["plan", "deadlineAt"], "$request");
  let plan: PreparedProjectInitialization;
  try {
    assertPreparedProjectInitialization(value.plan);
    plan = value.plan;
    createProjectInitializationCommandInput(plan);
  } catch {
    throw new ProjectRuntimeError(
      "project-initialization-plan-untrusted",
      "$request.plan",
      "authorization requires a same-process ready initialization plan",
    );
  }
  const deadlineMs =
    typeof value.deadlineAt === "string" ? Date.parse(value.deadlineAt) : NaN;
  const requestedAtMs = Date.now();
  if (
    typeof value.deadlineAt !== "string" ||
    !Number.isFinite(deadlineMs) ||
    new Date(deadlineMs).toISOString() !== value.deadlineAt ||
    deadlineMs <= requestedAtMs ||
    deadlineMs - requestedAtMs > PROJECT_INITIALIZATION_COMMAND_MAX_DURATION_MS
  ) {
    runtimeError(
      "invalid-project-initialization-execution-request",
      "$request.deadlineAt",
      "authorization deadline must be canonical, future, and within the command timeout",
    );
  }
  const { workflow } = commandAndWorkflow(plan);
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: parseStableId(PROJECT_INITIALIZATION_COMMAND_ID),
    input: createProjectInitializationCommandInput(plan),
    workflow: Object.freeze({
      id: INITIALIZATION_WORKFLOW_ID,
      stepId: INITIALIZATION_STEP_ID,
      resolvedPlanDigest: workflow.resolvedPlanDigest,
    }),
    scope: Object.freeze({
      paths: authorizationPaths(plan),
      objectIds: Object.freeze([]),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze(["metadata"] as const),
      publishTargets: Object.freeze([]),
    }),
    budgets: plan.budgets,
    deadlineAt: value.deadlineAt,
  });
}

function assertAuthorizationActive(
  authorization: AuthorizedPermissionDecision,
): void {
  const expiresAt = Date.parse(authorization.lease.expiresAt);
  const deadlineAt = Date.parse(authorization.challenge.deadlineAt);
  if (
    authorization.lease.state !== "active" ||
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(deadlineAt) ||
    expiresAt > deadlineAt ||
    Date.now() >= expiresAt
  ) {
    runtimeError(
      "project-initialization-authorization-invalid",
      "$request.authorization",
      "initialization authorization is no longer active within its deadline",
    );
  }
}

function validateAuthorization(
  plan: PreparedProjectInitialization,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    throw new ProjectRuntimeError(
      "project-initialization-authorization-invalid",
      "$request.authorization",
      "authorization must be produced by the active permission broker process",
    );
  }
  assertAuthorizationActive(authorization);
  const { command, workflow } = commandAndWorkflow(plan);
  const expected = createProjectInitializationAuthorizationRequest({
    plan,
    deadlineAt: authorization.challenge.deadlineAt,
  });
  const challenge = authorization.challenge;
  if (
    challenge.runId !== plan.runId ||
    challenge.project.id !== plan.project.id ||
    challenge.project.identityDigest !== plan.project.identityDigest ||
    challenge.registryDigest !== plan.registryDigest ||
    challenge.command.id !== command.id ||
    challenge.command.version !== command.version ||
    challenge.command.handlerDigest !== command.handler.digest ||
    challenge.inputDigest !==
      digestCanonicalJson(createProjectInitializationCommandInput(plan)) ||
    challenge.permissions.length !== 1 ||
    challenge.permissions[0]?.permission !== "write-project-metadata" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.feature !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.workflow) !== canonicalizeJson(expected.workflow) ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.grantIds.length < 1 ||
    workflow.resolvedPlanDigest !== challenge.workflow?.resolvedPlanDigest
  ) {
    runtimeError(
      "project-initialization-authorization-invalid",
      "$request.authorization",
      "authorization is not exactly bound to this initialization plan and workflow",
    );
  }
  return authorization;
}

function actualEffects(
  tracker: ExecutionTracker,
  durationMs: number,
): PermissionActualEffects {
  const changedPaths = sortedPaths(tracker.touchedPaths);
  return Object.freeze({
    changedPaths,
    changedBytes: tracker.changedBytes,
    objectIds: Object.freeze([]),
    destinations: Object.freeze([]),
    dataClasses: Object.freeze([]),
    changeKinds: Object.freeze(
      changedPaths.length === 0 ? [] : (["metadata"] as const),
    ),
    publishTargets: Object.freeze([]),
    durationMs,
    outputBytes: 0,
    repairCycles: 0,
  });
}

function settleAuthorization(
  authorization: AuthorizedPermissionDecision,
  tracker: ExecutionTracker,
  durationMs: number,
  outcome: "failed" | "succeeded" | "uncertain",
  mutationUncertain: boolean,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome: mutationUncertain ? "uncertain" : outcome,
      mutationUncertain,
      actual: actualEffects(tracker, durationMs),
    });
  } catch {
    runtimeError(
      "project-initialization-recovery-required",
      "$settlement",
      "initialization effects could not be settled with the permission broker",
      tracker.touchedPaths.size > 0 || mutationUncertain,
    );
  }
}

function failureOf(
  error: unknown,
  at: string,
  fallback = "project-initialization-execution-failed",
): ExecutionFailure {
  const candidate =
    error instanceof ProjectRuntimeError || error instanceof CoreBoundaryError
      ? error.code
      : fallback;
  return Object.freeze({
    code: parseStableId(isStableId(candidate) ? candidate : fallback),
    at: parseStableId(at),
    mutationUncertain:
      (error instanceof ProjectRuntimeError || error instanceof CoreBoundaryError) &&
      error.mutationUncertain,
  });
}

async function rollbackCreatedControlDirectories(
  root: ReturnType<
    typeof internalsForPreparedProjectInitialization
  >["targetRoot"],
  created: readonly CreatedControlDirectory[],
): Promise<ExecutionFailure | undefined> {
  let failure: ExecutionFailure | undefined;
  for (const directory of [...created].reverse()) {
    try {
      await deleteProjectDirectoryCas({
        root,
        path: directory.path,
        expectedIdentity: directory.identity,
        maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
      });
    } catch (error) {
      failure ??= failureOf(error, "bootstrap-rollback");
    }
  }
  return failure;
}

async function bootstrapLaneDirectories(
  plan: PreparedProjectInitialization,
  created: CreatedControlDirectory[],
): Promise<void> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  try {
    for (const path of BOOTSTRAP_PATHS) {
      const target = plan.targets.find((candidate) => candidate.path === path);
      if (target?.action !== "create") continue;
      const result = await createProjectDirectoryCas({
        root: targetRoot,
        path,
        maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
      });
      created.push(Object.freeze({ path: result.path, identity: result.identity }));
    }
  } catch (error) {
    const rollbackFailure = await rollbackCreatedControlDirectories(
      targetRoot,
      created,
    );
    if (rollbackFailure !== undefined) {
      runtimeError(
        "project-initialization-recovery-required",
        "$bootstrap",
        "lane bootstrap could not be rolled back safely",
        true,
      );
    }
    throw error;
  }
}

async function initializeControlStateDirectories(
  plan: PreparedProjectInitialization,
  authorization: AuthorizedPermissionDecision,
  lane: ProjectLaneLease,
  signal: AbortSignal | null,
  state: ControlInitializationState,
): Promise<void> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  for (const path of CONTROL_STATE_DIRECTORIES) {
    assertAuthorizationActive(authorization);
    await lane.assertOwned();
    assertAuthorizationActive(authorization);
    assertNotCancelled(signal);

    const created = state.createdDirectories.find(
      (directory) => directory.path === path,
    );
    if (created !== undefined) {
      try {
        const current = await readProjectDirectoryIdentity({
          root: targetRoot,
          path,
          maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
        });
        if (current.identityDigest !== created.identity.identityDigest) {
          throw new Error("created control directory identity changed");
        }
      } catch {
        runtimeError(
          "project-initialization-recovery-required",
          "$control-state",
          "a created control directory changed before initialization completed",
          true,
        );
      }
      continue;
    }

    const resolved = await resolveProjectPath(targetRoot, path, {
      existence: "optional",
      expectedType: "directory",
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
    if (resolved.kind === "directory") continue;

    assertAuthorizationActive(authorization);
    await lane.assertOwned();
    assertAuthorizationActive(authorization);
    assertNotCancelled(signal);
    const result = await createProjectDirectoryCas({
      root: targetRoot,
      path,
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
    state.createdDirectories.push(
      Object.freeze({ path: result.path, identity: result.identity }),
    );
  }
}

async function acquireInitializationLane(
  plan: PreparedProjectInitialization,
  signal: AbortSignal | null,
): Promise<ProjectLaneLease> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  return acquireProjectLane({
    root: targetRoot,
    projectIdentityDigest: plan.project.identityDigest,
    runId: plan.runId,
    lane: "project-write",
    leaseDurationMs: INITIALIZATION_LANE_LEASE_MS,
    waitTimeoutMs: INITIALIZATION_LANE_WAIT_MS,
    pollIntervalMs: INITIALIZATION_LANE_POLL_MS,
    signal,
  });
}

function assertNotCancelled(signal: AbortSignal | null): void {
  if (signal?.aborted === true) {
    runtimeError(
      "project-initialization-execution-failed",
      "$request.signal",
      "project initialization was cancelled before the next mutation",
    );
  }
}

async function stageProjectTargets(
  plan: PreparedProjectInitialization,
): Promise<TargetStage[]> {
  const { targetRoot, contentByPath } =
    internalsForPreparedProjectInitialization(plan);
  const stages: TargetStage[] = [];
  try {
    for (const target of plan.targets) {
      if (target.action !== "create" || CONTROL_STATE_PATHS.has(target.path)) {
        continue;
      }
      if (target.kind === "directory") {
        stages.push({
          target,
          kind: "directory",
          stage: await stageProjectDirectoryCasCreate({
            root: targetRoot,
            path: target.path,
            maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
          }),
        });
      } else {
        const content = contentByPath.get(target.path);
        if (content === undefined) {
          runtimeError(
            "project-initialization-plan-untrusted",
            "$plan.targets",
            "prepared initialization file content is unavailable",
          );
        }
        stages.push({
          target,
          kind: "file",
          stage: await stageProjectFileCas({
            root: targetRoot,
            path: target.path,
            content,
            expected: { mode: "absent" },
            maxBytes: PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
            maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
          }),
        });
      }
    }
    return stages;
  } catch (error) {
    for (const staged of [...stages].reverse()) {
      if (staged.stage.state === "staged") {
        try {
          await staged.stage.abort();
        } catch {
          runtimeError(
            "project-initialization-recovery-required",
            "$stage.abort",
            "a staged initialization target could not be cleaned up",
            true,
          );
        }
      }
    }
    throw error;
  }
}

async function abortRemainingStages(
  stages: readonly TargetStage[],
  tracker: ExecutionTracker,
): Promise<ExecutionFailure | undefined> {
  let failure: ExecutionFailure | undefined;
  for (const staged of [...stages].reverse()) {
    if (staged.stage.state !== "staged") continue;
    try {
      await staged.stage.abort();
    } catch (error) {
      tracker.touchedPaths.add(staged.target.path);
      tracker.changedBytes += staged.target.desiredBytes ?? 0;
      failure ??= Object.freeze({
        ...failureOf(error, "stage-abort"),
        mutationUncertain: true,
      });
    }
  }
  return failure;
}

async function rollbackAppliedTargets(
  plan: PreparedProjectInitialization,
  tracker: ExecutionTracker,
): Promise<ExecutionFailure | undefined> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  let failure: ExecutionFailure | undefined;
  for (const applied of [...tracker.applied].reverse()) {
    try {
      if (applied.target.kind === "directory") {
        if (applied.identity === undefined) {
          throw new Error("missing directory identity");
        }
        await deleteProjectDirectoryCas({
          root: targetRoot,
          path: applied.target.path,
          expectedIdentity: applied.identity,
          maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
        });
      } else {
        if (applied.digest === undefined) {
          throw new Error("missing file digest");
        }
        const deleted = await deleteProjectFileCas({
          root: targetRoot,
          path: applied.target.path,
          expectedDigest: applied.digest,
          maxBytes: PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
          maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
        });
        tracker.changedBytes += deleted.bytes;
      }
      tracker.rolledBackPaths.add(applied.target.path);
    } catch (error) {
      failure ??= Object.freeze({
        ...failureOf(error, "rollback"),
        mutationUncertain: true,
      });
    }
  }
  return failure;
}

async function verifyFinalTargets(
  plan: PreparedProjectInitialization,
): Promise<void> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  for (const target of plan.targets) {
    if (target.kind === "directory") {
      await resolveProjectPath(targetRoot, target.path, {
        existence: "required",
        expectedType: "directory",
        maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
      });
      continue;
    }
    const snapshot = await readProjectFileSnapshot({
      root: targetRoot,
      path: target.path,
      maxBytes: PROJECT_INITIALIZATION_COMMAND_MAX_METADATA_BYTES,
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
    if (
      snapshot.digest !== target.desiredDigest ||
      snapshot.bytes !== target.desiredBytes
    ) {
      runtimeError(
        "project-initialization-execution-failed",
        "$verify",
        "an initialization target does not match its prepared postcondition",
      );
    }
  }
}

async function executeTargetMutation(
  plan: PreparedProjectInitialization,
  authorization: AuthorizedPermissionDecision,
  lane: ProjectLaneLease,
  signal: AbortSignal | null,
): Promise<{
  readonly tracker: ExecutionTracker;
  readonly status: "failed" | "recovery-required" | "rolled-back" | "succeeded";
  readonly failure?: ExecutionFailure;
}> {
  const tracker: ExecutionTracker = {
    touchedPaths: new Set<PortableProjectPath>(),
    applied: [],
    rolledBackPaths: new Set<PortableProjectPath>(),
    changedBytes: 0,
  };
  let stages: TargetStage[] = [];
  let failure: ExecutionFailure | undefined;
  try {
    assertAuthorizationActive(authorization);
    await lane.assertOwned();
    assertNotCancelled(signal);
    stages = await stageProjectTargets(plan);
    for (const staged of stages) {
      assertAuthorizationActive(authorization);
      await lane.assertOwned();
      assertNotCancelled(signal);
      try {
        if (staged.kind === "directory") {
          const result = await staged.stage.commit();
          tracker.touchedPaths.add(staged.target.path);
          tracker.applied.push({
            target: staged.target,
            identity: result.identity,
          });
        } else {
          const result = await staged.stage.commit();
          tracker.touchedPaths.add(staged.target.path);
          tracker.changedBytes += result.bytes;
          tracker.applied.push({
            target: staged.target,
            digest: result.afterDigest,
          });
        }
      } catch (error) {
        const commitFailure = failureOf(error, "commit");
        if (commitFailure.mutationUncertain) {
          tracker.touchedPaths.add(staged.target.path);
          tracker.changedBytes += staged.target.desiredBytes ?? 0;
        }
        throw error;
      }
      await yieldImmediate();
    }
    assertAuthorizationActive(authorization);
    await lane.assertOwned();
    assertNotCancelled(signal);
    await verifyFinalTargets(plan);
    await lane.assertOwned();
    return Object.freeze({ tracker, status: "succeeded" });
  } catch (error) {
    failure = failureOf(
      error,
      error instanceof ProjectRuntimeError &&
        error.path === "$request.signal"
        ? "cancellation"
        : "execution",
    );
  }

  const abortFailure = await abortRemainingStages(stages, tracker);
  failure ??= abortFailure;
  const rollbackFailure = await rollbackAppliedTargets(plan, tracker);
  failure ??= rollbackFailure;
  const finalFailure =
    failure ?? failureOf(undefined, "execution");
  const uncertain =
    finalFailure.mutationUncertain ||
    abortFailure !== undefined ||
    rollbackFailure !== undefined;
  const status = uncertain
    ? "recovery-required"
    : tracker.applied.length > 0
      ? "rolled-back"
      : "failed";
  return Object.freeze({ tracker, status, failure: finalFailure });
}

function checkpointRecordPath(
  checkpoint: WorkflowCheckpointRecord,
): PortableProjectPath {
  return parsePortableProjectPath(
    `${WORKFLOW_CHECKPOINT_STORE_PATH}/${checkpoint.identity.runId}.${checkpoint.sequence}.${checkpoint.checkpointDigest.slice("sha256:".length)}.checkpoint.json`,
  );
}

function receiptRecordPath(receipt: RunReceipt): PortableProjectPath {
  return parsePortableProjectPath(
    `${RUN_RECEIPT_STORE_PATH}/${receipt.identity.runId}.${receipt.receiptDigest.slice("sha256:".length)}.receipt.json`,
  );
}

function runtimePlatform(): "windows" | "linux" | "macos" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  runtimeError(
    "project-initialization-execution-failed",
    "$environment.platform",
    "the current operating system cannot be represented in a run receipt",
  );
}

function runtimeArchitecture(): "x64" | "arm64" {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  runtimeError(
    "project-initialization-execution-failed",
    "$environment.architecture",
    "the current architecture cannot be represented in a run receipt",
  );
}

function changedFiles(
  tracker: ExecutionTracker,
  status: "failed" | "recovery-required" | "rolled-back" | "succeeded",
): RunReceipt["mutation"]["changedFiles"] {
  const applied = new Map(
    tracker.applied.map((entry) => [entry.target.path, entry]),
  );
  return sortedPaths(tracker.touchedPaths).map((path) => {
    const entry = applied.get(path);
    const rolledBack = tracker.rolledBackPaths.has(path);
    const file = entry?.target.kind === "file" ? entry : undefined;
    return Object.freeze({
      path,
      ...(file?.digest === undefined || rolledBack
        ? {}
        : { postimageDigest: file.digest }),
      bytesDelta:
        status === "succeeded" ||
        (status === "recovery-required" && !rolledBack)
          ? (file?.target.desiredBytes ?? 0)
          : 0,
    });
  });
}

function buildRunReceipt(
  plan: PreparedProjectInitialization,
  started: WorkflowCheckpointRecord,
  tracker: ExecutionTracker,
  status: "failed" | "recovery-required" | "rolled-back" | "succeeded",
  failure: ExecutionFailure | undefined,
  settlement: PermissionSettlement,
  startedAt: string,
  endedAt: string,
): RunReceipt {
  const inFlight = started.inFlight;
  if (inFlight === undefined) {
    runtimeError(
      "project-initialization-evidence-failed",
      "$checkpoint.inFlight",
      "started initialization checkpoint lost its command binding",
      true,
    );
  }
  const { registry, profile } = internalsForPreparedProjectInitialization(plan);
  const receiptStatus =
    status === "succeeded"
      ? "succeeded"
      : status === "recovery-required"
        ? "uncertain"
        : "failed";
  const innerStatus =
    status === "succeeded"
      ? "passed"
      : status === "recovery-required"
        ? "uncertain"
        : "failed";
  const mutationStatus =
    status === "succeeded"
      ? tracker.touchedPaths.size === 0
        ? "none"
        : "committed"
      : status === "recovery-required"
        ? "uncertain"
        : status === "rolled-back"
          ? "rolled-back"
          : "none";
  const body: Omit<RunReceipt, "receiptDigest"> = {
    schemaVersion: parseSemanticVersion("1.0.0").value,
    receiptId: randomUUID(),
    ...(started.receiptChainHead === undefined
      ? {}
      : { previousReceiptDigest: started.receiptChainHead }),
    status: receiptStatus,
    identity: {
      runId: started.identity.runId,
      workflowId: started.identity.workflow.id,
      stepId: inFlight.stepId,
      attempt: inFlight.attempt,
      phase: inFlight.phase,
      projectId: started.identity.projectId,
      resolvedPlanDigest: started.identity.workflow.resolvedPlanDigest,
    },
    authority: {
      command: {
        id: inFlight.command.id,
        version: inFlight.command.version,
        descriptorDigest: inFlight.command.descriptorDigest,
      },
      registryDigest: started.identity.registryDigest,
      handlerDigest: inFlight.command.handlerDigest,
      inputDigest: inFlight.inputDigest,
      authorizationId: inFlight.authorizationId,
      authorizationRequestDigest: inFlight.authorizationRequestDigest,
      packDigests: registry.packs
        .filter(({ provides }) => provides.commands.includes(inFlight.command.id))
        .map(({ digest }) => digest)
        .sort(compareCanonicalText),
      approvalIds: [...inFlight.approvalIds].sort(compareCanonicalText),
    },
    environment: {
      platform: runtimePlatform(),
      architecture: runtimeArchitecture(),
      nodeVersion: parseSemanticVersion(process.versions.node).value,
      projectIdentityDigest: plan.project.rootIdentityDigest,
      engine: { id: profile.engine.id, version: profile.engine.version },
    },
    timing: {
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    },
    effects: settlement.actual,
    outcomes: {
      outer:
        status === "succeeded"
          ? { status: "passed", exitCode: 0, timedOut: false }
          : status === "recovery-required"
            ? { status: "uncertain", timedOut: false }
            : { status: "failed", exitCode: 1, timedOut: false },
      inner: {
        status: innerStatus,
        code:
          status === "succeeded"
            ? parseStableId("project-initialized")
            : (failure?.code ?? parseStableId("authorization-settlement-uncertain")),
        message:
          status === "succeeded"
            ? "Project initialization completed and was verified."
            : status === "recovery-required"
              ? "Project initialization stopped with unresolved mutation state."
              : status === "rolled-back"
                ? "Project initialization failed and confirmed mutations were rolled back."
                : "Project initialization failed before a project target was committed.",
      },
    },
    mutation: {
      status: mutationStatus,
      changedFiles: changedFiles(tracker, status),
      unexpectedDirtyFiles: [],
    },
    artifacts: [],
    diagnostics:
      status === "succeeded"
        ? []
        : [
            {
              severity: status === "recovery-required" ? "error" : "warning",
              code:
                failure?.code ??
                parseStableId("authorization-settlement-uncertain"),
              message:
                "The bounded initialization outcome requires the recorded terminal handling.",
              redacted: true,
            },
          ],
    recovery:
      status === "rolled-back"
        ? {
            attempted: true,
            outcome: "passed",
            actions: ["Reversed every confirmed project target creation."],
          }
        : status === "recovery-required"
          ? {
              attempted: true,
              outcome: "uncertain",
              actions: [
                "Stopped without retry and retained the workflow recovery barrier.",
              ],
            }
          : { attempted: false, outcome: "not-run", actions: [] },
  };
  return deepFreeze({
    ...body,
    receiptDigest: computeRunReceiptDigest(body),
  });
}

async function controlPlaneEffects(
  plan: PreparedProjectInitialization,
  createdDirectories: ReadonlySet<PortableProjectPath>,
  checkpoints: readonly WorkflowCheckpointRecord[],
  receipt: RunReceipt,
): Promise<{
  readonly changedPaths: readonly PortableProjectPath[];
  readonly changedFiles: number;
  readonly changedBytes: number;
}> {
  const { targetRoot } = internalsForPreparedProjectInitialization(plan);
  const filePaths = [
    ...checkpoints.map(checkpointRecordPath),
    parsePortableProjectPath(
      `${WORKFLOW_CHECKPOINT_STORE_PATH}/${plan.runId}.head.json`,
    ),
    receiptRecordPath(receipt),
    parsePortableProjectPath(`${RUN_RECEIPT_STORE_PATH}/${plan.runId}.head.json`),
  ];
  let changedBytes = 0;
  for (const path of filePaths) {
    const snapshot = await readProjectFileSnapshot({
      root: targetRoot,
      path,
      maxBytes: PROJECT_INITIALIZATION_COMMAND_MAX_OUTPUT_BYTES,
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
    changedBytes += snapshot.bytes;
  }
  const changedPaths = sortedPaths([...createdDirectories, ...filePaths]);
  if (
    changedPaths.length > PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_FILES ||
    changedBytes < 1 ||
    changedBytes > PROJECT_INITIALIZATION_CONTROL_STATE_MAX_CHANGED_BYTES
  ) {
    runtimeError(
      "project-initialization-evidence-failed",
      "$evidence.controlPlaneState",
      "durable initialization evidence exceeded its fixed accounting boundary",
      true,
    );
  }
  return Object.freeze({
    changedPaths,
    changedFiles: changedPaths.length,
    changedBytes,
  });
}

function reportStatusAfterSettlement(
  intended: "failed" | "recovery-required" | "rolled-back" | "succeeded",
  settlement: PermissionSettlement,
): "failed" | "recovery-required" | "rolled-back" | "succeeded" {
  return settlement.mutationUncertain || settlement.status === "scope-violation"
    ? "recovery-required"
    : intended;
}

async function executeWithLane(
  plan: PreparedProjectInitialization,
  authorization: AuthorizedPermissionDecision,
  lane: ProjectLaneLease,
  signal: AbortSignal | null,
  controlState: ControlInitializationState,
): Promise<ProjectInitializationReport> {
  const { registry, targetRoot } =
    internalsForPreparedProjectInitialization(plan);
  assertAuthorizationActive(authorization);
  await lane.assertOwned();
  assertAuthorizationActive(authorization);
  assertNotCancelled(signal);
  await initializeControlStateDirectories(
    plan,
    authorization,
    lane,
    signal,
    controlState,
  );
  await lane.assertOwned();
  assertAuthorizationActive(authorization);
  assertNotCancelled(signal);
  const inputDigest = digestCanonicalJson(
    createProjectInitializationCommandInput(plan),
  );
  let stored = await persistWorkflowCheckpoint({
    root: targetRoot,
    registry,
    checkpoint: createWorkflowCheckpoint({
      registry,
      workflowId: INITIALIZATION_WORKFLOW_ID,
      project: {
        id: plan.project.id,
        identityDigest: plan.project.identityDigest,
        rootIdentityDigest: plan.project.rootIdentityDigest,
        stage: plan.project.stage,
      },
      runId: plan.runId,
      inputDigest,
      ttlMs: INITIALIZATION_CHECKPOINT_TTL_MS,
    }),
  });
  controlState.durableCheckpoint = true;
  const checkpoints: WorkflowCheckpointRecord[] = [stored.checkpoint];
  assertAuthorizationActive(authorization);
  await lane.assertOwned();
  assertAuthorizationActive(authorization);
  assertNotCancelled(signal);
  const admitted = beginWorkflowStep({
    registry,
    checkpoint: stored.checkpoint,
    authorization,
  });
  stored = await persistWorkflowCheckpoint({
    root: targetRoot,
    registry,
    checkpoint: admitted,
    previous: stored,
  });
  checkpoints.push(stored.checkpoint);
  assertAuthorizationActive(authorization);
  await lane.assertOwned();
  assertAuthorizationActive(authorization);
  assertNotCancelled(signal);
  const started = markWorkflowStepStarted({
    registry,
    checkpoint: stored.checkpoint,
  });
  stored = await persistWorkflowCheckpoint({
    root: targetRoot,
    registry,
    checkpoint: started,
    previous: stored,
  });
  checkpoints.push(stored.checkpoint);
  const executionStartedMs = Math.max(
    Date.now(),
    Date.parse(stored.checkpoint.updatedAt),
  );

  const execution = await executeTargetMutation(
    plan,
    authorization,
    lane,
    signal,
  );
  const executionEndedMs = Math.max(Date.now(), executionStartedMs);
  const durationMs = executionEndedMs - executionStartedMs;
  const initialUncertain = execution.status === "recovery-required";
  const settlement = settleAuthorization(
    authorization,
    execution.tracker,
    durationMs,
    execution.status === "succeeded"
      ? "succeeded"
      : initialUncertain
        ? "uncertain"
        : "failed",
    initialUncertain,
  );
  const status = reportStatusAfterSettlement(execution.status, settlement);
  const startedAt = new Date(executionStartedMs).toISOString();
  const endedAt = new Date(executionEndedMs).toISOString();
  const receipt = buildRunReceipt(
    plan,
    stored.checkpoint,
    execution.tracker,
    status,
    execution.failure,
    settlement,
    startedAt,
    endedAt,
  );
  validateRegisteredContractValue(
    registry,
    {
      schemaId: runReceiptSchema.schemaId,
      digest: runReceiptSchema.digest,
    },
    receipt,
  );
  let storedReceipt: StoredRunReceipt;
  try {
    storedReceipt = await persistRunReceipt({
      root: targetRoot,
      registry,
      receipt,
      maxArtifactBytes: 0,
    });
  } catch {
    runtimeError(
      "project-initialization-evidence-failed",
      "$evidence.receipt",
      "initialization run receipt could not be retained",
      true,
    );
  }
  const terminal = settleWorkflowStep({
    registry,
    checkpoint: stored.checkpoint,
    receipt,
    settlement,
  });
  validateRegisteredContractValue(
    registry,
    {
      schemaId: workflowCheckpointSchema.schemaId,
      digest: workflowCheckpointSchema.digest,
    },
    terminal,
  );
  let terminalStored: StoredWorkflowCheckpoint;
  try {
    terminalStored = await persistWorkflowCheckpoint({
      root: targetRoot,
      registry,
      checkpoint: terminal,
      previous: stored,
    });
  } catch {
    runtimeError(
      "project-initialization-evidence-failed",
      "$evidence.checkpoint",
      "terminal initialization checkpoint could not be retained",
      true,
    );
  }
  checkpoints.push(terminalStored.checkpoint);
  const controlPlaneState = await controlPlaneEffects(
    plan,
    new Set(
      controlState.createdDirectories.map((directory) => directory.path),
    ),
    checkpoints,
    receipt,
  );
  const changedPaths = sortedPaths(execution.tracker.touchedPaths);
  const appliedPaths = sortedPaths(
    execution.tracker.applied.map(({ target }) => target.path),
  );
  const rolledBackPaths = sortedPaths(execution.tracker.rolledBackPaths);
  const authorizationStatus =
    status === "recovery-required"
      ? "uncertain"
      : status === "succeeded"
        ? "succeeded"
        : "failed";
  const code =
    status === "succeeded"
      ? parseStableId("project-initialized")
      : status === "rolled-back"
        ? parseStableId("project-initialization-rolled-back")
        : status === "recovery-required"
          ? parseStableId("project-initialization-recovery-required")
          : parseStableId("project-initialization-failed");
  const errorCode =
    execution.failure?.code ??
    parseStableId("authorization-settlement-uncertain");
  const errorAt =
    execution.failure?.at ?? parseStableId("authorization-settlement");
  const body: ProjectInitializationReportDigestInput = {
    schemaVersion: "1.0.0",
    commandId: PROJECT_INITIALIZATION_COMMAND_ID,
    runId: plan.runId,
    registryDigest: plan.registryDigest,
    project: plan.project,
    initPlanDigest: plan.initPlanDigest,
    preparedPlanDigest: plan.preparedPlanDigest,
    profileDigest: plan.profileDigest,
    packLockDigest: plan.packLockDigest,
    inputDigest,
    status,
    code,
    mutationAttempted:
      status === "succeeded" ||
      status === "rolled-back" ||
      status === "recovery-required",
    mutationUncertain: status === "recovery-required",
    effects: {
      changedPaths,
      changedBytes: execution.tracker.changedBytes,
      appliedPaths,
      rolledBackPaths,
      controlPlaneState,
    },
    timing: { startedAt, endedAt, durationMs },
    authorization: {
      authorizationId: settlement.authorizationId,
      requestDigest: settlement.requestDigest,
      status: authorizationStatus,
      mutationUncertain: status === "recovery-required",
      violations: settlement.violations
        .map((violation) => parseStableId(violation))
        .sort(compareCanonicalText),
      approvalIds: [...authorization.lease.grantIds].sort(compareCanonicalText),
      settledAt: settlement.settledAt,
    },
    evidence: {
      receipt: {
        receiptId: receipt.receiptId,
        receiptDigest: storedReceipt.receipt.receiptDigest,
        headDigest: storedReceipt.headDigest,
        chainLength: storedReceipt.chainLength,
      },
      checkpoint: {
        checkpointId: terminalStored.checkpoint.checkpointId,
        checkpointDigest: terminalStored.checkpoint.checkpointDigest,
        headDigest: terminalStored.headDigest,
        sequence: terminalStored.checkpoint.sequence,
      },
      activeMarker:
        status === "recovery-required"
          ? {
              status: "retained",
              digest: terminalStored.checkpoint.checkpointDigest,
            }
          : { status: "cleared" },
    },
    ...(status === "succeeded"
      ? {}
      : { error: { code: errorCode, at: errorAt } }),
    externalProcessStarted: false,
    networkAccessPerformed: false,
    editorControlPerformed: false,
  };
  const report = deepFreeze({
    ...body,
    reportDigest: computeProjectInitializationReportDigest(body),
  });
  assertProjectInitializationReportSemantics(report);
  validateRegisteredContractValue(registry, commandAndWorkflow(plan).command.output, report);
  return report;
}

async function settlePreExecutionFailure(
  authorization: AuthorizedPermissionDecision,
  startedAtMs: number,
  mutationUncertain: boolean,
  touchedPaths: readonly PortableProjectPath[] = [],
): Promise<void> {
  if (authorization.lease.state !== "active") return;
  const tracker: ExecutionTracker = {
    touchedPaths: new Set(touchedPaths),
    applied: [],
    rolledBackPaths: new Set<PortableProjectPath>(),
    changedBytes: 0,
  };
  settleAuthorization(
    authorization,
    tracker,
    Math.max(0, Date.now() - startedAtMs),
    mutationUncertain ? "uncertain" : "failed",
    mutationUncertain,
  );
}

function mutationIsUncertain(error: unknown): boolean {
  return (
    (error instanceof ProjectRuntimeError || error instanceof CoreBoundaryError) &&
    error.mutationUncertain
  );
}

function authorizedCreatedControlPaths(
  plan: PreparedProjectInitialization,
  created: readonly CreatedControlDirectory[],
): readonly PortableProjectPath[] {
  const authorized = new Set(
    plan.targets
      .filter((target) => target.action === "create")
      .map((target) => target.path),
  );
  return sortedPaths(
    created
      .map((directory) => directory.path)
      .filter((path) => authorized.has(path)),
  );
}

function executionRuntimeError(
  error: unknown,
  mutationUncertain: boolean,
  beforeFirstCheckpoint: boolean,
): ProjectRuntimeError {
  if (error instanceof ProjectRuntimeError && !beforeFirstCheckpoint) {
    return error;
  }
  if (mutationUncertain) {
    return new ProjectRuntimeError(
      "project-initialization-recovery-required",
      beforeFirstCheckpoint ? "$control-state" : "$execution",
      beforeFirstCheckpoint
        ? "pre-checkpoint initialization state could not be reconciled safely"
        : "initialization state could not be reconciled safely",
      true,
    );
  }
  if (error instanceof ProjectRuntimeError) return error;
  return new ProjectRuntimeError(
    "project-initialization-execution-failed",
    beforeFirstCheckpoint ? "$control-state" : "$execution",
    beforeFirstCheckpoint
      ? "project initialization stopped before its first durable checkpoint"
      : "project initialization stopped after its durable checkpoint",
  );
}

export async function executePreparedProjectInitialization(
  value: ExecutePreparedProjectInitializationRequest,
): Promise<ProjectInitializationReport> {
  const startedAtMs = Date.now();
  const record = dataRecord(value, "$request");
  exactKeys(record, ["plan", "authorization", "signal"], "$request");
  if (
    value.signal !== null &&
    !(value.signal instanceof AbortSignal)
  ) {
    runtimeError(
      "invalid-project-initialization-execution-request",
      "$request.signal",
      "signal must be a genuine AbortSignal or null",
    );
  }
  let plan: PreparedProjectInitialization;
  try {
    assertPreparedProjectInitialization(value.plan);
    plan = value.plan;
    createProjectInitializationCommandInput(plan);
  } catch {
    throw new ProjectRuntimeError(
      "project-initialization-plan-untrusted",
      "$request.plan",
      "execution requires a same-process ready initialization plan",
    );
  }
  const authorization = validateAuthorization(plan, value.authorization);
  const internals = internalsForPreparedProjectInitialization(plan);
  let refreshed: PreparedProjectInitialization;
  try {
    refreshed = await prepareProjectInitialization({
      registry: internals.registry,
      targetRoot: internals.targetRoot,
      expectedInitPlanDigest: plan.initPlanDigest,
      profile: internals.profile,
      runId: plan.runId,
    });
    if (
      canonicalizeJson(createProjectInitializationCommandInput(refreshed)) !==
      canonicalizeJson(createProjectInitializationCommandInput(plan))
    ) {
      throw new Error("refreshed plan changed");
    }
  } catch {
    await settlePreExecutionFailure(authorization, startedAtMs, false);
    throw new ProjectRuntimeError(
      "project-initialization-plan-stale",
      "$plan",
      "approved initialization plan changed before mutation",
    );
  }

  const bootstrap: CreatedControlDirectory[] = [];
  try {
    assertAuthorizationActive(authorization);
    assertNotCancelled(value.signal);
    await bootstrapLaneDirectories(refreshed, bootstrap);
  } catch (error) {
    const uncertain = mutationIsUncertain(error);
    await settlePreExecutionFailure(
      authorization,
      startedAtMs,
      uncertain,
      authorizedCreatedControlPaths(refreshed, bootstrap),
    );
    throw executionRuntimeError(error, uncertain, true);
  }

  let lane: ProjectLaneLease;
  try {
    lane = await acquireInitializationLane(refreshed, value.signal);
  } catch (error) {
    const rollbackFailure = await rollbackCreatedControlDirectories(
      internals.targetRoot,
      bootstrap,
    );
    const uncertain = rollbackFailure !== undefined;
    await settlePreExecutionFailure(
      authorization,
      startedAtMs,
      uncertain,
      authorizedCreatedControlPaths(refreshed, bootstrap),
    );
    if (!uncertain && value.signal?.aborted === true) {
      throw new ProjectRuntimeError(
        "project-initialization-execution-failed",
        "$request.signal",
        "project initialization was cancelled while acquiring its mutation lane",
      );
    }
    throw new ProjectRuntimeError(
      uncertain
        ? "project-initialization-recovery-required"
        : "project-initialization-lane-failed",
      "$lane",
      uncertain
        ? "lane bootstrap could not be safely removed after acquisition failed"
        : "project initialization lane could not be acquired",
      uncertain,
    );
  }

  const controlState: ControlInitializationState = {
    createdDirectories: [...bootstrap],
    durableCheckpoint: false,
  };
  let report: ProjectInitializationReport | undefined;
  let executionError: unknown;
  try {
    report = await executeWithLane(
      refreshed,
      authorization,
      lane,
      value.signal,
      controlState,
    );
  } catch (error) {
    executionError = error;
  }

  try {
    if (lane.state === "active") await lane.release();
  } catch {
    if (authorization.lease.state === "active") {
      await settlePreExecutionFailure(
        authorization,
        startedAtMs,
        true,
        authorizedCreatedControlPaths(
          refreshed,
          controlState.createdDirectories,
        ),
      );
    }
    throw new ProjectRuntimeError(
      "project-initialization-recovery-required",
      "$lane.release",
      report === undefined
        ? "failed initialization could not release its project lane"
        : "initialization completed but the project lane could not be released",
      true,
    );
  }

  if (executionError !== undefined) {
    const beforeFirstCheckpoint = !controlState.durableCheckpoint;
    let uncertain = mutationIsUncertain(executionError);
    if (beforeFirstCheckpoint && !uncertain) {
      const rollbackFailure = await rollbackCreatedControlDirectories(
        internals.targetRoot,
        controlState.createdDirectories,
      );
      uncertain = rollbackFailure !== undefined;
    }
    await settlePreExecutionFailure(
      authorization,
      startedAtMs,
      uncertain,
      authorizedCreatedControlPaths(
        refreshed,
        controlState.createdDirectories,
      ),
    );
    throw executionRuntimeError(
      executionError,
      uncertain,
      beforeFirstCheckpoint,
    );
  }

  return report!;
}
