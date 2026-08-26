import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  isPortableProjectPath,
  type PortableProjectPath,
} from "./portable-path.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";

export type InitPlanStatus = "ready" | "blocked";
export type InitPlanTargetKind = "directory" | "file";
export type InitPlanTargetPolicy = "committed" | "local-only";
export type InitPlanTargetContent =
  | "none"
  | "project-profile"
  | "pack-lock"
  | "ignore-policy";
export type InitPlanTargetAction = "create" | "retain" | "conflict";

export interface InitRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface InitPlanTarget {
  readonly path: PortableProjectPath;
  readonly kind: InitPlanTargetKind;
  readonly policy: InitPlanTargetPolicy;
  readonly content: InitPlanTargetContent;
  readonly action: InitPlanTargetAction;
  readonly code: StableId;
}

export interface InitPlanIssue {
  readonly code: StableId;
  readonly path?: string;
  readonly message: string;
  readonly nextAction: string;
}

export interface InitProjectSummary {
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly identityDigest?: Sha256Digest;
}

export interface InitPlanSummary {
  readonly create: number;
  readonly retain: number;
  readonly conflict: number;
}

export interface InitReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "init";
  readonly mode: "plan-only";
  readonly status: InitPlanStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: InitProjectSummary;
  readonly targets: readonly InitPlanTarget[];
  readonly issues: readonly InitPlanIssue[];
  readonly summary: InitPlanSummary;
  readonly planDigest?: Sha256Digest;
  readonly mutationPerformed: false;
  readonly applySupported: false;
  readonly externalInstallPlanned: false;
  readonly networkAccessPlanned: false;
}

export interface InitPlanDigestInput {
  readonly registryDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly targets: readonly InitPlanTarget[];
}

export const INIT_PLAN_TARGET_ACTIONS: readonly InitPlanTargetAction[] =
  Object.freeze(["create", "retain", "conflict"]);
export const INIT_PLAN_MAX_TARGETS = 32;
export const INIT_PLAN_MAX_ISSUES = 32;

const targetKinds: readonly InitPlanTargetKind[] = Object.freeze([
  "directory",
  "file",
]);
const targetPolicies: readonly InitPlanTargetPolicy[] = Object.freeze([
  "committed",
  "local-only",
]);
const targetContents: readonly InitPlanTargetContent[] = Object.freeze([
  "none",
  "project-profile",
  "pack-lock",
  "ignore-policy",
]);

function validateTargets(
  targets: readonly InitPlanTarget[],
  minimum = 0,
): readonly InitPlanTarget[] {
  if (
    !Array.isArray(targets) ||
    targets.length < minimum ||
    targets.length > INIT_PLAN_MAX_TARGETS
  ) {
    throw new RangeError("init target count exceeds the plan contract");
  }

  const paths = new Set<string>();
  for (const target of targets) {
    const keys =
      typeof target === "object" && target !== null
        ? Object.keys(target).sort()
        : [];
    if (
      typeof target !== "object" ||
      target === null ||
      keys.length !== 6 ||
      !["action", "code", "content", "kind", "path", "policy"].every(
        (key, index) => keys[index] === key,
      ) ||
      !isPortableProjectPath(target.path) ||
      !targetKinds.includes(target.kind) ||
      !targetPolicies.includes(target.policy) ||
      !targetContents.includes(target.content) ||
      !INIT_PLAN_TARGET_ACTIONS.includes(target.action) ||
      !isStableId(target.code)
    ) {
      throw new TypeError("init target is outside the plan contract");
    }
    if (
      (target.kind === "directory" && target.content !== "none") ||
      (target.kind === "file" && target.content === "none")
    ) {
      throw new TypeError("init target kind and content intent disagree");
    }
    const folded = target.path.toLowerCase();
    if (paths.has(folded)) {
      throw new TypeError("init target paths must be portable and unique");
    }
    paths.add(folded);
  }
  return targets;
}

export function summarizeInitPlanTargets(
  targets: readonly InitPlanTarget[],
): InitPlanSummary {
  validateTargets(targets);
  let create = 0;
  let retain = 0;
  let conflict = 0;
  for (const target of targets) {
    if (target.action === "create") {
      create += 1;
    } else if (target.action === "retain") {
      retain += 1;
    } else {
      conflict += 1;
    }
  }
  return Object.freeze({ create, retain, conflict });
}

export function computeInitPlanStatus(
  targets: readonly InitPlanTarget[],
  issues: readonly InitPlanIssue[],
): InitPlanStatus {
  const summary = summarizeInitPlanTargets(targets);
  if (!Array.isArray(issues) || issues.length > INIT_PLAN_MAX_ISSUES) {
    throw new RangeError("init issue count exceeds the plan contract");
  }
  return summary.conflict > 0 || issues.length > 0 ? "blocked" : "ready";
}

export function computeInitPlanDigest(
  input: InitPlanDigestInput,
): Sha256Digest {
  const keys =
    typeof input === "object" && input !== null
      ? Object.keys(input).sort()
      : [];
  if (
    typeof input !== "object" ||
    input === null ||
    keys.length !== 3 ||
    !["projectIdentityDigest", "registryDigest", "targets"].every(
      (key, index) => keys[index] === key,
    ) ||
    !isSha256Digest(input.registryDigest) ||
    !isSha256Digest(input.projectIdentityDigest)
  ) {
    throw new TypeError("init plan digest input has invalid authority");
  }
  validateTargets(input.targets, 1);
  return digestCanonicalJson({
    domain: "ai-game-playbook/init-plan",
    version: "1.0.0",
    registryDigest: input.registryDigest,
    projectIdentityDigest: input.projectIdentityDigest,
    targets: input.targets,
  });
}

export function assertInitReportSemantics(report: InitReport): void {
  if (typeof report !== "object" || report === null) {
    throw new TypeError("init report is not an object");
  }
  const expectedSummary = summarizeInitPlanTargets(report.targets);
  if (
    report.summary.create !== expectedSummary.create ||
    report.summary.retain !== expectedSummary.retain ||
    report.summary.conflict !== expectedSummary.conflict
  ) {
    throw new TypeError("init report summary does not match its targets");
  }
  if (report.status !== computeInitPlanStatus(report.targets, report.issues)) {
    throw new TypeError("init report status does not match its observations");
  }

  const hasCanonicalPath = report.project.canonicalPath !== undefined;
  const hasIdentity = report.project.identityDigest !== undefined;
  if (hasCanonicalPath !== hasIdentity) {
    throw new TypeError("init report project identity is incomplete");
  }
  if (!hasIdentity) {
    if (
      report.targets.length !== 0 ||
      report.planDigest !== undefined ||
      report.status !== "blocked" ||
      report.issues.length === 0
    ) {
      throw new TypeError("unbound init reports cannot carry an applicable plan");
    }
    return;
  }
  const expectedDigest = computeInitPlanDigest({
    registryDigest: report.registryDigest,
    projectIdentityDigest: report.project.identityDigest as Sha256Digest,
    targets: report.targets,
  });
  if (report.planDigest !== expectedDigest) {
    throw new TypeError("init report digest does not attest its exact plan");
  }
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const initPlanTarget = closedObject(
  {
    path: reference("portablePath"),
    kind: enumSchema(targetKinds),
    policy: enumSchema(targetPolicies),
    content: enumSchema(targetContents),
    action: enumSchema(INIT_PLAN_TARGET_ACTIONS),
    code: reference("stableId"),
  },
  ["path", "kind", "policy", "content", "action", "code"],
);

const initPlanIssue = closedObject(
  {
    code: reference("stableId"),
    path: reference("portablePath"),
    message: textSchema(500),
    nextAction: textSchema(500),
  },
  ["code", "message", "nextAction"],
);

const initProject = closedObject(
  {
    requestedPath: localPath,
    canonicalPath: localPath,
    identityDigest: reference("sha256Digest"),
  },
  ["requestedPath"],
);

const initPlanSummary = closedObject(
  {
    create: { type: "integer", minimum: 0, maximum: INIT_PLAN_MAX_TARGETS },
    retain: { type: "integer", minimum: 0, maximum: INIT_PLAN_MAX_TARGETS },
    conflict: { type: "integer", minimum: 0, maximum: INIT_PLAN_MAX_TARGETS },
  },
  ["create", "retain", "conflict"],
);

export const initRequestSchema: VersionedContractSchema = defineContractSchema({
  id: "init-request",
  version: "1.0.0",
  title: "Initialization Planning Request",
  description:
    "Selects one bounded local project root for write-free initialization planning.",
  schema: contractRoot(
    {
      schemaVersion: reference("semanticVersion"),
      projectRoot: localPath,
    },
    ["schemaVersion", "projectRoot"],
  ),
});

export const initReportSchema: VersionedContractSchema = defineContractSchema({
  id: "init-report",
  version: "1.0.0",
  title: "Initialization Plan Report",
  description:
    "Reports a bounded project-local layout plan without applying filesystem changes.",
  schema: {
    ...contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "init" },
        mode: { const: "plan-only" },
        status: enumSchema(["ready", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        project: initProject,
        targets: boundedArray(initPlanTarget, {
          maximum: INIT_PLAN_MAX_TARGETS,
        }),
        issues: boundedArray(initPlanIssue, { maximum: INIT_PLAN_MAX_ISSUES }),
        summary: initPlanSummary,
        planDigest: reference("sha256Digest"),
        mutationPerformed: { const: false },
        applySupported: { const: false },
        externalInstallPlanned: { const: false },
        networkAccessPlanned: { const: false },
      },
      [
        "schemaVersion",
        "commandId",
        "mode",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "project",
        "targets",
        "issues",
        "summary",
        "mutationPerformed",
        "applySupported",
        "externalInstallPlanned",
        "networkAccessPlanned",
      ],
    ),
    allOf: [
      {
        if: {
          type: "object",
          properties: { status: { const: "ready" } },
          required: ["status"],
        },
        then: {
          type: "object",
          required: ["planDigest"],
          properties: {
            planDigest: reference("sha256Digest"),
            project: {
              type: "object",
              properties: {
                canonicalPath: localPath,
                identityDigest: reference("sha256Digest"),
              },
              required: ["canonicalPath", "identityDigest"],
            },
          },
        },
      },
    ],
  },
});
