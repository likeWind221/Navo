import { Context } from "cordis";
import { afterEach, expect, it } from "vitest";
import { StorageService } from "../../src/storage/database.js";
import type { ResourceContentRecord } from "../../src/storage/content.js";
import { pendingContent } from "../../src/resource/content/store.js";
import { rawSql, removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await removeRoots(roots);
});

async function open(path = ":memory:") {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  return ctx;
}

it.each([2, 3])("migrates v%s to v4 once while preserving existing events", async version => {
  const path = await temporaryDatabase(roots, "navo-content-migration-");
  const first = await open(path);
  first.storage.atomic(tx => tx.appendEvents({ domain: "session", ownerId: "s", projectId: null, firstSeq: 1, events: ["existing"] }));
  await first.fiber.dispose();
  rawSql(path, `DROP TABLE resource_content; ${version === 2 ? "DROP TABLE resource_file_operations;" : ""} PRAGMA user_version = ${version};`);
  const next = await open(path);
  expect(next.storage.loadEvents("session").get("s")?.events).toEqual(["existing"]);
  const record = pendingContent("p", "r", 1);
  next.storage.atomic(tx => tx.putResourceContent(record));
  await next.fiber.dispose();
  const again = await open(path);
  expect(again.storage.atomic(tx => tx.getResourceContent("p", "r"))).toEqual(record);
});

it("isolates compound identities and uses conditional generation/attempt updates", async () => {
  const ctx = await open();
  const a = pendingContent("a", "same", 1);
  const b = pendingContent("b", "same", 1);
  ctx.storage.atomic(tx => { tx.putResourceContent(a); tx.putResourceContent(b); });
  ctx.storage.atomic(tx => {
    expect(tx.claimResourceContent("a", "same", 2, "wrong-generation")).toBe(false);
    expect(tx.claimResourceContent("a", "same", 1, "first")).toBe(true);
    expect(tx.claimResourceContent("a", "same", 1, "second")).toBe(false);
    expect(tx.finishResourceContent({ ...a, status: "ready", body: "body", extractor_version: "v1" }, "second")).toBe(false);
    expect(tx.finishResourceContent({ ...a, status: "ready", body: "body", extractor_version: "v1" }, "first")).toBe(true);
    expect(tx.getResourceContent("b", "same")).toEqual(b);
    expect(tx.listResourceContent("a")).toHaveLength(1);
    tx.deleteResourceContent("a", "same");
    expect(tx.getResourceContent("a", "same")).toBeUndefined();
    expect(tx.getResourceContent("b", "same")).toEqual(b);
  });
});

it("enforces frozen DDL invariants and rolls back body, page map and status together", async () => {
  const ctx = await open();
  const row = pendingContent("p", "r", 1);
  for (const patch of [
    { project_id: " " }, { resource_id: "" }, { source_asset_generation: 0 }, { status: "wrong" },
    { body: "unexpected" }, { status: "ready", body: " " }, { status: "ready", body: "body" },
    { status: "processing" }, { processing_attempt_id: "orphan" }, { status: "failed" },
    { page_map_json: "{}" }, { page_map_json: "[]" }, { extractor_version: "v1" }, { error_message: "x".repeat(1001) },
  ]) expect(() => ctx.storage.atomic(tx => tx.putResourceContent({ ...row, ...patch } as ResourceContentRecord))).toThrow();
  ctx.storage.atomic(tx => { tx.putResourceContent(row); tx.claimResourceContent("p", "r", 1, "attempt"); });
  expect(() => ctx.storage.atomic(tx => {
    tx.finishResourceContent({ ...row, status: "ready", body: "body", page_map_json: "[]", extractor_version: "v1" }, "attempt");
    throw Error("commit failure");
  })).toThrow("commit failure");
  expect(ctx.storage.atomic(tx => tx.getResourceContent("p", "r"))).toMatchObject({ status: "processing", body: null, page_map_json: null, extractor_version: null });
});
