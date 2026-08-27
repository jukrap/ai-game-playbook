import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUILTIN_REGISTRY,
  serializeFoundationPlanArtifact,
} from "../packages/registry/dist/index.js";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

function parseArguments(values) {
  let mode;
  let root = defaultRoot;
  let rootProvided = false;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--check" || value === "--write") {
      if (mode !== undefined) throw new TypeError("mode must be provided once");
      mode = value;
      continue;
    }
    if (value === "--root") {
      if (rootProvided) throw new TypeError("--root must be provided once");
      const candidate = values[index + 1];
      if (candidate === undefined || !isAbsolute(candidate)) {
        throw new TypeError("--root requires an absolute path");
      }
      root = candidate;
      rootProvided = true;
      index += 1;
      continue;
    }
    throw new TypeError(`unknown argument: ${value ?? "<missing>"}`);
  }
  return Object.freeze({ mode: mode ?? "--check", root });
}

function synchronizePublicSurface(text) {
  const parsed = JSON.parse(text);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    parsed.schemaVersion !== "1" ||
    parsed.artifact !== "ai-game-playbook-planned-surface" ||
    typeof parsed.runtimeRegistryDigest !== "string"
  ) {
    throw new TypeError("public planned surface identity is invalid");
  }
  return `${JSON.stringify(
    {
      ...parsed,
      runtimeRegistryDigest: BUILTIN_REGISTRY.digest,
    },
    null,
    2,
  )}\n`;
}

async function readRequired(path, label) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing`);
    }
    throw error;
  }
}

async function run() {
  const { mode, root } = parseArguments(process.argv.slice(2));
  const planPath = join(root, "generated", "foundation-plan.json");
  const publicSurfacePath = join(root, "docs", "planned-surface.json");
  const expectedPlan = serializeFoundationPlanArtifact();
  const publicSurface = await readRequired(
    publicSurfacePath,
    "Public planned surface",
  );
  const expectedPublicSurface = synchronizePublicSurface(publicSurface);

  if (mode === "--write") {
    await mkdir(join(root, "generated"), { recursive: true });
    await writeFile(planPath, expectedPlan, "utf8");
    await writeFile(publicSurfacePath, expectedPublicSurface, "utf8");
    process.stdout.write("Foundation plan and public surface generated.\n");
    return;
  }

  let actualPlan;
  try {
    actualPlan = await readRequired(planPath, "Tracked foundation plan");
  } catch (error) {
    process.stderr.write(`${error.message}. Run pnpm plan:write.\n`);
    process.exitCode = 1;
  }
  const planDrift = actualPlan !== undefined && actualPlan !== expectedPlan;
  const publicSurfaceDrift = publicSurface !== expectedPublicSurface;
  if (planDrift || publicSurfaceDrift) {
    if (planDrift) {
      process.stderr.write(
        "Tracked foundation plan has drifted. Run pnpm plan:write.\n",
      );
    }
    if (publicSurfaceDrift) {
      process.stderr.write(
        "Public planned surface has drifted. Run pnpm plan:write.\n",
      );
    }
    process.exitCode = 1;
  } else if (actualPlan !== undefined) {
    process.stdout.write("Foundation plan and public surface are current.\n");
  }
}

try {
  await run();
} catch (error) {
  process.stderr.write(
    `Foundation plan generation failed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`,
  );
  process.exitCode = 1;
}
