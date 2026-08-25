import { Buffer } from "node:buffer";

import {
  canonicalizeJson,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import { ContractValueError } from "./errors.js";
import {
  parseSemanticVersion,
  type SemanticVersion,
} from "./semantic-version.js";
import { isStableId, parseStableId, type StableId } from "./stable-id.js";

export const CONTRACT_SCHEMA_DRAFT =
  "https://json-schema.org/draft/2020-12/schema" as const;
export const CONTRACT_SCHEMA_MAX_BYTES = 1_048_576;

export type ContractSchemaId =
  `urn:ai-game-playbook:schema:${string}:${string}`;

export interface ContractSchemaDefinition {
  readonly id: unknown;
  readonly version: unknown;
  readonly title: unknown;
  readonly description?: unknown;
  readonly schema: unknown;
}

export type JsonSchemaObject = Readonly<
  Record<string, CanonicalJsonValue>
>;

export interface RootContractSchema extends JsonSchemaObject {
  readonly $schema: typeof CONTRACT_SCHEMA_DRAFT;
  readonly $id: ContractSchemaId;
  readonly title: string;
  readonly description?: string;
  readonly type: "object";
  readonly additionalProperties: false;
}

export interface VersionedContractSchema {
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly schemaId: ContractSchemaId;
  readonly schema: RootContractSchema;
  readonly digest: Sha256Digest;
}

function invalidSchema(path: string, reason: string): ContractValueError {
  return new ContractValueError("invalid-contract-schema", path, reason);
}

function dataRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSchema(path, "expected a plain object");
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidSchema(path, "expected a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw invalidSchema(path, "symbol properties are not allowed");
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw invalidSchema(
        `${path}[${JSON.stringify(key)}]`,
        "entries must be enumerable data properties",
      );
    }
  }

  return value as Record<string, unknown>;
}

function ownValue(
  record: Record<string, unknown>,
  key: string,
  path: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw invalidSchema(path, "required field is missing");
  }
  return descriptor.value;
}

function boundedText(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw invalidSchema(
      path,
      `expected 1-${maximumLength} printable characters`,
    );
  }

  try {
    canonicalizeJson(value);
  } catch {
    throw invalidSchema(path, "expected valid Unicode text");
  }
  return value;
}

function deepFreeze<T extends CanonicalJsonValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value)
      ? value
      : Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function normalizedBody(value: unknown): Record<string, CanonicalJsonValue> {
  const body = dataRecord(value, "$definition.schema");
  for (const reservedKey of ["$schema", "$id", "title", "description"]) {
    if (Object.hasOwn(body, reservedKey)) {
      throw invalidSchema(
        `$definition.schema[${JSON.stringify(reservedKey)}]`,
        "identity metadata is assigned by defineContractSchema",
      );
    }
  }

  let serialized: string;
  try {
    serialized = canonicalizeJson(body);
  } catch (error) {
    throw invalidSchema(
      "$definition.schema",
      error instanceof Error ? error.message : "schema is not canonical JSON",
    );
  }

  if (Buffer.byteLength(serialized, "utf8") > CONTRACT_SCHEMA_MAX_BYTES) {
    throw invalidSchema(
      "$definition.schema",
      `schema exceeds ${CONTRACT_SCHEMA_MAX_BYTES} UTF-8 bytes`,
    );
  }

  const clone = JSON.parse(serialized) as Record<string, CanonicalJsonValue>;
  if (clone["type"] !== "object") {
    throw invalidSchema(
      '$definition.schema["type"]',
      'root contract schema type must be "object"',
    );
  }
  if (clone["additionalProperties"] !== false) {
    throw invalidSchema(
      '$definition.schema["additionalProperties"]',
      "root contract schema must reject additional properties",
    );
  }

  return clone;
}

export function defineContractSchema(
  definition: ContractSchemaDefinition,
): VersionedContractSchema {
  const record = dataRecord(definition, "$definition");
  const idValue = ownValue(record, "id", "$definition.id");
  if (!isStableId(idValue)) {
    throw invalidSchema("$definition.id", "expected a canonical stable ID");
  }
  const id = parseStableId(idValue, "$definition.id");

  const versionValue = ownValue(record, "version", "$definition.version");
  let version: SemanticVersion;
  try {
    version = parseSemanticVersion(versionValue, "$definition.version").value;
  } catch {
    throw invalidSchema(
      "$definition.version",
      "expected a canonical Semantic Version 2.0.0 string",
    );
  }

  const title = boundedText(
    ownValue(record, "title", "$definition.title"),
    "$definition.title",
    120,
  );
  const descriptionDescriptor = Object.getOwnPropertyDescriptor(
    record,
    "description",
  );
  const description =
    descriptionDescriptor === undefined
      ? undefined
      : boundedText(
          "value" in descriptionDescriptor
            ? descriptionDescriptor.value
            : undefined,
          "$definition.description",
          500,
        );
  const body = normalizedBody(
    ownValue(record, "schema", "$definition.schema"),
  );
  const schemaId =
    `urn:ai-game-playbook:schema:${id}:${version}` as ContractSchemaId;
  const schemaWithMetadata: Record<string, CanonicalJsonValue> = {
    $schema: CONTRACT_SCHEMA_DRAFT,
    $id: schemaId,
    title,
    ...(description === undefined ? {} : { description }),
    ...body,
  };
  const schema = deepFreeze(
    schemaWithMetadata as RootContractSchema,
  );

  return Object.freeze({
    id,
    version,
    schemaId,
    schema,
    digest: digestCanonicalJson(schema),
  });
}
