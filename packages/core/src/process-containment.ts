import {
  PROCESS_CONTAINMENT_POLICY_DIGEST,
  PROCESS_CONTAINMENT_REQUIREMENTS,
  assertProcessContainmentAssessmentReportSemantics,
  computeProcessContainmentAssessmentDigest,
  computeProcessContainmentRequestDigest,
  digestCanonicalJson,
  type ProcessContainmentAssessmentDigestInput,
  type ProcessContainmentAssessmentReport,
  type ProcessContainmentAssessmentRequest,
  type Sha256Digest,
} from "@ai-game-playbook/contracts";
import { randomUUID } from "node:crypto";

import { CoreBoundaryError } from "./errors.js";
import {
  assertProjectRootIdentity,
  type CanonicalProjectRoot,
} from "./project-path.js";

export interface AssessProcessContainmentRequest {
  readonly root: CanonicalProjectRoot;
}

interface ProcessContainmentWitnessAuthority {
  readonly root: CanonicalProjectRoot;
  readonly rootIdentityDigest: Sha256Digest;
  readonly policyDigest: Sha256Digest;
  readonly providerCatalogDigest: Sha256Digest;
  readonly assessmentDigest: Sha256Digest;
}

export const PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST: Sha256Digest =
  digestCanonicalJson({
    domain: "ai-game-playbook/process-containment-provider-catalog",
    version: "1.0.0",
    providers: [],
  });

const assessmentWitnesses = new WeakMap<
  object,
  ProcessContainmentWitnessAuthority
>();

function invalidRequest(message: string): never {
  throw new CoreBoundaryError(
    "invalid-process-containment-request",
    "$request",
    message,
  );
}

function witnessInvalid(message: string): never {
  throw new CoreBoundaryError(
    "process-containment-witness-invalid",
    "$assessment",
    message,
  );
}

function requestRoot(value: unknown): CanonicalProjectRoot {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    return invalidRequest("expected one plain request object");
  }

  const names = Object.getOwnPropertyNames(value);
  const descriptor = Object.getOwnPropertyDescriptor(value, "root");
  if (
    names.length !== 1 ||
    names[0] !== "root" ||
    descriptor === undefined ||
    !("value" in descriptor) ||
    descriptor.enumerable !== true
  ) {
    return invalidRequest(
      "only one enumerable root data property is accepted",
    );
  }
  return descriptor.value as CanonicalProjectRoot;
}

function contractPlatform(): "windows" | "linux" | "macos" {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    default:
      throw new CoreBoundaryError(
        "process-containment-host-unsupported",
        "$host.platform",
        "host platform has no containment contract",
      );
  }
}

function contractArchitecture(): "x64" | "arm64" {
  switch (process.arch) {
    case "x64":
      return "x64";
    case "arm64":
      return "arm64";
    default:
      throw new CoreBoundaryError(
        "process-containment-host-unsupported",
        "$host.architecture",
        "host architecture has no containment contract",
      );
  }
}

export async function assessProcessContainment(
  request: AssessProcessContainmentRequest,
): Promise<ProcessContainmentAssessmentReport> {
  const root = requestRoot(request);
  await assertProjectRootIdentity(root);

  const assessmentRequest: ProcessContainmentAssessmentRequest =
    Object.freeze({
      schemaVersion: "1.0.0",
      workload: "engine-project-process",
      projectRootIdentityDigest: root.identityDigest,
      policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
      requirements: PROCESS_CONTAINMENT_REQUIREMENTS,
    });

  const provider = Object.freeze({
    catalogDigest: PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
    status: "unavailable" as const,
    code: "process-containment-provider-unavailable" as const,
  });
  const controls = Object.freeze({
    filesystem: Object.freeze({
      requirement: "deny-project-writes" as const,
      status: "unavailable" as const,
    }),
    network: Object.freeze({
      requirement: "deny" as const,
      status: "unavailable" as const,
    }),
    childProcesses: Object.freeze({
      requirement: "deny" as const,
      status: "unavailable" as const,
    }),
  });
  const probe = Object.freeze({
    status: "not-run" as const,
    externalProcessStarted: false as const,
    mutationPerformed: false as const,
    networkAccessPerformed: false as const,
  });

  const digestInput: ProcessContainmentAssessmentDigestInput = Object.freeze({
    assessmentId: randomUUID(),
    requestDigest:
      computeProcessContainmentRequestDigest(assessmentRequest),
    projectRootIdentityDigest: root.identityDigest,
    workload: "engine-project-process",
    policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
    requirements: PROCESS_CONTAINMENT_REQUIREMENTS,
    platform: contractPlatform(),
    architecture: contractArchitecture(),
    provider,
    controls,
    probe,
    decision: "block",
    checkedAt: new Date().toISOString(),
    evidenceGrade: "implemented",
  });
  const report: ProcessContainmentAssessmentReport = Object.freeze({
    schemaVersion: "1.0.0",
    ...digestInput,
    assessmentDigest:
      computeProcessContainmentAssessmentDigest(digestInput),
  });

  assertProcessContainmentAssessmentReportSemantics(report);
  await assertProjectRootIdentity(root);
  assessmentWitnesses.set(
    report,
    Object.freeze({
      root,
      rootIdentityDigest: root.identityDigest,
      policyDigest: PROCESS_CONTAINMENT_POLICY_DIGEST,
      providerCatalogDigest:
        PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST,
      assessmentDigest: report.assessmentDigest,
    }),
  );
  return report;
}

export async function assertProcessContainmentAssessmentWitness(
  report: ProcessContainmentAssessmentReport,
  root: CanonicalProjectRoot,
): Promise<void> {
  if (report === null || typeof report !== "object") {
    return witnessInvalid(
      "assessment was not produced by this core runtime",
    );
  }
  const authority = assessmentWitnesses.get(report);
  if (
    authority === undefined ||
    authority.root !== root ||
    authority.rootIdentityDigest !== root.identityDigest ||
    authority.policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    authority.providerCatalogDigest !==
      PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST ||
    authority.assessmentDigest !== report.assessmentDigest
  ) {
    return witnessInvalid(
      "assessment and project root do not share same-process authority",
    );
  }

  await assertProjectRootIdentity(root);
  assertProcessContainmentAssessmentReportSemantics(report);
  if (
    report.projectRootIdentityDigest !== root.identityDigest ||
    report.policyDigest !== PROCESS_CONTAINMENT_POLICY_DIGEST ||
    report.provider.catalogDigest !==
      PROCESS_CONTAINMENT_PROVIDER_CATALOG_DIGEST
  ) {
    return witnessInvalid(
      "assessment no longer matches its root, policy, or provider catalog",
    );
  }
  await assertProjectRootIdentity(root);
}
