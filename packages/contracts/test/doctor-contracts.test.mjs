import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digest = `sha256:${"a".repeat(64)}`;

const request = {
  schemaVersion: "1.0.0",
  projectRoot: "D:\\games\\sample",
};

const report = {
  schemaVersion: "1.0.0",
  commandId: "doctor",
  status: "attention",
  controlPlaneVersion: "0.0.0",
  registryDigest: digest,
  project: {
    requestedPath: "D:\\games\\sample",
    canonicalPath: "D:\\games\\sample",
    identityDigest: digest,
    state: "uninitialized",
  },
  checks: [
    {
      id: "project.state",
      status: "warning",
      code: "project-state-not-initialized",
      message: "Project-local runtime state has not been initialized.",
      nextAction: "Run agpb init after reviewing its write plan.",
    },
  ],
};

test("doctor request and report schemas are versioned and closed", () => {
  assert.equal(contracts.doctorRequestSchema.id, "doctor-request");
  assert.equal(contracts.doctorReportSchema.id, "doctor-report");
  assert.equal(contracts.doctorRequestSchema.schema.additionalProperties, false);
  assert.equal(contracts.doctorReportSchema.schema.additionalProperties, false);
  assert.deepEqual(
    contracts.doctorReportSchema.schema.properties.status.enum,
    ["healthy", "attention", "blocked"],
  );
  assert.equal(request.schemaVersion, contracts.doctorRequestSchema.version);
  assert.equal(report.schemaVersion, contracts.doctorReportSchema.version);
});

test("doctor status is derived from bounded check outcomes", () => {
  assert.equal(contracts.computeDoctorStatus([]), "healthy");
  assert.equal(
    contracts.computeDoctorStatus([{ status: "passed" }, { status: "skipped" }]),
    "healthy",
  );
  assert.equal(
    contracts.computeDoctorStatus([{ status: "warning" }]),
    "attention",
  );
  assert.equal(
    contracts.computeDoctorStatus([
      { status: "warning" },
      { status: "blocked" },
    ]),
    "blocked",
  );
  assert.throws(
    () => contracts.computeDoctorStatus([{ status: "invalid" }]),
    TypeError,
  );
  assert.throws(
    () =>
      contracts.computeDoctorStatus(
        Array.from({ length: 33 }, () => ({ status: "passed" })),
      ),
    RangeError,
  );
});
