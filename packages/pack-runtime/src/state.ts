import {
  canonicalizeJson,
  compareCanonicalText,
  compareSemanticVersions,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  isPortableProjectPath,
  parseSemanticVersion,
  sha256Digest,
  type PackManifest,
  type SemanticVersion,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  readProjectFileSnapshot,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";

import { PackRuntimeError } from "./errors.js";
import { createPackDirectoryOwnershipMarker } from "./directory-ownership.js";
import type { PreparedArtifactContent } from "./prepared-plan.js";
import type {
  PackDirectoryOwnershipMarker,
  PackOperation,
} from "./types.js";

export const PACK_INSTALLED_STATE_PATH: string =
  ".ai-game-playbook/state/packs/installed.json";
export const PACK_INSTALLED_STATE_MAX_BYTES: number = 1024 * 1024;
const MAX_INSTALLED_PACKS = 1024;
const MAX_ARTIFACTS_PER_PACK = 64;
const MAX_DIRECTORIES_PER_PACK = 64;

export interface InstalledPackArtifact {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

export interface InstalledPackDependency {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly digest: Sha256Digest;
}

export interface InstalledPackRecord {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly digest: Sha256Digest;
  readonly dependencies: readonly InstalledPackDependency[];
  readonly artifacts: readonly InstalledPackArtifact[];
  readonly directories?: readonly PackDirectoryOwnershipMarker[];
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface InstalledPackState {
  readonly schemaVersion: "1.0.0" | "1.1.0";
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
  };
  readonly revision: number;
  readonly packs: readonly InstalledPackRecord[];
  readonly stateDigest: Sha256Digest;
}

export interface LoadedInstalledPackState {
  readonly state: InstalledPackState;
  readonly fileDigest?: Sha256Digest;
}

export interface CreateNextInstalledPackStateRequest {
  readonly operation: PackOperation;
  readonly pack: {
    readonly id: StableId;
    readonly version: SemanticVersion;
    readonly digest: Sha256Digest;
  };
  readonly manifest?: PackManifest;
  readonly installed: InstalledPackState;
  readonly sourceArtifacts: readonly PreparedArtifactContent[];
  readonly directories?: readonly PackDirectoryOwnershipMarker[];
  readonly timestamp: string;
}

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: MutableRecord,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const expected = [...keys].sort(compareCanonicalText);
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function parseArtifact(value: unknown): InstalledPackArtifact {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["path", "digest", "bytes"]) ||
    !isPortableProjectPath(value["path"]) ||
    !isSha256Digest(value["digest"]) ||
    !Number.isSafeInteger(value["bytes"]) ||
    (value["bytes"] as number) < 0 ||
    (value["bytes"] as number) > 67_108_864
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].artifacts[]",
      "installed artifact state is malformed",
    );
  }
  return Object.freeze({
    path: value["path"],
    digest: value["digest"],
    bytes: value["bytes"],
  }) as InstalledPackArtifact;
}

function parseDependency(value: unknown): InstalledPackDependency {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["id", "version", "digest"]) ||
    !isStableId(value["id"]) ||
    !isSha256Digest(value["digest"])
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].dependencies[]",
      "installed dependency state is malformed",
    );
  }
  let version: SemanticVersion;
  try {
    parseSemanticVersion(value["version"]);
    version = value["version"] as SemanticVersion;
  } catch {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].dependencies[].version",
      "installed dependency version is invalid",
    );
  }
  return Object.freeze({
    id: value["id"],
    version,
    digest: value["digest"],
  });
}

function parseDirectory(
  value: unknown,
  pack: Pick<PackManifest, "id" | "digest">,
): PackDirectoryOwnershipMarker {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "directoryPath",
      "path",
      "digest",
      "bytes",
      "ownershipDigest",
      "ownerPackDigest",
    ]) ||
    !isPortableProjectPath(value["directoryPath"]) ||
    !isPortableProjectPath(value["path"]) ||
    !isSha256Digest(value["digest"]) ||
    !Number.isSafeInteger(value["bytes"]) ||
    (value["bytes"] as number) < 1 ||
    (value["bytes"] as number) > 67_108_864 ||
    !isSha256Digest(value["ownershipDigest"]) ||
    !isSha256Digest(value["ownerPackDigest"]) ||
    value["ownerPackDigest"] !== pack.digest
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].directories[]",
      "installed directory ownership state is malformed",
    );
  }
  const descriptor = createPackDirectoryOwnershipMarker(
    pack,
    value["directoryPath"],
  ).descriptor;
  if (canonicalizeJson(descriptor) !== canonicalizeJson(value)) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].directories[]",
      "installed directory ownership marker is not self-consistent",
    );
  }
  return descriptor;
}

function parsePack(
  value: unknown,
  schemaVersion: InstalledPackState["schemaVersion"],
): InstalledPackRecord {
  const expectedKeys = [
    "id",
    "version",
    "digest",
    "dependencies",
    "artifacts",
    ...(schemaVersion === "1.1.0" ? ["directories"] : []),
    "installedAt",
    "updatedAt",
  ];
  if (
    !isRecord(value) ||
    !exactKeys(value, expectedKeys) ||
    !isStableId(value["id"]) ||
    !isSha256Digest(value["digest"]) ||
    !Array.isArray(value["dependencies"]) ||
    value["dependencies"].length > MAX_INSTALLED_PACKS ||
    !Array.isArray(value["artifacts"]) ||
    value["artifacts"].length > MAX_ARTIFACTS_PER_PACK ||
    (schemaVersion === "1.1.0" &&
      (!Array.isArray(value["directories"]) ||
        value["directories"].length > MAX_DIRECTORIES_PER_PACK)) ||
    !canonicalTimestamp(value["installedAt"]) ||
    !canonicalTimestamp(value["updatedAt"])
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[]",
      "installed pack state is malformed",
    );
  }
  let version: SemanticVersion;
  try {
    parseSemanticVersion(value["version"]);
    version = value["version"] as SemanticVersion;
  } catch {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].version",
      "installed pack version is invalid",
    );
  }
  const dependencies = value["dependencies"].map(parseDependency);
  const artifacts = value["artifacts"].map(parseArtifact);
  const directories =
    schemaVersion === "1.1.0"
      ? (value["directories"] as unknown[]).map((entry) =>
          parseDirectory(entry, {
            id: value["id"] as StableId,
            digest: value["digest"] as Sha256Digest,
          }),
        )
      : undefined;
  if (
    dependencies.some(
      (entry, index) =>
        index > 0 &&
        compareCanonicalText(dependencies[index - 1]?.id ?? "", entry.id) >= 0,
    ) ||
    artifacts.some(
      (entry, index) =>
        index > 0 &&
        compareCanonicalText(artifacts[index - 1]?.path ?? "", entry.path) >= 0,
    ) ||
    directories?.some(
      (entry, index) =>
        index > 0 &&
        compareCanonicalText(
          directories[index - 1]?.directoryPath ?? "",
          entry.directoryPath,
        ) >= 0,
    ) ||
    Date.parse(value["installedAt"]) > Date.parse(value["updatedAt"])
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[]",
      "installed pack arrays or timestamps are noncanonical",
    );
  }
  return Object.freeze({
    id: value["id"],
    version,
    digest: value["digest"],
    dependencies: Object.freeze(dependencies),
    artifacts: Object.freeze(artifacts),
    ...(directories === undefined
      ? {}
      : { directories: Object.freeze(directories) }),
    installedAt: value["installedAt"],
    updatedAt: value["updatedAt"],
  });
}

export type InstalledPackStateDigestInput = Omit<
  InstalledPackState,
  "stateDigest"
> &
  Partial<Pick<InstalledPackState, "stateDigest">>;

export function computeInstalledPackStateDigest(
  state: InstalledPackStateDigestInput,
): Sha256Digest {
  const { stateDigest: _stateDigest, ...body } = state;
  return digestCanonicalJson({
    domain: "ai-game-playbook.installed-pack-state",
    version: "1",
    state: body,
  });
}

export function createEmptyInstalledPackState(project: {
  readonly id: StableId;
  readonly identityDigest: Sha256Digest;
}): InstalledPackState {
  const body = {
    schemaVersion: "1.1.0" as const,
    project: Object.freeze({ ...project }),
    revision: 0,
    packs: Object.freeze([]) as readonly InstalledPackRecord[],
  };
  return Object.freeze({
    ...body,
    stateDigest: computeInstalledPackStateDigest(body),
  });
}

function canonicalStateTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function dependencyRecords(
  manifest: PackManifest,
  installed: InstalledPackState,
): readonly InstalledPackDependency[] {
  const records: InstalledPackDependency[] = [];
  for (const dependency of manifest.dependencies) {
    const active = installed.packs.find(({ id }) => id === dependency.id);
    if (active === undefined) {
      if (dependency.optional) continue;
      throw new PackRuntimeError(
        "pack-state-corrupt",
        `$state.dependencies.${dependency.id}`,
        "required dependency disappeared after pack preflight",
      );
    }
    if (
      compareSemanticVersions(active.version, dependency.minimum) < 0 ||
      compareSemanticVersions(active.version, dependency.maximumExclusive) >= 0
    ) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        `$state.dependencies.${dependency.id}`,
        "installed dependency moved outside the prepared version interval",
      );
    }
    records.push(
      Object.freeze({
        id: active.id,
        version: active.version,
        digest: active.digest,
      }),
    );
  }
  return Object.freeze(
    records.sort((left, right) => compareCanonicalText(left.id, right.id)),
  );
}

function artifactRecords(
  manifest: PackManifest,
  sourceArtifacts: readonly PreparedArtifactContent[],
): readonly InstalledPackArtifact[] {
  const sourceByTarget = new Map(
    sourceArtifacts.map((artifact) => [artifact.target, artifact.content]),
  );
  const records = manifest.artifacts.map((artifact) => {
    const content = sourceByTarget.get(artifact.target);
    if (
      content === undefined ||
      sha256Digest(content) !== artifact.digest
    ) {
      throw new PackRuntimeError(
        "pack-artifact-digest-mismatch",
        artifact.target,
        "prepared artifact content no longer matches the manifest",
      );
    }
    return Object.freeze({
      path: artifact.target,
      digest: artifact.digest,
      bytes: content.byteLength,
    });
  });
  return Object.freeze(
    records.sort((left, right) => compareCanonicalText(left.path, right.path)),
  );
}

function directoryRecords(
  pack: Pick<PackManifest, "id" | "digest">,
  directories: readonly PackDirectoryOwnershipMarker[],
): readonly PackDirectoryOwnershipMarker[] {
  if (directories.length > MAX_DIRECTORIES_PER_PACK) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].directories",
      "installed directory ownership exceeds the runtime limit",
    );
  }
  const records = directories.map((directory) =>
    parseDirectory(structuredClone(directory), pack),
  );
  records.sort((left, right) =>
    compareCanonicalText(left.directoryPath, right.directoryPath),
  );
  if (
    records.some(
      (entry, index) =>
        index > 0 &&
        records[index - 1]?.directoryPath === entry.directoryPath,
    )
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs[].directories",
      "installed directory ownership must be unique",
    );
  }
  return Object.freeze(records);
}

export function createNextInstalledPackState(
  request: CreateNextInstalledPackStateRequest,
): InstalledPackState {
  if (!canonicalStateTimestamp(request.timestamp)) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.timestamp",
      "pack state transition timestamp must be canonical",
    );
  }
  if (
    !Number.isSafeInteger(request.installed.revision) ||
    request.installed.revision < 0 ||
    request.installed.revision >= Number.MAX_SAFE_INTEGER
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.revision",
      "pack state revision cannot advance safely",
    );
  }
  const active = request.installed.packs.find(
    ({ id }) => id === request.pack.id,
  );
  let packs: readonly InstalledPackRecord[];
  if (request.operation === "remove") {
    if (active === undefined) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        `$state.packs.${request.pack.id}`,
        "removed pack disappeared after pack preflight",
      );
    }
    packs = request.installed.packs.filter(
      ({ id }) => id !== request.pack.id,
    );
  } else {
    if (request.manifest === undefined) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        `$state.packs.${request.pack.id}`,
        "add and update state transitions require the prepared manifest",
      );
    }
    const manifest = request.manifest;
    const installedAt = active?.installedAt ?? request.timestamp;
    const updatedMilliseconds = Math.max(
      Date.parse(request.timestamp),
      active === undefined ? 0 : Date.parse(active.updatedAt) + 1,
    );
    const record: InstalledPackRecord = Object.freeze({
      id: manifest.id,
      version: manifest.version,
      digest: manifest.digest,
      dependencies: dependencyRecords(manifest, request.installed),
      artifacts: artifactRecords(manifest, request.sourceArtifacts),
      directories: directoryRecords(
        manifest,
        request.directories ?? Object.freeze([]),
      ),
      installedAt,
      updatedAt: new Date(updatedMilliseconds).toISOString(),
    });
    packs = [
      ...request.installed.packs.filter(({ id }) => id !== manifest.id),
      record,
    ];
  }
  const sortedPacks = Object.freeze(
    packs
      .map((pack) =>
        pack.directories === undefined
          ? Object.freeze({
              ...pack,
              directories: Object.freeze(
                [],
              ) as readonly PackDirectoryOwnershipMarker[],
            })
          : pack,
      )
      .sort((left, right) => compareCanonicalText(left.id, right.id)),
  );
  const body = {
    schemaVersion: "1.1.0" as const,
    project: Object.freeze({ ...request.installed.project }),
    revision: request.installed.revision + 1,
    packs: sortedPacks,
  };
  return Object.freeze({
    ...body,
    stateDigest: computeInstalledPackStateDigest(body),
  });
}

export function serializeInstalledPackState(
  state: InstalledPackState,
): Uint8Array {
  return Buffer.from(`${canonicalizeJson(state)}\n`, "utf8");
}

function parseState(
  value: unknown,
  project: { readonly id: StableId; readonly identityDigest: Sha256Digest },
): InstalledPackState {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "project",
      "revision",
      "packs",
      "stateDigest",
    ]) ||
    (value["schemaVersion"] !== "1.0.0" &&
      value["schemaVersion"] !== "1.1.0") ||
    !isRecord(value["project"]) ||
    !exactKeys(value["project"], ["id", "identityDigest"]) ||
    value["project"]["id"] !== project.id ||
    value["project"]["identityDigest"] !== project.identityDigest ||
    !Number.isSafeInteger(value["revision"]) ||
    (value["revision"] as number) < 1 ||
    !Array.isArray(value["packs"]) ||
    value["packs"].length > MAX_INSTALLED_PACKS ||
    !isSha256Digest(value["stateDigest"])
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state",
      "installed pack state is malformed or belongs to another project",
    );
  }
  const schemaVersion = value["schemaVersion"] as InstalledPackState["schemaVersion"];
  const packs = value["packs"].map((pack) =>
    parsePack(pack, schemaVersion),
  );
  if (
    packs.some(
      (entry, index) =>
        index > 0 &&
        compareCanonicalText(packs[index - 1]?.id ?? "", entry.id) >= 0,
    )
  ) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs",
      "installed packs must be sorted and unique",
    );
  }
  const packsById = new Map(packs.map((pack) => [pack.id, pack]));
  const dependencyEdges = new Map<string, readonly string[]>();
  for (const pack of packs) {
    const dependencyIds: string[] = [];
    for (const dependency of pack.dependencies) {
      const selected = packsById.get(dependency.id);
      if (
        selected === undefined ||
        selected.version !== dependency.version ||
        selected.digest !== dependency.digest ||
        dependency.id === pack.id
      ) {
        throw new PackRuntimeError(
          "pack-state-corrupt",
          `$state.packs.${pack.id}.dependencies`,
          "installed dependency does not identify an exact distinct installed pack",
        );
      }
      dependencyIds.push(dependency.id);
    }
    dependencyEdges.set(pack.id, Object.freeze(dependencyIds));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const hasCycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencyEdges.get(id) ?? []) {
      if (hasCycle(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (packs.some(({ id }) => hasCycle(id))) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.packs",
      "installed pack dependencies contain a cycle",
    );
  }
  const foldedPaths = packs
    .flatMap((pack) => pack.artifacts.map(({ path }) => path.toLowerCase()))
    .sort(compareCanonicalText);
  for (let index = 1; index < foldedPaths.length; index += 1) {
    const previous = foldedPaths[index - 1] ?? "";
    const current = foldedPaths[index] ?? "";
    if (current === previous || current.startsWith(`${previous}/`)) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        "$state.packs[].artifacts",
        "installed artifact ownership overlaps under portable filesystem rules",
      );
    }
  }
  const directoryOwners = packs
    .flatMap((pack) =>
      (pack.directories ?? []).map((directory) => ({
        packId: pack.id,
        path: directory.directoryPath.toLowerCase(),
        markerPath: directory.path.toLowerCase(),
      })),
    )
    .sort((left, right) => compareCanonicalText(left.path, right.path));
  for (let index = 0; index < directoryOwners.length; index += 1) {
    const current = directoryOwners[index] as (typeof directoryOwners)[number];
    const previous = directoryOwners[index - 1];
    if (
      previous !== undefined &&
      (current.path === previous.path ||
        current.path.startsWith(`${previous.path}/`))
    ) {
      throw new PackRuntimeError(
        "pack-state-corrupt",
        "$state.packs[].directories",
        "installed directory ownership overlaps under portable filesystem rules",
      );
    }
    for (const pack of packs) {
      for (const artifact of pack.artifacts) {
        const artifactPath = artifact.path.toLowerCase();
        if (
          artifactPath === current.markerPath ||
          (pack.id !== current.packId &&
            (artifactPath === current.path ||
              artifactPath.startsWith(`${current.path}/`)))
        ) {
          throw new PackRuntimeError(
            "pack-state-corrupt",
            "$state.packs[].directories",
            "installed directory ownership conflicts with another owned path",
          );
        }
      }
    }
  }
  const state: InstalledPackState = Object.freeze({
    schemaVersion,
    project: Object.freeze({
      id: project.id,
      identityDigest: project.identityDigest,
    }),
    revision: value["revision"] as number,
    packs: Object.freeze(packs),
    stateDigest: value["stateDigest"],
  });
  if (computeInstalledPackStateDigest(state) !== state.stateDigest) {
    throw new PackRuntimeError(
      "pack-state-corrupt",
      "$state.stateDigest",
      "installed pack state digest does not attest its body",
    );
  }
  return state;
}

export async function loadInstalledPackState(
  root: CanonicalProjectRoot,
  project: { readonly id: StableId; readonly identityDigest: Sha256Digest },
  maxDirectoryEntries: number,
): Promise<LoadedInstalledPackState> {
  let snapshot;
  try {
    snapshot = await readProjectFileSnapshot({
      root,
      path: PACK_INSTALLED_STATE_PATH,
      maxBytes: PACK_INSTALLED_STATE_MAX_BYTES,
      maxDirectoryEntries,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return Object.freeze({ state: createEmptyInstalledPackState(project) });
    }
    throw error;
  }
  let parsed: unknown;
  try {
    const text = Buffer.from(snapshot.content).toString("utf8");
    parsed = JSON.parse(text) as unknown;
    const state = parseState(parsed, project);
    if (text !== `${canonicalizeJson(state)}\n`) {
      throw new Error("state is not canonical JSON with one trailing newline");
    }
    return Object.freeze({ state, fileDigest: snapshot.digest });
  } catch (error) {
    if (error instanceof PackRuntimeError) throw error;
    throw new PackRuntimeError(
      "pack-state-corrupt",
      PACK_INSTALLED_STATE_PATH,
      "installed pack state is malformed or noncanonical",
    );
  }
}
