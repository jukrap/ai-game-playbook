import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_REGISTRY } from "../packages/registry/dist/index.js";

test("runtime command handler metadata attests each exact compiled module", async () => {
  for (const [commandId, moduleName] of [
    ["doctor", "doctor.js"],
    ["init", "init.js"],
    ["project.inspect", "project-inspect.js"],
    ["skill.check", "skill-check.js"],
    ["skill.list", "skill-list.js"],
  ]) {
    const command = BUILTIN_REGISTRY.commands.find(({ id }) => id === commandId);
    assert.notEqual(command, undefined);

    const source = await readFile(
      new URL(`../packages/cli/dist/${moduleName}`, import.meta.url),
    );
    const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;

    assert.equal(command.handler.digest, digest);
  }
});
