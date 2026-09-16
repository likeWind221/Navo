import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createMessageId, createProjectId } from "../../src/brand/ids.js";
import { ProjectStore } from "../../src/project/store.js";
import { projectProject } from "../../src/project/projector.js";

const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
});

async function store(): Promise<ProjectStore> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  return ctx.projects;
}

describe("Project domain", () => {
  it("owns a fixed main session and rebuilds a lifecycle in a fresh store", async () => {
    const source = await store();
    const first = source.create({ goal: "Investigate reproducible agent execution" });
    const second = source.create({ goal: "Separate project" });
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
    const target = await store();
    expect(target.restore(first.id, history)).toEqual(reopened);
    expect(target.getByMainSession(first.mainSessionId)).toEqual(reopened);
    expect(target.archive(first.id, "Finished this work period").revision).toBe(4);
    expect(source.get(first.id)?.revision).toBe(3);
    expect(source.get(second.id)).toEqual(second);
  });

  it("rejects invalid commands without committing or changing prior snapshots", async () => {
    const projects = await store();
    expect(() => projects.create({ goal: "  " })).toThrow("goal must be non-empty");
    const created = projects.create({ goal: "Valid goal" });
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
    const first = projects.create({ goal: "First" });
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
    const created = source.create({ goal: "Original goal" });
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
    const ctx = await createApp({ node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(ctx);
    const project = ctx.projects.create({ goal: "Long-running goal" });
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
});
