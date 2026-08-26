import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUILTIN_REGISTRY } from "../packages/registry/dist/index.js";

test("runtime command handler metadata attests the exact compiled module", async () => {
  const doctor = BUILTIN_REGISTRY.commands.find(({ id }) => id === "doctor");
  assert.notEqual(doctor, undefined);

  const source = await readFile(
    new URL("../packages/cli/dist/doctor.js", import.meta.url),
  );
  const digest = `sha256:${createHash("sha256").update(source).digest("hex")}`;

  assert.equal(doctor.handler.digest, digest);
});
