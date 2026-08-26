import {
  checkRunReceiptSemantics,
  compareCanonicalText,
  isStableId,
  runReceiptSchema,
  type ComponentOutcome,
  type RunReceipt,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  EVIDENCE_ARTIFACT_MAX_TOTAL_BYTES,
  readProjectFileSnapshot,
  verifyRunReceiptArtifacts,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import {
  assertValidatedRegistry,
  RegistryContractValueError,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import {
  ARTIFACT_INSPECTION_MAX_BYTES,
  inspectArtifactBytes,
  normalizeArtifactFormatExpectation,
  type ArtifactFormatAssessment,
  type ArtifactFormatExpectation,
} from "./artifact-format.js";
import {
  assessAssetProvenance,
  type AssetProvenanceAssessment,
} from "./artifact-provenance.js";
import { EvidenceNormalizationError } from "./errors.js";

type DataRecord = Record<string, unknown>;
type ArtifactAssessmentStatus = Extract<
  ComponentOutcome,
  "passed" | "failed" | "unverified"
>;
type ReceiptArtifact = RunReceipt["artifacts"][number];

export interface AssessStoredArtifactRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly artifactId: StableId;
  readonly expectedArtifactKind: StableId;
  readonly expectation: ArtifactFormatExpectation;
  readonly provenance: unknown | null;
  readonly maxArtifactBytes: number;
}

export type ArtifactAssessmentCode =
  | "artifact.assessment-passed"
  | "artifact.assessment-format-failed"
  | "artifact.assessment-format-unverified"
  | "artifact.assessment-provenance-failed"
  | "artifact.assessment-multiple-failed";

export interface AssessedArtifactIdentity {
  readonly artifactId: StableId;
  readonly kind: StableId;
  readonly sourcePath: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly manifestDigest: Sha256Digest;
}

export type ArtifactAssessmentProvenance =
  | { readonly status: "not-required" }
  | AssetProvenanceAssessment;

export interface ArtifactAssessment {
  readonly component: "artifact";
  readonly status: ArtifactAssessmentStatus;
  readonly code: ArtifactAssessmentCode;
  readonly message: string;
  readonly receiptDigest: Sha256Digest;
  readonly artifact: AssessedArtifactIdentity;
  readonly format: ArtifactFormatAssessment;
  readonly provenance: ArtifactAssessmentProvenance;
}

interface NormalizedStoredArtifactRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly artifact: ReceiptArtifact & {
    readonly sourcePath: string;
    readonly manifestDigest: Sha256Digest;
  };
  readonly expectation: ArtifactFormatExpectation;
  readonly provenance: ArtifactAssessmentProvenance;
  readonly maxArtifactBytes: number;
}

interface AggregateAssessment {
  readonly status: ArtifactAssessmentStatus;
  readonly code: ArtifactAssessmentCode;
  readonly message: string;
}

function invalid(
  path: string,
  message: string,
  code:
    | "invalid-stored-artifact-assessment-request"
    | "artifact-assessment-authority-mismatch" =
    "invalid-stored-artifact-assessment-request",
): never {
  throw new EvidenceNormalizationError(code, path, message);
}

function plainRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    invalid(path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    invalid(path, "object properties must be enumerable data fields");
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort(compareCanonicalText);
  const sortedExpected = [...expected].sort(compareCanonicalText);
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    invalid(path, "record contains undeclared fields or omits required fields");
  }
}

function validatedRegistry(value: unknown): ValidatedRegistry {
  try {
    assertValidatedRegistry(value);
  } catch {
    invalid(
      "$request.registry",
      "registry must be validated by this registry runtime",
      "artifact-assessment-authority-mismatch",
    );
  }
  return value;
}

function validatedReceipt(
  registry: ValidatedRegistry,
  value: unknown,
): RunReceipt {
  let receipt: RunReceipt;
  try {
    receipt = validateRegisteredContractValue(
      registry,
      { schemaId: runReceiptSchema.schemaId, digest: runReceiptSchema.digest },
      value,
    ) as unknown as RunReceipt;
  } catch (error) {
    if (
      error instanceof RegistryContractValueError &&
      error.code !== "registered-value-invalid"
    ) {
      invalid(
        "$request.registry",
        "registry does not provide the exact run receipt contract",
        "artifact-assessment-authority-mismatch",
      );
    }
    invalid("$request.receipt", "receipt does not satisfy its registered contract");
  }
  if (checkRunReceiptSemantics(receipt).length > 0) {
    invalid("$request.receipt", "receipt semantic invariants are invalid");
  }
  return receipt;
}

function stableId(value: unknown, path: string): StableId {
  if (typeof value !== "string" || !isStableId(value)) {
    invalid(path, "expected a canonical stable ID");
  }
  return value;
}

function artifactBudget(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > EVIDENCE_ARTIFACT_MAX_TOTAL_BYTES
  ) {
    invalid(
      "$request.maxArtifactBytes",
      "artifact byte budget is outside the fixed store boundary",
    );
  }
  return value as number;
}

function selectArtifact(
  receipt: RunReceipt,
  artifactId: StableId,
  expectedKind: StableId,
): NormalizedStoredArtifactRequest["artifact"] {
  const matches = receipt.artifacts.filter(
    (artifact) => artifact.artifactId === artifactId,
  );
  const artifact = matches[0];
  if (
    matches.length !== 1 ||
    artifact === undefined ||
    artifact.kind !== expectedKind ||
    !artifact.complete ||
    artifact.sourcePath === undefined ||
    artifact.manifestDigest === undefined
  ) {
    invalid(
      "$request.artifactId",
      "assessment requires one exact complete promoted artifact",
    );
  }
  if (artifact.bytes > ARTIFACT_INSPECTION_MAX_BYTES) {
    throw new EvidenceNormalizationError(
      "artifact-inspection-budget-exceeded",
      "$request.receipt.artifacts",
      "artifact exceeds the fixed format inspection byte boundary",
    );
  }
  return artifact as NormalizedStoredArtifactRequest["artifact"];
}

function normalizeRequest(
  value: AssessStoredArtifactRequest,
): NormalizedStoredArtifactRequest {
  const request = plainRecord(value, "$request");
  exactKeys(
    request,
    [
      "root",
      "registry",
      "receipt",
      "artifactId",
      "expectedArtifactKind",
      "expectation",
      "provenance",
      "maxArtifactBytes",
    ],
    "$request",
  );
  const registry = validatedRegistry(request["registry"]);
  const receipt = validatedReceipt(registry, request["receipt"]);
  const artifact = selectArtifact(
    receipt,
    stableId(request["artifactId"], "$request.artifactId"),
    stableId(
      request["expectedArtifactKind"],
      "$request.expectedArtifactKind",
    ),
  );
  const provenance =
    request["provenance"] === null
      ? Object.freeze({ status: "not-required" as const })
      : assessAssetProvenance({
          registry,
          provenance: request["provenance"],
          file: {
            path: artifact.sourcePath,
            digest: artifact.digest,
            bytes: artifact.bytes,
          },
        });
  return Object.freeze({
    root: request["root"] as CanonicalProjectRoot,
    registry,
    receipt,
    artifact,
    expectation: normalizeArtifactFormatExpectation(request["expectation"]),
    provenance,
    maxArtifactBytes: artifactBudget(request["maxArtifactBytes"]),
  });
}
function aggregate(
  format: ArtifactFormatAssessment,
  provenance: ArtifactAssessmentProvenance,
): AggregateAssessment {
  const provenanceFailed = provenance.status === "failed";
  if (format.status === "failed" && provenanceFailed) {
    return {
      status: "failed",
      code: "artifact.assessment-multiple-failed",
      message: "Artifact format and provenance assessments failed.",
    };
  }
  if (format.status === "failed") {
    return {
      status: "failed",
      code: "artifact.assessment-format-failed",
      message: "Artifact format assessment failed.",
    };
  }
  if (provenanceFailed) {
    return {
      status: "failed",
      code: "artifact.assessment-provenance-failed",
      message: "Artifact provenance assessment failed.",
    };
  }
  if (format.status === "unverified") {
    return {
      status: "unverified",
      code: "artifact.assessment-format-unverified",
      message: "Artifact format could not be fully verified.",
    };
  }
  return {
    status: "passed",
    code: "artifact.assessment-passed",
    message: "Artifact format and required provenance passed.",
  };
}

function artifactIdentity(
  artifact: NormalizedStoredArtifactRequest["artifact"],
): AssessedArtifactIdentity {
  return Object.freeze({
    artifactId: artifact.artifactId,
    kind: artifact.kind,
    sourcePath: artifact.sourcePath,
    digest: artifact.digest,
    bytes: artifact.bytes,
    manifestDigest: artifact.manifestDigest,
  });
}

export async function assessStoredArtifact(
  value: AssessStoredArtifactRequest,
): Promise<ArtifactAssessment> {
  const request = normalizeRequest(value);
  await verifyRunReceiptArtifacts({
    root: request.root,
    registry: request.registry,
    receipts: [request.receipt],
    maxArtifactBytes: request.maxArtifactBytes,
  });
  const snapshot = await readProjectFileSnapshot({
    root: request.root,
    path: request.artifact.path,
    maxBytes: Math.max(1, request.artifact.bytes),
  });
  if (
    snapshot.path !== request.artifact.path ||
    snapshot.digest !== request.artifact.digest ||
    snapshot.bytes !== request.artifact.bytes
  ) {
    invalid(
      "$request.receipt.artifacts",
      "retained artifact snapshot differs from its receipt identity",
      "artifact-assessment-authority-mismatch",
    );
  }
  const format = inspectArtifactBytes({
    content: snapshot.content,
    expectation: request.expectation,
    maxBytes: Math.max(1, request.artifact.bytes),
  });
  await verifyRunReceiptArtifacts({
    root: request.root,
    registry: request.registry,
    receipts: [request.receipt],
    maxArtifactBytes: request.maxArtifactBytes,
  });
  const classified = aggregate(format, request.provenance);
  return Object.freeze({
    component: "artifact",
    ...classified,
    receiptDigest: request.receipt.receiptDigest,
    artifact: artifactIdentity(request.artifact),
    format,
    provenance: request.provenance,
  });
}
