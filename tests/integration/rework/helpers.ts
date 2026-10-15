import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";
import { afterEach } from "vitest";
import { createApp } from "../../../src/app.js";
import { createNodeId } from "../../../src/brand/ids.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import { removeRoots, temporaryDatabase } from "../../helpers/storage.js";
import { scenario } from "./script.js";

const apps = new Set<Context>();
const roots: string[] = [];

afterEach(async () => {
  await Promise.all([...apps].map(app => app.fiber.dispose()));
  apps.clear();
  await removeRoots(roots);
});

export async function createWorld() {
  const path = await temporaryDatabase(roots, "navo-f105-db-");
  const root = await mkdtemp(join(tmpdir(), "navo-f105-"));
  roots.push(root);
  await writeFile(join(root, "draft.txt"), "DRAFT_BODY: candidate A looks best.");
  await writeFile(join(root, "sourced.txt"), "SOURCED_BODY: candidate A meets the requirement (source: benchmark log 2026-10).");
  await writeFile(join(root, "validation.txt"), "VALIDATION_BODY: an independent repeat confirms candidate A.");
  const script = scenario();
  let consumed = 0;
  let adapter = new MockLLMAdapter([]);

  const open = async () => {
    const app = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "rework" } } } });
    apps.add(app);
    adapter = new MockLLMAdapter(script.entries.slice(consumed));
    app.llm.registerAdapter("mock", adapter);
    return app;
  };
  const restart = async (app: Context) => {
    consumed += adapter.requests.length;
    apps.delete(app);
    await app.fiber.dispose();
    return open();
  };
  const nodeId = (key: string) => {
    const value = script.ids.get(key);
    if (!value) throw new Error(`Missing Node receipt: ${key}`);
    return createNodeId(value);
  };
  return {
    root, open, restart, nodeId,
    requests: () => consumed + adapter.requests.length,
    remaining: () => adapter.remainingEntries,
  };
}
