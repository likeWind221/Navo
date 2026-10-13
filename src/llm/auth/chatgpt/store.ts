import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import lockfile from "proper-lockfile";

import { ChatGPTAuthError } from "./error.js";
import { checkPermissions, protectDirectory } from "./permissions.js";
import { readAuthState } from "./schema.js";
import type { AuthState } from "./types.js";

export class ChatGPTStore {
  readonly directory: string;
  private readonly path: string;
  private ready: Promise<void> | undefined;

  constructor(home = process.env.NAVO_HOME ?? join(homedir(), ".navo")) {
    if (!home.trim()) throw new TypeError("NAVO_HOME must be a non-empty path.");
    this.directory = join(resolve(home), "auth");
    this.path = join(this.directory, "chatgpt.json");
  }

  async transaction<T>(operation: (state: AuthState) => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.ready ??= this.prepare();
    await this.ready;
    signal?.throwIfAborted();
    let compromised: Error | undefined;
    const pending = lockfile.lock(this.directory, {
      realpath: false,
      lockfilePath: join(this.directory, "chatgpt.lock"),
      retries: { retries: 400, minTimeout: 100, maxTimeout: 100 },
      onCompromised: error => { compromised = error; },
    });
    const release = await acquire(pending, signal);
    try {
      signal?.throwIfAborted();
      const state = await this.read();
      const original = JSON.stringify(state);
      const result = await operation(state);
      if (compromised) throw new ChatGPTAuthError("store-lock-lost", "The ChatGPT credential lock was lost.");
      if (JSON.stringify(state) !== original) await this.write(state);
      return result;
    } finally {
      await release();
    }
  }

  private async prepare(): Promise<void> {
    const created = await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (created !== undefined) await protectDirectory(this.directory);
    await checkPermissions(this.directory, true);
  }

  private async read(): Promise<AuthState> {
    try {
      await checkPermissions(this.directory, true);
      await checkPermissions(this.path, false);
      return readAuthState(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const state: AuthState = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
        await this.write(state);
        return state;
      }
      if (error instanceof SyntaxError) throw new ChatGPTAuthError("invalid-store", "The ChatGPT credential record is invalid JSON.");
      throw error;
    }
  }

  private async write(state: AuthState): Promise<void> {
    readAuthState(state);
    const temporary = join(this.directory, `${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await checkPermissions(temporary, false);
        await handle.writeFile(JSON.stringify(state), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function acquire(pending: Promise<() => Promise<void>>, signal?: AbortSignal): Promise<() => Promise<void>> {
  if (signal === undefined) return pending;
  return new Promise((resolve, reject) => {
    let aborted = false;
    const cancel = (): void => { aborted = true; reject(signal.reason); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    void pending.then(release => {
      signal.removeEventListener("abort", cancel);
      if (aborted) void release().catch(() => undefined);
      else resolve(release);
    }, error => { signal.removeEventListener("abort", cancel); reject(error); });
  });
}
