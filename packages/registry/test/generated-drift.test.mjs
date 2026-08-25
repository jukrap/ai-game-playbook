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
        "sha256:5478c14760e877048ea675cd0c14b8b3011c621d46d16a8c45e658d608e81ca4",
      cli: "sha256:bdb95ec4a9f106cf66013a6889de969f59407b4dc603df6d6fc1148f062b5f70",
      docs: "sha256:4a330f445b5ffe9c946c5a3a0a84b99138ea9336e84170c05161d17aae9c9226",
      mcp: "sha256:d178e2ba6600896235deb98a6ca2443f5e7d9ff8c9ee1b47b34ee18a06485285",
      skills:
        "sha256:5e7ccc66baeed20ae75b733df3d86bd09adbd7564466126c4beebe8f6e2fdd21",
    },
  );
});
