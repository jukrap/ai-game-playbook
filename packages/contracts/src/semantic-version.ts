import { ContractValueError } from "./errors.js";

declare const semanticVersionBrand: unique symbol;

export type SemanticVersion = string & {
  readonly [semanticVersionBrand]: true;
};

export interface SemanticVersionParts {
  readonly value: SemanticVersion;
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

export type VersionComparison = -1 | 0 | 1;

const semanticVersionPattern =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function invalidVersion(path: string): ContractValueError {
  return new ContractValueError(
    "invalid-semantic-version",
    path,
    "expected a canonical Semantic Version 2.0.0 string",
  );
}

export function parseSemanticVersion(
  value: unknown,
  path = "$version",
): SemanticVersionParts {
  if (typeof value !== "string") {
    throw invalidVersion(path);
  }

  const match = semanticVersionPattern.exec(value);
  if (match === null) {
    throw invalidVersion(path);
  }

  const prerelease = match[4]?.split(".") ?? [];
  if (
    prerelease.some(
      (identifier) =>
        /^[0-9]+$/.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    throw invalidVersion(path);
  }

  return {
    value: value as SemanticVersion,
    major: match[1] ?? "0",
    minor: match[2] ?? "0",
    patch: match[3] ?? "0",
    prerelease,
    build: match[5]?.split(".") ?? [],
  };
}

function compareNumericText(left: string, right: string): VersionComparison {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function comparePrereleaseIdentifier(
  left: string,
  right: string,
): VersionComparison {
  const leftIsNumeric = /^[0-9]+$/.test(left);
  const rightIsNumeric = /^[0-9]+$/.test(right);

  if (leftIsNumeric && rightIsNumeric) {
    return compareNumericText(left, right);
  }
  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function comparePrerelease(
  left: readonly string[],
  right: readonly string[],
): VersionComparison {
  if (left.length === 0 || right.length === 0) {
    if (left.length === right.length) {
      return 0;
    }
    return left.length === 0 ? 1 : -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1;
    }

    const comparison = comparePrereleaseIdentifier(
      leftIdentifier,
      rightIdentifier,
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function compareSemanticVersions(
  left: unknown,
  right: unknown,
): VersionComparison {
  const leftVersion = parseSemanticVersion(left, "$leftVersion");
  const rightVersion = parseSemanticVersion(right, "$rightVersion");

  for (const key of ["major", "minor", "patch"] as const) {
    const comparison = compareNumericText(
      leftVersion[key],
      rightVersion[key],
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}
