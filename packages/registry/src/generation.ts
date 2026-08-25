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
  kind: string,
  sourceRegistryDigest: Sha256Digest,
  data: T,
): GeneratedArtifact<T> {
  const digest = digestCanonicalJson({ kind, sourceRegistryDigest, data });
  return deepFreeze({ sourceRegistryDigest, digest, data });
}

function isPublicCommand(command: CommandDescriptor): boolean {
  return command.lifecycle !== "internal";
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
  return {
    id: command.id,
    version: command.version,
    lifecycle: command.lifecycle,
    summary: command.summary,
    path: command.cli.path,
    aliases: command.cli.aliases,
    input: command.input,
    output: command.output,
  };
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
    enabledByDefault: readOnly,
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
    .map((skill) => ({
      id: skill.id,
      version: skill.version,
      summary: skill.summary,
      triggers: skill.triggers,
      exclusions: skill.exclusions,
    }));
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
    commands: commands.map(cliCommand),
  };
  const mcpData: McpSurface = {
    protocolRevision: "2026-07-28",
    lifecycle: "stateless",
    extensions: [],
    tools: commands.map((command) => mcpTool(command, schemas)),
  };
  const docsData: DocumentationSurface = {
    commands: commands.map(documentationCommand),
  };
  const skillsData: SkillRoutingSurface = {
    routes: skillRoutes(registry),
  };

  return deepFreeze({
    registryDigest: registry.digest,
    cli: artifact("cli", registry.digest, cliData),
    mcp: artifact("mcp", registry.digest, mcpData),
    docs: artifact("docs", registry.digest, docsData),
    skills: artifact("skills", registry.digest, skillsData),
  });
}
