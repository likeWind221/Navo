export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private terminalError: Error | undefined;
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  fail(error: Error): void {
    if (this.ended) return;
    this.terminalError = error;
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.values.length > 0) yield this.values.shift() as T;
      else if (this.ended) {
        if (this.terminalError) throw this.terminalError;
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (result.done) {
          if (this.terminalError) throw this.terminalError;
          return;
        }
        yield result.value;
      }
    }
  }
}
