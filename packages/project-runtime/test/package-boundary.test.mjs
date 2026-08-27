import assert from "node:assert/strict";
import test from "node:test";

import * as projectRuntime from "../dist/index.js";

test("project runtime exposes inspection and bounded initialization execution", () => {
  assert.deepEqual(Object.keys(projectRuntime), [
    "PROJECT_INITIALIZATION_IGNORE_POLICY",
    "ProjectRuntimeError",
    "assertPreparedProjectInitialization",
    "createProjectInitializationAuthorizationRequest",
    "createProjectInitializationCommandInput",
    "executePreparedProjectInitialization",
    "prepareProjectInitialization",
    "runProjectInspect",
  ]);
  assert.equal(typeof projectRuntime.ProjectRuntimeError, "function");
  assert.equal(
    typeof projectRuntime.assertPreparedProjectInitialization,
    "function",
  );
  assert.equal(
    typeof projectRuntime.createProjectInitializationAuthorizationRequest,
    "function",
  );
  assert.equal(
    typeof projectRuntime.createProjectInitializationCommandInput,
    "function",
  );
  assert.equal(
    typeof projectRuntime.executePreparedProjectInitialization,
    "function",
  );
  assert.equal(typeof projectRuntime.prepareProjectInitialization, "function");
  assert.equal(typeof projectRuntime.runProjectInspect, "function");
});
