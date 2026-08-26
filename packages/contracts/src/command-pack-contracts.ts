import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type {
  EffectBoundary,
  ExecutionBudgets,
  ExecutionLane,
  Lifecycle,
  OperatingSystem,
  PermissionClass,
  ProjectStage,
  SchemaReference,
} from "./contract-vocabulary.js";
import type { SemanticVersion } from "./semantic-version.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import type { StableId } from "./stable-id.js";

export type RetryProofMechanism =
  | "content-addressed-write"
  | "compare-and-swap"
  | "idempotency-key"
  | "transactional-rollback";

export interface RetryIdempotencyProof {
  readonly mechanism: RetryProofMechanism;
  readonly scope: string;
  readonly evidenceKind: StableId;
  readonly proofDigest: Sha256Digest;
  readonly uncertainOutcome: "stop";
}

export type CommandRetryPolicy =
  | {
      readonly mode: "never";
      readonly maxAttempts: 1;
      readonly backoffMs?: never;
      readonly proof?: never;
    }
  | {
      readonly mode: "read-only";
      readonly maxAttempts: number;
      readonly backoffMs?: readonly number[];
      readonly proof?: never;
    }
  | {
      readonly mode: "proven-idempotent";
      readonly maxAttempts: number;
      readonly backoffMs?: readonly number[];
      readonly proof: RetryIdempotencyProof;
    };

export interface CommandDescriptor {
  readonly schemaVersion: SemanticVersion;
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly lifecycle: Lifecycle;
  readonly summary: string;
  readonly cli: {
    readonly path: readonly string[];
    readonly aliases: readonly (readonly string[])[];
  };
  readonly input: SchemaReference;
  readonly output: SchemaReference;
  readonly capabilities: readonly StableId[];
  readonly supportedStages: readonly ProjectStage[];
  readonly permissions: readonly PermissionClass[];
  readonly sideEffects: readonly {
    readonly kind:
      | "none"
      | "filesystem"
      | "process"
      | "editor"
      | "network"
      | "external";
    readonly scope: string;
    readonly boundary: EffectBoundary;
  }[];
  readonly lane: ExecutionLane;
  readonly timeoutMs: number;
  readonly cancellation: {
    readonly mode: "cooperative" | "process-tree" | "not-applicable";
    readonly graceMs: number;
  };
  readonly retry: CommandRetryPolicy;
  readonly budgets: ExecutionBudgets;
  readonly requiredEvidence: readonly StableId[];
  readonly handler: {
    readonly package: string;
    readonly export: string;
    readonly digest: Sha256Digest;
  };
}

const cliPath = boundedArray(
  { type: "string", pattern: "^[a-z][a-z0-9-]*$", maxLength: 64 },
  { minimum: 1, maximum: 8 },
);

const commandCli = closedObject(
  {
    path: cliPath,
    aliases: boundedArray(cliPath, { maximum: 16 }),
  },
  ["path", "aliases"],
);

const sideEffect = closedObject(
  {
    kind: enumSchema([
      "none",
      "filesystem",
      "process",
      "editor",
      "network",
      "external",
    ]),
    scope: reference("shortText"),
    boundary: reference("effectBoundary"),
  },
  ["kind", "scope", "boundary"],
);

const cancellation = closedObject(
  {
    mode: enumSchema(["cooperative", "process-tree", "not-applicable"]),
    graceMs: { type: "integer", minimum: 0, maximum: 300000 },
  },
  ["mode", "graceMs"],
);

const retryProof = closedObject(
  {
    mechanism: enumSchema([
      "content-addressed-write",
      "compare-and-swap",
      "idempotency-key",
      "transactional-rollback",
    ]),
    scope: reference("shortText"),
    evidenceKind: reference("stableId"),
    proofDigest: reference("sha256Digest"),
    uncertainOutcome: { const: "stop" },
  },
  [
    "mechanism",
    "scope",
    "evidenceKind",
    "proofDigest",
    "uncertainOutcome",
  ],
);

const retryRoot = closedObject(
  {
    mode: enumSchema(["never", "read-only", "proven-idempotent"]),
    maxAttempts: { type: "integer", minimum: 1, maximum: 5 },
    backoffMs: boundedArray(
      { type: "integer", minimum: 0, maximum: 300000 },
      { maximum: 4 },
    ),
    proof: retryProof,
  },
  ["mode", "maxAttempts"],
);

const retry = {
  ...retryRoot,
  allOf: [
    {
      if: {
        properties: { mode: { const: "never" } },
        required: ["mode"],
      },
      then: {
        properties: {
          maxAttempts: { const: 1 },
          backoffMs: false,
          proof: false,
        },
      },
    },
    {
      if: {
        properties: { mode: { const: "read-only" } },
        required: ["mode"],
      },
      then: {
        properties: {
          maxAttempts: { type: "integer", minimum: 2, maximum: 5 },
          proof: false,
        },
      },
    },
    {
      if: {
        properties: { mode: { const: "proven-idempotent" } },
        required: ["mode"],
      },
      then: {
        properties: {
          maxAttempts: { type: "integer", minimum: 2, maximum: 5 },
        },
        required: ["proof"],
      },
    },
  ],
};

const commandHandler = closedObject(
  {
    package: {
      type: "string",
      pattern: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$",
      maxLength: 214,
    },
    export: {
      type: "string",
      pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$",
      maxLength: 128,
    },
    digest: reference("sha256Digest"),
  },
  ["package", "export", "digest"],
);

export const commandDescriptorSchema: VersionedContractSchema =
  defineContractSchema({
    id: "command-descriptor",
    version: "1.0.0",
    title: "Command Descriptor",
    description:
      "Declares one bounded command shared by every generated execution surface.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        id: reference("stableId"),
        version: reference("semanticVersion"),
        lifecycle: reference("lifecycle"),
        summary: textSchema(240),
        cli: commandCli,
        input: reference("schemaReference"),
        output: reference("schemaReference"),
        capabilities: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 64,
          unique: true,
        }),
        supportedStages: boundedArray(reference("projectStage"), {
          minimum: 1,
          maximum: 5,
          unique: true,
        }),
        permissions: boundedArray(reference("permissionClass"), {
          maximum: 11,
          unique: true,
        }),
        sideEffects: boundedArray(sideEffect, {
          minimum: 1,
          maximum: 16,
        }),
        lane: reference("executionLane"),
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 604800000,
        },
        cancellation,
        retry,
        budgets: reference("executionBudgets"),
        requiredEvidence: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: 64,
          unique: true,
        }),
        handler: commandHandler,
      },
      [
        "schemaVersion",
        "id",
        "version",
        "lifecycle",
        "summary",
        "cli",
        "input",
        "output",
        "capabilities",
        "supportedStages",
        "permissions",
        "sideEffects",
        "lane",
        "timeoutMs",
        "cancellation",
        "retry",
        "budgets",
        "requiredEvidence",
        "handler",
      ],
    ),
  });

export type PackKind =
  | "engine"
  | "skill"
  | "workflow"
  | "provider"
  | "integration";

export interface PackManifest {
  readonly schemaVersion: SemanticVersion;
  readonly id: StableId;
  readonly version: SemanticVersion;
  readonly kind: PackKind;
  readonly lifecycle: Lifecycle;
  readonly compatibility: {
    readonly controlPlane: VersionInterval;
    readonly operatingSystems: readonly OperatingSystem[];
    readonly engines: readonly ({ readonly engine: "godot" | "unity" | "unreal" } & VersionInterval)[];
    readonly hosts: readonly ({ readonly id: StableId } & VersionInterval)[];
  };
  readonly provides: {
    readonly commands: readonly StableId[];
    readonly skills: readonly StableId[];
    readonly workflows: readonly StableId[];
    readonly capabilities: readonly StableId[];
    readonly schemas: readonly SchemaReference[];
  };
  readonly dependencies: readonly ({
    readonly id: StableId;
    readonly optional: boolean;
  } & VersionInterval)[];
  readonly permissions: readonly PermissionClass[];
  readonly network: {
    readonly required: boolean;
    readonly destinations: readonly {
      readonly host: string;
      readonly port?: number;
      readonly purpose: string;
    }[];
  };
  readonly artifacts: readonly {
    readonly source: string;
    readonly target: string;
    readonly digest: Sha256Digest;
    readonly mode: "file" | "directory" | "template";
  }[];
  readonly ownedPaths: readonly {
    readonly path: string;
    readonly kind: "file" | "directory" | "managed-block" | "link";
    readonly digest?: Sha256Digest;
  }[];
  readonly lifecycleHooks: Partial<
    Readonly<
      Record<"install" | "update" | "remove" | "doctor", StableId>
    >
  >;
  readonly digest: Sha256Digest;
  readonly signature?: {
    readonly algorithm: "ed25519";
    readonly keyId: StableId;
    readonly value: string;
  };
  readonly license:
    | {
        readonly status: "unresolved";
        readonly expression?: never;
        readonly noticeDigest?: never;
      }
    | {
        readonly status: "declared";
        readonly expression: string;
        readonly noticeDigest?: Sha256Digest;
      };
}

export interface VersionInterval {
  readonly minimum: SemanticVersion;
  readonly maximumExclusive: SemanticVersion;
}

export type PackManifestDigestInput = Omit<
  PackManifest,
  "digest" | "signature"
> &
  Partial<Pick<PackManifest, "digest" | "signature">>;

export function computePackManifestDigest(
  manifest: PackManifestDigestInput,
): Sha256Digest {
  const { digest: _digest, signature: _signature, ...payload } = manifest;
  return digestCanonicalJson(payload);
}

export function isPackManifestDigestValid(manifest: PackManifest): boolean {
  try {
    return computePackManifestDigest(manifest) === manifest.digest;
  } catch {
    return false;
  }
}

const versionInterval = closedObject(
  {
    minimum: reference("semanticVersion"),
    maximumExclusive: reference("semanticVersion"),
  },
  ["minimum", "maximumExclusive"],
);

const engineCompatibility = closedObject(
  {
    engine: reference("engineId"),
    minimum: reference("semanticVersion"),
    maximumExclusive: reference("semanticVersion"),
  },
  ["engine", "minimum", "maximumExclusive"],
);

const hostCompatibility = closedObject(
  {
    id: reference("stableId"),
    minimum: reference("semanticVersion"),
    maximumExclusive: reference("semanticVersion"),
  },
  ["id", "minimum", "maximumExclusive"],
);

const packCompatibility = closedObject(
  {
    controlPlane: versionInterval,
    operatingSystems: boundedArray(reference("operatingSystem"), {
      minimum: 1,
      maximum: 3,
      unique: true,
    }),
    engines: boundedArray(engineCompatibility, { maximum: 3 }),
    hosts: boundedArray(hostCompatibility, { maximum: 16 }),
  },
  ["controlPlane", "operatingSystems", "engines", "hosts"],
);

const packProvides = closedObject(
  {
    commands: boundedArray(reference("stableId"), {
      maximum: 256,
      unique: true,
    }),
    skills: boundedArray(reference("stableId"), {
      maximum: 256,
      unique: true,
    }),
    workflows: boundedArray(reference("stableId"), {
      maximum: 256,
      unique: true,
    }),
    capabilities: boundedArray(reference("stableId"), {
      maximum: 256,
      unique: true,
    }),
    schemas: boundedArray(reference("schemaReference"), { maximum: 256 }),
  },
  ["commands", "skills", "workflows", "capabilities", "schemas"],
);

const packDependency = closedObject(
  {
    id: reference("stableId"),
    minimum: reference("semanticVersion"),
    maximumExclusive: reference("semanticVersion"),
    optional: { type: "boolean" },
  },
  ["id", "minimum", "maximumExclusive", "optional"],
);

const networkDestination = closedObject(
  {
    host: {
      type: "string",
      pattern: "^[A-Za-z0-9.-]+$",
      minLength: 1,
      maxLength: 253,
    },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    purpose: reference("shortText"),
  },
  ["host", "purpose"],
);

const networkDeclaration = closedObject(
  {
    required: { type: "boolean" },
    destinations: boundedArray(networkDestination, { maximum: 32 }),
  },
  ["required", "destinations"],
);

const packArtifact = closedObject(
  {
    source: reference("portablePath"),
    target: reference("portablePath"),
    digest: reference("sha256Digest"),
    mode: enumSchema(["file", "directory", "template"]),
  },
  ["source", "target", "digest", "mode"],
);

const ownedPath = closedObject(
  {
    path: reference("portablePath"),
    kind: enumSchema(["file", "directory", "managed-block", "link"]),
    digest: reference("sha256Digest"),
  },
  ["path", "kind"],
);

const lifecycleHooks = closedObject(
  {
    install: reference("stableId"),
    update: reference("stableId"),
    remove: reference("stableId"),
    doctor: reference("stableId"),
  },
  [],
);

const signature = closedObject(
  {
    algorithm: { const: "ed25519" },
    keyId: reference("stableId"),
    value: { type: "string", minLength: 1, maxLength: 1024 },
  },
  ["algorithm", "keyId", "value"],
);

const licenseRoot = closedObject(
  {
    status: enumSchema(["unresolved", "declared"]),
    expression: { type: "string", minLength: 1, maxLength: 256 },
    noticeDigest: reference("sha256Digest"),
  },
  ["status"],
);

const license = {
  ...licenseRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { status: { const: "declared" } },
        required: ["status"],
      },
      then: {
        type: "object",
        properties: {
          expression: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["expression"],
      },
    },
    {
      if: {
        type: "object",
        properties: { status: { const: "unresolved" } },
        required: ["status"],
      },
      then: {
        type: "object",
        properties: {
          expression: false,
          noticeDigest: false,
        },
      },
    },
  ],
};

export const packManifestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "pack-manifest",
    version: "1.0.0",
    title: "Pack Manifest",
    description:
      "Declares compatibility, authority, artifacts, ownership, and lifecycle for one installable pack.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        id: reference("stableId"),
        version: reference("semanticVersion"),
        kind: enumSchema([
          "engine",
          "skill",
          "workflow",
          "provider",
          "integration",
        ]),
        lifecycle: reference("lifecycle"),
        compatibility: packCompatibility,
        provides: packProvides,
        dependencies: boundedArray(packDependency, { maximum: 128 }),
        permissions: boundedArray(reference("permissionClass"), {
          maximum: 11,
          unique: true,
        }),
        network: networkDeclaration,
        artifacts: boundedArray(packArtifact, {
          minimum: 1,
          maximum: 10000,
        }),
        ownedPaths: boundedArray(ownedPath, {
          minimum: 1,
          maximum: 10000,
        }),
        lifecycleHooks,
        digest: reference("sha256Digest"),
        signature,
        license,
      },
      [
        "schemaVersion",
        "id",
        "version",
        "kind",
        "lifecycle",
        "compatibility",
        "provides",
        "dependencies",
        "permissions",
        "network",
        "artifacts",
        "ownedPaths",
        "lifecycleHooks",
        "digest",
        "license",
      ],
    ),
  });
