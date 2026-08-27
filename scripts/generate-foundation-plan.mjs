import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
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
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing`);
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  return readFile(path, "utf8");
}

async function assertDirectory(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing`);
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a regular directory`);
  }
}

async function ensureDirectory(path, label) {
  try {
    await assertDirectory(path, label);
    return;
  } catch (error) {
    if (error?.message !== `${label} is missing`) throw error;
  }
  await mkdir(path);
  await assertDirectory(path, label);
}

async function assertWritableTarget(path, label) {
  let stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file or missing`);
  }
}

async function run() {
  const { mode, root } = parseArguments(process.argv.slice(2));
  const generatedDirectory = join(root, "generated");
  const docsDirectory = join(root, "docs");
  const planPath = join(generatedDirectory, "foundation-plan.json");
  const publicSurfacePath = join(docsDirectory, "planned-surface.json");
  const expectedPlan = serializeFoundationPlanArtifact();
  await assertDirectory(root, "Repository root");
  await assertDirectory(docsDirectory, "Public docs directory");
  if (mode === "--write") {
    await ensureDirectory(generatedDirectory, "Generated output directory");
  } else {
    await assertDirectory(generatedDirectory, "Generated output directory");
  }
  const publicSurface = await readRequired(
    publicSurfacePath,
    "Public planned surface",
  );
  const expectedPublicSurface = synchronizePublicSurface(publicSurface);

  if (mode === "--write") {
    await assertWritableTarget(planPath, "Tracked foundation plan");
    await assertDirectory(generatedDirectory, "Generated output directory");
    await assertDirectory(docsDirectory, "Public docs directory");
    await writeFile(planPath, expectedPlan, "utf8");
    await readRequired(planPath, "Tracked foundation plan");
    await readRequired(publicSurfacePath, "Public planned surface");
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
