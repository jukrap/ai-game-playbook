import {
  PROCESS_CONTAINMENT_ENGINE_ADMISSION_MAX_VALIDITY_MS,
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  assertProcessContainmentEngineAdmissionSemantics,
  computeProcessContainmentEngineAdmissionDigest,
  isSha256Digest,
  isStableId,
  type EngineExecutionSnapshotBinding,
  type ProcessContainmentEngineAdmission,
  type ProcessContainmentEngineAdmissionDigestInput,
  type Sha256Digest,
  type StableId,
} from "@ai-game-playbook/contracts";
import {
  type BoundProcessExecutable,
  type CanonicalProjectRoot,
} from "@ai-game-playbook/core";
import { assertEngineExecutionSnapshotAuthority } from "@ai-game-playbook/engine-common";
import { randomUUID } from "node:crypto";

import {
  assertWindowsContainmentProviderArtifactIdentity,
  requireWindowsContainmentProviderRuntimeAuthority,
  type WindowsContainmentProviderRuntime,
} from "./artifact.js";
import { WindowsContainmentProviderError } from "./errors.js";
import {
  assertWindowsContainedSyntheticLaunchWitness,
  claimWindowsContainedSyntheticLaunchWitnessForEngineAdmission,
  type WindowsContainedSyntheticLaunchWitness,
} from "./launch.js";

export interface CreateWindowsContainedEngineAdmissionRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly operationId: unknown;
  readonly invocationDigest: unknown;
}

export interface AssertWindowsContainedEngineAdmissionRequest {
  readonly admission: ProcessContainmentEngineAdmission;
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly operationId: unknown;
  readonly invocationDigest: unknown;
}

interface ParsedCreationRequest {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly launchWitness: WindowsContainedSyntheticLaunchWitness;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly operationId: StableId;
  readonly invocationDigest: Sha256Digest;
}

interface ParsedAssertionRequest {
  readonly admission: ProcessContainmentEngineAdmission;
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly operationId: StableId;
  readonly invocationDigest: Sha256Digest;
}

interface AdmissionAuthority {
  readonly runtime: WindowsContainmentProviderRuntime;
  readonly binding: EngineExecutionSnapshotBinding;
  readonly root: CanonicalProjectRoot;
  readonly executable: BoundProcessExecutable;
  readonly operationId: StableId;
  readonly invocationDigest: Sha256Digest;
  dispatchClaimed: boolean;
}

const admissionAuthorities = new WeakMap<object, AdmissionAuthority>();

function fail(
  code:
    | "provider-host-unsupported"
    | "invalid-engine-admission-request"
    | "engine-admission-invalid"
    | "engine-admission-expired"
    | "engine-admission-consumed",
  message: string,
): never {
  throw new WindowsContainmentProviderError(code, message);
}

function exactRecord(
  value: unknown,
  names: readonly string[],
  message: string,
): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail("invalid-engine-admission-request", message);
  }
  const actualNames = Object.getOwnPropertyNames(value);
  if (
    actualNames.length !== names.length ||
    !names.every((name) => actualNames.includes(name))
  ) {
    return fail("invalid-engine-admission-request", message);
  }
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      return fail("invalid-engine-admission-request", message);
    }
  }
  return value as Record<string, unknown>;
}

function operationBinding(
  value: Record<string, unknown>,
): { readonly operationId: StableId; readonly invocationDigest: Sha256Digest } {
  const operationId = value["operationId"];
  const invocationDigest = value["invocationDigest"];
  if (!isStableId(operationId) || !isSha256Digest(invocationDigest)) {
    return fail(
      "invalid-engine-admission-request",
      "Engine admission requires one stable operation and invocation digest.",
    );
  }
  return Object.freeze({ operationId, invocationDigest });
}

function creationRequest(value: unknown): ParsedCreationRequest {
  const record = exactRecord(
    value,
    [
      "runtime",
      "launchWitness",
      "binding",
      "root",
      "executable",
      "operationId",
      "invocationDigest",
    ],
    "Engine admission creation contains undeclared fields.",
  );
  const operation = operationBinding(record);
  return Object.freeze({
    runtime: record["runtime"] as WindowsContainmentProviderRuntime,
    launchWitness:
      record["launchWitness"] as WindowsContainedSyntheticLaunchWitness,
    binding: record["binding"] as EngineExecutionSnapshotBinding,
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
    ...operation,
  });
}

function assertionRequest(value: unknown): ParsedAssertionRequest {
  const record = exactRecord(
    value,
    [
      "admission",
      "runtime",
      "binding",
      "root",
      "executable",
      "operationId",
      "invocationDigest",
    ],
    "Engine admission assertion contains undeclared fields.",
  );
  const operation = operationBinding(record);
  return Object.freeze({
    admission: record["admission"] as ProcessContainmentEngineAdmission,
    runtime: record["runtime"] as WindowsContainmentProviderRuntime,
    binding: record["binding"] as EngineExecutionSnapshotBinding,
    root: record["root"] as CanonicalProjectRoot,
    executable: record["executable"] as BoundProcessExecutable,
    ...operation,
  });
}

function requireHost(runtime: WindowsContainmentProviderRuntime): void {
  if (
    process.platform !== "win32" ||
    process.arch !== "x64" ||
    runtime.descriptor.host.platform !== "windows" ||
    runtime.descriptor.host.architecture !== "x64"
  ) {
    return fail(
      "provider-host-unsupported",
      "Windows x64 is required for an engine containment admission.",
    );
  }
}

async function assertExactRuntimeIdentities(
  request:
    | ParsedCreationRequest
    | ParsedAssertionRequest,
): Promise<void> {
  const runtimeAuthority =
    requireWindowsContainmentProviderRuntimeAuthority(request.runtime);
  requireHost(request.runtime);
  await assertWindowsContainmentProviderArtifactIdentity(runtimeAuthority);
  await assertEngineExecutionSnapshotAuthority({
    binding: request.binding,
    root: request.root,
    executable: request.executable,
  });
}

function admissionMismatch(
  admission: ProcessContainmentEngineAdmission,
  request: ParsedAssertionRequest,
): boolean {
  return (
    admission.providerDescriptorDigest !==
      request.runtime.descriptor.descriptorDigest ||
    admission.providerCatalogDigest !== request.runtime.catalogDigest ||
    admission.host.platform !== "windows" ||
    admission.host.architecture !== "x64" ||
    admission.engine !== request.binding.engine ||
    admission.workload !== "engine-project-process" ||
    admission.policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    admission.operationId !== request.operationId ||
    admission.invocationDigest !== request.invocationDigest ||
    admission.snapshotBindingDigest !== request.binding.bindingDigest ||
    admission.projectRootIdentityDigest !== request.root.identityDigest ||
    admission.projectRootIdentityDigest !==
      request.binding.project.projectRootIdentityDigest ||
    admission.projectSnapshotDigest !== request.binding.project.snapshotDigest ||
    admission.executableSnapshotDigest !==
      request.binding.executable.snapshotDigest
  );
}

async function requireAdmissionAuthority(
  request: ParsedAssertionRequest,
): Promise<AdmissionAuthority> {
  const authority =
    request.admission !== null && typeof request.admission === "object"
      ? admissionAuthorities.get(request.admission)
      : undefined;
  if (
    authority === undefined ||
    authority.runtime !== request.runtime ||
    authority.binding !== request.binding ||
    authority.root !== request.root ||
    authority.executable !== request.executable ||
    authority.operationId !== request.operationId ||
    authority.invocationDigest !== request.invocationDigest
  ) {
    return fail(
      "engine-admission-invalid",
      "Engine admission was not created for these exact runtime identities.",
    );
  }
  if (authority.dispatchClaimed) {
    return fail(
      "engine-admission-consumed",
      "Engine admission was already claimed by a dispatch.",
    );
  }
  try {
    assertProcessContainmentEngineAdmissionSemantics(request.admission);
  } catch {
    return fail(
      "engine-admission-invalid",
      "Engine admission no longer matches its contract digest.",
    );
  }
  if (admissionMismatch(request.admission, request)) {
    return fail(
      "engine-admission-invalid",
      "Engine admission no longer matches its bound operation or snapshots.",
    );
  }
  if (Date.now() >= Date.parse(request.admission.expiresAt)) {
    return fail("engine-admission-expired", "Engine admission has expired.");
  }
  await assertExactRuntimeIdentities(request);
  if (Date.now() >= Date.parse(request.admission.expiresAt)) {
    return fail(
      "engine-admission-expired",
      "Engine admission expired while its identities were revalidated.",
    );
  }
  return authority;
}

export async function createWindowsContainedEngineAdmission(
  value: unknown,
): Promise<ProcessContainmentEngineAdmission> {
  const request = creationRequest(value);
  assertWindowsContainedSyntheticLaunchWitness(request.launchWitness);
  await assertExactRuntimeIdentities(request);
  if (
    request.launchWitness.providerDescriptorDigest !==
      request.runtime.descriptor.descriptorDigest ||
    request.launchWitness.providerCatalogDigest !== request.runtime.catalogDigest ||
    request.launchWitness.projectRootIdentityDigest !== request.root.identityDigest ||
    request.binding.project.projectRootIdentityDigest !== request.root.identityDigest ||
    request.binding.executable.executableDigest !== request.executable.digest ||
    request.binding.executable.executableIdentityDigest !==
      request.executable.identityDigest
  ) {
    return fail(
      "engine-admission-invalid",
      "Qualification, project, executable, and snapshot identities do not match.",
    );
  }
  const issuedMs = Date.now();
  const expiresMs = Math.min(
    issuedMs + PROCESS_CONTAINMENT_ENGINE_ADMISSION_MAX_VALIDITY_MS,
    Date.parse(request.launchWitness.expiresAt),
  );
  if (expiresMs - issuedMs < 1) {
    return fail(
      "engine-admission-expired",
      "Contained launch qualification expired before admission creation.",
    );
  }
  const input: ProcessContainmentEngineAdmissionDigestInput = Object.freeze({
    admissionId: randomUUID(),
    providerDescriptorDigest: request.runtime.descriptor.descriptorDigest,
    providerCatalogDigest: request.runtime.catalogDigest,
    host: Object.freeze({ platform: "windows", architecture: "x64" }),
    engine: request.binding.engine,
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    qualification: Object.freeze({
      syntheticLaunchRequestDigest: request.launchWitness.requestDigest,
      syntheticLaunchReportDigest: request.launchWitness.reportDigest,
      expiresAt: request.launchWitness.expiresAt,
    }),
    operationId: request.operationId,
    invocationDigest: request.invocationDigest,
    snapshotBindingDigest: request.binding.bindingDigest,
    projectRootIdentityDigest: request.root.identityDigest,
    projectSnapshotDigest: request.binding.project.snapshotDigest,
    executableSnapshotDigest: request.binding.executable.snapshotDigest,
    issuedAt: new Date(issuedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    decision: "qualified",
    evidenceGrade: "locally-executed",
  });
  const admission: ProcessContainmentEngineAdmission = Object.freeze({
    schemaVersion: "1.0.0",
    ...input,
    admissionDigest: computeProcessContainmentEngineAdmissionDigest(input),
  });
  assertProcessContainmentEngineAdmissionSemantics(admission);
  const qualification =
    claimWindowsContainedSyntheticLaunchWitnessForEngineAdmission(
      request.launchWitness,
      request.runtime,
      request.root.identityDigest,
    );
  if (
    qualification.requestDigest !==
      admission.qualification.syntheticLaunchRequestDigest ||
    qualification.reportDigest !==
      admission.qualification.syntheticLaunchReportDigest ||
    qualification.expiresAt !== admission.qualification.expiresAt
  ) {
    return fail(
      "engine-admission-invalid",
      "Contained launch authority changed during admission creation.",
    );
  }
  admissionAuthorities.set(admission, {
    runtime: request.runtime,
    binding: request.binding,
    root: request.root,
    executable: request.executable,
    operationId: request.operationId,
    invocationDigest: request.invocationDigest,
    dispatchClaimed: false,
  });
  return admission;
}

export async function assertWindowsContainedEngineAdmission(
  value: unknown,
): Promise<void> {
  await requireAdmissionAuthority(assertionRequest(value));
}

export async function claimWindowsContainedEngineAdmissionForDispatch(
  value: unknown,
): Promise<void> {
  const request = assertionRequest(value);
  const authority = await requireAdmissionAuthority(request);
  if (authority.dispatchClaimed) {
    return fail(
      "engine-admission-consumed",
      "Engine admission was already claimed by a dispatch.",
    );
  }
  authority.dispatchClaimed = true;
}
