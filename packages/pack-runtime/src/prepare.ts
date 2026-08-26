import {
  compareCanonicalText,
  compareSemanticVersions,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  type PackManifest,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertProjectRootIdentity,
  CoreBoundaryError,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ProjectFileSnapshotResult,
} from "@ai-game-playbook/core";
import {
  assertValidatedRegistry,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { PackRuntimeError } from "./errors.js";
import { registerPreparedPackOperation } from "./prepared-plan.js";
import {
  loadInstalledPackState,
  type InstalledPackArtifact,
  type InstalledPackRecord,
  type LoadedInstalledPackState,
} from "./state.js";
import type {
  PackChange,
  PackConflict,
  PackOperation,
  PackOperationLimits,
  PreparePackOperationRequest,
  PreparedPackOperation,
} from "./types.js";

const PACK_RUNTIME_MAX_ARTIFACTS = 64;
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
  readonly runId: string;
  readonly packId: StableId;
  readonly limits: PackOperationLimits;
}

interface SnapshotByPath {
  readonly path: string;
  readonly snapshot: ProjectFileSnapshotResult;
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
  if (typeof value !== "object" || value === null) {
    invalid("$request", "expected a plain request object");
  }
  const operation = value.operation;
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
  if (!exactKeys(value, requestKeys)) {
    invalid("$request", "pack request contains undeclared or missing fields");
  }
  try {
    assertValidatedRegistry(value.registry);
  } catch {
    throw new PackRuntimeError(
      "pack-registry-untrusted",
      "$request.registry",
      "registry must be validated in this runtime process",
    );
  }
  if (
    typeof value.project !== "object" ||
    value.project === null ||
    !exactKeys(value.project, ["id", "identityDigest"]) ||
    !isStableId(value.project.id) ||
    !isSha256Digest(value.project.identityDigest)
  ) {
    invalid("$request.project", "project identity is invalid");
  }
  if (!UUID_PATTERN.test(value.runId)) {
    invalid("$request.runId", "run identity must be a canonical UUID");
  }
  if (!isStableId(value.packId)) {
    invalid("$request.packId", "pack identity must be a stable ID");
  }
  if (
    typeof value.limits !== "object" ||
    value.limits === null ||
    !exactKeys(value.limits, [
      "maxArtifactBytes",
      "maxTotalBytes",
      "maxDirectoryEntries",
    ])
  ) {
    invalid("$request.limits", "pack limits are invalid");
  }
  const limits = Object.freeze({
    maxArtifactBytes: boundedInteger(
      value.limits.maxArtifactBytes,
      1,
      PACK_RUNTIME_MAX_ARTIFACT_BYTES,
      "$request.limits.maxArtifactBytes",
    ),
    maxTotalBytes: boundedInteger(
      value.limits.maxTotalBytes,
      1,
      PACK_RUNTIME_MAX_TOTAL_BYTES,
      "$request.limits.maxTotalBytes",
    ),
    maxDirectoryEntries: boundedInteger(
      value.limits.maxDirectoryEntries,
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
  if (operation !== "remove" && value.sourceRoot === undefined) {
    invalid("$request.sourceRoot", "add and update require a local source root");
  }
  return {
    operation,
    registry: value.registry,
    targetRoot: value.targetRoot as CanonicalProjectRoot,
    ...(operation === "remove"
      ? {}
      : { sourceRoot: value.sourceRoot as CanonicalProjectRoot }),
    project: Object.freeze({
      id: value.project.id,
      identityDigest: value.project.identityDigest,
    }),
    runId: value.runId,
    packId: value.packId,
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
  if (
    manifest.lifecycle === "deprecated" ||
    manifest.lifecycle === "internal" ||
    !manifest.compatibility.operatingSystems.includes(operatingSystem()) ||
    manifest.network.required ||
    manifest.network.destinations.length > 0 ||
    Object.keys(manifest.lifecycleHooks).length > 0 ||
    manifest.artifacts.length > PACK_RUNTIME_MAX_ARTIFACTS ||
    manifest.artifacts.some(({ mode }) => mode !== "file") ||
    manifest.artifacts.some(({ target }) => {
      const foldedTarget = target.toLowerCase();
      return PACK_RUNTIME_RESERVED_TARGET_ROOTS.some(
        (root) =>
          foldedTarget === root || foldedTarget.startsWith(`${root}/`),
      );
    }) ||
    manifest.ownedPaths.some(({ kind }) => kind !== "file") ||
    artifactTargets.size !== manifest.artifacts.length ||
    ownedFilePaths.size !== manifest.ownedPaths.length ||
    artifactTargets.size !== ownedFilePaths.size ||
    [...artifactTargets].some((path) => !ownedFilePaths.has(path))
  ) {
    throw new PackRuntimeError(
      "pack-surface-unsupported",
      `$pack.${manifest.id}`,
      "initial local runtime accepts only offline, hook-free regular files outside reserved control-plane state",
    );
  }
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
      return "parent-missing";
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
  readonly changes: readonly PackChange[];
  readonly conflicts: readonly PackConflict[];
  readonly preimages: readonly SnapshotByPath[];
}> {
  const active = installed.state.packs.find(({ id }) => id === request.packId);
  if (active === undefined) {
    return {
      changes: Object.freeze([]),
      conflicts: Object.freeze([]),
      preimages: Object.freeze([]),
    };
  }
  const conflicts = dependentConflicts(installed, active.id);
  const inspected = await inspectOwnedRecord(request, active);
  conflicts.push(...inspected.conflicts);
  const preimages = [...inspected.snapshots.values()].map((snapshot) => ({
    path: snapshot.path,
    snapshot,
  }));
  if (conflicts.length > 0) {
    return {
      changes: Object.freeze([]),
      conflicts: Object.freeze(conflicts.sort(conflictSort)),
      preimages: Object.freeze(preimages),
    };
  }
  return {
    changes: Object.freeze(
      active.artifacts
        .filter(({ path }) => inspected.snapshots.has(path))
        .map((artifact) => ({
          kind: "delete" as const,
          path: artifact.path,
          beforeDigest: artifact.digest,
          bytes: artifact.bytes,
        }))
        .sort(changeSort),
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
  const installed = await loadInstalledPackState(
    request.targetRoot,
    request.project,
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
  const planned =
    request.operation === "remove"
      ? await planRemovalChanges(request, installed)
      : await planInstallChanges(
          request,
          manifest as PackManifest,
          installed,
          sourceArtifacts,
        );
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
      sourceArtifacts.map(({ path, snapshot }) =>
        Object.freeze({ target: path, content: new Uint8Array(snapshot.content) }),
      ),
    ),
    preimages: Object.freeze(
      planned.preimages.map(({ path, snapshot }) =>
        Object.freeze({ target: path, content: new Uint8Array(snapshot.content) }),
      ),
    ),
  });
}
