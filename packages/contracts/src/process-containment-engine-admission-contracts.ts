import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import type { EngineId } from "./contract-vocabulary.js";
import { closedObject, contractRoot, reference } from "./schema-fragments.js";
import { isStableId, type StableId } from "./stable-id.js";
import { PROCESS_CONTAINMENT_POLICY_DIGEST } from "./process-containment-assessment-contracts.js";

export const PROCESS_CONTAINMENT_ENGINE_ADMISSION_MAX_VALIDITY_MS = 30_000;

export interface ProcessContainmentEngineAdmissionDigestInput {
  readonly admissionId: string;
  readonly providerDescriptorDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly host: {
    readonly platform: "windows" | "linux";
    readonly architecture: "x64" | "arm64";
  };
  readonly engine: EngineId;
  readonly workload: "engine-project-process";
  readonly policyDigest: typeof PROCESS_CONTAINMENT_POLICY_DIGEST;
  readonly qualification: {
    readonly syntheticLaunchRequestDigest: Sha256Digest;
    readonly syntheticLaunchReportDigest: Sha256Digest;
    readonly expiresAt: string;
  };
  readonly operationId: StableId;
  readonly invocationDigest: Sha256Digest;
  readonly snapshotBindingDigest: Sha256Digest;
  readonly projectRootIdentityDigest: Sha256Digest;
  readonly projectSnapshotDigest: Sha256Digest;
  readonly executableSnapshotDigest: Sha256Digest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly decision: "qualified";
  readonly evidenceGrade: "locally-executed";
}

export interface ProcessContainmentEngineAdmission
  extends ProcessContainmentEngineAdmissionDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly admissionDigest: Sha256Digest;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    timestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(Date.parse(value)).toISOString() === value
  );
}

function validateInput(input: ProcessContainmentEngineAdmissionDigestInput): void {
  const value = dataObject(
    input,
    [
      "admissionId",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "engine",
      "workload",
      "policyDigest",
      "qualification",
      "operationId",
      "invocationDigest",
      "snapshotBindingDigest",
      "projectRootIdentityDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "issuedAt",
      "expiresAt",
      "decision",
      "evidenceGrade",
    ],
    "process containment engine admission is outside the contract",
  );
  const host = dataObject(
    ownValue(value, "host"),
    ["platform", "architecture"],
    "process containment engine admission host is outside the contract",
  );
  const qualification = dataObject(
    ownValue(value, "qualification"),
    ["syntheticLaunchRequestDigest", "syntheticLaunchReportDigest", "expiresAt"],
    "process containment engine qualification is outside the contract",
  );
  const admissionId = ownValue(value, "admissionId");
  const issuedAt = ownValue(value, "issuedAt");
  const expiresAt = ownValue(value, "expiresAt");
  const qualificationExpiresAt = ownValue(qualification, "expiresAt");
  if (
    typeof admissionId !== "string" ||
    !uuidPattern.test(admissionId) ||
    !isSha256Digest(ownValue(value, "providerDescriptorDigest")) ||
    !isSha256Digest(ownValue(value, "providerCatalogDigest")) ||
    (ownValue(host, "platform") !== "windows" &&
      ownValue(host, "platform") !== "linux") ||
    (ownValue(host, "architecture") !== "x64" &&
      ownValue(host, "architecture") !== "arm64") ||
    (ownValue(value, "engine") !== "godot" &&
      ownValue(value, "engine") !== "unity" &&
      ownValue(value, "engine") !== "unreal") ||
    ownValue(value, "workload") !== "engine-project-process" ||
    ownValue(value, "policyDigest") !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    !isSha256Digest(ownValue(qualification, "syntheticLaunchRequestDigest")) ||
    !isSha256Digest(ownValue(qualification, "syntheticLaunchReportDigest")) ||
    !timestamp(qualificationExpiresAt) ||
    !isStableId(ownValue(value, "operationId")) ||
    !isSha256Digest(ownValue(value, "invocationDigest")) ||
    !isSha256Digest(ownValue(value, "snapshotBindingDigest")) ||
    !isSha256Digest(ownValue(value, "projectRootIdentityDigest")) ||
    !isSha256Digest(ownValue(value, "projectSnapshotDigest")) ||
    !isSha256Digest(ownValue(value, "executableSnapshotDigest")) ||
    !timestamp(issuedAt) ||
    !timestamp(expiresAt) ||
    ownValue(value, "decision") !== "qualified" ||
    ownValue(value, "evidenceGrade") !== "locally-executed"
  ) {
    throw new TypeError(
      "process containment engine admission is outside the contract",
    );
  }
  const validity = Date.parse(expiresAt) - Date.parse(issuedAt);
  if (
    validity < 1 ||
    validity > PROCESS_CONTAINMENT_ENGINE_ADMISSION_MAX_VALIDITY_MS ||
    Date.parse(expiresAt) > Date.parse(qualificationExpiresAt)
  ) {
    throw new TypeError(
      "process containment engine admission freshness is outside the contract",
    );
  }
}

export function computeProcessContainmentEngineAdmissionDigest(
  input: ProcessContainmentEngineAdmissionDigestInput,
): Sha256Digest {
  validateInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-admission",
    version: "1.0.0",
    admission: input,
  });
}

export function assertProcessContainmentEngineAdmissionSemantics(
  admission: ProcessContainmentEngineAdmission,
): void {
  const value = dataObject(
    admission,
    [
      "schemaVersion",
      "admissionId",
      "providerDescriptorDigest",
      "providerCatalogDigest",
      "host",
      "engine",
      "workload",
      "policyDigest",
      "qualification",
      "operationId",
      "invocationDigest",
      "snapshotBindingDigest",
      "projectRootIdentityDigest",
      "projectSnapshotDigest",
      "executableSnapshotDigest",
      "issuedAt",
      "expiresAt",
      "decision",
      "evidenceGrade",
      "admissionDigest",
    ],
    "process containment engine admission is outside the contract",
  );
  if (
    ownValue(value, "schemaVersion") !== "1.0.0" ||
    !isSha256Digest(ownValue(value, "admissionDigest"))
  ) {
    throw new TypeError(
      "process containment engine admission is outside the contract",
    );
  }
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) =>
      key !== "schemaVersion" && key !== "admissionDigest",
    ),
  ) as unknown as ProcessContainmentEngineAdmissionDigestInput;
  if (
    ownValue(value, "admissionDigest") !==
    computeProcessContainmentEngineAdmissionDigest(input)
  ) {
    throw new TypeError(
      "process containment engine admission digest does not attest the admission",
    );
  }
}

const hostSchema = closedObject(
  {
    platform: { type: "string", enum: ["windows", "linux"] },
    architecture: { type: "string", enum: ["x64", "arm64"] },
  },
  ["platform", "architecture"],
);

const qualificationSchema = closedObject(
  {
    syntheticLaunchRequestDigest: reference("sha256Digest"),
    syntheticLaunchReportDigest: reference("sha256Digest"),
    expiresAt: reference("timestamp"),
  },
  ["syntheticLaunchRequestDigest", "syntheticLaunchReportDigest", "expiresAt"],
);

const admissionProperties = {
  schemaVersion: { type: "string" },
  admissionId: reference("uuid"),
  providerDescriptorDigest: reference("sha256Digest"),
  providerCatalogDigest: reference("sha256Digest"),
  host: hostSchema,
  engine: reference("engineId"),
  workload: { type: "string", const: "engine-project-process" },
  policyDigest: { type: "string", const: PROCESS_CONTAINMENT_POLICY_DIGEST },
  qualification: qualificationSchema,
  operationId: reference("stableId"),
  invocationDigest: reference("sha256Digest"),
  snapshotBindingDigest: reference("sha256Digest"),
  projectRootIdentityDigest: reference("sha256Digest"),
  projectSnapshotDigest: reference("sha256Digest"),
  executableSnapshotDigest: reference("sha256Digest"),
  issuedAt: reference("timestamp"),
  expiresAt: reference("timestamp"),
  decision: { type: "string", const: "qualified" },
  evidenceGrade: { type: "string", const: "locally-executed" },
  admissionDigest: reference("sha256Digest"),
};

export const processContainmentEngineAdmissionSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-admission",
    version: "1.0.0",
    title: "Process containment engine admission",
    schema: contractRoot(
      admissionProperties,
      Object.keys(admissionProperties),
    ),
  });
