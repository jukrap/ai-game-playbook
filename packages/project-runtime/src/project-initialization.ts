import {
  assertProjectPackLockSemantics,
  canonicalizeJson,
  computeGameProjectIdentityDigest,
  computeInitPlanDigest,
  createEmptyProjectPackLock,
  digestCanonicalJson,
  gameProjectProfileSchema,
  isSha256Digest,
  projectPackLockSchema,
  sha256Digest,
  type ExecutionBudgets,
  type GameProjectProfile,
  type InitPlanTarget,
  type InitPlanTargetAction,
  type InitPlanTargetContent,
  type InitPlanTargetKind,
  type InitPlanTargetPolicy,
  type ProjectPackLock,
  type ProjectStage,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertProjectRootIdentity,
  planProjectInitialization,
  readProjectFileSnapshot,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  assertValidatedRegistry,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { ProjectRuntimeError } from "./errors.js";

export const PROJECT_INITIALIZATION_IGNORE_POLICY: string =
  "cache/\nevidence/\nlocal/\nlocks/\nlogs/\nscreenshots/\nstate/\n";
export const PROJECT_INITIALIZATION_MAX_METADATA_BYTES: number = 1024 * 1024;
export const PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES: number = 10_000;
export const PROJECT_INITIALIZATION_MAX_DURATION_MS: number = 30_000;
export const PROJECT_INITIALIZATION_MAX_OUTPUT_BYTES: number = 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROFILE_MAX_NODES = 4_096;
const PROFILE_MAX_DEPTH = 32;

type DataRecord = Record<string, unknown>;

export interface PrepareProjectInitializationRequest {
  readonly registry: ValidatedRegistry;
  readonly targetRoot: CanonicalProjectRoot;
  readonly expectedInitPlanDigest: Sha256Digest;
  readonly profile: unknown;
  readonly runId: string;
}

export interface PreparedProjectInitializationTarget {
  readonly path: InitPlanTarget["path"];
  readonly kind: InitPlanTargetKind;
  readonly policy: InitPlanTargetPolicy;
  readonly content: InitPlanTargetContent;
  readonly action: InitPlanTargetAction;
  readonly code: StableId;
  readonly desiredDigest?: Sha256Digest;
  readonly desiredBytes?: number;
}

export interface ProjectInitializationConflict {
  readonly code: StableId;
  readonly path: InitPlanTarget["path"];
}

export interface PreparedProjectInitialization {
  readonly schemaVersion: "1.0.0";
  readonly disposition: "blocked" | "no-op" | "ready";
  readonly runId: string;
  readonly registryDigest: Sha256Digest;
  readonly initPlanDigest: Sha256Digest;
  readonly project: {
    readonly id: StableId;
    readonly identityDigest: Sha256Digest;
    readonly rootIdentityDigest: Sha256Digest;
    readonly stage: ProjectStage;
  };
  readonly profileDigest: Sha256Digest;
  readonly packLockDigest: Sha256Digest;
  readonly targets: readonly PreparedProjectInitializationTarget[];
  readonly conflicts: readonly ProjectInitializationConflict[];
  readonly summary: {
    readonly create: number;
    readonly retain: number;
    readonly conflict: number;
  };
  readonly budgets: ExecutionBudgets;
  readonly preparedPlanDigest: Sha256Digest;
}

export interface PreparedProjectInitializationInternals {
  readonly registry: ValidatedRegistry;
  readonly targetRoot: CanonicalProjectRoot;
  readonly profile: GameProjectProfile;
  readonly packLock: ProjectPackLock;
  readonly contentByPath: ReadonlyMap<string, Uint8Array>;
}

const preparedInitializationInternals = new WeakMap<
  object,
  PreparedProjectInitializationInternals
>();

function fail(
  code: ConstructorParameters<typeof ProjectRuntimeError>[0],
  path: string,
  message: string,
): never {
  throw new ProjectRuntimeError(code, path, message);
}

function dataRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    fail(
      "invalid-project-initialization-request",
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
    fail(
      "invalid-project-initialization-request",
      path,
      "object properties must be enumerable data fields",
    );
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  keys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    !actual.every((key, index) => key === expected[index])
  ) {
    fail(
      "invalid-project-initialization-request",
      path,
      "request contains undeclared or missing fields",
    );
  }
}

function assertDataTree(
  value: unknown,
  path: string,
  state: { nodes: number },
  depth = 0,
): void {
  state.nodes += 1;
  if (state.nodes > PROFILE_MAX_NODES || depth > PROFILE_MAX_DEPTH) {
    throw new ProjectRuntimeError(
      "project-initialization-profile-invalid",
      path,
      "profile exceeds the bounded data-tree limit",
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(value);
    if (
      Object.getOwnPropertySymbols(value).length !== 0 ||
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index)) ||
      keys.some((key) => {
        const descriptor = descriptors[key];
        return (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        );
      })
    ) {
      throw new ProjectRuntimeError(
        "project-initialization-profile-invalid",
        path,
        "profile arrays must contain only enumerable data elements",
      );
    }
    for (let index = 0; index < value.length; index += 1) {
      assertDataTree(value[index], `${path}[${index}]`, state, depth + 1);
    }
    return;
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new ProjectRuntimeError(
      "project-initialization-profile-invalid",
      path,
      "profile contains a non-data value",
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || descriptor.enumerable !== true) {
      throw new ProjectRuntimeError(
        "project-initialization-profile-invalid",
        `${path}.${key}`,
        "profile properties must be enumerable data fields",
      );
    }
    assertDataTree(descriptor.value, `${path}.${key}`, state, depth + 1);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateProfile(
  registry: ValidatedRegistry,
  value: unknown,
): GameProjectProfile {
  try {
    assertDataTree(value, "$request.profile", { nodes: 0 });
    const text = canonicalizeJson(value);
    if (Buffer.byteLength(text, "utf8") > PROJECT_INITIALIZATION_MAX_METADATA_BYTES) {
      throw new RangeError("profile is too large");
    }
    const snapshot = JSON.parse(text) as unknown;
    const profile = validateRegisteredContractValue(
      registry,
      {
        schemaId: gameProjectProfileSchema.schemaId,
        digest: gameProjectProfileSchema.digest,
      },
      snapshot,
    ) as unknown as GameProjectProfile;
    const expectedIdentity = computeGameProjectIdentityDigest({
      projectId: profile.projectId,
      engine: { id: profile.engine.id, version: profile.engine.version },
    });
    if (
      profile.engine.projectIdentityDigest !== expectedIdentity ||
      profile.stage.effective === "ambiguous"
    ) {
      throw new TypeError("profile authority is incomplete");
    }
    return deepFreeze(profile);
  } catch (error) {
    if (
      error instanceof ProjectRuntimeError &&
      error.code === "project-initialization-profile-invalid"
    ) {
      throw error;
    }
    throw new ProjectRuntimeError(
      "project-initialization-profile-invalid",
      "$request.profile",
      "profile must be bounded, registered, identity-consistent, and non-ambiguous",
    );
  }
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

function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(`${canonicalizeJson(value)}\n`, "utf8");
}

async function retainedPackLock(
  registry: ValidatedRegistry,
  root: CanonicalProjectRoot,
  profile: GameProjectProfile,
): Promise<{ lock: ProjectPackLock; content: Uint8Array } | undefined> {
  let snapshot;
  try {
    snapshot = await readProjectFileSnapshot({
      root,
      path: ".ai-game-playbook/packs.lock.json",
      maxBytes: PROJECT_INITIALIZATION_MAX_METADATA_BYTES,
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
  } catch {
    return undefined;
  }
  const text = strictUtf8(snapshot.content);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    if (`${canonicalizeJson(parsed)}\n` !== text) return undefined;
    const schema = registry.schemas.find(
      ({ schemaId }) => schemaId === projectPackLockSchema.schemaId,
    );
    const lock =
      schema?.digest === projectPackLockSchema.digest
        ? (validateRegisteredContractValue(
            registry,
            {
              schemaId: projectPackLockSchema.schemaId,
              digest: projectPackLockSchema.digest,
            },
            parsed,
          ) as unknown as ProjectPackLock)
        : (parsed as ProjectPackLock);
    assertProjectPackLockSemantics(lock);
    if (
      lock.projectId !== profile.projectId ||
      lock.projectIdentityDigest !== profile.engine.projectIdentityDigest
    ) {
      return undefined;
    }
    return {
      lock: deepFreeze(lock),
      content: new Uint8Array(snapshot.content),
    };
  } catch {
    return undefined;
  }
}

function desiredTarget(
  target: InitPlanTarget,
  action: InitPlanTargetAction,
  code: StableId,
  content?: Uint8Array,
): PreparedProjectInitializationTarget {
  return Object.freeze({
    path: target.path,
    kind: target.kind,
    policy: target.policy,
    content: target.content,
    action,
    code,
    ...(content === undefined
      ? {}
      : {
          desiredDigest: sha256Digest(content),
          desiredBytes: content.byteLength,
        }),
  });
}

async function compareRetainedFile(
  root: CanonicalProjectRoot,
  target: InitPlanTarget,
  desired: Uint8Array,
): Promise<PreparedProjectInitializationTarget> {
  try {
    const actual = await readProjectFileSnapshot({
      root,
      path: target.path,
      maxBytes: PROJECT_INITIALIZATION_MAX_METADATA_BYTES,
      maxDirectoryEntries: PROJECT_INITIALIZATION_MAX_DIRECTORY_ENTRIES,
    });
    return actual.digest === sha256Digest(desired) &&
      Buffer.from(actual.content).equals(Buffer.from(desired))
      ? desiredTarget(target, "retain", target.code, desired)
      : desiredTarget(
          target,
          "conflict",
          "metadata-content-mismatch" as StableId,
          desired,
        );
  } catch {
    return desiredTarget(
      target,
      "conflict",
      "metadata-content-invalid" as StableId,
      desired,
    );
  }
}

function summaryOf(targets: readonly PreparedProjectInitializationTarget[]) {
  let create = 0;
  let retain = 0;
  let conflict = 0;
  for (const target of targets) {
    if (target.action === "create") create += 1;
    else if (target.action === "retain") retain += 1;
    else conflict += 1;
  }
  return Object.freeze({ create, retain, conflict });
}

function publicDigestInput(
  value: Omit<PreparedProjectInitialization, "preparedPlanDigest">,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/prepared-project-initialization",
    version: "1.0.0",
    ...value,
  });
}

function validateRequest(
  value: PrepareProjectInitializationRequest,
): PrepareProjectInitializationRequest {
  const record = dataRecord(value, "$request");
  exactKeys(
    record,
    [
      "registry",
      "targetRoot",
      "expectedInitPlanDigest",
      "profile",
      "runId",
    ],
    "$request",
  );
  try {
    assertValidatedRegistry(value.registry);
  } catch {
    fail(
      "invalid-project-initialization-request",
      "$request.registry",
      "registry must be validated in this process",
    );
  }
  if (!isSha256Digest(value.expectedInitPlanDigest)) {
    fail(
      "invalid-project-initialization-request",
      "$request.expectedInitPlanDigest",
      "expected init plan digest must be an exact SHA-256 digest",
    );
  }
  if (typeof value.runId !== "string" || !UUID_PATTERN.test(value.runId)) {
    fail(
      "invalid-project-initialization-request",
      "$request.runId",
      "run ID must be a canonical UUID",
    );
  }
  return value;
}

export function assertPreparedProjectInitialization(
  value: unknown,
): asserts value is PreparedProjectInitialization {
  if (
    value === null ||
    typeof value !== "object" ||
    !preparedInitializationInternals.has(value)
  ) {
    throw new ProjectRuntimeError(
      "project-initialization-plan-untrusted",
      "$plan",
      "project initialization requires a same-process prepared plan",
    );
  }
}

export function internalsForPreparedProjectInitialization(
  value: PreparedProjectInitialization,
): PreparedProjectInitializationInternals {
  assertPreparedProjectInitialization(value);
  return preparedInitializationInternals.get(value)!;
}

export async function prepareProjectInitialization(
  value: PrepareProjectInitializationRequest,
): Promise<PreparedProjectInitialization> {
  const request = validateRequest(value);
  await assertProjectRootIdentity(request.targetRoot);
  const plan = await planProjectInitialization({ root: request.targetRoot });
  const initPlanDigest = computeInitPlanDigest({
    registryDigest: request.registry.digest,
    projectIdentityDigest: plan.rootIdentityDigest,
    targets: plan.targets,
  });
  if (initPlanDigest !== request.expectedInitPlanDigest) {
    fail(
      "project-initialization-plan-stale",
      "$request.expectedInitPlanDigest",
      "reviewed initialization plan no longer matches the project",
    );
  }
  const profile = validateProfile(request.registry, request.profile);
  const profileContent = canonicalBytes(profile);
  const emptyPackLock = createEmptyProjectPackLock({
    projectId: profile.projectId,
    projectIdentityDigest: profile.engine.projectIdentityDigest,
  });
  const existingPackTarget = plan.targets.find(
    ({ content }) => content === "pack-lock",
  );
  const retained =
    existingPackTarget?.action === "retain"
      ? await retainedPackLock(request.registry, request.targetRoot, profile)
      : undefined;
  const packLock = retained?.lock ?? emptyPackLock;
  const packLockContent = retained?.content ?? canonicalBytes(packLock);
  const ignoreContent = Buffer.from(
    PROJECT_INITIALIZATION_IGNORE_POLICY,
    "utf8",
  );
  const contentByPath = new Map<string, Uint8Array>();
  const targets: PreparedProjectInitializationTarget[] = [];
  for (const target of plan.targets) {
    if (target.kind === "directory") {
      targets.push(desiredTarget(target, target.action, target.code));
      continue;
    }
    const content =
      target.content === "project-profile"
        ? profileContent
        : target.content === "pack-lock"
          ? packLockContent
          : ignoreContent;
    contentByPath.set(target.path, new Uint8Array(content));
    if (target.action === "conflict") {
      targets.push(desiredTarget(target, "conflict", target.code, content));
    } else if (
      target.content === "pack-lock" &&
      target.action === "retain" &&
      retained === undefined
    ) {
      targets.push(
        desiredTarget(
          target,
          "conflict",
          "metadata-content-invalid" as StableId,
          content,
        ),
      );
    } else if (target.action === "retain") {
      targets.push(
        await compareRetainedFile(request.targetRoot, target, content),
      );
    } else {
      targets.push(desiredTarget(target, "create", target.code, content));
    }
  }
  const summary = summaryOf(targets);
  const conflicts = Object.freeze(
    targets
      .filter(({ action }) => action === "conflict")
      .map(({ code, path }) => Object.freeze({ code, path })),
  );
  const disposition =
    conflicts.length > 0 ? "blocked" : summary.create > 0 ? "ready" : "no-op";
  const changedBytes = targets.reduce(
    (total, target) =>
      target.action === "create" ? total + (target.desiredBytes ?? 0) : total,
    0,
  );
  const rollbackByteBudget = changedBytes * 2;
  if (!Number.isSafeInteger(rollbackByteBudget)) {
    fail(
      "project-initialization-budget-exceeded",
      "$plan.budgets.maxChangedBytes",
      "project initialization byte budget exceeds safe accounting",
    );
  }
  const budgets: ExecutionBudgets = Object.freeze({
    maxChangedFiles: summary.create,
    maxChangedBytes: rollbackByteBudget,
    maxDurationMs: PROJECT_INITIALIZATION_MAX_DURATION_MS,
    maxOutputBytes: PROJECT_INITIALIZATION_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
  const profileDigest = digestCanonicalJson(profile);
  const draft: Omit<PreparedProjectInitialization, "preparedPlanDigest"> = {
    schemaVersion: "1.0.0",
    disposition,
    runId: request.runId,
    registryDigest: request.registry.digest,
    initPlanDigest,
    project: Object.freeze({
      id: profile.projectId,
      identityDigest: profile.engine.projectIdentityDigest,
      rootIdentityDigest: request.targetRoot.identityDigest,
      stage: profile.stage.effective as ProjectStage,
    }),
    profileDigest,
    packLockDigest: packLock.lockDigest,
    targets: Object.freeze(targets),
    conflicts,
    summary,
    budgets,
  };
  const prepared = deepFreeze({
    ...draft,
    preparedPlanDigest: publicDigestInput(draft),
  });
  preparedInitializationInternals.set(
    prepared,
    Object.freeze({
      registry: request.registry,
      targetRoot: request.targetRoot,
      profile,
      packLock,
      contentByPath,
    }),
  );
  await assertProjectRootIdentity(request.targetRoot);
  return prepared;
}
