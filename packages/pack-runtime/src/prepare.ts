import {
  compareCanonicalText,
  compareSemanticVersions,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  PACK_OPERATION_COMMAND_IDS,
  PROJECT_STAGES,
  type PackManifest,
  type ProjectStage,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertProjectRootIdentity,
  CoreBoundaryError,
  readProjectDirectoryIdentity,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ProjectFileSnapshotResult,
} from "@ai-game-playbook/core";
import {
  assertValidatedRegistry,
  resolveWorkflowPlan,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";
import { types as utilTypes } from "node:util";

import { PackRuntimeError } from "./errors.js";
import { createPackDirectoryOwnershipMarker } from "./directory-ownership.js";
import { registerPreparedPackOperation } from "./prepared-plan.js";
import {
  loadInstalledPackState,
  type InstalledPackArtifact,
  type InstalledPackRecord,
  type LoadedInstalledPackState,
} from "./state.js";
import { loadActivePackTransactionRecord } from "./active-transaction.js";
import type {
  PackChange,
  PackConflict,
  PackDirectoryChange,
  PackOperation,
  PackOperationLimits,
  PreparePackOperationRequest,
  PreparedPackOperation,
} from "./types.js";

const PACK_RUNTIME_MAX_ARTIFACTS = 64;
const PACK_RUNTIME_MAX_DIRECTORIES = 64;
const PACK_RUNTIME_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const PACK_RUNTIME_MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const PACK_RUNTIME_MAX_DIRECTORY_ENTRIES = 100_000;
const PACK_RUNTIME_RESERVED_TARGET_ROOTS = Object.freeze([
  ".ai-game-playbook/locks",
  ".ai-game-playbook/state",
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface NormalizedPrepareRequest {
  readonly operation: PackOperation;
  readonly registry: ValidatedRegistry;
  readonly targetRoot: CanonicalProjectRoot;
  readonly sourceRoot?: CanonicalProjectRoot;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly workflow?: {
    readonly id: StableId;
    readonly stepId: StableId;
    readonly projectStage: ProjectStage;
    readonly resolvedPlanDigest: Sha256Digest;
  };
  readonly runId: string;
  readonly packId: StableId;
  readonly limits: PackOperationLimits;
}

interface SnapshotByPath {
  readonly path: string;
  readonly snapshot: ProjectFileSnapshotResult;
}

interface GeneratedContentByPath {
  readonly path: string;
  readonly content: Uint8Array;
}

interface PlannedDirectoryChanges {
  readonly changes: readonly PackDirectoryChange[];
  readonly markerChanges: readonly PackChange[];
  readonly generatedContents: readonly GeneratedContentByPath[];
  readonly preimages: readonly SnapshotByPath[];
  readonly nextDirectories: readonly PackDirectoryChange["marker"][];
  readonly createdPaths: ReadonlySet<string>;
  readonly conflicts: readonly PackConflict[];
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const sortedExpected = [...expected].sort(compareCanonicalText);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function invalid(path: string, message: string): never {
  throw new PackRuntimeError("invalid-pack-request", path, message);
}

function plainDataRecord(
  value: unknown,
  path: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    invalid(path, "expected a plain data object");
  }
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw new TypeError("value is not a plain string-keyed object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("value contains an accessor or hidden field");
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(descriptors).map(([key, descriptor]) => [
          key,
          descriptor.value,
        ]),
      ),
    );
  } catch (error) {
    if (error instanceof PackRuntimeError) throw error;
    invalid(path, "expected a plain data object");
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    invalid(path, `expected an integer from ${minimum} through ${maximum}`);
  }
  return value as number;
}

function normalizeRequest(
  value: PreparePackOperationRequest,
): NormalizedPrepareRequest {
  const request = plainDataRecord(value, "$request");
  const operation = request["operation"];
  if (operation !== "add" && operation !== "update" && operation !== "remove") {
    invalid("$request.operation", "unknown pack lifecycle operation");
  }
  const requestKeys =
    operation === "remove"
      ? [
          "operation",
          "registry",
          "targetRoot",
          "project",
          "runId",
          "packId",
          "limits",
        ]
      : [
          "operation",
          "registry",
          "targetRoot",
          "sourceRoot",
          "project",
          "runId",
          "packId",
          "limits",
        ];
  const workflowValue = request["workflow"];
  if (workflowValue !== undefined) requestKeys.push("workflow");
  if (!exactKeys(request, requestKeys)) {
    invalid("$request", "pack request contains undeclared or missing fields");
  }
  const registry = request["registry"];
  try {
    assertValidatedRegistry(registry);
  } catch {
    throw new PackRuntimeError(
      "pack-registry-untrusted",
      "$request.registry",
      "registry must be validated in this runtime process",
    );
  }
  const project = plainDataRecord(request["project"], "$request.project");
  const projectId = project["id"];
  const projectIdentityDigest = project["identityDigest"];
  if (
    !exactKeys(project, ["id", "identityDigest"]) ||
    !isStableId(projectId) ||
    !isSha256Digest(projectIdentityDigest)
  ) {
    invalid("$request.project", "project identity is invalid");
  }
  const requestRunId = request["runId"];
  if (typeof requestRunId !== "string" || !UUID_PATTERN.test(requestRunId)) {
    invalid("$request.runId", "run identity must be a canonical UUID");
  }
  let workflow: NormalizedPrepareRequest["workflow"];
  if (workflowValue !== undefined) {
    const workflowRecord = plainDataRecord(
      workflowValue,
      "$request.workflow",
    );
    const workflowId = workflowRecord["id"];
    const workflowStepId = workflowRecord["stepId"];
    const projectStage = workflowRecord["projectStage"];
    if (
      !exactKeys(workflowRecord, ["id", "stepId", "projectStage"]) ||
      !isStableId(workflowId) ||
      !isStableId(workflowStepId) ||
      typeof projectStage !== "string" ||
      !PROJECT_STAGES.includes(projectStage as ProjectStage)
    ) {
      invalid("$request.workflow", "workflow binding is invalid");
    }
    const resolved = resolveWorkflowPlan(
      registry,
      workflowId,
      projectStage as ProjectStage,
    );
    const step = resolved.steps.find(({ id }) => id === workflowStepId);
    if (
      step === undefined ||
      step.command.id !== PACK_OPERATION_COMMAND_IDS[operation] ||
      step.command.lane !== "project-write"
    ) {
      invalid(
        "$request.workflow",
        "workflow step does not bind the selected pack operation",
      );
    }
    workflow = Object.freeze({
      id: resolved.workflow.id,
      stepId: step.id,
      projectStage: projectStage as ProjectStage,
      resolvedPlanDigest: resolved.resolvedPlanDigest,
    });
  }
  const packId = request["packId"];
  if (!isStableId(packId)) {
    invalid("$request.packId", "pack identity must be a stable ID");
  }
  const limitValues = plainDataRecord(request["limits"], "$request.limits");
  if (
    !exactKeys(limitValues, [
      "maxArtifactBytes",
      "maxTotalBytes",
      "maxDirectoryEntries",
    ])
  ) {
    invalid("$request.limits", "pack limits are invalid");
  }
  const limits = Object.freeze({
    maxArtifactBytes: boundedInteger(
      limitValues["maxArtifactBytes"],
      1,
      PACK_RUNTIME_MAX_ARTIFACT_BYTES,
      "$request.limits.maxArtifactBytes",
    ),
    maxTotalBytes: boundedInteger(
      limitValues["maxTotalBytes"],
      1,
      PACK_RUNTIME_MAX_TOTAL_BYTES,
      "$request.limits.maxTotalBytes",
    ),
    maxDirectoryEntries: boundedInteger(
      limitValues["maxDirectoryEntries"],
      1,
      PACK_RUNTIME_MAX_DIRECTORY_ENTRIES,
      "$request.limits.maxDirectoryEntries",
    ),
  });
  if (limits.maxArtifactBytes > limits.maxTotalBytes) {
    invalid(
      "$request.limits",
      "per-artifact byte limit cannot exceed the total byte limit",
    );
  }
  const sourceRoot = request["sourceRoot"];
  if (operation !== "remove" && sourceRoot === undefined) {
    invalid("$request.sourceRoot", "add and update require a local source root");
  }
  return {
    operation,
    registry,
    targetRoot: request["targetRoot"] as CanonicalProjectRoot,
    ...(operation === "remove"
      ? {}
      : { sourceRoot: sourceRoot as CanonicalProjectRoot }),
    project: Object.freeze({
      id: projectId,
      identityDigest: projectIdentityDigest,
    }),
    ...(workflow === undefined ? {} : { workflow }),
    runId: requestRunId,
    packId,
    limits,
  };
}

function operatingSystem(): "linux" | "macos" | "windows" {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function assertSupportedManifest(manifest: PackManifest): void {
  const artifactTargets = new Set(manifest.artifacts.map(({ target }) => target));
  const ownedFilePaths = new Set(
    manifest.ownedPaths
      .filter(({ kind }) => kind === "file")
      .map(({ path }) => path),
  );
  const ownedDirectoryPaths = new Set(
    manifest.ownedPaths
      .filter(({ kind }) => kind === "directory")
      .map(({ path }) => path),
  );
  const ownedPaths = new Set(manifest.ownedPaths.map(({ path }) => path));
  const reservedPath = (path: string): boolean => {
    const foldedTarget = path.toLowerCase();
    return PACK_RUNTIME_RESERVED_TARGET_ROOTS.some(
      (root) =>
        foldedTarget === root || foldedTarget.startsWith(`${root}/`),
    );
  };
  if (
    manifest.lifecycle === "deprecated" ||
    manifest.lifecycle === "internal" ||
    !manifest.compatibility.operatingSystems.includes(operatingSystem()) ||
    manifest.network.required ||
    manifest.network.destinations.length > 0 ||
    Object.keys(manifest.lifecycleHooks).length > 0 ||
    manifest.artifacts.length > PACK_RUNTIME_MAX_ARTIFACTS ||
    ownedDirectoryPaths.size > PACK_RUNTIME_MAX_DIRECTORIES ||
    manifest.artifacts.some(({ mode }) => mode !== "file") ||
    manifest.artifacts.some(({ target }) => reservedPath(target)) ||
    manifest.ownedPaths.some(({ path }) => reservedPath(path)) ||
    manifest.ownedPaths.some(
      ({ kind }) => kind !== "file" && kind !== "directory",
    ) ||
    artifactTargets.size !== manifest.artifacts.length ||
    artifactTargets.size !== ownedFilePaths.size ||
    ownedPaths.size !== manifest.ownedPaths.length ||
    [...artifactTargets].some((path) => !ownedFilePaths.has(path)) ||
    [...ownedDirectoryPaths].some(
      (directory) =>
        ![...artifactTargets].some(
          (target) => parentPath(target) === directory,
        ),
    ) ||
    [...ownedDirectoryPaths].some((directory) =>
      ownedPaths.has(`${directory}/.agpb-owned`),
    ) ||
    [...ownedDirectoryPaths].some((directory) =>
      artifactTargets.has(`${directory}/.agpb-owned`),
    ) ||
    [...ownedDirectoryPaths].some((directory) =>
      [...ownedDirectoryPaths].some(
        (candidate) =>
          candidate !== directory &&
          candidate.toLowerCase().startsWith(`${directory.toLowerCase()}/`),
      ),
    )
  ) {
    throw new PackRuntimeError(
      "pack-surface-unsupported",
      `$pack.${manifest.id}`,
      "local runtime accepts offline hook-free files and explicit artifact-parent directories outside reserved control-plane state",
    );
  }
}

function pathDepth(path: string): number {
  return path.split("/").length;
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function directoryChangeSort(
  left: PackDirectoryChange,
  right: PackDirectoryChange,
): number {
  const depthOrder = pathDepth(left.path) - pathDepth(right.path);
  return depthOrder !== 0
    ? depthOrder
    : compareCanonicalText(left.path, right.path);
}

async function planDeclaredDirectoryChanges(
  request: NormalizedPrepareRequest,
  manifest: PackManifest,
  active: InstalledPackRecord | undefined,
): Promise<PlannedDirectoryChanges> {
  const changes: PackDirectoryChange[] = [];
  const markerChanges: PackChange[] = [];
  const generatedContents: GeneratedContentByPath[] = [];
  const preimages: SnapshotByPath[] = [];
  const nextDirectories: PackDirectoryChange["marker"][] = [];
  const createdPaths = new Set<string>();
  const conflicts: PackConflict[] = [];
  const directories = manifest.ownedPaths
    .filter(({ kind }) => kind === "directory")
    .map(({ path }) => path)
    .sort((left, right) => {
      const depthOrder = pathDepth(left) - pathDepth(right);
      return depthOrder !== 0
        ? depthOrder
        : compareCanonicalText(left, right);
    });
  const declared = new Set(directories);
  if (
    (active?.directories ?? []).some(
      ({ directoryPath }) => !declared.has(directoryPath),
    )
  ) {
    throw new PackRuntimeError(
      "pack-surface-unsupported",
      `$pack.${manifest.id}.ownedPaths`,
      "updates cannot relinquish an owned artifact parent in the initial directory lifecycle",
    );
  }
  const activeByPath = new Map(
    (active?.directories ?? []).map((marker) => [marker.directoryPath, marker]),
  );

  for (const directory of directories) {
    const installedMarker = activeByPath.get(directory);
    if (installedMarker !== undefined) {
      const snapshot = await snapshotInstalledArtifact(
        request.targetRoot,
        installedMarker,
        request.limits,
      );
      if (snapshot === undefined) {
        conflicts.push({
          code: "owned-target-missing",
          path: installedMarker.path,
          expectedDigest: installedMarker.digest,
        });
        continue;
      }
      if (snapshot.digest !== installedMarker.digest) {
        conflicts.push({
          code: "user-modified",
          path: installedMarker.path,
          expectedDigest: installedMarker.digest,
          actualDigest: snapshot.digest,
        });
        continue;
      }
      if (snapshot.bytes !== installedMarker.bytes) {
        throw new PackRuntimeError(
          "pack-state-corrupt",
          installedMarker.path,
          "installed directory marker byte count does not match its owned file",
        );
      }
      let expectedIdentity;
      try {
        expectedIdentity = await readProjectDirectoryIdentity({
          root: request.targetRoot,
          path: directory,
          maxDirectoryEntries: request.limits.maxDirectoryEntries,
        });
      } catch (error) {
        if (
          error instanceof CoreBoundaryError &&
          error.code === "project-path-not-found"
        ) {
          conflicts.push({ code: "owned-target-missing", path: directory });
          continue;
        }
        throw new PackRuntimeError(
          "pack-target-invalid",
          directory,
          "owned directory identity could not be read safely",
        );
      }
      const nextMarker = createPackDirectoryOwnershipMarker(
        manifest,
        directory,
      );
      if (
        nextMarker.descriptor.bytes > request.limits.maxArtifactBytes ||
        nextMarker.descriptor.bytes > request.limits.maxTotalBytes
      ) {
        throw new PackRuntimeError(
          "pack-artifact-budget-exceeded",
          nextMarker.descriptor.path,
          "directory ownership marker exceeds the pack byte limit",
        );
      }
      changes.push({
        kind: "retain",
        path: directory,
        marker: nextMarker.descriptor,
        expectedIdentity,
      });
      markerChanges.push(
        installedMarker.digest === nextMarker.descriptor.digest
          ? {
              kind: "unchanged",
              path: installedMarker.path,
              beforeDigest: installedMarker.digest,
              afterDigest: nextMarker.descriptor.digest,
              bytes: nextMarker.descriptor.bytes,
            }
          : {
              kind: "replace",
              path: installedMarker.path,
              beforeDigest: installedMarker.digest,
              afterDigest: nextMarker.descriptor.digest,
              bytes: nextMarker.descriptor.bytes,
            },
      );
      generatedContents.push({
        path: nextMarker.descriptor.path,
        content: new Uint8Array(nextMarker.content),
      });
      preimages.push({ path: snapshot.path, snapshot });
      nextDirectories.push(nextMarker.descriptor);
      continue;
    }
    let absent = false;
    try {
      const resolved = await resolveProjectPath(request.targetRoot, directory, {
        expectedType: "directory",
        existence: "optional",
        maxDirectoryEntries: request.limits.maxDirectoryEntries,
      });
      absent = resolved.kind === "absent";
    } catch (error) {
      if (
        error instanceof CoreBoundaryError &&
        error.code === "project-path-not-found" &&
        createdPaths.has(parentPath(directory))
      ) {
        absent = true;
      } else if (
        error instanceof CoreBoundaryError &&
        error.code === "project-path-not-found"
      ) {
        conflicts.push({
          code: "target-parent-missing",
          path: directory,
        });
        continue;
      } else {
        throw new PackRuntimeError(
          "pack-target-invalid",
          directory,
          "declared artifact parent is not a safe directory location",
        );
      }
    }
    if (!absent) continue;

    const marker = createPackDirectoryOwnershipMarker(manifest, directory);
    if (
      marker.descriptor.bytes > request.limits.maxArtifactBytes ||
      marker.descriptor.bytes > request.limits.maxTotalBytes
    ) {
      throw new PackRuntimeError(
        "pack-artifact-budget-exceeded",
        marker.descriptor.path,
        "directory ownership marker exceeds the pack byte limit",
      );
    }
    changes.push({
      kind: "create",
      path: directory,
      marker: marker.descriptor,
    });
    markerChanges.push({
      kind: "create",
      path: marker.descriptor.path,
      afterDigest: marker.descriptor.digest,
      bytes: marker.descriptor.bytes,
    });
    generatedContents.push({
      path: marker.descriptor.path,
      content: new Uint8Array(marker.content),
    });
    nextDirectories.push(marker.descriptor);
    createdPaths.add(directory);
  }

  return Object.freeze({
    changes: Object.freeze(changes.sort(directoryChangeSort)),
    markerChanges: Object.freeze(markerChanges.sort(changeSort)),
    generatedContents: Object.freeze(generatedContents),
    preimages: Object.freeze(preimages),
    nextDirectories: Object.freeze(nextDirectories),
    createdPaths,
    conflicts: Object.freeze(conflicts.sort(conflictSort)),
  });
}

async function readSourceArtifacts(
  request: NormalizedPrepareRequest,
  manifest: PackManifest,
): Promise<readonly SnapshotByPath[]> {
  if (request.operation === "remove" || request.sourceRoot === undefined) {
    return Object.freeze([]);
  }
  const snapshots: SnapshotByPath[] = [];
  let totalBytes = 0;
  for (const artifact of [...manifest.artifacts].sort((left, right) =>
    compareCanonicalText(left.target, right.target),
  )) {
    let snapshot: ProjectFileSnapshotResult;
    try {
      snapshot = await readProjectFileSnapshot({
        root: request.sourceRoot,
        path: artifact.source,
        maxBytes: request.limits.maxArtifactBytes,
        maxDirectoryEntries: request.limits.maxDirectoryEntries,
      });
    } catch (error) {
      if (
        error instanceof CoreBoundaryError &&
        error.code === "cas-budget-exceeded"
      ) {
        throw new PackRuntimeError(
          "pack-artifact-budget-exceeded",
          artifact.source,
          "source artifact exceeds its declared byte limit",
        );
      }
      throw new PackRuntimeError(
        "pack-target-invalid",
        artifact.source,
        "source artifact could not be resolved as one bounded regular file",
      );
    }
    totalBytes += snapshot.bytes;
    if (totalBytes > request.limits.maxTotalBytes) {
      throw new PackRuntimeError(
        "pack-artifact-budget-exceeded",
        "$pack.artifacts",
        "source artifacts exceed the total byte limit",
      );
    }
    if (snapshot.digest !== artifact.digest) {
      throw new PackRuntimeError(
        "pack-artifact-digest-mismatch",
        artifact.source,
        "source artifact digest differs from the validated manifest",
      );
    }
    snapshots.push(Object.freeze({ path: artifact.target, snapshot }));
  }
  return Object.freeze(snapshots);
}

async function snapshotInstalledArtifact(
  root: CanonicalProjectRoot,
  artifact: InstalledPackArtifact,
  limits: PackOperationLimits,
): Promise<ProjectFileSnapshotResult | undefined> {
  try {
    return await readProjectFileSnapshot({
      root,
      path: artifact.path,
      maxBytes: limits.maxArtifactBytes,
      maxDirectoryEntries: limits.maxDirectoryEntries,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    throw new PackRuntimeError(
      "pack-target-invalid",
      artifact.path,
      "installed target could not be resolved as one bounded regular file",
    );
  }
}

async function snapshotUnownedTarget(
  root: CanonicalProjectRoot,
  path: string,
  maxBytes: number,
  limits: PackOperationLimits,
  createdDirectories: ReadonlySet<string>,
): Promise<
  | ProjectFileSnapshotResult
  | "absent"
  | "parent-missing"
> {
  try {
    const resolved = await resolveProjectPath(root, path, {
      expectedType: "file",
      existence: "optional",
      maxDirectoryEntries: limits.maxDirectoryEntries,
    });
    if (resolved.kind === "absent") return "absent";
    return await readProjectFileSnapshot({
      root,
      path,
      maxBytes,
      maxDirectoryEntries: limits.maxDirectoryEntries,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return createdDirectories.has(parentPath(path))
        ? "absent"
        : "parent-missing";
    }
    throw new PackRuntimeError(
      "pack-target-invalid",
      path,
      "target path is not a safe regular-file location",
    );
  }
}

function conflictSort(left: PackConflict, right: PackConflict): number {
  const pathOrder = compareCanonicalText(left.path, right.path);
  return pathOrder !== 0
    ? pathOrder
    : compareCanonicalText(left.code, right.code);
}

function changeSort(left: PackChange, right: PackChange): number {
  return compareCanonicalText(left.path, right.path);
}

function dependencyConflicts(
  manifest: PackManifest,
  installed: LoadedInstalledPackState,
  registry: ValidatedRegistry,
): PackConflict[] {
  const conflicts: PackConflict[] = [];
  for (const dependency of manifest.dependencies) {
    if (dependency.optional) continue;
    const active = installed.state.packs.find(({ id }) => id === dependency.id);
    const selected = registry.packs.find(({ id }) => id === dependency.id);
    if (
      active === undefined ||
      selected === undefined ||
      active.version !== selected.version ||
      active.digest !== selected.digest ||
      compareSemanticVersions(active.version, dependency.minimum) < 0 ||
      compareSemanticVersions(active.version, dependency.maximumExclusive) >= 0
    ) {
      conflicts.push({
        code: "dependency-missing",
        path: `.ai-game-playbook/state/packs/${dependency.id}`,
        packId: dependency.id,
      });
    }
  }
  return conflicts;
}

async function inspectOwnedRecord(
  request: NormalizedPrepareRequest,
  installedPack: InstalledPackRecord,
): Promise<{
  readonly snapshots: ReadonlyMap<string, ProjectFileSnapshotResult>;
  readonly conflicts: readonly PackConflict[];
}> {
  const snapshots = new Map<string, ProjectFileSnapshotResult>();
  const conflicts: PackConflict[] = [];
  for (const artifact of installedPack.artifacts) {
    const snapshot = await snapshotInstalledArtifact(
      request.targetRoot,
      artifact,
      request.limits,
    );
    if (snapshot === undefined) {
      conflicts.push({
        code: "owned-target-missing",
        path: artifact.path,
        expectedDigest: artifact.digest,
      });
    } else if (snapshot.digest !== artifact.digest) {
      conflicts.push({
        code: "user-modified",
        path: artifact.path,
        expectedDigest: artifact.digest,
        actualDigest: snapshot.digest,
      });
    } else if (snapshot.bytes !== artifact.bytes) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        artifact.path,
        "installed artifact byte count does not match its owned file",
      );
    } else {
      snapshots.set(artifact.path, snapshot);
    }
  }
  return {
    snapshots,
    conflicts: Object.freeze(conflicts.sort(conflictSort)),
  };
}

function dependentConflicts(
  installed: LoadedInstalledPackState,
  packId: StableId,
): PackConflict[] {
  return installed.state.packs
    .filter((dependent) =>
      dependent.dependencies.some(({ id }) => id === packId),
    )
    .map((dependent) => ({
      code: "dependency-in-use" as const,
      path: `.ai-game-playbook/state/packs/${dependent.id}`,
      packId: dependent.id,
    }));
}

async function planRemovalChanges(
  request: NormalizedPrepareRequest,
  installed: LoadedInstalledPackState,
): Promise<{
  readonly directoryChanges: readonly PackDirectoryChange[];
  readonly changes: readonly PackChange[];
  readonly conflicts: readonly PackConflict[];
  readonly preimages: readonly SnapshotByPath[];
}> {
  const active = installed.state.packs.find(({ id }) => id === request.packId);
  if (active === undefined) {
    return {
      directoryChanges: Object.freeze([]),
      changes: Object.freeze([]),
      conflicts: Object.freeze([]),
      preimages: Object.freeze([]),
    };
  }
  const conflicts = dependentConflicts(installed, active.id);
  const inspected = await inspectOwnedRecord(request, active);
  conflicts.push(...inspected.conflicts);
  const preimages: SnapshotByPath[] = [...inspected.snapshots.values()].map((snapshot) => ({
    path: snapshot.path,
    snapshot,
  }));
  const markerChanges: PackChange[] = [];
  const directoryChanges: PackDirectoryChange[] = [];
  for (const marker of active.directories ?? []) {
    const snapshot = await snapshotInstalledArtifact(
      request.targetRoot,
      marker,
      request.limits,
    );
    if (snapshot === undefined) {
      conflicts.push({
        code: "owned-target-missing",
        path: marker.path,
        expectedDigest: marker.digest,
      });
      continue;
    }
    if (snapshot.digest !== marker.digest) {
      conflicts.push({
        code: "user-modified",
        path: marker.path,
        expectedDigest: marker.digest,
        actualDigest: snapshot.digest,
      });
      continue;
    }
    if (snapshot.bytes !== marker.bytes) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        marker.path,
        "installed directory marker byte count does not match its owned file",
      );
    }
    let expectedIdentity;
    try {
      expectedIdentity = await readProjectDirectoryIdentity({
        root: request.targetRoot,
        path: marker.directoryPath,
        maxDirectoryEntries: request.limits.maxDirectoryEntries,
      });
    } catch (error) {
      if (
        error instanceof CoreBoundaryError &&
        error.code === "project-path-not-found"
      ) {
        conflicts.push({
          code: "owned-target-missing",
          path: marker.directoryPath,
        });
        continue;
      }
      throw new PackRuntimeError(
        "pack-target-invalid",
        marker.directoryPath,
        "owned directory identity could not be read safely",
      );
    }
    const tombstoneDigest = digestCanonicalJson({
      domain: "ai-game-playbook.pack-directory-removal",
      version: "1",
      runId: request.runId,
      installedStateDigest: installed.state.stateDigest,
      directoryPath: marker.directoryPath,
    });
    const tombstoneName = `.agpb-cas-dir-${tombstoneDigest.slice(7, 39)}.deleted`;
    const parent = parentPath(marker.directoryPath);
    const tombstonePath =
      parent === "." ? tombstoneName : `${parent}/${tombstoneName}`;
    try {
      const tombstone = await resolveProjectPath(
        request.targetRoot,
        tombstonePath,
        {
          expectedType: "directory",
          existence: "optional",
          maxDirectoryEntries: request.limits.maxDirectoryEntries,
        },
      );
      if (tombstone.kind !== "absent") {
        conflicts.push({ code: "non-owned-target", path: tombstonePath });
        continue;
      }
    } catch {
      conflicts.push({ code: "non-owned-target", path: tombstonePath });
      continue;
    }
    preimages.push({ path: snapshot.path, snapshot });
    markerChanges.push({
      kind: "delete",
      path: marker.path,
      beforeDigest: marker.digest,
      bytes: marker.bytes,
    });
    directoryChanges.push({
      kind: "delete",
      path: marker.directoryPath,
      marker,
      expectedIdentity,
      tombstonePath,
    });
  }
  if (conflicts.length > 0) {
    return {
      directoryChanges: Object.freeze([]),
      changes: Object.freeze([]),
      conflicts: Object.freeze(conflicts.sort(conflictSort)),
      preimages: Object.freeze(preimages),
    };
  }
  return {
    directoryChanges: Object.freeze(
      directoryChanges.sort(directoryChangeSort),
    ),
    changes: Object.freeze(
      [
        ...markerChanges,
        ...active.artifacts
          .filter(({ path }) => inspected.snapshots.has(path))
          .map((artifact) => ({
            kind: "delete" as const,
            path: artifact.path,
            beforeDigest: artifact.digest,
            bytes: artifact.bytes,
          })),
      ].sort(changeSort),
    ),
    conflicts: Object.freeze([]),
    preimages: Object.freeze(preimages),
  };
}

async function planInstallChanges(
  request: NormalizedPrepareRequest,
  manifest: PackManifest,
  installed: LoadedInstalledPackState,
  sourceArtifacts: readonly SnapshotByPath[],
  createdDirectories: ReadonlySet<string>,
): Promise<{
  readonly changes: readonly PackChange[];
  readonly conflicts: readonly PackConflict[];
  readonly preimages: readonly SnapshotByPath[];
}> {
  if (request.operation === "remove") {
    throw new PackRuntimeError(
      "invalid-pack-request",
      "$request.operation",
      "remove must use installed-state removal planning",
    );
  }
  const active = installed.state.packs.find(({ id }) => id === manifest.id);
  const conflicts: PackConflict[] = [];
  const changes: PackChange[] = [];
  const preimages: SnapshotByPath[] = [];

  if (
    request.operation === "update" &&
    active !== undefined &&
    (active.version !== manifest.version || active.digest !== manifest.digest)
  ) {
    conflicts.push(...dependentConflicts(installed, active.id));
  }

  if (request.operation === "add" && active !== undefined) {
    const inspected = await inspectOwnedRecord(request, active);
    conflicts.push(...inspected.conflicts);
    if (active.version === manifest.version && active.digest === manifest.digest) {
      for (const artifact of active.artifacts) {
        const snapshot = inspected.snapshots.get(artifact.path);
        if (snapshot !== undefined) {
          changes.push({
            kind: "unchanged",
            path: artifact.path,
            beforeDigest: artifact.digest,
            afterDigest: artifact.digest,
            bytes: artifact.bytes,
          });
        }
      }
    } else {
      conflicts.push({
        code:
          active.version === manifest.version
            ? "integrity-conflict"
            : "already-installed",
        path: `.ai-game-playbook/state/packs/${manifest.id}`,
        packId: manifest.id,
      });
    }
  } else if (request.operation === "update" && active === undefined) {
    conflicts.push({
      code: "not-installed",
      path: `.ai-game-playbook/state/packs/${manifest.id}`,
      packId: manifest.id,
    });
  } else if (active !== undefined) {
    const inspected = await inspectOwnedRecord(request, active);
    conflicts.push(...inspected.conflicts);
    for (const snapshot of inspected.snapshots.values()) {
      preimages.push({ path: snapshot.path, snapshot });
    }
    if (
      request.operation === "update" &&
      active.version === manifest.version &&
      active.digest !== manifest.digest
    ) {
      conflicts.push({
        code: "integrity-conflict",
        path: `.ai-game-playbook/state/packs/${manifest.id}`,
        packId: manifest.id,
      });
    } else if (
      request.operation === "update" &&
      compareSemanticVersions(manifest.version, active.version) < 0
    ) {
      conflicts.push({
        code: "downgrade-refused",
        path: `.ai-game-playbook/state/packs/${manifest.id}`,
        packId: manifest.id,
      });
    } else if (
      request.operation === "update" &&
      active.version === manifest.version &&
      active.digest === manifest.digest
    ) {
      for (const artifact of active.artifacts) {
        if (inspected.snapshots.has(artifact.path)) {
          changes.push({
            kind: "unchanged",
            path: artifact.path,
            beforeDigest: artifact.digest,
            afterDigest: artifact.digest,
            bytes: artifact.bytes,
          });
        }
      }
    } else {
      const activeByPath = new Map(active.artifacts.map((entry) => [entry.path, entry]));
      const sourceByPath = new Map(sourceArtifacts.map((entry) => [entry.path, entry.snapshot]));
      for (const artifact of manifest.artifacts) {
        const source = sourceByPath.get(artifact.target);
        if (source === undefined) continue;
        const previous = activeByPath.get(artifact.target);
        if (previous !== undefined) {
          changes.push(
            previous.digest === source.digest
              ? {
                  kind: "unchanged",
                  path: artifact.target,
                  beforeDigest: previous.digest,
                  afterDigest: source.digest,
                  bytes: source.bytes,
                }
              : {
                  kind: "replace",
                  path: artifact.target,
                  beforeDigest: previous.digest,
                  afterDigest: source.digest,
                  bytes: source.bytes,
                },
          );
          continue;
        }
        const target = await snapshotUnownedTarget(
          request.targetRoot,
          artifact.target,
          request.limits.maxArtifactBytes,
          request.limits,
          createdDirectories,
        );
        if (target === "absent") {
          changes.push({
            kind: "create",
            path: artifact.target,
            afterDigest: source.digest,
            bytes: source.bytes,
          });
        } else if (target === "parent-missing") {
          conflicts.push({ code: "target-parent-missing", path: artifact.target });
        } else {
          conflicts.push({
            code: "non-owned-target",
            path: artifact.target,
            actualDigest: target.digest,
          });
        }
      }
      const nextPaths = new Set(manifest.artifacts.map(({ target }) => target));
      for (const artifact of active.artifacts) {
        if (!nextPaths.has(artifact.path) && inspected.snapshots.has(artifact.path)) {
          changes.push({
            kind: "delete",
            path: artifact.path,
            beforeDigest: artifact.digest,
            bytes: artifact.bytes,
          });
        }
      }
    }
  } else {
    const sourceByPath = new Map(sourceArtifacts.map((entry) => [entry.path, entry.snapshot]));
    for (const artifact of manifest.artifacts) {
      const source = sourceByPath.get(artifact.target);
      if (source === undefined) continue;
      const target = await snapshotUnownedTarget(
        request.targetRoot,
        artifact.target,
        request.limits.maxArtifactBytes,
        request.limits,
        createdDirectories,
      );
      if (target === "absent") {
        changes.push({
          kind: "create",
          path: artifact.target,
          afterDigest: source.digest,
          bytes: source.bytes,
        });
      } else if (target === "parent-missing") {
        conflicts.push({ code: "target-parent-missing", path: artifact.target });
      } else {
        conflicts.push({
          code: "non-owned-target",
          path: artifact.target,
          actualDigest: target.digest,
        });
      }
    }
  }

  conflicts.push(...dependencyConflicts(manifest, installed, request.registry));
  if (conflicts.length > 0) {
    return {
      changes: Object.freeze([]),
      conflicts: Object.freeze(conflicts.sort(conflictSort)),
      preimages: Object.freeze(preimages),
    };
  }
  return {
    changes: Object.freeze(changes.sort(changeSort)),
    conflicts: Object.freeze([]),
    preimages: Object.freeze(preimages),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export async function preparePackOperation(
  value: PreparePackOperationRequest,
): Promise<PreparedPackOperation> {
  const request = normalizeRequest(value);
  await assertProjectRootIdentity(request.targetRoot);
  if (request.sourceRoot !== undefined) {
    await assertProjectRootIdentity(request.sourceRoot);
  }
  const activeTransaction = await loadActivePackTransactionRecord({
    root: request.targetRoot,
    project: Object.freeze({
      id: request.project.id,
      identityDigest: request.project.identityDigest,
    }),
    maxDirectoryEntries: request.limits.maxDirectoryEntries,
  });
  if (activeTransaction !== undefined) {
    throw new PackRuntimeError(
      "pack-transaction-conflict",
      ".ai-game-playbook/state/packs/active.json",
      "an unresolved pack transaction must be reconciled before planning another operation",
    );
  }
  const installed = await loadInstalledPackState(
    request.targetRoot,
    Object.freeze({
      id: request.project.id,
      identityDigest: request.project.identityDigest,
    }),
    request.limits.maxDirectoryEntries,
  );
  const manifest = request.registry.packs.find(({ id }) => id === request.packId);
  const active = installed.state.packs.find(({ id }) => id === request.packId);
  if (manifest === undefined && active === undefined) {
    throw new PackRuntimeError(
      "pack-not-found",
      "$request.packId",
      "pack is neither installed nor present in the validated registry",
    );
  }
  if (request.operation !== "remove" && manifest === undefined) {
    throw new PackRuntimeError(
      "pack-not-found",
      "$request.packId",
      "add and update require a pack from the validated registry",
    );
  }
  if (request.operation !== "remove") {
    assertSupportedManifest(manifest as PackManifest);
  }
  const sourceArtifacts =
    request.operation === "remove"
      ? Object.freeze([])
      : await readSourceArtifacts(request, manifest as PackManifest);
  const directoryPlan: PlannedDirectoryChanges =
    request.operation === "remove"
      ? Object.freeze({
          changes: Object.freeze([]),
          markerChanges: Object.freeze([]),
          generatedContents: Object.freeze([]),
          preimages: Object.freeze([]),
          nextDirectories: Object.freeze([]),
          createdPaths: new Set<string>(),
          conflicts: Object.freeze([]),
        })
      : await planDeclaredDirectoryChanges(
          request,
          manifest as PackManifest,
          active,
        );
  const sourceAndMarkerBytes =
    sourceArtifacts.reduce((total, entry) => total + entry.snapshot.bytes, 0) +
    directoryPlan.generatedContents.reduce(
      (total, entry) => total + entry.content.byteLength,
      0,
    );
  if (sourceAndMarkerBytes > request.limits.maxTotalBytes) {
    throw new PackRuntimeError(
      "pack-artifact-budget-exceeded",
      "$pack.artifacts",
      "source artifacts and directory ownership markers exceed the total byte limit",
    );
  }
  const artifactPlan =
    directoryPlan.conflicts.length > 0
      ? {
          directoryChanges: Object.freeze([]) as readonly PackDirectoryChange[],
          changes: Object.freeze([]) as readonly PackChange[],
          conflicts: Object.freeze([]) as readonly PackConflict[],
          preimages: Object.freeze([]) as readonly SnapshotByPath[],
        }
      : request.operation === "remove"
        ? await planRemovalChanges(request, installed)
        : {
            ...(await planInstallChanges(
              request,
              manifest as PackManifest,
              installed,
              sourceArtifacts,
              directoryPlan.createdPaths,
            )),
            directoryChanges: Object.freeze(
              [],
            ) as readonly PackDirectoryChange[],
          };
  const combinedConflicts = Object.freeze(
    [...directoryPlan.conflicts, ...artifactPlan.conflicts].sort(conflictSort),
  );
  const planned = {
    directoryChanges:
      combinedConflicts.length === 0
        ? request.operation === "remove"
          ? artifactPlan.directoryChanges
          : directoryPlan.changes
        : Object.freeze([]),
    changes:
      combinedConflicts.length === 0
        ? Object.freeze(
            [...directoryPlan.markerChanges, ...artifactPlan.changes].sort(
              changeSort,
            ),
          )
        : Object.freeze([]),
    conflicts: combinedConflicts,
    preimages: Object.freeze([
      ...directoryPlan.preimages,
      ...artifactPlan.preimages,
    ]),
  };
  const rollbackPreimageBytes = planned.preimages.reduce(
    (total, entry) => total + entry.snapshot.bytes,
    0,
  );
  if (
    !Number.isSafeInteger(rollbackPreimageBytes) ||
    rollbackPreimageBytes > request.limits.maxTotalBytes
  ) {
    throw new PackRuntimeError(
      "pack-artifact-budget-exceeded",
      "$pack.rollbackPreimages",
      "rollback preimages exceed the total byte limit",
    );
  }
  const selectedPack =
    request.operation === "remove" && active !== undefined
      ? active
      : (manifest as PackManifest);
  const mutatingChanges = planned.changes.filter(
    ({ kind }) => kind !== "unchanged",
  );
  const requiresInstalledStateMutation =
    request.operation === "remove"
      ? active !== undefined
      : request.operation === "add"
        ? active === undefined
        : active !== undefined &&
          manifest !== undefined &&
          (active.version !== manifest.version || active.digest !== manifest.digest);
  const disposition: PreparedPackOperation["disposition"] =
    planned.conflicts.length > 0
      ? "conflicted"
      : mutatingChanges.length === 0 && !requiresInstalledStateMutation
        ? "no-op"
        : "ready";
  const body = {
    schemaVersion: "1.0.0" as const,
    operation: request.operation,
    disposition,
    runId: request.runId,
    project: {
      id: request.project.id,
      identityDigest: request.project.identityDigest,
      rootIdentityDigest: request.targetRoot.identityDigest,
    },
    ...(request.workflow === undefined ? {} : { workflow: request.workflow }),
    ...(request.sourceRoot === undefined
      ? {}
      : { sourceRootIdentityDigest: request.sourceRoot.identityDigest }),
    registryDigest: request.registry.digest,
    pack: {
      id: selectedPack.id,
      version: selectedPack.version,
      digest: selectedPack.digest,
    },
    installedState: {
      revision: installed.state.revision,
      digest: installed.state.stateDigest,
      ...(installed.fileDigest === undefined
        ? {}
        : { fileDigest: installed.fileDigest }),
    },
    limits: request.limits,
    directoryChanges: planned.directoryChanges,
    changes: planned.changes,
    conflicts: planned.conflicts,
  };
  const plan = deepFreeze({
    ...body,
    planDigest: digestCanonicalJson({
      domain: "ai-game-playbook.prepared-pack-operation",
      version: "1",
      plan: body,
    }),
  });
  return registerPreparedPackOperation(plan, {
    registry: request.registry,
    targetRoot: request.targetRoot,
    ...(request.sourceRoot === undefined ? {} : { sourceRoot: request.sourceRoot }),
    ...(manifest === undefined ? {} : { manifest }),
    installed,
    sourceArtifacts: Object.freeze(
      [
        ...sourceArtifacts.map(({ path, snapshot }) =>
          Object.freeze({
            target: path,
            content: new Uint8Array(snapshot.content),
          }),
        ),
        ...directoryPlan.generatedContents.map(({ path, content }) =>
          Object.freeze({ target: path, content: new Uint8Array(content) }),
        ),
      ],
    ),
    preimages: Object.freeze(
      planned.preimages.map(({ path, snapshot }) =>
        Object.freeze({ target: path, content: new Uint8Array(snapshot.content) }),
      ),
    ),
    nextDirectories: Object.freeze(directoryPlan.nextDirectories),
  });
}
