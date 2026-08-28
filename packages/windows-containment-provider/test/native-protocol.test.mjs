import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
