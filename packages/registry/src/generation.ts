import {
  digestCanonicalJson,
  type CommandDescriptor,
  type Sha256Digest,
  type VersionedContractSchema,
} from "@ai-game-playbook/contracts";

import type {
  CliCommandSurface,
  CliSurface,
  DocumentationCommandSurface,
  DocumentationSurface,
  GeneratedArtifact,
  GeneratedSurfaceKind,
  McpSurface,
  McpToolSurface,
  RegistrySurfaces,
  SkillRouteSurface,
  SkillRoutingSurface,
  ValidatedRegistry,
} from "./types.js";
import { assertValidatedRegistry } from "./validation.js";

const writePermissions = new Set([
  "write-project-metadata",
  "write-project-source",
  "editor-control",
  "test-build",
  "install",
  "network",
  "external-transmission",
  "paid-call",
  "destructive",
  "publish-release",
]);
const generatedSurfaceInstances = new WeakSet<object>();
const generatedArtifactInstances = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function artifact<T>(
  kind: GeneratedSurfaceKind,
  sourceRegistryDigest: Sha256Digest,
  data: T,
): GeneratedArtifact<T> {
  const digest = digestCanonicalJson({ kind, sourceRegistryDigest, data });
  const generated = deepFreeze({ kind, sourceRegistryDigest, digest, data });
  generatedArtifactInstances.add(generated);
  return generated;
}

function isPublicCommand(command: CommandDescriptor): boolean {
  return command.lifecycle !== "internal" && command.lifecycle !== "deprecated";
}

function commandIsReadOnly(command: CommandDescriptor): boolean {
  return (
    command.sideEffects.every(({ kind }) => kind === "none") &&
    command.permissions.every((permission) => !writePermissions.has(permission))
  );
}

function mcpToolName(commandId: string): string {
  return `agpb_${commandId.replaceAll(".", "__").replaceAll("-", "_")}`;
}

function commandTitle(command: CommandDescriptor): string {
  return command.cli.path
    .map((segment) =>
      segment
        .split("-")
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(" "),
    )
    .join(" · ");
}

function cliCommand(command: CommandDescriptor): CliCommandSurface {
  return command;
}

function documentationCommand(
  command: CommandDescriptor,
): DocumentationCommandSurface {
  return {
    ...cliCommand(command),
    usage: `agpb ${command.cli.path.join(" ")}`,
    permissions: command.permissions,
    requiredEvidence: command.requiredEvidence,
  };
}

function mcpTool(
  command: CommandDescriptor,
  schemas: ReadonlyMap<string, VersionedContractSchema>,
): McpToolSurface {
  const input = schemas.get(command.input.schemaId);
  const output = schemas.get(command.output.schemaId);
  if (input === undefined || output === undefined) {
    throw new TypeError(`validated registry lost schema binding for ${command.id}`);
  }

  const readOnly = commandIsReadOnly(command);
  return {
    commandId: command.id,
    name: mcpToolName(command.id),
    enabledByDefault: readOnly && command.lifecycle === "stable",
    title: commandTitle(command),
    description: command.summary,
    inputSchemaId: input.schemaId,
    inputDigest: input.digest,
    inputSchema: input.schema,
    outputSchemaId: output.schemaId,
    outputDigest: output.digest,
    outputSchema: output.schema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: command.permissions.includes("destructive"),
      idempotentHint:
        readOnly ||
        command.retry.mode === "read-only" ||
        command.retry.mode === "proven-idempotent",
      openWorldHint: command.sideEffects.some(
        ({ boundary }) => boundary === "network" || boundary === "external",
      ),
    },
    meta: {
      permissionAuthority: "agpb-broker",
      requiresApply: !readOnly,
      permissions: command.permissions,
      lane: command.lane,
      command: cliCommand(command),
    },
  };
}

function skillRoutes(registry: ValidatedRegistry): readonly SkillRouteSurface[] {
  return registry.skills
    .filter(
      (skill) =>
        skill.lifecycle === "stable" &&
        (skill.invocation === "model" || skill.invocation === "both"),
    )
    .map((skill) => skill);
}

export function generateRegistrySurfaces(
  registry: ValidatedRegistry,
): RegistrySurfaces {
  assertValidatedRegistry(registry);
  const commands = registry.commands.filter(isPublicCommand);
  const schemas = new Map(
    registry.schemas.map((schema) => [schema.schemaId, schema]),
  );
  const cliData: CliSurface = {
    executable: "agpb",
    controlPlaneVersion: registry.controlPlaneVersion,
    commands: commands.map(cliCommand),
  };
  const mcpData: McpSurface = {
    protocolRevision: "2026-07-28",
    lifecycle: "stateless",
    controlPlaneVersion: registry.controlPlaneVersion,
    extensions: [],
    tools: commands.map((command) => mcpTool(command, schemas)),
  };
  const docsData: DocumentationSurface = {
    controlPlaneVersion: registry.controlPlaneVersion,
    commands: commands.map(documentationCommand),
  };
  const skillsData: SkillRoutingSurface = {
    controlPlaneVersion: registry.controlPlaneVersion,
    routes: skillRoutes(registry),
  };

  const surfaces = deepFreeze({
    registryDigest: registry.digest,
    cli: artifact("cli", registry.digest, cliData),
    mcp: artifact("mcp", registry.digest, mcpData),
    docs: artifact("docs", registry.digest, docsData),
    skills: artifact("skills", registry.digest, skillsData),
  });
  generatedSurfaceInstances.add(surfaces);
  return surfaces;
}

export function assertGeneratedRegistrySurfaces(
  value: unknown,
): asserts value is RegistrySurfaces {
  if (
    value === null ||
    typeof value !== "object" ||
    !generatedSurfaceInstances.has(value)
  ) {
    throw new TypeError(
      "surfaces must be produced by generateRegistrySurfaces in this process",
    );
  }
}

export function assertGeneratedArtifact(
  value: unknown,
): asserts value is GeneratedArtifact<unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    !generatedArtifactInstances.has(value)
  ) {
    throw new TypeError(
      "artifact must be produced by generateRegistrySurfaces in this process",
    );
  }
}
