import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createGenerateRequest } from "../../src/agent/request.js";
import { createToolCallId } from "../../src/brand/ids.js";
import type { MockLLMEntry } from "../../src/llm/adapters/mock.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { reminderTexts, turnSnapshot } from "../helpers/context.js";
import { modelResponse } from "../helpers/runtime.js";
import { MEMORY_STORAGE } from "../helpers/storage.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "navo-context-"));
  roots.push(root);
  const app = await createApp({ storage: MEMORY_STORAGE,
    node: { session: { model: { provider: "mock", model: "context" } } } });
  apps.push(app);
  const entries: MockLLMEntry[] = [];
  const adapter = {
    requests: [] as GenerateRequest[],
    enqueue(entry: MockLLMEntry) { entries.push(entry); },
    async *stream(request: GenerateRequest) {
      this.requests.push(request);
      yield* new MockLLMAdapter([entries.shift()!]).stream(request);
    },
  };
  app.llm.registerAdapter("mock", adapter);
  const project = app.projects.create({ name: "Project", goal: "Original goal" });
  await app.projectWorkspaces.create(project.id, root);
  const node = app.nodes.create({ projectId: project.id, objective: {
    title: "Own objective", description: "Work", acceptanceCriteria: ["Done"],
  } });
  app.nodes.unlock(node.node.id, "Ready");
  return { app, adapter, root, project, node };
}

const done = () => modelResponse([{ type: "text", text: "done" }]);
const call = (id: string, name: string, args: unknown) => modelResponse([{
  type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(args),
}], "tool-calls");
const state = (request: GenerateRequest) => turnSnapshot(request).sections.find(section => section.kind === "runtime-state");

describe("F13.4a request context", () => {
  it("refreshes Main goal and Node status between requests while keeping its profile fixed", async () => {
    const { app, adapter, project, node } = await fixture();
    adapter.enqueue(call("goal", "set_project_goal", { goal: "Agreed new goal" }));
    adapter.enqueue({ kind: "handler", handle(request) {
      expect(state(request)).toMatchObject({ data: { goal: "Agreed new goal" } });
      app.nodes.lock(node.node.id, "Human paused prerequisites");
      return call("read", "read_roadmap", {}).events;
    } });
    adapter.enqueue(done());
    const result = await app.mainSessions.sendMessage({ projectId: project.id, text: "I agree to the new goal." });
    expect(result.turn.status).toBe("completed");
    const [first, second, third] = adapter.requests;
    expect(state(first!)).toMatchObject({ data: { goal: "Original goal" } });
    expect(state(third!)).toMatchObject({ data: { goal: "Agreed new goal", nodes: [{ status: "locked" }] } });
    expect(first!.messages[0]).toEqual(second!.messages[0]);
    expect(second!.messages[0]).toEqual(third!.messages[0]);
    expect(JSON.stringify(first!.messages[0])).not.toContain("Original goal");
    expect(reminderTexts(third!).join()).toContain("locked");
    expect(app.sessions.getEvents(project.mainSessionId).filter(event => event.type === "turn-started")).toHaveLength(1);
    expect(JSON.stringify(app.sessions.getEvents(project.mainSessionId))).not.toContain("<turn-context>");
  });

  it("refreshes Node grants within one Turn, retains reminders only for that Turn, and never persists snapshots", async () => {
    const { app, adapter, root, project, node } = await fixture();
    await writeFile(join(root, "source.txt"), "PRIVATE BODY");
    const resource = await app.resources.publish({ projectId: project.id, owner: { kind: "main" },
      name: "Shared evidence", description: "metadata", type: "text/plain", sourceRef: "source.txt" });
    adapter.enqueue({ kind: "handler", handle(request) {
      expect(JSON.stringify(turnSnapshot(request))).not.toContain(resource.id);
      app.resources.setAccess({ projectId: project.id, actor: { kind: "main" }, resourceId: resource.id,
        expectedRevision: resource.revision, access: { kind: "shared", nodeIds: [node.node.id] } });
      app.projects.setGoal(project.id, "Latest goal");
      return call("notice", "send_to_main", { message: "Continuing" }).events;
    } });
    adapter.enqueue(call("again", "send_to_main", { message: "Still working" }));
    adapter.enqueue(done());
    adapter.enqueue(done());
    const first = await app.nodeSessions.start({ nodeId: node.node.id, text: "Work" });
    expect(first.turn.status).toBe("completed");
    const [before, after, later] = adapter.requests;
    expect(state(after!)).toMatchObject({ data: { projectGoal: "Latest goal", status: "working" } });
    expect(JSON.stringify(turnSnapshot(after!))).toContain(resource.id);
    expect(JSON.stringify(turnSnapshot(after!))).not.toContain("PRIVATE BODY");
    expect(JSON.stringify(turnSnapshot(after!))).not.toContain("resource-catalog");
    expect(reminderTexts(after!)).toHaveLength(1);
    expect(reminderTexts(later!)).toEqual(reminderTexts(after!));
    expect(before!.messages[0]).toEqual(after!.messages[0]);
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Continue" });
    expect(reminderTexts(adapter.requests[3]!)).toEqual([]);
    expect(JSON.stringify(adapter.requests[3]!.turnContext)).not.toContain(resource.id);
    const events = app.sessions.getEvents(first.sessionId);
    expect(JSON.stringify(events)).not.toContain("<turn-context>");
    expect(JSON.stringify(events)).not.toContain("<system-reminder>");
    expect(events.filter(event => event.type === "context-observed")).toHaveLength(2);
    expect(events.filter(event => event.type === "user-message").map(event => event.data.message.content))
      .toEqual([[{ type: "text", text: "Work" }], [{ type: "text", text: "Continue" }]]);
    expect(events.filter(event => event.type === "llm-requested").every(event => event.data.contextTokens! > 0)).toBe(true);
  });

  it("keeps preview reads from consuming changes and isolates Project and Node visibility", async () => {
    const { app, adapter, root, project, node } = await fixture();
    adapter.enqueue(done());
    const started = await app.nodeSessions.start({ nodeId: node.node.id, text: "Work" });
    const other = app.projects.create({ name: "Other", goal: "OTHER PROJECT SECRET" });
    app.nodes.create({ projectId: other.id, objective: { title: "OTHER NODE SECRET", description: "hidden", acceptanceCriteria: ["hidden"] } });
    const sibling = app.nodes.create({ projectId: project.id, objective: { title: "SIBLING SECRET", description: "private", acceptanceCriteria: ["private"] } });
    app.nodes.unlock(sibling.node.id, "Ready");
    await writeFile(join(root, "private.txt"), "body");
    const resource = await app.resources.publish({ projectId: project.id, owner: { kind: "node", nodeId: sibling.node.id },
      name: "SIBLING RESOURCE", description: "private", type: "text/plain", sourceRef: "private.txt" });
    app.resources.setAccess({ projectId: project.id, actor: { kind: "main" }, resourceId: resource.id,
      expectedRevision: resource.revision, access: { kind: "shared", nodeIds: [node.node.id] } });
    const count = app.sessions.getEvents(started.sessionId).length;
    const resolved = app.sessionContexts.resolve(started.sessionId);
    const preview = createGenerateRequest(app, { sessionId: started.sessionId, ...resolved }, new AbortController().signal);
    expect(app.sessions.getEvents(started.sessionId)).toHaveLength(count);
    expect(reminderTexts(preview).join()).toContain(resource.id);
    expect(JSON.stringify(preview.turnContext)).not.toContain("SIBLING SECRET");
    expect(JSON.stringify(preview.turnContext)).not.toContain("OTHER PROJECT SECRET");
    adapter.enqueue(done());
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Go" });
    expect(reminderTexts(adapter.requests[1]!).join()).toContain(resource.id);
    adapter.enqueue(done());
    await app.mainSessions.sendMessage({ projectId: project.id, text: "Inspect project" });
    expect(JSON.stringify(adapter.requests[2]!.turnContext)).not.toContain(resource.id);
    expect(JSON.stringify(adapter.requests[2]!.turnContext)).not.toContain("resource-catalog");
    expect(JSON.stringify(adapter.requests[2]!.turnContext)).not.toContain("OTHER NODE SECRET");
  });
});
