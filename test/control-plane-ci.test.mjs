import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controlPlaneWorkflowPath = new URL(
  "../.github/workflows/control-plane.yml",
  import.meta.url,
);
const docsWorkflowPath = new URL("../.github/workflows/docs.yml", import.meta.url);
const packageManifestPath = new URL("../package.json", import.meta.url);

test("control-plane CI runs the same locked verification on Windows and Linux", () => {
  const workflow = readFileSync(controlPlaneWorkflowPath, "utf8");

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
  assert.match(workflow, /run: pnpm audit\n/);
  assert.doesNotMatch(workflow, /pnpm audit --prod/);
  assert.match(workflow, /run: pnpm run ci:check-clean/);
  assert.match(workflow, /- "generated\/\*\*"/);
  assert.match(workflow, /- "docs\/planned-surface\.json"/);
  assert.equal(workflow.match(/- "global\.json"/g)?.length, 2);
  assert.match(
    workflow,
    /uses: actions\/setup-dotnet@[0-9a-f]{40}\r?\n\s+with:\r?\n\s+dotnet-version: 10\.0\.400/,
  );
  assert.match(workflow, /run: pnpm run provider:windows:verify/);

  const actionReferences = [...workflow.matchAll(/^\s*- uses: ([^\s]+)$/gm)].map(
    ([, value]) => value,
  );
  assert.ok(actionReferences.length >= 2);
  for (const actionReference of actionReferences) {
    assert.match(actionReference, /^[^@\s]+@[0-9a-f]{40}$/);
  }
  assert.doesNotMatch(workflow, /pull_request_target/);
});

test("repository workflows do not persist checkout credentials", () => {
  for (const candidateWorkflowPath of [controlPlaneWorkflowPath, docsWorkflowPath]) {
    const workflow = readFileSync(candidateWorkflowPath, "utf8");
    assert.match(
      workflow,
      /uses: actions\/checkout@[0-9a-f]{40}[^\r\n]*\r?\n\s+with:\r?\n\s+persist-credentials: false/,
    );
    assert.doesNotMatch(workflow, /persist-credentials: true/);
    assert.doesNotMatch(workflow, /pull_request_target/);
    assert.match(workflow, /node-version: 22\.23\.2/);
  }
});

test("Windows containment integration tests run one native scenario at a time", () => {
  const packageManifest = JSON.parse(readFileSync(packageManifestPath, "utf8"));
  const verification = packageManifest.scripts?.["provider:windows:verify"];

  assert.equal(typeof verification, "string");
  assert.match(
    verification,
    /node --test --test-concurrency=1 packages\/windows-containment-provider\/test\/\*\.test\.mjs packages\/godot-adapter\/test\/contained-headless-admission\.test\.mjs$/,
  );
});
