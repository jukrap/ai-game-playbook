import type { FileHandle } from "node:fs/promises";

const INTERNAL_MAX_BOUNDED_FILE_BYTES: number = 64 * 1024 * 1024;

export class BoundedFileReadLimitError extends Error {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`file content exceeds ${maxBytes} bytes`);
    this.name = "BoundedFileReadLimitError";
    this.maxBytes = maxBytes;
  }
}

export async function readFileHandleBounded(
  handle: FileHandle,
  maxBytes: number,
): Promise<Buffer> {
  if (
    typeof handle !== "object" ||
    handle === null ||
    typeof handle.read !== "function" ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > INTERNAL_MAX_BOUNDED_FILE_BYTES
  ) {
    throw new RangeError("bounded file read arguments are outside runtime limits");
  }

  const capacity = maxBytes + 1;
  const buffer = Buffer.allocUnsafe(capacity);
  let offset = 0;
  while (offset < capacity) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      capacity - offset,
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset > maxBytes) {
    throw new BoundedFileReadLimitError(maxBytes);
  }
  return Buffer.from(buffer.subarray(0, offset));
}
