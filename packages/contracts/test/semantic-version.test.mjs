import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("semantic versions preserve exact components and SemVer precedence", () => {
  assert.equal(typeof contracts.parseSemanticVersion, "function");
  assert.equal(typeof contracts.compareSemanticVersions, "function");

  assert.deepEqual(contracts.parseSemanticVersion("1.2.3-alpha.1+win.x64"), {
    value: "1.2.3-alpha.1+win.x64",
    major: "1",
    minor: "2",
    patch: "3",
    prerelease: ["alpha", "1"],
    build: ["win", "x64"],
  });

  const precedence = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
  ];

  for (let index = 1; index < precedence.length; index += 1) {
    assert.equal(
      contracts.compareSemanticVersions(
        precedence[index - 1],
        precedence[index],
      ),
      -1,
    );
  }

  assert.equal(
    contracts.compareSemanticVersions(
      "9007199254740993.0.0",
      "9007199254740992.0.0",
    ),
    1,
  );
  assert.equal(
    contracts.compareSemanticVersions("1.2.3+one", "1.2.3+two"),
    0,
  );
});

test("semantic versions reject non-canonical input", () => {
  for (const value of [
    "1.2",
    "v1.2.3",
    "01.2.3",
    "1.2.3-01",
    "1.2.3-alpha..1",
    "1.2.3+",
    123,
    `1.0.0+${"a".repeat(257)}`,
  ]) {
    assert.throws(
      () => contracts.parseSemanticVersion(value),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-semantic-version",
    );
  }
});

test("semantic version parts are immutable", () => {
  const parsed = contracts.parseSemanticVersion("1.2.3-alpha+build");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.prerelease), true);
  assert.equal(Object.isFrozen(parsed.build), true);
  assert.throws(() => parsed.prerelease.push("mutated"), TypeError);
});
