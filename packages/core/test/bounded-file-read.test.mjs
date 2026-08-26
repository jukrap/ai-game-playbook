import assert from "node:assert/strict";
import { open, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BoundedFileReadLimitError,
  readFileHandleBounded,
} from "../dist/bounded-file-read.js";

test("bounded file reads return exact bytes without reading past the limit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "agpb-bounded-read-"));
  const path = join(directory, "record.bin");
  await writeFile(path, Buffer.from([0, 1, 2, 3]));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const handle = await open(path, "r");
  try {
    const content = await readFileHandleBounded(handle, 4);
    assert.deepEqual([...content], [0, 1, 2, 3]);
    assert.equal(content.byteLength, 4);
  } finally {
    await handle.close();
  }
});

test("bounded file reads witness one excess byte and stop", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "agpb-bounded-read-"));
  const path = join(directory, "record.bin");
  await writeFile(path, Buffer.alloc(1024, 0x61));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const handle = await open(path, "r");
  try {
    await assert.rejects(
      readFileHandleBounded(handle, 8),
      (error) =>
        error instanceof BoundedFileReadLimitError &&
        error.maxBytes === 8,
    );
  } finally {
    await handle.close();
  }
});

test("bounded file reads reject invalid allocation authority before I/O", async () => {
  const fakeHandle = {
    read() {
      throw new Error("must not read");
    },
  };
  await assert.rejects(
    readFileHandleBounded(fakeHandle, 0),
    (error) => error instanceof RangeError,
  );
});
