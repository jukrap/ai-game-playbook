import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as evidence from "../dist/index.js";
import { rgbaPng } from "./fixtures/png.mjs";

function pngExpectation(overrides = {}) {
  return {
    format: "png",
    maxWidth: 64,
    maxHeight: 64,
    maxPixels: 4096,
    maxDecodedBytes: 64 * 1024,
    ...overrides,
  };
}

function inspect(content, expectation, maxBytes = 1024 * 1024) {
  return evidence.inspectArtifactBytes({ content, expectation, maxBytes });
}

test("UTF-8 inspection returns bounded metadata without retaining content", () => {
  const content = Buffer.from("alpha\nbeta", "utf8");
  const expectedDigest = contracts.sha256Digest(content);
  const result = inspect(content, { format: "utf8-text" });
  content.fill(0);

  assert.equal(result.component, "artifact-format");
  assert.equal(result.status, "passed");
  assert.equal(result.code, "artifact.format-utf8-passed");
  assert.equal(result.digest, expectedDigest);
  assert.equal(result.bytes, 10);
  assert.deepEqual(result.format, {
    kind: "utf8-text",
    mediaType: "text/plain",
    validation: "decoded",
    codePoints: 10,
    lines: 2,
  });
  assert.equal("content" in result, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.format), true);
});

test("UTF-8 inspection distinguishes BOM and invalid byte sequences", () => {
  const cases = [
    {
      name: "BOM",
      content: Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
      code: "artifact.format-utf8-bom",
    },
    {
      name: "invalid sequence",
      content: Buffer.from([0xc3, 0x28]),
      code: "artifact.format-invalid-utf8",
    },
  ];

  for (const fixture of cases) {
    const result = inspect(fixture.content, { format: "utf8-text" });
    assert.equal(result.status, "failed", fixture.name);
    assert.equal(result.code, fixture.code, fixture.name);
  }
});

test("canonical JSON inspection parses exact canonical bytes and enforces tree budgets", () => {
  const passed = inspect(Buffer.from('{"a":[1,true]}\n'), {
    format: "canonical-json",
    maxDepth: 8,
    maxNodes: 64,
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.code, "artifact.format-canonical-json-passed");
  assert.deepEqual(passed.format, {
    kind: "canonical-json",
    mediaType: "application/json",
    validation: "parsed",
    rootKind: "object",
    depth: 3,
    nodes: 4,
  });

  const cases = [
    {
      name: "noncanonical spacing",
      content: Buffer.from('{ "a": 1 }\n'),
      expectation: { format: "canonical-json", maxDepth: 8, maxNodes: 64 },
      code: "artifact.format-json-noncanonical",
    },
    {
      name: "malformed JSON",
      content: Buffer.from('{"a":}\n'),
      expectation: { format: "canonical-json", maxDepth: 8, maxNodes: 64 },
      code: "artifact.format-invalid-json",
    },
    {
      name: "depth budget",
      content: Buffer.from('{"a":{"b":{"c":1}}}\n'),
      expectation: { format: "canonical-json", maxDepth: 3, maxNodes: 64 },
      code: "artifact.format-json-budget-exceeded",
    },
  ];
  for (const fixture of cases) {
    const result = inspect(fixture.content, fixture.expectation);
    assert.equal(result.status, "failed", fixture.name);
    assert.equal(result.code, fixture.code, fixture.name);
  }
});

test("PNG inspection validates chunks, CRC, inflate, filters, and dimensions", () => {
  const content = rgbaPng();
  const result = inspect(content, pngExpectation());

  assert.equal(result.status, "passed");
  assert.equal(result.code, "artifact.format-png-passed");
  assert.deepEqual(result.format, {
    kind: "png",
    mediaType: "image/png",
    validation: "decoded",
    width: 2,
    height: 1,
    bitDepth: 8,
    colorType: 6,
    interlaced: false,
    decodedBytes: 9,
  });

  const corruptCrc = Buffer.from(content);
  corruptCrc[29] ^= 0xff;
  const invalidFilter = rgbaPng({ filter: 5 });
  const invalidZlib = rgbaPng({ compressed: Buffer.from([1, 2, 3]) });
  const dimensionLimited = rgbaPng({ width: 2 });
  const cases = [
    {
      name: "CRC mismatch",
      content: corruptCrc,
      expectation: pngExpectation(),
      code: "artifact.format-invalid-png",
    },
    {
      name: "truncated file",
      content: content.subarray(0, content.length - 1),
      expectation: pngExpectation(),
      code: "artifact.format-invalid-png",
    },
    {
      name: "dimension budget",
      content: dimensionLimited,
      expectation: pngExpectation({ maxWidth: 1 }),
      code: "artifact.format-png-budget-exceeded",
    },
    {
      name: "invalid filter",
      content: invalidFilter,
      expectation: pngExpectation(),
      code: "artifact.format-invalid-png",
    },
    {
      name: "invalid zlib stream",
      content: invalidZlib,
      expectation: pngExpectation(),
      code: "artifact.format-invalid-png",
    },
  ];
  for (const fixture of cases) {
    const actual = inspect(fixture.content, fixture.expectation);
    assert.equal(actual.status, "failed", fixture.name);
    assert.equal(actual.code, fixture.code, fixture.name);
  }
});

test("interlaced PNG degrades explicitly instead of claiming decode", () => {
  const result = inspect(rgbaPng({ interlace: 1 }), pngExpectation());

  assert.equal(result.status, "unverified");
  assert.equal(result.code, "artifact.format-png-interlace-unsupported");
  assert.equal(result.format.validation, "unsupported");
  assert.equal(result.format.interlaced, true);
});

test("artifact format inspection rejects open or unbounded requests", () => {
  const invalid = [
    { content: Buffer.from("a"), expectation: { format: "utf8-text" } },
    {
      content: Buffer.from("a"),
      expectation: { format: "utf8-text" },
      maxBytes: 1,
      extra: true,
    },
    { content: "a", expectation: { format: "utf8-text" }, maxBytes: 1 },
    {
      content: Buffer.from("ab"),
      expectation: { format: "utf8-text" },
      maxBytes: 1,
    },
    {
      content: Buffer.from("{}\n"),
      expectation: { format: "canonical-json", maxDepth: 0, maxNodes: 10 },
      maxBytes: 3,
    },
  ];

  for (const value of invalid) {
    assert.throws(
      () => evidence.inspectArtifactBytes(value),
      (error) =>
        error?.name === "EvidenceNormalizationError" &&
        (error?.code === "invalid-artifact-inspection-request" ||
          error?.code === "artifact-inspection-budget-exceeded"),
    );
  }
});
