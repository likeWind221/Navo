import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { StorageService } from "../../src/storage/database.js";
import { STORAGE_APPLICATION_ID } from "../../src/storage/schema.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-storage-"));
  roots.push(root);
  const path = join(root, "home", "navo.db");
  await mkdir(dirname(path));
  return path;
}

async function open(path: string): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  return ctx;
}

async function close(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

function raw(path: string, statement: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(statement);
  } finally {
    db.close();
  }
}

describe("StorageService", () => {
  it("initializes a new database and reads committed events after reopening", async () => {
    const path = await databasePath();
    const first = await open(path);
    first.storage.write(tx => {
      tx.appendEvents({ domain: "project", ownerId: "p1", projectId: "p1", firstSeq: 1, events: [{ n: 1 }, { n: 2 }] });
      tx.bindWorkspace({ projectId: "p1", root: "/work/p1" });
    }, () => {});
    await close(first);

    const db = new DatabaseSync(path);
    expect(db.prepare("PRAGMA application_id").get()).toEqual({ application_id: STORAGE_APPLICATION_ID });
    expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    db.close();

    const second = await open(path);
    expect([...second.storage.loadEvents("project")]).toEqual([["p1", [{ n: 1 }, { n: 2 }]]]);
    expect(second.storage.loadWorkspaceBindings()).toEqual([{ projectId: "p1", root: "/work/p1" }]);
  });

  it("refuses unknown schema versions, foreign databases and unreadable files", async () => {
    const newer = await databasePath();
    await close(await open(newer));
    raw(newer, "PRAGMA user_version = 99");
    await expect(open(newer)).rejects.toMatchObject({ code: "schema-unsupported" });

    const foreign = await databasePath();
    raw(foreign, "CREATE TABLE other (id TEXT)");
    await expect(open(foreign)).rejects.toMatchObject({ code: "schema-unsupported" });

    const garbage = await databasePath();
    await open(garbage).then(close);
    await rm(garbage);
    await writeFile(garbage, "not a sqlite database".repeat(64), "utf8");
    await expect(open(garbage)).rejects.toMatchObject({ code: "storage-unavailable" });
  });

  it("applies memory changes only after commit and drops them on rollback", async () => {
    const ctx = await open(":memory:");
    const applied: string[] = [];

    expect(() => ctx.storage.atomic(() => {
      ctx.storage.write(tx => tx.appendEvents({
        domain: "project", ownerId: "p1", projectId: "p1", firstSeq: 1, events: [{}],
      }), () => applied.push("event"));
      ctx.storage.write(tx => tx.bindWorkspace({ projectId: "p1", root: "/same" }), () => applied.push("bind"));
      ctx.storage.write(tx => tx.bindWorkspace({ projectId: "p2", root: "/same" }), () => applied.push("conflict"));
    })).toThrow(expect.objectContaining({ code: "write-failed" }));
    expect(applied).toEqual([]);
    expect(ctx.storage.loadEvents("project").size).toBe(0);
    expect(ctx.storage.loadWorkspaceBindings()).toEqual([]);

    const result = ctx.storage.atomic(() => {
      ctx.storage.write(tx => tx.appendEvents({
        domain: "project", ownerId: "p1", projectId: "p1", firstSeq: 1, events: [{}],
      }), () => applied.push("event"));
      ctx.storage.write(tx => tx.bindWorkspace({ projectId: "p1", root: "/same" }), () => applied.push("bind"));
      expect(applied).toEqual([]);
      return "done";
    });
    expect(result).toBe("done");
    expect(applied).toEqual(["event", "bind"]);
  });

  it("rejects appends that do not continue the stored sequence", async () => {
    const ctx = await open(":memory:");
    const append = (firstSeq: number) => ctx.storage.write(tx => tx.appendEvents({
      domain: "project", ownerId: "p1", projectId: "p1", firstSeq, events: [{}],
    }), () => {});

    expect(() => append(2)).toThrow(expect.objectContaining({ code: "sequence-conflict" }));
    append(1);
    expect(() => append(1)).toThrow(expect.objectContaining({ code: "sequence-conflict" }));
    append(2);
    expect(ctx.storage.loadEvents("project").get("p1")).toHaveLength(2);
  });

  it("reports stored rows that cannot be decoded", async () => {
    const path = await databasePath();
    await close(await open(path));
    raw(path, "INSERT INTO events VALUES ('project', 'p1', 1, 'p1', '{broken')");
    const ctx = await open(path);

    expect(() => ctx.storage.loadEvents("project")).toThrow(expect.objectContaining({ code: "invalid-record" }));
  });
});
