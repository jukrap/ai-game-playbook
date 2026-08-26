import {
  computeRunReceiptDigest,
  type RunReceipt,
} from "./feature-evidence-contracts.js";
import type { EngineCapabilityReport } from "./project-engine-contracts.js";

export type ContractSemanticIssueCode =
  | "engine-capability-duplicate-id"
  | "engine-capability-duplicate-operation"
  | "engine-capability-future-observation"
  | "engine-capability-editor-without-engine-evidence"
  | "engine-capability-observed-without-execution-evidence"
  | "engine-capability-observed-without-receipt"
  | "engine-capability-planned-without-reason"
  | "engine-capability-verified-without-receipt"
  | "engine-capability-verified-without-runtime-evidence"
  | "run-receipt-digest-mismatch"
  | "run-receipt-duration-mismatch"
  | "run-receipt-invalid-timestamp"
  | "run-receipt-self-parent"
  | "run-receipt-success-contradiction"
  | "run-receipt-test-count-mismatch"
  | "run-receipt-test-pass-contradiction"
  | "run-receipt-uncertain-mutation-contradiction"
  | "run-receipt-unexpected-dirty-success";

export interface ContractSemanticIssue {
  readonly code: ContractSemanticIssueCode;
  readonly path: string;
  readonly message: string;
}

function issue(
  code: ContractSemanticIssueCode,
  path: string,
  message: string,
): ContractSemanticIssue {
  return Object.freeze({ code, path, message });
}

function freezeIssues(
  issues: readonly ContractSemanticIssue[],
): readonly ContractSemanticIssue[] {
  return Object.freeze([...issues]);
}

function timestampMillis(value: string): number | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export function checkRunReceiptSemantics(
  receipt: RunReceipt,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  if (computeRunReceiptDigest(receipt) !== receipt.receiptDigest) {
    issues.push(
      issue(
        "run-receipt-digest-mismatch",
        "/receiptDigest",
        "Receipt digest must attest the canonical receipt body without the digest field.",
      ),
    );
  }
  if (receipt.previousReceiptDigest === receipt.receiptDigest) {
    issues.push(
      issue(
        "run-receipt-self-parent",
        "/previousReceiptDigest",
        "A receipt cannot name itself as its previous receipt.",
      ),
    );
  }
  const startedAt = timestampMillis(receipt.timing.startedAt);
  const endedAt = timestampMillis(receipt.timing.endedAt);
  if (startedAt === undefined || endedAt === undefined || endedAt < startedAt) {
    issues.push(
      issue(
        "run-receipt-invalid-timestamp",
        "/timing",
        "Run timing must contain ordered valid timestamps.",
      ),
    );
  } else if (endedAt - startedAt !== receipt.timing.durationMs) {
    issues.push(
      issue(
        "run-receipt-duration-mismatch",
        "/timing/durationMs",
        "Run duration must equal the elapsed timestamp interval.",
      ),
    );
  }

  const tests = receipt.outcomes.tests;
  if (tests !== undefined) {
    if (tests.discovered !== tests.passed + tests.failed + tests.skipped) {
      issues.push(
        issue(
          "run-receipt-test-count-mismatch",
          "/outcomes/tests",
          "Discovered tests must equal passed, failed, and skipped tests.",
        ),
      );
    }
    if (
      tests.status === "passed" &&
      (tests.discovered === 0 || tests.passed === 0 || tests.failed !== 0)
    ) {
      issues.push(
        issue(
          "run-receipt-test-pass-contradiction",
          "/outcomes/tests/status",
          "A passing test outcome requires discovered and passed tests with no failures.",
        ),
      );
    }
  }

  if (
    receipt.status === "succeeded" &&
    (receipt.outcomes.outer.status !== "passed" ||
      receipt.outcomes.outer.timedOut ||
      (receipt.outcomes.outer.exitCode !== undefined &&
        receipt.outcomes.outer.exitCode !== 0) ||
      receipt.outcomes.inner.status !== "passed" ||
      (tests !== undefined && tests.status !== "passed") ||
      receipt.mutation.status === "uncertain")
  ) {
    issues.push(
      issue(
        "run-receipt-success-contradiction",
        "/status",
        "A succeeded receipt requires successful outer, inner, optional test, and mutation outcomes.",
      ),
    );
  }

  if (
    receipt.mutation.status === "uncertain" &&
    receipt.status !== "uncertain"
  ) {
    issues.push(
      issue(
        "run-receipt-uncertain-mutation-contradiction",
        "/mutation/status",
        "An uncertain mutation requires an uncertain receipt.",
      ),
    );
  }

  if (
    receipt.status === "succeeded" &&
    receipt.mutation.unexpectedDirtyFiles.length > 0
  ) {
    issues.push(
      issue(
        "run-receipt-unexpected-dirty-success",
        "/mutation/unexpectedDirtyFiles",
        "A receipt with unexpected dirty files cannot succeed.",
      ),
    );
  }

  return freezeIssues(issues);
}

export function checkEngineCapabilityReportSemantics(
  report: EngineCapabilityReport,
): readonly ContractSemanticIssue[] {
  const issues: ContractSemanticIssue[] = [];
  const ids = new Set<string>();
  const operations = new Set<string>();
  const generatedAt = timestampMillis(report.generatedAt);

  for (const [index, capability] of report.capabilities.entries()) {
    const path = `/capabilities/${index}`;
    if (ids.has(capability.id)) {
      issues.push(
        issue(
          "engine-capability-duplicate-id",
          `${path}/id`,
          "Capability IDs must be unique within a report.",
        ),
      );
    }
    ids.add(capability.id);

    const operationIdentity = `${capability.operation}@${capability.operationVersion}`;
    if (operations.has(operationIdentity)) {
      issues.push(
        issue(
          "engine-capability-duplicate-operation",
          `${path}/operation`,
          "An operation and version may appear only once within a report.",
        ),
      );
    }
    operations.add(operationIdentity);

    const checkedAt = timestampMillis(capability.checkedAt);
    if (
      generatedAt !== undefined &&
      checkedAt !== undefined &&
      checkedAt > generatedAt
    ) {
      issues.push(
        issue(
          "engine-capability-future-observation",
          `${path}/checkedAt`,
          "A capability observation cannot occur after its report was generated.",
        ),
      );
    }

    if (
      capability.support === "planned" &&
      capability.degradeReason === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-planned-without-reason",
          `${path}/degradeReason`,
          "Planned support must state why the operation is not available.",
        ),
      );
    }
    if (
      (capability.support === "detected" || capability.support === "headless") &&
      capability.evidenceGrade !== "locally-executed" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-observed-without-execution-evidence",
          `${path}/evidenceGrade`,
          "Detected and headless support require locally executed or engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support === "editor-preview" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-editor-without-engine-evidence",
          `${path}/evidenceGrade`,
          "Editor-preview support requires engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support !== "planned" &&
      capability.support !== "verified" &&
      capability.latestReceiptDigest === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-observed-without-receipt",
          `${path}/latestReceiptDigest`,
          "Observed support requires a receipt digest.",
        ),
      );
    }
    if (
      capability.support === "verified" &&
      capability.evidenceGrade !== "engine-verified"
    ) {
      issues.push(
        issue(
          "engine-capability-verified-without-runtime-evidence",
          `${path}/evidenceGrade`,
          "Verified support requires engine-verified evidence.",
        ),
      );
    }
    if (
      capability.support === "verified" &&
      capability.latestReceiptDigest === undefined
    ) {
      issues.push(
        issue(
          "engine-capability-verified-without-receipt",
          `${path}/latestReceiptDigest`,
          "Verified support requires a receipt digest.",
        ),
      );
    }
  }

  return freezeIssues(issues);
}
