export { RegistryValidationError } from "./errors.js";
export type {
  RegistryDiagnostic,
  RegistryDiagnosticCode,
} from "./errors.js";
export { generateRegistrySurfaces } from "./generation.js";
export {
  GeneratedArtifactDriftError,
  assertGeneratedFileCurrent,
  checkGeneratedFile,
  materializeRegistrySurfaces,
  serializeGeneratedArtifact,
} from "./generated-artifacts.js";
export type { GeneratedArtifactDriftErrorCode } from "./generated-artifacts.js";
export type {
  CliCommandSurface,
  CliSurface,
  DocumentationCommandSurface,
  DocumentationSurface,
  GeneratedArtifact,
  GeneratedFileCheck,
  GeneratedFileFailureCheck,
  GeneratedSurfaceFile,
  GeneratedSurfaceKind,
  GeneratedSurfacePath,
  McpSurface,
  McpToolSurface,
  RegistryDefinition,
  RegistrySurfaces,
  SkillRouteSurface,
  SkillRoutingSurface,
  ValidatedRegistry,
} from "./types.js";
export { validateRegistry } from "./validation.js";
