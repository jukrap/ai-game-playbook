import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import * as contracts from "../packages/contracts/dist/index.js";
import * as registry from "../packages/registry/dist/index.js";

const rootUrl = new URL("../", import.meta.url);

test("foundation plan separates available and planned command surfaces", () => {
  const artifact = registry.FOUNDATION_PLAN_ARTIFACT;

  assert.equal(artifact.schemaVersion, "1.0.0");
  assert.equal(artifact.artifact, "ai-game-playbook-foundation-plan");
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/);
  const { digest: _, ...unsignedArtifact } = artifact;
  assert.equal(artifact.digest, contracts.digestCanonicalJson(unsignedArtifact));
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal(Object.isFrozen(artifact.data.commands), true);
  assert.equal(artifact.data.implementationStatus, "partial");
  assert.equal(artifact.data.executableAvailable, true);
  assert.equal(artifact.data.runtimeRegistryDigest, registry.BUILTIN_REGISTRY.digest);
  assert.equal(artifact.data.package.npm, "ai-game-playbook");
  assert.equal(artifact.data.package.executable, "agpb");
  assert.equal(artifact.data.commands.length, 20);
  assert.equal(artifact.data.skills.length, 13);

  assert.equal(
    new Set(artifact.data.commands.map(({ id }) => id)).size,
    artifact.data.commands.length,
  );
  assert.equal(
    new Set(artifact.data.skills.map(({ id }) => id)).size,
    artifact.data.skills.length,
  );
  for (const command of artifact.data.commands) {
    assert.equal(contracts.isStableId(command.id), true);
    assert.equal(contracts.isStableId(command.capability), true);
    assert.equal(["available", "planned"].includes(command.availability), true);
    assert.equal(command.syntax.startsWith("agpb "), true);
    assert.equal(Object.hasOwn(command, "handler"), false);
  }
  assert.deepEqual(
    artifact.data.commands
      .filter(({ availability }) => availability === "available")
      .map(({ id }) => id)
      .sort(),
    registry.BUILTIN_REGISTRY_SURFACES.cli.data.commands
      .map(({ id }) => id)
      .sort(),
  );
  for (const skill of artifact.data.skills) {
    assert.equal(contracts.isStableId(skill.id), true);
    assert.equal(contracts.isStableId(skill.capability), true);
    assert.equal(skill.availability, "planned");
    assert.equal(Object.hasOwn(skill, "body"), false);
  }

  const engineSkills = artifact.data.skills.filter(({ engine }) =>
    ["godot", "unity", "unreal"].includes(engine),
  );
  assert.deepEqual(
    engineSkills.map(({ engine }) => engine),
    ["godot", "unity", "unreal"],
  );
  assert.equal(
    engineSkills.every(({ mode }) => mode === "planning-check"),
    true,
  );
});

test("tracked foundation plan is canonical and matches the public planned CLI", async () => {
  const tracked = await readFile(
    new URL("generated/foundation-plan.json", rootUrl),
    "utf8",
  );
  assert.equal(tracked, registry.serializeFoundationPlanArtifact());
  assert.equal(tracked.endsWith("\n"), true);
  assert.equal(tracked.includes("\r"), false);

  const publicPlan = JSON.parse(
    await readFile(new URL("docs/planned-surface.json", rootUrl), "utf8"),
  );
  assert.equal(publicPlan.implementationStatus, "partial");
  assert.equal(publicPlan.executableAvailable, true);
  assert.equal(
    publicPlan.runtimeRegistryDigest,
    registry.BUILTIN_REGISTRY.digest,
  );
  assert.deepEqual(
    publicPlan.availableCommands,
    registry.FOUNDATION_PLAN_ARTIFACT.data.commands
      .filter(({ availability }) => availability === "available")
      .map(({ syntax }) => syntax),
  );
  assert.deepEqual(
    publicPlan.commands,
    registry.FOUNDATION_PLAN_ARTIFACT.data.commands.map(
      ({ syntax }) => syntax,
    ),
  );
});
