import {
  Transform,
  type Readable,
  type TransformCallback,
} from "node:stream";

export const MCP_STDIO_MAX_SESSION_RAW_INPUT_BYTES: number =
  16 * 1_024 * 1_024;

export class BoundedMcpStdioInput extends Transform {
  private receivedBytes = 0;

  constructor(
    private readonly maxInputBytes: number =
      MCP_STDIO_MAX_SESSION_RAW_INPUT_BYTES,
  ) {
    super();
    if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes <= 0) {
      throw new TypeError("MCP STDIO raw input budget is invalid.");
    }
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    if (chunk.byteLength > this.maxInputBytes - this.receivedBytes) {
      callback(new Error("MCP STDIO raw input budget exceeded."));
      return;
    }
    this.receivedBytes += chunk.byteLength;
    callback(null, chunk);
  }
}

export function pipeMcpStdioInput(
  source: Readable,
  input: BoundedMcpStdioInput,
): () => void {
  let attached = true;
  function onSourceError(error: Error): void {
    input.destroy(error);
  }
  function onInputClose(): void {
    detach();
  }
  function detach(): void {
    if (!attached) {
      return;
    }
    attached = false;
    source.unpipe(input);
    source.off("error", onSourceError);
    input.off("close", onInputClose);
  }

  source.once("error", onSourceError);
  input.once("close", onInputClose);
  source.pipe(input);
  return detach;
}
