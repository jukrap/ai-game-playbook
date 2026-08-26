import type { PackManifest } from "@ai-game-playbook/contracts";
import type { CanonicalProjectRoot } from "@ai-game-playbook/core";
import type { ValidatedRegistry } from "@ai-game-playbook/registry";

import { PackRuntimeError } from "./errors.js";
import type { LoadedInstalledPackState } from "./state.js";
import type { PreparedPackOperation } from "./types.js";

export interface PreparedArtifactContent {
  readonly target: string;
  readonly content: Uint8Array;
}

export interface PreparedPackOperationInternals {
  readonly registry: ValidatedRegistry;
  readonly targetRoot: CanonicalProjectRoot;
  readonly sourceRoot?: CanonicalProjectRoot;
  readonly manifest?: PackManifest;
  readonly installed: LoadedInstalledPackState;
  readonly sourceArtifacts: readonly PreparedArtifactContent[];
  readonly preimages: readonly PreparedArtifactContent[];
}

const preparedInstances = new WeakSet<object>();
const preparedInternals = new WeakMap<
  object,
  PreparedPackOperationInternals
>();

export function registerPreparedPackOperation(
  plan: PreparedPackOperation,
  internals: PreparedPackOperationInternals,
): PreparedPackOperation {
  preparedInstances.add(plan);
  preparedInternals.set(plan, internals);
  return plan;
}

export function assertPreparedPackOperation(
  value: unknown,
): asserts value is PreparedPackOperation {
  if (
    value === null ||
    typeof value !== "object" ||
    !preparedInstances.has(value)
  ) {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      "$plan",
      "pack plan must be prepared by this runtime process",
    );
  }
}

export function internalsForPreparedPackOperation(
  plan: PreparedPackOperation,
): PreparedPackOperationInternals {
  assertPreparedPackOperation(plan);
  const internals = preparedInternals.get(plan);
  if (internals === undefined) {
    throw new PackRuntimeError(
      "pack-plan-untrusted",
      "$plan",
      "prepared pack plan internals are unavailable",
    );
  }
  return internals;
}
