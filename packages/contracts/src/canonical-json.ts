import { ContractValueError } from "./errors.js";

export type CanonicalJsonPrimitive = null | boolean | number | string;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export const CANONICAL_JSON_MAX_DEPTH = 128;
export const CANONICAL_JSON_MAX_CONTAINER_ENTRIES = 100_000;
export const CANONICAL_JSON_MAX_NODES = 1_000_000;

interface SerializationState {
  readonly ancestors: Set<object>;
  nodes: number;
}

export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidCanonicalJson(
  path: string,
  reason: string,
): ContractValueError {
  return new ContractValueError("invalid-canonical-json", path, reason);
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }

  return false;
}

function serializeString(value: string, path: string): string {
  if (hasLoneSurrogate(value)) {
    throw invalidCanonicalJson(path, "lone UTF-16 surrogate is not allowed");
  }

  return JSON.stringify(value);
}

function serializeArray(
  value: readonly unknown[],
  path: string,
  depth: number,
  state: SerializationState,
): string {
  if (value.length > CANONICAL_JSON_MAX_CONTAINER_ENTRIES) {
    throw invalidCanonicalJson(
      path,
      `array exceeds ${CANONICAL_JSON_MAX_CONTAINER_ENTRIES} entries`,
    );
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw invalidCanonicalJson(path, "symbol array properties are not allowed");
  }

  if (ownKeys.length !== value.length + 1) {
    throw invalidCanonicalJson(
      path,
      "sparse arrays and custom array properties are not allowed",
    );
  }

  const items: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw invalidCanonicalJson(
        `${path}[${index}]`,
        "array elements must be enumerable data properties",
      );
    }
    items.push(
      serialize(descriptor.value, `${path}[${index}]`, depth + 1, state),
    );
  }

  return `[${items.join(",")}]`;
}

function serializeObject(
  value: object,
  path: string,
  depth: number,
  state: SerializationState,
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidCanonicalJson(path, "expected a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalidCanonicalJson(path, "symbol object properties are not allowed");
  }

  const entries: string[] = [];
  const keys = Object.getOwnPropertyNames(value).sort(compareCanonicalText);
  if (keys.length > CANONICAL_JSON_MAX_CONTAINER_ENTRIES) {
    throw invalidCanonicalJson(
      path,
      `object exceeds ${CANONICAL_JSON_MAX_CONTAINER_ENTRIES} fields`,
    );
  }
  for (const key of keys) {
    if (hasLoneSurrogate(key)) {
      throw invalidCanonicalJson(path, "object key contains a lone surrogate");
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const childPath = `${path}[${serializeString(key, path)}]`;
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw invalidCanonicalJson(
        childPath,
        "object entries must be enumerable data properties",
      );
    }

    entries.push(
      `${serializeString(key, path)}:${serialize(
        descriptor.value,
        childPath,
        depth + 1,
        state,
      )}`,
    );
  }

  return `{${entries.join(",")}}`;
}

function serialize(
  value: unknown,
  path: string,
  depth: number,
  state: SerializationState,
): string {
  if (depth > CANONICAL_JSON_MAX_DEPTH) {
    throw invalidCanonicalJson(
      path,
      `nesting exceeds ${CANONICAL_JSON_MAX_DEPTH} levels`,
    );
  }
  state.nodes += 1;
  if (state.nodes > CANONICAL_JSON_MAX_NODES) {
    throw invalidCanonicalJson(
      path,
      `value contains more than ${CANONICAL_JSON_MAX_NODES} nodes`,
    );
  }

  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw invalidCanonicalJson(path, "number must be finite");
      }
      return JSON.stringify(value);
    }
    case "string":
      return serializeString(value, path);
    case "object": {
      if (state.ancestors.has(value)) {
        throw invalidCanonicalJson(path, "circular value is not allowed");
      }

      state.ancestors.add(value);
      try {
        return Array.isArray(value)
          ? serializeArray(value, path, depth, state)
          : serializeObject(value, path, depth, state);
      } finally {
        state.ancestors.delete(value);
      }
    }
    default:
      throw invalidCanonicalJson(
        path,
        `unsupported JSON value type: ${typeof value}`,
      );
  }
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value, "$", 0, {
    ancestors: new Set<object>(),
    nodes: 0,
  });
}
