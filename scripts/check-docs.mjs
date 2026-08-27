import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const failures = [];
const ROOT_README_MAX_BYTES = 9_000;
const MAX_PROSE_PARAGRAPH_CHARACTERS = 1_000;
const MAX_STATUS_BANNER_CHARACTERS = 320;
const reviewDesignSurface = {
  package: {
    npm: "ai-game-playbook",
    executable: "agpb"
  },
  commands: [
    "agpb init",
    "agpb doctor",
    "agpb project inspect",
    "agpb pack list",
    "agpb pack add",
    "agpb pack update",
    "agpb pack remove",
    "agpb pack doctor",
    "agpb skill list",
    "agpb skill install",
    "agpb skill check",
    "agpb engine status",
    "agpb engine capabilities",
    "agpb engine connect",
    "agpb run <workflow>",
    "agpb verify",
    "agpb evidence list",
    "agpb evidence show",
    "agpb evidence export",
    "agpb docs check"
  ],
  availableCommands: [
    "agpb init",
    "agpb doctor",
    "agpb project inspect",
    "agpb pack list",
    "agpb pack doctor",
    "agpb skill list",
    "agpb skill check",
    "agpb engine status",
    "agpb engine capabilities"
  ],
  publicTypes: [
    "CommandDescriptor",
    "PackManifest",
    "ProjectPackLock",
    "GameProjectProfile",
    "EngineCapabilityReport",
    "FeatureContract",
    "RunReceipt",
    "AssetProvenance"
  ],
  engines: ["Godot", "Unity", "Unreal Engine"],
  supportGrades: ["planned", "detected", "headless", "editor-preview", "verified"],
  evidenceGrades: ["documented", "implemented", "test-witnessed", "locally-executed", "engine-verified"]
};

function fail(message) {
  failures.push(message);
}

function portable(path) {
  return path.split(sep).join("/");
}

function rootPath(relativePath) {
  return join(root, ...relativePath.split("/"));
}

function readBytes(relativePath) {
  return readFileSync(rootPath(relativePath));
}

function readText(relativePath) {
  return readBytes(relativePath).toString("utf8");
}

function namedCommandBlock(relativePath, text, label) {
  const pattern = new RegExp(
    "```text " + label + "\\r?\\n([\\s\\S]*?)\\r?\\n```",
    "u"
  );
  const match = text.match(pattern);
  if (!match) {
    fail(`${relativePath}: missing ${label} command block`);
    return null;
  }

  return match[1]
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function listMarkdown(directory) {
  const absolute = rootPath(directory);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listMarkdown(child);
    return extname(entry.name).toLowerCase() === ".md" ? [child] : [];
  });
}

function parseFrontmatter(relativePath, text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) {
    fail(`${relativePath}: missing YAML frontmatter`);
    return {};
  }

  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) {
      fail(`${relativePath}: invalid frontmatter line: ${line}`);
      continue;
    }
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

function markdownShape(relativePath, text) {
  const headings = [];
  const fences = [];
  let openFence = null;

  for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
    const fence = line.match(/^\s*(```|~~~)(.*)$/);
    if (fence) {
      if (openFence === null) {
        openFence = fence[1];
        fences.push(fence[2].trim());
      } else if (fence[1] === openFence) {
        openFence = null;
      }
      continue;
    }

    if (openFence === null) {
      const heading = line.match(/^(#{1,6})\s+/);
      if (heading) headings.push(heading[1].length);
    }
  }

  if (openFence !== null) fail(`${relativePath}: unclosed code fence`);
  return { headings, fences };
}

function proseParagraphs(text) {
  const normalized = text
    .replaceAll("\r\n", "\n")
    .replace(/^---\n[\s\S]*?\n---\n/u, "");
  const paragraphs = [];
  let current = [];
  let openFence = null;

  function flush() {
    if (current.length > 0) paragraphs.push(current.join(" "));
    current = [];
  }

  for (const line of normalized.split("\n")) {
    const fence = line.match(/^\s*(```|~~~)/u);
    if (fence) {
      flush();
      if (openFence === null) openFence = fence[1];
      else if (fence[1] === openFence) openFence = null;
      continue;
    }
    if (openFence !== null) continue;

    const trimmed = line.trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    if (
      /^(?:#{1,6}\s|>|[-*+]\s|\d+[.)]\s|\||---$|<!--)/u.test(trimmed)
    ) {
      flush();
      continue;
    }
    current.push(trimmed);
  }
  flush();
  return paragraphs;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function headingSlug(heading) {
  return heading
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/<[^>]+>/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

const headingAnchorCache = new Map();

function headingAnchors(relativePath) {
  if (headingAnchorCache.has(relativePath)) return headingAnchorCache.get(relativePath);

  const anchors = new Set();
  const duplicateCounts = new Map();
  const text = readText(relativePath).replaceAll("\r\n", "\n");
  let openFence = null;

  for (const line of text.split("\n")) {
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      if (openFence === null) openFence = fence[1];
      else if (fence[1] === openFence) openFence = null;
      continue;
    }
    if (openFence !== null) continue;

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;

    const base = headingSlug(heading[1]);
    if (!base) continue;
    const duplicate = duplicateCounts.get(base) ?? 0;
    anchors.add(duplicate === 0 ? base : `${base}-${duplicate}`);
    duplicateCounts.set(base, duplicate + 1);
  }

  for (const match of text.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }

  headingAnchorCache.set(relativePath, anchors);
  return anchors;
}

function mirrorFor(englishPath) {
  return englishPath.replace(/\.md$/, ".ko.md");
}

function sourceForMirror(koreanPath) {
  return koreanPath.replace(/\.ko\.md$/, ".md");
}

const englishDocs = ["README.md", ...listMarkdown("docs")]
  .filter((path) => !path.endsWith(".ko.md"))
  .sort();
const koreanDocs = ["README.ko.md", ...listMarkdown("docs")]
  .filter((path) => path.endsWith(".ko.md"))
  .sort();

for (const readmePath of ["README.md", "README.ko.md"]) {
  if (
    existsSync(rootPath(readmePath)) &&
    readBytes(readmePath).byteLength > ROOT_README_MAX_BYTES
  ) {
    fail(`${readmePath}: exceeds the README byte limit of ${ROOT_README_MAX_BYTES}`);
  }
}

for (const englishPath of englishDocs) {
  const koreanPath = mirrorFor(englishPath);
  if (!existsSync(rootPath(koreanPath))) {
    fail(`${englishPath}: missing Korean mirror ${koreanPath}`);
    continue;
  }

  const englishBytes = readBytes(englishPath);
  const englishText = englishBytes.toString("utf8");
  const koreanText = readText(koreanPath);
  const metadata = parseFrontmatter(koreanPath, koreanText);
  const englishOpening = englishText.replaceAll("\r\n", "\n").split("\n").slice(0, 20).join("\n");
  const koreanOpening = koreanText.replaceAll("\r\n", "\n").split("\n").slice(0, 20).join("\n");

  if (!/^> Status:/m.test(englishOpening)) {
    fail(`${englishPath}: missing Status banner near the top of the document`);
  }
  if (!/^> 상태:/m.test(koreanOpening)) {
    fail(`${koreanPath}: missing Status banner near the top of the document`);
  }

  const englishStatus = englishOpening.match(/^> Status:[^\r\n]*$/m)?.[0];
  const koreanStatus = koreanOpening.match(/^> 상태:[^\r\n]*$/m)?.[0];
  if (
    englishStatus !== undefined &&
    englishStatus.length > MAX_STATUS_BANNER_CHARACTERS
  ) {
    fail(
      `${englishPath}: status banner exceeds ${MAX_STATUS_BANNER_CHARACTERS} characters`,
    );
  }
  if (
    koreanStatus !== undefined &&
    koreanStatus.length > MAX_STATUS_BANNER_CHARACTERS
  ) {
    fail(
      `${koreanPath}: status banner exceeds ${MAX_STATUS_BANNER_CHARACTERS} characters`,
    );
  }

  if (metadata.source !== englishPath) {
    fail(`${koreanPath}: source must be ${englishPath}`);
  }
  if (!/^[0-9a-f]{64}$/.test(metadata.source_sha256 ?? "")) {
    fail(`${koreanPath}: source_sha256 must be 64 lowercase hexadecimal characters`);
  } else if (metadata.source_sha256 !== sha256(englishBytes)) {
    fail(`${koreanPath}: English source digest has drifted`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.translated_at ?? "")) {
    fail(`${koreanPath}: translated_at must use YYYY-MM-DD`);
  }

  const englishShape = markdownShape(englishPath, englishText);
  const koreanShape = markdownShape(koreanPath, koreanText);
  if (!sameArray(englishShape.headings, koreanShape.headings)) {
    fail(`${koreanPath}: heading levels differ from ${englishPath}`);
  }
  if (!sameArray(englishShape.fences, koreanShape.fences)) {
    fail(`${koreanPath}: code block count or languages differ from ${englishPath}`);
  }
}

for (const koreanPath of koreanDocs) {
  const englishPath = sourceForMirror(koreanPath);
  if (!existsSync(rootPath(englishPath))) {
    fail(`${koreanPath}: orphaned Korean mirror; ${englishPath} is missing`);
  }
}

const publicMarkdown = [...new Set([...englishDocs, ...koreanDocs])];
const forbiddenPublicPatterns = [
  [/\.ai-agent-playbook/i, "private playbook path"],
  [/\.worktrees/i, "worktree path"],
  [/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/, "Windows absolute path"],
  [/(?:^|[\s(])\/(?:Users|home)\/[^\s)]+/m, "personal absolute path"],
  [/file:\/\//i, "local file URI"],
  [/\b(?:dossier|upstream|reference)\b/i, "non-public investigation term"]
];

for (const markdownPath of publicMarkdown) {
  const text = readText(markdownPath);
  for (const paragraph of proseParagraphs(text)) {
    if (paragraph.length > MAX_PROSE_PARAGRAPH_CHARACTERS) {
      fail(
        `${markdownPath}: prose paragraph exceeds ${MAX_PROSE_PARAGRAPH_CHARACTERS} characters`,
      );
      break;
    }
  }
  for (const [pattern, label] of forbiddenPublicPatterns) {
    if (pattern.test(text)) fail(`${markdownPath}: contains ${label}`);
  }

  const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (/^(?:https?:|mailto:)/i.test(target)) continue;

    target = target.split(/\s+["']/)[0];
    const hashIndex = target.indexOf("#");
    const rawPath = (hashIndex >= 0 ? target.slice(0, hashIndex) : target).split("?", 1)[0];
    const rawFragment = hashIndex >= 0 ? target.slice(hashIndex + 1) : "";

    let decodedPath;
    let decodedFragment;
    try {
      decodedPath = decodeURIComponent(rawPath);
      decodedFragment = decodeURIComponent(rawFragment);
    } catch {
      fail(`${markdownPath}: link is not valid URI encoding: ${target}`);
      continue;
    }

    const absoluteTarget = decodedPath
      ? resolve(dirname(rootPath(markdownPath)), decodedPath)
      : rootPath(markdownPath);
    const relativeTarget = relative(root, absoluteTarget);
    if (relativeTarget.startsWith(`..${sep}`) || relativeTarget === "..") {
      fail(`${markdownPath}: relative link escapes the repository: ${target}`);
    } else if (!existsSync(absoluteTarget)) {
      fail(`${markdownPath}: broken relative link: ${target}`);
    } else if (decodedFragment && extname(absoluteTarget).toLowerCase() === ".md") {
      const targetMarkdown = portable(relativeTarget || markdownPath);
      if (!headingAnchors(targetMarkdown).has(decodedFragment)) {
        fail(`${markdownPath}: missing heading anchor: ${target}`);
      }
    }
  }
}

for (const requiredPath of [
  "docs/cli.md",
  "docs/cli.ko.md",
  "docs/skills.md",
  "docs/skills.ko.md",
]) {
  if (!existsSync(rootPath(requiredPath))) {
    fail(`${requiredPath}: required public guide is missing`);
  }
}

for (const legacyPath of ["docs/planned-cli.md", "docs/planned-cli.ko.md"]) {
  if (existsSync(rootPath(legacyPath))) {
    fail(`${legacyPath}: legacy CLI document path must be removed`);
  }
}

let plannedSurface;
try {
  plannedSurface = JSON.parse(readText("docs/planned-surface.json"));
} catch (error) {
  fail(`docs/planned-surface.json: invalid JSON (${error.message})`);
}

if (plannedSurface) {
  if (plannedSurface.schemaVersion !== "1" || Object.hasOwn(plannedSurface, "$schema")) {
    fail("docs/planned-surface.json: must be schemaVersion 1 design metadata, not a JSON Schema document");
  }
  if (plannedSurface.implementationStatus !== "partial") {
    fail("docs/planned-surface.json: implementationStatus must remain partial while only part of the command surface exists");
  }
  if (plannedSurface.executableAvailable !== true) {
    fail("docs/planned-surface.json: executableAvailable must remain true after CLI implementation");
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(plannedSurface.runtimeRegistryDigest ?? "")) {
    fail("docs/planned-surface.json: runtimeRegistryDigest must be a canonical SHA-256 digest");
  }
  if (
    plannedSurface.package?.npm !== reviewDesignSurface.package.npm ||
    plannedSurface.package?.executable !== reviewDesignSurface.package.executable
  ) {
    fail("docs/planned-surface.json: review package or executable name has changed");
  }

  for (const field of ["commands", "availableCommands", "publicTypes", "engines", "supportGrades", "evidenceGrades"]) {
    const values = plannedSurface[field];
    if (!Array.isArray(values) || values.length === 0) {
      fail(`docs/planned-surface.json: ${field} must be a nonempty array`);
    } else if (new Set(values).size !== values.length) {
      fail(`docs/planned-surface.json: ${field} contains duplicates`);
    }
  }

  if (Array.isArray(plannedSurface.commands) && !sameArray(plannedSurface.commands, reviewDesignSurface.commands)) {
    fail("docs/planned-surface.json: review command set has changed");
  }
  if (
    Array.isArray(plannedSurface.availableCommands) &&
    !sameArray(plannedSurface.availableCommands, reviewDesignSurface.availableCommands)
  ) {
    fail("docs/planned-surface.json: available command set has drifted");
  }
  if (
    Array.isArray(plannedSurface.availableCommands) &&
    Array.isArray(plannedSurface.commands) &&
    plannedSurface.availableCommands.some((command) => !plannedSurface.commands.includes(command))
  ) {
    fail("docs/planned-surface.json: available commands must be part of the reviewed command set");
  }
  if (
    Array.isArray(plannedSurface.publicTypes) &&
    !sameArray(plannedSurface.publicTypes, reviewDesignSurface.publicTypes)
  ) {
    fail("docs/planned-surface.json: review public type set has changed");
  }
  if (Array.isArray(plannedSurface.engines) && !sameArray(plannedSurface.engines, reviewDesignSurface.engines)) {
    fail("docs/planned-surface.json: review engine set has changed");
  }
  if (
    Array.isArray(plannedSurface.supportGrades) &&
    !sameArray(plannedSurface.supportGrades, reviewDesignSurface.supportGrades)
  ) {
    fail("docs/planned-surface.json: review support grade sequence has changed");
  }
  if (
    Array.isArray(plannedSurface.evidenceGrades) &&
    !sameArray(plannedSurface.evidenceGrades, reviewDesignSurface.evidenceGrades)
  ) {
    fail("docs/planned-surface.json: review evidence grade sequence has changed");
  }

  if (Array.isArray(plannedSurface.commands)) {
    const availableCommands = Array.isArray(plannedSurface.availableCommands)
      ? plannedSurface.availableCommands
      : [];
    const plannedCommands = plannedSurface.commands.filter(
      (command) => !availableCommands.includes(command)
    );
    for (const cliPath of ["docs/cli.md", "docs/cli.ko.md"]) {
      if (!existsSync(rootPath(cliPath))) {
        fail(`${cliPath}: command guide is missing`);
        continue;
      }
      const cliText = readText(cliPath);
      const documentedAvailable = namedCommandBlock(cliPath, cliText, "available");
      const documentedPlanned = namedCommandBlock(cliPath, cliText, "planned");
      if (
        documentedAvailable &&
        !sameArray(documentedAvailable, availableCommands)
      ) {
        fail(`${cliPath}: available command block differs from docs/planned-surface.json`);
      }
      if (documentedPlanned && !sameArray(documentedPlanned, plannedCommands)) {
        fail(`${cliPath}: planned command block differs from docs/planned-surface.json`);
      }
    }
  }

  if (Array.isArray(plannedSurface.publicTypes)) {
    for (const conceptPath of ["docs/concepts.md", "docs/concepts.ko.md"]) {
      const concepts = readText(conceptPath);
      for (const type of plannedSurface.publicTypes) {
        if (!concepts.includes(`\`${type}\``)) fail(`${conceptPath}: missing public type ${type}`);
      }
    }
  }

  try {
    const generatedPlan = JSON.parse(readText("generated/foundation-plan.json"));
    const generatedCommands = generatedPlan.data?.commands ?? [];
    const availableCommands = generatedCommands
      .filter(({ availability }) => availability === "available")
      .map(({ syntax }) => syntax);
    const allCommands = generatedCommands.map(({ syntax }) => syntax);
    if (generatedPlan.data?.implementationStatus !== plannedSurface.implementationStatus) {
      fail("generated/foundation-plan.json: implementation status differs from the public surface");
    }
    if (generatedPlan.data?.executableAvailable !== plannedSurface.executableAvailable) {
      fail("generated/foundation-plan.json: executable availability differs from the public surface");
    }
    if (generatedPlan.data?.runtimeRegistryDigest !== plannedSurface.runtimeRegistryDigest) {
      fail("generated/foundation-plan.json: runtime registry digest differs from the public surface");
    }
    if (!sameArray(allCommands, plannedSurface.commands)) {
      fail("generated/foundation-plan.json: command set differs from the public surface");
    }
    if (!sameArray(availableCommands, plannedSurface.availableCommands)) {
      fail("generated/foundation-plan.json: available command set differs from the public surface");
    }

    const availableSkills = (generatedPlan.data?.skills ?? [])
      .filter(({ availability }) => availability === "available")
      .map(({ id }) => id);
    for (const skillPath of ["docs/skills.md", "docs/skills.ko.md"]) {
      if (!existsSync(rootPath(skillPath))) continue;
      const documentedSkills = [...readText(skillPath).matchAll(/^\|\s*`([a-z0-9]+(?:[.-][a-z0-9]+)*)`\s*\|/gmu)]
        .map((match) => match[1]);
      if (!sameArray(documentedSkills, availableSkills)) {
        fail(`${skillPath}: stable skill catalog differs from generated/foundation-plan.json`);
      }
    }
  } catch (error) {
    fail(`generated/foundation-plan.json: invalid JSON (${error.message})`);
  }

}

const readme = readText("README.md");
const koreanReadme = readText("README.ko.md");
const statusDoc = readText("docs/status-and-scope.md");
for (const requiredLink of [
  "docs/status-and-scope.md",
  "docs/cli.md",
  "docs/skills.md",
  "docs/roadmap.md",
]) {
  if (!readme.includes(requiredLink)) {
    fail(`README.md: missing primary documentation link ${requiredLink}`);
  }
}
for (const requiredLink of [
  "docs/status-and-scope.ko.md",
  "docs/cli.ko.md",
  "docs/skills.ko.md",
  "docs/roadmap.ko.md",
]) {
  if (!koreanReadme.includes(requiredLink)) {
    fail(`README.ko.md: missing primary documentation link ${requiredLink}`);
  }
}
if (
  !readme.includes("No installable package is published.") ||
  !readme.includes("Nine write-free CLI commands") ||
  !readme.includes("All live-engine capabilities and support grades remain planned.")
) {
  fail("README.md: executable availability limits must remain explicit");
}
if (
  !statusDoc.includes("There is no installable or published package") ||
  !statusDoc.includes("engine bridge") ||
  !statusDoc.includes("playable golden project")
) {
  fail("docs/status-and-scope.md: unavailable runtime and engine capabilities must remain explicit");
}

for (const requiredPath of [
  "README.md",
  "README.ko.md",
  "docs/planned-surface.json",
  "generated/foundation-plan.json"
]) {
  if (!existsSync(rootPath(requiredPath)) || !statSync(rootPath(requiredPath)).isFile()) {
    fail(`${requiredPath}: required public artifact is missing`);
  }
}

if (failures.length > 0) {
  console.error(`Documentation checks failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Documentation checks passed: ${englishDocs.length} English originals, ${koreanDocs.length} Korean mirrors, ${publicMarkdown.length} Markdown files.`
  );
}
