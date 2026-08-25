import { ContractValueError } from "./errors.js";

declare const stableIdBrand: unique symbol;

export type StableId = string & { readonly [stableIdBrand]: true };

const stableIdPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const stableIdMaxLength = 128;

export function isStableId(value: unknown): value is StableId {
  return (
    typeof value === "string" &&
    value.length <= stableIdMaxLength &&
    stableIdPattern.test(value)
  );
}

export function parseStableId(value: unknown, path = "$id"): StableId {
  if (!isStableId(value)) {
    throw new ContractValueError(
      "invalid-stable-id",
      path,
      "expected 1-128 lowercase ASCII characters with dot or hyphen separators",
    );
  }

  return value;
}
