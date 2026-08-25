import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowText = readFileSync(join(sourceRoot, ".github", "workflows", "docs.yml"), "utf8");

if (!workflowText.includes('- "scripts/check-docs.test.mjs"')) {
  throw new Error("documentation CI must watch the regression suite path");
}

const plannedSurfaceArtifact = JSON.parse(readFileSync(join(sourceRoot, "docs", "planned-surface.json"), "utf8"));
if (plannedSurfaceArtifact.schemaVersion !== "1" || Object.hasOwn(plannedSurfaceArtifact, "$schema")) {
  throw new Error("planned surface must use its manifest schemaVersion without claiming to be a JSON Schema");
}

function createFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "agpb-docs-check-"));
  mkdirSync(join(fixtureRoot, "scripts"), { recursive: true });
  cpSync(join(sourceRoot, "README.md"), join(fixtureRoot, "README.md"));
  cpSync(join(sourceRoot, "README.ko.md"), join(fixtureRoot, "README.ko.md"));
  cpSync(join(sourceRoot, "docs"), join(fixtureRoot, "docs"), { recursive: true });
  cpSync(join(sourceRoot, "scripts", "check-docs.mjs"), join(fixtureRoot, "scripts", "check-docs.mjs"));
  return fixtureRoot;
}

function runChecker(fixtureRoot) {
  return spawnSync(process.execPath, ["scripts/check-docs.mjs"], {
    cwd: fixtureRoot,
    encoding: "utf8"
  });
}

function updateFile(fixtureRoot, relativePath, transform) {
  const file = join(fixtureRoot, ...relativePath.split("/"));
  writeFileSync(file, transform(readFileSync(file, "utf8")), "utf8");
}

function runScenario({ name, mutate = () => {}, shouldPass, diagnostic }) {
  const fixtureRoot = createFixture();
  try {
    mutate(fixtureRoot);
    const result = runChecker(fixtureRoot);
    const output = `${result.stdout}\n${result.stderr}`;

    if (shouldPass && result.status !== 0) {
      throw new Error(`${name}: expected success, got:\n${output}`);
    }
    if (!shouldPass && result.status === 0) {
      throw new Error(`${name}: expected documentation checks to fail`);
    }
    if (diagnostic && !output.includes(diagnostic)) {
      throw new Error(`${name}: expected diagnostic ${JSON.stringify(diagnostic)}, got:\n${output}`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const scenarios = [
  {
    name: "valid package",
    shouldPass: true
  },
  {
    name: "valid English heading anchor",
    shouldPass: true,
    mutate: (root) =>
      updateFile(root, "README.ko.md", (text) => `${text}\n[대상](docs/README.md#audience-and-purpose)\n`)
  },
  {
    name: "valid Korean same-file heading anchor",
    shouldPass: true,
    mutate: (root) =>
      updateFile(root, "docs/README.ko.md", (text) => `${text}\n[대상](#독자와-목적)\n`)
  },
  {
    name: "external heading anchor",
    shouldPass: true,
    mutate: (root) =>
      updateFile(root, "README.ko.md", (text) => `${text}\n[외부](https://example.com/page#section)\n`)
  },
  {
    name: "missing heading anchor",
    shouldPass: false,
    diagnostic: "missing heading anchor",
    mutate: (root) =>
      updateFile(root, "README.ko.md", (text) => `${text}\n[깨진 제목](docs/README.md#missing-heading)\n`)
  },
  {
    name: "English source drift",
    shouldPass: false,
    diagnostic: "English source digest has drifted",
    mutate: (root) => updateFile(root, "README.md", (text) => `${text}\nChanged.\n`)
  },
  {
    name: "missing Korean mirror",
    shouldPass: false,
    diagnostic: "missing Korean mirror",
    mutate: (root) => rmSync(join(root, "docs", "architecture.ko.md"))
  },
  {
    name: "heading structure drift",
    shouldPass: false,
    diagnostic: "heading levels differ",
    mutate: (root) =>
      updateFile(root, "docs/architecture.ko.md", (text) => text.replace("# 목표 아키텍처", "## 목표 아키텍처"))
  },
  {
    name: "code fence drift",
    shouldPass: false,
    diagnostic: "code block count or languages differ",
    mutate: (root) =>
      updateFile(root, "docs/architecture.ko.md", (text) => text.replace("```mermaid", "```text"))
  },
  {
    name: "broken relative link",
    shouldPass: false,
    diagnostic: "broken relative link",
    mutate: (root) => updateFile(root, "README.ko.md", (text) => `${text}\n[없음](docs/missing.md)\n`)
  },
  {
    name: "planned command drift",
    shouldPass: false,
    diagnostic: "command block differs",
    mutate: (root) =>
      updateFile(root, "docs/planned-surface.json", (text) => {
        const surface = JSON.parse(text);
        surface.commands[0] = "agpb changed";
        return `${JSON.stringify(surface, null, 2)}\n`;
      })
  },
  {
    name: "review command removed everywhere",
    shouldPass: false,
    diagnostic: "review command set",
    mutate: (root) => {
      updateFile(root, "docs/planned-surface.json", (text) => {
        const surface = JSON.parse(text);
        surface.commands = surface.commands.filter((command) => command !== "agpb docs check");
        return `${JSON.stringify(surface, null, 2)}\n`;
      });
      updateFile(root, "docs/planned-cli.md", (text) => text.replace("agpb docs check\n", ""));
      const englishDigest = createHash("sha256")
        .update(readFileSync(join(root, "docs", "planned-cli.md")))
        .digest("hex");
      updateFile(root, "docs/planned-cli.ko.md", (text) =>
        text
          .replace("agpb docs check\n", "")
          .replace(/^source_sha256: [0-9a-f]{64}$/m, `source_sha256: ${englishDigest}`)
      );
    }
  },
  {
    name: "missing public type",
    shouldPass: false,
    diagnostic: "missing public type RunReceipt",
    mutate: (root) =>
      updateFile(root, "docs/concepts.ko.md", (text) => text.replaceAll("`RunReceipt`", "RunReceipt"))
  },
  {
    name: "executable availability overclaim",
    shouldPass: false,
    diagnostic: "executableAvailable must remain false",
    mutate: (root) =>
      updateFile(root, "docs/planned-surface.json", (text) => {
        const surface = JSON.parse(text);
        surface.executableAvailable = true;
        return `${JSON.stringify(surface, null, 2)}\n`;
      })
  },
  {
    name: "planned surface schema version drift",
    shouldPass: false,
    diagnostic: "schemaVersion 1",
    mutate: (root) =>
      updateFile(root, "docs/planned-surface.json", (text) => {
        const surface = JSON.parse(text);
        surface.schemaVersion = "2";
        return `${JSON.stringify(surface, null, 2)}\n`;
      })
  },
  {
    name: "private path leak",
    shouldPass: false,
    diagnostic: "contains worktree path",
    mutate: (root) => updateFile(root, "README.ko.md", (text) => `${text}\n.worktrees/private\n`)
  },
  {
    name: "orphaned Korean mirror",
    shouldPass: false,
    diagnostic: "orphaned Korean mirror",
    mutate: (root) => writeFileSync(join(root, "docs", "orphan.ko.md"), "# 고아 문서\n", "utf8")
  }
];

for (const scenario of scenarios) runScenario(scenario);

console.log(`Documentation checker tests passed: ${scenarios.length} scenarios.`);
