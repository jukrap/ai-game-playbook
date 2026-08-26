import {
  compareSemanticVersions,
  digestCanonicalJson,
  parseSemanticVersion,
  sha256Digest,
  type SemanticVersion,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  assertProcessExecutableIdentity,
  assertProjectRootIdentity,
  bindProcessExecutable,
  canonicalizeProjectRoot,
  PROCESS_MAX_EXECUTABLE_BYTES,
  readProjectFileSnapshot,
  resolveProjectPath,
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  assertMcpRuntimePlan,
  createMcpRuntimePlan,
  type McpRuntimePlan,
} from "@ai-game-playbook/mcp";
import {
  assertValidatedRegistry,
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
} from "@ai-game-playbook/registry";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { CodexSetupBoundaryError } from "./errors.js";
import {
  CODEX_MCP_ENTRY_MAX_BYTES,
  runtimeEntryMatches,
  snapshotRuntimeEntry,
  type RuntimeEntrySnapshot,
} from "./runtime-entry.js";
import {
  CODEX_SKILL_MAX_BYTES,
  skillArtifactMatches,
  snapshotSkillArtifact,
  type SkillArtifactSnapshot,
} from "./skill-artifact.js";

export const CODEX_CONFIG_PATH = ".codex/config.toml" as const;
export const CODEX_CONFIG_MAX_BYTES: number = 256 * 1024;
const SERVER_NAME = "ai_game_playbook" as const;
const STARTUP_TIMEOUT_SECONDS = 10;
const MINIMUM_NODE_VERSION = parseSemanticVersion("22.22.0").value;
const EXCLUSIVE_MAXIMUM_NODE_VERSION = parseSemanticVersion("23.0.0").value;
const INSTALLED_MCP_ENTRY_POINT = fileURLToPath(
  new URL("../../mcp/dist/bin.js", import.meta.url),
);

export interface CreateCodexProjectSetupPlanOptions {
  readonly projectRoot: string;
  readonly enabledTools: readonly string[];
  readonly allowHostDisclosure: boolean;
}

export interface CodexSkillTarget {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly sourcePath: string;
  readonly sourceDigest: Sha256Digest;
  readonly maxBytes: number;
  readonly content: string;
  readonly materialization: "plan-only";
}

export interface CodexProjectSetupPlan {
  readonly schemaVersion: "1.0.0";
  readonly planDigest: Sha256Digest;
  readonly project: {
    readonly root: string;
    readonly identityDigest: Sha256Digest;
  };
  readonly registry: {
    readonly digest: Sha256Digest;
    readonly mcpSurfaceDigest: Sha256Digest;
    readonly skillSurfaceDigest: Sha256Digest;
  };
  readonly runtime: {
    readonly nodeExecutable: string;
    readonly nodeVersion: SemanticVersion;
    readonly nodeIdentityDigest: Sha256Digest;
    readonly nodeDigest: Sha256Digest;
    readonly mcpEntryPoint: string;
    readonly mcpEntryDigest: Sha256Digest;
    readonly protocolRevision: "2026-07-28";
  };
  readonly host: {
    readonly serverName: typeof SERVER_NAME;
    readonly projectTrustRequired: true;
    readonly disclosureAcknowledged: true;
    readonly defaultToolsApprovalMode: "prompt";
    readonly enabledTools: readonly string[];
  };
  readonly target: {
    readonly path: typeof CODEX_CONFIG_PATH;
    readonly policy: "local-only";
    readonly maxBytes: number;
    readonly content: string;
    readonly contentDigest: Sha256Digest;
  };
  readonly skillTargets: readonly CodexSkillTarget[];
  readonly mutationPerformed: false;
}

export type CodexSetupTargetCode =
  | "target-byte-budget-exceeded"
  | "target-content-conflict"
  | "target-current"
  | "target-missing";

export interface CodexSetupFileTargetInspection<Path extends string = string> {
  readonly path: Path;
  readonly action: "create" | "retain" | "conflict";
  readonly code: CodexSetupTargetCode;
  readonly expectedDigest: Sha256Digest;
  readonly actualDigest?: Sha256Digest;
  readonly bytes?: number;
}

export interface CodexSkillTargetInspection
  extends CodexSetupFileTargetInspection<string> {
  readonly id: string;
  readonly name: string;
}

export interface CodexProjectSetupInspection {
  readonly schemaVersion: "1.0.0";
  readonly planDigest: Sha256Digest;
  readonly projectIdentityDigest: Sha256Digest;
  readonly target: CodexSetupFileTargetInspection<typeof CODEX_CONFIG_PATH>;
  readonly skillTargets: readonly CodexSkillTargetInspection[];
  readonly mutationPerformed: false;
}

interface SetupPlanState {
  readonly root: CanonicalProjectRoot;
  readonly node: BoundProcessExecutable;
  readonly entry: RuntimeEntrySnapshot;
  readonly mcp: McpRuntimePlan;
  readonly skills: readonly SkillArtifactSnapshot[];
}

const setupPlanStates = new WeakMap<object, SetupPlanState>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function keysAreExact(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validBoundedPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32_767 &&
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function validateOptions(
  value: CreateCodexProjectSetupPlanOptions,
): CreateCodexProjectSetupPlanOptions & { readonly enabledTools: readonly string[] } {
  if (
    typeof value !== "object" ||
    value === null ||
    !keysAreExact(value, [
      "allowHostDisclosure",
      "enabledTools",
      "projectRoot",
    ]) ||
    !validBoundedPath(value.projectRoot) ||
    !Array.isArray(value.enabledTools) ||
    value.enabledTools.length === 0 ||
    value.enabledTools.length > 32
  ) {
    throw new CodexSetupBoundaryError(
      "codex-setup-options-invalid",
      "Codex setup options do not satisfy the bounded plan contract.",
    );
  }
  if (value.allowHostDisclosure !== true) {
    throw new CodexSetupBoundaryError(
      "codex-setup-disclosure-required",
      "Codex setup requires explicit acknowledgement of active-host disclosure.",
    );
  }
  const tools = new Set<string>();
  for (const tool of value.enabledTools) {
    if (
      typeof tool !== "string" ||
      tool.length === 0 ||
      tool.length > 128 ||
      /[\u0000-\u001F\u007F]/u.test(tool) ||
      tools.has(tool)
    ) {
      throw new CodexSetupBoundaryError(
        "codex-setup-options-invalid",
        "Codex setup tool selection is duplicated or outside its boundary.",
      );
    }
    tools.add(tool);
  }
  return {
    ...value,
    enabledTools: Object.freeze([...tools].sort()),
  };
}

function tomlString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function renderConfig(
  root: CanonicalProjectRoot,
  node: BoundProcessExecutable,
  entry: RuntimeEntrySnapshot,
  mcp: McpRuntimePlan,
): string {
  const args = [entry.canonicalPath, "--project-root", root.canonicalPath];
  for (const tool of mcp.enabledTools) {
    args.push("--enable-tool", tool.name);
  }
  args.push("--allow-host-disclosure");
  const maximumToolTimeout = Math.max(
    ...mcp.enabledTools.map(({ timeoutMs }) => timeoutMs),
  );
  const toolTimeoutSeconds = Math.max(1, Math.ceil(maximumToolTimeout / 1000));
  return [
    "# Project-local, machine-specific AI Game Playbook MCP configuration.",
    `# The host must trust this project before loading ${CODEX_CONFIG_PATH}.`,
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(node.canonicalPath)}`,
    `args = ${tomlArray(args)}`,
    `cwd = ${tomlString(root.canonicalPath)}`,
    "enabled = true",
    "required = false",
    `startup_timeout_sec = ${STARTUP_TIMEOUT_SECONDS}`,
    `tool_timeout_sec = ${toolTimeoutSeconds}`,
    `enabled_tools = ${tomlArray(mcp.enabledTools.map(({ name }) => name))}`,
    'default_tools_approval_mode = "prompt"',
    "",
  ].join("\n");
}

async function createSkillTargets(): Promise<{
  readonly targets: readonly CodexSkillTarget[];
  readonly snapshots: readonly SkillArtifactSnapshot[];
}> {
  const targets: CodexSkillTarget[] = [];
  const snapshots: SkillArtifactSnapshot[] = [];
  const names = new Set<string>();
  for (const route of BUILTIN_REGISTRY_SURFACES.skills.data.routes) {
    const match = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(
      route.body.path,
    );
    const name = match?.[1];
    if (name === undefined || names.has(name)) {
      throw new CodexSetupBoundaryError(
        "codex-setup-registry-drift",
        "Codex skill routing contains an invalid or colliding target.",
      );
    }
    names.add(name);
    const source = fileURLToPath(
      new URL(`../${route.body.path}`, import.meta.url),
    );
    const snapshot = await snapshotSkillArtifact({
      path: source,
      expectedName: name,
      expectedDigest: route.body.digest,
      maxBytes: CODEX_SKILL_MAX_BYTES,
    });
    snapshots.push(snapshot);
    targets.push(
      Object.freeze({
        id: route.id,
        name,
        path: `.agents/skills/${name}/SKILL.md`,
        sourcePath: route.body.path,
        sourceDigest: snapshot.digest,
        maxBytes: CODEX_SKILL_MAX_BYTES,
        content: snapshot.content,
        materialization: "plan-only" as const,
      }),
    );
  }
  return Object.freeze({
    targets: Object.freeze(targets),
    snapshots: Object.freeze(snapshots),
  });
}

function currentNodeVersion(): SemanticVersion {
  let version: SemanticVersion;
  try {
    version = parseSemanticVersion(
      process.versions.node,
      "$nodeVersion",
    ).value;
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-runtime-invalid",
      "Codex setup requires a canonical supported Node.js runtime version.",
    );
  }
  if (
    compareSemanticVersions(version, MINIMUM_NODE_VERSION) < 0 ||
    compareSemanticVersions(version, EXCLUSIVE_MAXIMUM_NODE_VERSION) >= 0
  ) {
    throw new CodexSetupBoundaryError(
      "codex-setup-runtime-invalid",
      "Codex setup requires Node.js 22.22 or newer within major version 22.",
    );
  }
  return version;
}

export async function createCodexProjectSetupPlan(
  value: CreateCodexProjectSetupPlanOptions,
): Promise<CodexProjectSetupPlan> {
  const options = validateOptions(value);
  assertValidatedRegistry(BUILTIN_REGISTRY);
  const nodeVersion = currentNodeVersion();

  let root: CanonicalProjectRoot;
  try {
    root = await canonicalizeProjectRoot(options.projectRoot);
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-project-boundary",
      "Codex setup could not bind the selected project root.",
    );
  }

  let node: BoundProcessExecutable;
  try {
    const installedNodeExecutable = await realpath(process.execPath);
    node = await bindProcessExecutable({
      path: installedNodeExecutable,
      maxBytes: PROCESS_MAX_EXECUTABLE_BYTES,
      allowedEnvironmentKeys: [],
    });
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-runtime-invalid",
      "Codex setup could not bind the selected Node.js executable.",
    );
  }
  const entry = await snapshotRuntimeEntry(
    INSTALLED_MCP_ENTRY_POINT,
    CODEX_MCP_ENTRY_MAX_BYTES,
  );

  let mcp: McpRuntimePlan;
  try {
    mcp = await createMcpRuntimePlan({
      projectRoot: root.canonicalPath,
      enabledTools: options.enabledTools,
      allowHostDisclosure: true,
    });
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-options-invalid",
      "Codex setup could not create an exact generated MCP runtime plan.",
    );
  }
  if (
    mcp.projectIdentityDigest !== root.identityDigest ||
    mcp.registryDigest !== BUILTIN_REGISTRY.digest ||
    mcp.surfaceDigest !== BUILTIN_REGISTRY_SURFACES.mcp.digest ||
    mcp.protocolRevision !== "2026-07-28"
  ) {
    throw new CodexSetupBoundaryError(
      "codex-setup-registry-drift",
      "Codex setup registry and MCP surface are not exact.",
    );
  }
  const skills = await createSkillTargets();

  const content = renderConfig(root, node, entry, mcp);
  const target = {
    path: CODEX_CONFIG_PATH,
    policy: "local-only" as const,
    maxBytes: CODEX_CONFIG_MAX_BYTES,
    content,
    contentDigest: sha256Digest(content),
  };
  if (Buffer.byteLength(content, "utf8") > target.maxBytes) {
    throw new CodexSetupBoundaryError(
      "codex-setup-options-invalid",
      "Rendered Codex project configuration exceeds its byte boundary.",
    );
  }
  try {
    await assertProjectRootIdentity(root);
    await assertProcessExecutableIdentity(node);
    const currentEntry = await snapshotRuntimeEntry(
      entry.canonicalPath,
      CODEX_MCP_ENTRY_MAX_BYTES,
    );
    if (!runtimeEntryMatches(entry, currentEntry)) {
      throw new Error("entrypoint drift");
    }
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-runtime-drift",
      "Codex setup runtime identity changed while the plan was created.",
    );
  }
  const fields = deepFreeze({
    schemaVersion: "1.0.0" as const,
    project: {
      root: root.canonicalPath,
      identityDigest: root.identityDigest,
    },
    registry: {
      digest: BUILTIN_REGISTRY.digest,
      mcpSurfaceDigest: BUILTIN_REGISTRY_SURFACES.mcp.digest,
      skillSurfaceDigest: BUILTIN_REGISTRY_SURFACES.skills.digest,
    },
    runtime: {
      nodeExecutable: node.canonicalPath,
      nodeVersion,
      nodeIdentityDigest: node.identityDigest,
      nodeDigest: node.digest,
      mcpEntryPoint: entry.canonicalPath,
      mcpEntryDigest: entry.digest,
      protocolRevision: mcp.protocolRevision,
    },
    host: {
      serverName: SERVER_NAME,
      projectTrustRequired: true as const,
      disclosureAcknowledged: true as const,
      defaultToolsApprovalMode: "prompt" as const,
      enabledTools: Object.freeze(mcp.enabledTools.map(({ name }) => name)),
    },
    target,
    skillTargets: skills.targets,
    mutationPerformed: false as const,
  });
  const plan: CodexProjectSetupPlan = deepFreeze({
    ...fields,
    planDigest: digestCanonicalJson(fields),
  });
  setupPlanStates.set(
    plan,
    Object.freeze({ root, node, entry, mcp, skills: skills.snapshots }),
  );
  return plan;
}

function stateFor(plan: CodexProjectSetupPlan): SetupPlanState {
  if (typeof plan !== "object" || plan === null) {
    throw new CodexSetupBoundaryError(
      "codex-setup-plan-invalid",
      "Codex setup plan was not issued by this process.",
    );
  }
  const state = setupPlanStates.get(plan);
  if (state === undefined) {
    throw new CodexSetupBoundaryError(
      "codex-setup-plan-invalid",
      "Codex setup plan was not issued by this process.",
    );
  }
  return state;
}

export function assertCodexProjectSetupPlan(plan: CodexProjectSetupPlan): void {
  stateFor(plan);
}

async function assertRuntimeState(state: SetupPlanState): Promise<void> {
  try {
    await assertProjectRootIdentity(state.root);
    await assertProcessExecutableIdentity(state.node);
    assertMcpRuntimePlan(state.mcp);
    const currentEntry = await snapshotRuntimeEntry(
      state.entry.canonicalPath,
      CODEX_MCP_ENTRY_MAX_BYTES,
    );
    if (!runtimeEntryMatches(state.entry, currentEntry)) {
      throw new Error("entrypoint drift");
    }
    for (const skill of state.skills) {
      const currentSkill = await snapshotSkillArtifact({
        path: skill.canonicalPath,
        expectedName: skill.name,
        expectedDigest: skill.digest,
        maxBytes: CODEX_SKILL_MAX_BYTES,
      });
      if (!skillArtifactMatches(skill, currentSkill)) {
        throw new Error("skill artifact drift");
      }
    }
  } catch {
    throw new CodexSetupBoundaryError(
      "codex-setup-runtime-drift",
      "Codex setup runtime identity changed after planning.",
    );
  }
}

function targetResult(
  plan: CodexProjectSetupPlan,
  target: CodexProjectSetupInspection["target"],
  skillTargets: readonly CodexSkillTargetInspection[],
): CodexProjectSetupInspection {
  return deepFreeze({
    schemaVersion: "1.0.0" as const,
    planDigest: plan.planDigest,
    projectIdentityDigest: plan.project.identityDigest,
    target,
    skillTargets,
    mutationPerformed: false as const,
  });
}

async function finishInspection(
  plan: CodexProjectSetupPlan,
  state: SetupPlanState,
  target: CodexProjectSetupInspection["target"],
  skillTargets: readonly CodexSkillTargetInspection[],
): Promise<CodexProjectSetupInspection> {
  await assertRuntimeState(state);
  return targetResult(plan, target, skillTargets);
}

function targetUnsafe(): never {
  throw new CodexSetupBoundaryError(
    "codex-setup-target-unsafe",
    "Codex project setup target is linked, aliased, or type-conflicted.",
  );
}

function isBudgetError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "cas-budget-exceeded"
  );
}

interface ProjectFileExpectation<Path extends string> {
  readonly path: Path;
  readonly maxBytes: number;
  readonly expectedDigest: Sha256Digest;
}

function parentPaths(path: string): readonly string[] {
  const segments = path.split("/");
  return Object.freeze(
    segments
      .slice(0, -1)
      .map((_, index) => segments.slice(0, index + 1).join("/")),
  );
}

async function inspectProjectFileTarget<Path extends string>(
  root: CanonicalProjectRoot,
  expectation: ProjectFileExpectation<Path>,
): Promise<CodexSetupFileTargetInspection<Path>> {
  for (const parentPath of parentPaths(expectation.path)) {
    let parent;
    try {
      parent = await resolveProjectPath(root, parentPath, {
        expectedType: "directory",
        existence: "optional",
      });
    } catch {
      targetUnsafe();
    }
    if (parent.kind === "absent") {
      return Object.freeze({
        path: expectation.path,
        action: "create" as const,
        code: "target-missing" as const,
        expectedDigest: expectation.expectedDigest,
      });
    }
  }

  let target;
  try {
    target = await resolveProjectPath(root, expectation.path, {
      expectedType: "file",
      existence: "optional",
    });
  } catch {
    targetUnsafe();
  }
  if (target.kind === "absent") {
    return Object.freeze({
      path: expectation.path,
      action: "create" as const,
      code: "target-missing" as const,
      expectedDigest: expectation.expectedDigest,
    });
  }

  let snapshot;
  try {
    snapshot = await readProjectFileSnapshot({
      root,
      path: expectation.path,
      maxBytes: expectation.maxBytes,
    });
  } catch (error) {
    if (isBudgetError(error)) {
      return Object.freeze({
        path: expectation.path,
        action: "conflict" as const,
        code: "target-byte-budget-exceeded" as const,
        expectedDigest: expectation.expectedDigest,
      });
    }
    targetUnsafe();
  }
  const current = snapshot.digest === expectation.expectedDigest;
  return Object.freeze({
    path: expectation.path,
    action: current ? ("retain" as const) : ("conflict" as const),
    code: current
      ? ("target-current" as const)
      : ("target-content-conflict" as const),
    expectedDigest: expectation.expectedDigest,
    actualDigest: snapshot.digest,
    bytes: snapshot.bytes,
  });
}

export async function inspectCodexProjectSetup(
  plan: CodexProjectSetupPlan,
): Promise<CodexProjectSetupInspection> {
  const state = stateFor(plan);
  await assertRuntimeState(state);
  const target = await inspectProjectFileTarget(state.root, {
    path: CODEX_CONFIG_PATH,
    maxBytes: plan.target.maxBytes,
    expectedDigest: plan.target.contentDigest,
  });
  const skillTargets: CodexSkillTargetInspection[] = [];
  for (const skill of plan.skillTargets) {
    const inspected = await inspectProjectFileTarget(state.root, {
      path: skill.path,
      maxBytes: skill.maxBytes,
      expectedDigest: skill.sourceDigest,
    });
    skillTargets.push(
      Object.freeze({ id: skill.id, name: skill.name, ...inspected }),
    );
  }
  return finishInspection(
    plan,
    state,
    target,
    Object.freeze(skillTargets),
  );
}
