import { Buffer } from "node:buffer";
import { createRequire } from "node:module";

import {
  canonicalizeJson,
  commandDescriptorSchema,
  compareCanonicalText,
  compareSemanticVersions,
  computePackManifestDigest,
  digestCanonicalJson,
  isSha256Digest,
  isStableId,
  packManifestSchema,
  parseSemanticVersion,
  roleLensDescriptorSchema,
  skillDescriptorSchema,
  workflowDescriptorSchema,
  type CommandDescriptor,
  type PackManifest,
  type PermissionClass,
  type SchemaReference,
  type SemanticVersion,
  type VersionInterval,
  type VersionedContractSchema,
  type WorkflowDescriptor,
} from "@ai-game-playbook/contracts";
import {
  Ajv2020,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

import {
  RegistryValidationError,
  type RegistryDiagnostic,
  type RegistryDiagnosticCode,
} from "./errors.js";
import type { RegistryDefinition, ValidatedRegistry } from "./types.js";

const REGISTRY_SCHEMA_VERSION = "1.0.0";
const REGISTRY_MAX_BYTES = 16 * 1024 * 1024;
const REGISTRY_MAX_DIAGNOSTICS = 100;
const REGISTRY_MAX_DEPTH = 128;
const REGISTRY_MAX_NODES = 250_000;
const REGISTRY_MAX_CONTAINER_ENTRIES = 100_000;
const SCHEMA_MAX_DEPTH = 64;
const SCHEMA_MAX_OBJECTS = 10_000;
const SCHEMA_MAX_PATTERN_LENGTH = 512;
const validatedRegistryInstances = new WeakSet<object>();
const moduleRequire = createRequire(import.meta.url);
const addFormats = moduleRequire("ajv-formats") as FormatsPlugin;

type MutableRecord = Record<string, unknown>;

function diagnostic(
  code: RegistryDiagnosticCode,
  path: string,
  message: string,
): RegistryDiagnostic {
  return { code, path, message: message.slice(0, 500) };
}

function appendDiagnostic(
  diagnostics: RegistryDiagnostic[],
  value: RegistryDiagnostic,
): void {
  if (diagnostics.length < REGISTRY_MAX_DIAGNOSTICS) {
    diagnostics.push(value);
  }
}

function invalidPreflight(reason: string): RegistryValidationError {
  return new RegistryValidationError([
    diagnostic("registry-input-invalid", "$", reason),
  ]);
}

function preflightRegistryInput(input: unknown): void {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: input, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringBytes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      continue;
    }
    if (frame.depth > REGISTRY_MAX_DEPTH) {
      throw invalidPreflight(
        `registry nesting exceeds ${REGISTRY_MAX_DEPTH} levels`,
      );
    }
    nodes += 1;
    if (nodes > REGISTRY_MAX_NODES) {
      throw invalidPreflight(
        `registry contains more than ${REGISTRY_MAX_NODES} values`,
      );
    }

    const value = frame.value;
    if (typeof value === "string") {
      stringBytes += Buffer.byteLength(value, "utf8");
      if (stringBytes > REGISTRY_MAX_BYTES) {
        throw invalidPreflight(
          `registry strings exceed ${REGISTRY_MAX_BYTES} UTF-8 bytes`,
        );
      }
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      continue;
    }
    if (typeof value !== "object") {
      throw invalidPreflight(`unsupported value type: ${typeof value}`);
    }
    if (seen.has(value)) {
      throw invalidPreflight("shared or circular object identity is not allowed");
    }
    seen.add(value);

    const prototype = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw invalidPreflight("registry values must use plain objects and arrays");
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw invalidPreflight("symbol properties are not allowed");
    }

    if (Array.isArray(value)) {
      if (value.length > REGISTRY_MAX_CONTAINER_ENTRIES) {
        throw invalidPreflight(
          `array exceeds ${REGISTRY_MAX_CONTAINER_ENTRIES} entries`,
        );
      }
      const names = Object.getOwnPropertyNames(value);
      if (names.length !== value.length + 1) {
        throw invalidPreflight(
          "sparse arrays and custom array properties are not allowed",
        );
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          throw invalidPreflight("array entries must be enumerable data fields");
        }
        stack.push({ value: descriptor.value, depth: frame.depth + 1 });
      }
      continue;
    }

    const names = Object.getOwnPropertyNames(value);
    if (names.length > REGISTRY_MAX_CONTAINER_ENTRIES) {
      throw invalidPreflight(
        `object exceeds ${REGISTRY_MAX_CONTAINER_ENTRIES} fields`,
      );
    }
    for (const key of names) {
      stringBytes += Buffer.byteLength(key, "utf8");
      if (stringBytes > REGISTRY_MAX_BYTES) {
        throw invalidPreflight(
          `registry strings exceed ${REGISTRY_MAX_BYTES} UTF-8 bytes`,
        );
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw invalidPreflight("object entries must be enumerable data fields");
      }
      stack.push({ value: descriptor.value, depth: frame.depth + 1 });
    }
  }
}

export function cloneBoundedInput(input: unknown): unknown {
  preflightRegistryInput(input);
  let serialized: string;
  try {
    serialized = canonicalizeJson(input);
  } catch (error) {
    throw new RegistryValidationError([
      diagnostic(
        "registry-input-invalid",
        "$",
        error instanceof Error ? error.message : "input is not canonical JSON",
      ),
    ]);
  }

  if (Buffer.byteLength(serialized, "utf8") > REGISTRY_MAX_BYTES) {
    throw new RegistryValidationError([
      diagnostic(
        "registry-input-invalid",
        "$",
        `registry exceeds ${REGISTRY_MAX_BYTES} UTF-8 bytes`,
      ),
    ]);
  }

  return JSON.parse(serialized) as unknown;
}

function isRecord(value: unknown): value is MutableRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRootShape(value: unknown): MutableRecord {
  if (!isRecord(value)) {
    throw new RegistryValidationError([
      diagnostic("registry-shape-invalid", "$", "expected an object"),
    ]);
  }

  const diagnostics: RegistryDiagnostic[] = [];
  const expectedKeys = new Set([
    "schemaVersion",
    "controlPlaneVersion",
    "schemas",
    "commands",
    "skills",
    "roleLenses",
    "workflows",
    "packs",
  ]);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "registry-shape-invalid",
          `$[${JSON.stringify(key)}]`,
          "undeclared root field",
        ),
      );
    }
  }

  if (value["schemaVersion"] !== REGISTRY_SCHEMA_VERSION) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "unsupported-registry-version",
        "$.schemaVersion",
        `expected ${REGISTRY_SCHEMA_VERSION}`,
      ),
    );
  }

  try {
    parseSemanticVersion(
      value["controlPlaneVersion"],
      "$.controlPlaneVersion",
    );
  } catch {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "invalid-control-plane-version",
        "$.controlPlaneVersion",
        "expected a canonical Semantic Version 2.0.0 string",
      ),
    );
  }

  const limits: Readonly<Record<string, number>> = {
    schemas: 4096,
    commands: 4096,
    skills: 4096,
    roleLenses: 1024,
    workflows: 1024,
    packs: 1024,
  };
  for (const [key, maximum] of Object.entries(limits)) {
    const collection = value[key];
    if (!Array.isArray(collection) || collection.length > maximum) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "registry-shape-invalid",
          `$.${key}`,
          `expected an array with at most ${maximum} entries`,
        ),
      );
    }
  }

  if (diagnostics.length > 0) {
    throw new RegistryValidationError(diagnostics);
  }
  return value;
}

function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv, { mode: "full" });
  return ajv;
}

function descriptorValidators(
  ajv: Ajv2020,
): Readonly<Record<string, ValidateFunction>> {
  return {
    commands: ajv.compile(commandDescriptorSchema.schema as AnySchemaObject),
    skills: ajv.compile(skillDescriptorSchema.schema as AnySchemaObject),
    roleLenses: ajv.compile(roleLensDescriptorSchema.schema as AnySchemaObject),
    workflows: ajv.compile(workflowDescriptorSchema.schema as AnySchemaObject),
    packs: ajv.compile(packManifestSchema.schema as AnySchemaObject),
  };
}

function ajvErrorMessage(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined || errors.length === 0) {
    return "descriptor does not satisfy its schema";
  }
  const first = errors[0];
  return `${first?.instancePath ?? ""} ${first?.message ?? "is invalid"}`.trim();
}

function validateDescriptors(
  root: MutableRecord,
  validators: Readonly<Record<string, ValidateFunction>>,
  diagnostics: RegistryDiagnostic[],
): void {
  for (const key of [
    "commands",
    "skills",
    "roleLenses",
    "workflows",
    "packs",
  ]) {
    const values = root[key] as unknown[];
    const validate = validators[key];
    if (validate === undefined) {
      continue;
    }
    for (let index = 0; index < values.length; index += 1) {
      if (!validate(values[index])) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "descriptor-schema-invalid",
            `$.${key}[${index}]`,
            ajvErrorMessage(validate.errors),
          ),
        );
      }
    }
  }
}

interface SchemaScanState {
  objectCount: number;
  complexityReported: boolean;
  compileAllowed: boolean;
}

interface PatternAtomSummary {
  canMatchEmpty: boolean;
  containsUnboundedQuantifier: boolean;
  quantified: boolean;
  group?: PatternGroupSummary;
}

interface PatternGroupSummary {
  canMatchEmpty: boolean;
  containsUnboundedQuantifier: boolean;
  directAtomCount: number;
  hasAlternation: boolean;
}

interface PatternFrame {
  readonly branches: PatternAtomSummary[][];
  readonly assertion: boolean;
}

interface PatternQuantifier {
  readonly end: number;
  readonly minimum: number;
  readonly unbounded: boolean;
}

function quantifierAt(
  pattern: string,
  index: number,
): PatternQuantifier | undefined {
  const character = pattern[index];
  if (character === "*") {
    return { end: index, minimum: 0, unbounded: true };
  }
  if (character === "+") {
    return { end: index, minimum: 1, unbounded: true };
  }
  if (character === "?") {
    return { end: index, minimum: 0, unbounded: false };
  }
  if (character !== "{") {
    return undefined;
  }

  const match = /^\{(0|[1-9][0-9]*)(?:,(0|[1-9][0-9]*)?)?\}/.exec(
    pattern.slice(index),
  );
  if (match === null) {
    return undefined;
  }
  const hasComma = match[0].includes(",");
  return {
    end: index + match[0].length - 1,
    minimum: Number(match[1]),
    unbounded: hasComma && match[2] === undefined,
  };
}

function summarizePatternFrame(frame: PatternFrame): PatternGroupSummary {
  const canMatchEmpty =
    frame.assertion ||
    frame.branches.some((branch) =>
      branch.every((atom) => atom.canMatchEmpty),
    );
  return {
    canMatchEmpty,
    containsUnboundedQuantifier: frame.branches.some((branch) =>
      branch.some((atom) => atom.containsUnboundedQuantifier),
    ),
    directAtomCount:
      frame.branches.length === 1 ? (frame.branches[0]?.length ?? 0) : 0,
    hasAlternation: frame.branches.length > 1,
  };
}

function patternSafetyIssue(pattern: string): string | undefined {
  const frames: PatternFrame[] = [{ branches: [[]], assertion: false }];
  let lazyModifierAllowed = false;

  const currentBranch = (): PatternAtomSummary[] => {
    const frame = frames.at(-1);
    return frame?.branches.at(-1) ?? [];
  };
  const appendAtom = (atom: PatternAtomSummary): void => {
    currentBranch().push(atom);
  };

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "?" && lazyModifierAllowed) {
      lazyModifierAllowed = false;
      continue;
    }
    lazyModifierAllowed = false;

    if (character === "\\") {
      const escaped = pattern[index + 1];
      if (escaped !== undefined && /[1-9]/.test(escaped)) {
        return "backreferences are not allowed in registry schemas";
      }
      if (escaped === "k" && pattern[index + 2] === "<") {
        return "named backreferences are not allowed in registry schemas";
      }
      appendAtom({
        canMatchEmpty: false,
        containsUnboundedQuantifier: false,
        quantified: false,
      });
      index += escaped === undefined ? 0 : 1;
      continue;
    }

    if (character === "[") {
      let escaped = false;
      for (index += 1; index < pattern.length; index += 1) {
        const classCharacter = pattern[index];
        if (!escaped && classCharacter === "]") {
          break;
        }
        escaped = !escaped && classCharacter === "\\";
        if (classCharacter !== "\\") {
          escaped = false;
        }
      }
      appendAtom({
        canMatchEmpty: false,
        containsUnboundedQuantifier: false,
        quantified: false,
      });
      continue;
    }

    if (character === "(") {
      if (
        pattern.startsWith("(?<=", index) ||
        pattern.startsWith("(?<!", index)
      ) {
        return "lookbehind assertions are not allowed in registry schemas";
      }
      let assertion = false;
      if (pattern.startsWith("(?:", index)) {
        index += 2;
      } else if (
        pattern.startsWith("(?=", index) ||
        pattern.startsWith("(?!", index)
      ) {
        assertion = true;
        index += 2;
      } else if (pattern.startsWith("(?", index)) {
        return "unsupported regular expression group construct";
      }
      frames.push({ branches: [[]], assertion });
      continue;
    }

    if (character === "|") {
      const frame = frames.at(-1);
      frame?.branches.push([]);
      continue;
    }

    if (character === ")") {
      if (frames.length === 1) {
        continue;
      }
      const frame = frames.pop();
      if (frame !== undefined) {
        const group = summarizePatternFrame(frame);
        appendAtom({
          canMatchEmpty: group.canMatchEmpty,
          containsUnboundedQuantifier: group.containsUnboundedQuantifier,
          quantified: false,
          group,
        });
      }
      continue;
    }

    const quantifier = quantifierAt(pattern, index);
    if (quantifier !== undefined) {
      const branch = currentBranch();
      const atom = branch.at(-1);
      if (atom === undefined) {
        continue;
      }
      if (atom.quantified) {
        return "stacked quantifiers are not allowed in registry schemas";
      }
      if (quantifier.unbounded && atom.group !== undefined) {
        if (atom.group.hasAlternation) {
          return "unbounded repetition of alternation is not allowed";
        }
        if (atom.group.canMatchEmpty) {
          return "unbounded repetition of an empty-matching group is not allowed";
        }
        if (
          atom.group.directAtomCount === 1 &&
          atom.group.containsUnboundedQuantifier
        ) {
          return "nested unbounded quantifiers are not allowed";
        }
      }
      atom.quantified = true;
      atom.canMatchEmpty = atom.canMatchEmpty || quantifier.minimum === 0;
      atom.containsUnboundedQuantifier =
        atom.containsUnboundedQuantifier || quantifier.unbounded;
      index = quantifier.end;
      lazyModifierAllowed = true;
      continue;
    }

    if (character !== "^" && character !== "$") {
      appendAtom({
        canMatchEmpty: false,
        containsUnboundedQuantifier: false,
        quantified: false,
      });
    }
  }

  return undefined;
}

function scanSchemaValue(
  value: unknown,
  path: string,
  depth: number,
  state: SchemaScanState,
  diagnostics: RegistryDiagnostic[],
): void {
  if (depth > SCHEMA_MAX_DEPTH) {
    state.compileAllowed = false;
    if (!state.complexityReported) {
      state.complexityReported = true;
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-complexity-exceeded",
          path,
          `schema depth exceeds ${SCHEMA_MAX_DEPTH}`,
        ),
      );
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      scanSchemaValue(
        value[index],
        `${path}[${index}]`,
        depth + 1,
        state,
        diagnostics,
      );
    }
    return;
  }

  state.objectCount += 1;
  if (state.objectCount > SCHEMA_MAX_OBJECTS) {
    state.compileAllowed = false;
    if (!state.complexityReported) {
      state.complexityReported = true;
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-complexity-exceeded",
          path,
          `schema contains more than ${SCHEMA_MAX_OBJECTS} objects`,
        ),
      );
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}[${JSON.stringify(key)}]`;
    if (key === "$ref" && (typeof child !== "string" || !child.startsWith("#"))) {
      state.compileAllowed = false;
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "external-schema-reference",
          childPath,
          "only same-document JSON Schema references are allowed",
        ),
      );
    }
    if (key === "$id" && depth > 0) {
      state.compileAllowed = false;
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-attestation-invalid",
          childPath,
          "nested schema identities are not allowed",
        ),
      );
    }
    if (key === "pattern") {
      const issue =
        typeof child !== "string"
          ? "schema pattern must be text"
          : child.length > SCHEMA_MAX_PATTERN_LENGTH
            ? `schema pattern exceeds ${SCHEMA_MAX_PATTERN_LENGTH} characters`
            : patternSafetyIssue(child);
      if (issue !== undefined) {
        state.compileAllowed = false;
        appendDiagnostic(
          diagnostics,
          diagnostic("schema-complexity-exceeded", childPath, issue),
        );
      }
    }
    scanSchemaValue(child, childPath, depth + 1, state, diagnostics);
  }
}

function validateSchemaEntries(
  schemas: readonly unknown[],
  ajv: Ajv2020,
  diagnostics: RegistryDiagnostic[],
): void {
  const schemaIds = new Map<string, number>();
  for (let index = 0; index < schemas.length; index += 1) {
    const path = `$.schemas[${index}]`;
    const entry = schemas[index];
    if (!isRecord(entry)) {
      appendDiagnostic(
        diagnostics,
        diagnostic("schema-attestation-invalid", path, "expected an object"),
      );
      continue;
    }

    const expectedEntryKeys = new Set([
      "id",
      "version",
      "schemaId",
      "schema",
      "digest",
    ]);
    const unexpectedEntryKey = Object.keys(entry).find(
      (key) => !expectedEntryKeys.has(key),
    );
    if (unexpectedEntryKey !== undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-attestation-invalid",
          `${path}[${JSON.stringify(unexpectedEntryKey)}]`,
          "undeclared schema attestation field",
        ),
      );
      continue;
    }

    const id = entry["id"];
    const version = entry["version"];
    const schemaId = entry["schemaId"];
    const digest = entry["digest"];
    const schema = entry["schema"];
    let versionIsValid = true;
    try {
      parseSemanticVersion(version, `${path}.version`);
    } catch {
      versionIsValid = false;
    }
    if (
      !isStableId(id) ||
      !versionIsValid ||
      typeof schemaId !== "string" ||
      !isSha256Digest(digest) ||
      !isRecord(schema)
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-attestation-invalid",
          path,
          "schema identity, version, digest, or body is invalid",
        ),
      );
      continue;
    }

    const expectedSchemaId = `urn:ai-game-playbook:schema:${id}:${String(version)}`;
    if (
      schemaId !== expectedSchemaId ||
      schema["$id"] !== schemaId ||
      schema["$schema"] !== "https://json-schema.org/draft/2020-12/schema" ||
      schema["type"] !== "object" ||
      schema["additionalProperties"] !== false ||
      digestCanonicalJson(schema) !== digest
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-attestation-invalid",
          path,
          "schema metadata or digest does not match its body",
        ),
      );
      continue;
    }

    const previousIndex = schemaIds.get(schemaId);
    if (previousIndex !== undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-id-duplicate",
          `${path}.schemaId`,
          `duplicates $.schemas[${previousIndex}].schemaId`,
        ),
      );
      continue;
    }
    schemaIds.set(schemaId, index);

    const scanState: SchemaScanState = {
      objectCount: 0,
      complexityReported: false,
      compileAllowed: true,
    };
    scanSchemaValue(
      schema,
      `${path}.schema`,
      0,
      scanState,
      diagnostics,
    );
    if (!scanState.compileAllowed) {
      continue;
    }
    try {
      if (!ajv.validateSchema(schema as AnySchemaObject)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "schema-attestation-invalid",
            `${path}.schema`,
            ajvErrorMessage(ajv.errors),
          ),
        );
      } else {
        ajv.compile(schema as AnySchemaObject);
      }
    } catch (error) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "schema-attestation-invalid",
          `${path}.schema`,
          error instanceof Error ? error.message : "schema compilation failed",
        ),
      );
    }
  }
}

function addUniqueDescriptorIds(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  const seen = new Map<string, string>();
  const groups = [
    ["commands", definition.commands],
    ["skills", definition.skills],
    ["roleLenses", definition.roleLenses],
    ["workflows", definition.workflows],
    ["packs", definition.packs],
  ] as const;
  for (const [key, descriptors] of groups) {
    for (let index = 0; index < descriptors.length; index += 1) {
      const id = descriptors[index]?.id;
      if (id === undefined) {
        continue;
      }
      const path = `$.${key}[${index}].id`;
      const previous = seen.get(id);
      if (previous !== undefined) {
        appendDiagnostic(
          diagnostics,
          diagnostic("duplicate-id", path, `duplicates ${previous}`),
        );
      } else {
        seen.set(id, path);
      }
    }
  }
}

function validateCliPaths(
  commands: readonly CommandDescriptor[],
  diagnostics: RegistryDiagnostic[],
): void {
  const seen = new Map<string, string>();
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command === undefined) {
      continue;
    }
    const paths = [command.cli.path, ...command.cli.aliases];
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
      const cliPath = paths[pathIndex];
      if (cliPath === undefined) {
        continue;
      }
      const key = cliPath.join("\u0000");
      const path =
        pathIndex === 0
          ? `$.commands[${index}].cli.path`
          : `$.commands[${index}].cli.aliases[${pathIndex - 1}]`;
      const previous = seen.get(key);
      if (previous !== undefined) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "cli-path-collision",
            path,
            `CLI path ${cliPath.join(" ")} collides with ${previous}`,
          ),
        );
      } else {
        seen.set(key, path);
      }
    }
  }
}

const projectMutationPermissions = new Set([
  "write-project-metadata",
  "write-project-source",
  "editor-control",
  "test-build",
  "install",
  "destructive",
  "publish-release",
]);
const projectWritePermissions = new Set([
  "write-project-metadata",
  "write-project-source",
  "install",
  "destructive",
]);
const retryUnsafePermissions = new Set([
  ...projectMutationPermissions,
  "network",
  "external-transmission",
  "paid-call",
]);

function hasAnyPermission(
  command: CommandDescriptor,
  permissions: ReadonlySet<string>,
): boolean {
  return command.permissions.some((permission) => permissions.has(permission));
}

function validateCommandSemantics(
  commands: readonly CommandDescriptor[],
  diagnostics: RegistryDiagnostic[],
): void {
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index];
    if (command === undefined) {
      continue;
    }
    const path = `$.commands[${index}]`;
    const effectKinds = new Set(command.sideEffects.map(({ kind }) => kind));
    const hasEffects = [...effectKinds].some((kind) => kind !== "none");
    const hasProjectMutationEffect =
      effectKinds.has("filesystem") || effectKinds.has("editor");
    if (hasEffects && command.permissions.length === 0) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "side-effect-without-permission",
          `${path}.permissions`,
          "commands with side effects require explicit permission classes",
        ),
      );
    }
    if (effectKinds.has("none") && effectKinds.size > 1) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "side-effect-permission-mismatch",
          `${path}.sideEffects`,
          "none cannot be combined with another side-effect kind",
        ),
      );
    }

    const requiredByEffect: ReadonlyArray<
      readonly [
        CommandDescriptor["sideEffects"][number]["kind"],
        PermissionClass,
      ]
    > = [
      ["editor", "editor-control"],
      ["network", "network"],
      ["external", "external-transmission"],
    ];
    for (const [kind, permission] of requiredByEffect) {
      if (effectKinds.has(kind) && !command.permissions.includes(permission)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "side-effect-permission-mismatch",
            `${path}.permissions`,
            `${kind} side effects require ${permission}`,
          ),
        );
      }
    }
    for (const effect of command.sideEffects) {
      if (
        effect.boundary === "network" &&
        !command.permissions.includes("network")
      ) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "side-effect-permission-mismatch",
            `${path}.permissions`,
            "network boundary requires network permission",
          ),
        );
      }
      if (
        effect.boundary === "external" &&
        !command.permissions.includes("external-transmission")
      ) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "side-effect-permission-mismatch",
            `${path}.permissions`,
            "external boundary requires external-transmission permission",
          ),
        );
      }
    }

    const laneMatches =
      (command.lane === "parallel-read" &&
        !hasProjectMutationEffect &&
        !hasAnyPermission(command, projectMutationPermissions)) ||
      (command.lane === "project-write" &&
        hasAnyPermission(command, projectWritePermissions)) ||
      (command.lane === "editor-bound" &&
        command.permissions.includes("editor-control")) ||
      (command.lane === "build-bound" &&
        command.permissions.includes("test-build"));
    if (!laneMatches) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "lane-permission-mismatch",
          `${path}.lane`,
          "execution lane does not match side effects and permissions",
        ),
      );
    }

    const backoffCount = command.retry.backoffMs?.length ?? 0;
    if (
      (command.retry.mode === "never" &&
        (command.retry.maxAttempts !== 1 || backoffCount !== 0)) ||
      (command.retry.mode !== "never" && command.retry.maxAttempts < 2) ||
      backoffCount > command.retry.maxAttempts - 1
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "invalid-retry-attempts",
          `${path}.retry`,
          "retry mode, attempt count, and backoff count are inconsistent",
        ),
      );
    }
    const retryUnsafeEffects: ReadonlyArray<
      CommandDescriptor["sideEffects"][number]["kind"]
    > = [
      "filesystem",
      "editor",
      "network",
      "external",
    ];
    const hasRetryUnsafeEffect = retryUnsafeEffects.some((kind) =>
      effectKinds.has(kind),
    );
    if (
      command.retry.mode === "read-only" &&
      (hasRetryUnsafeEffect || hasAnyPermission(command, retryUnsafePermissions))
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "unsafe-retry-policy",
          `${path}.retry.mode`,
          "read-only retry cannot be used by a command with side effects",
        ),
      );
    }
    if (command.timeoutMs > command.budgets.maxDurationMs) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "command-budget-mismatch",
          `${path}.timeoutMs`,
          "command timeout exceeds its total duration budget",
        ),
      );
    }
  }
}

function validateSchemaReference(
  value: SchemaReference,
  path: string,
  schemas: ReadonlyMap<string, VersionedContractSchema>,
  diagnostics: RegistryDiagnostic[],
): void {
  const resolved = schemas.get(value.schemaId);
  if (resolved === undefined) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "schema-reference-missing",
        `${path}.schemaId`,
        `schema ${value.schemaId} is not registered`,
      ),
    );
  } else if (resolved.digest !== value.digest) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "schema-digest-mismatch",
        `${path}.digest`,
        `schema digest does not match ${value.schemaId}`,
      ),
    );
  }
}

function validateSchemaBindings(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  const schemas = new Map(
    definition.schemas.map((schema) => [schema.schemaId, schema]),
  );
  for (let index = 0; index < definition.commands.length; index += 1) {
    const command = definition.commands[index];
    if (command !== undefined) {
      validateSchemaReference(
        command.input,
        `$.commands[${index}].input`,
        schemas,
        diagnostics,
      );
      validateSchemaReference(
        command.output,
        `$.commands[${index}].output`,
        schemas,
        diagnostics,
      );
    }
  }
  for (let index = 0; index < definition.workflows.length; index += 1) {
    const workflow = definition.workflows[index];
    if (workflow !== undefined) {
      validateSchemaReference(
        workflow.input,
        `$.workflows[${index}].input`,
        schemas,
        diagnostics,
      );
      validateSchemaReference(
        workflow.output,
        `$.workflows[${index}].output`,
        schemas,
        diagnostics,
      );
    }
  }
  for (let packIndex = 0; packIndex < definition.packs.length; packIndex += 1) {
    const pack = definition.packs[packIndex];
    if (pack === undefined) {
      continue;
    }
    for (
      let schemaIndex = 0;
      schemaIndex < pack.provides.schemas.length;
      schemaIndex += 1
    ) {
      const schema = pack.provides.schemas[schemaIndex];
      if (schema !== undefined) {
        validateSchemaReference(
          schema,
          `$.packs[${packIndex}].provides.schemas[${schemaIndex}]`,
          schemas,
          diagnostics,
        );
      }
    }
  }
}

function validateVersionInterval(
  interval: VersionInterval,
  path: string,
  diagnostics: RegistryDiagnostic[],
): boolean {
  if (
    compareSemanticVersions(interval.minimum, interval.maximumExclusive) >= 0
  ) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-version-interval-invalid",
        path,
        "minimum must be lower than maximumExclusive",
      ),
    );
    return false;
  }
  return true;
}

function versionIsInInterval(
  version: SemanticVersion,
  interval: VersionInterval,
): boolean {
  return (
    compareSemanticVersions(version, interval.minimum) >= 0 &&
    compareSemanticVersions(version, interval.maximumExclusive) < 0
  );
}

function validatePackIntervals(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  for (let packIndex = 0; packIndex < definition.packs.length; packIndex += 1) {
    const pack = definition.packs[packIndex];
    if (pack === undefined) {
      continue;
    }
    const basePath = `$.packs[${packIndex}]`;
    const controlPlanePath = `${basePath}.compatibility.controlPlane`;
    if (
      validateVersionInterval(
        pack.compatibility.controlPlane,
        controlPlanePath,
        diagnostics,
      ) &&
      !versionIsInInterval(
        definition.controlPlaneVersion,
        pack.compatibility.controlPlane,
      )
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-control-plane-incompatible",
          controlPlanePath,
          `control plane ${definition.controlPlaneVersion} is outside the declared interval`,
        ),
      );
    }

    const engineIds = new Set<string>();
    for (
      let engineIndex = 0;
      engineIndex < pack.compatibility.engines.length;
      engineIndex += 1
    ) {
      const compatibility = pack.compatibility.engines[engineIndex];
      if (compatibility === undefined) {
        continue;
      }
      const path = `${basePath}.compatibility.engines[${engineIndex}]`;
      validateVersionInterval(compatibility, path, diagnostics);
      if (engineIds.has(compatibility.engine)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "pack-compatibility-duplicate",
            `${path}.engine`,
            `engine ${compatibility.engine} has more than one interval`,
          ),
        );
      }
      engineIds.add(compatibility.engine);
    }

    const hostIds = new Set<string>();
    for (
      let hostIndex = 0;
      hostIndex < pack.compatibility.hosts.length;
      hostIndex += 1
    ) {
      const compatibility = pack.compatibility.hosts[hostIndex];
      if (compatibility === undefined) {
        continue;
      }
      const path = `${basePath}.compatibility.hosts[${hostIndex}]`;
      validateVersionInterval(compatibility, path, diagnostics);
      if (hostIds.has(compatibility.id)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "pack-compatibility-duplicate",
            `${path}.id`,
            `host ${compatibility.id} has more than one interval`,
          ),
        );
      }
      hostIds.add(compatibility.id);
    }

    const dependencyIds = new Set<string>();
    for (
      let dependencyIndex = 0;
      dependencyIndex < pack.dependencies.length;
      dependencyIndex += 1
    ) {
      const dependency = pack.dependencies[dependencyIndex];
      if (dependency === undefined) {
        continue;
      }
      const path = `${basePath}.dependencies[${dependencyIndex}]`;
      validateVersionInterval(dependency, path, diagnostics);
      if (dependencyIds.has(dependency.id)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "pack-dependency-duplicate",
            `${path}.id`,
            `dependency ${dependency.id} is declared more than once`,
          ),
        );
      }
      dependencyIds.add(dependency.id);
    }
  }
}

function packGraphHasCycle(packs: readonly PackManifest[]): boolean {
  const packsById = new Map<string, PackManifest>();
  for (const pack of packs) {
    if (!packsById.has(pack.id)) {
      packsById.set(pack.id, pack);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    const pack = packsById.get(id);
    for (const dependency of pack?.dependencies ?? []) {
      if (packsById.has(dependency.id) && visit(dependency.id)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...packsById.keys()].some((id) => visit(id));
}

function validatePackDependencies(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  const packsById = new Map<string, PackManifest>();
  for (const pack of definition.packs) {
    if (!packsById.has(pack.id)) {
      packsById.set(pack.id, pack);
    }
  }

  for (let packIndex = 0; packIndex < definition.packs.length; packIndex += 1) {
    const pack = definition.packs[packIndex];
    if (pack === undefined) {
      continue;
    }
    for (
      let dependencyIndex = 0;
      dependencyIndex < pack.dependencies.length;
      dependencyIndex += 1
    ) {
      const dependency = pack.dependencies[dependencyIndex];
      if (dependency === undefined) {
        continue;
      }
      const path = `$.packs[${packIndex}].dependencies[${dependencyIndex}]`;
      const selected = packsById.get(dependency.id);
      if (selected === undefined) {
        if (!dependency.optional) {
          appendDiagnostic(
            diagnostics,
            diagnostic(
              "pack-dependency-missing",
              `${path}.id`,
              `required pack ${dependency.id} is not registered`,
            ),
          );
        }
      } else if (
        compareSemanticVersions(
          dependency.minimum,
          dependency.maximumExclusive,
        ) < 0 &&
        !versionIsInInterval(selected.version, dependency)
      ) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "pack-dependency-version-mismatch",
            path,
            `selected ${dependency.id}@${selected.version} is outside the declared interval`,
          ),
        );
      }
    }
  }

  if (packGraphHasCycle(definition.packs)) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-dependency-cycle",
        "$.packs",
        "pack dependencies must form an acyclic graph",
      ),
    );
  }
}

function validateProvidedIds(
  values: readonly string[],
  available: ReadonlySet<string>,
  providers: Map<string, string>,
  path: string,
  diagnostics: RegistryDiagnostic[],
): void {
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index];
    if (id === undefined) {
      continue;
    }
    const itemPath = `${path}[${index}]`;
    if (!available.has(id)) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-provision-missing",
          itemPath,
          `provided item ${id} is not registered`,
        ),
      );
    }
    const previous = providers.get(id);
    if (previous !== undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-provision-collision",
          itemPath,
          `provided item ${id} is already owned by ${previous}`,
        ),
      );
    } else {
      providers.set(id, itemPath);
    }
  }
}

function validatePackPermissionCoverage(
  required: readonly PermissionClass[],
  declared: ReadonlySet<PermissionClass>,
  path: string,
  diagnostics: RegistryDiagnostic[],
): void {
  for (const permission of required) {
    if (!declared.has(permission)) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-permission-underdeclared",
          path,
          `pack permissions do not include required permission ${permission}`,
        ),
      );
    }
  }
}

function validatePackNetworkDeclaration(
  pack: PackManifest,
  path: string,
  diagnostics: RegistryDiagnostic[],
): void {
  const hasNetworkPermission = pack.permissions.includes("network");
  const hasExternalTransmission = pack.permissions.includes(
    "external-transmission",
  );
  const hasDestinations = pack.network.destinations.length > 0;

  if (pack.network.required && !hasDestinations) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-network-declaration-invalid",
        `${path}.network.destinations`,
        "required network access must declare at least one destination",
      ),
    );
  }
  if ((pack.network.required || hasDestinations) && !hasNetworkPermission) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-network-declaration-invalid",
        `${path}.permissions`,
        "declared network access requires the network permission",
      ),
    );
  }
  if ((hasNetworkPermission || hasExternalTransmission) && !hasDestinations) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-network-declaration-invalid",
        `${path}.network.destinations`,
        "network and external transmission permissions require an explicit bounded destination",
      ),
    );
  }
  if (hasExternalTransmission && !hasNetworkPermission) {
    appendDiagnostic(
      diagnostics,
      diagnostic(
        "pack-network-declaration-invalid",
        `${path}.permissions`,
        "external transmission requires the network permission",
      ),
    );
  }
}

function validatePackArtifactOwnership(
  pack: PackManifest,
  path: string,
  diagnostics: RegistryDiagnostic[],
): void {
  const artifactTargets = new Map<string, number>();
  const ownedPaths = new Map<
    string,
    { readonly index: number; readonly digest?: string }
  >();

  for (let index = 0; index < pack.ownedPaths.length; index += 1) {
    const ownedPath = pack.ownedPaths[index];
    if (ownedPath === undefined) {
      continue;
    }
    const previous = ownedPaths.get(ownedPath.path);
    if (previous !== undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-owned-path-invalid",
          `${path}.ownedPaths[${index}].path`,
          `owned path duplicates ownedPaths[${previous.index}]`,
        ),
      );
    } else {
      ownedPaths.set(ownedPath.path, {
        index,
        ...(ownedPath.digest === undefined ? {} : { digest: ownedPath.digest }),
      });
    }
  }

  for (let index = 0; index < pack.artifacts.length; index += 1) {
    const artifact = pack.artifacts[index];
    if (artifact === undefined) {
      continue;
    }
    const previous = artifactTargets.get(artifact.target);
    if (previous !== undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-owned-path-invalid",
          `${path}.artifacts[${index}].target`,
          `artifact target duplicates artifacts[${previous}]`,
        ),
      );
    } else {
      artifactTargets.set(artifact.target, index);
    }

    const ownership = ownedPaths.get(artifact.target);
    if (ownership === undefined) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-owned-path-invalid",
          `${path}.artifacts[${index}].target`,
          "artifact target is not declared as an owned path",
        ),
      );
    } else if (
      artifact.mode !== "directory" &&
      ownership.digest !== undefined &&
      ownership.digest !== artifact.digest
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-owned-path-invalid",
          `${path}.ownedPaths[${ownership.index}].digest`,
          "owned path digest conflicts with its artifact digest",
        ),
      );
    }
  }
}

function validatePackProvisions(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  const commands = new Set(definition.commands.map(({ id }) => id));
  const skills = new Set(definition.skills.map(({ id }) => id));
  const workflows = new Set(definition.workflows.map(({ id }) => id));
  const schemas = new Set(definition.schemas.map(({ schemaId }) => schemaId));
  const capabilities = new Set<string>();
  const commandById = new Map(
    definition.commands.map((command) => [command.id, command]),
  );
  const skillById = new Map(
    definition.skills.map((skill) => [skill.id, skill]),
  );
  for (const command of definition.commands) {
    for (const capability of command.capabilities) {
      capabilities.add(capability);
    }
  }
  for (const skill of definition.skills) {
    for (const capability of skill.capabilities) {
      capabilities.add(capability);
    }
  }
  const commandProviders = new Map<string, string>();
  const skillProviders = new Map<string, string>();
  const workflowProviders = new Map<string, string>();
  const capabilityProviders = new Map<string, string>();
  const schemaProviders = new Map<string, string>();

  for (let packIndex = 0; packIndex < definition.packs.length; packIndex += 1) {
    const pack = definition.packs[packIndex];
    if (pack === undefined) {
      continue;
    }
    const basePath = `$.packs[${packIndex}]`;
    validateProvidedIds(
      pack.provides.commands,
      commands,
      commandProviders,
      `${basePath}.provides.commands`,
      diagnostics,
    );
    validateProvidedIds(
      pack.provides.skills,
      skills,
      skillProviders,
      `${basePath}.provides.skills`,
      diagnostics,
    );
    validateProvidedIds(
      pack.provides.workflows,
      workflows,
      workflowProviders,
      `${basePath}.provides.workflows`,
      diagnostics,
    );
    validateProvidedIds(
      pack.provides.capabilities,
      capabilities,
      capabilityProviders,
      `${basePath}.provides.capabilities`,
      diagnostics,
    );
    validateProvidedIds(
      pack.provides.schemas.map(({ schemaId }) => schemaId),
      schemas,
      schemaProviders,
      `${basePath}.provides.schemas`,
      diagnostics,
    );

    const declaredPermissions = new Set(pack.permissions);
    for (let index = 0; index < pack.provides.commands.length; index += 1) {
      const commandId = pack.provides.commands[index];
      const command =
        commandId === undefined ? undefined : commandById.get(commandId);
      if (command !== undefined) {
        validatePackPermissionCoverage(
          command.permissions,
          declaredPermissions,
          `${basePath}.provides.commands[${index}]`,
          diagnostics,
        );
      }
    }
    for (let index = 0; index < pack.provides.skills.length; index += 1) {
      const skillId = pack.provides.skills[index];
      const skill = skillId === undefined ? undefined : skillById.get(skillId);
      if (skill !== undefined) {
        validatePackPermissionCoverage(
          skill.requiredPermissions,
          declaredPermissions,
          `${basePath}.provides.skills[${index}]`,
          diagnostics,
        );
      }
    }

    for (const [hook, commandId] of Object.entries(pack.lifecycleHooks)) {
      const command = commandById.get(commandId);
      if (command === undefined) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "pack-lifecycle-command-missing",
            `${basePath}.lifecycleHooks[${JSON.stringify(hook)}]`,
            `lifecycle command ${commandId} is not registered`,
          ),
        );
      } else {
        validatePackPermissionCoverage(
          command.permissions,
          declaredPermissions,
          `${basePath}.lifecycleHooks[${JSON.stringify(hook)}]`,
          diagnostics,
        );
      }
    }

    validatePackNetworkDeclaration(pack, basePath, diagnostics);
    validatePackArtifactOwnership(pack, basePath, diagnostics);
  }
}

function validatePacks(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  for (let index = 0; index < definition.packs.length; index += 1) {
    const pack = definition.packs[index];
    if (
      pack !== undefined &&
      computePackManifestDigest(pack) !== pack.digest
    ) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "pack-digest-mismatch",
          `$.packs[${index}].digest`,
          "pack digest does not attest the canonical manifest body",
        ),
      );
    }
  }
  validatePackIntervals(definition, diagnostics);
  validatePackDependencies(definition, diagnostics);
  validatePackProvisions(definition, diagnostics);
}

function workflowHasCycle(workflow: WorkflowDescriptor): boolean {
  const dependencies: ReadonlyMap<string, readonly string[]> = new Map(
    workflow.steps.map((step) => [String(step.id), step.dependsOn]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) {
      return true;
    }
    if (visited.has(id)) {
      return false;
    }
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) {
        return true;
      }
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...dependencies.keys()].some((id) => visit(id));
}

function validateWorkflows(
  definition: RegistryDefinition,
  diagnostics: RegistryDiagnostic[],
): void {
  const commands = new Map(
    definition.commands.map((command) => [command.id, command]),
  );
  for (let workflowIndex = 0; workflowIndex < definition.workflows.length; workflowIndex += 1) {
    const workflow = definition.workflows[workflowIndex];
    if (workflow === undefined) {
      continue;
    }
    const basePath = `$.workflows[${workflowIndex}]`;
    const stepIds = new Set<string>();
    for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
      const step = workflow.steps[stepIndex];
      if (step === undefined) {
        continue;
      }
      const stepPath = `${basePath}.steps[${stepIndex}]`;
      if (stepIds.has(step.id)) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "workflow-step-duplicate",
            `${stepPath}.id`,
            `step ${step.id} is duplicated`,
          ),
        );
      }
      stepIds.add(step.id);
      const command = commands.get(step.commandId);
      if (command === undefined) {
        appendDiagnostic(
          diagnostics,
          diagnostic(
            "workflow-command-missing",
            `${stepPath}.commandId`,
            `command ${step.commandId} is not registered`,
          ),
        );
      } else {
        const unsupportedStages = workflow.supportedStages.filter(
          (stage) => !command.supportedStages.includes(stage),
        );
        if (unsupportedStages.length > 0) {
          appendDiagnostic(
            diagnostics,
            diagnostic(
              "workflow-stage-mismatch",
              `${stepPath}.commandId`,
              `command does not support: ${unsupportedStages.join(", ")}`,
            ),
          );
        }
      }
      if (step.onFailure === "rollback") {
        if (
          step.rollbackCommandId === undefined ||
          !commands.has(step.rollbackCommandId)
        ) {
          appendDiagnostic(
            diagnostics,
            diagnostic(
              "workflow-rollback-command-missing",
              `${stepPath}.rollbackCommandId`,
              "rollback transition requires a registered rollback command",
            ),
          );
        }
      }
    }

    for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex += 1) {
      const step = workflow.steps[stepIndex];
      if (step === undefined) {
        continue;
      }
      for (let dependencyIndex = 0; dependencyIndex < step.dependsOn.length; dependencyIndex += 1) {
        const dependency = step.dependsOn[dependencyIndex];
        if (dependency !== undefined && !stepIds.has(dependency)) {
          appendDiagnostic(
            diagnostics,
            diagnostic(
              "workflow-dependency-missing",
              `${basePath}.steps[${stepIndex}].dependsOn[${dependencyIndex}]`,
              `step ${dependency} is not defined by the workflow`,
            ),
          );
        }
      }
    }
    if (workflowHasCycle(workflow)) {
      appendDiagnostic(
        diagnostics,
        diagnostic(
          "workflow-cycle",
          `${basePath}.steps`,
          "workflow dependencies must form an acyclic graph",
        ),
      );
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function byId<T extends { readonly id: string }>(left: T, right: T): number {
  return compareCanonicalText(left.id, right.id);
}

export function validateRegistry(input: unknown): ValidatedRegistry {
  const clone = cloneBoundedInput(input);
  const root = validateRootShape(clone);
  const ajv = createAjv();
  const diagnostics: RegistryDiagnostic[] = [];
  validateDescriptors(root, descriptorValidators(ajv), diagnostics);
  validateSchemaEntries(root["schemas"] as unknown[], ajv, diagnostics);
  if (diagnostics.length > 0) {
    throw new RegistryValidationError(diagnostics);
  }

  const definition = clone as RegistryDefinition;
  addUniqueDescriptorIds(definition, diagnostics);
  validateCliPaths(definition.commands, diagnostics);
  validateCommandSemantics(definition.commands, diagnostics);
  validateSchemaBindings(definition, diagnostics);
  validatePacks(definition, diagnostics);
  validateWorkflows(definition, diagnostics);
  if (diagnostics.length > 0) {
    throw new RegistryValidationError(diagnostics);
  }

  const normalized: RegistryDefinition = {
    schemaVersion: definition.schemaVersion,
    controlPlaneVersion: definition.controlPlaneVersion,
    schemas: [...definition.schemas].sort((left, right) =>
      compareCanonicalText(left.schemaId, right.schemaId),
    ),
    commands: [...definition.commands].sort(byId),
    skills: [...definition.skills].sort(byId),
    roleLenses: [...definition.roleLenses].sort(byId),
    workflows: [...definition.workflows].sort(byId),
    packs: [...definition.packs].sort(byId),
  };
  const result: ValidatedRegistry = {
    ...normalized,
    digest: digestCanonicalJson(normalized),
  };
  const frozen = deepFreeze(result);
  validatedRegistryInstances.add(frozen);
  return frozen;
}

export function assertValidatedRegistry(
  value: unknown,
): asserts value is ValidatedRegistry {
  if (
    value === null ||
    typeof value !== "object" ||
    !validatedRegistryInstances.has(value)
  ) {
    throw new TypeError(
      "registry must be produced by validateRegistry in this process",
    );
  }
}
