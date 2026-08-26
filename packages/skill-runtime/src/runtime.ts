import {
  SKILL_CATALOG_MAX_ENTRIES,
  SKILL_TARGET_MAX_BYTES,
  digestCanonicalJson,
  parsePortableProjectPath,
  parseStableId,
  type Sha256Digest,
  type SkillCatalogEntry,
  type SkillCheckObservation,
} from "@ai-game-playbook/contracts";
import {
  CoreBoundaryError,
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  readProjectFileSnapshot,
  resolveProjectPath,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
  assertValidatedRegistry,
} from "@ai-game-playbook/registry";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

import {
  skillArtifactMatches,
  snapshotSkillArtifact,
  type SkillArtifactSnapshot,
} from "./artifact.js";
import { SkillRuntimeBoundaryError } from "./errors.js";

export interface CreateProjectSkillPlanOptions {
  readonly projectRoot: string;
}

export interface ProjectSkillPlanProject {
  readonly canonicalPath: string;
  readonly identityDigest: Sha256Digest;
}

export interface ProjectSkillTarget extends SkillCatalogEntry {
  readonly maxBytes: number;
  readonly content: string;
  readonly materialization: "plan-only";
}

export interface ProjectSkillPlan {
  readonly schemaVersion: "1.0.0";
  readonly registryDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly project: ProjectSkillPlanProject;
  readonly catalog: readonly SkillCatalogEntry[];
  readonly targets: readonly ProjectSkillTarget[];
  readonly planDigest: Sha256Digest;
  readonly mutationPerformed: false;
}

export interface ProjectSkillInspection {
  readonly schemaVersion: "1.0.0";
  readonly planDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly checks: readonly SkillCheckObservation[];
  readonly mutationPerformed: false;
}

interface ProjectSkillPlanState {
  readonly root: CanonicalProjectRoot;
  readonly artifacts: readonly SkillArtifactSnapshot[];
}

const planStates = new WeakMap<object, ProjectSkillPlanState>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validateOptions(
  value: CreateProjectSkillPlanOptions,
): CreateProjectSkillPlanOptions {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    !exactKeys(value, ["projectRoot"]) ||
    typeof value.projectRoot !== "string" ||
    value.projectRoot.length === 0 ||
    value.projectRoot.length > 32_767 ||
    /[\u0000-\u001F\u007F]/u.test(value.projectRoot) ||
    !isAbsolute(value.projectRoot)
  ) {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-options-invalid",
      "Skill runtime options are outside the bounded project contract.",
    );
  }
  return Object.freeze({ projectRoot: value.projectRoot });
}

function assertRegistrySurfaceCurrent(): void {
  assertValidatedRegistry(BUILTIN_REGISTRY);
  const surface = BUILTIN_REGISTRY_SURFACES.skills;
  if (
    surface.sourceRegistryDigest !== BUILTIN_REGISTRY.digest ||
    BUILTIN_REGISTRY_SURFACES.registryDigest !== BUILTIN_REGISTRY.digest ||
    surface.data.controlPlaneVersion !== BUILTIN_REGISTRY.controlPlaneVersion ||
    surface.data.routes.length > SKILL_CATALOG_MAX_ENTRIES
  ) {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-registry-drift",
      "Generated skill routing does not match the builtin runtime registry.",
    );
  }
}

function routeName(path: string): string {
  const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
  if (match?.[1] === undefined) {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-registry-drift",
      "A generated skill route has no canonical project target name.",
    );
  }
  return match[1];
}

async function createCatalogAndTargets(): Promise<{
  readonly catalog: readonly SkillCatalogEntry[];
  readonly targets: readonly ProjectSkillTarget[];
  readonly artifacts: readonly SkillArtifactSnapshot[];
}> {
  assertRegistrySurfaceCurrent();
  const catalog: SkillCatalogEntry[] = [];
  const targets: ProjectSkillTarget[] = [];
  const artifacts: SkillArtifactSnapshot[] = [];
  const names = new Set<string>();

  for (const route of BUILTIN_REGISTRY_SURFACES.skills.data.routes) {
    const descriptor = BUILTIN_REGISTRY.skills.find(({ id }) => id === route.id);
    const name = routeName(route.body.path);
    if (
      descriptor === undefined ||
      descriptor !== route ||
      descriptor.lifecycle !== "stable" ||
      (descriptor.invocation !== "model" && descriptor.invocation !== "both") ||
      names.has(name)
    ) {
      throw new SkillRuntimeBoundaryError(
        "skill-runtime-registry-drift",
        "Generated skill routing is ambiguous or outside the stable runtime catalog.",
      );
    }
    names.add(name);
    const artifactPath = parsePortableProjectPath(route.body.path);
    const targetPath = parsePortableProjectPath(
      `.agents/skills/${name}/SKILL.md`,
    );
    const sourcePath = fileURLToPath(
      new URL(`../${route.body.path}`, import.meta.url),
    );
    const artifact = await snapshotSkillArtifact({
      path: sourcePath,
      expectedName: name,
      expectedDigest: route.body.digest,
      maxBytes: SKILL_TARGET_MAX_BYTES,
    });
    artifacts.push(artifact);

    const entry: SkillCatalogEntry = Object.freeze({
      id: route.id,
      name,
      version: route.version,
      invocation: route.invocation,
      summary: route.summary,
      capabilities: Object.freeze([...route.capabilities]),
      requiredPermissions: Object.freeze([...route.requiredPermissions]),
      artifactPath,
      artifactDigest: artifact.digest,
      maxTokens: route.body.maxTokens,
      targetPath,
    });
    catalog.push(entry);
    targets.push(
      Object.freeze({
        ...entry,
        maxBytes: SKILL_TARGET_MAX_BYTES,
        content: artifact.content,
        materialization: "plan-only" as const,
      }),
    );
  }

  return Object.freeze({
    catalog: Object.freeze(catalog),
    targets: Object.freeze(targets),
    artifacts: Object.freeze(artifacts),
  });
}

export async function createProjectSkillPlan(
  value: CreateProjectSkillPlanOptions,
): Promise<ProjectSkillPlan> {
  const options = validateOptions(value);
  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(options.projectRoot);
  } catch {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-project-boundary",
      "Skill runtime could not bind the selected project root.",
    );
  }
  const generated = await createCatalogAndTargets();
  await assertProjectRootIdentity(root);
  const fields = deepFreeze({
    schemaVersion: "1.0.0" as const,
    registryDigest: BUILTIN_REGISTRY.digest,
    surfaceDigest: BUILTIN_REGISTRY_SURFACES.skills.digest,
    project: {
      canonicalPath: root.canonicalPath,
      identityDigest: root.identityDigest,
    },
    catalog: generated.catalog,
    targets: generated.targets,
    mutationPerformed: false as const,
  });
  const plan: ProjectSkillPlan = deepFreeze({
    ...fields,
    planDigest: digestCanonicalJson(fields),
  });
  planStates.set(
    plan,
    Object.freeze({ root, artifacts: generated.artifacts }),
  );
  return plan;
}

function stateFor(plan: ProjectSkillPlan): ProjectSkillPlanState {
  if (typeof plan !== "object" || plan === null) {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-plan-invalid",
      "Project skill plan was not issued by this runtime.",
    );
  }
  const state = planStates.get(plan);
  if (state === undefined) {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-plan-invalid",
      "Project skill plan was not issued by this runtime.",
    );
  }
  return state;
}

export function assertProjectSkillPlan(plan: ProjectSkillPlan): void {
  stateFor(plan);
}

async function assertRuntimeState(
  plan: ProjectSkillPlan,
  state: ProjectSkillPlanState,
): Promise<void> {
  try {
    assertRegistrySurfaceCurrent();
    if (
      plan.registryDigest !== BUILTIN_REGISTRY.digest ||
      plan.surfaceDigest !== BUILTIN_REGISTRY_SURFACES.skills.digest ||
      plan.project.identityDigest !== state.root.identityDigest
    ) {
      throw new Error("plan identity drift");
    }
    await assertProjectRootIdentity(state.root);
    for (const artifact of state.artifacts) {
      const current = await snapshotSkillArtifact({
        path: artifact.canonicalPath,
        expectedName: artifact.name,
        expectedDigest: artifact.digest,
        maxBytes: SKILL_TARGET_MAX_BYTES,
      });
      if (!skillArtifactMatches(artifact, current)) {
        throw new Error("artifact drift");
      }
    }
  } catch {
    throw new SkillRuntimeBoundaryError(
      "skill-runtime-runtime-drift",
      "Project, registry, or packaged skill identity changed after planning.",
    );
  }
}

function parentPaths(path: string): readonly string[] {
  const segments = path.split("/");
  return Object.freeze(
    segments
      .slice(0, -1)
      .map((_, index) => segments.slice(0, index + 1).join("/")),
  );
}

function observation(
  target: ProjectSkillTarget,
  fields:
    | {
        readonly targetStatus: "missing" | "unsafe";
        readonly code: "skill-target-missing" | "skill-target-unsafe";
      }
    | {
        readonly targetStatus: "conflict";
        readonly code: "skill-target-byte-budget-exceeded";
      }
    | {
        readonly targetStatus: "current" | "conflict";
        readonly code:
          | "skill-target-current"
          | "skill-target-content-conflict";
        readonly actualDigest: Sha256Digest;
        readonly bytes: number;
      },
): SkillCheckObservation {
  return Object.freeze({
    id: target.id,
    name: target.name,
    artifactPath: target.artifactPath,
    artifactDigest: target.artifactDigest,
    targetPath: target.targetPath,
    targetStatus: fields.targetStatus,
    code: parseStableId(fields.code),
    ...("actualDigest" in fields
      ? { actualDigest: fields.actualDigest, bytes: fields.bytes }
      : {}),
  });
}

function isBudgetError(error: unknown): boolean {
  return (
    error instanceof CoreBoundaryError &&
    error.code === "cas-budget-exceeded"
  );
}

async function inspectTarget(
  root: CanonicalProjectRoot,
  target: ProjectSkillTarget,
): Promise<SkillCheckObservation> {
  for (const parentPath of parentPaths(target.targetPath)) {
    try {
      const parent = await resolveProjectPath(root, parentPath, {
        expectedType: "directory",
        existence: "optional",
      });
      if (parent.kind === "absent") {
        return observation(target, {
          targetStatus: "missing",
          code: "skill-target-missing",
        });
      }
    } catch {
      return observation(target, {
        targetStatus: "unsafe",
        code: "skill-target-unsafe",
      });
    }
  }

  try {
    const resolved = await resolveProjectPath(root, target.targetPath, {
      expectedType: "file",
      existence: "optional",
    });
    if (resolved.kind === "absent") {
      return observation(target, {
        targetStatus: "missing",
        code: "skill-target-missing",
      });
    }
  } catch {
    return observation(target, {
      targetStatus: "unsafe",
      code: "skill-target-unsafe",
    });
  }

  try {
    const snapshot = await readProjectFileSnapshot({
      root,
      path: target.targetPath,
      maxBytes: target.maxBytes,
    });
    const current = snapshot.digest === target.artifactDigest;
    return observation(target, {
      targetStatus: current ? "current" : "conflict",
      code: current
        ? "skill-target-current"
        : "skill-target-content-conflict",
      actualDigest: snapshot.digest,
      bytes: snapshot.bytes,
    });
  } catch (error) {
    if (isBudgetError(error)) {
      return observation(target, {
        targetStatus: "conflict",
        code: "skill-target-byte-budget-exceeded",
      });
    }
    return observation(target, {
      targetStatus: "unsafe",
      code: "skill-target-unsafe",
    });
  }
}

export async function inspectProjectSkillTargets(
  plan: ProjectSkillPlan,
): Promise<ProjectSkillInspection> {
  const state = stateFor(plan);
  await assertRuntimeState(plan, state);
  const checks: SkillCheckObservation[] = [];
  for (const target of plan.targets) {
    checks.push(await inspectTarget(state.root, target));
  }
  await assertRuntimeState(plan, state);
  return deepFreeze({
    schemaVersion: "1.0.0" as const,
    planDigest: plan.planDigest,
    projectIdentityDigest: state.root.identityDigest,
    checks: Object.freeze(checks),
    mutationPerformed: false as const,
  });
}
