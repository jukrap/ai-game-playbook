import {
  canonicalizeJson,
  checkRunReceiptSemantics,
  computeRunReceiptDigest,
  digestCanonicalJson,
  isSha256Digest,
  parsePortableProjectPath,
  runReceiptSchema,
  sha256Digest,
  type PortableProjectPath,
  type RunReceipt,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  assertValidatedRegistry,
  validateRegisteredContractValue,
  type ValidatedRegistry,
} from "@ai-game-playbook/registry";

import {
  CAS_MAX_WRITE_BYTES,
  readProjectFileSnapshot,
  writeProjectFileCas,
  type ProjectFileSnapshotResult,
} from "./cas-write.js";
import { CoreBoundaryError, type CoreBoundaryErrorCode } from "./errors.js";
import {
  assertProjectRootIdentity,
  resolveProjectPath,
  type CanonicalProjectRoot,
} from "./project-path.js";

export const EVIDENCE_ARTIFACT_STORE_PATH =
  ".ai-game-playbook/evidence/artifacts" as const;
export const EVIDENCE_ARTIFACT_MANIFESTS_PATH =
  ".ai-game-playbook/evidence/artifacts/manifests" as const;
export const EVIDENCE_ARTIFACT_OBJECTS_PATH =
  ".ai-game-playbook/evidence/artifacts/objects" as const;
export const EVIDENCE_ARTIFACT_MAX_MANIFEST_BYTES: number = 128 * 1024;
export const EVIDENCE_ARTIFACT_MAX_ARTIFACTS = 256;
export const EVIDENCE_ARTIFACT_MAX_TOTAL_BYTES: number = CAS_MAX_WRITE_BYTES;

const MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
const MANIFEST_KIND = "evidence-artifact-manifest" as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type DataRecord = Record<string, unknown>;
type ReceiptArtifact = RunReceipt["artifacts"][number];
type ManifestArtifact = Omit<ReceiptArtifact, "manifestDigest">;

export interface EvidenceArtifactManifest {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly kind: typeof MANIFEST_KIND;
  readonly projectIdentityDigest: Sha256Digest;
  readonly source: {
    readonly path: PortableProjectPath;
    readonly digest: Sha256Digest;
    readonly bytes: number;
  };
  readonly artifact: ManifestArtifact;
  readonly producer: {
    readonly receiptId: string;
    readonly receiptContextDigest: Sha256Digest;
    readonly identity: RunReceipt["identity"];
    readonly authority: RunReceipt["authority"];
    readonly environment: RunReceipt["environment"];
  };
  readonly manifestDigest: Sha256Digest;
}

export type EvidenceArtifactManifestDigestInput = Omit<
  EvidenceArtifactManifest,
  "manifestDigest"
> &
  Partial<Pick<EvidenceArtifactManifest, "manifestDigest">>;

export interface StoredEvidenceArtifact {
  readonly status: "created" | "ready";
  readonly artifactId: string;
  readonly sourcePath: PortableProjectPath;
  readonly objectPath: PortableProjectPath;
  readonly manifestPath: PortableProjectPath;
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly manifestDigest: Sha256Digest;
}

export interface PromoteRunReceiptArtifactsRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly maxArtifactBytes: number;
}

export interface PromotedRunReceiptArtifacts {
  readonly status: "promoted" | "ready";
  readonly rootIdentityDigest: Sha256Digest;
  readonly receipt: RunReceipt;
  readonly artifacts: readonly StoredEvidenceArtifact[];
}

export interface VerifyRunReceiptArtifactsRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipts: readonly RunReceipt[];
  readonly maxArtifactBytes: number;
}

interface NormalizedPromotionRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipt: RunReceipt;
  readonly maxArtifactBytes: number;
}

interface NormalizedVerificationRequest {
  readonly root: CanonicalProjectRoot;
  readonly registry: ValidatedRegistry;
  readonly receipts: readonly RunReceipt[];
  readonly maxArtifactBytes: number;
}

interface ImmutableWriteResult {
  readonly status: "created" | "ready";
  readonly snapshot: ProjectFileSnapshotResult;
}

interface PlannedArtifactPromotion {
  readonly sourceArtifact: ReceiptArtifact;
  readonly artifact: ReceiptArtifact;
  readonly manifest: EvidenceArtifactManifest;
  readonly alreadyPromoted: boolean;
}

interface PromotedReceiptPlan {
  readonly receipt: RunReceipt;
  readonly promotions: readonly PlannedArtifactPromotion[];
}

function artifactError(
  code: Extract<
    CoreBoundaryErrorCode,
    | "invalid-evidence-artifact-store-request"
    | "evidence-artifact-budget-exceeded"
    | "evidence-artifact-conflict"
    | "evidence-artifact-corrupt"
    | "evidence-artifact-mismatch"
    | "evidence-artifact-source-invalid"
    | "evidence-artifact-store-not-found"
    | "evidence-artifact-write-failed"
  >,
  path: string,
  message: string,
  mutationUncertain = false,
): CoreBoundaryError {
  return new CoreBoundaryError(code, path, message, mutationUncertain);
}

function plainRecord(
  value: unknown,
  code:
    | "invalid-evidence-artifact-store-request"
    | "evidence-artifact-corrupt",
  path: string,
): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw artifactError(code, path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    throw artifactError(
      code,
      path,
      "object properties must be enumerable data fields",
    );
  }
  return value as DataRecord;
}

function exactKeys(
  record: DataRecord,
  expected: readonly string[],
  code:
    | "invalid-evidence-artifact-store-request"
    | "evidence-artifact-corrupt",
  path: string,
): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw artifactError(
      code,
      path,
      "record contains undeclared fields or omits required fields",
    );
  }
}

function assertRegistry(value: unknown): asserts value is ValidatedRegistry {
  try {
    assertValidatedRegistry(value as ValidatedRegistry);
  } catch {
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.registry",
      "registry must be validated by this registry runtime",
    );
  }
}

function validateArtifactBudget(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > EVIDENCE_ARTIFACT_MAX_TOTAL_BYTES
  ) {
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.maxArtifactBytes",
      "artifact byte budget is outside the fixed runtime boundary",
    );
  }
  return value as number;
}

function expectedRuntimeEnvironment(root: CanonicalProjectRoot): {
  readonly platform: "windows" | "linux" | "macos";
  readonly architecture: "x64" | "arm64";
} | undefined {
  const platform =
    root.platform === "win32"
      ? "windows"
      : root.platform === "darwin"
        ? "macos"
        : root.platform === "linux"
          ? "linux"
          : undefined;
  const architecture =
    process.arch === "x64" || process.arch === "arm64"
      ? process.arch
      : undefined;
  return platform === undefined || architecture === undefined
    ? undefined
    : { platform, architecture };
}

function assertReceiptAuthority(
  registry: ValidatedRegistry,
  receipt: RunReceipt,
): void {
  const command = registry.commands.find(
    (candidate) =>
      candidate.id === receipt.authority.command.id &&
      candidate.version === receipt.authority.command.version,
  );
  if (
    receipt.authority.registryDigest !== registry.digest ||
    command === undefined ||
    digestCanonicalJson(command) !== receipt.authority.command.descriptorDigest ||
    command.handler.digest !== receipt.authority.handlerDigest
  ) {
    throw artifactError(
      "evidence-artifact-mismatch",
      "$request.receipt.authority",
      "receipt command authority differs from the bound registry",
    );
  }
}

function validateReceipt(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  value: unknown,
): RunReceipt {
  let receipt: RunReceipt;
  try {
    receipt = validateRegisteredContractValue(
      registry,
      {
        schemaId: runReceiptSchema.schemaId,
        digest: runReceiptSchema.digest,
      },
      value,
    ) as unknown as RunReceipt;
  } catch (error) {
    const detail =
      error instanceof Error ? ` (${error.message.slice(0, 500)})` : "";
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.receipt",
      `receipt does not satisfy the registered contract${detail}`,
    );
  }
  if (checkRunReceiptSemantics(receipt).length > 0) {
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.receipt",
      "receipt semantic invariants are invalid",
    );
  }
  assertReceiptAuthority(registry, receipt);
  const runtime = expectedRuntimeEnvironment(root);
  if (
    runtime === undefined ||
    receipt.environment.platform !== runtime.platform ||
    receipt.environment.architecture !== runtime.architecture ||
    receipt.environment.nodeVersion !== process.versions.node ||
    receipt.environment.projectIdentityDigest !== root.identityDigest
  ) {
    throw artifactError(
      "evidence-artifact-mismatch",
      "$request.receipt.environment",
      "receipt environment differs from the bound project and runtime",
    );
  }
  if (
    !UUID_PATTERN.test(receipt.identity.runId) ||
    !UUID_PATTERN.test(receipt.receiptId)
  ) {
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.receipt.identity",
      "artifact storage requires lowercase path-safe RFC UUID identities",
    );
  }
  if (receipt.artifacts.length > EVIDENCE_ARTIFACT_MAX_ARTIFACTS) {
    throw artifactError(
      "evidence-artifact-budget-exceeded",
      "$request.receipt.artifacts",
      "receipt artifact count exceeds the storage boundary",
    );
  }
  const ids = new Set<string>();
  const startedAt = Date.parse(receipt.timing.startedAt);
  const endedAt = Date.parse(receipt.timing.endedAt);
  for (const artifact of receipt.artifacts) {
    const createdAt = Date.parse(artifact.createdAt);
    if (
      ids.has(artifact.artifactId) ||
      artifact.commandId !== receipt.authority.command.id ||
      createdAt < startedAt ||
      createdAt > endedAt
    ) {
      throw artifactError(
        "invalid-evidence-artifact-store-request",
        "$request.receipt.artifacts",
        "receipt artifacts contain duplicate or contradictory producer identity",
      );
    }
    ids.add(artifact.artifactId);
  }
  return receipt;
}

function normalizePromotionRequest(
  value: PromoteRunReceiptArtifactsRequest,
): NormalizedPromotionRequest {
  const record = plainRecord(
    value,
    "invalid-evidence-artifact-store-request",
    "$request",
  );
  exactKeys(
    record,
    ["root", "registry", "receipt", "maxArtifactBytes"],
    "invalid-evidence-artifact-store-request",
    "$request",
  );
  assertRegistry(record["registry"]);
  const maxArtifactBytes = validateArtifactBudget(record["maxArtifactBytes"]);
  return Object.freeze({
    root: value.root,
    registry: value.registry,
    receipt: validateReceipt(value.root, value.registry, record["receipt"]),
    maxArtifactBytes,
  });
}

function normalizeVerificationRequest(
  value: VerifyRunReceiptArtifactsRequest,
): NormalizedVerificationRequest {
  const record = plainRecord(
    value,
    "invalid-evidence-artifact-store-request",
    "$request",
  );
  exactKeys(
    record,
    ["root", "registry", "receipts", "maxArtifactBytes"],
    "invalid-evidence-artifact-store-request",
    "$request",
  );
  assertRegistry(record["registry"]);
  if (!Array.isArray(record["receipts"])) {
    throw artifactError(
      "invalid-evidence-artifact-store-request",
      "$request.receipts",
      "receipt collection must be an array",
    );
  }
  return Object.freeze({
    root: value.root,
    registry: value.registry,
    receipts: Object.freeze(
      record["receipts"].map((receipt) =>
        validateReceipt(value.root, value.registry, receipt),
      ),
    ),
    maxArtifactBytes: validateArtifactBudget(record["maxArtifactBytes"]),
  });
}

function isUnderPath(path: string, parent: string): boolean {
  const folded = path.toLowerCase();
  const foldedParent = parent.toLowerCase();
  return folded === foldedParent || folded.startsWith(`${foldedParent}/`);
}

function objectPathForDigest(digest: Sha256Digest): PortableProjectPath {
  return parsePortableProjectPath(
    `${EVIDENCE_ARTIFACT_OBJECTS_PATH}/${digest.slice("sha256:".length)}.blob`,
  );
}

function manifestPathForArtifact(
  receiptId: string,
  artifactId: string,
): PortableProjectPath {
  return parsePortableProjectPath(
    `${EVIDENCE_ARTIFACT_MANIFESTS_PATH}/${receiptId}.${artifactId}.json`,
  );
}

export function computeEvidenceArtifactManifestDigest(
  manifest: EvidenceArtifactManifestDigestInput,
): Sha256Digest {
  const { manifestDigest: _manifestDigest, ...body } = manifest;
  return digestCanonicalJson({
    domain: "ai-game-playbook.evidence-artifact-manifest",
    version: "1",
    subject: body,
  });
}

function makeManifest(
  sourcePath: PortableProjectPath,
  artifact: ManifestArtifact,
  receipt: RunReceipt,
): EvidenceArtifactManifest {
  const body: Omit<EvidenceArtifactManifest, "manifestDigest"> = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    kind: MANIFEST_KIND,
    projectIdentityDigest: receipt.environment.projectIdentityDigest,
    source: {
      path: sourcePath,
      digest: artifact.digest,
      bytes: artifact.bytes,
    },
    artifact,
    producer: {
      receiptId: receipt.receiptId,
      receiptContextDigest: computeReceiptContextDigest(receipt),
      identity: receipt.identity,
      authority: receipt.authority,
      environment: receipt.environment,
    },
  };
  return Object.freeze({
    ...body,
    manifestDigest: computeEvidenceArtifactManifestDigest(body),
  });
}

function computeReceiptContextDigest(receipt: RunReceipt): Sha256Digest {
  const {
    artifacts: _artifacts,
    receiptDigest: _receiptDigest,
    ...context
  } = receipt;
  return digestCanonicalJson({
    domain: "ai-game-playbook.evidence-receipt-context",
    version: "1",
    subject: context,
  });
}

function manifestArtifact(artifact: ReceiptArtifact): ManifestArtifact {
  const { manifestDigest: _manifestDigest, ...body } = artifact;
  return Object.freeze(body);
}

function planPromotedReceipt(
  root: CanonicalProjectRoot,
  registry: ValidatedRegistry,
  receipt: RunReceipt,
): PromotedReceiptPlan {
  const artifacts: ReceiptArtifact[] = [];
  const planned: Array<{
    readonly sourceArtifact: ReceiptArtifact;
    readonly artifact: ReceiptArtifact;
    readonly manifest: EvidenceArtifactManifest;
    readonly alreadyPromoted: boolean;
  }> = [];
  for (const artifact of receipt.artifacts) {
    if (!artifact.complete) {
      artifacts.push(artifact);
      continue;
    }
    const alreadyPromoted = artifact.sourcePath !== undefined;
    const sourcePath = alreadyPromoted
      ? parsePortableProjectPath(artifact.sourcePath)
      : parsePortableProjectPath(artifact.path);
    const retainedArtifact = Object.freeze({
      ...manifestArtifact(artifact),
      path: objectPathForDigest(artifact.digest),
      sourcePath,
    });
    const manifest = makeManifest(sourcePath, retainedArtifact, receipt);
    if (
      artifact.manifestDigest !== undefined &&
      artifact.manifestDigest !== manifest.manifestDigest
    ) {
      throw artifactError(
        "evidence-artifact-mismatch",
        artifact.path,
        "artifact manifest attestation differs from its receipt context",
      );
    }
    const promotedArtifact: ReceiptArtifact = Object.freeze({
      ...retainedArtifact,
      manifestDigest: manifest.manifestDigest,
    });
    artifacts.push(promotedArtifact);
    planned.push(
      Object.freeze({
        sourceArtifact: artifact,
        artifact: promotedArtifact,
        manifest,
        alreadyPromoted,
      }),
    );
  }
  const candidate = {
    ...receipt,
    artifacts,
    receiptDigest: computeRunReceiptDigest({ ...receipt, artifacts }),
  };
  return Object.freeze({
    receipt: validateReceipt(root, registry, candidate),
    promotions: Object.freeze(planned),
  });
}

function serializeCanonical(value: unknown): string {
  return `${canonicalizeJson(value)}\n`;
}

async function ensureStoreDirectories(root: CanonicalProjectRoot): Promise<void> {
  for (const path of [
    EVIDENCE_ARTIFACT_STORE_PATH,
    EVIDENCE_ARTIFACT_MANIFESTS_PATH,
    EVIDENCE_ARTIFACT_OBJECTS_PATH,
  ]) {
    try {
      await resolveProjectPath(root, path, {
        expectedType: "directory",
        existence: "required",
      });
    } catch (error) {
      if (
        error instanceof CoreBoundaryError &&
        error.code === "project-path-not-found"
      ) {
        throw artifactError(
          "evidence-artifact-store-not-found",
          path,
          "artifact storage has not been initialized",
        );
      }
      if (
        error instanceof CoreBoundaryError &&
        error.code === "project-root-drift"
      ) {
        throw artifactError(
          "evidence-artifact-mismatch",
          path,
          "project root changed before artifact storage was opened",
        );
      }
      throw artifactError(
        "evidence-artifact-corrupt",
        path,
        "artifact storage is not an exact project-local directory",
      );
    }
  }
}

async function readOptionalSnapshot(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  maxBytes: number,
): Promise<ProjectFileSnapshotResult | undefined> {
  let target;
  try {
    target = await resolveProjectPath(root, path, {
      expectedType: "file",
      existence: "optional",
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      error.code === "project-root-drift"
    ) {
      throw artifactError(
        "evidence-artifact-mismatch",
        path,
        "project identity changed while artifact storage was read",
      );
    }
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact path is not a stable project-local regular file",
    );
  }
  if (target.kind === "absent") return undefined;
  try {
    return await readProjectFileSnapshot({
      root,
      path,
      maxBytes: Math.max(1, maxBytes),
    });
  } catch (error) {
    if (
      error instanceof CoreBoundaryError &&
      (error.code === "cas-precondition-failed" ||
        error.code === "project-path-not-found")
    ) {
      throw artifactError(
        "evidence-artifact-conflict",
        path,
        "artifact file changed while it was read",
      );
    }
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact file cannot be reopened within its byte boundary",
    );
  }
}

async function writeImmutableBytes(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  content: Uint8Array,
  expectedDigest: Sha256Digest,
  maxBytes: number,
): Promise<ImmutableWriteResult> {
  const existing = await readOptionalSnapshot(root, path, maxBytes);
  if (existing !== undefined) {
    if (
      existing.digest === expectedDigest &&
      existing.bytes === content.byteLength
    ) {
      return { status: "ready", snapshot: existing };
    }
    throw artifactError(
      "evidence-artifact-conflict",
      path,
      "immutable artifact path already contains different bytes",
    );
  }
  try {
    await writeProjectFileCas({
      root,
      path,
      content,
      expected: { mode: "absent" },
      maxBytes: Math.max(1, maxBytes),
    });
  } catch (error) {
    const current = await readOptionalSnapshot(root, path, maxBytes);
    if (
      current !== undefined &&
      current.digest === expectedDigest &&
      current.bytes === content.byteLength
    ) {
      return { status: "ready", snapshot: current };
    }
    if (
      error instanceof CoreBoundaryError &&
      error.code === "cas-precondition-failed"
    ) {
      throw artifactError(
        "evidence-artifact-conflict",
        path,
        "another writer claimed the immutable artifact path",
      );
    }
    throw artifactError(
      "evidence-artifact-write-failed",
      path,
      "immutable artifact write could not be proven",
      error instanceof CoreBoundaryError && error.mutationUncertain,
    );
  }
  const written = await readOptionalSnapshot(root, path, maxBytes);
  if (
    written === undefined ||
    written.digest !== expectedDigest ||
    written.bytes !== content.byteLength
  ) {
    throw artifactError(
      "evidence-artifact-write-failed",
      path,
      "immutable artifact postcondition is uncertain",
      true,
    );
  }
  return { status: "created", snapshot: written };
}

function decodeCanonicalManifest(
  snapshot: ProjectFileSnapshotResult,
  path: PortableProjectPath,
): unknown {
  const bytes = snapshot.content;
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest must not contain a byte-order mark",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest is not bounded UTF-8 text",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest is not valid JSON",
    );
  }
  let canonical: string;
  try {
    canonical = serializeCanonical(parsed);
  } catch {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest is not canonical data",
    );
  }
  if (canonical !== text) {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest bytes are not canonical",
    );
  }
  return parsed;
}

function parseManifest(
  value: unknown,
  path: PortableProjectPath,
  receipt: RunReceipt,
  artifact: ReceiptArtifact,
): EvidenceArtifactManifest {
  const manifest = plainRecord(value, "evidence-artifact-corrupt", path);
  exactKeys(
    manifest,
    [
      "schemaVersion",
      "kind",
      "projectIdentityDigest",
      "source",
      "artifact",
      "producer",
      "manifestDigest",
    ],
    "evidence-artifact-corrupt",
    path,
  );
  const source = plainRecord(
    manifest["source"],
    "evidence-artifact-corrupt",
    `${path}#source`,
  );
  exactKeys(
    source,
    ["path", "digest", "bytes"],
    "evidence-artifact-corrupt",
    `${path}#source`,
  );
  const producer = plainRecord(
    manifest["producer"],
    "evidence-artifact-corrupt",
    `${path}#producer`,
  );
  exactKeys(
    producer,
    [
      "receiptId",
      "receiptContextDigest",
      "identity",
      "authority",
      "environment",
    ],
    "evidence-artifact-corrupt",
    `${path}#producer`,
  );
  let sourcePath: PortableProjectPath;
  try {
    sourcePath = parsePortableProjectPath(source["path"]);
  } catch {
    throw artifactError(
      "evidence-artifact-corrupt",
      `${path}#source.path`,
      "artifact source path is not portable",
    );
  }
  if (
    artifact.sourcePath === undefined ||
    artifact.manifestDigest === undefined ||
    manifest["schemaVersion"] !== MANIFEST_SCHEMA_VERSION ||
    manifest["kind"] !== MANIFEST_KIND ||
    manifest["projectIdentityDigest"] !==
      receipt.environment.projectIdentityDigest ||
    !isSha256Digest(manifest["manifestDigest"]) ||
    source["digest"] !== artifact.digest ||
    source["bytes"] !== artifact.bytes ||
    sourcePath !== artifact.sourcePath ||
    isUnderPath(sourcePath, ".ai-game-playbook/evidence") ||
    canonicalizeJson(manifest["artifact"]) !==
      canonicalizeJson(manifestArtifact(artifact)) ||
    producer["receiptId"] !== receipt.receiptId ||
    producer["receiptContextDigest"] !== computeReceiptContextDigest(receipt) ||
    canonicalizeJson(producer["identity"]) !==
      canonicalizeJson(receipt.identity) ||
    canonicalizeJson(producer["authority"]) !==
      canonicalizeJson(receipt.authority) ||
    canonicalizeJson(producer["environment"]) !==
      canonicalizeJson(receipt.environment)
  ) {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest differs from its receipt, authority, or source identity",
    );
  }
  const typed = manifest as unknown as EvidenceArtifactManifest;
  if (
    computeEvidenceArtifactManifestDigest(typed) !== typed.manifestDigest ||
    typed.manifestDigest !== artifact.manifestDigest
  ) {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "artifact manifest digest does not attest its canonical body",
    );
  }
  return typed;
}

async function loadManifest(
  root: CanonicalProjectRoot,
  receipt: RunReceipt,
  artifact: ReceiptArtifact,
): Promise<{
  readonly manifest: EvidenceArtifactManifest;
  readonly snapshot: ProjectFileSnapshotResult;
  readonly path: PortableProjectPath;
}> {
  const path = manifestPathForArtifact(receipt.receiptId, artifact.artifactId);
  const snapshot = await readOptionalSnapshot(
    root,
    path,
    EVIDENCE_ARTIFACT_MAX_MANIFEST_BYTES,
  );
  if (snapshot === undefined) {
    throw artifactError(
      "evidence-artifact-corrupt",
      path,
      "complete artifact manifest is missing",
    );
  }
  return {
    manifest: parseManifest(
      decodeCanonicalManifest(snapshot, path),
      path,
      receipt,
      artifact,
    ),
    snapshot,
    path,
  };
}

async function verifyStoredArtifact(
  root: CanonicalProjectRoot,
  receipt: RunReceipt,
  artifact: ReceiptArtifact,
): Promise<StoredEvidenceArtifact> {
  const expectedObjectPath = objectPathForDigest(artifact.digest);
  if (artifact.path !== expectedObjectPath) {
    throw artifactError(
      "evidence-artifact-corrupt",
      artifact.path,
      "complete artifact locator is not its content-addressed object path",
    );
  }
  const loadedManifest = await loadManifest(root, receipt, artifact);
  const object = await readOptionalSnapshot(
    root,
    expectedObjectPath,
    Math.max(1, artifact.bytes),
  );
  if (
    object === undefined ||
    object.digest !== artifact.digest ||
    object.bytes !== artifact.bytes
  ) {
    throw artifactError(
      "evidence-artifact-corrupt",
      expectedObjectPath,
      "content-addressed artifact bytes are missing or differ from the receipt",
    );
  }
  return Object.freeze({
    status: "ready",
    artifactId: artifact.artifactId,
    sourcePath: loadedManifest.manifest.source.path,
    objectPath: expectedObjectPath,
    manifestPath: loadedManifest.path,
    digest: artifact.digest,
    bytes: artifact.bytes,
    manifestDigest: loadedManifest.manifest.manifestDigest,
  });
}

function assertAggregateBudget(
  receipts: readonly RunReceipt[],
  maxArtifactBytes: number,
): void {
  let totalBytes = 0;
  let totalArtifacts = 0;
  for (const receipt of receipts) {
    for (const artifact of receipt.artifacts) {
      if (!artifact.complete) continue;
      totalArtifacts += 1;
      totalBytes += artifact.bytes;
      if (
        totalArtifacts > EVIDENCE_ARTIFACT_MAX_ARTIFACTS ||
        artifact.bytes > EVIDENCE_ARTIFACT_MAX_TOTAL_BYTES ||
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > maxArtifactBytes
      ) {
        throw artifactError(
          "evidence-artifact-budget-exceeded",
          "$request.maxArtifactBytes",
          "complete artifacts exceed the fixed verification boundary",
        );
      }
    }
  }
}

export async function verifyRunReceiptArtifacts(
  value: VerifyRunReceiptArtifactsRequest,
): Promise<void> {
  const request = normalizeVerificationRequest(value);
  await assertProjectRootIdentity(request.root);
  assertAggregateBudget(request.receipts, request.maxArtifactBytes);
  if (
    request.receipts.every((receipt) =>
      receipt.artifacts.every((item) => !item.complete),
    )
  ) {
    return;
  }
  await ensureStoreDirectories(request.root);
  for (const receipt of request.receipts) {
    for (const artifact of receipt.artifacts) {
      if (artifact.complete) {
        await verifyStoredArtifact(request.root, receipt, artifact);
      }
    }
  }
  await assertProjectRootIdentity(request.root);
  for (const receipt of request.receipts) {
    for (const artifact of receipt.artifacts) {
      if (artifact.complete) {
        await verifyStoredArtifact(request.root, receipt, artifact);
      }
    }
  }
}

async function snapshotSource(
  root: CanonicalProjectRoot,
  artifact: ReceiptArtifact,
): Promise<ProjectFileSnapshotResult> {
  if (isUnderPath(artifact.path, ".ai-game-playbook/evidence")) {
    throw artifactError(
      "evidence-artifact-source-invalid",
      artifact.path,
      "artifact source cannot be inside the evidence store",
    );
  }
  let snapshot: ProjectFileSnapshotResult;
  try {
    snapshot = await readProjectFileSnapshot({
      root,
      path: artifact.path,
      maxBytes: Math.max(1, artifact.bytes),
    });
  } catch {
    throw artifactError(
      "evidence-artifact-source-invalid",
      artifact.path,
      "complete artifact source is not a stable project-local regular file",
    );
  }
  if (snapshot.digest !== artifact.digest || snapshot.bytes !== artifact.bytes) {
    throw artifactError(
      "evidence-artifact-source-invalid",
      artifact.path,
      "artifact source bytes differ from the declared digest or length",
    );
  }
  return snapshot;
}

async function writeManifest(
  root: CanonicalProjectRoot,
  path: PortableProjectPath,
  manifest: EvidenceArtifactManifest,
): Promise<ImmutableWriteResult> {
  const content = Buffer.from(serializeCanonical(manifest), "utf8");
  if (content.byteLength > EVIDENCE_ARTIFACT_MAX_MANIFEST_BYTES) {
    throw artifactError(
      "evidence-artifact-budget-exceeded",
      path,
      "artifact manifest exceeds its fixed byte boundary",
    );
  }
  return writeImmutableBytes(
    root,
    path,
    content,
    sha256Digest(content),
    EVIDENCE_ARTIFACT_MAX_MANIFEST_BYTES,
  );
}

export async function promoteRunReceiptArtifacts(
  value: PromoteRunReceiptArtifactsRequest,
): Promise<PromotedRunReceiptArtifacts> {
  const request = normalizePromotionRequest(value);
  await assertProjectRootIdentity(request.root);
  const plan = planPromotedReceipt(
    request.root,
    request.registry,
    request.receipt,
  );
  const promotedReceipt = plan.receipt;
  assertAggregateBudget([promotedReceipt], request.maxArtifactBytes);
  const completeArtifacts = promotedReceipt.artifacts.filter(
    (artifact) => artifact.complete,
  );
  if (completeArtifacts.length === 0) {
    return Object.freeze({
      status: "ready",
      rootIdentityDigest: request.root.identityDigest,
      receipt: request.receipt,
      artifacts: Object.freeze([]),
    });
  }
  await ensureStoreDirectories(request.root);

  const stored: StoredEvidenceArtifact[] = [];
  for (const promotion of plan.promotions) {
    if (promotion.alreadyPromoted) {
      stored.push(
        await verifyStoredArtifact(
          request.root,
          promotedReceipt,
          promotion.artifact,
        ),
      );
      continue;
    }
    const source = await snapshotSource(request.root, promotion.sourceArtifact);
    const objectWrite = await writeImmutableBytes(
      request.root,
      promotion.artifact.path as PortableProjectPath,
      source.content,
      promotion.artifact.digest,
      Math.max(1, promotion.artifact.bytes),
    );
    const manifestPath = manifestPathForArtifact(
      promotedReceipt.receiptId,
      promotion.artifact.artifactId,
    );
    const manifestWrite = await writeManifest(
      request.root,
      manifestPath,
      promotion.manifest,
    );
    const verified = await verifyStoredArtifact(
      request.root,
      promotedReceipt,
      promotion.artifact,
    );
    stored.push(
      Object.freeze({
        ...verified,
        status:
          objectWrite.status === "created" ||
          manifestWrite.status === "created"
            ? "created"
            : "ready",
      }),
    );
  }
  await assertProjectRootIdentity(request.root);
  for (const artifact of completeArtifacts) {
    await verifyStoredArtifact(request.root, promotedReceipt, artifact);
  }
  return Object.freeze({
    status:
      promotedReceipt.receiptDigest === request.receipt.receiptDigest
        ? "ready"
        : "promoted",
    rootIdentityDigest: request.root.identityDigest,
    receipt: promotedReceipt,
    artifacts: Object.freeze(stored),
  });
}
