import {
  checkPlaytestScenarioSemantics,
  compareCanonicalText,
  computePlaytestScenarioDigest,
  digestCanonicalJson,
  isSha256Digest,
  playtestScenarioSchema,
  sha256Digest,
  type PlaytestScenario,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import {
  assertProjectRootIdentity,
  readFileHandleBounded,
  resolveProjectPath,
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import { assertEngineExecutionSourceManifest } from "@ai-game-playbook/engine-common";
import {
  BUILTIN_REGISTRY,
  validateRegisteredContractValue,
} from "@ai-game-playbook/registry";
import { open } from "node:fs/promises";
import { isProxy } from "node:util/types";

import { GodotAdapterBoundaryError } from "./errors.js";

export const GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST: Sha256Digest =
  "sha256:910710e31f687f5b9b27dc7c9f41f68091ae6317e5fabb44e5a1d2047953ba3a" as Sha256Digest;
export const GODOT_GRAYBOX_SCENARIO_DIGEST: Sha256Digest =
  "sha256:4bce945905093f746939b6b8f1c6183d0795f2f74b533763970aeed5be4e6c0f" as Sha256Digest;
export const GODOT_GRAYBOX_TARGET_VERSION = "4.7.2" as const;

export type GodotGrayboxFeature =
  | "camera-follow"
  | "collision"
  | "collectible"
  | "deterministic-input-replay"
  | "hud-counter"
  | "movement"
  | "save-load"
  | "state-trace"
  | "win-state";

export type GodotGrayboxSourceRole =
  | "project-settings"
  | "scenario"
  | "scene"
  | "gameplay-script"
  | "replay-script";

export interface GodotGrayboxSourceDescriptor {
  readonly path: string;
  readonly role: GodotGrayboxSourceRole;
  readonly bytes: number;
  readonly digest: Sha256Digest;
}

export interface GodotGrayboxProjectManifest {
  readonly schemaVersion: "1.0.0";
  readonly projectId: "golden.graybox.godot";
  readonly engine: {
    readonly id: "godot";
    readonly version: typeof GODOT_GRAYBOX_TARGET_VERSION;
    readonly releaseStatus: "stable";
  };
  readonly mainScene: "scenes/main.tscn";
  readonly scenario: {
    readonly path: "scenario.json";
    readonly digest: typeof GODOT_GRAYBOX_SCENARIO_DIGEST;
  };
  readonly features: readonly GodotGrayboxFeature[];
  readonly files: readonly GodotGrayboxSourceDescriptor[];
  readonly sourceDigest: Sha256Digest;
  readonly support: {
    readonly grade: "planned";
    readonly evidenceGrade: "implemented";
    readonly liveValidated: false;
  };
}

export interface GodotGrayboxSourceText {
  readonly path: string;
  readonly text: string;
}

export interface VerifyGodotGrayboxProjectBundleRequest {
  readonly manifest: GodotGrayboxProjectManifest;
  readonly files: readonly GodotGrayboxSourceText[];
}

export interface VerifyGodotGrayboxProjectRootRequest {
  readonly root: CanonicalProjectRoot;
  readonly binding: import("@ai-game-playbook/contracts").EngineExecutionSnapshotBinding;
  readonly executable: BoundProcessExecutable;
}

export interface GodotGrayboxProjectReport {
  readonly schemaVersion: "1.0.0";
  readonly projectId: "golden.graybox.godot";
  readonly engine: GodotGrayboxProjectManifest["engine"];
  readonly mainScene: "scenes/main.tscn";
  readonly scenarioDigest: typeof GODOT_GRAYBOX_SCENARIO_DIGEST;
  readonly manifestDigest: typeof GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST;
  readonly sourceDigest: Sha256Digest;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly features: readonly GodotGrayboxFeature[];
  readonly support: GodotGrayboxProjectManifest["support"];
}

const maximumSourceFileBytes = 1_048_576;
const maximumSourceBundleBytes = 4_194_304;
const maximumManifestBytes = 262_144;
const disallowedTextControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

const expectedFeatures = Object.freeze([
  "camera-follow",
  "collision",
  "collectible",
  "deterministic-input-replay",
  "hud-counter",
  "movement",
  "save-load",
  "state-trace",
  "win-state",
] as const);

const expectedFiles = Object.freeze([
  Object.freeze({ path: "project.godot", role: "project-settings" as const }),
  Object.freeze({ path: "scenario.json", role: "scenario" as const }),
  Object.freeze({ path: "scenes/main.tscn", role: "scene" as const }),
  Object.freeze({
    path: "scripts/graybox_game.gd",
    role: "gameplay-script" as const,
  }),
  Object.freeze({
    path: "scripts/graybox_replay.gd",
    role: "replay-script" as const,
  }),
]);

type GrayboxErrorCode =
  | "godot-graybox-request-invalid"
  | "godot-graybox-manifest-invalid"
  | "godot-graybox-source-invalid"
  | "godot-graybox-source-drift";

function fail(code: GrayboxErrorCode, message: string): never {
  throw new GodotAdapterBoundaryError(code, message, false);
}

function dataRecord(
  value: unknown,
  keys: readonly string[],
  code: GrayboxErrorCode,
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(code, message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return fail(code, message);
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail(code, message);
    }
    result[name] = descriptor.value;
  }
  return result;
}

function dataArray(
  value: unknown,
  code: GrayboxErrorCode,
  message: string,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(code, message);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return fail(code, message);
  }
  const length = lengthDescriptor.value;
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== length + 1 ||
    names.some(
      (name) =>
        name !== "length" &&
        (!/^(?:0|[1-9][0-9]*)$/u.test(name) || Number(name) >= length),
    )
  ) {
    return fail(code, message);
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail(code, message);
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
}

function exactText(value: unknown, expected: string, message: string): string {
  if (value !== expected) {
    return fail("godot-graybox-manifest-invalid", message);
  }
  return expected;
}

function boundedBytes(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximumSourceFileBytes
  ) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox source byte counts must stay within the static boundary.",
    );
  }
  return value;
}

function sourceDigestFor(
  files: readonly GodotGrayboxSourceDescriptor[],
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-graybox-source",
    version: "1.0.0",
    files,
  });
}

function manifestDigestFor(
  manifest: GodotGrayboxProjectManifest,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/godot-graybox-manifest",
    version: "1.0.0",
    manifest,
  });
}

function parseManifest(value: unknown): GodotGrayboxProjectManifest {
  const record = dataRecord(
    value,
    [
      "schemaVersion",
      "projectId",
      "engine",
      "mainScene",
      "scenario",
      "features",
      "files",
      "sourceDigest",
      "support",
    ],
    "godot-graybox-manifest-invalid",
    "Godot graybox manifest must contain one exact static project identity.",
  );
  exactText(record["schemaVersion"], "1.0.0", "Godot graybox manifest schema is not supported.");
  exactText(record["projectId"], "golden.graybox.godot", "Godot graybox project identity does not match.");
  exactText(record["mainScene"], "scenes/main.tscn", "Godot graybox main scene does not match.");

  const engineRecord = dataRecord(
    record["engine"],
    ["id", "version", "releaseStatus"],
    "godot-graybox-manifest-invalid",
    "Godot graybox engine identity is invalid.",
  );
  exactText(engineRecord["id"], "godot", "Godot graybox engine must be Godot.");
  exactText(engineRecord["version"], GODOT_GRAYBOX_TARGET_VERSION, "Godot graybox engine version does not match.");
  exactText(engineRecord["releaseStatus"], "stable", "Godot graybox release status does not match.");
  const engine = Object.freeze({
    id: "godot" as const,
    version: GODOT_GRAYBOX_TARGET_VERSION,
    releaseStatus: "stable" as const,
  });

  const scenarioRecord = dataRecord(
    record["scenario"],
    ["path", "digest"],
    "godot-graybox-manifest-invalid",
    "Godot graybox scenario identity is invalid.",
  );
  exactText(scenarioRecord["path"], "scenario.json", "Godot graybox scenario path does not match.");
  exactText(
    scenarioRecord["digest"],
    GODOT_GRAYBOX_SCENARIO_DIGEST,
    "Godot graybox scenario digest does not match.",
  );
  const scenario = Object.freeze({
    path: "scenario.json" as const,
    digest: GODOT_GRAYBOX_SCENARIO_DIGEST,
  });

  const featureValues = dataArray(
    record["features"],
    "godot-graybox-manifest-invalid",
    "Godot graybox features must be one dense ordered list.",
  );
  if (
    featureValues.length !== expectedFeatures.length ||
    expectedFeatures.some((feature, index) => featureValues[index] !== feature)
  ) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox features do not match the fixed source contract.",
    );
  }
  const features = Object.freeze([...expectedFeatures]);

  const fileValues = dataArray(
    record["files"],
    "godot-graybox-manifest-invalid",
    "Godot graybox files must be one dense ordered list.",
  );
  if (fileValues.length !== expectedFiles.length) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox manifest must declare every source file exactly once.",
    );
  }
  const files = Object.freeze(
    fileValues.map((fileValue, index): GodotGrayboxSourceDescriptor => {
      const expected = expectedFiles[index];
      if (expected === undefined) {
        return fail(
          "godot-graybox-manifest-invalid",
          "Godot graybox manifest contains an undeclared source file.",
        );
      }
      const fileRecord = dataRecord(
        fileValue,
        ["path", "role", "bytes", "digest"],
        "godot-graybox-manifest-invalid",
        "Godot graybox file descriptors must be exact data records.",
      );
      exactText(fileRecord["path"], expected.path, "Godot graybox source path does not match.");
      exactText(fileRecord["role"], expected.role, "Godot graybox source role does not match.");
      if (!isSha256Digest(fileRecord["digest"])) {
        return fail(
          "godot-graybox-manifest-invalid",
          "Godot graybox source digest is invalid.",
        );
      }
      return Object.freeze({
        path: expected.path,
        role: expected.role,
        bytes: boundedBytes(fileRecord["bytes"]),
        digest: fileRecord["digest"],
      });
    }),
  );
  if (
    !isSha256Digest(record["sourceDigest"]) ||
    sourceDigestFor(files) !== record["sourceDigest"]
  ) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox source identity does not match its file descriptors.",
    );
  }

  const supportRecord = dataRecord(
    record["support"],
    ["grade", "evidenceGrade", "liveValidated"],
    "godot-graybox-manifest-invalid",
    "Godot graybox support status must remain explicit.",
  );
  exactText(supportRecord["grade"], "planned", "Godot graybox support cannot be promoted by a static manifest.");
  exactText(supportRecord["evidenceGrade"], "implemented", "Godot graybox static evidence grade does not match.");
  if (supportRecord["liveValidated"] !== false) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox live validation requires separate engine evidence.",
    );
  }
  const support = Object.freeze({
    grade: "planned" as const,
    evidenceGrade: "implemented" as const,
    liveValidated: false as const,
  });

  const manifest: GodotGrayboxProjectManifest = Object.freeze({
    schemaVersion: "1.0.0",
    projectId: "golden.graybox.godot",
    engine,
    mainScene: "scenes/main.tscn",
    scenario,
    features,
    files,
    sourceDigest: record["sourceDigest"],
    support,
  });
  if (manifestDigestFor(manifest) !== GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST) {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox manifest does not match the compiled project identity.",
    );
  }
  return manifest;
}

function sourceText(value: unknown, expectedPath: string): GodotGrayboxSourceText {
  const record = dataRecord(
    value,
    ["path", "text"],
    "godot-graybox-source-invalid",
    "Godot graybox source entries must be exact text records.",
  );
  if (record["path"] !== expectedPath || typeof record["text"] !== "string") {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source entries must follow the manifest order.",
    );
  }
  const text = record["text"];
  const bytes = Buffer.byteLength(text, "utf8");
  if (
    bytes < 1 ||
    bytes > maximumSourceFileBytes ||
    text.startsWith("\uFEFF") ||
    text.includes("\r") ||
    !text.endsWith("\n") ||
    disallowedTextControls.test(text)
  ) {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox sources must be bounded BOM-free UTF-8 text with LF endings.",
    );
  }
  return Object.freeze({ path: expectedPath, text });
}

function requireTextFragments(
  text: string,
  fragments: readonly string[],
  message: string,
): void {
  if (fragments.some((fragment) => !text.includes(fragment))) {
    fail("godot-graybox-source-invalid", message);
  }
}

function assertStaticStructure(files: ReadonlyMap<string, string>): void {
  const project = files.get("project.godot") ?? "";
  requireTextFragments(
    project,
    [
      "config_version=5",
      'config/features=PackedStringArray("4.7", "GL Compatibility")',
      'run/main_scene="res://scenes/main.tscn"',
      "common/physics_ticks_per_second=60",
      'renderer/rendering_method="gl_compatibility"',
    ],
    "Godot graybox project settings do not bind the expected runtime.",
  );

  const scene = files.get("scenes/main.tscn") ?? "";
  requireTextFragments(
    scene,
    [
      '[ext_resource type="Script" path="res://scripts/graybox_game.gd"',
      '[node name="GrayboxGame" type="Node3D"]',
      'script = ExtResource("1_graybox")',
    ],
    "Godot graybox main scene does not bind its gameplay script.",
  );

  const game = files.get("scripts/graybox_game.gd") ?? "";
  requireTextFragments(
    game,
    [
      "CharacterBody3D",
      "Camera3D",
      "StaticBody3D",
      "Area3D",
      "CanvasLayer",
      "func apply_replay_event(",
      "func reset_fresh_profile(",
      "func save_game(",
      "func load_game(",
      "func state_value(",
      '"--agpb-replay" in OS.get_cmdline_user_args()',
      'FileAccess.get_file_as_string("res://scenario.json")',
    ],
    "Godot graybox gameplay source is missing a required behavior boundary.",
  );

  const replay = files.get("scripts/graybox_replay.gd") ?? "";
  requireTextFragments(
    replay,
    [
      "func before_tick(",
      "func after_tick(",
      "func _assertion_passes(",
      "HashingContext.HASH_SHA256",
      "AGPB_GRAYBOX ",
      GODOT_GRAYBOX_SCENARIO_DIGEST,
    ],
    "Godot graybox replay source is missing a required deterministic boundary.",
  );

  const allSource = [...files.values()].join("\n");
  const forbidden = [
    "HTTPClient",
    "HTTPRequest",
    "JavaScriptBridge",
    "OS.create_process",
    "OS.execute",
    "PacketPeer",
    "TCPServer",
    "UDPServer",
    "WebSocketPeer",
    "res://..",
  ];
  if (forbidden.some((fragment) => allSource.includes(fragment))) {
    fail(
      "godot-graybox-source-invalid",
      "Godot graybox source declares an effect outside its offline fixture boundary.",
    );
  }
}

function validateScenario(text: string): PlaytestScenario {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox scenario is not valid JSON.",
    );
  }
  let scenario: PlaytestScenario;
  try {
    scenario = validateRegisteredContractValue(
      BUILTIN_REGISTRY,
      {
        schemaId: playtestScenarioSchema.schemaId,
        digest: playtestScenarioSchema.digest,
      },
      parsed,
    ) as unknown as PlaytestScenario;
  } catch {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox scenario does not satisfy its registered schema.",
    );
  }
  if (
    checkPlaytestScenarioSemantics(scenario).length !== 0 ||
    computePlaytestScenarioDigest(scenario) !== GODOT_GRAYBOX_SCENARIO_DIGEST
  ) {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox scenario does not preserve the canonical behavior contract.",
    );
  }
  return scenario;
}

export function verifyGodotGrayboxProjectBundle(
  value: VerifyGodotGrayboxProjectBundleRequest,
): GodotGrayboxProjectReport;
export function verifyGodotGrayboxProjectBundle(
  value: unknown,
): GodotGrayboxProjectReport {
  const request = dataRecord(
    value,
    ["manifest", "files"],
    "godot-graybox-request-invalid",
    "Godot graybox verification requires one exact manifest and source bundle.",
  );
  const manifest = parseManifest(request["manifest"]);
  const fileValues = dataArray(
    request["files"],
    "godot-graybox-source-invalid",
    "Godot graybox source bundle must be one dense ordered list.",
  );
  if (fileValues.length !== manifest.files.length) {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source bundle must contain every declared file exactly once.",
    );
  }

  const files = Object.freeze(
    fileValues.map((entry, index) => {
      const descriptor = manifest.files[index];
      if (descriptor === undefined) {
        return fail(
          "godot-graybox-source-invalid",
          "Godot graybox source bundle contains an undeclared file.",
        );
      }
      return sourceText(entry, descriptor.path);
    }),
  );
  let totalBytes = 0;
  const observedDescriptors: GodotGrayboxSourceDescriptor[] = [];
  const sourceMap = new Map<string, string>();
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const descriptor = manifest.files[index];
    if (file === undefined || descriptor === undefined) {
      return fail(
        "godot-graybox-source-invalid",
        "Godot graybox source bundle is incomplete.",
      );
    }
    const bytes = Buffer.byteLength(file.text, "utf8");
    const digest = sha256Digest(Buffer.from(file.text, "utf8"));
    if (bytes !== descriptor.bytes || digest !== descriptor.digest) {
      return fail(
        "godot-graybox-source-drift",
        "Godot graybox source bytes do not match the fixed manifest.",
      );
    }
    totalBytes += bytes;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumSourceBundleBytes) {
      return fail(
        "godot-graybox-source-invalid",
        "Godot graybox source bundle exceeds its aggregate byte boundary.",
      );
    }
    observedDescriptors.push(descriptor);
    sourceMap.set(file.path, file.text);
  }
  if (sourceDigestFor(observedDescriptors) !== manifest.sourceDigest) {
    return fail(
      "godot-graybox-source-drift",
      "Godot graybox source bundle identity does not match its manifest.",
    );
  }

  assertStaticStructure(sourceMap);
  const scenarioText = sourceMap.get(manifest.scenario.path);
  if (scenarioText === undefined) {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox scenario source is missing.",
    );
  }
  validateScenario(scenarioText);

  return Object.freeze({
    schemaVersion: "1.0.0" as const,
    projectId: manifest.projectId,
    engine: manifest.engine,
    mainScene: manifest.mainScene,
    scenarioDigest: manifest.scenario.digest,
    manifestDigest: GODOT_GRAYBOX_PROJECT_MANIFEST_DIGEST,
    sourceDigest: manifest.sourceDigest,
    fileCount: files.length,
    totalBytes,
    features: manifest.features,
    support: manifest.support,
  });
}

function rootRequest(value: unknown): VerifyGodotGrayboxProjectRootRequest {
  const record = dataRecord(
    value,
    ["root", "binding", "executable"],
    "godot-graybox-request-invalid",
    "Godot graybox root verification requires exact runtime identities.",
  );
  return Object.freeze({
    root: record["root"] as CanonicalProjectRoot,
    binding:
      record["binding"] as import("@ai-game-playbook/contracts").EngineExecutionSnapshotBinding,
    executable: record["executable"] as BoundProcessExecutable,
  });
}

async function readStableProjectText(
  root: CanonicalProjectRoot,
  path: string,
  maximumBytes: number,
): Promise<string> {
  let before;
  try {
    before = await resolveProjectPath(root, path, {
      existence: "required",
      expectedType: "file",
    });
  } catch {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source path is missing or unsafe.",
    );
  }
  let handle;
  try {
    handle = await open(before.absolutePath, "r");
  } catch {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source file could not be opened safely.",
    );
  }
  let bytes: Buffer | undefined;
  let readError: unknown;
  try {
    const first = await handle.stat({ bigint: true });
    const observed = await readFileHandleBounded(handle, maximumBytes);
    bytes = observed;
    const second = await handle.stat({ bigint: true });
    if (
      !first.isFile() ||
      !second.isFile() ||
      first.dev !== second.dev ||
      first.ino !== second.ino ||
      first.size !== second.size ||
      first.mtimeNs !== second.mtimeNs ||
      first.ctimeNs !== second.ctimeNs ||
      first.size !== BigInt(observed.byteLength)
    ) {
      return fail(
        "godot-graybox-source-drift",
        "Godot graybox source changed while it was read.",
      );
    }
  } catch (error) {
    readError = error;
  }
  try {
    await handle.close();
  } catch (error) {
    readError ??= error;
  }
  if (readError instanceof GodotAdapterBoundaryError) {
    throw readError;
  }
  if (readError !== undefined || bytes === undefined) {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source bytes could not be read and closed safely.",
    );
  }
  let after;
  try {
    after = await resolveProjectPath(root, path, {
      existence: "required",
      expectedType: "file",
    });
  } catch {
    return fail(
      "godot-graybox-source-drift",
      "Godot graybox source identity changed after it was read.",
    );
  }
  if (
    before.absolutePath !== after.absolutePath ||
    before.targetIdentity?.device !== after.targetIdentity?.device ||
    before.targetIdentity?.inode !== after.targetIdentity?.inode
  ) {
    return fail(
      "godot-graybox-source-drift",
      "Godot graybox source identity changed after it was read.",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail(
      "godot-graybox-source-invalid",
      "Godot graybox source is not valid UTF-8 text.",
    );
  }
}

function expectedSnapshotDirectories(
  paths: readonly string[],
): readonly string[] {
  const directories = new Set<string>([""]);
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return Object.freeze([...directories].sort(compareCanonicalText));
}

export async function verifyGodotGrayboxProjectRoot(
  value: unknown,
): Promise<GodotGrayboxProjectReport> {
  const request = rootRequest(value);
  try {
    await assertProjectRootIdentity(request.root);
  } catch {
    return fail(
      "godot-graybox-source-drift",
      "Godot graybox project root lost its runtime identity.",
    );
  }
  const manifestText = await readStableProjectText(
    request.root,
    "manifest.json",
    maximumManifestBytes,
  );
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestText);
  } catch {
    return fail(
      "godot-graybox-manifest-invalid",
      "Godot graybox manifest is not valid JSON.",
    );
  }
  const files = Object.freeze(
    await Promise.all(
      expectedFiles.map(async ({ path }) =>
        Object.freeze({
          path,
          text: await readStableProjectText(
            request.root,
            path,
            maximumSourceFileBytes,
          ),
        }),
      ),
    ),
  );
  const parsedManifest = manifest as GodotGrayboxProjectManifest;
  const report = verifyGodotGrayboxProjectBundle({
    manifest: parsedManifest,
    files,
  });
  const snapshotFiles = Object.freeze(
    [
      Object.freeze({
        path: "manifest.json",
        digest: sha256Digest(Buffer.from(manifestText, "utf8")),
        bytes: Buffer.byteLength(manifestText, "utf8"),
      }),
      ...parsedManifest.files.map(({ path, digest, bytes }) =>
        Object.freeze({ path, digest, bytes }),
      ),
    ].sort((left, right) => compareCanonicalText(left.path, right.path)),
  );
  try {
    await assertEngineExecutionSourceManifest({
      binding: request.binding,
      root: request.root,
      executable: request.executable,
      expected: {
        directories: expectedSnapshotDirectories(
          snapshotFiles.map(({ path }) => path),
        ),
        files: snapshotFiles,
      },
    });
  } catch {
    return fail(
      "godot-graybox-source-drift",
      "Godot graybox snapshot contains missing, changed, or undeclared source.",
    );
  }
  return report;
}
