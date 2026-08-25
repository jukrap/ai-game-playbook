import type {
  CommandDescriptor,
  PackManifest,
  RoleLensDescriptor,
  SemanticVersion,
  Sha256Digest,
  SkillDescriptor,
  VersionedContractSchema,
  WorkflowDescriptor,
} from "@ai-game-playbook/contracts";

export interface RegistryDefinition {
  readonly schemaVersion: SemanticVersion;
  readonly controlPlaneVersion: SemanticVersion;
  readonly schemas: readonly VersionedContractSchema[];
  readonly commands: readonly CommandDescriptor[];
  readonly skills: readonly SkillDescriptor[];
  readonly roleLenses: readonly RoleLensDescriptor[];
  readonly workflows: readonly WorkflowDescriptor[];
  readonly packs: readonly PackManifest[];
}

export interface ValidatedRegistry extends RegistryDefinition {
  readonly digest: Sha256Digest;
}

export type GeneratedSurfaceKind = "cli" | "docs" | "mcp" | "skills";

export interface GeneratedArtifact<T> {
  readonly kind: GeneratedSurfaceKind;
  readonly sourceRegistryDigest: Sha256Digest;
  readonly digest: Sha256Digest;
  readonly data: T;
}

export type GeneratedSurfacePath =
  | "generated/cli.json"
  | "generated/docs.json"
  | "generated/mcp.json"
  | "generated/skills.json";

export interface GeneratedSurfaceFile {
  readonly path: GeneratedSurfacePath;
  readonly sourceRegistryDigest: Sha256Digest;
  readonly artifactDigest: Sha256Digest;
  readonly contentDigest: Sha256Digest;
  readonly content: string;
}

interface GeneratedFileCheckBase {
  readonly path: GeneratedSurfacePath;
  readonly expectedDigest: Sha256Digest;
}

export type GeneratedFileCheck =
  | (GeneratedFileCheckBase & {
      readonly status: "current";
      readonly actualDigest: Sha256Digest;
    })
  | (GeneratedFileCheckBase & {
      readonly status: "missing";
    })
  | (GeneratedFileCheckBase & {
      readonly status: "drift";
      readonly actualDigest: Sha256Digest;
      readonly firstDifferenceOffset?: number;
    });

export type GeneratedFileFailureCheck = Extract<
  GeneratedFileCheck,
  { readonly status: "missing" | "drift" }
>;

export interface CliCommandSurface extends CommandDescriptor {}

export interface CliSurface {
  readonly executable: "agpb";
  readonly controlPlaneVersion: string;
  readonly commands: readonly CliCommandSurface[];
}

export interface McpToolSurface {
  readonly commandId: string;
  readonly name: string;
  readonly enabledByDefault: boolean;
  readonly title: string;
  readonly description: string;
  readonly inputSchemaId: string;
  readonly inputDigest: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchemaId: string;
  readonly outputDigest: string;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly idempotentHint: boolean;
    readonly openWorldHint: boolean;
  };
  readonly meta: {
    readonly permissionAuthority: "agpb-broker";
    readonly requiresApply: boolean;
    readonly permissions: readonly string[];
    readonly lane: string;
    readonly command: CliCommandSurface;
  };
}

export interface McpSurface {
  readonly protocolRevision: "2026-07-28";
  readonly lifecycle: "stateless";
  readonly controlPlaneVersion: string;
  readonly extensions: readonly string[];
  readonly tools: readonly McpToolSurface[];
}

export interface DocumentationCommandSurface extends CliCommandSurface {
  readonly usage: string;
}

export interface DocumentationSurface {
  readonly controlPlaneVersion: string;
  readonly commands: readonly DocumentationCommandSurface[];
}

export interface SkillRouteSurface extends SkillDescriptor {}

export interface SkillRoutingSurface {
  readonly controlPlaneVersion: string;
  readonly routes: readonly SkillRouteSurface[];
}

export interface RegistrySurfaces {
  readonly registryDigest: Sha256Digest;
  readonly cli: GeneratedArtifact<CliSurface>;
  readonly mcp: GeneratedArtifact<McpSurface>;
  readonly docs: GeneratedArtifact<DocumentationSurface>;
  readonly skills: GeneratedArtifact<SkillRoutingSurface>;
}
