import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("canonical JSON sorts object keys recursively without changing array order", () => {
  assert.equal(typeof contracts.canonicalizeJson, "function");

  const first = {
    z: -0,
    list: [3, { b: true, a: null }],
    a: { β: 1, A: "line\nvalue" },
  };
  const second = {
    a: { A: "line\nvalue", β: 1 },
    list: [3, { a: null, b: true }],
    z: 0,
  };
  const expected =
    '{"a":{"A":"line\\nvalue","β":1},"list":[3,{"a":null,"b":true}],"z":0}';

  assert.equal(contracts.canonicalizeJson(first), expected);
  assert.equal(contracts.canonicalizeJson(second), expected);
});

test("canonical JSON rejects values that cannot be safely attested", () => {
  const circular = {};
  circular.self = circular;
  const sparse = [];
  sparse.length = 1;
  const withAccessor = {};
  Object.defineProperty(withAccessor, "value", {
    enumerable: true,
    get: () => 1,
  });

  for (const value of [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    new Date("2026-08-26T00:00:00Z"),
    sparse,
    circular,
    withAccessor,
    "\ud800",
  ]) {
    assert.throws(
      () => contracts.canonicalizeJson(value),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-canonical-json",
    );
  }
});
