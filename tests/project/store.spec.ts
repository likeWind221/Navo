import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createMessageId, createProjectId } from "../../src/brand/ids.js";
import { ProjectStore } from "../../src/project/store.js";
import { PROJECT_GOAL_MAX_CHARS } from "../../src/project/model.js";
import { projectProject } from "../../src/project/projector.js";
import { StorageService } from "../../src/storage/database.js";
import { MEMORY_STORAGE, memoryStorage } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function store(path?: string): Promise<ProjectStore> {
  return (await domain(path)).projects;
}

async function domain(path?: string): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  if (path === undefined) await memoryStorage(ctx);
  else await ctx.plugin(StorageService, { path });
  await ctx.plugin(ProjectStore);
  return ctx;
}

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-project-store-"));
  roots.push(root);
  return join(root, "navo.db");
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

describe("Project domain", () => {
  it("owns a fixed main session and reloads its lifecycle after reopening storage", async () => {
    const path = await databasePath();
    const sourceCtx = await domain(path);
    const source = sourceCtx.projects;
    const first = source.create({ name: "Project", goal: "Investigate reproducible agent execution" });
    const second = source.create({ name: "Project", goal: "Separate project" });
    expect(first).toMatchObject({ status: "active", revision: 1 });
    expect(first.id).not.toBe(second.id);
    expect(first.mainSessionId).not.toBe(second.mainSessionId);
    expect(source.getByMainSession(first.mainSessionId)).toEqual(first);
    expect(source.archive(first.id, "User paused this project")).toMatchObject({
      status: "archived", revision: 2, mainSessionId: first.mainSessionId,
    });
    const reopened = source.reopen(first.id, "Continue research");
    const history = JSON.parse(JSON.stringify(source.getEvents(first.id)));
    expect(projectProject(first.id, history)).toEqual(reopened);
    expect((await store()).restore(first.id, history)).toEqual(reopened);
    await close(sourceCtx);

    const target = await store(path);
    expect(target.getEvents(first.id)).toEqual(history);
    expect(target.getByMainSession(first.mainSessionId)).toEqual(reopened);
    expect(target.get(second.id)).toEqual(second);
    expect(target.archive(first.id, "Finished this work period").revision).toBe(4);
  });

  it("persists goal and lifecycle changes across a storage restart", async () => {
    const path = await databasePath();
    const first = await domain(path);
    const project = first.projects.create({ name: "Project", goal: null });
    first.projects.setGoal(project.id, "Durable goal");
    first.projects.archive(project.id, "Pause");
    first.projects.reopen(project.id, "Resume");
    const before = first.projects.list();
    await close(first);

    const second = await store(path);
    expect(second.list()).toEqual(before);
    expect(second.get(project.id)).toMatchObject({ goal: "Durable goal", status: "active", revision: 4 });
  });

  it("reports a failed save to the caller and leaves memory unchanged", async () => {
    const path = await databasePath();
    const ctx = await domain(path);
    const project = ctx.projects.create({ name: "Project", goal: "Before" });
    const changed: string[] = [];
    ctx.on("project/changed", projectId => changed.push(projectId));
    raw(path, "CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    expect(() => ctx.projects.setGoal(project.id, "After"))
      .toThrow(expect.objectContaining({ name: "StorageError", code: "write-failed" }));
    expect(() => ctx.projects.create({ name: "Other", goal: null }))
      .toThrow(expect.objectContaining({ code: "write-failed" }));
    expect(ctx.projects.get(project.id)).toEqual(project);
    expect(ctx.projects.list()).toEqual([project]);
    expect(changed).toEqual([]);

    raw(path, "DROP TRIGGER fail_events");
    expect(ctx.projects.setGoal(project.id, "After").revision).toBe(2);
    expect(changed).toEqual([project.id]);
  });

  it("refuses to start from a stored history that fails validation", async () => {
    const path = await databasePath();
    const ctx = await domain(path);
    const project = ctx.projects.create({ name: "Project", goal: "Goal" });
    await close(ctx);
    raw(path, `UPDATE events SET payload = json_set(payload, '$.revision', 7) WHERE owner_id = '${project.id}'`);

    await expect(domain(path)).rejects.toMatchObject({ name: "StorageError", code: "invalid-record" });
  });

  it("rejects invalid commands without committing or changing prior snapshots", async () => {
    const projects = await store();
    expect(() => projects.create({ name: "Project", goal: "  " })).toThrow("goal must be non-empty");
    const created = projects.create({ name: "Project", goal: "Valid goal" });
    const before = projects.getEvents(created.id);
    expect(() => projects.reopen(created.id, "Already active")).toThrow("current Project state");
    expect(() => projects.archive(created.id, " ")).toThrow("lifecycle reason");
    expect(projects.getEvents(created.id)).toBe(before);
    projects.archive(created.id, "Archive");
    expect(() => projects.archive(created.id, "Again")).toThrow("current Project state");
    expect(created.status).toBe("active");
    expect(projects.getEvents(created.id)).toHaveLength(2);
    expect(() => projects.archive(createProjectId("missing"), "Archive"))
      .toThrow(expect.objectContaining({ code: "project-not-found" }));
  });

  it("restores atomically and reserves a main session even for archived projects", async () => {
    const projects = await store();
    const first = projects.create({ name: "Project", goal: "First" });
    projects.archive(first.id, "Archive");
    const other = createProjectId("other");
    const duplicate = projects.getEvents(first.id).map(event => ({ ...event, projectId: other }));
    expect(() => projects.restore(other, duplicate))
      .toThrow(expect.objectContaining({ code: "session-already-owned" }));
    expect(projects.get(other)).toBeUndefined();
    expect(() => projects.restore(first.id, projects.getEvents(first.id)))
      .toThrow(expect.objectContaining({ code: "project-already-exists" }));
    expect(() => projects.restore(other, []))
      .toThrow(expect.objectContaining({ code: "invalid-event-stream" }));
  });

  it("detaches imported history and freezes stored facts", async () => {
    const source = await store();
    const created = source.create({ name: "Project", goal: "Original goal" });
    const imported = JSON.parse(JSON.stringify(source.getEvents(created.id)));
    const target = await store();
    const snapshot = target.restore(created.id, imported);
    imported[0].data.goal = "Changed elsewhere";
    imported.push(imported[0]);
    expect(target.get(created.id)).toEqual(snapshot);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(target.getEvents(created.id))).toBe(true);
    expect(Object.isFrozen(target.getEvents(created.id)[0]?.data)).toBe(true);
  });

  it("is mounted in the app and keeps project state separate from conversation history", async () => {
    const ctx = await createApp({ storage: MEMORY_STORAGE, node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(ctx);
    const project = ctx.projects.create({ name: "Project", goal: "Long-running goal" });
    expect(ctx.sessions.getEvents(project.mainSessionId)).toEqual([]);
    ctx.sessions.append({
      type: "user-message",
      sessionId: project.mainSessionId,
      data: { message: {
        id: createMessageId("main-user"), role: "user", content: [{ type: "text", text: "Continue" }],
      } },
    });
    expect(ctx.projects.get(project.id)).toEqual(project);
    expect(ctx.sessions.deriveMessages(project.mainSessionId)).toHaveLength(1);
  });
  it("creates without a goal, sets it once confirmed and rebuilds it from history", async () => {
    const source = await store();
    const changed: string[] = [];
    contexts.at(-1)!.on("project/changed", projectId => { changed.push(projectId); });
    const draft = source.create({ name: "Draft", goal: null });
    expect(draft).toMatchObject({ goal: null, revision: 1 });

    expect(() => source.setGoal(draft.id, " \t ")).toThrow(expect.objectContaining({ code: "invalid-goal" }));
    expect(() => source.setGoal(draft.id, "x".repeat(PROJECT_GOAL_MAX_CHARS + 1)))
      .toThrow(expect.objectContaining({ code: "invalid-goal" }));
    expect(() => source.setGoal(createProjectId("missing"), "Goal"))
      .toThrow(expect.objectContaining({ code: "project-not-found" }));
    expect(source.getEvents(draft.id)).toHaveLength(1);

    const set = source.setGoal(draft.id, "Survey agent memory");
    expect(set).toMatchObject({ goal: "Survey agent memory", revision: 2 });
    expect(changed).toEqual([draft.id, draft.id]);
    const history = JSON.parse(JSON.stringify(source.getEvents(draft.id)));
    expect(history.map((event: { type: string }) => event.type)).toEqual(["project-created", "project-goal-set"]);
    expect((await store()).restore(draft.id, history)).toEqual(set);

    source.archive(draft.id, "Pause");
    expect(() => source.setGoal(draft.id, "Late")).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    const [created, goalSet] = history;
    expect(() => projectProject(draft.id, [{ ...goalSet, revision: 1 }])).toThrow("missing or archived");
    expect(() => projectProject(draft.id, [created, { ...goalSet, data: { goal: " " } }])).toThrow("goal must be non-empty");
  });

  it("keeps a name and creation time and lists Projects", async () => {
    const projects = await store();
    expect(() => projects.create({ name: " ", goal: "Goal" })).toThrow("name must be non-empty");
    const first = projects.create({ name: "Paper", goal: "Survey" });
    const second = projects.create({ name: "Code", goal: "Build" });
    expect(first).toMatchObject({ name: "Paper", goal: "Survey" });
    expect(first.createdAt).toBe(projects.getEvents(first.id)[0]?.timestamp);
    expect(projects.list()).toEqual([first, second]);
  });
});
