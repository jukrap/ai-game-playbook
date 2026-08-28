import {
  PROJECT_INITIALIZATION_TARGET_DEFINITIONS,
  parseStableId,
  type InitPlanIssue,
  type InitPlanTarget,
  type InitPlanTargetDefinition,
  type PortableProjectPath,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

import { CoreBoundaryError } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
} from "./project-path.js";

export type ProjectInitializationTargetDefinition = InitPlanTargetDefinition;

export interface PlanProjectInitializationRequest {
  readonly root: CanonicalProjectRoot;
}

export interface ProjectInitializationPlan {
  readonly schemaVersion: "1.0.0";
  readonly rootIdentityDigest: Sha256Digest;
  readonly targets: readonly InitPlanTarget[];
  readonly issues: readonly InitPlanIssue[];
}

export const PROJECT_INITIALIZATION_TARGETS: readonly ProjectInitializationTargetDefinition[] =
  PROJECT_INITIALIZATION_TARGET_DEFINITIONS;

function objectHasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validateRequest(
  value: PlanProjectInitializationRequest,
): PlanProjectInitializationRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !objectHasExactKeys(value, ["root"])
  ) {
    throw new CoreBoundaryError(
      "invalid-project-initialization-plan-request",
      "$projectInitializationPlan",
      "initialization planning requires only a bound project root",
    );
  }
  return Object.freeze({ root: value.root });
}

function parentPath(path: PortableProjectPath): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function planTarget(
  definition: ProjectInitializationTargetDefinition,
  action: InitPlanTarget["action"],
  code: string,
): InitPlanTarget {
  return Object.freeze({
    ...definition,
    action,
    code: parseStableId(code),
  });
}

function issueFor(
  definition: ProjectInitializationTargetDefinition,
  error: CoreBoundaryError,
): InitPlanIssue {
  const message =
    error.code === "project-path-case-conflict"
      ? "A planned target collides with a different case spelling."
      : error.code === "project-path-link"
        ? "A planned target or one of its ancestors is a symbolic link or junction."
        : error.code === "project-path-type-mismatch"
          ? "A planned target is occupied by another filesystem type."
          : "A planned target could not be inspected against a stable project path.";
  return Object.freeze({
    code: parseStableId(error.code),
    path: definition.path,
    message,
    nextAction:
      "Resolve the reported project-local path without deleting unrelated content, then rerun init.",
  });
}

function isTargetObservationError(error: CoreBoundaryError): boolean {
  return [
    "filesystem-operation-failed",
    "project-path-budget-exceeded",
    "project-path-case-conflict",
    "project-path-escape",
    "project-path-link",
    "project-path-not-found",
    "project-path-type-mismatch",
  ].includes(error.code);
}

export async function planProjectInitialization(
  value: PlanProjectInitializationRequest,
): Promise<ProjectInitializationPlan> {
  const request = validateRequest(value);
  await assertProjectRootIdentity(request.root);

  const targets: InitPlanTarget[] = [];
  const issues: InitPlanIssue[] = [];
  const byPath = new Map<string, InitPlanTarget>();

  for (const definition of PROJECT_INITIALIZATION_TARGETS) {
    const parent = parentPath(definition.path);
    const parentPlan = parent === "." ? undefined : byPath.get(parent);
    if (parent !== "." && parentPlan === undefined) {
      throw new CoreBoundaryError(
        "invalid-project-initialization-plan-request",
        definition.path,
        "initialization target order does not contain its parent",
      );
    }
    if (parentPlan?.action === "create") {
      const planned = planTarget(definition, "create", "parent-planned");
      targets.push(planned);
      byPath.set(definition.path, planned);
      continue;
    }
    if (parentPlan?.action === "conflict") {
      const planned = planTarget(definition, "conflict", "parent-conflict");
      targets.push(planned);
      byPath.set(definition.path, planned);
      continue;
    }

    try {
      const resolved = await resolveProjectPath(request.root, definition.path, {
        existence: "optional",
        expectedType: definition.kind,
      });
      const planned =
        resolved.kind === "absent"
          ? planTarget(definition, "create", "target-absent")
          : planTarget(definition, "retain", "target-ready");
      targets.push(planned);
      byPath.set(definition.path, planned);
    } catch (error) {
      if (
        !(error instanceof CoreBoundaryError) ||
        !isTargetObservationError(error)
      ) {
        throw error;
      }
      const planned = planTarget(definition, "conflict", error.code);
      targets.push(planned);
      byPath.set(definition.path, planned);
      issues.push(issueFor(definition, error));
    }
  }

  await assertProjectRootIdentity(request.root);
  return Object.freeze({
    schemaVersion: "1.0.0",
    rootIdentityDigest: request.root.identityDigest,
    targets: Object.freeze(targets),
    issues: Object.freeze(issues),
  });
}
