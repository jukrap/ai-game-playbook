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
        "sha256:c11e736e66924f8d066244453c4b504fc8faef8b219b5a69bd7a2db3920ddeef",
      cli: "sha256:5d0c52e51f9d217bdd1e8d6e0a7050f755f26e900f962f13ad324e8cd722434d",
      docs: "sha256:55e7bd1f6e65c2632d122c82a176c14278b9d6dbb09ae165f5e9a4d7b71465be",
      mcp: "sha256:af03b36f0ff0974ca305f16754fb6a79ee69d9663588d094879341b27b00bdef",
      skills:
        "sha256:c5894172bfe8f5f80be80c952765e7c70700c5c4fa002736550c3dbbc1c21ffc",
    },
  );
});
