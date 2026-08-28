import {
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  assertProcessContainmentProviderDescriptorSemantics,
  computeProcessContainmentProviderCatalogDigest,
  computeProcessContainmentProviderDescriptorDigest,
  digestCanonicalJson,
  sha256Digest,
  type ProcessContainmentProviderDescriptor,
  type ProcessContainmentProviderDescriptorDigestInput,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WindowsContainmentProviderError } from "./errors.js";

export const WINDOWS_CONTAINMENT_PROVIDER_ID: string =
  "process-containment.windows.appcontainer";
export const WINDOWS_CONTAINMENT_PROVIDER_VERSION: string = "0.1.0";
export const WINDOWS_CONTAINMENT_PROVIDER_MAX_ARTIFACT_BYTES: number =
  128 * 1024 * 1024;

export interface WindowsContainmentProviderRuntime {
  readonly schemaVersion: "1.0.0";
  readonly registration: "compiled";
  readonly dynamicRegistration: false;
  readonly descriptor: ProcessContainmentProviderDescriptor;
  readonly catalogDigest: Sha256Digest;
}

export interface CreateWindowsContainmentProviderRuntimeRequest {
  readonly artifactPath: unknown;
}

export interface WindowsContainmentProviderRuntimeAuthority {
  readonly artifactPath: string;
  readonly artifactDigest: Sha256Digest;
  readonly artifactBytes: number;
}

const runtimeAuthorities = new WeakMap<
  object,
  WindowsContainmentProviderRuntimeAuthority
>();

function fail(
  code:
    | "invalid-provider-artifact-request"
    | "provider-artifact-unavailable"
    | "provider-artifact-invalid"
    | "provider-artifact-drift"
    | "provider-runtime-invalid",
  message: string,
): never {
  throw new WindowsContainmentProviderError(code, message);
}

function exactArtifactPathRequest(
  value: CreateWindowsContainmentProviderRuntimeRequest,
): string {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return fail(
      "invalid-provider-artifact-request",
      "Provider artifact request must be one plain data object.",
    );
  }
  const names = Object.getOwnPropertyNames(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, "artifactPath");
  if (
    names.length !== 1 ||
    names[0] !== "artifactPath" ||
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0 ||
    descriptor.value.length > 32_767 ||
    descriptor.value.includes("\0") ||
    !isAbsolute(descriptor.value)
  ) {
    return fail(
      "invalid-provider-artifact-request",
      "Provider artifact path must be one bounded absolute path.",
    );
  }
  return descriptor.value;
}

async function inspectArtifact(
  requestedPath: string,
): Promise<WindowsContainmentProviderRuntimeAuthority> {
  const normalized = normalize(resolve(requestedPath));
  let canonical: string;
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(normalized);
    canonical = normalize(await realpath(normalized));
  } catch {
    return fail(
      "provider-artifact-unavailable",
      "Windows containment provider artifact is unavailable.",
    );
  }
  const samePath =
    process.platform === "win32"
      ? canonical.toLowerCase() === normalized.toLowerCase()
      : canonical === normalized;
  if (
    !samePath ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > WINDOWS_CONTAINMENT_PROVIDER_MAX_ARTIFACT_BYTES ||
    !canonical.toLowerCase().endsWith(".exe")
  ) {
    return fail(
      "provider-artifact-invalid",
      "Windows containment provider artifact is outside the fixed file boundary.",
    );
  }
  const content = await readFile(canonical);
  if (content.byteLength !== metadata.size) {
    return fail(
      "provider-artifact-drift",
      "Windows containment provider artifact changed while it was inspected.",
    );
  }
  if (!isWindowsX64PortableExecutable(content)) {
    return fail(
      "provider-artifact-invalid",
      "Windows containment provider artifact is not one Windows x64 executable.",
    );
  }
  return Object.freeze({
    artifactPath: canonical,
    artifactDigest: sha256Digest(content),
    artifactBytes: content.byteLength,
  });
}

function isWindowsX64PortableExecutable(content: Buffer): boolean {
  if (content.byteLength < 64 || content.readUInt16LE(0) !== 0x5a4d) {
    return false;
  }
  const peOffset = content.readUInt32LE(0x3c);
  return (
    peOffset <= content.byteLength - 24 &&
    content.readUInt32LE(peOffset) === 0x0000_4550 &&
    content.readUInt16LE(peOffset + 4) === 0x8664
  );
}

function createDescriptor(
  artifactDigest: Sha256Digest,
): ProcessContainmentProviderDescriptor {
  const closureManifestDigest = digestCanonicalJson({
    domain: "ai-game-playbook/windows-containment-provider-closure",
    version: "1.0.0",
    target: Object.freeze({ platform: "windows", architecture: "x64" }),
    artifacts: Object.freeze([
      Object.freeze({
        role: "entry-and-self-test",
        digest: artifactDigest,
      }),
    ]),
  });
  const input: ProcessContainmentProviderDescriptorDigestInput = Object.freeze({
    providerId: WINDOWS_CONTAINMENT_PROVIDER_ID,
    providerVersion: WINDOWS_CONTAINMENT_PROVIDER_VERSION,
    host: Object.freeze({ platform: "windows", architecture: "x64" }),
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    implementation: Object.freeze({
      entryArtifactDigest: artifactDigest,
      closureManifestDigest,
      selfTestArtifactDigest: artifactDigest,
    }),
    protocols: Object.freeze({ selfTest: "1.0.0", launch: "1.0.0" }),
    controls: Object.freeze({
      filesystem: Object.freeze({
        requirement: "deny-project-writes",
        enforcement: "os-enforced",
        selfTest: "required",
      }),
      network: Object.freeze({
        requirement: "deny",
        enforcement: "os-enforced",
        selfTest: "required",
      }),
      childProcesses: Object.freeze({
        requirement: "deny",
        enforcement: "os-enforced",
        selfTest: "required",
      }),
    }),
    selfTestSuiteDigest: PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  });
  const descriptor: ProcessContainmentProviderDescriptor = Object.freeze({
    schemaVersion: "1.0.0",
    ...input,
    descriptorDigest:
      computeProcessContainmentProviderDescriptorDigest(input),
  });
  assertProcessContainmentProviderDescriptorSemantics(descriptor);
  return descriptor;
}

export async function createWindowsContainmentProviderRuntime(
  request: CreateWindowsContainmentProviderRuntimeRequest,
): Promise<WindowsContainmentProviderRuntime> {
  const requestedPath = exactArtifactPathRequest(request);
  const authority = await inspectArtifact(requestedPath);
  const descriptor = createDescriptor(authority.artifactDigest);
  const runtime: WindowsContainmentProviderRuntime = Object.freeze({
    schemaVersion: "1.0.0",
    registration: "compiled",
    dynamicRegistration: false,
    descriptor,
    catalogDigest:
      computeProcessContainmentProviderCatalogDigest([descriptor]),
  });
  runtimeAuthorities.set(runtime, authority);
  return runtime;
}

export async function loadPackagedWindowsContainmentProviderRuntime(): Promise<WindowsContainmentProviderRuntime> {
  const artifactPath = fileURLToPath(
    new URL(
      "./native/win-x64/agpb-windows-containment.exe",
      import.meta.url,
    ),
  );
  return await createWindowsContainmentProviderRuntime({ artifactPath });
}

export function requireWindowsContainmentProviderRuntimeAuthority(
  runtime: WindowsContainmentProviderRuntime,
): WindowsContainmentProviderRuntimeAuthority {
  if (runtime === null || typeof runtime !== "object") {
    return fail(
      "provider-runtime-invalid",
      "Provider runtime was not created by this process.",
    );
  }
  const authority = runtimeAuthorities.get(runtime);
  if (authority === undefined) {
    return fail(
      "provider-runtime-invalid",
      "Provider runtime was not created by this process.",
    );
  }
  assertProcessContainmentProviderDescriptorSemantics(runtime.descriptor);
  if (
    runtime.registration !== "compiled" ||
    runtime.dynamicRegistration !== false ||
    runtime.descriptor.implementation.entryArtifactDigest !==
      authority.artifactDigest ||
    runtime.catalogDigest !==
      computeProcessContainmentProviderCatalogDigest([runtime.descriptor])
  ) {
    return fail(
      "provider-runtime-invalid",
      "Provider runtime no longer matches its same-process authority.",
    );
  }
  return authority;
}

export async function assertWindowsContainmentProviderArtifactIdentity(
  authority: WindowsContainmentProviderRuntimeAuthority,
): Promise<void> {
  const current = await inspectArtifact(authority.artifactPath);
  if (
    current.artifactDigest !== authority.artifactDigest ||
    current.artifactBytes !== authority.artifactBytes
  ) {
    return fail(
      "provider-artifact-drift",
      "Windows containment provider artifact identity changed.",
    );
  }
}
