export { CoreBoundaryError } from "./errors.js";
export type { CoreBoundaryErrorCode } from "./errors.js";
export {
  assertProjectRootIdentity,
  canonicalizeProjectRoot,
  resolveProjectPath,
} from "./project-path.js";
export type {
  CanonicalProjectRoot,
  FilesystemIdentity,
  ResolvedProjectPath,
  ResolvedProjectPathKind,
  ResolveProjectPathOptions,
} from "./project-path.js";
