import { RpcError } from "./errors.js";
import { RPC_MAX_FRAME_CHARS } from "./protocol.js";
import { isJsonValue } from "./validation.js";

export class NdjsonDecoder<T> {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private buffer = "";
  private finished = false;

  constructor(private readonly parse: (value: unknown) => T) {}

  push(chunk: Uint8Array): readonly T[] {
    if (this.finished) throw new RpcError("connection-closed", "NDJSON decoder is finished");
    this.buffer += this.decode(chunk, true);
    return this.takeLines(false);
  }

  finish(): readonly T[] {
    if (this.finished) return [];
    this.finished = true;
    this.buffer += this.decode(undefined, false);
    return this.takeLines(true);
  }

  private decode(chunk: Uint8Array | undefined, stream: boolean): string {
    try {
      return this.decoder.decode(chunk, { stream });
    } catch (cause: unknown) {
      this.finished = true;
      this.buffer = "";
      throw new RpcError("invalid-frame", "NDJSON input is not valid UTF-8", { cause });
    }
  }

  private takeLines(flush: boolean): readonly T[] {
    const values: T[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) values.push(this.parseLine(line));
      newline = this.buffer.indexOf("\n");
    }
    if (this.buffer.length > RPC_MAX_FRAME_CHARS) {
      throw new RpcError("invalid-frame", "NDJSON frame exceeds the size limit");
    }
    if (flush && this.buffer.length > 0) {
      values.push(this.parseLine(this.buffer.replace(/\r$/, "")));
      this.buffer = "";
    }
    return values;
  }

  private parseLine(line: string): T {
    if (line.length > RPC_MAX_FRAME_CHARS) {
      throw new RpcError("invalid-frame", "NDJSON frame exceeds the size limit");
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (cause: unknown) {
      throw new RpcError("invalid-frame", "NDJSON frame is not valid JSON", { cause });
    }
    return this.parse(value);
  }
}

export function encodeNdjson(value: unknown): string {
  if (!isJsonValue(value)) throw new RpcError("invalid-frame", "NDJSON value must be JSON-safe");
  const line = JSON.stringify(value);
  if (line.length > RPC_MAX_FRAME_CHARS) {
    throw new RpcError("invalid-frame", "NDJSON frame exceeds the size limit");
  }
  return `${line}\n`;
}
