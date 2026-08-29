import {
  ENGINE_OPERATION_KINDS,
  isSha256Digest,
  parseSemanticVersion,
  type EngineId,
  type EngineOperationKind,
  type EngineOperationRequest,
  type EngineOperationResult,
  type SemanticVersion,
} from "@ai-game-playbook/contracts";
import { isProxy } from "node:util/types";

import {
  EngineCommonBoundaryError,
  type EngineCommonBoundaryErrorCode,
} from "./errors.js";

export const ENGINE_ADAPTER_PROTOCOL_VERSION = "1.0.0" as SemanticVersion;

export type EngineAdapterMethodName =
  | "detect"
  | "negotiate"
  | "inspect"
  | "mutate"
  | "save"
  | "compileOrImport"
  | "test"
  | "play"
  | "inputReplay"
  | "logs"
  | "capture"
  | "profile"
  | "buildOrExport"
  | "rollback";

export interface EngineAdapterOperationBinding {
  readonly operation: EngineOperationKind;
  readonly method: EngineAdapterMethodName;
}

export const ENGINE_ADAPTER_OPERATION_BINDINGS: readonly EngineAdapterOperationBinding[] =
  Object.freeze([
    Object.freeze({ operation: "detect", method: "detect" }),
    Object.freeze({ operation: "negotiate", method: "negotiate" }),
    Object.freeze({ operation: "inspect", method: "inspect" }),
    Object.freeze({ operation: "mutate", method: "mutate" }),
    Object.freeze({ operation: "save", method: "save" }),
    Object.freeze({
      operation: "compile-import",
      method: "compileOrImport",
    }),
    Object.freeze({ operation: "test", method: "test" }),
    Object.freeze({ operation: "play", method: "play" }),
    Object.freeze({ operation: "input-replay", method: "inputReplay" }),
    Object.freeze({ operation: "logs", method: "logs" }),
    Object.freeze({ operation: "capture", method: "capture" }),
    Object.freeze({ operation: "profile", method: "profile" }),
    Object.freeze({ operation: "build-export", method: "buildOrExport" }),
    Object.freeze({ operation: "rollback", method: "rollback" }),
  ]);

export interface EngineAdapterIdentity {
  readonly id: EngineId;
  readonly version: SemanticVersion;
  readonly protocolVersion: typeof ENGINE_ADAPTER_PROTOCOL_VERSION;
}

export interface EngineAdapterInvocation {
  readonly request: EngineOperationRequest;
  readonly signal: AbortSignal;
}

export type EngineAdapterOperation = (
  invocation: EngineAdapterInvocation,
) => Promise<EngineOperationResult>;

export interface EngineAdapterOperations {
  readonly detect: EngineAdapterOperation;
  readonly negotiate: EngineAdapterOperation;
  readonly inspect: EngineAdapterOperation;
  readonly mutate: EngineAdapterOperation;
  readonly save: EngineAdapterOperation;
  readonly compileOrImport: EngineAdapterOperation;
  readonly test: EngineAdapterOperation;
  readonly play: EngineAdapterOperation;
  readonly inputReplay: EngineAdapterOperation;
  readonly logs: EngineAdapterOperation;
  readonly capture: EngineAdapterOperation;
  readonly profile: EngineAdapterOperation;
  readonly buildOrExport: EngineAdapterOperation;
  readonly rollback: EngineAdapterOperation;
}

export interface EngineAdapter extends EngineAdapterOperations {
  readonly identity: EngineAdapterIdentity;
}

export interface CreateEngineAdapterRequest {
  readonly identity: EngineAdapterIdentity;
  readonly operations: EngineAdapterOperations;
}

const operationToMethod = new Map<
  EngineOperationKind,
  EngineAdapterMethodName
>(
  ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ operation, method }) => [
    operation,
    method,
  ]),
);
const adapterAuthorities = new WeakSet<object>();
const maximumPlainDataDepth = 32;
const maximumPlainDataNodes = 100_000;

function fail(code: EngineCommonBoundaryErrorCode, message: string): never {
  throw new EngineCommonBoundaryError(code, message);
}

function exactDataRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return undefined;
  }
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.length || keys.some((key) => !names.includes(key))) {
    return undefined;
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function engineId(value: unknown): value is EngineId {
  return value === "godot" || value === "unity" || value === "unreal";
}

function adapterIdentity(value: unknown): EngineAdapterIdentity {
  const record = exactDataRecord(value, ["id", "version", "protocolVersion"]);
  if (
    record === undefined ||
    !engineId(record["id"]) ||
    record["protocolVersion"] !== ENGINE_ADAPTER_PROTOCOL_VERSION
  ) {
    return fail(
      "engine-adapter-definition-invalid",
      "Engine adapter identity must use one exact supported engine and protocol.",
    );
  }
  let version: SemanticVersion;
  try {
    version = parseSemanticVersion(record["version"], "$adapter.version").value;
  } catch {
    return fail(
      "engine-adapter-definition-invalid",
      "Engine adapter identity requires one canonical semantic version.",
    );
  }
  return Object.freeze({
    id: record["id"],
    version,
    protocolVersion: ENGINE_ADAPTER_PROTOCOL_VERSION,
  });
}

function adapterOperations(value: unknown): EngineAdapterOperations {
  const methodNames = ENGINE_ADAPTER_OPERATION_BINDINGS.map(
    ({ method }) => method,
  );
  const record = exactDataRecord(value, methodNames);
  if (
    record === undefined ||
    methodNames.some(
      (method) =>
        typeof record[method] !== "function" || isProxy(record[method]),
    )
  ) {
    return fail(
      "engine-adapter-definition-invalid",
      "Engine adapter must provide every common operation exactly once.",
    );
  }
  return record as unknown as EngineAdapterOperations;
}

interface PlainDataState {
  nodes: number;
  readonly active: Set<object>;
}

function clonePlainData(
  value: unknown,
  state: PlainDataState,
  depth: number,
): unknown {
  state.nodes += 1;
  if (state.nodes > maximumPlainDataNodes || depth > maximumPlainDataDepth) {
    return fail(
      "engine-adapter-invocation-invalid",
      "Engine adapter data exceeds its structural boundary.",
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return fail(
        "engine-adapter-invocation-invalid",
        "Engine adapter data contains an unsupported numeric value.",
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    return fail(
      "engine-adapter-invocation-invalid",
      "Engine adapter data must contain plain JSON-compatible values.",
    );
  }
  if (isProxy(value)) {
    return fail(
      "engine-adapter-invocation-invalid",
      "Engine adapter data must not contain proxy objects.",
    );
  }
  if (state.active.has(value)) {
    return fail(
      "engine-adapter-invocation-invalid",
      "Engine adapter data must not contain cycles.",
    );
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertySymbols(value).length > 0 ||
        Object.getOwnPropertyNames(value).some(
          (name) =>
            name !== "length" &&
            (!/^(?:0|[1-9][0-9]*)$/u.test(name) ||
              Number(name) >= value.length),
        )
      ) {
        return fail(
          "engine-adapter-invocation-invalid",
          "Engine adapter arrays must be dense plain data.",
        );
      }
      const copy: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          return fail(
            "engine-adapter-invocation-invalid",
            "Engine adapter arrays must not contain holes or accessors.",
          );
        }
        copy.push(clonePlainData(descriptor.value, state, depth + 1));
      }
      return Object.freeze(copy);
    }
    if (
      (Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length > 0
    ) {
      return fail(
        "engine-adapter-invocation-invalid",
        "Engine adapter objects must be plain data records.",
      );
    }
    const copy: Record<string, unknown> = {};
    for (const name of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return fail(
          "engine-adapter-invocation-invalid",
          "Engine adapter objects must not contain hidden values or accessors.",
        );
      }
      Object.defineProperty(copy, name, {
        value: clonePlainData(descriptor.value, state, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(copy);
  } finally {
    state.active.delete(value);
  }
}

function plainDataCopy<T>(value: T): T {
  return clonePlainData(
    value,
    { nodes: 0, active: new Set<object>() },
    0,
  ) as T;
}

function operationRequest(value: unknown): EngineOperationRequest {
  const copied = plainDataCopy(value);
  if (
    copied === null ||
    typeof copied !== "object" ||
    Array.isArray(copied)
  ) {
    return fail(
      "engine-adapter-operation-invalid",
      "Engine adapter dispatch requires one operation request record.",
    );
  }
  const copy = copied as EngineOperationRequest;
  const operation = copy.operation;
  if (
    !ENGINE_OPERATION_KINDS.includes(operation) ||
    typeof copy.requestId !== "string" ||
    !isSha256Digest(copy.projectIdentityDigest) ||
    (copy.sessionIdentityDigest !== undefined &&
      !isSha256Digest(copy.sessionIdentityDigest))
  ) {
    return fail(
      "engine-adapter-operation-invalid",
      "Engine adapter dispatch requires a correlated engine operation request.",
    );
  }
  return copy;
}

function invocation(value: unknown): EngineAdapterInvocation {
  const record = exactDataRecord(value, ["request", "signal"]);
  if (
    record === undefined ||
    isProxy(record["signal"]) ||
    !(record["signal"] instanceof AbortSignal)
  ) {
    return fail(
      "engine-adapter-invocation-invalid",
      "Engine adapter invocation requires one request and AbortSignal.",
    );
  }
  return Object.freeze({
    request: operationRequest(record["request"]),
    signal: record["signal"],
  });
}

function correlatedResult(
  request: EngineOperationRequest,
  value: unknown,
): EngineOperationResult {
  let result: EngineOperationResult;
  try {
    const copied = plainDataCopy(value);
    if (
      copied === null ||
      typeof copied !== "object" ||
      Array.isArray(copied)
    ) {
      return fail(
        "engine-adapter-result-mismatch",
        "Engine adapter result must be one contract data record.",
      );
    }
    result = copied as EngineOperationResult;
  } catch (error) {
    if (error instanceof EngineCommonBoundaryError) {
      throw new EngineCommonBoundaryError(
        "engine-adapter-result-mismatch",
        "Engine adapter result is not safe plain contract data.",
      );
    }
    throw error;
  }
  if (
    result.requestId !== request.requestId ||
    result.operation !== request.operation ||
    result.projectIdentityDigest !== request.projectIdentityDigest ||
    result.sessionIdentityDigest !== request.sessionIdentityDigest
  ) {
    return fail(
      "engine-adapter-result-mismatch",
      "Engine adapter result does not match the admitted request identity.",
    );
  }
  return result;
}

export function createEngineAdapter(
  value: CreateEngineAdapterRequest,
): EngineAdapter;
export function createEngineAdapter(value: unknown): EngineAdapter {
  const record = exactDataRecord(value, ["identity", "operations"]);
  if (record === undefined) {
    return fail(
      "engine-adapter-definition-invalid",
      "Engine adapter creation requires one exact definition.",
    );
  }
  const identity = adapterIdentity(record["identity"]);
  const operations = adapterOperations(record["operations"]);
  const adapter = Object.freeze({
    identity,
    ...Object.fromEntries(
      ENGINE_ADAPTER_OPERATION_BINDINGS.map(({ method }) => [
        method,
        operations[method],
      ]),
    ),
  }) as unknown as EngineAdapter;
  adapterAuthorities.add(adapter);
  return adapter;
}

export function assertEngineAdapterAuthority(
  value: unknown,
): asserts value is EngineAdapter {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    !adapterAuthorities.has(value)
  ) {
    return fail(
      "engine-adapter-authority-invalid",
      "Engine adapter authority is missing, copied, or from another process.",
    );
  }
}

export function dispatchEngineAdapterOperation(
  adapter: EngineAdapter,
  value: EngineAdapterInvocation,
): Promise<EngineOperationResult>;
export async function dispatchEngineAdapterOperation(
  adapter: unknown,
  value: unknown,
): Promise<EngineOperationResult> {
  assertEngineAdapterAuthority(adapter);
  const admitted = invocation(value);
  if (admitted.signal.aborted) {
    return fail(
      "engine-adapter-cancelled-before-start",
      "Engine adapter invocation was cancelled before its operation started.",
    );
  }
  const method = operationToMethod.get(admitted.request.operation);
  if (method === undefined) {
    return fail(
      "engine-adapter-operation-invalid",
      "Engine adapter operation is outside the common lifecycle.",
    );
  }
  if (admitted.signal.aborted) {
    return fail(
      "engine-adapter-cancelled-before-start",
      "Engine adapter invocation was cancelled before its operation started.",
    );
  }
  const result = await adapter[method](admitted);
  return correlatedResult(admitted.request, result);
}
