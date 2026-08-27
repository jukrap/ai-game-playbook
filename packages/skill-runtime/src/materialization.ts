import {
  digestCanonicalJson,
  parsePortableProjectPath,
  parseStableId,
  type ExecutionBudgets,
  type PortableProjectPath,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  resolveProjectPath,
  type CanonicalProjectRoot,
  type FilesystemIdentity,
  type ResolvedProjectPath,
} from "@ai-game-playbook/core";
import { types as utilTypes } from "node:util";

import { SkillRuntimeBoundaryError } from "./errors.js";
import {
  assertProjectSkillPlanRuntimeCurrent,
  inspectProjectSkillTargets,
  packageSourceRootForSkillPlan,
  projectRootForSkillPlan,
  type ProjectSkillPlan,
  type ProjectSkillTarget,
} from "./runtime.js";

export const SKILL_MATERIALIZATION_MAX_DURATION_MS = 30_000;
export const SKILL_MATERIALIZATION_MAX_OUTPUT_BYTES = 1_048_576;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type ProjectSkillMaterializationAction =
  | "conflict"
  | "create"
  | "retain";

export interface PrepareProjectSkillMaterializationRequest {
  readonly plan: ProjectSkillPlan;
  readonly runId: string;
}

export interface PreparedProjectSkillMaterializationDirectory {
  readonly path: PortableProjectPath;
  readonly action: ProjectSkillMaterializationAction;
  readonly code: StableId;
}

export interface PreparedProjectSkillMaterializationTarget {
  readonly id: StableId;
  readonly name: string;
  readonly targetPath: PortableProjectPath;
  readonly artifactDigest: Sha256Digest;
  readonly desiredBytes: number;
  readonly action: ProjectSkillMaterializationAction;
  readonly code: StableId;
}

export interface ProjectSkillMaterializationConflict {
  readonly path: PortableProjectPath;
  readonly code: StableId;
  readonly id?: StableId;
}

export interface PreparedProjectSkillMaterialization {
  readonly schemaVersion: "1.0.0";
  readonly runId: string;
  readonly registryDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly sourcePlanDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly observationDigest: Sha256Digest;
  readonly disposition: "blocked" | "no-op" | "ready";
  readonly directories: readonly PreparedProjectSkillMaterializationDirectory[];
  readonly targets: readonly PreparedProjectSkillMaterializationTarget[];
  readonly conflicts: readonly ProjectSkillMaterializationConflict[];
  readonly summary: {
    readonly createDirectories: number;
    readonly retainDirectories: number;
    readonly createFiles: number;
    readonly retainFiles: number;
    readonly conflicts: number;
  };
  readonly budgets: ExecutionBudgets;
  readonly preparedDigest: Sha256Digest;
  readonly mutationPerformed: false;
}

interface PreparedProjectSkillMaterializationState {
  readonly plan: ProjectSkillPlan;
  readonly root: CanonicalProjectRoot;
  readonly desiredContentByPath: ReadonlyMap<PortableProjectPath, Uint8Array>;
  readonly observationDigest: Sha256Digest;
}

interface DirectoryObservation {
  readonly public: PreparedProjectSkillMaterializationDirectory;
  readonly witness: object;
}

interface TargetObservation {
  readonly public: PreparedProjectSkillMaterializationTarget;
  readonly witness: object;
}

interface MaterializationObservation {
  readonly directories: readonly DirectoryObservation[];
  readonly targets: readonly TargetObservation[];
  readonly digest: Sha256Digest;
}

type DataRecord = Record<string, unknown>;

const preparedStates = new WeakMap<
  object,
  PreparedProjectSkillMaterializationState
>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(
  code: ConstructorParameters<typeof SkillRuntimeBoundaryError>[0],
  message: string,
): never {
  throw new SkillRuntimeBoundaryError(code, message);
}

function requestRecord(value: unknown): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value)
  ) {
    fail(
      "skill-runtime-materialization-request-invalid",
      "Skill materialization preparation requires a plain data request.",
    );
  }
  try {
    if (
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0
    ) {
      throw new TypeError("not a plain data object");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== "plan" ||
      keys[1] !== "runId" ||
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("request fields are not exact data properties");
    }
    return Object.freeze({
      plan: descriptors["plan"]?.value,
      runId: descriptors["runId"]?.value,
    });
  } catch (error) {
    if (error instanceof SkillRuntimeBoundaryError) throw error;
    fail(
      "skill-runtime-materialization-request-invalid",
      "Skill materialization preparation request fields are invalid.",
    );
  }
}

function validateRequest(
  value: unknown,
): PrepareProjectSkillMaterializationRequest {
  const record = requestRecord(value);
  const runId = record["runId"];
  if (typeof runId !== "string" || !UUID_PATTERN.test(runId)) {
    fail(
      "skill-runtime-materialization-request-invalid",
      "Skill materialization run ID must be a canonical UUID.",
    );
  }
  const plan = record["plan"] as ProjectSkillPlan;
  projectRootForSkillPlan(plan);
  return Object.freeze({ plan, runId });
}

function identity(value: FilesystemIdentity): object {
  return Object.freeze({ device: value.device, inode: value.inode });
}

function resolvedWitness(value: ResolvedProjectPath): object {
  return Object.freeze({
    kind: value.kind,
    parentIdentity: identity(value.parentIdentity),
    ...(value.targetIdentity === undefined
      ? {}
      : { targetIdentity: identity(value.targetIdentity) }),
  });
}

function directoryPaths(
  targets: readonly ProjectSkillTarget[],
): readonly PortableProjectPath[] {
  const paths: PortableProjectPath[] = [
    parsePortableProjectPath(".agents"),
    parsePortableProjectPath(".agents/skills"),
  ];
  const seen = new Set<string>(paths);
  for (const target of targets) {
    const expectedTarget = parsePortableProjectPath(
      `.agents/skills/${target.name}/SKILL.md`,
    );
    if (target.targetPath !== expectedTarget) {
      fail(
        "skill-runtime-materialization-drift",
        "Skill target routing changed after planning.",
      );
    }
    const path = parsePortableProjectPath(`.agents/skills/${target.name}`);
    if (seen.has(path)) {
      fail(
        "skill-runtime-materialization-drift",
        "Skill materialization directories are ambiguous.",
      );
    }
    seen.add(path);
    paths.push(path);
  }
  return Object.freeze(paths);
}

function parentDirectory(path: PortableProjectPath): PortableProjectPath | undefined {
  const index = path.lastIndexOf("/");
  return index === -1
    ? undefined
    : parsePortableProjectPath(path.slice(0, index));
}

async function observeDirectories(
  root: CanonicalProjectRoot,
  targets: readonly ProjectSkillTarget[],
): Promise<readonly DirectoryObservation[]> {
  const observations: DirectoryObservation[] = [];
  const byPath = new Map<PortableProjectPath, DirectoryObservation>();
  for (const path of directoryPaths(targets)) {
    const parent = parentDirectory(path);
    const parentObservation =
      parent === undefined ? undefined : byPath.get(parent);
    let observation: DirectoryObservation;
    if (parentObservation?.public.action === "create") {
      const code = parseStableId("skill-directory-create");
      observation = {
        public: Object.freeze({ path, action: "create", code }),
        witness: Object.freeze({
          path,
          action: "create",
          code,
          basis: "missing-ancestor",
          ancestor: parent,
        }),
      };
    } else if (parentObservation?.public.action === "conflict") {
      const code = parseStableId("skill-directory-unsafe");
      observation = {
        public: Object.freeze({ path, action: "conflict", code }),
        witness: Object.freeze({
          path,
          action: "conflict",
          code,
          basis: "unsafe-ancestor",
          ancestor: parent,
        }),
      };
    } else {
      try {
        const resolved = await resolveProjectPath(root, path, {
          expectedType: "directory",
          existence: "optional",
        });
        const action = resolved.kind === "absent" ? "create" : "retain";
        const code = parseStableId(
          action === "create"
            ? "skill-directory-create"
            : "skill-directory-retain",
        );
        observation = {
          public: Object.freeze({ path, action, code }),
          witness: Object.freeze({
            path,
            action,
            code,
            basis: "observed",
            resolution: resolvedWitness(resolved),
          }),
        };
      } catch {
        const code = parseStableId("skill-directory-unsafe");
        observation = {
          public: Object.freeze({ path, action: "conflict", code }),
          witness: Object.freeze({
            path,
            action: "conflict",
            code,
            basis: "observation-failed",
          }),
        };
      }
    }
    observations.push(Object.freeze(observation));
    byPath.set(path, observation);
  }
  return Object.freeze(observations);
}

function targetResult(
  target: ProjectSkillTarget,
  action: ProjectSkillMaterializationAction,
  code: StableId,
): PreparedProjectSkillMaterializationTarget {
  return Object.freeze({
    id: target.id,
    name: target.name,
    targetPath: target.targetPath,
    artifactDigest: target.artifactDigest,
    desiredBytes: Buffer.byteLength(target.content, "utf8"),
    action,
    code,
  });
}

async function observeTargets(
  root: CanonicalProjectRoot,
  plan: ProjectSkillPlan,
  directories: readonly DirectoryObservation[],
): Promise<readonly TargetObservation[]> {
  const inspection = await inspectProjectSkillTargets(plan);
  const directoryByPath = new Map(
    directories.map((entry) => [entry.public.path, entry] as const),
  );
  const observations: TargetObservation[] = [];
  for (let index = 0; index < plan.targets.length; index += 1) {
    const target = plan.targets[index];
    const check = inspection.checks[index];
    if (target === undefined || check === undefined || check.id !== target.id) {
      fail(
        "skill-runtime-materialization-drift",
        "Skill target inspection no longer matches the planned catalog.",
      );
    }
    const directory = directoryByPath.get(
      parsePortableProjectPath(`.agents/skills/${target.name}`),
    );
    let result: PreparedProjectSkillMaterializationTarget;
    let witness: object;
    if (directory?.public.action === "create") {
      const consistent = check.targetStatus === "missing";
      const action = consistent ? "create" : "conflict";
      const code = consistent
        ? check.code
        : parseStableId("skill-target-unsafe");
      result = targetResult(target, action, code);
      witness = Object.freeze({
        ...result,
        observedStatus: check.targetStatus,
        basis: consistent ? "missing-ancestor" : "inconsistent-observation",
      });
    } else if (directory?.public.action === "conflict") {
      const code = parseStableId("skill-target-unsafe");
      result = targetResult(target, "conflict", code);
      witness = Object.freeze({
        ...result,
        observedStatus: check.targetStatus,
        basis: "unsafe-ancestor",
      });
    } else {
      try {
        const resolved = await resolveProjectPath(root, target.targetPath, {
          expectedType: "file",
          existence: "optional",
        });
        const consistent =
          (resolved.kind === "absent" && check.targetStatus === "missing") ||
          (resolved.kind === "file" &&
            (check.targetStatus === "current" ||
              check.targetStatus === "conflict"));
        const action = !consistent
          ? "conflict"
          : check.targetStatus === "missing"
            ? "create"
            : check.targetStatus === "current"
              ? "retain"
              : "conflict";
        const code = consistent
          ? check.code
          : parseStableId("skill-target-unsafe");
        result = targetResult(target, action, code);
        witness = Object.freeze({
          ...result,
          observedStatus: check.targetStatus,
          ...(check.actualDigest === undefined
            ? {}
            : {
                actualDigest: check.actualDigest,
                actualBytes: check.bytes,
              }),
          basis: consistent ? "observed" : "inconsistent-observation",
          resolution: resolvedWitness(resolved),
        });
      } catch {
        const code = parseStableId("skill-target-unsafe");
        result = targetResult(target, "conflict", code);
        witness = Object.freeze({
          ...result,
          observedStatus: check.targetStatus,
          basis: "observation-failed",
        });
      }
    }
    observations.push(Object.freeze({ public: result, witness }));
  }
  return Object.freeze(observations);
}

async function observeMaterialization(
  root: CanonicalProjectRoot,
  plan: ProjectSkillPlan,
): Promise<MaterializationObservation> {
  const directories = await observeDirectories(root, plan.targets);
  const targets = await observeTargets(root, plan, directories);
  const digest = digestCanonicalJson({
    domain: "ai-game-playbook/skill-materialization-observation",
    version: "1.0.0",
    projectIdentityDigest: plan.project.identityDigest,
    planDigest: plan.planDigest,
    directories: directories.map(({ witness }) => witness),
    targets: targets.map(({ witness }) => witness),
  });
  return Object.freeze({ directories, targets, digest });
}

function conflictList(
  observation: MaterializationObservation,
): readonly ProjectSkillMaterializationConflict[] {
  return Object.freeze([
    ...observation.directories
      .filter(({ public: entry }) => entry.action === "conflict")
      .map(({ public: entry }) =>
        Object.freeze({ path: entry.path, code: entry.code }),
      ),
    ...observation.targets
      .filter(({ public: entry }) => entry.action === "conflict")
      .map(({ public: entry }) =>
        Object.freeze({
          path: entry.targetPath,
          code: entry.code,
          id: entry.id,
        }),
      ),
  ]);
}

function preparedDigestInput(
  value: Omit<PreparedProjectSkillMaterialization, "preparedDigest">,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/prepared-skill-materialization",
    version: "1.0.0",
    ...value,
  });
}

export function assertPreparedProjectSkillMaterialization(
  value: unknown,
): asserts value is PreparedProjectSkillMaterialization {
  if (
    value === null ||
    typeof value !== "object" ||
    !preparedStates.has(value)
  ) {
    fail(
      "skill-runtime-materialization-plan-invalid",
      "Skill materialization requires a same-process prepared plan.",
    );
  }
}

export function internalsForPreparedProjectSkillMaterialization(
  value: PreparedProjectSkillMaterialization,
): {
  readonly plan: ProjectSkillPlan;
  readonly targetRoot: CanonicalProjectRoot;
  readonly sourceRoot: CanonicalProjectRoot;
} {
  assertPreparedProjectSkillMaterialization(value);
  const state = preparedStates.get(value);
  if (state === undefined) {
    fail(
      "skill-runtime-materialization-plan-invalid",
      "Skill materialization requires a same-process prepared plan.",
    );
  }
  return Object.freeze({
    plan: state.plan,
    targetRoot: state.root,
    sourceRoot: packageSourceRootForSkillPlan(state.plan),
  });
}

export async function prepareProjectSkillMaterialization(
  value: PrepareProjectSkillMaterializationRequest,
): Promise<PreparedProjectSkillMaterialization> {
  const request = validateRequest(value);
  const root = projectRootForSkillPlan(request.plan);
  await assertProjectSkillPlanRuntimeCurrent(request.plan);
  const first = await observeMaterialization(root, request.plan);
  const second = await observeMaterialization(root, request.plan);
  if (first.digest !== second.digest) {
    fail(
      "skill-runtime-materialization-drift",
      "Skill targets changed while materialization was being prepared.",
    );
  }
  await assertProjectSkillPlanRuntimeCurrent(request.plan);

  const directories = Object.freeze(
    second.directories.map(({ public: entry }) => entry),
  );
  const targets = Object.freeze(
    second.targets.map(({ public: entry }) => entry),
  );
  const conflicts = conflictList(second);
  const summary = Object.freeze({
    createDirectories: directories.filter(({ action }) => action === "create")
      .length,
    retainDirectories: directories.filter(({ action }) => action === "retain")
      .length,
    createFiles: targets.filter(({ action }) => action === "create").length,
    retainFiles: targets.filter(({ action }) => action === "retain").length,
    conflicts: conflicts.length,
  });
  const changedBytes = targets.reduce(
    (total, target) =>
      target.action === "create" ? total + target.desiredBytes : total,
    0,
  );
  const rollbackByteBudget = changedBytes * 2;
  if (!Number.isSafeInteger(rollbackByteBudget)) {
    fail(
      "skill-runtime-materialization-budget-exceeded",
      "Skill materialization byte accounting exceeds the safe integer range.",
    );
  }
  const budgets: ExecutionBudgets = Object.freeze({
    maxChangedFiles: summary.createDirectories + summary.createFiles,
    maxChangedBytes: rollbackByteBudget,
    maxDurationMs: SKILL_MATERIALIZATION_MAX_DURATION_MS,
    maxOutputBytes: SKILL_MATERIALIZATION_MAX_OUTPUT_BYTES,
    maxRepairCycles: 0,
  });
  const disposition =
    conflicts.length > 0
      ? "blocked"
      : summary.createFiles > 0
        ? "ready"
        : "no-op";
  const draft: Omit<PreparedProjectSkillMaterialization, "preparedDigest"> = {
    schemaVersion: "1.0.0",
    runId: request.runId,
    registryDigest: request.plan.registryDigest,
    surfaceDigest: request.plan.surfaceDigest,
    sourcePlanDigest: request.plan.planDigest,
    projectIdentityDigest: request.plan.project.identityDigest,
    observationDigest: second.digest,
    disposition,
    directories,
    targets,
    conflicts,
    summary,
    budgets,
    mutationPerformed: false,
  };
  const prepared = deepFreeze({
    ...draft,
    preparedDigest: preparedDigestInput(draft),
  });
  preparedStates.set(
    prepared,
    Object.freeze({
      plan: request.plan,
      root,
      desiredContentByPath: new Map(
        request.plan.targets.map((target) => [
          target.targetPath,
          new Uint8Array(Buffer.from(target.content, "utf8")),
        ]),
      ),
      observationDigest: second.digest,
    }),
  );
  return prepared;
}
