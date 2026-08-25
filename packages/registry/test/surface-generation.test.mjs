import assert from "node:assert/strict";
import test from "node:test";

import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

test("surface generation is deterministic and excludes internal entries", () => {
  assert.equal(typeof registry.generateRegistrySurfaces, "function");

  const first = registry.generateRegistrySurfaces(
    registry.validateRegistry(createValidRegistryDefinition()),
  );
  const reordered = createValidRegistryDefinition();
  reordered.commands.reverse();
  reordered.skills.reverse();
  const second = registry.generateRegistrySurfaces(
    registry.validateRegistry(reordered),
  );

  assert.deepEqual(first, second);
  assert.equal(first.registryDigest, second.registryDigest);
  for (const artifact of [first.cli, first.mcp, first.docs, first.skills]) {
    assert.equal(artifact.sourceRegistryDigest, first.registryDigest);
    assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  }

  const exposedIds = first.cli.data.commands.map(({ id }) => id);
  assert.deepEqual(exposedIds, ["engine.rollback", "project.inspect", "verify"]);
  assert.equal(exposedIds.includes("internal.health"), false);
  assert.throws(() => first.cli.data.commands.reverse(), TypeError);
});

test("surface generation refuses registry-shaped values that skipped validation", () => {
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  const detachedCopy = structuredClone(validated);

  assert.throws(
    () => registry.generateRegistrySurfaces(detachedCopy),
    /must be produced by validateRegistry/,
  );
});

test("CLI, docs, and MCP surfaces carry the same command and schema identity", () => {
  const surfaces = registry.generateRegistrySurfaces(
    registry.validateRegistry(createValidRegistryDefinition()),
  );

  const cli = new Map(surfaces.cli.data.commands.map((item) => [item.id, item]));
  const docs = new Map(
    surfaces.docs.data.commands.map((item) => [item.id, item]),
  );
  const tools = new Map(
    surfaces.mcp.data.tools.map((item) => [item.commandId, item]),
  );

  assert.deepEqual([...cli.keys()], [...docs.keys()]);
  assert.deepEqual([...cli.keys()], [...tools.keys()]);
  for (const id of cli.keys()) {
    assert.equal(cli.get(id).input.schemaId, docs.get(id).input.schemaId);
    assert.equal(cli.get(id).input.digest, tools.get(id).inputDigest);
    assert.equal(cli.get(id).output.digest, tools.get(id).outputDigest);
  }
});

test("MCP generation targets the stateless current protocol with hint-only annotations", () => {
  const { mcp } = registry.generateRegistrySurfaces(
    registry.validateRegistry(createValidRegistryDefinition()),
  );

  assert.equal(mcp.data.protocolRevision, "2026-07-28");
  assert.equal(mcp.data.lifecycle, "stateless");
  assert.deepEqual(mcp.data.extensions, []);

  const inspect = mcp.data.tools.find(
    ({ commandId }) => commandId === "project.inspect",
  );
  assert.equal(inspect.name, "agpb_project__inspect");
  assert.equal(inspect.annotations.readOnlyHint, true);
  assert.equal(inspect.annotations.destructiveHint, false);
  assert.equal(inspect.annotations.idempotentHint, true);
  assert.equal(inspect.annotations.openWorldHint, false);
  assert.equal(inspect.enabledByDefault, true);
  assert.equal(inspect.inputSchema.$id, inspect.inputSchemaId);
  assert.equal(inspect.outputSchema.$id, inspect.outputSchemaId);

  const rollback = mcp.data.tools.find(
    ({ commandId }) => commandId === "engine.rollback",
  );
  assert.equal(rollback.annotations.readOnlyHint, false);
  assert.equal(rollback.annotations.idempotentHint, false);
  assert.equal(rollback.enabledByDefault, false);
  assert.equal(rollback.meta.permissionAuthority, "agpb-broker");
  assert.equal(rollback.meta.requiresApply, true);
});

test("MCP tool names preserve distinct dot and hyphen command identities", () => {
  const definition = createValidRegistryDefinition();
  definition.commands.push({
    ...structuredClone(definition.commands[0]),
    id: "project-inspect",
    cli: { path: ["project-inspect"], aliases: [] },
    handler: {
      ...definition.commands[0].handler,
      export: "inspectProjectAlias",
    },
  });

  const { mcp } = registry.generateRegistrySurfaces(
    registry.validateRegistry(definition),
  );
  const names = new Map(mcp.data.tools.map((tool) => [tool.commandId, tool.name]));

  assert.equal(names.get("project.inspect"), "agpb_project__inspect");
  assert.equal(names.get("project-inspect"), "agpb_project_inspect");
  assert.notEqual(names.get("project.inspect"), names.get("project-inspect"));
});

test("skill routing exports only stable model-invocable discovery metadata", () => {
  const definition = createValidRegistryDefinition();
  definition.skills.push({
    ...structuredClone(definition.skills[0]),
    id: "gameplay.user-only",
    invocation: "user",
  });
  definition.skills.push({
    ...structuredClone(definition.skills[0]),
    id: "gameplay.experimental",
    lifecycle: "experimental",
  });

  const { skills } = registry.generateRegistrySurfaces(
    registry.validateRegistry(definition),
  );

  assert.deepEqual(skills.data.routes.map(({ id }) => id), [
    "gameplay.vertical-slice",
  ]);
  assert.deepEqual(Object.keys(skills.data.routes[0]).sort(), [
    "exclusions",
    "id",
    "summary",
    "triggers",
    "version",
  ]);
});
