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
        "sha256:fe408635a331f997cba91e965faa1d3aac3a7ba7c2f43176f914b1de6b867df8",
      cli: "sha256:a4ec23a34089df5d4869f18d4c862d78da7c64af4d4023960105e612726a8ba8",
      docs: "sha256:142c54c42ede431719d6dad39d9dd783d2d6d46907f3a27469de5b420fc288bc",
      mcp: "sha256:84e88dd72c3de3ca20a1fb81c5691a8a294750e3d6cceabf612d7bc8c0135872",
      skills:
        "sha256:3a71c32cc85855a0c1b1e0b8a5adfe9e35a56bf79e4d8c6c7d958030eb3d17c3",
    },
  );
});
