import type { RpcClientFrame, RpcServerFrame } from "./protocol.js";

export interface RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;
  send(frame: RpcClientFrame): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface RpcServerTransport {
  readonly incoming: AsyncIterable<unknown>;
  send(frame: RpcServerFrame): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface RpcStreamOptions {
  readonly signal?: AbortSignal;
}

export type RpcStreamHandler<TInput, TOutput> = (
  input: TInput,
  signal: AbortSignal,
) => AsyncIterable<TOutput>;
