import {
  PACK_INSPECTION_MAX_DECLARED_BYTES,
  PACK_INSPECTION_MAX_FINDINGS,
  PACK_INSPECTION_MAX_OWNED_PATHS,
  assertPackDoctorReportSemantics,
  assertPackListReportSemantics,
  computePackDoctorDigest,
  computePackDoctorStatus,
  computePackListDigest,
  computePackListStatus,
  isStableId,
  parseSemanticVersion,
  parseStableId,
  summarizePackDoctorObservations,
  summarizePackListEntries,
  type PackDoctorObservation,
  type PackDoctorPathSummary,
  type PackDoctorReport,
  type PackDoctorRequest,
  type PackDoctorTransactionSummary,
  type PackInstalledStateSummary,
  type PackInspectionIssue,
  type PackInspectionProjectState,
  type PackInspectionProjectSummary,
  type PackIntegrityStatus,
  type PackListEntry,
  type PackListReport,
  type PackListRequest,
  type PackRegistryStatus,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  PROJECT_STATE_DIRECTORIES,
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  readProjectDirectoryIdentity,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ProjectFileSnapshotResult,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

import {
  PACK_ACTIVE_TRANSACTION_MAX_BYTES,
  PACK_ACTIVE_TRANSACTION_PATH,
  loadActivePackTransactionRecord,
} from "./active-transaction.js";
import { inspectPackTransactionRecovery } from "./recovery.js";
import {
  PACK_INSTALLED_STATE_MAX_BYTES,
  PACK_INSTALLED_STATE_PATH,
  loadInstalledPackState,
  type InstalledPackArtifact,
  type InstalledPackRecord,
  type LoadedInstalledPackState,
} from "./state.js";
import type { PackDirectoryOwnershipMarker } from "./types.js";

const MAX_DIRECTORY_ENTRIES = 10_000;

interface BoundProjectInspection {
  readonly root?: CanonicalProjectRoot;
  readonly project: PackInspectionProjectSummary;
}

interface ObservedInstalledState {
  readonly summary: PackInstalledStateSummary;
  readonly loaded?: LoadedInstalledPackState;
}

type ActivePresence =
  | { readonly status: "clear" }
  | { readonly status: "present"; readonly snapshot: ProjectFileSnapshotResult }
  | { readonly status: "changed" }
  | { readonly status: "invalid" };

type OwnedPathOutcome =
  | { readonly status: "current" }
  | { readonly status: "missing" }
  | { readonly status: "modified"; readonly actualDigest?: Sha256Digest }
  | { readonly status: "unreadable" };

interface FindingCollector {
  readonly add: (
    severity: PackInspectionIssue["severity"],
    code: string,
    message: string,
    nextAction: string,
    details?: {
      readonly packId?: StableId;
      readonly path?: string;
      readonly expectedDigest?: Sha256Digest;
      readonly actualDigest?: Sha256Digest;
    },
  ) => void;
  readonly finish: () => readonly PackInspectionIssue[];
}

function commandDescriptor(id: "pack.doctor" | "pack.list") {
  const descriptor = BUILTIN_REGISTRY.commands.find(
    ({ id: commandId }) => commandId === id,
  );
  if (descriptor === undefined) {
    throw new TypeError(`builtin registry does not contain ${id}`);
  }
  return descriptor;
}

function createFindingCollector(): FindingCollector {
  const findings: PackInspectionIssue[] = [];
  let truncated = false;
  let finished = false;
  return Object.freeze({
    add(
      severity: PackInspectionIssue["severity"],
      code: string,
      message: string,
      nextAction: string,
      details: {
        readonly packId?: StableId;
        readonly path?: string;
        readonly expectedDigest?: Sha256Digest;
        readonly actualDigest?: Sha256Digest;
      } = {},
    ): void {
      if (finished) throw new TypeError("pack finding collector is closed");
      if (findings.length >= PACK_INSPECTION_MAX_FINDINGS - 1) {
        truncated = true;
        return;
      }
      findings.push(
        Object.freeze({
          severity,
          code: parseStableId(code),
          message,
          nextAction,
          ...(details.packId === undefined ? {} : { packId: details.packId }),
          ...(details.path === undefined ? {} : { path: details.path }),
          ...(details.expectedDigest === undefined
            ? {}
            : { expectedDigest: details.expectedDigest }),
          ...(details.actualDigest === undefined
            ? {}
            : { actualDigest: details.actualDigest }),
        }) as PackInspectionIssue,
      );
    },
    finish(): readonly PackInspectionIssue[] {
      if (finished) throw new TypeError("pack finding collector is closed");
      finished = true;
      if (truncated) {
        findings.push(
          Object.freeze({
            severity: "blocked",
            code: parseStableId("pack-findings-truncated"),
            message:
              "Pack findings exceeded the bounded diagnostic detail limit.",
            nextAction:
              "Reduce the managed pack surface and rerun diagnostics before mutation.",
          }),
        );
      }
      return Object.freeze(findings);
    },
  });
}

async function bindProject(
  requestedPath: string,
): Promise<BoundProjectInspection> {
  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(requestedPath);
  } catch {
    return Object.freeze({
      project: Object.freeze({
        requestedPath,
        state: "unavailable" as const,
      }),
    });
  }

  let state: PackInspectionProjectState;
  try {
    const runtimeRoot = await resolveProjectPath(root, ".ai-game-playbook", {
      expectedType: "directory",
      existence: "optional",
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    if (runtimeRoot.kind === "absent") {
      state = "uninitialized";
    } else {
      for (const path of PROJECT_STATE_DIRECTORIES) {
        await resolveProjectPath(root, path, {
          expectedType: "directory",
          existence: "required",
          maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
        });
      }
      state = "ready";
    }
  } catch {
    state = "incomplete";
  }
  try {
    await assertProjectRootIdentity(root);
  } catch {
    state = "incomplete";
  }
  return Object.freeze({
    root,
    project: Object.freeze({
      requestedPath,
      canonicalPath: root.canonicalPath,
      identityDigest: root.identityDigest,
      state,
    }),
  });
}

async function readOptionalSnapshot(
  root: CanonicalProjectRoot,
  path: string,
  maxBytes: number,
): Promise<ProjectFileSnapshotResult | undefined> {
  try {
    return await readProjectFileSnapshot({
      root,
      path,
      maxBytes,
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    throw error;
  }
}

function projectIdFromSnapshot(snapshot: ProjectFileSnapshotResult): StableId {
  const parsed: unknown = JSON.parse(
    Buffer.from(snapshot.content).toString("utf8"),
  );
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    !("project" in parsed) ||
    typeof parsed.project !== "object" ||
    parsed.project === null ||
    Array.isArray(parsed.project) ||
    !("id" in parsed.project) ||
    !isStableId(parsed.project.id)
  ) {
    throw new TypeError("managed state does not contain a valid project id");
  }
  return parsed.project.id;
}

async function loadObservedInstalledState(
  root: CanonicalProjectRoot,
): Promise<ObservedInstalledState> {
  const snapshot = await readOptionalSnapshot(
    root,
    PACK_INSTALLED_STATE_PATH,
    PACK_INSTALLED_STATE_MAX_BYTES,
  );
  if (snapshot === undefined) {
    return Object.freeze({
      summary: Object.freeze({ status: "empty" as const }),
    });
  }
  const projectId = projectIdFromSnapshot(snapshot);
  const loaded = await loadInstalledPackState(
    root,
    { id: projectId, identityDigest: root.identityDigest },
    MAX_DIRECTORY_ENTRIES,
  );
  if (loaded.fileDigest !== snapshot.digest) {
    throw new TypeError("installed pack state changed during inspection");
  }
  return Object.freeze({
    loaded,
    summary: Object.freeze({
      status: "present" as const,
      formatVersion: loaded.state.schemaVersion,
      projectId: loaded.state.project.id,
      revision: loaded.state.revision,
      stateDigest: loaded.state.stateDigest,
      fileDigest: loaded.fileDigest,
    }),
  });
}

function sameInstalledState(
  left: ObservedInstalledState,
  right: ObservedInstalledState,
): boolean {
  if (left.summary.status !== right.summary.status) return false;
  if (left.summary.status === "empty") return true;
  return (
    left.summary.status === "present" &&
    right.summary.status === "present" &&
    left.summary.fileDigest === right.summary.fileDigest &&
    left.summary.stateDigest === right.summary.stateDigest &&
    left.summary.revision === right.summary.revision
  );
}

function listEntries(
  installed: ObservedInstalledState,
): readonly PackListEntry[] {
  return Object.freeze(
    (installed.loaded?.state.packs ?? []).map((pack) =>
      Object.freeze({
        id: pack.id,
        version: pack.version,
        digest: pack.digest,
        dependencyCount: pack.dependencies.length,
        artifactCount: pack.artifacts.length,
        artifactBytes: pack.artifacts.reduce(
          (total, artifact) => total + artifact.bytes,
          0,
        ),
        ownedDirectoryCount: pack.directories?.length ?? 0,
        installedAt: pack.installedAt,
        updatedAt: pack.updatedAt,
      }),
    ),
  );
}

function sameOptionalSnapshot(
  left: ProjectFileSnapshotResult | undefined,
  right: ProjectFileSnapshotResult | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.digest === right.digest && left.bytes === right.bytes;
}

async function inspectStableActivePresence(
  root: CanonicalProjectRoot,
): Promise<ActivePresence> {
  try {
    const first = await readOptionalSnapshot(
      root,
      PACK_ACTIVE_TRANSACTION_PATH,
      PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    );
    const second = await readOptionalSnapshot(
      root,
      PACK_ACTIVE_TRANSACTION_PATH,
      PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    );
    if (!sameOptionalSnapshot(first, second)) {
      return Object.freeze({ status: "changed" as const });
    }
    return first === undefined
      ? Object.freeze({ status: "clear" as const })
      : Object.freeze({ status: "present" as const, snapshot: first });
  } catch {
    return Object.freeze({ status: "invalid" as const });
  }
}

function addProjectIssue(
  collector: FindingCollector,
  state: PackInspectionProjectState,
): void {
  if (state === "unavailable") {
    collector.add(
      "blocked",
      "project-root-unavailable",
      "The selected project root could not be bound to one stable local directory.",
      "Select one existing local project directory and rerun the command.",
    );
  } else if (state === "uninitialized") {
    collector.add(
      "attention",
      "pack-runtime-uninitialized",
      "Project-local pack runtime state has not been initialized.",
      "Review the agpb init plan before requesting any project-local initialization.",
    );
  } else if (state === "incomplete") {
    collector.add(
      "blocked",
      "pack-runtime-layout-unsafe",
      "The project-local runtime directory layout is incomplete or unsafe.",
      "Resolve missing, linked, aliased, or conflicting runtime paths before pack activity.",
    );
  }
}

function validateListReport(report: PackListReport): PackListReport {
  const descriptor = commandDescriptor("pack.list");
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.output,
    report,
  ) as unknown as PackListReport;
  assertPackListReportSemantics(validated);
  return validated;
}

function validateDoctorReport(report: PackDoctorReport): PackDoctorReport {
  const descriptor = commandDescriptor("pack.doctor");
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.output,
    report,
  ) as unknown as PackDoctorReport;
  assertPackDoctorReportSemantics(validated);
  return validated;
}

function packListReport(
  project: PackInspectionProjectSummary,
  installedState: PackInstalledStateSummary,
  entries: readonly PackListEntry[],
  issues: readonly PackInspectionIssue[],
): PackListReport {
  const summary = summarizePackListEntries(entries);
  const body = {
    schemaVersion: parseSemanticVersion("1.0.0").value,
    commandId: "pack.list" as const,
    status: computePackListStatus(issues),
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    project,
    installedState,
    entries,
    issues,
    summary,
    ...(project.identityDigest === undefined
      ? {}
      : {
          listDigest: computePackListDigest({
            registryDigest: BUILTIN_REGISTRY.digest,
            projectIdentityDigest: project.identityDigest,
            projectState: project.state,
            installedState,
            entries,
            issues,
          }),
        }),
    mutationPerformed: false as const,
    externalProcessStarted: false as const,
    networkAccessPerformed: false as const,
    artifactContentExposed: false as const,
    sourceLocationExposed: false as const,
  };
  return validateListReport(Object.freeze(body));
}

export async function runPackList(input: unknown): Promise<PackListReport> {
  const descriptor = commandDescriptor("pack.list");
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.input,
    input,
  ) as unknown as PackListRequest;
  const bound = await bindProject(request.projectRoot);
  const collector = createFindingCollector();
  addProjectIssue(collector, bound.project.state);
  if (bound.root === undefined || bound.project.state !== "ready") {
    return packListReport(
      bound.project,
      Object.freeze({ status: "not-inspected" }),
      Object.freeze([]),
      collector.finish(),
    );
  }

  let installed: ObservedInstalledState;
  try {
    installed = await loadObservedInstalledState(bound.root);
  } catch {
    collector.add(
      "blocked",
      "pack-state-invalid",
      "Installed pack state is malformed, noncanonical, unstable, or bound to another project.",
      "Do not run pack mutations; inspect local state and recovery evidence first.",
    );
    await assertProjectRootIdentity(bound.root);
    return packListReport(
      bound.project,
      Object.freeze({ status: "invalid" }),
      Object.freeze([]),
      collector.finish(),
    );
  }

  const active = await inspectStableActivePresence(bound.root);
  if (active.status === "present") {
    collector.add(
      "blocked",
      "pack-transaction-present",
      "An active pack transaction marker is present, so installed state is not settled.",
      "Run agpb pack doctor and review recovery status before pack mutation.",
    );
  } else if (active.status === "changed") {
    collector.add(
      "blocked",
      "pack-transaction-changed",
      "The active pack transaction marker changed during listing.",
      "Wait for pack activity to stop, then rerun the command.",
    );
  } else if (active.status === "invalid") {
    collector.add(
      "blocked",
      "pack-transaction-unsafe",
      "The active pack transaction path could not be inspected safely.",
      "Review the local transaction marker and journal without clearing them manually.",
    );
  }

  try {
    const after = await loadObservedInstalledState(bound.root);
    if (!sameInstalledState(installed, after)) {
      throw new TypeError("installed state changed");
    }
  } catch {
    collector.add(
      "blocked",
      "pack-state-changed",
      "Installed pack state changed during listing.",
      "Wait for pack activity to stop, then rerun the command.",
    );
    installed = Object.freeze({
      summary: Object.freeze({ status: "invalid" as const }),
    });
  }
  await assertProjectRootIdentity(bound.root);
  const entries =
    installed.summary.status === "present"
      ? listEntries(installed)
      : Object.freeze([]);
  return packListReport(
    bound.project,
    installed.summary,
    entries,
    collector.finish(),
  );
}

function registryStatus(pack: InstalledPackRecord): PackRegistryStatus {
  const manifest = BUILTIN_REGISTRY.packs.find(({ id }) => id === pack.id);
  if (manifest === undefined) return "unavailable";
  return manifest.version === pack.version && manifest.digest === pack.digest
    ? "current"
    : "different";
}

function addRegistryFinding(
  collector: FindingCollector,
  pack: InstalledPackRecord,
  status: PackRegistryStatus,
): void {
  if (status === "unavailable") {
    collector.add(
      "attention",
      "pack-manifest-unavailable",
      "The installed pack has no manifest in the current runtime registry.",
      "Use a trusted registry containing the exact installed pack before update or removal.",
      { packId: pack.id },
    );
  } else if (status === "different") {
    collector.add(
      "attention",
      "pack-manifest-different",
      "The current runtime registry has a different version or digest for this pack.",
      "Review the exact installed and available identities before update or removal.",
      { packId: pack.id },
    );
  }
}

function emptyPathSummary(declared: number): PackDoctorPathSummary {
  return Object.freeze({
    declared,
    current: 0,
    missing: 0,
    modified: 0,
    unreadable: 0,
  });
}

function notInspectedObservation(
  pack: InstalledPackRecord,
  collector: FindingCollector,
): PackDoctorObservation {
  const selectedRegistryStatus = registryStatus(pack);
  addRegistryFinding(collector, pack, selectedRegistryStatus);
  return Object.freeze({
    id: pack.id,
    version: pack.version,
    digest: pack.digest,
    registryStatus: selectedRegistryStatus,
    integrityStatus: "not-inspected",
    artifacts: emptyPathSummary(pack.artifacts.length),
    directories: emptyPathSummary(pack.directories?.length ?? 0),
  });
}

async function observeOwnedFile(
  root: CanonicalProjectRoot,
  expected: Pick<InstalledPackArtifact, "path" | "digest" | "bytes">,
): Promise<OwnedPathOutcome> {
  try {
    const snapshot = await readProjectFileSnapshot({
      root,
      path: expected.path,
      maxBytes: Math.max(1, expected.bytes),
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    if (snapshot.bytes !== expected.bytes || snapshot.digest !== expected.digest) {
      return Object.freeze({
        status: "modified" as const,
        actualDigest: snapshot.digest,
      });
    }
    return Object.freeze({ status: "current" as const });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return Object.freeze({ status: "missing" as const });
    }
    if (
      error instanceof CoreBoundaryError &&
      error.code === "cas-budget-exceeded"
    ) {
      return Object.freeze({ status: "modified" as const });
    }
    return Object.freeze({ status: "unreadable" as const });
  }
}

function addOwnedPathFinding(
  collector: FindingCollector,
  packId: StableId,
  expected: Pick<InstalledPackArtifact, "path" | "digest">,
  outcome: OwnedPathOutcome,
  role: "artifact" | "directory-marker",
): void {
  if (outcome.status === "current") return;
  const noun = role === "artifact" ? "artifact" : "directory ownership marker";
  if (outcome.status === "missing") {
    collector.add(
      "blocked",
      role === "artifact"
        ? "pack-owned-artifact-missing"
        : "pack-directory-marker-missing",
      `A managed pack ${noun} is missing.`,
      "Review the managed path and recovery evidence before pack mutation.",
      {
        packId,
        path: expected.path,
        expectedDigest: expected.digest,
      },
    );
  } else if (outcome.status === "modified") {
    collector.add(
      "blocked",
      role === "artifact"
        ? "pack-owned-artifact-modified"
        : "pack-directory-marker-modified",
      `A managed pack ${noun} differs from installed state.`,
      "Preserve the current bytes and review the ownership conflict before pack mutation.",
      {
        packId,
        path: expected.path,
        expectedDigest: expected.digest,
        ...(outcome.actualDigest === undefined
          ? {}
          : { actualDigest: outcome.actualDigest }),
      },
    );
  } else {
    collector.add(
      "blocked",
      role === "artifact"
        ? "pack-owned-artifact-unsafe"
        : "pack-directory-marker-unsafe",
      `A managed pack ${noun} could not be read through a stable regular-file path.`,
      "Resolve path, link, case, or byte-budget conflicts before pack mutation.",
      { packId, path: expected.path, expectedDigest: expected.digest },
    );
  }
}

function countOutcome(
  summary: { current: number; missing: number; modified: number; unreadable: number },
  outcome: OwnedPathOutcome,
): void {
  summary[outcome.status] += 1;
}

async function observeOwnedDirectory(
  root: CanonicalProjectRoot,
  marker: PackDirectoryOwnershipMarker,
): Promise<OwnedPathOutcome> {
  try {
    await readProjectDirectoryIdentity({
      root,
      path: marker.directoryPath,
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({ status: "unreadable" as const });
  }
  return observeOwnedFile(root, marker);
}

async function inspectPackIntegrity(
  root: CanonicalProjectRoot,
  pack: InstalledPackRecord,
  collector: FindingCollector,
): Promise<PackDoctorObservation> {
  const artifactCounts = {
    current: 0,
    missing: 0,
    modified: 0,
    unreadable: 0,
  };
  for (const artifact of pack.artifacts) {
    const outcome = await observeOwnedFile(root, artifact);
    countOutcome(artifactCounts, outcome);
    addOwnedPathFinding(collector, pack.id, artifact, outcome, "artifact");
  }
  const directoryCounts = {
    current: 0,
    missing: 0,
    modified: 0,
    unreadable: 0,
  };
  for (const marker of pack.directories ?? []) {
    const outcome = await observeOwnedDirectory(root, marker);
    countOutcome(directoryCounts, outcome);
    addOwnedPathFinding(
      collector,
      pack.id,
      marker,
      outcome,
      "directory-marker",
    );
  }
  const unreadable = artifactCounts.unreadable + directoryCounts.unreadable;
  const drifted =
    artifactCounts.missing +
    artifactCounts.modified +
    directoryCounts.missing +
    directoryCounts.modified;
  const integrityStatus: PackIntegrityStatus =
    unreadable > 0 ? "unsafe" : drifted > 0 ? "drifted" : "current";
  const selectedRegistryStatus = registryStatus(pack);
  addRegistryFinding(collector, pack, selectedRegistryStatus);
  return Object.freeze({
    id: pack.id,
    version: pack.version,
    digest: pack.digest,
    registryStatus: selectedRegistryStatus,
    integrityStatus,
    artifacts: Object.freeze({
      declared: pack.artifacts.length,
      ...artifactCounts,
    }),
    directories: Object.freeze({
      declared: pack.directories?.length ?? 0,
      ...directoryCounts,
    }),
  });
}

function withinDoctorBudget(packs: readonly InstalledPackRecord[]): boolean {
  let ownedPaths = 0;
  let declaredBytes = 0;
  for (const pack of packs) {
    ownedPaths += pack.artifacts.length + (pack.directories?.length ?? 0);
    for (const artifact of pack.artifacts) declaredBytes += artifact.bytes;
    for (const marker of pack.directories ?? []) declaredBytes += marker.bytes;
    if (
      !Number.isSafeInteger(ownedPaths) ||
      !Number.isSafeInteger(declaredBytes) ||
      ownedPaths > PACK_INSPECTION_MAX_OWNED_PATHS ||
      declaredBytes > PACK_INSPECTION_MAX_DECLARED_BYTES
    ) {
      return false;
    }
  }
  return true;
}

async function inspectTransaction(
  root: CanonicalProjectRoot,
  installed: ObservedInstalledState,
  collector: FindingCollector,
): Promise<PackDoctorTransactionSummary> {
  const presence = await inspectStableActivePresence(root);
  if (presence.status === "clear") {
    return Object.freeze({ status: "clear" });
  }
  if (presence.status === "changed") {
    collector.add(
      "blocked",
      "pack-transaction-changed",
      "The active pack transaction marker changed during diagnostics.",
      "Wait for pack activity to stop, then rerun pack doctor.",
    );
    return Object.freeze({ status: "invalid" });
  }
  if (presence.status === "invalid") {
    collector.add(
      "blocked",
      "pack-transaction-unsafe",
      "The active pack transaction path could not be inspected safely.",
      "Review the marker and journal without clearing them manually.",
    );
    return Object.freeze({ status: "invalid" });
  }

  try {
    const projectId =
      installed.loaded?.state.project.id ??
      projectIdFromSnapshot(presence.snapshot);
    const active = await loadActivePackTransactionRecord({
      root,
      project: { id: projectId, identityDigest: root.identityDigest },
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    if (
      active === undefined ||
      active.fileDigest !== presence.snapshot.digest
    ) {
      throw new TypeError("active marker changed");
    }
    const recovery = await inspectPackTransactionRecovery({
      root,
      runId: active.record.runId,
      project: {
        id: active.record.project.id,
        identityDigest: active.record.project.identityDigest,
      },
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    const after = await readOptionalSnapshot(
      root,
      PACK_ACTIVE_TRANSACTION_PATH,
      PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    );
    if (!sameOptionalSnapshot(presence.snapshot, after)) {
      throw new TypeError("active marker changed");
    }
    collector.add(
      "blocked",
      "pack-transaction-recovery-required",
      "An active pack transaction requires explicit recovery review.",
      "Review the bounded recovery result before requesting separately approved finalization.",
      { packId: active.record.pack.id },
    );
    return Object.freeze({
      status: "recovery-required" as const,
      runId: active.record.runId,
      operation: active.record.operation,
      pack: Object.freeze({ ...active.record.pack }),
      markerFileDigest: active.fileDigest,
      recovery: Object.freeze({
        stable: recovery.stable,
        consistency: recovery.consistency,
        observedState: recovery.observedState,
        mutationUncertain: recovery.mutationUncertain,
        finalizationAction: recovery.finalizationAction,
        reportDigest: recovery.reportDigest,
      }),
    });
  } catch {
    collector.add(
      "blocked",
      "pack-transaction-invalid",
      "The active pack transaction marker or recovery journal is malformed, unstable, or inconsistent.",
      "Preserve local evidence and review the transaction before any repair or finalization.",
    );
    return Object.freeze({ status: "invalid" });
  }
}

function packDoctorReport(
  project: PackInspectionProjectSummary,
  installedState: PackInstalledStateSummary,
  transaction: PackDoctorTransactionSummary,
  packs: readonly PackDoctorObservation[],
  findings: readonly PackInspectionIssue[],
): PackDoctorReport {
  const summary = summarizePackDoctorObservations(packs);
  const body = {
    schemaVersion: parseSemanticVersion("1.0.0").value,
    commandId: "pack.doctor" as const,
    status: computePackDoctorStatus(findings),
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    project,
    installedState,
    transaction,
    packs,
    findings,
    summary,
    ...(project.identityDigest === undefined
      ? {}
      : {
          reportDigest: computePackDoctorDigest({
            registryDigest: BUILTIN_REGISTRY.digest,
            projectIdentityDigest: project.identityDigest,
            projectState: project.state,
            installedState,
            transaction,
            packs,
            findings,
          }),
        }),
    repairPerformed: false as const,
    recoveryFinalizationPerformed: false as const,
    mutationPerformed: false as const,
    externalProcessStarted: false as const,
    networkAccessPerformed: false as const,
    artifactContentExposed: false as const,
    sourceLocationExposed: false as const,
  };
  return validateDoctorReport(Object.freeze(body));
}

export async function runPackDoctor(input: unknown): Promise<PackDoctorReport> {
  const descriptor = commandDescriptor("pack.doctor");
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.input,
    input,
  ) as unknown as PackDoctorRequest;
  const bound = await bindProject(request.projectRoot);
  const collector = createFindingCollector();
  addProjectIssue(collector, bound.project.state);
  if (bound.root === undefined || bound.project.state !== "ready") {
    return packDoctorReport(
      bound.project,
      Object.freeze({ status: "not-inspected" }),
      Object.freeze({ status: "not-inspected" }),
      Object.freeze([]),
      collector.finish(),
    );
  }

  let installed: ObservedInstalledState;
  try {
    installed = await loadObservedInstalledState(bound.root);
  } catch {
    collector.add(
      "blocked",
      "pack-state-invalid",
      "Installed pack state is malformed, noncanonical, unstable, or bound to another project.",
      "Do not run pack mutations; inspect local state and recovery evidence first.",
    );
    installed = Object.freeze({
      summary: Object.freeze({ status: "invalid" as const }),
    });
  }

  let transaction = await inspectTransaction(bound.root, installed, collector);
  const records = installed.loaded?.state.packs ?? Object.freeze([]);
  let packs: readonly PackDoctorObservation[];
  if (transaction.status !== "clear") {
    packs = Object.freeze(
      records.map((pack) => notInspectedObservation(pack, collector)),
    );
  } else if (!withinDoctorBudget(records)) {
    collector.add(
      "blocked",
      "pack-inspection-budget-exceeded",
      "Managed pack ownership exceeds the bounded path or byte inspection budget.",
      "Reduce the managed pack surface before requesting integrity or mutation decisions.",
    );
    packs = Object.freeze(
      records.map((pack) => notInspectedObservation(pack, collector)),
    );
  } else {
    const observations: PackDoctorObservation[] = [];
    for (const pack of records) {
      observations.push(
        await inspectPackIntegrity(bound.root, pack, collector),
      );
    }
    packs = Object.freeze(observations);
    try {
      const after = await loadObservedInstalledState(bound.root);
      if (!sameInstalledState(installed, after)) {
        throw new TypeError("installed state changed");
      }
    } catch {
      collector.add(
        "blocked",
        "pack-state-changed",
        "Installed pack state changed during diagnostics.",
        "Wait for pack activity to stop, then rerun pack doctor.",
      );
    }
    const activeAfter = await inspectStableActivePresence(bound.root);
    if (activeAfter.status !== "clear") {
      collector.add(
        "blocked",
        "pack-transaction-changed",
        "Pack transaction state changed during owned-path diagnostics.",
        "Wait for pack activity to stop, then rerun pack doctor.",
      );
      transaction = Object.freeze({ status: "invalid" });
    }
  }

  await assertProjectRootIdentity(bound.root);
  return packDoctorReport(
    bound.project,
    installed.summary,
    transaction,
    packs,
    collector.finish(),
  );
}
