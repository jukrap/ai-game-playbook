import {
  canonicalizeJson,
  compareCanonicalText,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  isPortableProjectPath,
  parseSemanticVersion,
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

export const PACK_INSTALLED_STATE_PATH: string =
  ".ai-game-playbook/state/packs/installed.json";
export const PACK_INSTALLED_STATE_MAX_BYTES: number = 1024 * 1024;
const MAX_INSTALLED_PACKS = 1024;
const MAX_ARTIFACTS_PER_PACK = 64;

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
  readonly installedAt: string;
  readonly updatedAt: string;
}

export interface InstalledPackState {
  readonly schemaVersion: "1.0.0";
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

function parsePack(value: unknown): InstalledPackRecord {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "id",
      "version",
      "digest",
      "dependencies",
      "artifacts",
      "installedAt",
      "updatedAt",
    ]) ||
    !isStableId(value["id"]) ||
    !isSha256Digest(value["digest"]) ||
    !Array.isArray(value["dependencies"]) ||
    value["dependencies"].length > MAX_INSTALLED_PACKS ||
    !Array.isArray(value["artifacts"]) ||
    value["artifacts"].length > MAX_ARTIFACTS_PER_PACK ||
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
    schemaVersion: "1.0.0" as const,
    project: Object.freeze({ ...project }),
    revision: 0,
    packs: Object.freeze([]) as readonly InstalledPackRecord[],
  };
  return Object.freeze({
    ...body,
    stateDigest: computeInstalledPackStateDigest(body),
  });
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
    value["schemaVersion"] !== "1.0.0" ||
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
  const packs = value["packs"].map(parsePack);
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
  const state: InstalledPackState = Object.freeze({
    schemaVersion: "1.0.0",
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
