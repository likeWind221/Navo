import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import { createGenerateRequest } from "../../../src/agent/request.js";
import { createMessageId, createStepId, createToolCallId, createTurnId } from "../../../src/brand/ids.js";
import { compactSession } from "../../../src/context/compaction/compact.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import { reminderTexts, turnSnapshot } from "../../helpers/context.js";
import { modelResponse } from "../../helpers/runtime.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const model = { provider: "mock", model: "context", autoCompactLimit: 8_000, maxTokens: 500 };
const done = () => modelResponse([{ type: "text", text: "done" }]);

describe("F13.4a durable recovery", () => {
  it("rebuilds goal, grants and unfinished rework from authoritative stores after a checkpoint and restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-turn-recovery-"));
    roots.push(root);
    const config = { storage: { path: join(root, "navo.db") }, node: { session: { model } } };
    let app = await createApp(config);
    apps.push(app);
    const adapter = new MockLLMAdapter([
      modelResponse([{ type: "tool-call", id: createToolCallId("submit"), name: "submit_completion",
        arguments: JSON.stringify({ summary: "first", resource_ids: [], criteria: [{ criterion_index: 1, satisfied: true, note: "first" }], remaining: [] }),
      }], "tool-calls"),
      done(), done(),
      { kind: "handler", handle(request) {
        expect(request.turnContext).toBeUndefined();
        expect(JSON.stringify(request.messages)).not.toContain("Fix missing evidence");
        app.projects.setGoal(project.id, "Goal updated during compaction");
        return modelResponse([{ type: "text", text: "## Progress\nEarlier work retained." }]).events;
      } },
    ]);
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ name: "Project", goal: "Original goal" });
    await app.projectWorkspaces.create(project.id, root);
    const node = app.nodes.create({ projectId: project.id, objective: { title: "Work", description: "Task", acceptanceCriteria: ["Done"] } });
    app.nodes.unlock(node.node.id, "Ready");
    const started = await app.nodeSessions.start({ nodeId: node.node.id, text: "Work" });
    const submitted = app.nodes.get(node.node.id)!;
    app.nodes.requestRework(node.node.id, { requestedBy: "human", feedback: "Fix missing evidence", reviewedRevision: submitted.revision });
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Address feedback" });
    expect(reminderTexts(adapter.requests[1]!).join()).toContain("Fix missing evidence");
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Continue the same work" });
    expect(reminderTexts(adapter.requests[2]!)).toEqual([]);
    expect(JSON.stringify(turnSnapshot(adapter.requests[2]!))).toContain("Fix missing evidence");
    for (let index = 0; index < 8; index += 1) {
      app.sessions.append({ type: "user-message", sessionId: started.sessionId, data: { message: {
        id: createMessageId(`seed-user-${index}`), role: "user", content: [{ type: "text", text: "u".repeat(2_000) }],
      } } });
      app.sessions.append({ type: "assistant-message", sessionId: started.sessionId, data: {
        turnId: createTurnId(`seed-turn-${index}`), stepId: createStepId(`seed-step-${index}`),
        message: { id: createMessageId(`seed-reply-${index}`), role: "assistant", content: [{ type: "text", text: "a".repeat(2_000) }] },
        finishReason: { kind: "stop" },
      } });
    }
    const signal = new AbortController().signal;
    const request = createGenerateRequest(app, { sessionId: started.sessionId, ...app.sessionContexts.resolve(started.sessionId) }, signal);
    const compacted = await compactSession(app, { sessionId: started.sessionId, model, request,
      thresholdTokens: 8_000, retainTokens: 1_000, signal, cancelSignal: signal, maxRetries: 0, trigger: "manual" });
    expect(compacted.kind).toBe("compacted");
    const checkpoint = app.sessions.getEvents(started.sessionId).find(event => event.type === "compaction-checkpoint");
    expect(checkpoint).toBeDefined();
    expect(JSON.stringify(checkpoint)).not.toContain("<turn-context>");
    await writeFile(join(root, "source.txt"), "resource body");
    const resource = await app.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "source.txt",
      name: "New evidence", description: "shared", type: "text/plain" });
    app.resources.setAccess({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
      expectedRevision: resource.revision, access: { kind: "shared", nodeIds: [node.node.id] } });
    apps.splice(apps.indexOf(app), 1);
    await app.fiber.dispose();
    app = await createApp(config);
    apps.push(app);
    const resumed = new MockLLMAdapter([done(), done()]);
    app.llm.registerAdapter("mock", resumed);
    expect(app.sessions.getEvents(started.sessionId)).toContainEqual(checkpoint);
    expect(resumed.requests).toHaveLength(0);
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Continue after restart" });
    expect(JSON.stringify(turnSnapshot(resumed.requests[0]!))).toContain("Goal updated during compaction");
    expect(JSON.stringify(turnSnapshot(resumed.requests[0]!))).toContain("Fix missing evidence");
    expect(JSON.stringify(turnSnapshot(resumed.requests[0]!))).toContain(resource.id);
    expect(reminderTexts(resumed.requests[0]!)).toHaveLength(1);
    expect(reminderTexts(resumed.requests[0]!)[0]).toContain(resource.id);
    expect(resumed.requests[0]!.messages[0]).toEqual(adapter.requests[0]!.messages[0]);
    await app.nodeSessions.sendMessage({ nodeId: node.node.id, text: "Continue again" });
    expect(reminderTexts(resumed.requests[1]!)).toEqual([]);
    expect(JSON.stringify(app.sessions.getEvents(started.sessionId))).not.toContain("<turn-context>");
    expect(app.nodes.get(node.node.id)!.pendingFeedback).toBeUndefined();
  });
});
