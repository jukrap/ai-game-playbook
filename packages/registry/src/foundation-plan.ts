import {
  canonicalizeJson,
  digestCanonicalJson,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

import {
  BUILTIN_REGISTRY,
  BUILTIN_REGISTRY_SURFACES,
} from "./builtin-registry.js";

export interface PlannedCommandSurface {
  readonly id: string;
  readonly cliPath: readonly string[];
  readonly syntax: string;
  readonly capability: string;
  readonly availability: "available" | "planned";
}

export interface PlannedSkillSurface {
  readonly id: string;
  readonly capability: string;
  readonly availability: "available" | "planned";
  readonly mode: "general" | "planning-check";
  readonly engine?: "godot" | "unity" | "unreal";
}

export interface FoundationPlanData {
  readonly implementationStatus: "partial";
  readonly executableAvailable: true;
  readonly runtimeRegistryDigest: Sha256Digest;
  readonly package: {
    readonly npm: "ai-game-playbook";
    readonly executable: "agpb";
  };
  readonly commands: readonly PlannedCommandSurface[];
  readonly skills: readonly PlannedSkillSurface[];
}

const availableCommandIds: ReadonlySet<string> = new Set(
  BUILTIN_REGISTRY.commands.map(({ id }) => id),
);
const availableSkillIds: ReadonlySet<string> = new Set(
  BUILTIN_REGISTRY_SURFACES.skills.data.routes.map(({ id }) => id),
);

function commandAvailability(id: string): "available" | "planned" {
  return availableCommandIds.has(id) ? "available" : "planned";
}

function skillAvailability(id: string): "available" | "planned" {
  return availableSkillIds.has(id) ? "available" : "planned";
}

export interface FoundationPlanArtifact {
  readonly schemaVersion: "1.0.0";
  readonly artifact: "ai-game-playbook-foundation-plan";
  readonly digest: Sha256Digest;
  readonly data: FoundationPlanData;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

const commands: readonly PlannedCommandSurface[] = [
  {
    id: "init",
    cliPath: ["init"],
    syntax: "agpb init",
    capability: "workspace.init",
    availability: commandAvailability("init"),
  },
  {
    id: "doctor",
    cliPath: ["doctor"],
    syntax: "agpb doctor",
    capability: "workspace.doctor",
    availability: commandAvailability("doctor"),
  },
  {
    id: "project.inspect",
    cliPath: ["project", "inspect"],
    syntax: "agpb project inspect",
    capability: "project.inspect",
    availability: commandAvailability("project.inspect"),
  },
  {
    id: "pack.list",
    cliPath: ["pack", "list"],
    syntax: "agpb pack list",
    capability: "pack.list",
    availability: commandAvailability("pack.list"),
  },
  {
    id: "pack.add",
    cliPath: ["pack", "add"],
    syntax: "agpb pack add",
    capability: "pack.add",
    availability: commandAvailability("pack.add"),
  },
  {
    id: "pack.update",
    cliPath: ["pack", "update"],
    syntax: "agpb pack update",
    capability: "pack.update",
    availability: commandAvailability("pack.update"),
  },
  {
    id: "pack.remove",
    cliPath: ["pack", "remove"],
    syntax: "agpb pack remove",
    capability: "pack.remove",
    availability: commandAvailability("pack.remove"),
  },
  {
    id: "pack.doctor",
    cliPath: ["pack", "doctor"],
    syntax: "agpb pack doctor",
    capability: "pack.doctor",
    availability: commandAvailability("pack.doctor"),
  },
  {
    id: "skill.list",
    cliPath: ["skill", "list"],
    syntax: "agpb skill list",
    capability: "skill.list",
    availability: commandAvailability("skill.list"),
  },
  {
    id: "skill.install",
    cliPath: ["skill", "install"],
    syntax: "agpb skill install",
    capability: "skill.install",
    availability: commandAvailability("skill.install"),
  },
  {
    id: "skill.check",
    cliPath: ["skill", "check"],
    syntax: "agpb skill check",
    capability: "skill.check",
    availability: commandAvailability("skill.check"),
  },
  {
    id: "engine.status",
    cliPath: ["engine", "status"],
    syntax: "agpb engine status",
    capability: "engine.status",
    availability: commandAvailability("engine.status"),
  },
  {
    id: "engine.capabilities",
    cliPath: ["engine", "capabilities"],
    syntax: "agpb engine capabilities",
    capability: "engine.capabilities",
    availability: commandAvailability("engine.capabilities"),
  },
  {
    id: "engine.connect",
    cliPath: ["engine", "connect"],
    syntax: "agpb engine connect",
    capability: "engine.connect",
    availability: commandAvailability("engine.connect"),
  },
  {
    id: "run",
    cliPath: ["run"],
    syntax: "agpb run <workflow>",
    capability: "workflow.run",
    availability: commandAvailability("run"),
  },
  {
    id: "verify",
    cliPath: ["verify"],
    syntax: "agpb verify",
    capability: "feature.verify",
    availability: commandAvailability("verify"),
  },
  {
    id: "evidence.list",
    cliPath: ["evidence", "list"],
    syntax: "agpb evidence list",
    capability: "evidence.list",
    availability: commandAvailability("evidence.list"),
  },
  {
    id: "evidence.show",
    cliPath: ["evidence", "show"],
    syntax: "agpb evidence show",
    capability: "evidence.show",
    availability: commandAvailability("evidence.show"),
  },
  {
    id: "evidence.export",
    cliPath: ["evidence", "export"],
    syntax: "agpb evidence export",
    capability: "evidence.export",
    availability: commandAvailability("evidence.export"),
  },
  {
    id: "docs.check",
    cliPath: ["docs", "check"],
    syntax: "agpb docs check",
    capability: "docs.check",
    availability: commandAvailability("docs.check"),
  },
];

const skills: readonly PlannedSkillSurface[] = [
  {
    id: "project.inspection",
    capability: "project.inspect",
    availability: skillAvailability("project.inspection"),
    mode: "general",
  },
  {
    id: "feature.contract-planning",
    capability: "feature.contract",
    availability: skillAvailability("feature.contract-planning"),
    mode: "general",
  },
  {
    id: "gameplay.vertical-slice",
    capability: "gameplay.vertical-slice",
    availability: skillAvailability("gameplay.vertical-slice"),
    mode: "general",
  },
  {
    id: "save-load.integrity",
    capability: "gameplay.save-load",
    availability: skillAvailability("save-load.integrity"),
    mode: "general",
  },
  {
    id: "ui.game-qa",
    capability: "ui.qa",
    availability: skillAvailability("ui.game-qa"),
    mode: "general",
  },
  {
    id: "playtest.deterministic",
    capability: "playtest.deterministic",
    availability: skillAvailability("playtest.deterministic"),
    mode: "general",
  },
  {
    id: "evidence.support-review",
    capability: "evidence.review",
    availability: skillAvailability("evidence.support-review"),
    mode: "general",
  },
  {
    id: "performance.budget-review",
    capability: "performance.review",
    availability: skillAvailability("performance.budget-review"),
    mode: "general",
  },
  {
    id: "asset.lifecycle",
    capability: "asset.provenance",
    availability: skillAvailability("asset.lifecycle"),
    mode: "general",
  },
  {
    id: "build.export-readiness",
    capability: "build.export",
    availability: skillAvailability("build.export-readiness"),
    mode: "general",
  },
  {
    id: "engine.change-safety",
    capability: "engine.change-safety",
    availability: skillAvailability("engine.change-safety"),
    mode: "general",
  },
  {
    id: "engine.godot-operation",
    capability: "engine.godot.operation",
    availability: "planned",
    mode: "planning-check",
    engine: "godot",
  },
  {
    id: "engine.unity-operation",
    capability: "engine.unity.operation",
    availability: "planned",
    mode: "planning-check",
    engine: "unity",
  },
  {
    id: "engine.unreal-operation",
    capability: "engine.unreal.operation",
    availability: "planned",
    mode: "planning-check",
    engine: "unreal",
  },
];

const planData = deepFreeze<FoundationPlanData>({
  implementationStatus: "partial",
  executableAvailable: true,
  runtimeRegistryDigest: BUILTIN_REGISTRY.digest,
  package: { npm: "ai-game-playbook", executable: "agpb" },
  commands,
  skills,
});
const unsignedArtifact = deepFreeze({
  schemaVersion: "1.0.0" as const,
  artifact: "ai-game-playbook-foundation-plan" as const,
  data: planData,
});

export const FOUNDATION_PLAN_ARTIFACT: FoundationPlanArtifact = deepFreeze({
  ...unsignedArtifact,
  digest: digestCanonicalJson(unsignedArtifact),
});

export function serializeFoundationPlanArtifact(): string {
  return `${canonicalizeJson(FOUNDATION_PLAN_ARTIFACT)}\n`;
}
