import { Context } from "cordis";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createMessageId, createSessionId } from "../../src/brand/ids.js";
import { STORAGE_APPLICATION_ID, STORAGE_SCHEMA_VERSION } from "../../src/storage/schema.js";
import { StorageService } from "../../src/storage/database.js";
import { rawSql, removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function close(ctx: Context) {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

async function app(path: string) {
  const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
  contexts.push(ctx);
  return ctx;
}

function snapshot(path: string) {
  const db = new DatabaseSync(path);
  try {
    return { version: db.prepare("PRAGMA user_version").get(),
      events: db.prepare("SELECT * FROM events ORDER BY domain, owner_id, seq").all(),
      bindings: db.prepare("SELECT * FROM workspace_bindings").all(),
      tables: db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() };
  } finally {
    db.close();
  }
}

function downgrade(path: string) {
  rawSql(path, `BEGIN;
    DROP TABLE library_folders;
    DROP TABLE resource_content;
    DROP TABLE resource_file_operations;
    DROP INDEX events_by_project;
    ALTER TABLE events RENAME TO events_v2;
    CREATE TABLE events (
      domain TEXT NOT NULL, owner_id TEXT NOT NULL,
      seq INTEGER NOT NULL CHECK (seq >= 1), project_id TEXT NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY (domain, owner_id, seq)
    ) STRICT;
    INSERT INTO events SELECT * FROM events_v2;
    DROP TABLE events_v2;
    CREATE INDEX events_by_project ON events (project_id, domain, owner_id, seq);
    PRAGMA user_version = 1;
    COMMIT;`);
}

describe("Known schema v1 upgrade", () => {
  it("preserves Project Sessions and Workspace records, then accepts standalone events without repeating upgrade", async () => {
    const path = await temporaryDatabase(roots, "navo-schema-upgrade-");
    const ctx = await app(path);
    const project = ctx.projects.create({ name: "Old project", goal: "Continue" });
    ctx.sessions.append({ type: "user-message", sessionId: project.mainSessionId,
      data: { message: { id: createMessageId("old"), role: "user", content: [{ type: "text", text: "Old question" }] } } });
    const messages = ctx.sessions.deriveMessages(project.mainSessionId);
    await close(ctx);
    rawSql(path, "INSERT INTO workspace_bindings VALUES ('" + project.id + "', '/old/workspace')");
    downgrade(path);
    const before = snapshot(path);
    const upgraded = await app(path);
    expect(upgraded.projects.get(project.id)).toEqual(project);
    expect(upgraded.sessions.deriveMessages(project.mainSessionId)).toEqual(messages);
    const after = snapshot(path);
    expect(after).toEqual({ ...before, tables: after.tables, version: { user_version: STORAGE_SCHEMA_VERSION } });
    upgraded.sessions.append({ type: "user-message", sessionId: createSessionId("plain"),
      data: { message: { id: createMessageId("plain"), role: "user", content: [{ type: "text", text: "New question" }] } } });
    const withPlain = snapshot(path);
    expect(withPlain.events.find(row => row.owner_id === "plain")?.project_id).toBeNull();
    await close(upgraded);
    const reopened = await app(path);
    expect(snapshot(path)).toEqual(withPlain);
    expect(reopened.sessions.deriveMessages(project.mainSessionId)).toEqual(messages);
  });

  it("retains corrupt JSON for Project isolation while upgrading", async () => {
    const path = await temporaryDatabase(roots, "navo-schema-corrupt-");
    const ctx = await app(path);
    const bad = ctx.projects.create({ name: "Bad", goal: null });
    const healthy = ctx.projects.create({ name: "Healthy", goal: null });
    await close(ctx);
    downgrade(path);
    rawSql(path, `UPDATE events SET payload = '{' WHERE project_id = '${bad.id}'`);
    const original = snapshot(path).events;
    const upgraded = await app(path);
    expect(upgraded.projects.get(bad.id)).toBeUndefined();
    expect(upgraded.projects.get(healthy.id)).toEqual(healthy);
    expect(snapshot(path).events).toEqual(original);
  });

  it("rolls back table replacement and version changes when copying a malformed old schema fails", async () => {
    const path = await temporaryDatabase(roots, "navo-schema-failure-");
    rawSql(path, `CREATE TABLE events (domain TEXT, owner_id TEXT, seq INTEGER, project_id TEXT, body TEXT);
      CREATE INDEX events_by_project ON events (project_id, domain, owner_id, seq);
      CREATE TABLE workspace_bindings (project_id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE);
      INSERT INTO events VALUES ('project', 'p1', 1, 'p1', 'original');
      PRAGMA application_id = ${STORAGE_APPLICATION_ID}; PRAGMA user_version = 1;`);
    const original = snapshot(path);
    const ctx = new Context();
    contexts.push(ctx);
    await expect(ctx.plugin(StorageService, { path })).rejects.toMatchObject({ code: "storage-unavailable" });
    expect(snapshot(path)).toEqual(original);
  });
});

for (const version of [2, 3, 4]) {
  it(`upgrades schema v${version} to v5 without changing existing records`, async () => {
    const path = await temporaryDatabase(roots, `navo-schema-v${version}-`);
    const ctx = await app(path);
    const project = ctx.projects.create({ name: "Preserved", goal: null });
    await close(ctx);
    rawSql(path, `DROP TABLE library_folders;
      ${version < 4 ? "DROP TABLE resource_content;" : ""}
      ${version < 3 ? "DROP TABLE resource_file_operations;" : ""}
      PRAGMA user_version = ${version};`);
    const before = snapshot(path);
    const upgraded = await app(path);
    expect(upgraded.projects.get(project.id)).toEqual(project);
    const after = snapshot(path);
    expect(after.events).toEqual(before.events);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.version).toEqual({ user_version: 5 });
    expect(after.tables).toContainEqual({ name: "library_folders" });
  });
}
