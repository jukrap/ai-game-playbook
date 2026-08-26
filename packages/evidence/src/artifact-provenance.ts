import {
  assetProvenanceSchema,
  checkAssetProvenanceSemantics,
  compareCanonicalText,
  digestCanonicalJson,
  isSha256Digest,
  parsePortableProjectPath,
  type AssetLifecycleState,
  type AssetProvenance,
  type ComponentOutcome,
  type PortableProjectPath,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  RegistryContractValueError,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import { EvidenceNormalizationError } from "./errors.js";

const ASSET_FILE_MAX_BYTES = 1_099_511_627_776;

type DataRecord = Record<string, unknown>;
type AssetProvenanceStatus = Extract<ComponentOutcome, "passed" | "failed">;

export interface AssetProvenanceFileIdentity {
  readonly path: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
}

export interface AssetProvenanceAssessmentRequest {
  readonly registry: ValidatedRegistry;
  readonly provenance: unknown;
  readonly file: AssetProvenanceFileIdentity;
}

export type AssetProvenanceAssessmentCode =
  | "artifact.provenance-passed"
  | "artifact.provenance-schema-invalid"
  | "artifact.provenance-semantics-invalid"
  | "artifact.provenance-current-file-mismatch";

export interface AssetProvenanceSummary {
  readonly assetId: StableId;
  readonly slotId: StableId;
  readonly state: AssetLifecycleState;
  readonly sourceKind: AssetProvenance["source"]["kind"];
  readonly lineageStages: number;
  readonly currentFiles: number;
  readonly qa: {
    readonly pass: number;
    readonly fail: number;
    readonly unverified: number;
    readonly waived: number;
  };
  readonly rights: {
    readonly commercialUse: AssetProvenance["rights"]["commercialUse"];
    readonly redistribution: AssetProvenance["rights"]["redistribution"];
  };
}

export interface AssetProvenanceAssessment {
  readonly component: "artifact-provenance";
  readonly status: AssetProvenanceStatus;
  readonly code: AssetProvenanceAssessmentCode;
  readonly message: string;
  readonly file: {
    readonly path: PortableProjectPath;
    readonly digest: Sha256Digest;
    readonly bytes: number;
  };
  readonly recordDigest?: Sha256Digest;
  readonly semanticIssueCodes: readonly string[];
  readonly asset?: AssetProvenanceSummary;
}

interface NormalizedProvenanceRequest {
  readonly registry: ValidatedRegistry;
  readonly provenance: unknown;
  readonly file: {
    readonly path: PortableProjectPath;
    readonly digest: Sha256Digest;
    readonly bytes: number;
  };
}

function invalid(
  path: string,
  message: string,
  code:
    | "invalid-artifact-provenance-request"
    | "artifact-provenance-authority-mismatch" =
    "invalid-artifact-provenance-request",
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
      "artifact-provenance-authority-mismatch",
    );
  }
  return value;
}

function normalizeFile(value: unknown): NormalizedProvenanceRequest["file"] {
  const file = plainRecord(value, "$request.file");
  exactKeys(file, ["path", "digest", "bytes"], "$request.file");
  let path: PortableProjectPath;
  try {
    path = parsePortableProjectPath(file["path"]);
  } catch {
    invalid("$request.file.path", "file path must be a portable project path");
  }
  if (!isSha256Digest(file["digest"])) {
    invalid("$request.file.digest", "file digest must be canonical SHA-256");
  }
  if (
    !Number.isSafeInteger(file["bytes"]) ||
    (file["bytes"] as number) < 0 ||
    (file["bytes"] as number) > ASSET_FILE_MAX_BYTES
  ) {
    invalid("$request.file.bytes", "file bytes are outside the contract boundary");
  }
  return Object.freeze({
    path,
    digest: file["digest"],
    bytes: file["bytes"] as number,
  });
}

function normalizeRequest(
  value: AssetProvenanceAssessmentRequest,
): NormalizedProvenanceRequest {
  const request = plainRecord(value, "$request");
  exactKeys(request, ["registry", "provenance", "file"], "$request");
  return Object.freeze({
    registry: validatedRegistry(request["registry"]),
    provenance: request["provenance"],
    file: normalizeFile(request["file"]),
  });
}

function freezeIssueCodes(values: readonly string[]): readonly string[] {
  return Object.freeze([...values].sort(compareCanonicalText));
}

function result(
  request: NormalizedProvenanceRequest,
  status: AssetProvenanceStatus,
  code: AssetProvenanceAssessmentCode,
  message: string,
  options: {
    readonly recordDigest?: Sha256Digest;
    readonly semanticIssueCodes?: readonly string[];
    readonly asset?: AssetProvenanceSummary;
  } = {},
): AssetProvenanceAssessment {
  return Object.freeze({
    component: "artifact-provenance",
    status,
    code,
    message,
    file: request.file,
    ...(options.recordDigest === undefined
      ? {}
      : { recordDigest: options.recordDigest }),
    semanticIssueCodes: freezeIssueCodes(options.semanticIssueCodes ?? []),
    ...(options.asset === undefined ? {} : { asset: options.asset }),
  });
}

function validateProvenance(
  request: NormalizedProvenanceRequest,
): AssetProvenance | undefined {
  try {
    return validateRegisteredContractValue(
      request.registry,
      {
        schemaId: assetProvenanceSchema.schemaId,
        digest: assetProvenanceSchema.digest,
      },
      request.provenance,
    ) as unknown as AssetProvenance;
  } catch (error) {
    if (
      error instanceof RegistryContractValueError &&
      error.code === "registered-value-invalid"
    ) {
      return undefined;
    }
    invalid(
      "$request.registry",
      "registry does not provide the exact asset provenance contract",
      "artifact-provenance-authority-mismatch",
    );
  }
}

function summarizeQa(asset: AssetProvenance): AssetProvenanceSummary["qa"] {
  const counts = { pass: 0, fail: 0, unverified: 0, waived: 0 };
  for (const qa of asset.qa) counts[qa.outcome] += 1;
  return Object.freeze(counts);
}

function summarizeAsset(asset: AssetProvenance): AssetProvenanceSummary {
  return Object.freeze({
    assetId: asset.assetId,
    slotId: asset.slotId,
    state: asset.state,
    sourceKind: asset.source.kind,
    lineageStages: asset.lineage.length,
    currentFiles: asset.currentFiles.length,
    qa: summarizeQa(asset),
    rights: Object.freeze({
      commercialUse: asset.rights.commercialUse,
      redistribution: asset.rights.redistribution,
    }),
  });
}

function computeRecordDigest(asset: AssetProvenance): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook.asset-provenance-record",
    version: "1",
    subject: asset,
  });
}

export function assessAssetProvenance(
  value: AssetProvenanceAssessmentRequest,
): AssetProvenanceAssessment {
  const request = normalizeRequest(value);
  const asset = validateProvenance(request);
  if (asset === undefined) {
    return result(
      request,
      "failed",
      "artifact.provenance-schema-invalid",
      "Asset provenance does not satisfy the registered contract.",
    );
  }
  const recordDigest = computeRecordDigest(asset);
  const semanticIssueCodes = freezeIssueCodes(
    checkAssetProvenanceSemantics(asset).map(({ code }) => code),
  );
  if (semanticIssueCodes.length > 0) {
    return result(
      request,
      "failed",
      "artifact.provenance-semantics-invalid",
      "Asset provenance semantic invariants are invalid.",
      { recordDigest, semanticIssueCodes },
    );
  }
  const matched = asset.currentFiles.some(
    (file) =>
      file.path === request.file.path &&
      file.digest === request.file.digest &&
      file.bytes === request.file.bytes,
  );
  if (!matched) {
    return result(
      request,
      "failed",
      "artifact.provenance-current-file-mismatch",
      "Asset provenance does not attest the assessed current file.",
      { recordDigest },
    );
  }
  return result(
    request,
    "passed",
    "artifact.provenance-passed",
    "Asset provenance is valid for the assessed current file.",
    { recordDigest, asset: summarizeAsset(asset) },
  );
}
