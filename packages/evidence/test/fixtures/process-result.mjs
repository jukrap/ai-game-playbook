import * as contracts from "@ai-game-playbook/contracts";

const PROCESS_ID = "123e4567-e89b-42d3-a456-426614174200";

function processIdentity() {
  const body = {
    pid: 4242,
    spawnedAt: "2026-08-27T02:00:00.001Z",
    processToken: PROCESS_ID,
    executableDigest: contracts.sha256Digest("process executable"),
    rootIdentityDigest: contracts.sha256Digest("project root"),
  };
  return {
    ...body,
    identityDigest: contracts.digestCanonicalJson(body),
  };
}

export function processResult({
  outcome = "exited",
  exitCode = 0,
  signal = null,
  stopReason,
  outputTruncated = outcome === "output-limit",
} = {}) {
  const spawned = outcome !== "spawn-failed";
  const stopped = outcome !== "exited" && outcome !== "spawn-failed";
  const uncertain = outcome === "termination-uncertain";
  const reason =
    stopReason ?? (uncertain ? "timed-out" : stopped ? outcome : undefined);
  return {
    outcome,
    ...(spawned ? { identity: processIdentity() } : {}),
    startedAt: "2026-08-27T02:00:00.000Z",
    endedAt: "2026-08-27T02:00:00.010Z",
    durationMs: 10,
    exitCode,
    signal,
    ...(spawned ? {} : { spawnErrorCode: "ENOENT" }),
    output: {
      stdout: "",
      stderr: "",
      stdoutDigest: contracts.sha256Digest(""),
      stderrDigest: contracts.sha256Digest(""),
      stdoutObservedBytes: 0,
      stderrObservedBytes: 0,
      capturedBytes: 0,
      observedBytes: 0,
      truncated: outputTruncated,
    },
    termination: {
      requested: stopped,
      ...(reason === undefined ? {} : { reason }),
      escalated: stopped,
      confirmed: !uncertain,
    },
    mutationUncertain: stopped,
  };
}
