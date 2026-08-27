import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

const digests = Array.from({ length: 12 }, (_, index) =>
  contracts.digestCanonicalJson({ index }),
);

function descriptorInput() {
  return {
    providerId: "process-containment.windows.test-fixture",
    providerVersion: "0.1.0",
    host: {
      platform: "windows",
      architecture: "x64",
    },
    workload: "engine-project-process",
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    implementation: {
      entryArtifactDigest: digests[0],
      closureManifestDigest: digests[1],
      selfTestArtifactDigest: digests[2],
    },
    protocols: {
      selfTest: "1.0.0",
      launch: "1.0.0",
    },
    controls: {
      filesystem: {
        requirement: "deny-project-writes",
        enforcement: "os-enforced",
        selfTest: "required",
      },
      network: {
        requirement: "deny",
        enforcement: "os-enforced",
        selfTest: "required",
      },
      childProcesses: {
        requirement: "deny",
        enforcement: "os-enforced",
        selfTest: "required",
      },
    },
    selfTestSuiteDigest:
      contracts.PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
  };
}

function descriptor() {
  const input = descriptorInput();
  return {
    schemaVersion: "1.0.0",
    ...input,
    descriptorDigest:
      contracts.computeProcessContainmentProviderDescriptorDigest(input),
  };
}

function selfTestRequest(provider = descriptor()) {
  return {
    schemaVersion: "1.0.0",
    selfTestId: "018f6f35-2c9e-7d1a-8a4b-123456789ad0",
    providerDescriptorDigest: provider.descriptorDigest,
    providerCatalogDigest:
      contracts.computeProcessContainmentProviderCatalogDigest([provider]),
    host: provider.host,
    workload: "engine-project-process",
    policyDigest: contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
    selfTestSuiteDigest:
      contracts.PROCESS_CONTAINMENT_SELF_TEST_SUITE_DIGEST,
    challengeDigest: digests[3],
    fixtureIdentityDigest: digests[4],
    issuedAt: "2026-08-27T00:00:00.000Z",
    expiresAt: "2026-08-27T00:01:00.000Z",
    maxDurationMs:
      contracts.PROCESS_CONTAINMENT_SELF_TEST_MAX_DURATION_MS,
  };
}

function probeResults(outcome = "passed") {
  return contracts.PROCESS_CONTAINMENT_SELF_TEST_PROBES.map(
    ({ id, expected }, index) => ({
      id,
      expected,
      outcome,
      observationDigest: digests[5 + (index % 7)],
    }),
  );
}

function reportInput({
  request = selfTestRequest(),
  outcome = "verified",
  probes = probeResults(),
  effects = {
    containedProcessStarted: true,
    projectMutationPerformed: false,
    networkConnectionEstablished: false,
    childProcessStarted: false,
    cleanup: "complete",
  },
  startedAt = "2026-08-27T00:00:01.000Z",
  completedAt = "2026-08-27T00:00:02.000Z",
  durationMs = 1_000,
} = {}) {
  return {
    selfTestId: request.selfTestId,
    request,
    requestDigest:
      contracts.computeProcessContainmentSelfTestRequestDigest(request),
    providerDescriptorDigest: request.providerDescriptorDigest,
    providerCatalogDigest: request.providerCatalogDigest,
    host: request.host,
    workload: request.workload,
    policyDigest: request.policyDigest,
    selfTestSuiteDigest: request.selfTestSuiteDigest,
    startedAt,
    completedAt,
    durationMs,
    probes,
    effects,
    outcome,
  };
}

function report(options) {
  const input = reportInput(options);
  return {
    schemaVersion: "1.0.0",
    ...input,
    reportDigest:
      contracts.computeProcessContainmentSelfTestReportDigest(input),
  };
}

test("provider descriptor closes implementation, protocol, control, and suite identity", () => {
  const value = descriptor();

  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentProviderDescriptorSemantics(value),
  );
  assert.equal(
    value.descriptorDigest,
    contracts.computeProcessContainmentProviderDescriptorDigest(
      descriptorInput(),
    ),
  );

  for (const mutate of [
    (candidate) => {
      candidate.providerVersion = "0.1.1";
    },
    (candidate) => {
      candidate.implementation.closureManifestDigest = digests[11];
    },
    (candidate) => {
      candidate.protocols.launch = "2.0.0";
    },
    (candidate) => {
      candidate.controls.network.selfTest = "optional";
    },
    (candidate) => {
      candidate.selfTestSuiteDigest = digests[11];
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(
      () =>
        contracts.assertProcessContainmentProviderDescriptorSemantics(
          changed,
        ),
      TypeError,
    );
  }
});

test("provider catalog digest is sorted, duplicate-free, and order-independent", () => {
  const first = descriptor();
  const secondInput = descriptorInput();
  secondInput.providerId = "process-containment.linux.test-fixture";
  secondInput.host = { platform: "linux", architecture: "x64" };
  secondInput.implementation.entryArtifactDigest = digests[11];
  const second = {
    schemaVersion: "1.0.0",
    ...secondInput,
    descriptorDigest:
      contracts.computeProcessContainmentProviderDescriptorDigest(
        secondInput,
      ),
  };

  assert.equal(
    contracts.computeProcessContainmentProviderCatalogDigest([
      first,
      second,
    ]),
    contracts.computeProcessContainmentProviderCatalogDigest([
      second,
      first,
    ]),
  );
  assert.throws(
    () =>
      contracts.computeProcessContainmentProviderCatalogDigest([
        first,
        first,
      ]),
    TypeError,
  );
});

test("self-test request binds descriptor, catalog, host, challenge, fixture, and expiry", () => {
  const value = selfTestRequest();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentSelfTestRequestSemantics(value),
  );

  for (const mutate of [
    (candidate) => {
      candidate.challengeDigest = digests[11];
    },
    (candidate) => {
      candidate.host.platform = "linux";
    },
    (candidate) => {
      candidate.expiresAt = "2026-08-27T00:00:59.000Z";
    },
  ]) {
    const changed = structuredClone(value);
    const originalDigest =
      contracts.computeProcessContainmentSelfTestRequestDigest(value);
    mutate(changed);
    assert.notEqual(
      contracts.computeProcessContainmentSelfTestRequestDigest(changed),
      originalDigest,
    );
  }

  const overBudget = structuredClone(value);
  overBudget.maxDurationMs = 30_001;
  assert.throws(
    () =>
      contracts.computeProcessContainmentSelfTestRequestDigest(
        overBudget,
      ),
    TypeError,
  );
});

test("complete clean probe set is the only verified self-test shape", () => {
  const verified = report();
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentSelfTestReportSemantics(verified),
  );

  const failedProbes = probeResults();
  failedProbes[1].outcome = "failed";
  const rejected = report({
    outcome: "rejected",
    probes: failedProbes,
    effects: {
      containedProcessStarted: true,
      projectMutationPerformed: true,
      networkConnectionEstablished: false,
      childProcessStarted: false,
      cleanup: "complete",
    },
  });
  assert.doesNotThrow(() =>
    contracts.assertProcessContainmentSelfTestReportSemantics(rejected),
  );

  for (const mutate of [
    (candidate) => {
      candidate.probes[1].outcome = "failed";
    },
    (candidate) => {
      candidate.effects.projectMutationPerformed = true;
    },
    (candidate) => {
      candidate.effects.networkConnectionEstablished = true;
    },
    (candidate) => {
      candidate.effects.childProcessStarted = true;
    },
    (candidate) => {
      candidate.effects.cleanup = "uncertain";
    },
    (candidate) => {
      candidate.effects.containedProcessStarted = false;
    },
  ]) {
    const forged = structuredClone(verified);
    mutate(forged);
    assert.throws(
      () => {
        forged.reportDigest =
          contracts.computeProcessContainmentSelfTestReportDigest(
            Object.fromEntries(
              Object.entries(forged).filter(
                ([key]) =>
                  key !== "schemaVersion" && key !== "reportDigest",
              ),
            ),
          );
        contracts.assertProcessContainmentSelfTestReportSemantics(forged);
      },
      TypeError,
    );
  }
});

test("self-test report rejects probe omission, reorder, duplicate, and expiry drift", () => {
  const valid = report();

  for (const mutate of [
    (candidate) => {
      candidate.probes.pop();
    },
    (candidate) => {
      [candidate.probes[1], candidate.probes[2]] = [
        candidate.probes[2],
        candidate.probes[1],
      ];
    },
    (candidate) => {
      candidate.probes[2] = structuredClone(candidate.probes[1]);
    },
    (candidate) => {
      candidate.completedAt = "2026-08-27T00:01:00.001Z";
      candidate.durationMs = 59_001;
    },
    (candidate) => {
      candidate.durationMs = 999;
    },
    (candidate) => {
      candidate.request.challengeDigest = digests[11];
    },
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.throws(
      () =>
        contracts.assertProcessContainmentSelfTestReportSemantics(changed),
      TypeError,
    );
  }
});

test("verified self-test cannot claim a zero-duration process execution", () => {
  assert.throws(
    () =>
      report({
        startedAt: "2026-08-27T00:00:01.000Z",
        completedAt: "2026-08-27T00:00:01.000Z",
        durationMs: 0,
      }),
    TypeError,
  );
});

test("provider contracts reject accessors, symbols, unknown fields, and custom prototypes", () => {
  let getterCalled = false;
  const accessor = descriptor();
  Object.defineProperty(accessor, "providerId", {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error("must not execute");
    },
  });
  assert.throws(
    () =>
      contracts.assertProcessContainmentProviderDescriptorSemantics(
        accessor,
      ),
    TypeError,
  );
  assert.equal(getterCalled, false);

  const symbol = selfTestRequest();
  symbol[Symbol("hidden")] = true;
  assert.throws(
    () => contracts.assertProcessContainmentSelfTestRequestSemantics(symbol),
    TypeError,
  );

  const unknown = report();
  unknown.providerPath = "C:\\forbidden";
  assert.throws(
    () => contracts.assertProcessContainmentSelfTestReportSemantics(unknown),
    TypeError,
  );

  const custom = Object.assign(Object.create({ inherited: true }), descriptor());
  assert.throws(
    () =>
      contracts.assertProcessContainmentProviderDescriptorSemantics(custom),
    TypeError,
  );
});
