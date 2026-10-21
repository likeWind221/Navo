import { Context } from "cordis";
import { afterEach, expect, it } from "vitest";
import { StorageService } from "../../src/storage/database.js";
import type { FileOperation } from "../../src/storage/operations.js";
import { rawSql, removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await removeRoots(roots);
});

function operation(): FileOperation {
  return { operation_id: "create-1", project_id: "project", resource_id: null, operation_kind: "create", request_json: "{}",
    execution_state: "staging", business_result: "pending", base_revision: 0, source_generation: null, target_generation: 1,
    staging_relpath: "staging/resource-intake/create-1/source", target_relpath: null, cleanup_targets_json: "[]", error_code: null,
    created_at: "2026-10-19T00:00:00.000Z", updated_at: "2026-10-19T00:00:00.000Z" };
}

async function open(path: string) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  return ctx;
}

it("upgrades v2 once and provides operation CRUD and pending queries on the existing transaction", async () => {
  const path = await temporaryDatabase(roots, "navo-operations-");
  const first = await open(path);
  first.storage.atomic(tx => tx.appendEvents({ domain: "session", ownerId: "ordinary", projectId: null, firstSeq: 1, events: [{ existing: true }] }));
  await first.fiber.dispose();
  rawSql(path, "DROP TABLE resource_content; DROP TABLE resource_file_operations; PRAGMA user_version = 2;");
  const ctx = await open(path);
  expect(ctx.storage.loadEvents("session").get("ordinary")?.events).toEqual([{ existing: true }]);
  const record = operation();
  ctx.storage.atomic(tx => tx.insertFileOperation(record));
  expect(ctx.storage.atomic(tx => tx.getFileOperation(record.operation_id))).toEqual(record);
  expect(ctx.storage.atomic(tx => tx.pendingFileOperations())).toEqual([record]);
  const updated: FileOperation = { ...record, resource_id: "r", business_result: "failed", execution_state: "failed" };
  ctx.storage.atomic(tx => tx.updateFileOperation(updated));
  expect(ctx.storage.atomic(tx => tx.pendingFileOperations())).toEqual([]);
  await ctx.fiber.dispose();
  const reopened = await open(path);
  expect(reopened.storage.atomic(tx => tx.getFileOperation(record.operation_id))).toEqual(updated);
  reopened.storage.atomic(tx => tx.deleteFileOperation(record.operation_id));
  expect(reopened.storage.atomic(tx => tx.getFileOperation(record.operation_id))).toBeUndefined();
});

it("rejects duplicate identities, invalid states, terminal side effects, generation relations and changed ownership", async () => {
  const ctx = await open(":memory:");
  const record = operation();
  ctx.storage.atomic(tx => tx.insertFileOperation(record));
  expect(() => ctx.storage.atomic(tx => tx.insertFileOperation(record))).toThrow();
  for (const patch of [
    { execution_state: "unknown" },
    { execution_state: "completed", resource_id: "r", business_result: "failed" },
    { execution_state: "failed", business_result: "failed", cleanup_targets_json: '["leftover"]' },
    { execution_state: "prepared" },
    { target_generation: 0 },
    { cleanup_targets_json: "{}" },
    { resource_id: "r", project_id: "other" },
  ]) expect(() => ctx.storage.atomic(tx => tx.updateFileOperation({ ...record, ...patch } as FileOperation))).toThrow();
  expect(ctx.storage.atomic(tx => tx.getFileOperation(record.operation_id))).toEqual(record);
});

it("rolls back both operation committed marker and Resource event if their transaction fails", async () => {
  const ctx = await open(":memory:");
  const record = operation();
  ctx.storage.atomic(tx => tx.insertFileOperation(record));
  expect(() => ctx.storage.atomic(tx => {
    tx.appendEvents({ domain: "resource", ownerId: "project", projectId: "project", firstSeq: 1, events: [{ operationId: record.operation_id }] });
    tx.updateFileOperation({ ...record, resource_id: "r", execution_state: "committed", business_result: "succeeded" });
    throw new Error("injected transaction failure");
  })).toThrow("injected transaction failure");
  expect(ctx.storage.loadEvents("resource").size).toBe(0);
  expect(ctx.storage.atomic(tx => tx.getFileOperation(record.operation_id))).toEqual(record);
});
