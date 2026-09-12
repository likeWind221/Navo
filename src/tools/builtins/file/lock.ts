/** Serializes structured mutations that target the same canonical file. */
export class FileMutationCoordinator {
  readonly #targets = new TargetLocks();

  runTarget<T>(targetPath: string, work: () => Promise<T>): Promise<T> {
    return this.#targets.run(targetPath, work);
  }
}

class TargetLocks {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate, () => gate);
    this.#tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
