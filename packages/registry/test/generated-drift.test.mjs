import assert from "node:assert/strict";
import test from "node:test";

import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

function surfaces() {
  return registry.generateRegistrySurfaces(
    registry.validateRegistry(createValidRegistryDefinition()),
  );
}

test("generated surface files are canonical, ordered, and immutable", () => {
  assert.equal(typeof registry.materializeRegistrySurfaces, "function");
  const generated = registry.materializeRegistrySurfaces(surfaces());

  assert.deepEqual(generated.map(({ path }) => path), [
    "generated/cli.json",
    "generated/docs.json",
    "generated/mcp.json",
    "generated/skills.json",
  ]);
  for (const file of generated) {
    assert.equal(
      JSON.parse(file.content).kind,
      file.path.slice("generated/".length, -".json".length),
    );
    assert.equal(file.content.endsWith("\n"), true);
    assert.equal(file.content.includes("\r"), false);
    assert.match(file.contentDigest, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      registry.checkGeneratedFile(file.content, file).status,
      "current",
    );
  }
  assert.throws(() => generated.reverse(), TypeError);
});

test("generated file checks detect missing, edited, and line-ending drift", () => {
  const [file] = registry.materializeRegistrySurfaces(surfaces());

  assert.equal(registry.checkGeneratedFile(undefined, file).status, "missing");
  assert.equal(
    registry.checkGeneratedFile(`${file.content} `, file).status,
    "drift",
  );
  assert.equal(
    registry.checkGeneratedFile(file.content.replaceAll("\n", "\r\n"), file)
      .status,
    "drift",
  );
  assert.throws(
    () => registry.assertGeneratedFileCurrent(`${file.content} `, file),
    (error) =>
      error?.name === "GeneratedArtifactDriftError" &&
      error?.code === "generated-artifact-drift",
  );
});

test("generated file checks reject caller-constructed expected values", () => {
  const generatedSurfaces = surfaces();
  const [file] = registry.materializeRegistrySurfaces(generatedSurfaces);
  const forged = structuredClone(file);

  assert.throws(
    () => registry.serializeGeneratedArtifact(structuredClone(generatedSurfaces.cli)),
    /generateRegistrySurfaces/,
  );
  assert.throws(
    () => registry.checkGeneratedFile(forged.content, forged),
    /materializeRegistrySurfaces/,
  );
  assert.throws(
    () =>
      new registry.GeneratedArtifactDriftError(
        registry.checkGeneratedFile(file.content, file),
      ),
    /current generated file/,
  );
});

test("registry and generated surface digests match the cross-platform golden vector", () => {
  const result = surfaces();
  const files = registry.materializeRegistrySurfaces(result);

  assert.deepEqual(
    {
      registry: result.registryDigest,
      cli: files.find(({ path }) => path === "generated/cli.json").contentDigest,
      docs: files.find(({ path }) => path === "generated/docs.json")
        .contentDigest,
      mcp: files.find(({ path }) => path === "generated/mcp.json").contentDigest,
      skills: files.find(({ path }) => path === "generated/skills.json")
        .contentDigest,
    },
    {
      registry:
        "sha256:e09621cc7b11ab62ad40e93c4212f721c2f65865a841f9f485dd5997fc00dedb",
      cli: "sha256:a31eb70fbce0953aeb6a75bb0ea8ffc35e2a238d03ba883afcefd5fac27f9acb",
      docs: "sha256:3ffe6ae18c096251de9ccd53ad137ea7cb13bd4bdac4dc2dcd153e78ae62b177",
      mcp: "sha256:e3458719e0e9906672b3ef4bbdf3ed3af466785d98b60d0e9dbaff0a86f246eb",
      skills:
        "sha256:90bc73dd551f6c6f23482cfb78284c90a26f1dca97cba69ff1a659f1cde6d40d",
    },
  );
});
