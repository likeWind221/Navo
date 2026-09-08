import type { Readable, Writable } from "node:stream";

import { NdjsonDecoder, encodeNdjson, parseRpcClientFrame } from "../../rpc/index.js";
import type { RpcError } from "../../rpc/index.js";
import type { RpcServerFrame, RpcServerTransport } from "../../rpc/index.js";

/** Server-side NDJSON transport over a child process's stdin and stdout. */
export class StdioRpcServerTransport implements RpcServerTransport {
  readonly incoming: AsyncIterable<unknown>;
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
    reportInvalidFrame: (error: RpcError) => void = reportInvalidFrameToStderr,
  ) {
    this.incoming = decodeInput(input, reportInvalidFrame);
  }

  send(frame: RpcServerFrame): Promise<void> {
    if (this.closed) return Promise.reject(new Error("stdio RPC transport is closed"));
    const line = encodeNdjson(frame);
    return new Promise<void>((resolve, reject) => {
      this.output.write(line, "utf8", (error) => error ? reject(error) : resolve());
    });
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    this.input.destroy();
    return new Promise<void>((resolve) => {
      if (this.output.destroyed || this.output.writableEnded) resolve();
      else this.output.end(resolve);
    });
  }
}

async function* decodeInput(
  input: Readable,
  reportInvalidFrame: (error: RpcError) => void,
): AsyncGenerator<unknown> {
  const decoder = new NdjsonDecoder(parseRpcClientFrame, { onInvalidFrame: reportInvalidFrame });
  for await (const chunk of input) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Uint8Array;
    for (const frame of decoder.push(bytes)) yield frame;
  }
  for (const frame of decoder.finish()) yield frame;
}

function reportInvalidFrameToStderr(error: RpcError): void {
  process.stderr.write(`[kernel-host] invalid RPC frame: ${error.message}\n`);
}
