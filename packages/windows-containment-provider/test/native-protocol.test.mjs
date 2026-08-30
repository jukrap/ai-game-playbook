import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";

const artifactPath = fileURLToPath(
  new URL(
    "../dist/native/win-x64/agpb-windows-containment.exe",
    import.meta.url,
  ),
);
const nativeAvailable =
  process.platform === "win32" &&
  process.arch === "x64" &&
  existsSync(artifactPath);

function invoke(input, operation = "self-test") {
  return spawnSync(artifactPath, [operation], {
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
}

function invokeArguments(arguments_) {
  return spawnSync(artifactPath, arguments_, {
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
}

function assertProtocolFailure(result, code) {
  assert.equal(result.status, 64);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  const error = JSON.parse(result.stderr.trim());
  assert.deepEqual(error, {
    schemaVersion: "1.0.0",
    status: "error",
    code,
  });
  assert.equal(JSON.stringify(error).includes("\\"), false);
}

function csharpConstant(source, name) {
  const match = new RegExp(
    `(?:internal|private) const (?:int|string) ${name} =\\s*(?:\\r?\\n\\s*)?(?:"([^"]*)"|([^;]+));`,
    "u",
  ).exec(source);
  assert.notEqual(match, null, name);
  return match[1] ?? match[2].trim().replaceAll("_", "");
}

test("native engine profile remains synchronized with the typed contract", async () => {
  const protocol = await readFile(
    fileURLToPath(new URL("../native/EngineRunProtocol.cs", import.meta.url)),
    "utf8",
  );
  const runner = await readFile(
    fileURLToPath(new URL("../native/EngineRunRunner.cs", import.meta.url)),
    "utf8",
  );

  const profiles = [
    [
      "Preflight",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE,
    ],
    [
      "Replay",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE,
    ],
    [
      "ProjectImport",
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE,
    ],
    [
      "ProjectValidation",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE,
    ],
  ];
  for (const [prefix, profile] of profiles) {
    assert.equal(csharpConstant(protocol, `${prefix}OperationId`), profile.operationId);
    assert.equal(csharpConstant(protocol, `${prefix}ProfileId`), profile.profileId);
    assert.equal(
      csharpConstant(protocol, `${prefix}ProfileDigest`),
      profile.profileDigest,
    );
    assert.equal(
      csharpConstant(protocol, `${prefix}ProfileContractDigest`),
      profile.contractDigest,
    );
    assert.equal(
      csharpConstant(protocol, `${prefix}InvocationDigest`),
      profile.invocationDigest,
    );
  }
  assert.equal(
    csharpConstant(protocol, "ProfileCatalogDigest"),
    contracts.PROCESS_CONTAINMENT_ENGINE_EXECUTION_PROFILE_CATALOG_DIGEST,
  );
  assert.equal(
    csharpConstant(protocol, "PolicyDigest"),
    contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
  );
  const integerConstants = [
    [
      "StartValidityMs",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .startValidityMs,
    ],
    [
      "TerminationGraceMs",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .terminationGraceMs,
    ],
    [
      "PreflightProcessTimeoutMs",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .processTimeoutMs,
    ],
    [
      "PreflightIdleTimeoutMs",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .idleTimeoutMs,
    ],
    [
      "PreflightMaximumOutputBytes",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .maxOutputBytes,
    ],
    [
      "PreflightMaximumReportDurationMs",
      contracts.GODOT_HEADLESS_PREFLIGHT_ENGINE_EXECUTION_PROFILE.limits
        .maxReportDurationMs,
    ],
    [
      "ReplayProcessTimeoutMs",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits
        .processTimeoutMs,
    ],
    [
      "ReplayIdleTimeoutMs",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits
        .idleTimeoutMs,
    ],
    [
      "ReplayMaximumOutputBytes",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits
        .maxOutputBytes,
    ],
    [
      "ReplayMaximumReportDurationMs",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.limits
        .maxReportDurationMs,
    ],
    [
      "ReplayMaximumLineBytes",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.output
        .maxLineBytes,
    ],
    [
      "ReplayMaximumEvents",
      contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.output
        .maxEvents,
    ],
    [
      "ProjectImportProcessTimeoutMs",
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.limits
        .processTimeoutMs,
    ],
    [
      "ProjectImportIdleTimeoutMs",
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.limits
        .idleTimeoutMs,
    ],
    [
      "ProjectImportMaximumOutputBytes",
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.limits
        .maxOutputBytes,
    ],
    [
      "ProjectImportMaximumReportDurationMs",
      contracts.GODOT_PROJECT_IMPORT_ENGINE_EXECUTION_PROFILE.limits
        .maxReportDurationMs,
    ],
    [
      "ProjectValidationProcessTimeoutMs",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.limits
        .processTimeoutMs,
    ],
    [
      "ProjectValidationIdleTimeoutMs",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.limits
        .idleTimeoutMs,
    ],
    [
      "ProjectValidationMaximumOutputBytes",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.limits
        .maxOutputBytes,
    ],
    [
      "ProjectValidationMaximumReportDurationMs",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.limits
        .maxReportDurationMs,
    ],
    [
      "ProjectValidationMaximumLineBytes",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.output
        .maxLineBytes,
    ],
    [
      "ProjectValidationMaximumEvents",
      contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.output
        .maxEvents,
    ],
    ["MaximumProcesses", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROCESSES],
    ["MaximumProjectFiles", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILES],
    [
      "MaximumProjectDirectories",
      contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_DIRECTORIES,
    ],
    [
      "MaximumProjectFileBytes",
      contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_FILE_BYTES,
    ],
    ["MaximumProjectBytes", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROJECT_BYTES],
    ["MaximumProfileBytes", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_PROFILE_BYTES],
  ];
  for (const [name, expected] of integerConstants) {
    const expression = csharpConstant(protocol, name);
    const factors = expression.split("*").map((value) => Number(value.trim()));
    assert.equal(factors.every(Number.isFinite), true, name);
    assert.equal(
      factors.reduce((total, value) => total * value, 1),
      expected,
      name,
    );
  }
  assert.equal(
    csharpConstant(protocol, "ReplayOutputPrefix"),
    contracts.GODOT_DETERMINISTIC_REPLAY_ENGINE_EXECUTION_PROFILE.output.prefix,
  );
  assert.equal(
    csharpConstant(protocol, "ProjectValidationOutputPrefix"),
    contracts.GODOT_PROJECT_VALIDATION_ENGINE_EXECUTION_PROFILE.output.prefix,
  );
  assert.equal(
    csharpConstant(protocol, "ProjectValidationScript"),
    contracts.GODOT_PROJECT_VALIDATOR_SCRIPT,
  );
  assert.match(
    runner,
    /EngineRunProtocol\.PreflightOperationId[\s\S]*"--quit-after"[\s\S]*"1"[\s\S]*"--no-header"/u,
  );
  assert.match(
    runner,
    /EngineRunProtocol\.ReplayOperationId[\s\S]*"--no-header"[\s\S]*"--"[\s\S]*"--agpb-replay"/u,
  );
  assert.match(
    runner,
    /EngineRunProtocol\.ProjectImportOperationId[\s\S]*"--import"[\s\S]*"--log-file"[\s\S]*"--no-header"/u,
  );
  assert.match(
    runner,
    /EngineRunProtocol\.ProjectValidationOperationId[\s\S]*"--script"[\s\S]*EngineRunProtocol\.ProjectValidationScript[\s\S]*"--no-header"/u,
  );
});

test("native runners share one bounded AppContainer profile cleanup contract", async () => {
  const windowsProcess = await readFile(
    fileURLToPath(new URL("../native/WindowsProcess.cs", import.meta.url)),
    "utf8",
  );
  const runners = await Promise.all(
    ["SelfTestRunner.cs", "SyntheticLaunchRunner.cs", "EngineRunRunner.cs"].map(
      async (name) =>
        await readFile(
          fileURLToPath(new URL(`../native/${name}`, import.meta.url)),
          "utf8",
        ),
    ),
  );

  assert.equal(
    csharpConstant(windowsProcess, "AppContainerProfileDeleteMaximumAttempts"),
    "3",
  );
  assert.equal(
    csharpConstant(windowsProcess, "AppContainerProfileDeleteRetryDelayMs"),
    "25",
  );
  assert.match(
    windowsProcess,
    /internal static bool DeleteAppContainerProfile\(string name\)[\s\S]*for \(int attempt = 0; attempt < AppContainerProfileDeleteMaximumAttempts; attempt\+\+\)[\s\S]*NativeMethods\.DeleteAppContainerProfile\(name\) == 0[\s\S]*Thread\.Sleep\(AppContainerProfileDeleteRetryDelayMs \* \(attempt \+ 1\)\);/u,
  );
  for (const runner of runners) {
    assert.match(
      runner,
      /profileRemoved = WindowsProcess\.DeleteAppContainerProfile\(profileName\);/u,
    );
    assert.doesNotMatch(runner, /NativeMethods\.DeleteAppContainerProfile/u);
  }
});

test(
  "native protocol rejects duplicate and undeclared request fields",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invoke('{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}\n'),
      "request-duplicate-field",
    );
    assertProtocolFailure(
      invoke('{"schemaVersion":"1.0.0","unknown":true}\n'),
      "request-shape-invalid",
    );
  },
);

test(
  "native synthetic launch protocol rejects duplicate and undeclared fields",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}\n',
        "synthetic-launch",
      ),
      "request-duplicate-field",
    );
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","unknown":true}\n',
        "synthetic-launch",
      ),
      "request-shape-invalid",
    );
  },
);

test(
  "native engine run protocol rejects duplicate and undeclared fields",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}\n',
        "godot-engine-run",
      ),
      "request-duplicate-field",
    );
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","unknown":true}\n',
        "godot-engine-run",
      ),
      "request-shape-invalid",
    );
  },
);

test(
  "native engine cancellation protocol rejects duplicate and undeclared fields",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0"}\n',
        "godot-engine-cancel",
      ),
      "request-duplicate-field",
    );
    assertProtocolFailure(
      invoke(
        '{"schemaVersion":"1.0.0","unknown":true}\n',
        "godot-engine-cancel",
      ),
      "request-shape-invalid",
    );
  },
);

test(
  "native internal workloads refuse execution outside AppContainer",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invokeArguments(["synthetic-workload", "--project", "C:\\fixture"]),
      "synthetic-workload-appcontainer-required",
    );
    assertProtocolFailure(
      invokeArguments(["probe", "--project", "C:\\fixture"]),
      "probe-appcontainer-required",
    );
  },
);

test(
  "native protocol rejects oversized input before self-test setup",
  { skip: !nativeAvailable },
  () => {
    assertProtocolFailure(
      invoke(`{"padding":"${"x".repeat(17 * 1024)}"}\n`),
      "request-size-invalid",
    );
  },
);

test(
  "native protocol binds execution to the expected artifact digest",
  { skip: !nativeAvailable },
  () => {
    const issued = new Date();
    issued.setMilliseconds(Math.floor(issued.getMilliseconds()));
    const expires = new Date(issued.getTime() + 60_000);
    const request = {
      schemaVersion: "1.0.0",
      operation: "self-test",
      selfTestId: randomUUID(),
      requestDigest: `sha256:${"1".repeat(64)}`,
      entryArtifactDigest: `sha256:${"0".repeat(64)}`,
      challengeDigest: `sha256:${"2".repeat(64)}`,
      fixtureIdentityDigest: `sha256:${"3".repeat(64)}`,
      issuedAt: issued.toISOString(),
      expiresAt: expires.toISOString(),
      maxDurationMs: 30_000,
    };
    assertProtocolFailure(
      invoke(`${JSON.stringify(request)}\n`),
      "artifact-digest-mismatch",
    );
  },
);
