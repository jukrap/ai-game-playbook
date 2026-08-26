import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checkerPath = fileURLToPath(
  new URL("../scripts/check-worktree-clean.mjs", import.meta.url),
);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

function runChecker(cwd) {
  return spawnSync(process.execPath, [checkerPath, "--root", cwd], {
    encoding: "utf8",
    windowsHide: true,
  });
}

test("worktree checker rejects tracked and untracked drift while allowing ignored files", () => {
  const repository = mkdtempSync(join(tmpdir(), "agpb-clean-check-"));
  try {
    run("git", ["init"], repository);
    run("git", ["config", "user.name", "CI Test"], repository);
    run("git", ["config", "user.email", "ci-test@example.invalid"], repository);
    writeFileSync(join(repository, ".gitignore"), "ignored.txt\n", "utf8");
    writeFileSync(join(repository, "tracked.txt"), "baseline\n", "utf8");
    run("git", ["add", ".gitignore", "tracked.txt"], repository);
    run("git", ["commit", "--no-verify", "-m", "test: baseline"], repository);

    const clean = runChecker(repository);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /Workspace is clean\./);

    writeFileSync(join(repository, "ignored.txt"), "ignored\n", "utf8");
    const ignored = runChecker(repository);
    assert.equal(ignored.status, 0, ignored.stderr);

    writeFileSync(join(repository, "untracked.txt"), "unexpected\n", "utf8");
    const untracked = runChecker(repository);
    assert.equal(untracked.status, 1);
    assert.match(`${untracked.stdout}\n${untracked.stderr}`, /\?\? untracked\.txt/);
    rmSync(join(repository, "untracked.txt"));

    writeFileSync(join(repository, "tracked.txt"), "changed\n", "utf8");
    const tracked = runChecker(repository);
    assert.equal(tracked.status, 1);
    assert.match(`${tracked.stdout}\n${tracked.stderr}`, /M tracked\.txt/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
