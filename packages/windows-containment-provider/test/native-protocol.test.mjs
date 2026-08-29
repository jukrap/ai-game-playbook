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
    `(?:internal|private) const (?:int|string) ${name} =\\s*(?:\\r?\\n\\s*)?"?([^";]+)"?;`,
    "u",
  ).exec(source);
  assert.notEqual(match, null, name);
  return match[1].trim().replaceAll("_", "");
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

  assert.equal(
    csharpConstant(protocol, "ProfileId"),
    contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_ID,
  );
  assert.equal(
    csharpConstant(protocol, "ProfileDigest"),
    contracts.PROCESS_CONTAINMENT_ENGINE_RUN_PROFILE_DIGEST,
  );
  assert.equal(
    csharpConstant(protocol, "InvocationDigest"),
    contracts.GODOT_HEADLESS_PREFLIGHT_INVOCATION_DIGEST,
  );
  assert.equal(
    csharpConstant(protocol, "PolicyDigest"),
    contracts.PROCESS_CONTAINMENT_POLICY_DIGEST,
  );
  const integerConstants = [
    ["EngineTimeoutMs", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_ENGINE_TIMEOUT_MS],
    ["MaximumOutputBytes", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_MAX_OUTPUT_BYTES],
    ["TerminationGraceMs", contracts.PROCESS_CONTAINMENT_ENGINE_RUN_TERMINATION_GRACE_MS],
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
  assert.match(
    runner,
    /string\[\] command =\s*\{\s*stagedExecutable,\s*"--headless",\s*"--path",\s*stagedProject,\s*"--quit-after",\s*"1",\s*"--log-file",\s*logPath,\s*"--no-header",\s*\};/u,
  );
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
