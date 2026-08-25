import { createHash } from "node:crypto";

import { canonicalizeJson } from "./canonical-json.js";
import { ContractValueError } from "./errors.js";

declare const sha256DigestBrand: unique symbol;

export type Sha256Digest = `sha256:${string}` & {
  readonly [sha256DigestBrand]: true;
};

export type Sha256Input = string | Uint8Array;

const sha256DigestPattern = /^sha256:[0-9a-f]{64}$/;

export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && sha256DigestPattern.test(value);
}

export function parseSha256Digest(
  value: unknown,
  path = "$digest",
): Sha256Digest {
  if (!isSha256Digest(value)) {
    throw new ContractValueError(
      "invalid-sha256-digest",
      path,
      "expected sha256: followed by 64 lowercase hexadecimal characters",
    );
  }

  return value;
}

export function sha256Digest(input: Sha256Input): Sha256Digest {
  if (typeof input !== "string" && !(input instanceof Uint8Array)) {
    throw new ContractValueError(
      "invalid-sha256-input",
      "$input",
      "expected a UTF-8 string or Uint8Array",
    );
  }

  const hexadecimal = createHash("sha256").update(input).digest("hex");
  return `sha256:${hexadecimal}` as Sha256Digest;
}

export function digestCanonicalJson(value: unknown): Sha256Digest {
  return sha256Digest(canonicalizeJson(value));
}
