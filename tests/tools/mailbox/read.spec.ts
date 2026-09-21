import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import {
  createSessionId,
  createToolCallId,
} from "../../../src/brand/ids.js";
import { READ_MAILBOX_TOOL_NAME } from "../../../src/tools/builtins/mailbox/read.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
});

describe("Main mailbox read capability", () => {
  it("reads only Node-to-Main messages for the bound Project without consuming them", async () => {
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    apps.push(app);
    const project = app.projects.create({ goal: "Coordinate messages" });
    const node = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Report",
        description: "Report to Main",
        acceptanceCriteria: ["Send report"],
      },
    });
    app.mailbox.postFromNode({
      projectId: project.id,
      nodeId: node.node.id,
      body: "Node report",
    });
    app.mailbox.postFromMain({
      projectId: project.id,
      nodeId: node.node.id,
      body: "Main reply",
    });

    const result = await app.tools.execute({
      type: "tool-call",
      id: createToolCallId("read-mailbox"),
      name: READ_MAILBOX_TOOL_NAME,
      arguments: "{}",
    }, new AbortController().signal, {
      sessionId: project.mainSessionId,
      allowedTools: [READ_MAILBOX_TOOL_NAME],
    });

    expect(result.kind).toBe("success");
    expect(result.block.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Node report"),
    });
    expect(JSON.stringify(result.block)).not.toContain("Main reply");
    expect(app.mailbox.getHistory(project.id)).toHaveLength(2);
  });

  it("rejects a Node caller even when the globally registered tool is invoked directly", async () => {
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    apps.push(app);
    const project = app.projects.create({ goal: "Protect mailbox" });
    const node = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Node",
        description: "No Main authority",
        acceptanceCriteria: ["Stay scoped"],
      },
    });
    app.nodes.unlock(node.node.id, "Ready");
    const sessionId = createSessionId("node-mailbox-reader");
    app.nodes.bindSession(node.node.id, sessionId);

    const result = await app.tools.execute({
      type: "tool-call",
      id: createToolCallId("node-read-mailbox"),
      name: READ_MAILBOX_TOOL_NAME,
      arguments: "{}",
    }, new AbortController().signal, {
      sessionId,
      allowedTools: [READ_MAILBOX_TOOL_NAME],
    });

    expect(result).toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        modelMessage: expect.stringContaining("Main Agent"),
      },
    });
  });
});
