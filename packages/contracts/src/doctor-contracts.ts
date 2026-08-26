import { defineContractSchema, type VersionedContractSchema } from "./contract-schema.js";
import type { SemanticVersion } from "./semantic-version.js";
import type { Sha256Digest } from "./digest.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { StableId } from "./stable-id.js";

export type DoctorCheckStatus = "passed" | "warning" | "blocked" | "skipped";
export type DoctorStatus = "healthy" | "attention" | "blocked";
export type DoctorProjectState =
  | "unavailable"
  | "uninitialized"
  | "incomplete"
  | "ready";

export interface DoctorRequest {
  readonly schemaVersion: SemanticVersion;
  readonly projectRoot: string;
}

export interface DoctorCheck {
  readonly id: StableId;
  readonly status: DoctorCheckStatus;
  readonly code: StableId;
  readonly message: string;
  readonly nextAction?: string;
}

export interface DoctorProjectSummary {
  readonly requestedPath: string;
  readonly canonicalPath?: string;
  readonly identityDigest?: Sha256Digest;
  readonly state: DoctorProjectState;
}

export interface DoctorReport {
  readonly schemaVersion: SemanticVersion;
  readonly commandId: "doctor";
  readonly status: DoctorStatus;
  readonly controlPlaneVersion: SemanticVersion;
  readonly registryDigest: Sha256Digest;
  readonly project: DoctorProjectSummary;
  readonly checks: readonly DoctorCheck[];
}

export const DOCTOR_CHECK_STATUSES: readonly DoctorCheckStatus[] = Object.freeze([
  "passed",
  "warning",
  "blocked",
  "skipped",
]);

export function computeDoctorStatus(
  checks: readonly Pick<DoctorCheck, "status">[],
): DoctorStatus {
  if (checks.length > 32) {
    throw new RangeError("doctor check count exceeds the report contract");
  }
  let warning = false;
  for (const check of checks) {
    if (!DOCTOR_CHECK_STATUSES.includes(check.status)) {
      throw new TypeError("doctor check status is invalid");
    }
    if (check.status === "blocked") {
      return "blocked";
    }
    warning ||= check.status === "warning";
  }
  return warning ? "attention" : "healthy";
}

const localPath = {
  type: "string",
  minLength: 1,
  maxLength: 32767,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

const doctorCheck = closedObject(
  {
    id: reference("stableId"),
    status: enumSchema(DOCTOR_CHECK_STATUSES),
    code: reference("stableId"),
    message: textSchema(500),
    nextAction: textSchema(500),
  },
  ["id", "status", "code", "message"],
);

const doctorProject = closedObject(
  {
    requestedPath: localPath,
    canonicalPath: localPath,
    identityDigest: reference("sha256Digest"),
    state: enumSchema([
      "unavailable",
      "uninitialized",
      "incomplete",
      "ready",
    ]),
  },
  ["requestedPath", "state"],
);

export const doctorRequestSchema: VersionedContractSchema =
  defineContractSchema({
    id: "doctor-request",
    version: "1.0.0",
    title: "Doctor Request",
    description:
      "Selects one bounded local project root for read-only control-plane diagnostics.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        projectRoot: localPath,
      },
      ["schemaVersion", "projectRoot"],
    ),
  });

export const doctorReportSchema: VersionedContractSchema =
  defineContractSchema({
    id: "doctor-report",
    version: "1.0.0",
    title: "Doctor Report",
    description:
      "Reports bounded read-only runtime, registry, project-state, and pack-state diagnostics.",
    schema: contractRoot(
      {
        schemaVersion: reference("semanticVersion"),
        commandId: { const: "doctor" },
        status: enumSchema(["healthy", "attention", "blocked"]),
        controlPlaneVersion: reference("semanticVersion"),
        registryDigest: reference("sha256Digest"),
        project: doctorProject,
        checks: boundedArray(doctorCheck, { minimum: 1, maximum: 32 }),
      },
      [
        "schemaVersion",
        "commandId",
        "status",
        "controlPlaneVersion",
        "registryDigest",
        "project",
        "checks",
      ],
    ),
  });
