import type { CanonicalJsonValue } from "./canonical-json.js";
import type { JsonSchemaObject } from "./contract-schema.js";
import {
  CAPABILITY_SUPPORT_GRADES,
  COMPONENT_OUTCOMES,
  EFFECT_BOUNDARIES,
  ENGINE_OPERATION_KINDS,
  EVIDENCE_GRADES,
  EXECUTION_LANES,
  PERMISSION_CLASSES,
  PROJECT_STAGES,
} from "./contract-vocabulary.js";
import {
  PORTABLE_PROJECT_PATH_MAX_LENGTH,
  PORTABLE_PROJECT_PATH_PATTERN,
} from "./portable-path.js";

export type SchemaProperties = Readonly<
  Record<string, CanonicalJsonValue>
>;

const stableIdPattern =
  "^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$";
const semanticVersionPattern =
  "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";
const schemaIdPattern =
  "^urn:ai-game-playbook:schema:[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*:(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$";

export function closedObject(
  properties: SchemaProperties,
  required: readonly string[],
): JsonSchemaObject {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export function boundedArray(
  items: CanonicalJsonValue,
  options: {
    readonly minimum?: number;
    readonly maximum?: number;
    readonly unique?: boolean;
  } = {},
): JsonSchemaObject {
  return {
    type: "array",
    items,
    minItems: options.minimum ?? 0,
    maxItems: options.maximum ?? 128,
    ...(options.unique === true ? { uniqueItems: true } : {}),
  };
}

export function textSchema(
  maximum: number,
  minimum = 1,
): JsonSchemaObject {
  return {
    type: "string",
    minLength: minimum,
    maxLength: maximum,
  };
}

export function enumSchema(values: readonly string[]): JsonSchemaObject {
  return { type: "string", enum: values };
}

export function reference(name: string): JsonSchemaObject {
  return { $ref: `#/$defs/${name}` };
}

const schemaReference = closedObject(
  {
    schemaId: { type: "string", pattern: schemaIdPattern, maxLength: 256 },
    digest: { $ref: "#/$defs/sha256Digest" },
  },
  ["schemaId", "digest"],
);

const money = closedObject(
  {
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    amount: { $ref: "#/$defs/decimalAmount" },
  },
  ["currency", "amount"],
);

const executionBudgets = closedObject(
  {
    maxChangedFiles: { type: "integer", minimum: 0, maximum: 100000 },
    maxChangedBytes: {
      type: "integer",
      minimum: 0,
      maximum: 1099511627776,
    },
    maxDurationMs: {
      type: "integer",
      minimum: 1,
      maximum: 604800000,
    },
    maxOutputBytes: {
      type: "integer",
      minimum: 1,
      maximum: 1073741824,
    },
    maxRepairCycles: { type: "integer", minimum: 0, maximum: 3 },
    maxMemoryBytes: {
      type: "integer",
      minimum: 1,
      maximum: 1099511627776,
    },
    maxCpuSeconds: { type: "integer", minimum: 1, maximum: 604800 },
    maxGpuSeconds: { type: "integer", minimum: 1, maximum: 604800 },
    maxCost: money,
  },
  ["maxDurationMs", "maxOutputBytes", "maxRepairCycles"],
);

export const COMMON_SCHEMA_DEFINITIONS: Readonly<
  Record<string, CanonicalJsonValue>
> = Object.freeze({
  stableId: {
    type: "string",
    pattern: stableIdPattern,
    minLength: 1,
    maxLength: 128,
  },
  semanticVersion: {
    type: "string",
    pattern: semanticVersionPattern,
    maxLength: 256,
  },
  sha256Digest: {
    type: "string",
    pattern: "^sha256:[0-9a-f]{64}$",
  },
  timestamp: { type: "string", format: "date-time", maxLength: 64 },
  uuid: { type: "string", format: "uuid", maxLength: 64 },
  portablePath: {
    type: "string",
    pattern: PORTABLE_PROJECT_PATH_PATTERN,
    minLength: 1,
    maxLength: PORTABLE_PROJECT_PATH_MAX_LENGTH,
  },
  decimalAmount: {
    type: "string",
    pattern: "^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,6})?$",
  },
  nonEmptyText: textSchema(1000),
  shortText: textSchema(200),
  projectStage: enumSchema(PROJECT_STAGES),
  executionLane: enumSchema(EXECUTION_LANES),
  effectBoundary: enumSchema(EFFECT_BOUNDARIES),
  permissionClass: enumSchema(PERMISSION_CLASSES),
  engineId: enumSchema(["godot", "unity", "unreal"]),
  engineOperation: enumSchema(ENGINE_OPERATION_KINDS),
  supportGrade: enumSchema(CAPABILITY_SUPPORT_GRADES),
  evidenceGrade: enumSchema(EVIDENCE_GRADES),
  componentOutcome: enumSchema(COMPONENT_OUTCOMES),
  lifecycle: enumSchema([
    "experimental",
    "stable",
    "deprecated",
    "internal",
  ]),
  operatingSystem: enumSchema(["windows", "linux", "macos"]),
  architecture: enumSchema(["x64", "arm64"]),
  schemaReference,
  executionBudgets,
  money,
});

export function contractRoot(
  properties: SchemaProperties,
  required: readonly string[],
): JsonSchemaObject {
  return {
    ...closedObject(properties, required),
    $defs: COMMON_SCHEMA_DEFINITIONS,
  };
}
