import {
  ENGINE_STATUS_MAX_EXECUTABLE_BYTES,
  GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES,
  assertGodotExecutableDiscoveryReportSemantics,
  assertGodotExecutableDiscoveryRequestSemantics,
  canonicalizeJson,
  compareCanonicalText,
  computeGodotExecutableDiscoveryDigest,
  computeGodotExecutableDiscoveryStatus,
  digestCanonicalJson,
  godotExecutableDiscoveryReportSchema,
  godotExecutableDiscoveryRequestSchema,
  parseSemanticVersion,
  parseStableId,
  type EngineStatusReport,
  type EngineStatusRequest,
  type ExecutionBudgets,
  type GodotExecutableDiscoveryCandidate,
  type GodotExecutableDiscoveryCandidateSource,
  type GodotExecutableDiscoveryDigestInput,
  type GodotExecutableDiscoveryIssue,
  type GodotExecutableDiscoveryProject,
  type GodotExecutableDiscoveryReport,
  type GodotExecutableDiscoveryRequest,
  type OperatingSystem,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  assertAuthorizedPermissionDecision,
  assertProcessExecutableIdentity,
  assertProjectRootIdentity,
  bindProcessExecutable,
  canonicalizeProjectRoot,
  type AuthorizedPermissionDecision,
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
  type PermissionAuthorizationRequest,
  type PermissionSettlement,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, join, normalize, parse } from "node:path";

import { GodotAdapterBoundaryError } from "./errors.js";
import { runGodotEngineStatus } from "./status.js";

export const GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID: StableId =
  parseStableId("engine.executable-discovery");
export const GODOT_EXECUTABLE_DISCOVERY_COMMAND_TIMEOUT_MS: number = 10_000;
export const GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES: number = 1_048_576;

export interface PrepareGodotExecutableDiscoveryRequest {
  readonly runId: string;
  readonly projectId: StableId;
  readonly request: GodotExecutableDiscoveryRequest;
}

export interface PreparedGodotExecutableDiscovery {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "ready";
  readonly runId: string;
  readonly commandId: typeof GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID;
  readonly registryDigest: Sha256Digest;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly inspectionDigest: Sha256Digest;
    readonly statusDigest: Sha256Digest;
  };
  readonly sources: {
    readonly configuredPathCount: number;
    readonly pathDirectoryCount: number;
    readonly consideredPathCount: number;
    readonly sourceDigest: Sha256Digest;
  };
  readonly planDigest: Sha256Digest;
}

export interface CreateGodotExecutableDiscoveryAuthorizationRequest {
  readonly plan: PreparedGodotExecutableDiscovery;
  readonly deadlineAt: string;
}

export interface RunGodotExecutableDiscoveryRequest {
  readonly plan: PreparedGodotExecutableDiscovery;
  readonly authorization: AuthorizedPermissionDecision;
}

interface CandidatePath {
  readonly path: string;
  readonly sources: Set<GodotExecutableDiscoveryCandidateSource>;
}

interface CandidateSources {
  readonly configuredPaths: readonly string[];
  readonly pathDirectories: readonly string[];
  readonly paths: readonly CandidatePath[];
  readonly sourceDigest: Sha256Digest;
}

interface AcceptedCandidate {
  readonly executable: BoundProcessExecutable;
  readonly sources: Set<GodotExecutableDiscoveryCandidateSource>;
  acceptedPaths: number;
}

interface PreparedDiscoveryInternals {
  readonly request: GodotExecutableDiscoveryRequest;
  readonly root: CanonicalProjectRoot;
  readonly statusRequest: EngineStatusRequest;
  readonly sources: CandidateSources;
}

interface CompletedDiscoveryInternals {
  readonly candidates: ReadonlyMap<Sha256Digest, BoundProcessExecutable>;
}

interface IssueCollector {
  readonly add: (
    severity: GodotExecutableDiscoveryIssue["severity"],
    code: string,
    message: string,
    nextAction: string,
  ) => void;
  readonly finish: () => readonly GodotExecutableDiscoveryIssue[];
}

interface DiscoveryScan {
  readonly accepted: ReadonlyMap<Sha256Digest, AcceptedCandidate>;
  readonly acceptedPathCount: number;
  readonly missingPathCount: number;
  readonly rejectedPathCount: number;
  readonly capacityExceeded: boolean;
}

type DataRecord = Record<string, unknown>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const preparedDiscoveryInternals = new WeakMap<
  object,
  PreparedDiscoveryInternals
>();
const completedDiscoveryInternals = new WeakMap<
  object,
  CompletedDiscoveryInternals
>();
const candidateSourceOrder: readonly GodotExecutableDiscoveryCandidateSource[] =
  Object.freeze(["configured", "path"]);

function fail(code: string, message: string): never {
  throw new GodotAdapterBoundaryError(code, message);
}

function dataRecord(
  value: unknown,
  code: string,
  message: string,
): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    return fail(code, message);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) => !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    return fail(code, message);
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  required: readonly string[],
  code: string,
  message: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...required].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(code, message);
  }
}

function schemaReference(
  schema:
    | typeof godotExecutableDiscoveryRequestSchema
    | typeof godotExecutableDiscoveryReportSchema,
) {
  return Object.freeze({ schemaId: schema.schemaId, digest: schema.digest });
}

function canonicalTimestamp(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    !timestampPattern.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    fail(code, "Godot executable discovery deadline must be canonical UTC.");
  }
  return value;
}

function issueKey(issue: GodotExecutableDiscoveryIssue): string {
  return `${issue.severity}/${issue.code}`;
}

function createIssueCollector(): IssueCollector {
  const issues = new Map<string, GodotExecutableDiscoveryIssue>();
  return Object.freeze({
    add(
      severity: GodotExecutableDiscoveryIssue["severity"],
      code: string,
      message: string,
      nextAction: string,
    ): void {
      const issue: GodotExecutableDiscoveryIssue = Object.freeze({
        severity,
        code: parseStableId(code),
        message,
        nextAction,
      });
      const key = issueKey(issue);
      if (!issues.has(key)) issues.set(key, issue);
    },
    finish(): readonly GodotExecutableDiscoveryIssue[] {
      return Object.freeze(
        [...issues.values()].sort((left, right) =>
          compareCanonicalText(issueKey(left), issueKey(right)),
        ),
      );
    },
  });
}

function operatingSystem(): OperatingSystem {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  if (process.platform === "darwin") return "macos";
  return fail(
    "godot-discovery-platform-unsupported",
    "Godot executable discovery is unsupported on this operating system.",
  );
}

function executableNames(): readonly string[] {
  return process.platform === "win32"
    ? Object.freeze(["godot.exe", "godot4.exe"])
    : Object.freeze(["godot", "godot4"]);
}

function pathKey(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function localAbsolutePath(value: string, field: string): string {
  if (!isAbsolute(value)) {
    return fail(
      "godot-discovery-source-invalid",
      `${field} must contain only absolute local paths.`,
    );
  }
  const normalized = normalize(value);
  if (
    process.platform === "win32" &&
    (normalized.startsWith("\\\\") ||
      normalized.startsWith("\\\\?\\") ||
      normalized.startsWith("\\\\.\\"))
  ) {
    return fail(
      "godot-discovery-source-invalid",
      `${field} cannot select UNC or device paths.`,
    );
  }
  if (
    process.platform === "win32" &&
    normalized.slice(parse(normalized).root.length).includes(":")
  ) {
    return fail(
      "godot-discovery-source-invalid",
      `${field} cannot select alternate data streams.`,
    );
  }
  return normalized;
}

function normalizeUniquePaths(
  values: readonly string[],
  field: string,
): readonly string[] {
  const paths = new Map<string, string>();
  for (const value of values) {
    const normalized = localAbsolutePath(value, field);
    const key = pathKey(normalized);
    if (paths.has(key)) {
      fail(
        "godot-discovery-source-ambiguous",
        `${field} contains a platform-equivalent path collision.`,
      );
    }
    paths.set(key, normalized);
  }
  return Object.freeze(
    [...paths.values()].sort((left, right) =>
      compareCanonicalText(pathKey(left), pathKey(right)),
    ),
  );
}

function validateRequest(value: unknown): GodotExecutableDiscoveryRequest {
  const request = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotExecutableDiscoveryRequestSchema),
    value,
  ) as unknown as GodotExecutableDiscoveryRequest;
  assertGodotExecutableDiscoveryRequestSemantics(request);
  return request;
}

function candidatePaths(request: GodotExecutableDiscoveryRequest): CandidateSources {
  const configuredPaths = normalizeUniquePaths(
    request.sources.configuredPaths,
    "configuredPaths",
  );
  const pathDirectories = normalizeUniquePaths(
    request.sources.pathDirectories,
    "pathDirectories",
  );
  const paths = new Map<string, CandidatePath>();
  const add = (
    path: string,
    source: GodotExecutableDiscoveryCandidateSource,
  ): void => {
    const key = pathKey(path);
    const existing = paths.get(key);
    if (existing === undefined) {
      paths.set(key, { path, sources: new Set([source]) });
      return;
    }
    existing.sources.add(source);
  };
  for (const path of configuredPaths) add(path, "configured");
  const names = executableNames();
  for (const directory of pathDirectories) {
    for (const name of names) add(normalize(join(directory, name)), "path");
  }
  const ordered = Object.freeze(
    [...paths.values()].sort((left, right) =>
      compareCanonicalText(pathKey(left.path), pathKey(right.path)),
    ),
  );
  return Object.freeze({
    configuredPaths,
    pathDirectories,
    paths: ordered,
    sourceDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-executable-discovery-sources",
      version: "1.0.0",
      platform: operatingSystem(),
      executableNames: names,
      configuredPaths,
      pathDirectories,
    }),
  });
}

function statusRequestFor(
  request: GodotExecutableDiscoveryRequest,
): EngineStatusRequest {
  return Object.freeze({
    schemaVersion: parseSemanticVersion("1.0.0").value,
    projectRoot: request.projectRoot,
    engine: "godot",
  });
}

function projectObservation(
  requestedPath: string,
  status: EngineStatusReport,
): GodotExecutableDiscoveryProject {
  const ready =
    status.project.status === "detected" &&
    status.project.canonicalPath !== undefined &&
    status.project.rootIdentityDigest !== undefined &&
    status.project.inspectionDigest !== undefined &&
    status.compatibility.status === "major-minor-match";
  return Object.freeze({
    requestedPath,
    ready,
    ...(status.project.canonicalPath === undefined
      ? {}
      : { canonicalPath: status.project.canonicalPath }),
    ...(status.project.rootIdentityDigest === undefined
      ? {}
      : { rootIdentityDigest: status.project.rootIdentityDigest }),
    ...(status.project.inspectionDigest === undefined
      ? {}
      : { inspectionDigest: status.project.inspectionDigest }),
    statusDigest: status.statusDigest,
  });
}

function requireReadyProject(
  requestedPath: string,
  status: EngineStatusReport,
): Required<GodotExecutableDiscoveryProject> {
  const project = projectObservation(requestedPath, status);
  if (
    !project.ready ||
    project.canonicalPath === undefined ||
    project.rootIdentityDigest === undefined ||
    project.inspectionDigest === undefined
  ) {
    return fail(
      "godot-discovery-project-not-ready",
      "Static Godot project identity and target compatibility must be ready before host executable inspection.",
    );
  }
  return project as Required<GodotExecutableDiscoveryProject>;
}

function sameProjectStatus(
  left: EngineStatusReport,
  right: EngineStatusReport,
): boolean {
  return (
    left.statusDigest === right.statusDigest &&
    left.project.canonicalPath === right.project.canonicalPath &&
    left.project.rootIdentityDigest === right.project.rootIdentityDigest &&
    left.project.inspectionDigest === right.project.inspectionDigest &&
    left.project.candidate?.observationDigest ===
      right.project.candidate?.observationDigest
  );
}

function statusMatchesRoot(
  status: EngineStatusReport,
  root: CanonicalProjectRoot,
): boolean {
  return (
    status.project.canonicalPath === root.canonicalPath &&
    status.project.rootIdentityDigest === root.identityDigest
  );
}

function validatePreparationRequest(
  value: unknown,
): Readonly<PrepareGodotExecutableDiscoveryRequest> {
  const record = dataRecord(
    value,
    "godot-discovery-preparation-invalid",
    "Godot executable discovery preparation is malformed.",
  );
  exactKeys(
    record,
    ["projectId", "request", "runId"],
    "godot-discovery-preparation-invalid",
    "Godot executable discovery preparation contains undeclared fields.",
  );
  if (typeof record["runId"] !== "string" || !uuidPattern.test(record["runId"])) {
    fail(
      "godot-discovery-preparation-invalid",
      "Godot executable discovery requires one canonical run identity.",
    );
  }
  let projectId: StableId;
  try {
    projectId = parseStableId(record["projectId"]);
  } catch {
    return fail(
      "godot-discovery-preparation-invalid",
      "Godot executable discovery requires one stable project identity.",
    );
  }
  return Object.freeze({
    runId: record["runId"] as string,
    projectId,
    request: validateRequest(record["request"]),
  });
}

export async function prepareGodotExecutableDiscovery(
  value: unknown,
): Promise<PreparedGodotExecutableDiscovery> {
  const preparation = validatePreparationRequest(value);
  const sources = candidatePaths(preparation.request);
  const statusRequest = statusRequestFor(preparation.request);
  const firstStatus = await runGodotEngineStatus(statusRequest);
  requireReadyProject(preparation.request.projectRoot, firstStatus);
  const root = await canonicalizeProjectRoot(preparation.request.projectRoot);
  const secondStatus = await runGodotEngineStatus(statusRequest);
  const project = requireReadyProject(
    preparation.request.projectRoot,
    secondStatus,
  );
  if (
    !sameProjectStatus(firstStatus, secondStatus) ||
    !statusMatchesRoot(secondStatus, root)
  ) {
    fail(
      "godot-discovery-project-drift",
      "Godot project identity changed during executable discovery preparation.",
    );
  }
  await assertProjectRootIdentity(root);
  const body = Object.freeze({
    schemaVersion: "1.0.0" as const,
    disposition: "ready" as const,
    runId: preparation.runId,
    commandId: GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID,
    registryDigest: BUILTIN_REGISTRY.digest,
    project: Object.freeze({
      id: preparation.projectId,
      identityDigest: root.identityDigest,
      rootIdentityDigest: project.rootIdentityDigest,
      inspectionDigest: project.inspectionDigest,
      statusDigest: project.statusDigest,
    }),
    sources: Object.freeze({
      configuredPathCount: sources.configuredPaths.length,
      pathDirectoryCount: sources.pathDirectories.length,
      consideredPathCount: sources.paths.length,
      sourceDigest: sources.sourceDigest,
    }),
  });
  const plan: PreparedGodotExecutableDiscovery = Object.freeze({
    ...body,
    planDigest: digestCanonicalJson({
      domain: "ai-game-playbook/godot-executable-discovery-plan",
      version: "1.0.0",
      ...body,
    }),
  });
  preparedDiscoveryInternals.set(
    plan,
    Object.freeze({
      request: preparation.request,
      root,
      statusRequest,
      sources,
    }),
  );
  return plan;
}

function internalsForPlan(
  plan: PreparedGodotExecutableDiscovery,
): PreparedDiscoveryInternals {
  const internals =
    typeof plan === "object" && plan !== null
      ? preparedDiscoveryInternals.get(plan)
      : undefined;
  if (internals === undefined) {
    fail(
      "godot-discovery-plan-untrusted",
      "Godot executable discovery requires the original same-process prepared plan.",
    );
  }
  return internals;
}

function authorizationBudgets(): ExecutionBudgets {
  return Object.freeze({
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    maxDurationMs: GODOT_EXECUTABLE_DISCOVERY_COMMAND_TIMEOUT_MS,
    maxOutputBytes: GODOT_EXECUTABLE_DISCOVERY_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
}

export function createGodotExecutableDiscoveryAuthorizationRequest(
  value: unknown,
): PermissionAuthorizationRequest {
  const record = dataRecord(
    value,
    "godot-discovery-authorization-invalid",
    "Godot executable discovery authorization request is malformed.",
  );
  exactKeys(
    record,
    ["deadlineAt", "plan"],
    "godot-discovery-authorization-invalid",
    "Godot executable discovery authorization contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotExecutableDiscovery;
  const internals = internalsForPlan(plan);
  const deadlineAt = canonicalTimestamp(
    record["deadlineAt"],
    "godot-discovery-authorization-invalid",
  );
  return Object.freeze({
    runId: plan.runId,
    projectId: plan.project.id,
    projectIdentityDigest: plan.project.identityDigest,
    commandId: GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID,
    input: internals.request,
    scope: Object.freeze({
      paths: Object.freeze(["project.godot"]),
      objectIds: Object.freeze([plan.sources.sourceDigest]),
      destinations: Object.freeze([]),
      dataClasses: Object.freeze([]),
      changeKinds: Object.freeze([]),
      publishTargets: Object.freeze([]),
    }),
    budgets: authorizationBudgets(),
    deadlineAt,
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
    fail(
      "godot-discovery-authorization-invalid",
      "Godot executable discovery authorization is no longer active.",
    );
  }
}

function validateAuthorization(
  plan: PreparedGodotExecutableDiscovery,
  value: unknown,
): AuthorizedPermissionDecision {
  let authorization: AuthorizedPermissionDecision;
  try {
    assertAuthorizedPermissionDecision(value);
    authorization = value;
  } catch {
    return fail(
      "godot-discovery-authorization-invalid",
      "Godot executable discovery authorization must come from the active permission broker.",
    );
  }
  assertAuthorizationActive(authorization);
  const command = BUILTIN_REGISTRY.commands.find(
    ({ id }) => id === GODOT_EXECUTABLE_DISCOVERY_COMMAND_ID,
  );
  if (
    command === undefined ||
    command.lifecycle !== "internal" ||
    command.lane !== "parallel-read" ||
    command.permissions.length !== 2 ||
    command.permissions[0] !== "read-project" ||
    command.permissions[1] !== "host-tool-inspection" ||
    command.sideEffects.length !== 1 ||
    command.sideEffects[0]?.kind !== "none" ||
    command.sideEffects[0]?.scope !== "godot-executable-discovery" ||
    command.sideEffects[0]?.boundary !== "local" ||
    command.timeoutMs !== GODOT_EXECUTABLE_DISCOVERY_COMMAND_TIMEOUT_MS ||
    command.cancellation.mode !== "not-applicable" ||
    command.retry.mode !== "never" ||
    command.retry.maxAttempts !== 1 ||
    command.handler.package !== "@ai-game-playbook/godot-adapter" ||
    command.handler.export !== "runGodotExecutableDiscovery"
  ) {
    fail(
      "godot-discovery-authorization-invalid",
      "Registered Godot executable discovery authority does not match its runtime boundary.",
    );
  }
  const internals = internalsForPlan(plan);
  const expected = createGodotExecutableDiscoveryAuthorizationRequest({
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
    challenge.inputDigest !== digestCanonicalJson(internals.request) ||
    challenge.permissions.length !== 2 ||
    challenge.permissions[0]?.permission !== "host-tool-inspection" ||
    challenge.permissions[0]?.mode !== "approval-required" ||
    challenge.permissions[1]?.permission !== "read-project" ||
    challenge.permissions[1]?.mode !== "automatic" ||
    challenge.feature !== undefined ||
    challenge.workflow !== undefined ||
    challenge.editorSessionIdentityDigest !== undefined ||
    canonicalizeJson(challenge.scope) !== canonicalizeJson(expected.scope) ||
    canonicalizeJson(challenge.budgets) !== canonicalizeJson(expected.budgets) ||
    authorization.lease.commandId !== command.id ||
    authorization.lease.projectId !== plan.project.id ||
    authorization.lease.requestDigest !== challenge.requestDigest ||
    authorization.lease.grantIds.length !== 1
  ) {
    fail(
      "godot-discovery-authorization-invalid",
      "Godot executable discovery authorization is not exactly bound to the prepared plan.",
    );
  }
  return authorization;
}

function validateRunRequest(value: unknown): {
  readonly plan: PreparedGodotExecutableDiscovery;
  readonly authorization: AuthorizedPermissionDecision;
  readonly internals: PreparedDiscoveryInternals;
} {
  const record = dataRecord(
    value,
    "godot-discovery-execution-invalid",
    "Godot executable discovery execution request is malformed.",
  );
  exactKeys(
    record,
    ["authorization", "plan"],
    "godot-discovery-execution-invalid",
    "Godot executable discovery execution contains undeclared fields.",
  );
  const plan = record["plan"] as PreparedGodotExecutableDiscovery;
  const internals = internalsForPlan(plan);
  const authorization = validateAuthorization(plan, record["authorization"]);
  return Object.freeze({ plan, authorization, internals });
}

async function assertPlanStable(
  plan: PreparedGodotExecutableDiscovery,
  internals: PreparedDiscoveryInternals,
): Promise<Required<GodotExecutableDiscoveryProject>> {
  await assertProjectRootIdentity(internals.root);
  const status = await runGodotEngineStatus(internals.statusRequest);
  const project = requireReadyProject(internals.request.projectRoot, status);
  if (
    project.statusDigest !== plan.project.statusDigest ||
    project.rootIdentityDigest !== plan.project.rootIdentityDigest ||
    project.inspectionDigest !== plan.project.inspectionDigest ||
    !statusMatchesRoot(status, internals.root)
  ) {
    fail(
      "godot-discovery-project-drift",
      "Godot project identity changed after executable discovery was prepared.",
    );
  }
  await assertProjectRootIdentity(internals.root);
  return project;
}

function missingError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT") ||
    (error instanceof CoreBoundaryError &&
      error.code === "process-executable-not-found")
  );
}

function candidateSources(
  values: ReadonlySet<GodotExecutableDiscoveryCandidateSource>,
): readonly GodotExecutableDiscoveryCandidateSource[] {
  return Object.freeze(candidateSourceOrder.filter((source) => values.has(source)));
}

function reportCandidate(
  candidate: AcceptedCandidate,
): GodotExecutableDiscoveryCandidate {
  return Object.freeze({
    label: basename(candidate.executable.canonicalPath),
    platform: operatingSystem(),
    sources: candidateSources(candidate.sources),
    bytes: candidate.executable.size,
    digest: candidate.executable.digest,
    identityDigest: candidate.executable.identityDigest,
  });
}

async function scanCandidates(sources: CandidateSources): Promise<DiscoveryScan> {
  let acceptedPathCount = 0;
  let missingPathCount = 0;
  let rejectedPathCount = 0;
  let capacityExceeded = false;
  const accepted = new Map<Sha256Digest, AcceptedCandidate>();

  for (const candidate of sources.paths) {
    let executable: BoundProcessExecutable;
    try {
      const canonicalCandidate = await realpath(candidate.path);
      executable = await bindProcessExecutable({
        path: canonicalCandidate,
        maxBytes: ENGINE_STATUS_MAX_EXECUTABLE_BYTES,
        allowedEnvironmentKeys: Object.freeze([]),
      });
    } catch (error) {
      if (missingError(error)) missingPathCount += 1;
      else rejectedPathCount += 1;
      continue;
    }
    acceptedPathCount += 1;
    const existing = accepted.get(executable.identityDigest);
    if (existing !== undefined) {
      for (const source of candidate.sources) existing.sources.add(source);
      existing.acceptedPaths += 1;
      continue;
    }
    if (accepted.size >= GODOT_EXECUTABLE_DISCOVERY_MAX_CANDIDATES) {
      capacityExceeded = true;
      continue;
    }
    accepted.set(executable.identityDigest, {
      executable,
      sources: new Set(candidate.sources),
      acceptedPaths: 1,
    });
  }

  for (const [identity, candidate] of [...accepted.entries()]) {
    try {
      await assertProcessExecutableIdentity(candidate.executable);
    } catch {
      accepted.delete(identity);
      acceptedPathCount -= candidate.acceptedPaths;
      rejectedPathCount += candidate.acceptedPaths;
    }
  }
  return Object.freeze({
    accepted,
    acceptedPathCount,
    missingPathCount,
    rejectedPathCount,
    capacityExceeded,
  });
}

function emptyEffects(durationMs: number) {
  return {
    changedPaths: Object.freeze([]),
    changedBytes: 0,
    objectIds: Object.freeze([]),
    destinations: Object.freeze([]),
    dataClasses: Object.freeze([]),
    changeKinds: Object.freeze([]),
    publishTargets: Object.freeze([]),
    durationMs,
    outputBytes: 0,
    repairCycles: 0,
  };
}

function settle(
  authorization: AuthorizedPermissionDecision,
  outcome: "succeeded" | "failed",
  durationMs: number,
): PermissionSettlement {
  try {
    return authorization.lease.settle({
      outcome,
      mutationUncertain: false,
      actual: emptyEffects(durationMs),
    });
  } catch {
    return fail(
      "godot-discovery-settlement-failed",
      "Godot executable discovery could not settle its permission authority.",
    );
  }
}

function validateReport(
  report: GodotExecutableDiscoveryReport,
): GodotExecutableDiscoveryReport {
  const validated = validateRegisteredContractValue(
    BUILTIN_REGISTRY,
    schemaReference(godotExecutableDiscoveryReportSchema),
    report,
  ) as unknown as GodotExecutableDiscoveryReport;
  assertGodotExecutableDiscoveryReportSemantics(validated);
  return validated;
}

function reportFrom(
  plan: PreparedGodotExecutableDiscovery,
  project: Required<GodotExecutableDiscoveryProject>,
  scan: DiscoveryScan,
  settlement: PermissionSettlement,
  grantIds: readonly StableId[],
): GodotExecutableDiscoveryReport {
  if (settlement.status !== "succeeded") {
    return fail(
      "godot-discovery-scope-violation",
      "Godot executable discovery exceeded its approved scope or budget.",
    );
  }
  const issues = createIssueCollector();
  if (scan.rejectedPathCount > 0) {
    issues.add(
      "attention",
      "godot-executable-candidate-rejected",
      "One or more exact executable candidates could not be bound safely.",
      "Use stable local regular executables without identity conflicts.",
    );
  }
  if (scan.accepted.size === 0) {
    issues.add(
      "attention",
      "godot-executable-not-found",
      "No bounded Godot executable candidate was found in the approved sources.",
      "Approve one exact executable path or a bounded set of PATH directories.",
    );
  } else if (scan.accepted.size > 1) {
    issues.add(
      "attention",
      "godot-executable-selection-required",
      "More than one distinct executable candidate was found.",
      "Select one candidate identity before preparing a version process.",
    );
  }
  if (scan.capacityExceeded) {
    issues.add(
      "blocked",
      "godot-executable-capacity-exceeded",
      "Executable discovery exceeded the bounded unique candidate capacity.",
      "Reduce approved sources before selecting an executable candidate.",
    );
  }
  const candidates = Object.freeze(
    [...scan.accepted.values()]
      .map(reportCandidate)
      .sort((left, right) =>
        compareCanonicalText(left.identityDigest, right.identityDigest),
      ),
  );
  const finalizedIssues = issues.finish();
  const sourceSummary = Object.freeze({
    configuredPathCount: plan.sources.configuredPathCount,
    pathDirectoryCount: plan.sources.pathDirectoryCount,
    consideredPathCount: plan.sources.consideredPathCount,
    acceptedPathCount: scan.acceptedPathCount,
    missingPathCount: scan.missingPathCount,
    rejectedPathCount: scan.rejectedPathCount,
    acceptedCandidateCount: candidates.length,
    sourceDigest: plan.sources.sourceDigest,
  });
  const authorization = Object.freeze({
    authorizationId: settlement.authorizationId,
    requestDigest: settlement.requestDigest,
    permission: "host-tool-inspection" as const,
    grantIds: Object.freeze([...grantIds]),
    status: "succeeded" as const,
    durationMs: settlement.actual.durationMs,
    settledAt: settlement.settledAt,
  });
  const digestInput: GodotExecutableDiscoveryDigestInput = Object.freeze({
    controlPlaneVersion: BUILTIN_REGISTRY.controlPlaneVersion,
    registryDigest: plan.registryDigest,
    engine: "godot",
    project,
    sources: sourceSummary,
    candidates,
    issues: finalizedIssues,
    authorization,
  });
  const status = computeGodotExecutableDiscoveryStatus(finalizedIssues);
  const report = validateReport(
    Object.freeze({
      schemaVersion: parseSemanticVersion("1.0.0").value,
      commandId: "engine.executable-discovery",
      ...digestInput,
      status,
      discoveryDigest: computeGodotExecutableDiscoveryDigest(digestInput),
      candidateSelectionAvailable:
        project.ready && status !== "blocked" && candidates.length > 0,
      executionAuthorityGranted: false,
      rawPathsDisclosed: false,
      recursiveSearchPerformed: false,
      mutationPerformed: false,
      externalProcessStarted: false,
      networkAccessPerformed: false,
      installPerformed: false,
    }),
  );
  completedDiscoveryInternals.set(
    report,
    Object.freeze({
      candidates: new Map(
        [...scan.accepted.entries()].map(([identity, candidate]) => [
          identity,
          candidate.executable,
        ]),
      ),
    }),
  );
  return report;
}

function durationSince(startedAt: number): number {
  return Math.max(0, Math.ceil(performance.now() - startedAt));
}

export async function runGodotExecutableDiscovery(
  value: unknown,
): Promise<GodotExecutableDiscoveryReport> {
  const request = validateRunRequest(value);
  const startedAt = performance.now();
  try {
    const firstProject = await assertPlanStable(request.plan, request.internals);
    assertAuthorizationActive(request.authorization);
    const scan = await scanCandidates(request.internals.sources);
    const secondProject = await assertPlanStable(request.plan, request.internals);
    if (
      firstProject.statusDigest !== secondProject.statusDigest ||
      firstProject.rootIdentityDigest !== secondProject.rootIdentityDigest ||
      firstProject.inspectionDigest !== secondProject.inspectionDigest
    ) {
      fail(
        "godot-discovery-project-drift",
        "Godot project identity changed during executable discovery.",
      );
    }
    for (const candidate of scan.accepted.values()) {
      await assertProcessExecutableIdentity(candidate.executable);
    }
    assertAuthorizationActive(request.authorization);
    const settlement = settle(
      request.authorization,
      "succeeded",
      durationSince(startedAt),
    );
    return reportFrom(
      request.plan,
      secondProject,
      scan,
      settlement,
      request.authorization.lease.grantIds,
    );
  } catch (error) {
    if (request.authorization.lease.state === "active") {
      settle(request.authorization, "failed", durationSince(startedAt));
    }
    if (error instanceof GodotAdapterBoundaryError) throw error;
    if (error instanceof CoreBoundaryError) {
      throw new GodotAdapterBoundaryError(
        "godot-discovery-runtime-failed",
        "Godot executable discovery could not preserve its bounded host identity checks.",
        error.mutationUncertain,
      );
    }
    throw new GodotAdapterBoundaryError(
      "godot-discovery-runtime-failed",
      "Godot executable discovery failed before producing a trusted report.",
    );
  }
}

export async function selectedGodotDiscoveryExecutable(
  report: GodotExecutableDiscoveryReport,
  identityDigest: Sha256Digest,
): Promise<BoundProcessExecutable> {
  const internals =
    typeof report === "object" && report !== null
      ? completedDiscoveryInternals.get(report)
      : undefined;
  if (internals === undefined) {
    return fail(
      "godot-discovery-report-untrusted",
      "Godot executable selection requires the original same-process discovery report.",
    );
  }
  assertGodotExecutableDiscoveryReportSemantics(report);
  if (!report.candidateSelectionAvailable) {
    return fail(
      "godot-discovery-selection-unavailable",
      "Godot executable discovery did not produce a selectable candidate set.",
    );
  }
  const reported = report.candidates.find(
    (candidate) => candidate.identityDigest === identityDigest,
  );
  const executable = internals.candidates.get(identityDigest);
  if (
    reported === undefined ||
    executable === undefined ||
    reported.digest !== executable.digest ||
    reported.bytes !== executable.size
  ) {
    return fail(
      "godot-discovery-candidate-untrusted",
      "Selected Godot executable identity is not present in the discovery authority.",
    );
  }
  await assertProcessExecutableIdentity(executable);
  return executable;
}
