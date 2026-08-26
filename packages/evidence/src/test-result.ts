import {
  parseStableId,
  type ComponentOutcome,
  type StableId,
} from "@ai-game-playbook/contracts";
import type { BoundedProcessResult } from "@ai-game-playbook/core";

import { EvidenceNormalizationError } from "./errors.js";
import {
  normalizeProcessResult,
  type NormalizedProcessResult,
  type ProcessResultCode,
} from "./process-result.js";

const TEST_MAX_COUNT = 10_000_000;
const TEST_MAX_REQUIRED_MISSES = 10_000;

type DataRecord = Record<string, unknown>;

export type TestReportState =
  | "not-run"
  | "missing"
  | "incomplete"
  | "parse-failed"
  | "parsed";

export interface ParsedTestReportObservation {
  readonly state: "parsed";
  readonly discovered: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly requiredTestsMissing: readonly StableId[];
}

export type TestReportObservation =
  | { readonly state: Exclude<TestReportState, "parsed"> }
  | ParsedTestReportObservation;

export interface NormalizeTestResultRequest {
  readonly process: BoundedProcessResult | null;
  readonly report: TestReportObservation;
}

export type TestResultCode =
  | "test.not-run"
  | "test.process-failed"
  | "test.process-cancelled"
  | "test.process-uncertain"
  | "test.report-missing"
  | "test.report-incomplete"
  | "test.report-parse-failed"
  | "test.report-count-mismatch"
  | "test.zero-discovered"
  | "test.all-skipped"
  | "test.assertion-failed"
  | "test.required-test-missing"
  | "test.post-result-process-failed"
  | "test.post-result-process-cancelled"
  | "test.post-result-process-uncertain"
  | "test.passed";

export interface NormalizedTestResult {
  readonly component: "test";
  readonly status: ComponentOutcome;
  readonly code: TestResultCode;
  readonly message: string;
  readonly reportState: TestReportState;
  readonly process:
    | {
        readonly status: ComponentOutcome;
        readonly code: ProcessResultCode;
      }
    | null;
  readonly tests?: {
    readonly status: ComponentOutcome;
    readonly discovered: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
  };
  readonly requiredTestsMissing: number;
}

interface TestClassification {
  readonly status: ComponentOutcome;
  readonly code: TestResultCode;
  readonly message: string;
  readonly projectionAllowed: boolean;
}

interface NormalizedRequest {
  readonly process: NormalizedProcessResult | null;
  readonly report: TestReportObservation;
  readonly requiredTestsMissing: number;
}

function invalid(path: string, message: string): never {
  throw new EvidenceNormalizationError(
    "invalid-test-result-observation",
    path,
    message,
  );
}

function plainRecord(value: unknown, path: string): DataRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    invalid(path, "expected a plain data object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.values(descriptors).some(
      (descriptor) =>
        !("value" in descriptor) || descriptor.enumerable !== true,
    )
  ) {
    invalid(path, "object properties must be enumerable data fields");
  }
  return value as DataRecord;
}

function exactKeys(
  value: DataRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    invalid(path, "record contains undeclared fields or omits required fields");
  }
}

function testCount(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > TEST_MAX_COUNT
  ) {
    invalid(path, "test count is outside the fixed normalization boundary");
  }
  return value as number;
}

function validateRequiredMisses(value: unknown): readonly StableId[] {
  if (!Array.isArray(value) || value.length > TEST_MAX_REQUIRED_MISSES) {
    invalid(
      "$request.report.requiredTestsMissing",
      "required test misses exceed the fixed normalization boundary",
    );
  }
  const normalized: StableId[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.entries()) {
    let id: StableId;
    try {
      id = parseStableId(entry);
    } catch {
      invalid(
        `$request.report.requiredTestsMissing/${index}`,
        "required test identity is not a stable ID",
      );
    }
    if (seen.has(id)) {
      invalid(
        "$request.report.requiredTestsMissing",
        "required test identities must be unique",
      );
    }
    seen.add(id);
    normalized.push(id);
  }
  return Object.freeze(normalized);
}

function validateReport(value: unknown): {
  readonly report: TestReportObservation;
  readonly requiredTestsMissing: number;
} {
  const report = plainRecord(value, "$request.report");
  const state = report["state"];
  if (
    state !== "not-run" &&
    state !== "missing" &&
    state !== "incomplete" &&
    state !== "parse-failed" &&
    state !== "parsed"
  ) {
    invalid("$request.report.state", "test report state is not recognized");
  }
  if (state !== "parsed") {
    exactKeys(report, ["state"], "$request.report");
    return Object.freeze({
      report: Object.freeze({ state }),
      requiredTestsMissing: 0,
    });
  }
  exactKeys(
    report,
    [
      "state",
      "discovered",
      "passed",
      "failed",
      "skipped",
      "requiredTestsMissing",
    ],
    "$request.report",
  );
  const requiredTestsMissing = validateRequiredMisses(
    report["requiredTestsMissing"],
  );
  const normalized: ParsedTestReportObservation = Object.freeze({
    state,
    discovered: testCount(
      report["discovered"],
      "$request.report.discovered",
    ),
    passed: testCount(report["passed"], "$request.report.passed"),
    failed: testCount(report["failed"], "$request.report.failed"),
    skipped: testCount(report["skipped"], "$request.report.skipped"),
    requiredTestsMissing,
  });
  return Object.freeze({
    report: normalized,
    requiredTestsMissing: requiredTestsMissing.length,
  });
}

function normalizeRequest(value: NormalizeTestResultRequest): NormalizedRequest {
  const request = plainRecord(value, "$request");
  exactKeys(request, ["process", "report"], "$request");
  const normalizedReport = validateReport(request["report"]);
  if (
    (request["process"] === null) !==
    (normalizedReport.report.state === "not-run")
  ) {
    invalid(
      "$request",
      "only a not-run report may omit its process observation",
    );
  }
  return Object.freeze({
    process:
      request["process"] === null
        ? null
        : normalizeProcessResult(request["process"] as BoundedProcessResult),
    report: normalizedReport.report,
    requiredTestsMissing: normalizedReport.requiredTestsMissing,
  });
}

function classifyUnavailableReport(
  process: NormalizedProcessResult,
  state: Exclude<TestReportState, "parsed" | "not-run">,
): TestClassification {
  if (process.status === "uncertain") {
    return {
      status: "uncertain",
      code: "test.process-uncertain",
      message: "Test process termination could not be confirmed.",
      projectionAllowed: false,
    };
  }
  if (process.status === "cancelled") {
    return {
      status: "cancelled",
      code: "test.process-cancelled",
      message: "Test process was cancelled before a complete report was available.",
      projectionAllowed: false,
    };
  }
  if (process.status !== "passed") {
    return {
      status: "failed",
      code: "test.process-failed",
      message: "Test process failed before a complete report was available.",
      projectionAllowed: false,
    };
  }
  switch (state) {
    case "missing":
      return {
        status: "failed",
        code: "test.report-missing",
        message: "Test report was not produced.",
        projectionAllowed: false,
      };
    case "incomplete":
      return {
        status: "failed",
        code: "test.report-incomplete",
        message: "Test report was not complete.",
        projectionAllowed: false,
      };
    default:
      return {
        status: "failed",
        code: "test.report-parse-failed",
        message: "Test report could not be parsed.",
        projectionAllowed: false,
      };
  }
}

function classifyParsedReport(
  process: NormalizedProcessResult,
  report: ParsedTestReportObservation,
): TestClassification {
  if (
    report.discovered !==
    report.passed + report.failed + report.skipped
  ) {
    return {
      status: "failed",
      code: "test.report-count-mismatch",
      message: "Test report counts do not reconcile.",
      projectionAllowed: false,
    };
  }
  if (report.discovered === 0) {
    return {
      status: "failed",
      code: "test.zero-discovered",
      message: "Test report contains no executed tests.",
      projectionAllowed: true,
    };
  }
  if (report.skipped === report.discovered) {
    return {
      status: "failed",
      code: "test.all-skipped",
      message: "Every discovered test was skipped.",
      projectionAllowed: true,
    };
  }
  if (report.failed > 0) {
    return {
      status: "failed",
      code: "test.assertion-failed",
      message: "One or more test assertions failed.",
      projectionAllowed: true,
    };
  }
  if (report.requiredTestsMissing.length > 0) {
    return {
      status: "failed",
      code: "test.required-test-missing",
      message: "One or more required tests were not discovered.",
      projectionAllowed: true,
    };
  }
  if (process.status === "uncertain") {
    return {
      status: "uncertain",
      code: "test.post-result-process-uncertain",
      message: "Tests passed, but process termination could not be confirmed.",
      projectionAllowed: true,
    };
  }
  if (process.status === "cancelled") {
    return {
      status: "cancelled",
      code: "test.post-result-process-cancelled",
      message: "Tests passed, but the process was cancelled afterward.",
      projectionAllowed: true,
    };
  }
  if (process.status !== "passed") {
    return {
      status: "failed",
      code: "test.post-result-process-failed",
      message: "Tests passed, but the process failed afterward.",
      projectionAllowed: true,
    };
  }
  return {
    status: "passed",
    code: "test.passed",
    message: "Required tests completed successfully.",
    projectionAllowed: true,
  };
}

function processSummary(
  process: NormalizedProcessResult | null,
): NormalizedTestResult["process"] {
  return process === null
    ? null
    : Object.freeze({ status: process.status, code: process.code });
}

export function normalizeTestResult(
  value: NormalizeTestResultRequest,
): NormalizedTestResult {
  const request = normalizeRequest(value);
  if (request.process === null) {
    return Object.freeze({
      component: "test",
      status: "not-run",
      code: "test.not-run",
      message: "Tests were not run.",
      reportState: "not-run",
      process: null,
      requiredTestsMissing: 0,
    });
  }
  if (request.report.state === "not-run") {
    invalid(
      "$request.report.state",
      "a started test process cannot carry a not-run report",
    );
  }
  const classification =
    request.report.state === "parsed"
      ? classifyParsedReport(request.process, request.report)
      : classifyUnavailableReport(request.process, request.report.state);
  const tests =
    request.report.state === "parsed" && classification.projectionAllowed
      ? Object.freeze({
          status: classification.status,
          discovered: request.report.discovered,
          passed: request.report.passed,
          failed: request.report.failed,
          skipped: request.report.skipped,
        })
      : undefined;
  return Object.freeze({
    component: "test",
    status: classification.status,
    code: classification.code,
    message: classification.message,
    reportState: request.report.state,
    process: processSummary(request.process),
    ...(tests === undefined ? {} : { tests }),
    requiredTestsMissing: request.requiredTestsMissing,
  });
}
