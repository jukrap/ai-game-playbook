import { mkdir, readFile, writeFile } from "node:fs/promises";

import { serializeFoundationPlanArtifact } from "../packages/registry/dist/index.js";

const targetUrl = new URL("../generated/foundation-plan.json", import.meta.url);
const expected = serializeFoundationPlanArtifact();
const mode = process.argv[2] ?? "--check";

if (mode === "--write") {
  await mkdir(new URL("../generated/", import.meta.url), { recursive: true });
  await writeFile(targetUrl, expected, "utf8");
  process.stdout.write("Foundation plan generated.\n");
} else if (mode === "--check") {
  let actual;
  try {
    actual = await readFile(targetUrl, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      process.stderr.write(
        "Tracked foundation plan is missing. Run pnpm plan:write.\n",
      );
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
  if (actual !== undefined && actual !== expected) {
    process.stderr.write(
      "Tracked foundation plan has drifted. Run pnpm plan:write.\n",
    );
    process.exitCode = 1;
  } else if (actual !== undefined) {
    process.stdout.write("Foundation plan is current.\n");
  }
} else {
  process.stderr.write("Usage: generate-foundation-plan.mjs --check|--write\n");
  process.exitCode = 2;
}
