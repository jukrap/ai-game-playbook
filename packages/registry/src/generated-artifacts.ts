import {
  canonicalizeJson,
  digestCanonicalJson,
  sha256Digest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

import {
  assertGeneratedArtifact,
  assertGeneratedRegistrySurfaces,
} from "./generation.js";
import type {
  GeneratedArtifact,
  GeneratedFileCheck,
  GeneratedFileFailureCheck,
  GeneratedSurfaceFile,
  GeneratedSurfacePath,
  RegistrySurfaces,
} from "./types.js";

export type GeneratedArtifactDriftErrorCode =
  | "generated-artifact-missing"
  | "generated-artifact-drift";

export class GeneratedArtifactDriftError extends Error {
  readonly code: GeneratedArtifactDriftErrorCode;
  readonly check: GeneratedFileFailureCheck;

  constructor(check: GeneratedFileFailureCheck) {
    const runtimeStatus = (check as GeneratedFileCheck).status;
    if (runtimeStatus === "current") {
      throw new TypeError("cannot create a drift error for a current generated file");
    }
    const code =
      check.status === "missing"
        ? "generated-artifact-missing"
        : "generated-artifact-drift";
    super(`${check.path}: ${check.status}`);
    this.name = "GeneratedArtifactDriftError";
    this.code = code;
    this.check = Object.freeze({ ...check });
  }
}

const generatedFileInstances = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function assertArtifactDigest(artifact: GeneratedArtifact<unknown>): void {
  const actual = digestCanonicalJson({
    kind: artifact.kind,
    sourceRegistryDigest: artifact.sourceRegistryDigest,
    data: artifact.data,
  });
  if (actual !== artifact.digest) {
    throw new TypeError(`generated ${artifact.kind} artifact digest is invalid`);
  }
}

export function serializeGeneratedArtifact(
  artifact: GeneratedArtifact<unknown>,
): string {
  assertGeneratedArtifact(artifact);
  assertArtifactDigest(artifact);
  return `${canonicalizeJson(artifact)}\n`;
}

function generatedFile(
  path: GeneratedSurfacePath,
  artifact: GeneratedArtifact<unknown>,
): GeneratedSurfaceFile {
  const content = serializeGeneratedArtifact(artifact);
  const file = deepFreeze({
    path,
    sourceRegistryDigest: artifact.sourceRegistryDigest,
    artifactDigest: artifact.digest,
    contentDigest: sha256Digest(content),
    content,
  });
  generatedFileInstances.add(file);
  return file;
}

export function materializeRegistrySurfaces(
  surfaces: RegistrySurfaces,
): readonly GeneratedSurfaceFile[] {
  assertGeneratedRegistrySurfaces(surfaces);
  return deepFreeze([
    generatedFile("generated/cli.json", surfaces.cli),
    generatedFile("generated/docs.json", surfaces.docs),
    generatedFile("generated/mcp.json", surfaces.mcp),
    generatedFile("generated/skills.json", surfaces.skills),
  ]);
}

function firstDifference(left: string, right: string): number | undefined {
  const maximum = Math.min(left.length, right.length);
  for (let index = 0; index < maximum; index += 1) {
    if (left[index] !== right[index]) {
      return index;
    }
  }
  return left.length === right.length ? undefined : maximum;
}

export function checkGeneratedFile(
  actualContent: string | undefined,
  expected: GeneratedSurfaceFile,
): GeneratedFileCheck {
  if (!generatedFileInstances.has(expected)) {
    throw new TypeError(
      "expected file must be produced by materializeRegistrySurfaces in this process",
    );
  }
  if (actualContent === undefined) {
    return Object.freeze({
      status: "missing",
      path: expected.path,
      expectedDigest: expected.contentDigest,
    });
  }

  const actualDigest: Sha256Digest = sha256Digest(actualContent);
  if (actualDigest === expected.contentDigest && actualContent === expected.content) {
    return Object.freeze({
      status: "current",
      path: expected.path,
      expectedDigest: expected.contentDigest,
      actualDigest,
    });
  }
  const differenceOffset = firstDifference(actualContent, expected.content);
  return Object.freeze({
    status: "drift",
    path: expected.path,
    expectedDigest: expected.contentDigest,
    actualDigest,
    ...(differenceOffset === undefined
      ? {}
      : { firstDifferenceOffset: differenceOffset }),
  });
}

export function assertGeneratedFileCurrent(
  actualContent: string | undefined,
  expected: GeneratedSurfaceFile,
): void {
  const check = checkGeneratedFile(actualContent, expected);
  if (check.status !== "current") {
    throw new GeneratedArtifactDriftError(check);
  }
}
