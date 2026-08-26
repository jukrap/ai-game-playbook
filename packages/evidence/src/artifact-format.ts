import { inflateSync } from "node:zlib";

import {
  canonicalizeJson,
  sha256Digest,
  type ComponentOutcome,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";

import { EvidenceNormalizationError } from "./errors.js";

export const ARTIFACT_INSPECTION_MAX_BYTES: number = 16 * 1024 * 1024;
export const ARTIFACT_JSON_MAX_DEPTH = 128;
export const ARTIFACT_JSON_MAX_NODES = 1_000_000;
export const ARTIFACT_PNG_MAX_DIMENSION = 32_768;
export const ARTIFACT_PNG_MAX_PIXELS = 100_000_000;
export const ARTIFACT_PNG_MAX_DECODED_BYTES: number = 64 * 1024 * 1024;

const PNG_MAX_CHUNKS = 4096;
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type DataRecord = Record<string, unknown>;
type ArtifactFormatStatus = Extract<
  ComponentOutcome,
  "passed" | "failed" | "unverified"
>;

export type ArtifactFormatExpectation =
  | { readonly format: "utf8-text" }
  | {
      readonly format: "canonical-json";
      readonly maxDepth: number;
      readonly maxNodes: number;
    }
  | {
      readonly format: "png";
      readonly maxWidth: number;
      readonly maxHeight: number;
      readonly maxPixels: number;
      readonly maxDecodedBytes: number;
    };

export interface ArtifactByteInspectionRequest {
  readonly content: Uint8Array;
  readonly expectation: ArtifactFormatExpectation;
  readonly maxBytes: number;
}

export type ArtifactFormatAssessmentCode =
  | "artifact.format-utf8-passed"
  | "artifact.format-utf8-bom"
  | "artifact.format-invalid-utf8"
  | "artifact.format-canonical-json-passed"
  | "artifact.format-invalid-json"
  | "artifact.format-json-noncanonical"
  | "artifact.format-json-budget-exceeded"
  | "artifact.format-png-passed"
  | "artifact.format-invalid-png"
  | "artifact.format-png-budget-exceeded"
  | "artifact.format-png-interlace-unsupported";

export interface ArtifactFormatDetails {
  readonly kind: "utf8-text" | "canonical-json" | "png";
  readonly mediaType: "text/plain" | "application/json" | "image/png";
  readonly validation: "decoded" | "parsed" | "failed" | "unsupported";
  readonly codePoints?: number;
  readonly lines?: number;
  readonly rootKind?:
    | "array"
    | "boolean"
    | "null"
    | "number"
    | "object"
    | "string";
  readonly depth?: number;
  readonly nodes?: number;
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlaced?: boolean;
  readonly decodedBytes?: number;
}

export interface ArtifactFormatAssessment {
  readonly component: "artifact-format";
  readonly status: ArtifactFormatStatus;
  readonly code: ArtifactFormatAssessmentCode;
  readonly message: string;
  readonly digest: Sha256Digest;
  readonly bytes: number;
  readonly format: ArtifactFormatDetails;
}

interface NormalizedArtifactInspectionRequest {
  readonly content: Buffer;
  readonly expectation: ArtifactFormatExpectation;
}

interface JsonMetrics {
  readonly rootKind: NonNullable<ArtifactFormatDetails["rootKind"]>;
  readonly depth: number;
  readonly nodes: number;
}

interface PngHeader {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
  readonly channels: number;
  readonly rowBytes: number;
  readonly decodedBytes: number;
}

interface PngParseState {
  readonly header: PngHeader;
  readonly compressed: Buffer;
  readonly paletteEntries?: number;
}

function invalid(
  path: string,
  message: string,
  code:
    | "invalid-artifact-inspection-request"
    | "artifact-inspection-budget-exceeded" =
    "invalid-artifact-inspection-request",
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
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    invalid(path, "record contains undeclared fields or omits required fields");
  }
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    invalid(path, "integer is outside the fixed inspection boundary");
  }
  return value as number;
}

export function normalizeArtifactFormatExpectation(
  value: unknown,
): ArtifactFormatExpectation {
  const expectation = plainRecord(value, "$request.expectation");
  const format = expectation["format"];
  if (format === "utf8-text") {
    exactKeys(expectation, ["format"], "$request.expectation");
    return Object.freeze({ format });
  }
  if (format === "canonical-json") {
    exactKeys(
      expectation,
      ["format", "maxDepth", "maxNodes"],
      "$request.expectation",
    );
    return Object.freeze({
      format,
      maxDepth: boundedInteger(
        expectation["maxDepth"],
        1,
        ARTIFACT_JSON_MAX_DEPTH,
        "$request.expectation.maxDepth",
      ),
      maxNodes: boundedInteger(
        expectation["maxNodes"],
        1,
        ARTIFACT_JSON_MAX_NODES,
        "$request.expectation.maxNodes",
      ),
    });
  }
  if (format === "png") {
    exactKeys(
      expectation,
      [
        "format",
        "maxWidth",
        "maxHeight",
        "maxPixels",
        "maxDecodedBytes",
      ],
      "$request.expectation",
    );
    return Object.freeze({
      format,
      maxWidth: boundedInteger(
        expectation["maxWidth"],
        1,
        ARTIFACT_PNG_MAX_DIMENSION,
        "$request.expectation.maxWidth",
      ),
      maxHeight: boundedInteger(
        expectation["maxHeight"],
        1,
        ARTIFACT_PNG_MAX_DIMENSION,
        "$request.expectation.maxHeight",
      ),
      maxPixels: boundedInteger(
        expectation["maxPixels"],
        1,
        ARTIFACT_PNG_MAX_PIXELS,
        "$request.expectation.maxPixels",
      ),
      maxDecodedBytes: boundedInteger(
        expectation["maxDecodedBytes"],
        1,
        ARTIFACT_PNG_MAX_DECODED_BYTES,
        "$request.expectation.maxDecodedBytes",
      ),
    });
  }
  invalid("$request.expectation.format", "artifact format is not supported");
}

function normalizeRequest(
  value: ArtifactByteInspectionRequest,
): NormalizedArtifactInspectionRequest {
  const request = plainRecord(value, "$request");
  exactKeys(request, ["content", "expectation", "maxBytes"], "$request");
  if (!(request["content"] instanceof Uint8Array)) {
    invalid("$request.content", "artifact content must be a byte array");
  }
  const maxBytes = boundedInteger(
    request["maxBytes"],
    1,
    ARTIFACT_INSPECTION_MAX_BYTES,
    "$request.maxBytes",
  );
  if (request["content"].byteLength > maxBytes) {
    invalid(
      "$request.content",
      "artifact content exceeds the declared inspection byte budget",
      "artifact-inspection-budget-exceeded",
    );
  }
  return Object.freeze({
    content: Buffer.from(request["content"]),
    expectation: normalizeArtifactFormatExpectation(request["expectation"]),
  });
}

function assessment(
  status: ArtifactFormatStatus,
  code: ArtifactFormatAssessmentCode,
  message: string,
  digest: Sha256Digest,
  bytes: number,
  format: ArtifactFormatDetails,
): ArtifactFormatAssessment {
  return Object.freeze({
    component: "artifact-format",
    status,
    code,
    message,
    digest,
    bytes,
    format: Object.freeze(format),
  });
}

function decodeUtf8(
  content: Buffer,
):
  | { readonly status: "passed"; readonly text: string }
  | {
      readonly status: "failed";
      readonly code:
        | "artifact.format-utf8-bom"
        | "artifact.format-invalid-utf8";
    } {
  if (
    content.length >= 3 &&
    content[0] === 0xef &&
    content[1] === 0xbb &&
    content[2] === 0xbf
  ) {
    return { status: "failed", code: "artifact.format-utf8-bom" };
  }
  try {
    return {
      status: "passed",
      text: new TextDecoder("utf-8", { fatal: true }).decode(content),
    };
  } catch {
    return { status: "failed", code: "artifact.format-invalid-utf8" };
  }
}

function countCodePoints(value: string): number {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function countLines(value: string): number {
  if (value.length === 0) return 0;
  let lines = value.endsWith("\n") ? 0 : 1;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) === 0x0a) lines += 1;
  }
  return lines;
}

function inspectUtf8(
  content: Buffer,
  digest: Sha256Digest,
): ArtifactFormatAssessment {
  const decoded = decodeUtf8(content);
  if (decoded.status === "failed") {
    return assessment(
      "failed",
      decoded.code,
      decoded.code === "artifact.format-utf8-bom"
        ? "UTF-8 artifact contains a byte-order mark."
        : "Artifact bytes are not valid UTF-8.",
      digest,
      content.byteLength,
      { kind: "utf8-text", mediaType: "text/plain", validation: "failed" },
    );
  }
  return assessment(
    "passed",
    "artifact.format-utf8-passed",
    "Artifact bytes decode as bounded UTF-8 text.",
    digest,
    content.byteLength,
    {
      kind: "utf8-text",
      mediaType: "text/plain",
      validation: "decoded",
      codePoints: countCodePoints(decoded.text),
      lines: countLines(decoded.text),
    },
  );
}

function jsonRootKind(
  value: unknown,
): NonNullable<ArtifactFormatDetails["rootKind"]> {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value as "boolean" | "number" | "object" | "string";
}

function measureJson(
  value: unknown,
  maxDepth: number,
  maxNodes: number,
): JsonMetrics | undefined {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value, depth: 1 },
  ];
  let nodes = 0;
  let depth = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    depth = Math.max(depth, current.depth);
    if (nodes > maxNodes || current.depth > maxDepth) return undefined;
    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index--) {
        stack.push({ value: current.value[index], depth: current.depth + 1 });
      }
    } else if (current.value !== null && typeof current.value === "object") {
      const values = Object.values(current.value as DataRecord);
      for (let index = values.length - 1; index >= 0; index--) {
        stack.push({ value: values[index], depth: current.depth + 1 });
      }
    }
  }
  return { rootKind: jsonRootKind(value), depth, nodes };
}

function jsonFailure(
  code:
    | "artifact.format-invalid-json"
    | "artifact.format-json-noncanonical"
    | "artifact.format-json-budget-exceeded",
  digest: Sha256Digest,
  bytes: number,
): ArtifactFormatAssessment {
  const message =
    code === "artifact.format-invalid-json"
      ? "Artifact bytes are not valid bounded JSON."
      : code === "artifact.format-json-noncanonical"
        ? "JSON artifact bytes are not in canonical form."
        : "JSON artifact exceeds its tree inspection budget.";
  return assessment("failed", code, message, digest, bytes, {
    kind: "canonical-json",
    mediaType: "application/json",
    validation: "failed",
  });
}

function inspectCanonicalJson(
  content: Buffer,
  expectation: Extract<
    ArtifactFormatExpectation,
    { readonly format: "canonical-json" }
  >,
  digest: Sha256Digest,
): ArtifactFormatAssessment {
  const decoded = decodeUtf8(content);
  if (decoded.status === "failed") {
    return jsonFailure("artifact.format-invalid-json", digest, content.byteLength);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded.text) as unknown;
  } catch {
    return jsonFailure("artifact.format-invalid-json", digest, content.byteLength);
  }
  const measured = measureJson(parsed, expectation.maxDepth, expectation.maxNodes);
  if (measured === undefined) {
    return jsonFailure(
      "artifact.format-json-budget-exceeded",
      digest,
      content.byteLength,
    );
  }
  let canonical: string;
  try {
    canonical = `${canonicalizeJson(parsed)}\n`;
  } catch {
    return jsonFailure("artifact.format-invalid-json", digest, content.byteLength);
  }
  if (!content.equals(Buffer.from(canonical, "utf8"))) {
    return jsonFailure(
      "artifact.format-json-noncanonical",
      digest,
      content.byteLength,
    );
  }
  return assessment(
    "passed",
    "artifact.format-canonical-json-passed",
    "Artifact bytes are canonical bounded JSON.",
    digest,
    content.byteLength,
    {
      kind: "canonical-json",
      mediaType: "application/json",
      validation: "parsed",
      ...measured,
    },
  );
}

function makeCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    const tableIndex = (value ^ byte) & 0xff;
    value = ((value >>> 8) ^ (CRC_TABLE[tableIndex] ?? 0)) >>> 0;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function validPngBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return [1, 2, 4, 8, 16].includes(bitDepth);
    case 2:
    case 4:
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return [1, 2, 4, 8].includes(bitDepth);
    default:
      return false;
  }
}

function pngChannels(colorType: number): number | undefined {
  switch (colorType) {
    case 0:
    case 3:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return undefined;
  }
}

function parsePngHeader(
  data: Buffer,
  expectation: Extract<ArtifactFormatExpectation, { readonly format: "png" }>,
): PngHeader | "budget" | undefined {
  if (data.byteLength !== 13) return undefined;
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8] ?? -1;
  const colorType = data[9] ?? -1;
  const compression = data[10];
  const filter = data[11];
  const interlace = data[12] ?? -1;
  const channels = pngChannels(colorType);
  if (
    width === 0 ||
    height === 0 ||
    channels === undefined ||
    !validPngBitDepth(colorType, bitDepth) ||
    compression !== 0 ||
    filter !== 0 ||
    (interlace !== 0 && interlace !== 1)
  ) {
    return undefined;
  }
  if (
    width > expectation.maxWidth ||
    height > expectation.maxHeight ||
    width > Math.floor(expectation.maxPixels / height)
  ) {
    return "budget";
  }
  const rowBits = width * channels * bitDepth;
  const rowBytes = Math.ceil(rowBits / 8);
  const decodedBytes = height * (rowBytes + 1);
  if (
    !Number.isSafeInteger(rowBits) ||
    !Number.isSafeInteger(decodedBytes) ||
    decodedBytes > expectation.maxDecodedBytes
  ) {
    return "budget";
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    interlace,
    channels,
    rowBytes,
    decodedBytes,
  };
}

function parsePng(
  content: Buffer,
  expectation: Extract<ArtifactFormatExpectation, { readonly format: "png" }>,
): PngParseState | "budget" | undefined {
  if (
    content.byteLength < PNG_SIGNATURE.byteLength ||
    !content.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
  ) {
    return undefined;
  }
  let offset = PNG_SIGNATURE.byteLength;
  let chunkCount = 0;
  let header: PngHeader | undefined;
  let paletteEntries: number | undefined;
  let sawIdat = false;
  let idatClosed = false;
  let sawIend = false;
  const idat: Buffer[] = [];
  while (offset < content.byteLength) {
    chunkCount += 1;
    if (chunkCount > PNG_MAX_CHUNKS || content.byteLength - offset < 12) {
      return undefined;
    }
    const length = content.readUInt32BE(offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const nextOffset = dataEnd + 4;
    if (
      !Number.isSafeInteger(nextOffset) ||
      dataEnd < dataStart ||
      nextOffset > content.byteLength
    ) {
      return undefined;
    }
    const typeBytes = content.subarray(offset + 4, offset + 8);
    if (
      typeBytes.length !== 4 ||
      [...typeBytes].some(
        (byte) =>
          !((byte >= 0x41 && byte <= 0x5a) ||
            (byte >= 0x61 && byte <= 0x7a)),
      )
    ) {
      return undefined;
    }
    const type = typeBytes.toString("ascii");
    const storedCrc = content.readUInt32BE(dataEnd);
    if (crc32(content.subarray(offset + 4, dataEnd)) !== storedCrc) {
      return undefined;
    }
    const data = content.subarray(dataStart, dataEnd);
    if (chunkCount === 1 && type !== "IHDR") return undefined;
    if (type === "IHDR") {
      if (header !== undefined || chunkCount !== 1) return undefined;
      const parsedHeader = parsePngHeader(data, expectation);
      if (parsedHeader === "budget") return "budget";
      if (parsedHeader === undefined) return undefined;
      header = parsedHeader;
    } else if (type === "PLTE") {
      if (
        header === undefined ||
        paletteEntries !== undefined ||
        sawIdat ||
        length < 3 ||
        length > 768 ||
        length % 3 !== 0
      ) {
        return undefined;
      }
      paletteEntries = length / 3;
    } else if (type === "IDAT") {
      if (header === undefined || idatClosed || length === 0) return undefined;
      sawIdat = true;
      idat.push(Buffer.from(data));
    } else {
      if (sawIdat) idatClosed = true;
      if (type === "IEND") {
        if (length !== 0 || sawIend) return undefined;
        sawIend = true;
        offset = nextOffset;
        if (offset !== content.byteLength) return undefined;
        break;
      }
      const firstTypeByte = typeBytes[0] ?? 0;
      const critical = firstTypeByte >= 0x41 && firstTypeByte <= 0x5a;
      if (critical) return undefined;
    }
    offset = nextOffset;
  }
  if (
    header === undefined ||
    !sawIdat ||
    !sawIend ||
    offset !== content.byteLength ||
    (header.colorType === 3 && paletteEntries === undefined) ||
    ((header.colorType === 0 || header.colorType === 4) &&
      paletteEntries !== undefined)
  ) {
    return undefined;
  }
  return {
    header,
    compressed: Buffer.concat(idat),
    ...(paletteEntries === undefined ? {} : { paletteEntries }),
  };
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
    ? left
    : aboveDistance <= upperLeftDistance
      ? above
      : upperLeft;
}

function decodePngScanlines(inflated: Buffer, header: PngHeader): boolean {
  if (inflated.byteLength !== header.decodedBytes) return false;
  const bytesPerPixel = Math.max(
    1,
    Math.ceil((header.channels * header.bitDepth) / 8),
  );
  let previous = Buffer.alloc(header.rowBytes);
  let offset = 0;
  for (let row = 0; row < header.height; row++) {
    const filter = inflated[offset];
    if (filter === undefined || filter > 4) return false;
    offset += 1;
    const raw = inflated.subarray(offset, offset + header.rowBytes);
    if (raw.byteLength !== header.rowBytes) return false;
    const current = Buffer.alloc(header.rowBytes);
    for (let index = 0; index < raw.byteLength; index++) {
      const source = raw[index] ?? 0;
      const left =
        index >= bytesPerPixel ? (current[index - bytesPerPixel] ?? 0) : 0;
      const above = previous[index] ?? 0;
      const upperLeft =
        index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      current[index] = (source + predictor) & 0xff;
    }
    previous = current;
    offset += header.rowBytes;
  }
  return offset === inflated.byteLength;
}

function pngDetails(
  header: PngHeader,
  validation: ArtifactFormatDetails["validation"],
): ArtifactFormatDetails {
  return {
    kind: "png",
    mediaType: "image/png",
    validation,
    width: header.width,
    height: header.height,
    bitDepth: header.bitDepth,
    colorType: header.colorType,
    interlaced: header.interlace === 1,
    ...(validation === "decoded" ? { decodedBytes: header.decodedBytes } : {}),
  };
}

function pngFailure(
  code: "artifact.format-invalid-png" | "artifact.format-png-budget-exceeded",
  digest: Sha256Digest,
  bytes: number,
): ArtifactFormatAssessment {
  return assessment(
    "failed",
    code,
    code === "artifact.format-png-budget-exceeded"
      ? "PNG exceeds its declared dimension or decode budget."
      : "Artifact bytes are not a valid supported PNG image.",
    digest,
    bytes,
    { kind: "png", mediaType: "image/png", validation: "failed" },
  );
}

function inspectPng(
  content: Buffer,
  expectation: Extract<ArtifactFormatExpectation, { readonly format: "png" }>,
  digest: Sha256Digest,
): ArtifactFormatAssessment {
  const parsed = parsePng(content, expectation);
  if (parsed === "budget") {
    return pngFailure(
      "artifact.format-png-budget-exceeded",
      digest,
      content.byteLength,
    );
  }
  if (parsed === undefined) {
    return pngFailure("artifact.format-invalid-png", digest, content.byteLength);
  }
  if (parsed.header.interlace === 1) {
    return assessment(
      "unverified",
      "artifact.format-png-interlace-unsupported",
      "PNG structure is valid, but interlaced decode is not supported.",
      digest,
      content.byteLength,
      pngDetails(parsed.header, "unsupported"),
    );
  }
  let inflated: Buffer;
  try {
    inflated = inflateSync(parsed.compressed, {
      maxOutputLength: expectation.maxDecodedBytes,
    });
  } catch {
    return pngFailure("artifact.format-invalid-png", digest, content.byteLength);
  }
  if (!decodePngScanlines(inflated, parsed.header)) {
    return pngFailure("artifact.format-invalid-png", digest, content.byteLength);
  }
  return assessment(
    "passed",
    "artifact.format-png-passed",
    "PNG chunks and non-interlaced scanlines decoded successfully.",
    digest,
    content.byteLength,
    pngDetails(parsed.header, "decoded"),
  );
}

export function inspectArtifactBytes(
  value: ArtifactByteInspectionRequest,
): ArtifactFormatAssessment {
  const request = normalizeRequest(value);
  const digest = sha256Digest(request.content);
  switch (request.expectation.format) {
    case "utf8-text":
      return inspectUtf8(request.content, digest);
    case "canonical-json":
      return inspectCanonicalJson(
        request.content,
        request.expectation,
        digest,
      );
    case "png":
      return inspectPng(request.content, request.expectation, digest);
  }
}
