import { ContractValueError } from "./errors.js";

declare const portableProjectPathBrand: unique symbol;

export type PortableProjectPath = string & {
  readonly [portableProjectPathBrand]: true;
};

export const PORTABLE_PROJECT_PATH_MAX_LENGTH: number = 512;
export const PORTABLE_PROJECT_PATH_MAX_SEGMENT_LENGTH: number = 255;

const windowsReservedPathSegment =
  "(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][1-9]|[Ll][Pp][Tt][1-9])(?:\\.[A-Za-z0-9._-]*)?";

export const PORTABLE_PROJECT_PATH_PATTERN: string =
  "^(?!/)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)" +
  `(?!.*(?:^|/)${windowsReservedPathSegment}(?:/|$))` +
  "(?!.*\\.(?:/|$))(?:[A-Za-z0-9._-]{1,255}/)*[A-Za-z0-9._-]{1,255}$";

const portableProjectPathRegex = new RegExp(PORTABLE_PROJECT_PATH_PATTERN);

export function isPortableProjectPath(
  value: unknown,
): value is PortableProjectPath {
  return (
    typeof value === "string" &&
    value.length <= PORTABLE_PROJECT_PATH_MAX_LENGTH &&
    portableProjectPathRegex.test(value)
  );
}

export function parsePortableProjectPath(
  value: unknown,
  path = "$path",
): PortableProjectPath {
  if (!isPortableProjectPath(value)) {
    throw new ContractValueError(
      "invalid-portable-project-path",
      path,
      "expected a bounded portable project-relative path",
    );
  }

  return value;
}
