import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("SHA-256 digests use lowercase prefixed canonical text", () => {
  assert.equal(typeof contracts.sha256Digest, "function");
  assert.equal(typeof contracts.parseSha256Digest, "function");
  assert.equal(typeof contracts.isSha256Digest, "function");

  const empty =
    "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const abc =
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  assert.equal(contracts.sha256Digest(""), empty);
  assert.equal(contracts.sha256Digest("abc"), abc);
  assert.equal(
    contracts.sha256Digest(new TextEncoder().encode("abc")),
    abc,
  );
  assert.equal(contracts.parseSha256Digest(abc), abc);
  assert.equal(contracts.isSha256Digest(abc), true);

  for (const value of [
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    "sha256:BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
    "sha256:abc",
    42,
  ]) {
    assert.equal(contracts.isSha256Digest(value), false);
    assert.throws(
      () => contracts.parseSha256Digest(value),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-sha256-digest",
    );
  }
});

test("canonical JSON digest is stable across insertion order", () => {
  assert.equal(typeof contracts.digestCanonicalJson, "function");

  const first = contracts.digestCanonicalJson({ b: 2, a: [true, null] });
  const second = contracts.digestCanonicalJson({ a: [true, null], b: 2 });

  assert.equal(first, second);
  assert.equal(
    first,
    "sha256:b1ceec24dcbf8e9a1925a7ee8a08c8f3f79c6ea315d5b4445a4718159649a28c",
  );
  assert.equal(contracts.isSha256Digest(first), true);
  assert.throws(
    () => contracts.sha256Digest(42),
    (error) =>
      error?.name === "ContractValueError" &&
      error?.code === "invalid-sha256-input",
  );
});
