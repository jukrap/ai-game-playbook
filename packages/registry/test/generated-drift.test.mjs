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
        "sha256:9087047a667dcfc40af21a1ca0038afae6c663f3b792ad683255170cc0d5b986",
      cli: "sha256:3dd0ba9d1f54bf5ca699bcdb0d64b302c87317472eb4dbcf29abf5b59825cd5b",
      docs: "sha256:25852cccc4036f414617502e3f58dc1fc3affe97f4af50f31ecf41ebfcec10ce",
      mcp: "sha256:024237526e7c4b051ba0ae0b1cfa63e8e29c12d0ee2059312704b0ebe3e5679c",
      skills:
        "sha256:7ee24cede11c0bc2432488c4906112c1c58d2f52aec0d23a4d06efdd0d0e339c",
    },
  );
});
