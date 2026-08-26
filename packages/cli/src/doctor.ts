import {
  computeDoctorStatus,
  isStableId,
  parseSemanticVersion,
  parseStableId,
  compareSemanticVersions,
  type DoctorCheck,
  type DoctorCheckStatus,
  type DoctorProjectState,
  type DoctorReport,
  type DoctorRequest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  PROJECT_STATE_DIRECTORIES,
  canonicalizeProjectRoot,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
  type ProjectFileSnapshotResult,
} from "@ai-game-playbook/core";
import {
  PACK_ACTIVE_TRANSACTION_MAX_BYTES,
  PACK_ACTIVE_TRANSACTION_PATH,
  PACK_INSTALLED_STATE_MAX_BYTES,
  PACK_INSTALLED_STATE_PATH,
  loadActivePackTransactionRecord,
  loadInstalledPackState,
} from "@ai-game-playbook/pack-runtime";
import {
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";

export interface DoctorRuntimeOptions {
  readonly nodeVersion: string;
}

interface ProjectInspection {
  readonly root?: CanonicalProjectRoot;
  readonly state: DoctorProjectState;
  readonly check: DoctorCheck;
}

interface PackStateInspection {
  readonly check: DoctorCheck;
}

const MINIMUM_NODE_VERSION = "22.22.0";
const MAXIMUM_NODE_VERSION_EXCLUSIVE = "23.0.0";
const MAX_DIRECTORY_ENTRIES = 10_000;

function doctorDescriptor() {
  const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === "doctor");
  if (command === undefined) {
    throw new TypeError("builtin registry does not contain doctor");
  }
  return command;
}

function check(
  id: string,
  status: DoctorCheckStatus,
  code: string,
  message: string,
  nextAction?: string,
): DoctorCheck {
  const result: DoctorCheck = {
    id: parseStableId(id),
    status,
    code: parseStableId(code),
    message,
    ...(nextAction === undefined ? {} : { nextAction }),
  };
  return Object.freeze(result);
}

function skipped(id: string, code: string, message: string): DoctorCheck {
  return check(id, "skipped", code, message);
}

function inspectRegistry(): DoctorCheck {
  const commands = BUILTIN_REGISTRY_SURFACES.cli.data.commands;
  const runtimeCommands = BUILTIN_REGISTRY.commands;
  const surfaceMatchesRuntime =
    commands.length === runtimeCommands.length &&
    runtimeCommands.every((runtimeCommand) => {
      const generated = commands.find(({ id }) => id === runtimeCommand.id);
      return (
        generated !== undefined &&
        generated.input.schemaId === runtimeCommand.input.schemaId &&
        generated.input.digest === runtimeCommand.input.digest &&
        generated.output.schemaId === runtimeCommand.output.schemaId &&
        generated.output.digest === runtimeCommand.output.digest
      );
    });
  if (
    BUILTIN_REGISTRY_SURFACES.registryDigest !== BUILTIN_REGISTRY.digest ||
    !surfaceMatchesRuntime
  ) {
    return check(
      "control-plane.registry",
      "blocked",
      "registry-surface-mismatch",
      "The runtime registry and generated command surface do not match.",
      "Rebuild the control plane from a clean checkout before running commands.",
    );
  }
  return check(
    "control-plane.registry",
    "passed",
    "registry-current",
    "The runtime registry and generated command surface match.",
  );
}

function inspectNodeVersion(nodeVersion: string): DoctorCheck {
  try {
    const supported =
      compareSemanticVersions(nodeVersion, MINIMUM_NODE_VERSION) >= 0 &&
      compareSemanticVersions(nodeVersion, MAXIMUM_NODE_VERSION_EXCLUSIVE) < 0;
    if (supported) {
      return check(
        "runtime.node",
        "passed",
        "node-version-supported",
        `Node.js ${nodeVersion} is within the supported runtime range.`,
      );
    }
  } catch {
    // The bounded diagnostic below covers malformed runtime version text.
  }
  return check(
    "runtime.node",
    "blocked",
    "node-version-unsupported",
    `Node.js ${nodeVersion} is outside the supported >=${MINIMUM_NODE_VERSION} <${MAXIMUM_NODE_VERSION_EXCLUSIVE} range.`,
    "Use the supported Node.js major and patch range, then rerun doctor.",
  );
}

async function inspectProjectState(
  requestedPath: string,
): Promise<ProjectInspection> {
  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(requestedPath);
  } catch {
    return Object.freeze({
      state: "unavailable",
      check: check(
        "project.root",
        "blocked",
        "project-root-unavailable",
        "The selected project root could not be bound to one safe local directory.",
        "Select one existing local project directory and rerun doctor.",
      ),
    });
  }

  try {
    const stateRoot = await resolveProjectPath(root, ".ai-game-playbook", {
      expectedType: "directory",
      existence: "optional",
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    if (stateRoot.kind === "absent") {
      return Object.freeze({
        root,
        state: "uninitialized",
        check: check(
          "project.state",
          "warning",
          "project-state-not-initialized",
          "Project-local runtime state has not been initialized.",
          "Run agpb init after reviewing its write plan.",
        ),
      });
    }

    for (const path of PROJECT_STATE_DIRECTORIES) {
      await resolveProjectPath(root, path, {
        expectedType: "directory",
        existence: "required",
        maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
      });
    }
    return Object.freeze({
      root,
      state: "ready",
      check: check(
        "project.state",
        "passed",
        "project-state-ready",
        "The fixed project-local runtime directory layout is complete.",
      ),
    });
  } catch {
    return Object.freeze({
      root,
      state: "incomplete",
      check: check(
        "project.state",
        "blocked",
        "project-state-unsafe",
        "The project-local runtime directory layout is incomplete or unsafe.",
        "Review links, files, and missing directories before requesting an approved repair.",
      ),
    });
  }
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
  const parsed: unknown = JSON.parse(Buffer.from(snapshot.content).toString("utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("project" in parsed) ||
    typeof parsed.project !== "object" ||
    parsed.project === null ||
    !("id" in parsed.project) ||
    !isStableId(parsed.project.id)
  ) {
    throw new TypeError("managed state does not contain a valid project id");
  }
  return parsed.project.id;
}

async function inspectPackState(
  root: CanonicalProjectRoot,
): Promise<PackStateInspection> {
  try {
    const snapshot = await readOptionalSnapshot(
      root,
      PACK_INSTALLED_STATE_PATH,
      PACK_INSTALLED_STATE_MAX_BYTES,
    );
    if (snapshot === undefined) {
      return Object.freeze({
        check: check(
          "pack.state",
          "passed",
          "pack-state-empty",
          "No installed pack state is present.",
        ),
      });
    }
    const projectId = projectIdFromSnapshot(snapshot);
    const loaded = await loadInstalledPackState(
      root,
      { id: projectId, identityDigest: root.identityDigest },
      MAX_DIRECTORY_ENTRIES,
    );
    if (loaded.fileDigest !== snapshot.digest) {
      return Object.freeze({
        check: check(
          "pack.state",
          "blocked",
          "pack-state-changed",
          "Installed pack state changed during diagnostics.",
          "Rerun doctor after pack activity stops.",
        ),
      });
    }
    return Object.freeze({
      check: check(
        "pack.state",
        "passed",
        "pack-state-valid",
        `Installed pack state is canonical and contains ${loaded.state.packs.length} pack record(s).`,
      ),
    });
  } catch {
    return Object.freeze({
      check: check(
        "pack.state",
        "blocked",
        "pack-state-invalid",
        "Installed pack state is malformed, noncanonical, or bound to another project identity.",
        "Do not run pack mutations; inspect the local state and recovery evidence first.",
      ),
    });
  }
}

async function inspectActivePackTransaction(
  root: CanonicalProjectRoot,
): Promise<DoctorCheck> {
  try {
    const snapshot = await readOptionalSnapshot(
      root,
      PACK_ACTIVE_TRANSACTION_PATH,
      PACK_ACTIVE_TRANSACTION_MAX_BYTES,
    );
    if (snapshot === undefined) {
      return check(
        "pack.transaction",
        "passed",
        "pack-transaction-clear",
        "No active pack transaction marker is present.",
      );
    }
    const projectId = projectIdFromSnapshot(snapshot);
    const active = await loadActivePackTransactionRecord({
      root,
      project: { id: projectId, identityDigest: root.identityDigest },
      maxDirectoryEntries: MAX_DIRECTORY_ENTRIES,
    });
    if (active === undefined) {
      return check(
        "pack.transaction",
        "blocked",
        "pack-transaction-changed",
        "The active pack transaction marker changed during diagnostics.",
        "Rerun doctor and reconcile the transaction before any pack mutation.",
      );
    }
    if (active.fileDigest !== snapshot.digest) {
      return check(
        "pack.transaction",
        "blocked",
        "pack-transaction-changed",
        "The active pack transaction marker changed during diagnostics.",
        "Rerun doctor and reconcile the transaction before any pack mutation.",
      );
    }
    return check(
      "pack.transaction",
      "blocked",
      "pack-transaction-active",
      "An attested active pack transaction requires recovery review.",
      "Inspect the transaction recovery report before requesting finalization.",
    );
  } catch {
    return check(
      "pack.transaction",
      "blocked",
      "pack-transaction-invalid",
      "The active pack transaction marker is malformed or cannot be safely inspected.",
      "Do not clear it manually; inspect the journal and recovery evidence first.",
    );
  }
}

function projectSummary(
  requestedPath: string,
  inspection: ProjectInspection,
): DoctorReport["project"] {
  if (inspection.root === undefined) {
    return Object.freeze({ requestedPath, state: inspection.state });
  }
  return Object.freeze({
    requestedPath,
    canonicalPath: inspection.root.canonicalPath,
    identityDigest: inspection.root.identityDigest,
    state: inspection.state,
  });
}

export async function runDoctor(
  input: unknown,
  options: DoctorRuntimeOptions = { nodeVersion: process.versions.node },
): Promise<DoctorReport> {
  const descriptor = doctorDescriptor();
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.input,
    input,
  ) as unknown as DoctorRequest;

  const checks: DoctorCheck[] = [
    inspectRegistry(),
    inspectNodeVersion(options.nodeVersion),
  ];
  const project = await inspectProjectState(request.projectRoot);
  checks.push(
    project.root === undefined
      ? project.check
      : check(
          "project.root",
          "passed",
          "project-root-bound",
          "The selected project root is safely bound to one directory identity.",
        ),
    project.root === undefined
      ? skipped(
          "project.state",
          "project-state-skipped",
          "Project state was not inspected because the project root is unavailable.",
        )
      : project.check,
  );

  if (project.root === undefined || project.state !== "ready") {
    checks.push(
      skipped(
        "pack.state",
        "pack-state-skipped",
        "Pack state was not inspected because the runtime layout is not ready.",
      ),
      skipped(
        "pack.transaction",
        "pack-transaction-skipped",
        "Pack transactions were not inspected because the runtime layout is not ready.",
      ),
    );
  } else {
    const installed = await inspectPackState(project.root);
    checks.push(installed.check, await inspectActivePackTransaction(project.root));
  }

  const report: DoctorReport = Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    commandId: "doctor",
    status: computeDoctorStatus(checks),
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: BUILTIN_REGISTRY.digest,
    project: projectSummary(request.projectRoot, project),
    checks: Object.freeze(checks),
  });
  return validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    descriptor.output,
    report,
  ) as unknown as DoctorReport;
}
