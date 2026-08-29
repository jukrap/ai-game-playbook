import { isProxy } from "node:util/types";

import {
  canonicalizeJson,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  defineContractSchema,
  type JsonSchemaObject,
  type VersionedContractSchema,
} from "./contract-schema.js";
import {
  digestCanonicalJson,
  isSha256Digest,
  type Sha256Digest,
} from "./digest.js";
import {
  GODOT_DETERMINISTIC_REPLAY_IDLE_TIMEOUT_MS,
  GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
  GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
  GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
  GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
  GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
  GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS,
  GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS,
} from "./godot-deterministic-replay-contracts.js";
import {
  GODOT_HEADLESS_PREFLIGHT_IDLE_TIMEOUT_MS,
  GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
} from "./godot-headless-preflight-contracts.js";
import {
  closedObject,
  contractRoot,
  enumSchema,
  reference,
} from "./schema-fragments.js";
import { isStableId } from "./stable-id.js";

export const PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID =
  "godot-headless-preflight-v1" as const;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS = 30_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS = 10_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS = 2_000;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES = 262_144;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES = 1;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES = 1_024;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES = 1_024;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES =
  16_777_216;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES = 33_554_432;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES = 67_108_864;
export const PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS = 42_000;

export const GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_ID =
  "godot-deterministic-replay-v1" as const;
export const GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_MAX_REPORT_DURATION_MS: number =
  PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS +
  GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS +
  GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS;

export type ProcessContainmentEngineExecutionProfileId =
  | typeof GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_ID
  | typeof PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID;

export type ProcessContainmentEngineExecutionOperationId =
  | "engine.deterministic-replay"
  | "engine.headless-preflight";

export interface ProcessContainmentEngineExecutionProfileLaunch {
  readonly workingDirectory: "$stagedProject";
  readonly arguments: readonly string[];
  readonly callerArguments: "denied";
  readonly callerEnvironment: "denied";
  readonly networkCapabilities: "none";
  readonly projectSource: "disposable-copy";
}

export interface ProcessContainmentEngineExecutionProfileLimits {
  readonly startValidityMs: number;
  readonly processTimeoutMs: number;
  readonly idleTimeoutMs: number;
  readonly terminationGraceMs: number;
  readonly maxOutputBytes: number;
  readonly maxProcesses: number;
  readonly maxProjectFiles: number;
  readonly maxProjectDirectories: number;
  readonly maxProjectFileBytes: number;
  readonly maxProjectBytes: number;
  readonly maxProfileBytes: number;
  readonly maxReportDurationMs: number;
}

export interface ProcessContainmentEngineExecutionProfileOutput {
  readonly kind: "digest-only-log" | "prefixed-json-lines";
  readonly prefix: string | null;
  readonly maxLineBytes: number | null;
  readonly maxEvents: number | null;
  readonly retainRawOutput: false;
}

export interface ProcessContainmentEngineExecutionProfileDigestInput {
  readonly schemaVersion: "1.0.0";
  readonly profileId: ProcessContainmentEngineExecutionProfileId;
  readonly profileDigest: Sha256Digest;
  readonly engine: "godot";
  readonly operationId: ProcessContainmentEngineExecutionOperationId;
  readonly invocationDigest: Sha256Digest;
  readonly launch: ProcessContainmentEngineExecutionProfileLaunch;
  readonly limits: ProcessContainmentEngineExecutionProfileLimits;
  readonly output: ProcessContainmentEngineExecutionProfileOutput;
}

export interface ProcessContainmentEngineExecutionProfile
  extends ProcessContainmentEngineExecutionProfileDigestInput {
  readonly contractDigest: Sha256Digest;
}

const maximumProfileTreeNodes = 256;
const maximumProfileStringLength = 1_024;
const maximumProfileArrayLength = 32;

function reject(message: string): never {
  throw new TypeError(message);
}

function assertDataTree(
  value: unknown,
  path: string,
  depth: number,
  budget: { remaining: number },
): void {
  budget.remaining -= 1;
  if (budget.remaining < 0 || depth > 8) {
    reject("engine execution profile exceeds the bounded data shape");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return;
  }
  if (typeof value === "string") {
    if (
      value.length > maximumProfileStringLength ||
      /[\u0000-\u001f\u007f]/u.test(value)
    ) {
      reject(`${path} contains invalid text`);
    }
    return;
  }
  if (typeof value !== "object" || isProxy(value)) {
    reject(`${path} must contain plain data`);
  }
  if (Array.isArray(value)) {
    if (value.length > maximumProfileArrayLength) {
      reject(`${path} exceeds the array budget`);
    }
    const names = Object.getOwnPropertyNames(value);
    if (
      names.length !== value.length + 1 ||
      names.at(-1) !== "length"
    ) {
      reject(`${path} must be a dense data array`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        reject(`${path} must be a dense data array`);
      }
      assertDataTree(descriptor.value, `${path}[${index}]`, depth + 1, budget);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      reject(`${path} must not contain symbol fields`);
    }
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    reject(`${path} must contain plain data`);
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    if (
      name.length < 1 ||
      name.length > 64 ||
      /[\u0000-\u001f\u007f]/u.test(name)
    ) {
      reject(`${path} contains an invalid field name`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      reject(`${path} must contain enumerable data fields`);
    }
    assertDataTree(
      descriptor.value,
      `${path}.${name}`,
      depth + 1,
      budget,
    );
  }
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  message: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return reject(message);
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return reject(message);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function assertProfileDigestInput(
  input: ProcessContainmentEngineExecutionProfileDigestInput,
): void {
  assertDataTree(input, "$profile", 0, {
    remaining: maximumProfileTreeNodes,
  });
  const value = exactObject(
    input,
    [
      "schemaVersion",
      "profileId",
      "profileDigest",
      "engine",
      "operationId",
      "invocationDigest",
      "launch",
      "limits",
      "output",
    ],
    "engine execution profile digest input is outside the contract",
  );
  const launch = exactObject(
    value["launch"],
    [
      "workingDirectory",
      "arguments",
      "callerArguments",
      "callerEnvironment",
      "networkCapabilities",
      "projectSource",
    ],
    "engine execution profile launch is outside the contract",
  );
  const limits = exactObject(
    value["limits"],
    [
      "startValidityMs",
      "processTimeoutMs",
      "idleTimeoutMs",
      "terminationGraceMs",
      "maxOutputBytes",
      "maxProcesses",
      "maxProjectFiles",
      "maxProjectDirectories",
      "maxProjectFileBytes",
      "maxProjectBytes",
      "maxProfileBytes",
      "maxReportDurationMs",
    ],
    "engine execution profile limits are outside the contract",
  );
  const output = exactObject(
    value["output"],
    ["kind", "prefix", "maxLineBytes", "maxEvents", "retainRawOutput"],
    "engine execution profile output is outside the contract",
  );
  const argumentsValue = launch["arguments"];
  const processTimeoutMs = limits["processTimeoutMs"];
  const idleTimeoutMs = limits["idleTimeoutMs"];
  const terminationGraceMs = limits["terminationGraceMs"];
  const startValidityMs = limits["startValidityMs"];
  const maxOutputBytes = limits["maxOutputBytes"];
  const maxProfileBytes = limits["maxProfileBytes"];
  const maxReportDurationMs = limits["maxReportDurationMs"];

  if (
    value["schemaVersion"] !== "1.0.0" ||
    !isStableId(value["profileId"]) ||
    !isSha256Digest(value["profileDigest"]) ||
    value["engine"] !== "godot" ||
    !isStableId(value["operationId"]) ||
    !isSha256Digest(value["invocationDigest"]) ||
    launch["workingDirectory"] !== "$stagedProject" ||
    !Array.isArray(argumentsValue) ||
    argumentsValue.length < 1 ||
    argumentsValue.length > 16 ||
    argumentsValue.some(
      (argument) =>
        typeof argument !== "string" ||
        argument.length < 1 ||
        argument.length > 128,
    ) ||
    launch["callerArguments"] !== "denied" ||
    launch["callerEnvironment"] !== "denied" ||
    launch["networkCapabilities"] !== "none" ||
    launch["projectSource"] !== "disposable-copy" ||
    !integer(startValidityMs, 1, 60_000) ||
    !integer(processTimeoutMs, 1, 600_000) ||
    !integer(idleTimeoutMs, 1, 600_000) ||
    (idleTimeoutMs as number) > (processTimeoutMs as number) ||
    !integer(terminationGraceMs, 1, 30_000) ||
    !integer(maxOutputBytes, 1, 16_777_216) ||
    !integer(limits["maxProcesses"], 1, 16) ||
    !integer(limits["maxProjectFiles"], 1, 100_000) ||
    !integer(limits["maxProjectDirectories"], 1, 100_000) ||
    !integer(limits["maxProjectFileBytes"], 1, 1_073_741_824) ||
    !integer(limits["maxProjectBytes"], 1, 4_294_967_296) ||
    !integer(maxProfileBytes, 1, 4_294_967_296) ||
    (maxOutputBytes as number) > (maxProfileBytes as number) ||
    !integer(maxReportDurationMs, 1, 1_200_000) ||
    maxReportDurationMs !==
      (startValidityMs as number) +
        (processTimeoutMs as number) +
        (terminationGraceMs as number) ||
    output["retainRawOutput"] !== false
  ) {
    reject("engine execution profile digest input is outside the contract");
  }

  if (output["kind"] === "digest-only-log") {
    if (
      output["prefix"] !== null ||
      output["maxLineBytes"] !== null ||
      output["maxEvents"] !== null
    ) {
      reject("digest-only engine output must not declare a wire protocol");
    }
  } else if (output["kind"] === "prefixed-json-lines") {
    if (
      typeof output["prefix"] !== "string" ||
      output["prefix"].length < 1 ||
      output["prefix"].length > 64 ||
      !integer(output["maxLineBytes"], 1, maxOutputBytes as number) ||
      !integer(output["maxEvents"], 2, 8_192)
    ) {
      reject("prefixed engine output protocol is outside the contract");
    }
  } else {
    reject("engine execution profile output kind is outside the contract");
  }
}

function computeProfileContractDigest(
  input: ProcessContainmentEngineExecutionProfileDigestInput,
): Sha256Digest {
  assertProfileDigestInput(input);
  return digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-execution-profile",
    version: "1.0.0",
    profile: input,
  });
}

const preflightArguments: readonly string[] = Object.freeze([
  "--headless",
  "--path",
  "$stagedProject",
  "--quit-after",
  "1",
  "--log-file",
  "$profileLocalLog",
  "--no-header",
]);

const replayArguments: readonly string[] = Object.freeze([
  "--headless",
  "--path",
  "$stagedProject",
  "--log-file",
  "$profileLocalLog",
  "--no-header",
  "--",
  "--agpb-replay",
]);

export const PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-run-profile",
    version: "1.0.0",
    id: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
    engine: "godot",
    operationId: "engine.headless-preflight",
    invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
    arguments: preflightArguments,
    callerArguments: "denied",
    callerEnvironment: "denied",
    networkCapabilities: "none",
    projectSource: "disposable-copy",
  });

export const GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-run-profile",
    version: "1.0.0",
    id: GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_ID,
    engine: "godot",
    operationId: "engine.deterministic-replay",
    invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
    arguments: replayArguments,
    callerArguments: "denied",
    callerEnvironment: "denied",
    networkCapabilities: "none",
    projectSource: "disposable-copy",
  });

function createProfile(
  input: ProcessContainmentEngineExecutionProfileDigestInput,
): ProcessContainmentEngineExecutionProfile {
  return Object.freeze({
    ...input,
    contractDigest: computeProfileContractDigest(input),
  });
}

const commonStagingLimits = Object.freeze({
  startValidityMs: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_START_VALIDITY_MS,
  maxProcesses: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES,
  maxProjectFiles: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES,
  maxProjectDirectories:
    PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
  maxProjectFileBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
  maxProjectBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES,
  maxProfileBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES,
});

export const GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE: ProcessContainmentEngineExecutionProfile =
  createProfile(
    Object.freeze({
      schemaVersion: "1.0.0" as const,
      profileId: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
      profileDigest: PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
      engine: "godot" as const,
      operationId: "engine.headless-preflight" as const,
      invocationDigest: GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
      launch: Object.freeze({
        workingDirectory: "$stagedProject" as const,
        arguments: preflightArguments,
        callerArguments: "denied" as const,
        callerEnvironment: "denied" as const,
        networkCapabilities: "none" as const,
        projectSource: "disposable-copy" as const,
      }),
      limits: Object.freeze({
        ...commonStagingLimits,
        processTimeoutMs: PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS,
        idleTimeoutMs: GODOT_HEADLESS_PREFLIGHT_IDLE_TIMEOUT_MS,
        terminationGraceMs:
          PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS,
        maxOutputBytes: PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES,
        maxReportDurationMs:
          PROCESS_CONTAINMENT_ENGINE_RUN_MAX_REPORT_DURATION_MS,
      }),
      output: Object.freeze({
        kind: "digest-only-log" as const,
        prefix: null,
        maxLineBytes: null,
        maxEvents: null,
        retainRawOutput: false as const,
      }),
    }),
  );

export const GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE: ProcessContainmentEngineExecutionProfile =
  createProfile(
    Object.freeze({
      schemaVersion: "1.0.0" as const,
      profileId: GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_ID,
      profileDigest: GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_DIGEST,
      engine: "godot" as const,
      operationId: "engine.deterministic-replay" as const,
      invocationDigest: GODOT_DETERMINISTIC_REPLAY_INVOCATION_DIGEST,
      launch: Object.freeze({
        workingDirectory: "$stagedProject" as const,
        arguments: replayArguments,
        callerArguments: "denied" as const,
        callerEnvironment: "denied" as const,
        networkCapabilities: "none" as const,
        projectSource: "disposable-copy" as const,
      }),
      limits: Object.freeze({
        ...commonStagingLimits,
        processTimeoutMs: GODOT_DETERMINISTIC_REPLAY_PROCESS_TIMEOUT_MS,
        idleTimeoutMs: GODOT_DETERMINISTIC_REPLAY_IDLE_TIMEOUT_MS,
        terminationGraceMs:
          GODOT_DETERMINISTIC_REPLAY_TERMINATION_GRACE_MS,
        maxOutputBytes: GODOT_DETERMINISTIC_REPLAY_MAX_OUTPUT_BYTES,
        maxReportDurationMs:
          GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_MAX_REPORT_DURATION_MS,
      }),
      output: Object.freeze({
        kind: "prefixed-json-lines" as const,
        prefix: GODOT_DETERMINISTIC_REPLAY_OUTPUT_PREFIX,
        maxLineBytes: GODOT_DETERMINISTIC_REPLAY_MAX_LINE_BYTES,
        maxEvents: GODOT_DETERMINISTIC_REPLAY_MAX_EVENTS,
        retainRawOutput: false as const,
      }),
    }),
  );

export const PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES: readonly ProcessContainmentEngineExecutionProfile[] =
  Object.freeze([
    GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
    GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
  ]);

export const PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-engine-execution-profile-catalog",
    version: "1.0.0",
    profiles: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
      ({ profileId, contractDigest }) => ({ profileId, contractDigest }),
    ),
  });

export function getProcessContainmentEngineExecutionProfile(
  profileId: unknown,
): ProcessContainmentEngineExecutionProfile {
  if (profileId === GODOT_DETERMINISTIC_REPLAY_ENGINE_RUN_PROFILE_ID) {
    return GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE;
  }
  if (profileId === PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID) {
    return GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE;
  }
  return reject("engine execution profile is not registered");
}

function profileDigestInput(
  profile: ProcessContainmentEngineExecutionProfile,
): ProcessContainmentEngineExecutionProfileDigestInput {
  return Object.fromEntries(
    Object.entries(profile).filter(([key]) => key !== "contractDigest"),
  ) as unknown as ProcessContainmentEngineExecutionProfileDigestInput;
}

export function computeProcessContainmentEngineExecutionProfileContractDigest(
  input: ProcessContainmentEngineExecutionProfileDigestInput,
): Sha256Digest {
  assertProfileDigestInput(input);
  const registered = getProcessContainmentEngineExecutionProfile(
    (input as unknown as Record<string, unknown>)["profileId"],
  );
  if (canonicalizeJson(input) !== canonicalizeJson(profileDigestInput(registered))) {
    reject("engine execution profile digest input is not registered");
  }
  return computeProfileContractDigest(input);
}

export function assertProcessContainmentEngineExecutionProfileSemantics(
  profile: ProcessContainmentEngineExecutionProfile,
): void {
  assertDataTree(profile, "$profile", 0, {
    remaining: maximumProfileTreeNodes,
  });
  const value = exactObject(
    profile,
    [
      "schemaVersion",
      "profileId",
      "profileDigest",
      "engine",
      "operationId",
      "invocationDigest",
      "launch",
      "limits",
      "output",
      "contractDigest",
    ],
    "engine execution profile is outside the contract",
  );
  if (!isSha256Digest(value["contractDigest"])) {
    reject("engine execution profile contract digest is invalid");
  }
  const input = profileDigestInput(
    profile as ProcessContainmentEngineExecutionProfile,
  );
  if (
    value["contractDigest"] !==
    computeProcessContainmentEngineExecutionProfileContractDigest(input)
  ) {
    reject("engine execution profile contract digest does not attest the profile");
  }
  const registered = getProcessContainmentEngineExecutionProfile(
    value["profileId"],
  );
  if (canonicalizeJson(profile) !== canonicalizeJson(registered)) {
    reject("engine execution profile does not match the registered tuple");
  }
}

const launchSchema = closedObject(
  {
    workingDirectory: { type: "string", const: "$stagedProject" },
    arguments: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 128 },
      minItems: 1,
      maxItems: 16,
    },
    callerArguments: { type: "string", const: "denied" },
    callerEnvironment: { type: "string", const: "denied" },
    networkCapabilities: { type: "string", const: "none" },
    projectSource: { type: "string", const: "disposable-copy" },
  },
  [
    "workingDirectory",
    "arguments",
    "callerArguments",
    "callerEnvironment",
    "networkCapabilities",
    "projectSource",
  ],
);

const limitsSchema = closedObject(
  {
    startValidityMs: { type: "integer", minimum: 1, maximum: 60_000 },
    processTimeoutMs: { type: "integer", minimum: 1, maximum: 600_000 },
    idleTimeoutMs: { type: "integer", minimum: 1, maximum: 600_000 },
    terminationGraceMs: { type: "integer", minimum: 1, maximum: 30_000 },
    maxOutputBytes: { type: "integer", minimum: 1, maximum: 16_777_216 },
    maxProcesses: { type: "integer", minimum: 1, maximum: 16 },
    maxProjectFiles: { type: "integer", minimum: 1, maximum: 100_000 },
    maxProjectDirectories: {
      type: "integer",
      minimum: 1,
      maximum: 100_000,
    },
    maxProjectFileBytes: {
      type: "integer",
      minimum: 1,
      maximum: 1_073_741_824,
    },
    maxProjectBytes: {
      type: "integer",
      minimum: 1,
      maximum: 4_294_967_296,
    },
    maxProfileBytes: {
      type: "integer",
      minimum: 1,
      maximum: 4_294_967_296,
    },
    maxReportDurationMs: {
      type: "integer",
      minimum: 1,
      maximum: 1_200_000,
    },
  },
  [
    "startValidityMs",
    "processTimeoutMs",
    "idleTimeoutMs",
    "terminationGraceMs",
    "maxOutputBytes",
    "maxProcesses",
    "maxProjectFiles",
    "maxProjectDirectories",
    "maxProjectFileBytes",
    "maxProjectBytes",
    "maxProfileBytes",
    "maxReportDurationMs",
  ],
);

const outputSchema = closedObject(
  {
    kind: enumSchema(["digest-only-log", "prefixed-json-lines"]),
    prefix: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 64 },
        { type: "null" },
      ],
    },
    maxLineBytes: {
      anyOf: [
        { type: "integer", minimum: 1, maximum: 16_777_216 },
        { type: "null" },
      ],
    },
    maxEvents: {
      anyOf: [
        { type: "integer", minimum: 2, maximum: 8_192 },
        { type: "null" },
      ],
    },
    retainRawOutput: { type: "boolean", const: false },
  },
  ["kind", "prefix", "maxLineBytes", "maxEvents", "retainRawOutput"],
);

const profileProperties = {
  schemaVersion: { type: "string", const: "1.0.0" },
  profileId: reference("stableId"),
  profileDigest: reference("sha256Digest"),
  engine: { type: "string", const: "godot" },
  operationId: reference("stableId"),
  invocationDigest: reference("sha256Digest"),
  launch: launchSchema,
  limits: limitsSchema,
  output: outputSchema,
  contractDigest: reference("sha256Digest"),
};

function registeredProfileVariantSchema(
  profile: ProcessContainmentEngineExecutionProfile,
): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      profileId: { const: profile.profileId },
      profileDigest: { const: profile.profileDigest },
      engine: { const: profile.engine },
      operationId: { const: profile.operationId },
      invocationDigest: { const: profile.invocationDigest },
      launch: { const: profile.launch as unknown as CanonicalJsonValue },
      limits: { const: profile.limits as unknown as CanonicalJsonValue },
      output: { const: profile.output as unknown as CanonicalJsonValue },
      contractDigest: { const: profile.contractDigest },
    },
    required: [
      "profileId",
      "profileDigest",
      "engine",
      "operationId",
      "invocationDigest",
      "launch",
      "limits",
      "output",
      "contractDigest",
    ],
  };
}

export const processContainmentEngineExecutionProfileSchema: VersionedContractSchema =
  defineContractSchema({
    id: "process-containment-engine-execution-profile",
    version: "1.0.0",
    title: "Process containment engine execution profile",
    schema: {
      ...contractRoot(profileProperties, Object.keys(profileProperties)),
      oneOf: PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILES.map(
        registeredProfileVariantSchema,
      ),
    },
  });
