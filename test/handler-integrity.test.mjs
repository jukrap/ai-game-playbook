import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_REGISTRY } from "../packages/registry/dist/index.js";

test("runtime command handler metadata attests each exact compiled module", async () => {
  for (const [commandId, packageDirectory, moduleName] of [
    ["doctor", "cli", "doctor.js"],
    [
      "engine.executable-discovery",
      "godot-adapter",
      "executable-discovery.js",
    ],
    ["engine.status", "godot-adapter", "status.js"],
    ["engine.version-probe", "godot-adapter", "version-probe.js"],
    ["init", "cli", "init.js"],
    ["project.inspect", "project-runtime", "project-inspect.js"],
    ["skill.check", "cli", "skill-check.js"],
    ["skill.list", "cli", "skill-list.js"],
  ]) {
    const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
    assert.notEqual(command, undefined);

    const source = await readFile(
      new URL(`../packages/${packageDirectory}/dist/${moduleName}`, import.meta.url),
    );
    const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;

    assert.equal(command.handler.digest, digest);
  }
});
