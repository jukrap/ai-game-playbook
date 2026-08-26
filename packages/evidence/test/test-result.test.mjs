import assert from "node:assert/strict";
import test from "node:test";

import * as evidence from "../dist/index.js";
import { processResult } from "./fixtures/process-result.mjs";

function parsedReport(overrides = {}) {
  return {
    state: "parsed",
    discovered: 3,
    passed: 3,
    failed: 0,
    skipped: 0,
    requiredTestsMissing: [],
    ...overrides,
  };
}

function normalize(process, report) {
  return evidence.normalizeTestResult({ process, report });
}

test("test normalization separates process and report availability failures", () => {
  const cases = [
    {
      name: "not run",
      process: null,
      report: { state: "not-run" },
      status: "not-run",
      code: "test.not-run",
    },
    {
      name: "process failed before a report",
      process: processResult({ exitCode: 2 }),
      report: { state: "missing" },
      status: "failed",
      code: "test.process-failed",
    },
    {
      name: "process cancelled before a report",
      process: processResult({
        outcome: "cancelled",
        exitCode: null,
        signal: "SIGTERM",
      }),
      report: { state: "missing" },
      status: "cancelled",
      code: "test.process-cancelled",
    },
    {
      name: "process uncertain before a report",
      process: processResult({
        outcome: "termination-uncertain",
        exitCode: null,
      }),
      report: { state: "missing" },
      status: "uncertain",
      code: "test.process-uncertain",
    },
    {
      name: "report missing",
      process: processResult(),
      report: { state: "missing" },
      status: "failed",
      code: "test.report-missing",
    },
    {
      name: "report incomplete",
      process: processResult(),
      report: { state: "incomplete" },
      status: "failed",
      code: "test.report-incomplete",
    },
    {
      name: "report parse failed",
      process: processResult(),
      report: { state: "parse-failed" },
      status: "failed",
      code: "test.report-parse-failed",
    },
  ];

  for (const fixture of cases) {
    const actual = normalize(fixture.process, fixture.report);
    assert.equal(actual.component, "test", fixture.name);
    assert.equal(actual.status, fixture.status, fixture.name);
    assert.equal(actual.code, fixture.code, fixture.name);
    assert.equal(actual.reportState, fixture.report.state, fixture.name);
    assert.equal(actual.tests, undefined, fixture.name);
  }
});

test("test normalization rejects count gaps, zero execution, skips, assertions, and required misses", () => {
  const cases = [
    {
      name: "count mismatch",
      report: parsedReport({ discovered: 4 }),
      code: "test.report-count-mismatch",
      projection: false,
    },
    {
      name: "zero discovered",
      report: parsedReport({ discovered: 0, passed: 0 }),
      code: "test.zero-discovered",
    },
    {
      name: "all skipped",
      report: parsedReport({ passed: 0, skipped: 3 }),
      code: "test.all-skipped",
    },
    {
      name: "assertion failed",
      report: parsedReport({ passed: 2, failed: 1 }),
      code: "test.assertion-failed",
    },
    {
      name: "required test missing",
      report: parsedReport({ requiredTestsMissing: ["test.required-save-load"] }),
      code: "test.required-test-missing",
    },
  ];

  for (const fixture of cases) {
    const actual = normalize(processResult(), fixture.report);
    assert.equal(actual.status, "failed", fixture.name);
    assert.equal(actual.code, fixture.code, fixture.name);
    if (fixture.projection === false) {
      assert.equal(actual.tests, undefined, fixture.name);
    } else {
      assert.deepEqual(actual.tests, {
        status: "failed",
        discovered: fixture.report.discovered,
        passed: fixture.report.passed,
        failed: fixture.report.failed,
        skipped: fixture.report.skipped,
      });
    }
    assert.equal(
      actual.requiredTestsMissing,
      fixture.report.requiredTestsMissing.length,
    );
  }
});

test("test normalization does not hide a process failure after a passing report", () => {
  const cases = [
    {
      name: "post-result failure",
      process: processResult({ exitCode: 9 }),
      status: "failed",
      code: "test.post-result-process-failed",
    },
    {
      name: "post-result cancellation",
      process: processResult({
        outcome: "cancelled",
        exitCode: null,
        signal: "SIGTERM",
      }),
      status: "cancelled",
      code: "test.post-result-process-cancelled",
    },
    {
      name: "post-result uncertainty",
      process: processResult({
        outcome: "termination-uncertain",
        exitCode: null,
      }),
      status: "uncertain",
      code: "test.post-result-process-uncertain",
    },
  ];

  for (const fixture of cases) {
    const actual = normalize(fixture.process, parsedReport());
    assert.equal(actual.status, fixture.status, fixture.name);
    assert.equal(actual.code, fixture.code, fixture.name);
    assert.equal(actual.tests.status, fixture.status, fixture.name);
  }
});

test("test normalization passes only a complete nonempty report and process", () => {
  const input = {
    process: processResult(),
    report: parsedReport({ passed: 2, skipped: 1 }),
  };
  const actual = evidence.normalizeTestResult(input);
  input.report.passed = 0;
  input.report.skipped = 3;

  assert.equal(actual.status, "passed");
  assert.equal(actual.code, "test.passed");
  assert.equal(actual.message, "Required tests completed successfully.");
  assert.deepEqual(actual.process, {
    status: "passed",
    code: "process.exited-zero",
  });
  assert.deepEqual(actual.tests, {
    status: "passed",
    discovered: 3,
    passed: 2,
    failed: 0,
    skipped: 1,
  });
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(Object.isFrozen(actual.process), true);
  assert.equal(Object.isFrozen(actual.tests), true);
});

test("test normalization rejects malformed requests and report observations", () => {
  const invalid = [
    { process: null, report: { state: "missing" } },
    { process: processResult(), report: { state: "not-run" } },
    { process: processResult(), report: { state: "missing", extra: true } },
    {
      process: processResult(),
      report: parsedReport({ discovered: -1 }),
    },
    {
      process: processResult(),
      report: parsedReport({
        requiredTestsMissing: ["test.required", "test.required"],
      }),
    },
    { process: processResult(), report: { state: "unknown" } },
    { process: processResult(), report: { state: "missing" }, extra: true },
  ];

  for (const value of invalid) {
    assert.throws(
      () => evidence.normalizeTestResult(value),
      (error) =>
        error?.name === "EvidenceNormalizationError" &&
        error?.code === "invalid-test-result-observation",
    );
  }
});
