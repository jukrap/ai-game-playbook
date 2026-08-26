import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const argumentsList = process.argv.slice(2);

let repositoryRoot = resolve(scriptDirectory, "..");
if (argumentsList.length > 0) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--root") {
    console.error("Usage: node scripts/check-worktree-clean.mjs [--root <repository>]");
    process.exitCode = 2;
  } else {
    repositoryRoot = resolve(argumentsList[1]);
  }
}

if (process.exitCode === undefined) {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (result.error) {
    console.error(`Unable to inspect workspace state: ${result.error.message}`);
    process.exitCode = 2;
  } else if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout).trim();
    console.error(`git status failed with exit code ${result.status}${diagnostic ? `:\n${diagnostic}` : "."}`);
    process.exitCode = 2;
  } else if (result.stdout.length > 0) {
    const outputLimit = 64 * 1024;
    const diagnostic = result.stdout.slice(0, outputLimit).trimEnd();
    const suffix = result.stdout.length > outputLimit ? "\n... output truncated" : "";
    console.error(`Workspace drift detected:\n${diagnostic}${suffix}`);
    process.exitCode = 1;
  } else {
    console.log("Workspace is clean.");
  }
}
