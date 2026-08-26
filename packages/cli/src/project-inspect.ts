import {
  assertProjectInspectReportSemantics,
  canonicalizeJson,
  compareCanonicalText,
  computeGameProjectIdentityDigest,
  computeProjectEngineCandidateDigest,
  computeProjectInspectionDigest,
  computeProjectInspectionStatus,
  digestCanonicalJson,
  gameProjectProfileSchema,
  isPortableProjectPath,
  parseSemanticVersion,
  parseStableId,
  projectInspectReportSchema,
  projectInspectRequestSchema,
  summarizeProjectInspection,
  type EngineId,
  type GameProjectProfile,
  type PortableProjectPath,
  type ProjectDirtyStateAssessment,
  type ProjectEngineAssessment,
  type ProjectEngineCandidate,
  type ProjectEngineMarkerObservation,
  type ProjectEngineVersionObservation,
  type ProjectInspectIssue,
  type ProjectInspectIssueSeverity,
  type ProjectInspectReport,
  type ProjectInspectRequest,
  type ProjectInspectionReportFields,
  type ProjectInstanceAssessment,
  type ProjectInstanceSignal,
  type ProjectProfileAssessment,
  type SemanticVersion,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  listProjectRootEntries,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ProjectFileSnapshotResult,
  type ProjectRootEntry,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
  validateRegistry,
} from "@ai-game-playbook/registry";

const ROOT_ENTRY_LIMIT = 10_000;
const PROFILE_MAX_BYTES = 1_048_576;
const GODOT_PROJECT_MAX_BYTES = 1_048_576;
const UNITY_VERSION_MAX_BYTES = 16_384;
const UNITY_MANIFEST_MAX_BYTES = 1_048_576;
const UNREAL_PROJECT_MAX_BYTES = 1_048_576;
const INSTANCE_SIGNAL_MAX_BYTES = 16_384;
const MAX_ENGINE_CANDIDATES = 16;
const MAX_ISSUES = 64;

const inspectionSchemaRegistry = validateRegistry({
  schemaVersion: parseSemanticVersion("1.0.0").value,
  controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
  schemas: Object.freeze([
    gameProjectProfileSchema,
    projectInspectRequestSchema,
    projectInspectReportSchema,
  ]),
  commands: Object.freeze([]),
  skills: Object.freeze([]),
  roleLenses: Object.freeze([]),
  workflows: Object.freeze([]),
  packs: Object.freeze([]),
});

interface MarkerFileObservation {
  readonly marker: ProjectEngineMarkerObservation;
  readonly snapshot: ProjectFileSnapshotResult;
}

interface IssueCollector {
  readonly add: (
    severity: ProjectInspectIssueSeverity,
    code: string,
    message: string,
    nextAction: string,
    path?: string,
  ) => void;
  readonly finish: () => readonly ProjectInspectIssue[];
}

function createIssueCollector(): IssueCollector {
  const entries: ProjectInspectIssue[] = [];
  let overflow = false;
  return Object.freeze({
    add(
      severity: ProjectInspectIssueSeverity,
      code: string,
      message: string,
      nextAction: string,
      path?: string,
    ): void {
      if (entries.length >= MAX_ISSUES - 1) {
        overflow = true;
        return;
      }
      entries.push(
        Object.freeze({
          severity,
          code: parseStableId(code),
          ...(path === undefined ? {} : { path }),
          message,
          nextAction,
        }),
      );
    },
    finish(): readonly ProjectInspectIssue[] {
      if (overflow) {
        entries.push(
          Object.freeze({
            severity: "blocked",
            code: parseStableId("inspection-issue-budget-exceeded"),
            message:
              "Additional static inspection conflicts exceeded the report budget.",
            nextAction:
              "Reduce project-root ambiguity and rerun inspection before mutation.",
          }),
        );
      }
      return Object.freeze([...entries]);
    },
  });
}

function unknownVersion(): ProjectEngineVersionObservation {
  return Object.freeze({ precision: "unknown" });
}

function observedVersion(
  raw: string,
  normalized: string,
  precision: "exact" | "major-minor",
): ProjectEngineVersionObservation {
  return Object.freeze({
    raw,
    normalized: parseSemanticVersion(normalized).value,
    precision,
  });
}

function strictUtf8(content: Uint8Array): string | undefined {
  if (
    content.byteLength >= 3 &&
    content[0] === 0xef &&
    content[1] === 0xbb &&
    content[2] === 0xbf
  ) {
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

function markerSort(
  left: ProjectEngineMarkerObservation,
  right: ProjectEngineMarkerObservation,
): number {
  return compareCanonicalText(left.path, right.path);
}

function candidate(
  engine: EngineId,
  completeness: "complete" | "partial",
  markers: readonly ProjectEngineMarkerObservation[],
  version: ProjectEngineVersionObservation,
): ProjectEngineCandidate {
  const orderedMarkers = Object.freeze([...markers].sort(markerSort));
  const subject = Object.freeze({
    engine,
    completeness,
    markers: orderedMarkers,
    version,
  });
  return Object.freeze({
    ...subject,
    observationDigest: computeProjectEngineCandidateDigest(subject),
  });
}

function rootMatches(
  entries: readonly ProjectRootEntry[],
  expected: string,
): readonly ProjectRootEntry[] {
  const folded = expected.toLowerCase();
  return entries.filter(({ name }) => name.toLowerCase() === folded);
}

function rethrowRootDrift(error: unknown): void {
  if (
    error instanceof CoreBoundaryError &&
    error.code === "project-root-drift"
  ) {
    throw error;
  }
}

async function readOptionalMarkerFile(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  maxBytes: number,
  issues: IssueCollector,
  issueCode: string,
): Promise<MarkerFileObservation | undefined> {
  try {
    const resolved = await resolveProjectPath(root, path, {
      expectedType: "file",
      existence: "optional",
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
    if (resolved.kind === "absent") {
      return undefined;
    }
    const snapshot = await readProjectFileSnapshot({
      root,
      path,
      maxBytes,
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
    return Object.freeze({
      marker: Object.freeze({
        path,
        kind: "file",
        digest: snapshot.digest,
      }),
      snapshot,
    });
  } catch (error) {
    rethrowRootDrift(error);
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    issues.add(
      "attention",
      issueCode,
      "A required engine marker could not be read through a stable regular-file path.",
      "Resolve the marker path type, casing, link, size, or concurrent change and rerun inspection.",
      path,
    );
    return undefined;
  }
}

async function readOptionalDirectoryMarker(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  issues: IssueCollector,
  issueCode: string,
): Promise<ProjectEngineMarkerObservation | undefined> {
  try {
    const resolved = await resolveProjectPath(root, path, {
      expectedType: "directory",
      existence: "optional",
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
    return resolved.kind === "absent"
      ? undefined
      : Object.freeze({ path, kind: "directory" });
  } catch (error) {
    rethrowRootDrift(error);
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      return undefined;
    }
    issues.add(
      "attention",
      issueCode,
      "A required engine directory marker is unsafe or has an unexpected type.",
      "Resolve the marker path type, casing, link, or concurrent change and rerun inspection.",
      path,
    );
    return undefined;
  }
}

function godotVersion(
  snapshot: ProjectFileSnapshotResult,
  issues: IssueCollector,
): ProjectEngineVersionObservation {
  const text = strictUtf8(snapshot.content);
  if (text === undefined) {
    issues.add(
      "attention",
      "godot-version-unrecognized",
      "The Godot marker is not bounded UTF-8 version evidence.",
      "Confirm the project with a trusted Godot executable before selecting a version.",
      snapshot.path,
    );
    return unknownVersion();
  }
  const featureLines = text
    .split("\n")
    .filter((line) => line.startsWith("config/features=PackedStringArray("));
  if (featureLines.length === 1) {
    const match = /"([0-9]+\.[0-9]+)"/u.exec(featureLines[0] ?? "");
    if (match?.[1] !== undefined) {
      try {
        return observedVersion(match[1], `${match[1]}.0`, "major-minor");
      } catch {
        // The bounded unknown result below preserves malformed numeric hints.
      }
    }
  }
  issues.add(
    "attention",
    "godot-version-unrecognized",
    "The Godot project marker does not contain one recognized major/minor feature hint.",
    "Confirm the exact version with a trusted Godot executable before engine mutation.",
    snapshot.path,
  );
  return unknownVersion();
}

async function inspectGodot(
  root: CanonicalProjectRoot,
  entries: readonly ProjectRootEntry[],
  issues: IssueCollector,
): Promise<ProjectEngineCandidate | undefined> {
  const matches = rootMatches(entries, "project.godot");
  if (matches.length === 0) {
    return undefined;
  }
  if (matches.length > 1) {
    issues.add(
      "attention",
      "godot-marker-case-conflict",
      "Case-distinct Godot project markers cannot be selected safely.",
      "Keep one portable, case-exact project.godot marker and rerun inspection.",
      "project.godot",
    );
    return undefined;
  }
  const entry = matches[0];
  if (entry === undefined || !isPortableProjectPath(entry.name)) {
    return undefined;
  }
  if (entry.kindHint === "directory") {
    const marker = await readOptionalDirectoryMarker(
      root,
      entry.name,
      issues,
      "godot-marker-type-mismatch",
    );
    if (marker === undefined) {
      return undefined;
    }
    issues.add(
      "attention",
      "godot-marker-incomplete",
      "The Godot marker path is not a regular file.",
      "Replace the marker with a valid project.godot regular file before engine use.",
      entry.name,
    );
    return candidate("godot", "partial", [marker], unknownVersion());
  }
  if (entry.kindHint !== "file") {
    issues.add(
      "attention",
      "godot-marker-unsafe",
      "The Godot marker is a link or unsupported filesystem object.",
      "Use a regular project.godot file within the bound project root.",
      entry.name,
    );
    return undefined;
  }
  const observed = await readOptionalMarkerFile(
    root,
    entry.name,
    GODOT_PROJECT_MAX_BYTES,
    issues,
    "godot-marker-unreadable",
  );
  if (observed === undefined) {
    return undefined;
  }
  const exact = entry.name === "project.godot";
  if (!exact) {
    issues.add(
      "attention",
      "godot-marker-case-mismatch",
      "The Godot marker does not use the portable case-exact spelling.",
      "Rename the marker to project.godot before engine use.",
      entry.name,
    );
  }
  return candidate(
    "godot",
    exact ? "complete" : "partial",
    [observed.marker],
    godotVersion(observed.snapshot, issues),
  );
}

function unityVersion(
  snapshot: ProjectFileSnapshotResult,
  issues: IssueCollector,
): ProjectEngineVersionObservation {
  const text = strictUtf8(snapshot.content);
  if (text !== undefined) {
    const lines = text.split("\n").filter((line) =>
      line.startsWith("m_EditorVersion:"),
    );
    if (lines.length === 1) {
      const match = /^m_EditorVersion: ([0-9]+\.[0-9]+\.[0-9]+(?:[abfp][0-9]+)?)\r?$/u.exec(
        lines[0] ?? "",
      );
      const raw = match?.[1];
      const numeric = raw === undefined
        ? undefined
        : /^([0-9]+\.[0-9]+\.[0-9]+)/u.exec(raw)?.[1];
      if (raw !== undefined && numeric !== undefined) {
        try {
          return observedVersion(raw, numeric, "exact");
        } catch {
          // The bounded unknown result below preserves malformed numeric hints.
        }
      }
    }
  }
  issues.add(
    "attention",
    "unity-version-unrecognized",
    "ProjectVersion.txt does not contain one strict bounded Editor version line.",
    "Confirm the exact required Editor version before Unity mutation.",
    snapshot.path,
  );
  return unknownVersion();
}

async function inspectUnity(
  root: CanonicalProjectRoot,
  issues: IssueCollector,
): Promise<ProjectEngineCandidate | undefined> {
  const assets = await readOptionalDirectoryMarker(
    root,
    "Assets" as PortableProjectPath,
    issues,
    "unity-assets-marker-unsafe",
  );
  const versionFile = await readOptionalMarkerFile(
    root,
    "ProjectSettings/ProjectVersion.txt" as PortableProjectPath,
    UNITY_VERSION_MAX_BYTES,
    issues,
    "unity-version-marker-unsafe",
  );
  const manifest = await readOptionalMarkerFile(
    root,
    "Packages/manifest.json" as PortableProjectPath,
    UNITY_MANIFEST_MAX_BYTES,
    issues,
    "unity-manifest-marker-unsafe",
  );
  const markers = [assets, versionFile?.marker, manifest?.marker].filter(
    (value): value is ProjectEngineMarkerObservation => value !== undefined,
  );
  if (markers.length === 0) {
    return undefined;
  }
  const complete =
    assets !== undefined && versionFile !== undefined && manifest !== undefined;
  if (!complete) {
    issues.add(
      "attention",
      "unity-markers-incomplete",
      "The Unity project marker set is incomplete.",
      "Provide safe Assets, ProjectSettings/ProjectVersion.txt, and Packages/manifest.json markers.",
    );
  }
  return candidate(
    "unity",
    complete ? "complete" : "partial",
    markers,
    versionFile === undefined
      ? unknownVersion()
      : unityVersion(versionFile.snapshot, issues),
  );
}

function unrealVersion(
  snapshot: ProjectFileSnapshotResult,
  issues: IssueCollector,
): ProjectEngineVersionObservation {
  const text = strictUtf8(snapshot.content);
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        "EngineAssociation" in parsed &&
        typeof parsed.EngineAssociation === "string" &&
        parsed.EngineAssociation.length <= 128
      ) {
        const raw = parsed.EngineAssociation;
        const numeric = /^([0-9]+)\.([0-9]+)(?:\.[0-9]+)?$/u.exec(raw);
        if (numeric?.[1] !== undefined && numeric[2] !== undefined) {
          return observedVersion(
            raw,
            `${numeric[1]}.${numeric[2]}.0`,
            "major-minor",
          );
        }
      }
    } catch {
      // Descriptor identity remains available even when its version hint is not.
    }
  }
  issues.add(
    "attention",
    "unreal-version-unrecognized",
    "The project descriptor does not contain one numeric EngineAssociation hint.",
    "Confirm the exact engine build before Unreal mutation.",
    snapshot.path,
  );
  return unknownVersion();
}

async function inspectUnreal(
  root: CanonicalProjectRoot,
  entries: readonly ProjectRootEntry[],
  issues: IssueCollector,
): Promise<readonly ProjectEngineCandidate[]> {
  const descriptorEntries = entries.filter(({ name }) =>
    name.toLowerCase().endsWith(".uproject"),
  );
  if (descriptorEntries.length > MAX_ENGINE_CANDIDATES) {
    issues.add(
      "blocked",
      "unreal-candidate-budget-exceeded",
      "Unreal project descriptors exceed the bounded candidate limit.",
      "Keep one intended portable .uproject descriptor in the project root.",
    );
  }
  const candidates: ProjectEngineCandidate[] = [];
  for (const entry of descriptorEntries.slice(0, MAX_ENGINE_CANDIDATES)) {
    if (!isPortableProjectPath(entry.name)) {
      issues.add(
        "attention",
        "unreal-marker-name-unportable",
        "An Unreal descriptor name cannot enter the portable project contract.",
        "Rename the descriptor with portable ASCII project-path characters.",
      );
      continue;
    }
    if (entry.kindHint !== "file") {
      issues.add(
        "attention",
        "unreal-marker-unsafe",
        "An Unreal descriptor candidate is not a regular file.",
        "Use one safe regular .uproject file in the bound project root.",
        entry.name,
      );
      continue;
    }
    const observed = await readOptionalMarkerFile(
      root,
      entry.name,
      UNREAL_PROJECT_MAX_BYTES,
      issues,
      "unreal-marker-unreadable",
    );
    if (observed === undefined) {
      continue;
    }
    const exact = entry.name.endsWith(".uproject");
    if (!exact) {
      issues.add(
        "attention",
        "unreal-marker-case-mismatch",
        "The Unreal descriptor extension is not the case-exact .uproject spelling.",
        "Rename the descriptor to the portable lowercase extension.",
        entry.name,
      );
    }
    candidates.push(
      candidate(
        "unreal",
        exact ? "complete" : "partial",
        [observed.marker],
        unrealVersion(observed.snapshot, issues),
      ),
    );
  }
  return Object.freeze(candidates);
}

function candidateOrder(
  left: ProjectEngineCandidate,
  right: ProjectEngineCandidate,
): number {
  const engineOrder: Record<EngineId, number> = {
    godot: 0,
    unity: 1,
    unreal: 2,
  };
  const engineDifference = engineOrder[left.engine] - engineOrder[right.engine];
  if (engineDifference !== 0) {
    return engineDifference;
  }
  return compareCanonicalText(
    left.markers[0]?.path ?? "",
    right.markers[0]?.path ?? "",
  );
}

async function inspectEngines(
  root: CanonicalProjectRoot,
  entries: readonly ProjectRootEntry[],
  issues: IssueCollector,
): Promise<ProjectEngineAssessment> {
  const candidates = [
    await inspectGodot(root, entries, issues),
    await inspectUnity(root, issues),
    ...(await inspectUnreal(root, entries, issues)),
  ]
    .filter((value): value is ProjectEngineCandidate => value !== undefined)
    .sort(candidateOrder);
  if (candidates.length > MAX_ENGINE_CANDIDATES) {
    issues.add(
      "blocked",
      "engine-candidate-budget-exceeded",
      "Engine candidates exceed the bounded report limit.",
      "Remove unintended project markers and rerun inspection.",
    );
  }
  const bounded = Object.freeze(candidates.slice(0, MAX_ENGINE_CANDIDATES));
  if (bounded.length === 0) {
    issues.add(
      "attention",
      "engine-marker-not-found",
      "No complete or partial first-party engine marker was observed.",
      "Select a Godot, Unity, or Unreal project root and rerun inspection.",
    );
    return Object.freeze({ status: "none", candidates: bounded });
  }
  if (bounded.length > 1) {
    issues.add(
      "blocked",
      "engine-selection-ambiguous",
      "Multiple engine project candidates were observed without selection authority.",
      "Remove unintended markers or select a single verified project root.",
    );
    return Object.freeze({ status: "ambiguous", candidates: bounded });
  }
  const only = bounded[0];
  return Object.freeze({
    status: only?.completeness === "complete" ? "detected" : "partial",
    candidates: bounded,
  });
}

function invalidProfile(
  reason: string,
  issues: IssueCollector,
  issueCode: string,
  fileDigest?: ProjectProfileAssessment["fileDigest"],
): ProjectProfileAssessment {
  issues.add(
    "blocked",
    issueCode,
    reason,
    "Repair the bounded canonical profile and rerun project inspection.",
    ".ai-game-playbook/profile.json",
  );
  return Object.freeze({
    status: "invalid",
    path: ".ai-game-playbook/profile.json",
    ...(fileDigest === undefined ? {} : { fileDigest }),
    reason,
  });
}

function markerVersionMatches(
  profileVersion: SemanticVersion,
  observed: ProjectEngineVersionObservation,
): boolean {
  if (observed.normalized === undefined || observed.precision === "unknown") {
    return true;
  }
  if (observed.precision === "exact") {
    return profileVersion === observed.normalized;
  }
  const profile = parseSemanticVersion(profileVersion);
  const marker = parseSemanticVersion(observed.normalized);
  return profile.major === marker.major && profile.minor === marker.minor;
}

async function inspectProfile(
  root: CanonicalProjectRoot,
  engine: ProjectEngineAssessment,
  issues: IssueCollector,
): Promise<ProjectProfileAssessment> {
  let snapshot: ProjectFileSnapshotResult;
  try {
    snapshot = await readProjectFileSnapshot({
      root,
      path: ".ai-game-playbook/profile.json",
      maxBytes: PROFILE_MAX_BYTES,
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
  } catch (error) {
    rethrowRootDrift(error);
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-path-not-found"
    ) {
      issues.add(
        "attention",
        "project-profile-missing",
        "No committed project profile was observed.",
        "Create and review a bounded .ai-game-playbook/profile.json before mutation.",
        ".ai-game-playbook/profile.json",
      );
      return Object.freeze({
        status: "missing",
        path: ".ai-game-playbook/profile.json",
        reason: "The fixed project profile path is absent.",
      });
    }
    return invalidProfile(
      error instanceof CoreBoundaryError && error.code === "cas-budget-exceeded"
        ? "The project profile exceeds the bounded read limit."
        : "The project profile could not be read through a stable regular-file path.",
      issues,
      error instanceof CoreBoundaryError && error.code === "cas-budget-exceeded"
        ? "profile-read-budget-exceeded"
        : "profile-path-unsafe",
    );
  }

  const text = strictUtf8(snapshot.content);
  if (text === undefined) {
    return invalidProfile(
      "The project profile is not BOM-free bounded UTF-8.",
      issues,
      "profile-encoding-invalid",
      snapshot.digest,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidProfile(
      "The project profile is not valid JSON.",
      issues,
      "profile-json-invalid",
      snapshot.digest,
    );
  }
  try {
    if (`${canonicalizeJson(parsed)}\n` !== text) {
      return invalidProfile(
        "The project profile is not canonical JSON with one trailing newline.",
        issues,
        "profile-json-noncanonical",
        snapshot.digest,
      );
    }
  } catch {
    return invalidProfile(
      "The project profile contains values outside canonical JSON.",
      issues,
      "profile-json-invalid",
      snapshot.digest,
    );
  }

  let value: GameProjectProfile;
  try {
    value = validateRegisteredContractValue(
      inspectionSchemaRegistry,
      Object.freeze({
        schemaId: gameProjectProfileSchema.schemaId,
        digest: gameProjectProfileSchema.digest,
      }),
      parsed,
    ) as unknown as GameProjectProfile;
  } catch {
    return invalidProfile(
      "The project profile does not satisfy the registered profile schema.",
      issues,
      "profile-schema-invalid",
      snapshot.digest,
    );
  }
  const expectedIdentity = computeGameProjectIdentityDigest({
    projectId: value.projectId,
    engine: { id: value.engine.id, version: value.engine.version },
  });
  if (value.engine.projectIdentityDigest !== expectedIdentity) {
    return invalidProfile(
      "The project profile identity digest does not match its project and engine fields.",
      issues,
      "profile-identity-invalid",
      snapshot.digest,
    );
  }

  const candidateDigest = digestCanonicalJson(value);
  const observed = engine.status === "detected" ? engine.candidates[0] : undefined;
  if (
    observed !== undefined &&
    (observed.engine !== value.engine.id ||
      !markerVersionMatches(value.engine.version, observed.version))
  ) {
    issues.add(
      "blocked",
      "profile-engine-mismatch",
      "The committed profile engine identity contradicts the detected marker.",
      "Reconcile the profile and project marker before any engine mutation.",
      ".ai-game-playbook/profile.json",
    );
    return Object.freeze({
      status: "mismatch",
      path: ".ai-game-playbook/profile.json",
      fileDigest: snapshot.digest,
      candidateDigest,
      candidate: value,
      reason: "The profile is valid but does not match the detected engine marker.",
    });
  }
  if (observed?.version.precision === "unknown") {
    issues.add(
      "attention",
      "profile-engine-version-unverified",
      "The valid profile version could not be compared with static marker evidence.",
      "Confirm the exact engine version before binding an Editor or runtime.",
      ".ai-game-playbook/profile.json",
    );
  }
  return Object.freeze({
    status: "valid",
    path: ".ai-game-playbook/profile.json",
    fileDigest: snapshot.digest,
    candidateDigest,
    candidate: value,
    reason:
      observed === undefined
        ? "The canonical profile is internally valid; engine marker confirmation remains incomplete."
        : "The canonical profile identity is compatible with the detected engine marker.",
  });
}

async function inspectDirtyState(
  root: CanonicalProjectRoot,
  entries: readonly ProjectRootEntry[],
  issues: IssueCollector,
): Promise<ProjectDirtyStateAssessment> {
  const matches = rootMatches(entries, ".git");
  if (matches.length === 1 && matches[0]?.name === ".git") {
    try {
      await resolveProjectPath(root, ".git", {
        expectedType: "any",
        existence: "required",
        maxDirectoryEntries: ROOT_ENTRY_LIMIT,
      });
      issues.add(
        "attention",
        "dirty-state-unknown",
        "A version-control marker exists, but no trusted status process ran.",
        "Inspect the working tree with an approved version-control observer before mutation.",
        ".git",
      );
      return Object.freeze({
        status: "unknown",
        source: "marker-only",
        markerPath: ".git",
        reason:
          "The .git marker was observed without executing a version-control process.",
      });
    } catch (error) {
      rethrowRootDrift(error);
      issues.add(
        "attention",
        "version-control-marker-unsafe",
        "The .git marker could not be inspected as a stable local path.",
        "Resolve its casing, link, or path conflict before mutation.",
        ".git",
      );
    }
  } else if (matches.length > 0) {
    issues.add(
      "attention",
      "version-control-marker-ambiguous",
      "A case-conflicting version-control marker was observed.",
      "Keep one case-exact .git marker and rerun inspection.",
      ".git",
    );
  }
  issues.add(
    "attention",
    "dirty-state-not-observed",
    "No safe version-control marker or trusted dirty-state observation is available.",
    "Establish version control and inspect dirty state before mutation.",
  );
  return Object.freeze({
    status: "not-versioned",
    source: "none",
    reason: "No safe case-exact .git marker was observed.",
  });
}

async function inspectInstances(
  root: CanonicalProjectRoot,
  issues: IssueCollector,
): Promise<ProjectInstanceAssessment> {
  const signals: ProjectInstanceSignal[] = [];
  try {
    const lock = await resolveProjectPath(root, "Temp/UnityLockfile", {
      expectedType: "file",
      existence: "optional",
      maxDirectoryEntries: ROOT_ENTRY_LIMIT,
    });
    if (lock.kind !== "absent") {
      let digest: ProjectInstanceSignal["digest"];
      try {
        digest = (
          await readProjectFileSnapshot({
            root,
            path: "Temp/UnityLockfile",
            maxBytes: INSTANCE_SIGNAL_MAX_BYTES,
            maxDirectoryEntries: ROOT_ENTRY_LIMIT,
          })
        ).digest;
      } catch (error) {
        rethrowRootDrift(error);
        issues.add(
          "attention",
          "unity-lock-content-unobserved",
          "The Unity lock path exists but its bounded content could not be attested.",
          "Use an approved host observer before binding a Unity Editor session.",
          "Temp/UnityLockfile",
        );
      }
      signals.push(
        Object.freeze({
          engine: "unity",
          path: "Temp/UnityLockfile" as PortableProjectPath,
          kind: "lock",
          ...(digest === undefined ? {} : { digest }),
        }),
      );
    }
  } catch (error) {
    rethrowRootDrift(error);
    if (
      !(error instanceof CoreBoundaryError) ||
      error.code !== "project-path-not-found"
    ) {
      issues.add(
        "attention",
        "unity-lock-path-unsafe",
        "The Unity lock signal path is ambiguous or unsafe.",
        "Resolve the path before binding a Unity Editor session.",
        "Temp/UnityLockfile",
      );
    }
  }

  if (signals.length > 0) {
    issues.add(
      "attention",
      "instance-signal-unbound",
      "A static Editor signal exists without process or session identity.",
      "Use an approved host observer before selecting an Editor instance.",
    );
    return Object.freeze({
      status: "unbound-signal",
      selectionAllowed: false,
      signals: Object.freeze(signals),
      reason:
        "Static lock evidence cannot establish a live process or selectable session.",
    });
  }
  issues.add(
    "attention",
    "instance-state-not-observed",
    "Editor and runtime process identities were not observed.",
    "Use an approved host observer before binding an engine session.",
  );
  return Object.freeze({
    status: "not-observed",
    selectionAllowed: false,
    signals: Object.freeze([]),
    reason: "Static inspection did not enumerate operating-system processes.",
  });
}

function validateReport(report: ProjectInspectReport): ProjectInspectReport {
  const validated = validateRegisteredContractValue(
    inspectionSchemaRegistry,
    Object.freeze({
      schemaId: projectInspectReportSchema.schemaId,
      digest: projectInspectReportSchema.digest,
    }),
    report,
  ) as unknown as ProjectInspectReport;
  assertProjectInspectReportSemantics(validated);
  return validated;
}

function unavailableReport(
  requestedPath: string,
  reason: string,
): ProjectInspectReport {
  const fields: ProjectInspectionReportFields = Object.freeze({
    project: Object.freeze({ requestedPath }),
    engine: Object.freeze({ status: "not-inspected", candidates: Object.freeze([]) }),
    profile: Object.freeze({
      status: "not-inspected",
      path: ".ai-game-playbook/profile.json",
      reason: "The project root is unavailable.",
    }),
    dirtyState: Object.freeze({
      status: "not-inspected",
      source: "none",
      reason: "The project root is unavailable.",
    }),
    instances: Object.freeze({
      status: "not-inspected",
      selectionAllowed: false,
      signals: Object.freeze([]),
      reason: "The project root is unavailable.",
    }),
    issues: Object.freeze([
      Object.freeze({
        severity: "blocked",
        code: parseStableId("project-root-unavailable"),
        message: reason,
        nextAction: "Select one existing local game project directory and rerun inspection.",
      }),
    ]),
  });
  const summary = summarizeProjectInspection(fields);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "project.inspect",
      status: computeProjectInspectionStatus(summary),
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      ...fields,
      summary,
      mutationReady: false,
      mutationPerformed: false,
      externalProcessStarted: false,
      networkAccessPerformed: false,
    }),
  );
}

export async function runProjectInspect(
  input: unknown,
): Promise<ProjectInspectReport> {
  const request = validateRegisteredContractValue(
    inspectionSchemaRegistry,
    Object.freeze({
      schemaId: projectInspectRequestSchema.schemaId,
      digest: projectInspectRequestSchema.digest,
    }),
    input,
  ) as unknown as ProjectInspectRequest;

  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(request.projectRoot);
  } catch (error) {
    if (error instanceof CoreBoundaryError) {
      return unavailableReport(
        request.projectRoot,
        "The selected project root could not be bound to one stable local directory.",
      );
    }
    throw error;
  }

  const issues = createIssueCollector();
  const entries = await listProjectRootEntries({
    root,
    maxEntries: ROOT_ENTRY_LIMIT,
  });
  const engine = await inspectEngines(root, entries, issues);
  const profile = await inspectProfile(root, engine, issues);
  const dirtyState = await inspectDirtyState(root, entries, issues);
  const instances = await inspectInstances(root, issues);
  await assertProjectRootIdentity(root);
  const fields: ProjectInspectionReportFields = Object.freeze({
    project: Object.freeze({
      requestedPath: request.projectRoot,
      canonicalPath: root.canonicalPath,
      rootIdentityDigest: root.identityDigest,
    }),
    engine,
    profile,
    dirtyState,
    instances,
    issues: issues.finish(),
  });
  const summary = summarizeProjectInspection(fields);
  return validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "project.inspect",
      status: computeProjectInspectionStatus(summary),
      controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
      registryDigest: BUILTIN_REGISTRY.digest,
      ...fields,
      summary,
      inspectionDigest: computeProjectInspectionDigest({
        registryDigest: BUILTIN_REGISTRY.digest,
        projectIdentityDigest: root.identityDigest,
        engine,
        profile,
        dirtyState,
        instances,
        issues: fields.issues,
      }),
      mutationReady: false,
      mutationPerformed: false,
      externalProcessStarted: false,
      networkAccessPerformed: false,
    }),
  );
}
