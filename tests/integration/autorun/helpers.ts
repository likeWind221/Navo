import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";
import { afterEach } from "vitest";

import { createApp } from "../../../src/app.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import { temporaryDatabase } from "../../helpers/storage.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";

const apps = new Set<Context>();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all([...apps].map(app => app.fiber.dispose()));
  apps.clear();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

export async function createWorld(entries: readonly MockLLMEntry[]) {
  const path = await temporaryDatabase(roots, "navo-f114-storage-");
  const workspaceRoot = await mkdtemp(join(tmpdir(), "navo-f114-workspace-"));
  roots.push(workspaceRoot);

  let consumed = 0;
  let adapter: MockLLMAdapter;

  const open = async () => {
    const app = await createApp({
      storage: { path },
      node: { session: { model: { provider: "mock", model: "autorun" } } },
    });
    adapter = new MockLLMAdapter(entries.slice(consumed));
    app.llm.registerAdapter("mock", adapter);
    apps.add(app);
    return app;
  };

  const restart = async (app: Context) => {
    consumed += adapter.requests.length;
    apps.delete(app);
    await app.fiber.dispose();
    return open();
  };

  return {
    path,
    workspaceRoot,
    open,
    restart,
    requests: () => consumed + adapter.requests.length,
  };
}

export async function flushUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 100 && !condition(); index += 1) {
    await Promise.resolve();
  }
  if (!condition()) throw new Error("expected asynchronous boundary was not reached");
}
