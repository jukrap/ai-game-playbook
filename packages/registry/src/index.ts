export { RegistryValidationError } from "./errors.js";
export type {
  RegistryDiagnostic,
  RegistryDiagnosticCode,
} from "./errors.js";
export { generateRegistrySurfaces } from "./generation.js";
export type {
  CliCommandSurface,
  CliSurface,
  DocumentationCommandSurface,
  DocumentationSurface,
  GeneratedArtifact,
  McpSurface,
  McpToolSurface,
  RegistryDefinition,
  RegistrySurfaces,
  SkillRouteSurface,
  SkillRoutingSurface,
  ValidatedRegistry,
} from "./types.js";
export { validateRegistry } from "./validation.js";
