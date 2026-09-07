import type { Readable, Writable } from "node:stream";

import {
  NdjsonDecoder,
  encodeNdjson,
} from "../../../../rpc/index.js";
import type {
  RpcClientFrame,
  RpcClientTransport,
} from "../../../../rpc/index.js";

/** Client-side NDJSON transport over a Kernel Host child process. */
export class StdioRpcClientTransport implements RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;
  private writeChain = Promise.resolve();
  private closed = false;

  constructor(
    output: Readable,
    private readonly input: Writable,
  ) {
    this.incoming = decodeOutput(output);
  }

  send(frame: RpcClientFrame): Promise<void> {
    if (this.closed) return Promise.reject(new Error("stdio RPC transport is closed"));
    const line = encodeNdjson(frame);
    const pending = this.writeChain.then(() => write(this.input, line));
    this.writeChain = pending.catch(() => undefined);
    return pending;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.writeChain;
    await end(this.input);
  }
}

async function* decodeOutput(output: Readable): AsyncGenerator<unknown> {
  const decoder = new NdjsonDecoder<unknown>((value) => value);
  for await (const chunk of output) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Uint8Array;
    for (const frame of decoder.push(bytes)) yield frame;
  }
  for (const frame of decoder.finish()) yield frame;
}

function write(input: Writable, line: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    input.write(line, "utf8", (error) => error ? reject(error) : resolve());
  });
}

function end(input: Writable): Promise<void> {
  if (input.destroyed || input.writableEnded) return Promise.resolve();
  return new Promise<void>((resolve) => input.end(resolve));
}
