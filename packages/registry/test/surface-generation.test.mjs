import assert from "node:assert/strict";
import test from "node:test";

import * as registry from "../dist/index.js";

import { createValidRegistryDefinition } from "./fixtures/registry.mjs";

test("surface generation is deterministic and excludes non-public entries", () => {
  assert.equal(typeof registry.generateRegistrySurfaces, "function");

  const firstDefinition = createValidRegistryDefinition();
  firstDefinition.commands.push({
    ...structuredClone(firstDefinition.commands[0]),
    id: "legacy.inspect",
    lifecycle: "deprecated",
    cli: { path: ["legacy", "inspect"], aliases: [] },
    handler: {
      ...firstDefinition.commands[0].handler,
      export: "inspectLegacyProject",
    },
  });
  const reordered = structuredClone(firstDefinition);
  reordered.commands.reverse();
  reordered.skills.reverse();
  const first = registry.generateRegistrySurfaces(
    registry.validateRegistry(firstDefinition),
  );
  const second = registry.generateRegistrySurfaces(
    registry.validateRegistry(reordered),
  );

  assert.deepEqual(first, second);
  assert.equal(first.registryDigest, second.registryDigest);
  const deprecatedIds = second.cli.data.commands.map(({ id }) => id);
  assert.equal(deprecatedIds.includes("legacy.inspect"), false);
  assert.equal(
    second.docs.data.commands.some(({ id }) => id === "legacy.inspect"),
    false,
  );
  assert.equal(
    second.mcp.data.tools.some(
      ({ commandId }) => commandId === "legacy.inspect",
    ),
    false,
  );
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
  const validated = registry.validateRegistry(createValidRegistryDefinition());
  const surfaces = registry.generateRegistrySurfaces(validated);

  const cli = new Map(surfaces.cli.data.commands.map((item) => [item.id, item]));
  const docs = new Map(
    surfaces.docs.data.commands.map((item) => [item.id, item]),
  );
  const tools = new Map(
    surfaces.mcp.data.tools.map((item) => [item.commandId, item]),
  );

  assert.equal(surfaces.cli.data.controlPlaneVersion, "0.0.0");
  assert.equal(surfaces.docs.data.controlPlaneVersion, "0.0.0");
  assert.equal(surfaces.mcp.data.controlPlaneVersion, "0.0.0");
  assert.equal(surfaces.skills.data.controlPlaneVersion, "0.0.0");

  assert.deepEqual([...cli.keys()], [...docs.keys()]);
  assert.deepEqual([...cli.keys()], [...tools.keys()]);
  for (const id of cli.keys()) {
    const source = validated.commands.find((command) => command.id === id);
    const { usage: _, ...documentedCommand } = docs.get(id);
    assert.deepEqual(cli.get(id), source);
    assert.deepEqual(documentedCommand, source);
    assert.deepEqual(tools.get(id).meta.command, source);
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
  assert.deepEqual(rollback.meta.command.permissions, [
    "write-project-source",
    "editor-control",
  ]);
  assert.equal(rollback.meta.command.timeoutMs, 30000);
  assert.equal(rollback.meta.command.handler.export, "rollbackFeature");
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

test("skill routing exports complete stable model-invocable authority metadata", () => {
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
  assert.deepEqual(
    skills.data.routes[0],
    definition.skills.find(({ id }) => id === "gameplay.vertical-slice"),
  );
  assert.deepEqual(skills.data.routes[0].capabilities, [
    "project.inspect",
    "engine.mutate",
    "engine.test",
  ]);
  assert.equal(
    skills.data.routes[0].body.path,
    "skills/gameplay-vertical-slice/SKILL.md",
  );
  assert.equal(skills.data.routes[0].completionCriteria.length > 0, true);
  assert.equal(skills.data.routes[0].evidenceDuties.length > 0, true);
});
