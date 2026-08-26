import assert from "node:assert/strict";
import test from "node:test";

import { CliDeadlineError, runWithDeadline } from "../dist/deadline.js";

test("deadline wrapper returns completed read-only work and clears its timer", async () => {
  assert.equal(await runWithDeadline(async () => "done", 100), "done");
});

test("deadline wrapper rejects work that exceeds the registered duration", async () => {
  await assert.rejects(
    runWithDeadline(() => new Promise(() => {}), 5),
    (error) => error instanceof CliDeadlineError && error.timeoutMs === 5,
  );
  await assert.rejects(runWithDeadline(async () => "done", 0), RangeError);
});
