import assert from "node:assert/strict";
import test from "node:test";

import * as projectRuntime from "../dist/index.js";

test("project runtime exposes inspection and write-free initialization preparation", () => {
  assert.deepEqual(Object.keys(projectRuntime), [
    "PROJECT_INITIALIZATION_IGNORE_POLICY",
    "ProjectRuntimeError",
    "assertPreparedProjectInitialization",
    "createProjectInitializationCommandInput",
    "prepareProjectInitialization",
    "runProjectInspect",
  ]);
  assert.equal(typeof projectRuntime.ProjectRuntimeError, "function");
  assert.equal(
    typeof projectRuntime.assertPreparedProjectInitialization,
    "function",
  );
  assert.equal(
    typeof projectRuntime.createProjectInitializationCommandInput,
    "function",
  );
  assert.equal(typeof projectRuntime.prepareProjectInitialization, "function");
  assert.equal(typeof projectRuntime.runProjectInspect, "function");
});
