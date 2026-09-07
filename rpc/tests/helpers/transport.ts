import type { RpcClientFrame, RpcServerFrame, RpcClientTransport, RpcServerTransport } from "../../index.js";

export class Channel<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  send(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.values.length > 0) yield this.values.shift() as T;
      else if (this.closed) return;
      else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }
}

export function createTransportPair(): {
  readonly client: RpcClientTransport;
  readonly server: RpcServerTransport;
  readonly close: () => void;
} {
  const toServer = new Channel<RpcClientFrame>();
  const toClient = new Channel<RpcServerFrame>();
  const close = (): void => {
    toServer.close();
    toClient.close();
  };
  return {
    client: { incoming: toClient, send: (frame) => toServer.send(frame), close },
    server: { incoming: toServer, send: (frame) => toClient.send(frame), close },
    close,
  };
}

export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

