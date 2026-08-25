import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = new URL(
  "../.github/workflows/control-plane.yml",
  import.meta.url,
);

test("control-plane CI runs the same locked verification on Windows and Linux", () => {
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /permissions:\n  contents: read\n/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /node-version: 22\.23\.2/);
  assert.match(workflow, /run: corepack enable/);
  assert.match(workflow, /run: pnpm --version/);
  assert.match(
    workflow,
    /run: pnpm install --frozen-lockfile --ignore-scripts/,
  );
  assert.match(workflow, /run: pnpm verify/);
  assert.match(workflow, /run: pnpm audit --prod/);
  assert.match(workflow, /run: git diff --exit-code -- \./);

  const actionReferences = [...workflow.matchAll(/^\s*- uses: ([^\s]+)$/gm)].map(
    ([, value]) => value,
  );
  assert.ok(actionReferences.length >= 2);
  for (const actionReference of actionReferences) {
    assert.match(actionReference, /^[^@\s]+@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflow, /pull_request_target/);
});
