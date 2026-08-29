import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import type { EngineId } from "./contract-vocabulary.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import { closedObject, contractRoot, reference } from "./schema-fragments.js";

export const ENGINE_SNAPSHOT_MAX_FILES = 8_192;
export const ENGINE_SNAPSHOT_MAX_DIRECTORIES = 4_096;
export const ENGINE_SNAPSHOT_MAX_FILE_BYTES: number = 256 * 1024 * 1024;
export const ENGINE_SNAPSHOT_MAX_TOTAL_BYTES: number = 1024 * 1024 * 1024;
export const ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES: readonly string[] =
  Object.freeze([
    ".agents",
    ".ai-game-playbook",
    ".git",
    ".godot",
    ".worktrees",
  ]);
export const ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/engine-snapshot-exclusion-policy",
    version: "1.0.0",
    scope: "top-level-exact-name",
    excluded: ENGINE_SNAPSHOT_EXCLUDED_TOP_LEVEL_ENTRIES,
  });

export interface EngineProjectSnapshotDigestInput {
  readonly kind: "bounded-read-only-source";
  readonly engine: EngineId;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectInspectionDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
  readonly exclusionPolicyDigest: typeof ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST;
  readonly fileCount: number;
  readonly directoryCount: number;
  readonly totalBytes: number;
  readonly capturedAt: string;
}

export interface EngineProjectSnapshot extends EngineProjectSnapshotDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly snapshotDigest: Sha256Digest;
}

export interface EngineExecutableSnapshotDigestInput {
  readonly kind: "identity-bound-executable";
  readonly engine: EngineId;
  readonly executableDigest: Sha256Digest;
  readonly executableIdentityDigest: Sha256Digest;
  readonly bytes: number;
  readonly capturedAt: string;
}

export interface EngineExecutableSnapshot
  extends EngineExecutableSnapshotDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly snapshotDigest: Sha256Digest;
}

export interface EngineExecutionSnapshotBindingDigestInput {
  readonly engine: EngineId;
  readonly project: EngineProjectSnapshot;
  readonly executable: EngineExecutableSnapshot;
}

export interface EngineExecutionSnapshotBinding
  extends EngineExecutionSnapshotBindingDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly bindingDigest: Sha256Digest;
}

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function dataObject(
  value: unknown,
  keys: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    throw new TypeError(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    throw new TypeError(message);
  }
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(message);
    }
  }
  return value as Record<string, unknown>;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function engine(value: unknown): value is EngineId {
  return value === "godot" || value === "unity" || value === "unreal";
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function validateProjectInput(input: EngineProjectSnapshotDigestInput): void {
  const value = dataObject(
    input,
    [
      "kind",
      "engine",
      "projectRootIdentityDigest",
      "projectInspectionDigest",
      "manifestDigest",
      "exclusionPolicyDigest",
      "fileCount",
      "directoryCount",
      "totalBytes",
      "capturedAt",
    ],
    "engine project snapshot is outside the contract",
  );
  if (
    ownValue(value, "kind") !== "bounded-read-only-source" ||
    !engine(ownValue(value, "engine")) ||
    !isSha256Digest(ownValue(value, "projectRootIdentityDigest")) ||
    !isSha256Digest(ownValue(value, "projectInspectionDigest")) ||
    !isSha256Digest(ownValue(value, "manifestDigest")) ||
    ownValue(value, "exclusionPolicyDigest") !==
      ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST ||
    !integer(ownValue(value, "fileCount"), 1, ENGINE_SNAPSHOT_MAX_FILES) ||
    !integer(
      ownValue(value, "directoryCount"),
      1,
      ENGINE_SNAPSHOT_MAX_DIRECTORIES,
    ) ||
    !integer(
      ownValue(value, "totalBytes"),
      1,
      ENGINE_SNAPSHOT_MAX_TOTAL_BYTES,
    ) ||
    !timestamp(ownValue(value, "capturedAt"))
  ) {
    throw new TypeError("engine project snapshot is outside the contract");
  }
}

export function computeEngineProjectSnapshotDigest(
  input: EngineProjectSnapshotDigestInput,
): Sha256Digest {
  validateProjectInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-project-snapshot",
    version: "1.0.0",
    snapshot: input,
  });
}

export function assertEngineProjectSnapshotSemantics(
  snapshot: EngineProjectSnapshot,
): void {
  const value = dataObject(
    snapshot,
    [
      "schemaVersion",
      "kind",
      "engine",
      "projectRootIdentityDigest",
      "projectInspectionDigest",
      "manifestDigest",
      "exclusionPolicyDigest",
      "fileCount",
      "directoryCount",
      "totalBytes",
      "capturedAt",
      "snapshotDigest",
    ],
    "engine project snapshot is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "snapshotDigest"))
  ) {
    throw new TypeError("engine project snapshot is outside the contract");
  }
  const input = {
    kind: ownValue(value, "kind"),
    engine: ownValue(value, "engine"),
    projectRootIdentityDigest: ownValue(value, "projectRootIdentityDigest"),
    projectInspectionDigest: ownValue(value, "projectInspectionDigest"),
    manifestDigest: ownValue(value, "manifestDigest"),
    exclusionPolicyDigest: ownValue(value, "exclusionPolicyDigest"),
    fileCount: ownValue(value, "fileCount"),
    directoryCount: ownValue(value, "directoryCount"),
    totalBytes: ownValue(value, "totalBytes"),
    capturedAt: ownValue(value, "capturedAt"),
  } as EngineProjectSnapshotDigestInput;
  if (
    ownValue(value, "snapshotDigest") !==
    computeEngineProjectSnapshotDigest(input)
  ) {
    throw new TypeError("engine project snapshot digest does not attest the snapshot");
  }
}

function validateExecutableInput(
  input: EngineExecutableSnapshotDigestInput,
): void {
  const value = dataObject(
    input,
    [
      "kind",
      "engine",
      "executableDigest",
      "executableIdentityDigest",
      "bytes",
      "capturedAt",
    ],
    "engine executable snapshot is outside the contract",
  );
  if (
    ownValue(value, "kind") !== "identity-bound-executable" ||
    !engine(ownValue(value, "engine")) ||
    !isSha256Digest(ownValue(value, "executableDigest")) ||
    !isSha256Digest(ownValue(value, "executableIdentityDigest")) ||
    !integer(ownValue(value, "bytes"), 1, ENGINE_SNAPSHOT_MAX_FILE_BYTES) ||
    !timestamp(ownValue(value, "capturedAt"))
  ) {
    throw new TypeError("engine executable snapshot is outside the contract");
  }
}

export function computeEngineExecutableSnapshotDigest(
  input: EngineExecutableSnapshotDigestInput,
): Sha256Digest {
  validateExecutableInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-executable-snapshot",
    version: "1.0.0",
    snapshot: input,
  });
}

export function assertEngineExecutableSnapshotSemantics(
  snapshot: EngineExecutableSnapshot,
): void {
  const value = dataObject(
    snapshot,
    [
      "schemaVersion",
      "kind",
      "engine",
      "executableDigest",
      "executableIdentityDigest",
      "bytes",
      "capturedAt",
      "snapshotDigest",
    ],
    "engine executable snapshot is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "snapshotDigest"))
  ) {
    throw new TypeError("engine executable snapshot is outside the contract");
  }
  const input = {
    kind: ownValue(value, "kind"),
    engine: ownValue(value, "engine"),
    executableDigest: ownValue(value, "executableDigest"),
    executableIdentityDigest: ownValue(value, "executableIdentityDigest"),
    bytes: ownValue(value, "bytes"),
    capturedAt: ownValue(value, "capturedAt"),
  } as EngineExecutableSnapshotDigestInput;
  if (
    ownValue(value, "snapshotDigest") !==
    computeEngineExecutableSnapshotDigest(input)
  ) {
    throw new TypeError(
      "engine executable snapshot digest does not attest the snapshot",
    );
  }
}

function validateBindingInput(
  input: EngineExecutionSnapshotBindingDigestInput,
): void {
  const value = dataObject(
    input,
    ["engine", "project", "executable"],
    "engine execution snapshot binding is outside the contract",
  );
  const selectedEngine = ownValue(value, "engine");
  const project = ownValue(value, "project") as EngineProjectSnapshot;
  const executable = ownValue(value, "executable") as EngineExecutableSnapshot;
  if (!engine(selectedEngine)) {
    throw new TypeError("engine execution snapshot binding is outside the contract");
  }
  assertEngineProjectSnapshotSemantics(project);
  assertEngineExecutableSnapshotSemantics(executable);
  if (
    project.engine !== selectedEngine ||
    executable.engine !== selectedEngine ||
    project.capturedAt !== executable.capturedAt
  ) {
    throw new TypeError(
      "engine execution snapshot identities do not share one capture",
    );
  }
}

export function computeEngineExecutionSnapshotBindingDigest(
  input: EngineExecutionSnapshotBindingDigestInput,
): Sha256Digest {
  validateBindingInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/engine-execution-snapshot-binding",
    version: "1.0.0",
    binding: input,
  });
}

export function assertEngineExecutionSnapshotBindingSemantics(
  binding: EngineExecutionSnapshotBinding,
): void {
  const value = dataObject(
    binding,
    ["schemaVersion", "engine", "project", "executable", "bindingDigest"],
    "engine execution snapshot binding is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "bindingDigest"))
  ) {
    throw new TypeError("engine execution snapshot binding is outside the contract");
  }
  const input = {
    engine: ownValue(value, "engine"),
    project: ownValue(value, "project"),
    executable: ownValue(value, "executable"),
  } as EngineExecutionSnapshotBindingDigestInput;
  if (
    ownValue(value, "bindingDigest") !==
    computeEngineExecutionSnapshotBindingDigest(input)
  ) {
    throw new TypeError(
      "engine execution snapshot binding digest does not attest the binding",
    );
  }
}

const projectProperties = {
  schemaVersion: { type: "string" },
  kind: { type: "string", const: "bounded-read-only-source" },
  engine: reference("engineId"),
  projectRootIdentityDigest: reference("sha256Digest"),
  projectInspectionDigest: reference("sha256Digest"),
  manifestDigest: reference("sha256Digest"),
  exclusionPolicyDigest: {
    type: "string",
    const: ENGINE_SNAPSHOT_EXCLUSION_POLICY_DIGEST,
  },
  fileCount: { type: "integer", minimum: 1, maximum: ENGINE_SNAPSHOT_MAX_FILES },
  directoryCount: {
    type: "integer",
    minimum: 1,
    maximum: ENGINE_SNAPSHOT_MAX_DIRECTORIES,
  },
  totalBytes: {
    type: "integer",
    minimum: 1,
    maximum: ENGINE_SNAPSHOT_MAX_TOTAL_BYTES,
  },
  capturedAt: reference("timestamp"),
  snapshotDigest: reference("sha256Digest"),
};

const executableProperties = {
  schemaVersion: { type: "string" },
  kind: { type: "string", const: "identity-bound-executable" },
  engine: reference("engineId"),
  executableDigest: reference("sha256Digest"),
  executableIdentityDigest: reference("sha256Digest"),
  bytes: {
    type: "integer",
    minimum: 1,
    maximum: ENGINE_SNAPSHOT_MAX_FILE_BYTES,
  },
  capturedAt: reference("timestamp"),
  snapshotDigest: reference("sha256Digest"),
};

export const engineProjectSnapshotSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-project-snapshot",
    version: "1.0.0",
    title: "Engine project snapshot",
    schema: contractRoot(projectProperties, Object.keys(projectProperties)),
  });

export const engineExecutableSnapshotSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-executable-snapshot",
    version: "1.0.0",
    title: "Engine executable snapshot",
    schema: contractRoot(executableProperties, Object.keys(executableProperties)),
  });

export const engineExecutionSnapshotBindingSchema: VersionedContractSchema =
  defineContractSchema({
    id: "engine-execution-snapshot-binding",
    version: "1.0.0",
    title: "Engine execution snapshot binding",
    schema: contractRoot(
      {
        schemaVersion: { type: "string" },
        engine: reference("engineId"),
        project: closedObject(projectProperties, Object.keys(projectProperties)),
        executable: closedObject(
          executableProperties,
          Object.keys(executableProperties),
        ),
        bindingDigest: reference("sha256Digest"),
      },
      ["schemaVersion", "engine", "project", "executable", "bindingDigest"],
    ),
  });
