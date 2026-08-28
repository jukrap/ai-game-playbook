import {
  SKILL_CATALOG_MAX_ENTRIES,
  SKILL_TARGET_MAX_BYTES,
  PROJECT_STAGES,
  isStableId,
  parseStableId,
  type StableId,
  type ProjectStage,
} from "@ai-game-playbook/contracts";
import {
  preparePackOperation,
  type PreparedPackOperation,
} from "@ai-game-playbook/pack-runtime";
import { BUILTIN_REGISTRY } from "@ai-game-playbook/registry";
import { types as utilTypes } from "node:util";

import { SkillRuntimeBoundaryError } from "./errors.js";
import {
  internalsForPreparedProjectSkillMaterialization,
  type PreparedProjectSkillMaterialization,
} from "./materialization.js";
import { assertProjectSkillPlanRuntimeCurrent } from "./runtime.js";

const PROJECT_SKILLS_PACK_ID = parseStableId("pack.project-skills");
const MANAGED_SKILL_MAX_TOTAL_BYTES =
  SKILL_CATALOG_MAX_ENTRIES * SKILL_TARGET_MAX_BYTES * 2;
const MANAGED_SKILL_MAX_DIRECTORY_ENTRIES = 10_000;

export interface PrepareManagedProjectSkillInstallationRequest {
  readonly materialization: PreparedProjectSkillMaterialization;
  readonly projectId: StableId;
  readonly projectStage: ProjectStage;
}

type DataRecord = Record<string, unknown>;

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
      "skill-runtime-managed-install-request-invalid",
      "Managed skill installation preflight requires a plain data request.",
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
      keys.length !== 3 ||
      keys[0] !== "materialization" ||
      keys[1] !== "projectId" ||
      keys[2] !== "projectStage" ||
      Object.values(descriptors).some(
        (descriptor) =>
          !("value" in descriptor) || descriptor.enumerable !== true,
      )
    ) {
      throw new TypeError("request fields are not exact data properties");
    }
    return Object.freeze({
      materialization: descriptors["materialization"]?.value,
      projectId: descriptors["projectId"]?.value,
      projectStage: descriptors["projectStage"]?.value,
    });
  } catch (error) {
    if (error instanceof SkillRuntimeBoundaryError) throw error;
    fail(
      "skill-runtime-managed-install-request-invalid",
      "Managed skill installation preflight request fields are invalid.",
    );
  }
}

function validateRequest(
  value: unknown,
): PrepareManagedProjectSkillInstallationRequest {
  const record = requestRecord(value);
  if (
    !isStableId(record["projectId"]) ||
    !PROJECT_STAGES.includes(record["projectStage"] as ProjectStage)
  ) {
    fail(
      "skill-runtime-managed-install-request-invalid",
      "Managed skill installation requires a stable project identity and declared project stage.",
    );
  }
  return Object.freeze({
    materialization:
      record["materialization"] as PreparedProjectSkillMaterialization,
    projectId: record["projectId"],
    projectStage: record["projectStage"] as ProjectStage,
  });
}

export async function prepareManagedProjectSkillInstallation(
  value: PrepareManagedProjectSkillInstallationRequest,
): Promise<PreparedPackOperation> {
  const request = validateRequest(value);
  const internals = internalsForPreparedProjectSkillMaterialization(
    request.materialization,
  );
  if (request.materialization.disposition === "blocked") {
    fail(
      "skill-runtime-managed-install-plan-invalid",
      "Blocked skill materialization cannot be promoted to managed preflight.",
    );
  }
  await assertProjectSkillPlanRuntimeCurrent(internals.plan);

  return preparePackOperation({
    operation: "add",
    registry: BUILTIN_REGISTRY,
    targetRoot: internals.targetRoot,
    sourceRoot: internals.sourceRoot,
    project: Object.freeze({
      id: request.projectId,
      identityDigest: internals.targetRoot.identityDigest,
    }),
    workflow: Object.freeze({
      id: parseStableId("workflow.pack-add"),
      stepId: parseStableId("step.pack-add"),
      projectStage: request.projectStage,
    }),
    runId: request.materialization.runId,
    packId: PROJECT_SKILLS_PACK_ID,
    limits: Object.freeze({
      maxArtifactBytes: SKILL_TARGET_MAX_BYTES,
      maxTotalBytes: MANAGED_SKILL_MAX_TOTAL_BYTES,
      maxDirectoryEntries: MANAGED_SKILL_MAX_DIRECTORY_ENTRIES,
    }),
  });
}
