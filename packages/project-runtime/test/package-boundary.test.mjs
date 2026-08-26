import assert from "node:assert/strict";
import test from "node:test";

import * as projectRuntime from "../dist/index.js";

test("project runtime exposes only the read-only inspection entry point", () => {
  assert.deepEqual(Object.keys(projectRuntime), ["runProjectInspect"]);
  assert.equal(typeof projectRuntime.runProjectInspect, "function");
});
