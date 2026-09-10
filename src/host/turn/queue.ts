export class StreamEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private head = 0;
  private ended = false;
  private failure: { error: unknown } | undefined;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter({ done: false, value });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  fail(error: unknown): void {
    this.failure = { error };
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.head < this.values.length) {
        const value = this.values[this.head]!;
        this.head += 1;
        if (this.head === this.values.length) {
          this.values.length = 0;
          this.head = 0;
        }
        yield value;
      } else if (this.ended) {
        if (this.failure) throw this.failure.error;
        return;
      }
      else {
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
        if (next.done) {
          if (this.failure) throw this.failure.error;
          return;
        }
        yield next.value;
      }
    }
  }
}
