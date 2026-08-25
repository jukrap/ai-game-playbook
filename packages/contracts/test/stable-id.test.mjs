import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("stable IDs use a bounded lowercase namespace grammar", () => {
  assert.equal(typeof contracts.parseStableId, "function");
  assert.equal(typeof contracts.isStableId, "function");

  for (const value of ["agpb", "project.inspect", "engine.godot-4"]) {
    assert.equal(contracts.parseStableId(value), value);
    assert.equal(contracts.isStableId(value), true);
  }

  for (const value of [
    "",
    "Project.inspect",
    "project/inspect",
    "project..inspect",
    "project_ inspect",
    `a${"b".repeat(128)}`,
    42,
  ]) {
    assert.equal(contracts.isStableId(value), false);
    assert.throws(
      () => contracts.parseStableId(value),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-stable-id",
    );
  }
});
