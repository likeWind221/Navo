import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { READ_MAILBOX_TOOL_NAME } from "../../src/tools/builtins/mailbox/read.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { modelResponse } from "../helpers/runtime.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })));
});

function call(name: string, args: unknown, id: string) {
  return modelResponse([{
    type: "tool-call" as const,
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(args),
  }], "tool-calls");
}

function messageText(request: GenerateRequest): string {
  return JSON.stringify(request.messages);
}

function systemText(request: GenerateRequest): string {
  const message = request.messages[0];
  const block = message?.content[0];
  if (message?.role !== "system" || block?.type !== "text") {
    throw new Error("Expected system prompt.");
  }
  return block.text;
}

describe("F9.6 Resource handoff integration", () => {
  it("runs Node A -> Main -> Node B only through Human-started Turns", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-f96f-"));
    roots.push(root);
    await writeFile(
      join(root, "node-a-report.md"),
      "handoff payload from Node A\n",
      "utf8",
    );

    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "project-agent" } } },
    });
    apps.push(app);
    const project = app.projects.create({ goal: "Pass Node A evidence to Node B" });
    await app.projectWorkspaces.create(project.id, root);
    const nodeA = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Produce evidence",
        description: "Publish the prepared report and tell Main",
        acceptanceCriteria: ["Resource is registered and reported"],
      },
    });
    const nodeB = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Consume evidence",
        description: "Read the Resource provided by Main",
        acceptanceCriteria: ["Read Node A evidence"],
      },
    });
    app.nodes.unlock(nodeA.node.id, "Human starts producer");
    app.nodes.unlock(nodeB.node.id, "Ready but not started");

    let resourceId = "";
    const adapter = new MockLLMAdapter([
      call(REGISTER_RESOURCE_TOOL_NAME, {
        path: "node-a-report.md",
        name: "Node A report",
        description: "Evidence for downstream Node B",
        type: "text/markdown",
      }, "node-a-register"),
      {
        kind: "handler",
        handle(request) {
          const match = /Resource ID: ([^\\n"\\]+)/.exec(messageText(request));
          if (!match) throw new Error("Node A register result did not expose Resource ID.");
          resourceId = match[1]!;
          return call(SEND_TO_MAIN_TOOL_NAME, {
            message: `Resource ${resourceId} is ready for downstream use.`,
          }, "node-a-report").events;
        },
      },
      modelResponse([{ type: "text", text: "Node A reported the Resource to Main." }]),
      call(READ_MAILBOX_TOOL_NAME, {}, "main-read-mailbox"),
      {
        kind: "handler",
        handle(request) {
          if (!resourceId || !messageText(request).includes(resourceId)) {
            throw new Error("Main did not receive Node A Resource report from Mailbox.");
          }
          return call(SET_RESOURCE_ACCESS_TOOL_NAME, {
            resource_id: resourceId,
            expected_revision: 1,
            access: {
              kind: "shared",
              node_ids: [String(nodeB.node.id)],
            },
          }, "main-handoff").events;
        },
      },
      modelResponse([{ type: "text", text: "Resource handed off to Node B." }]),
      {
        kind: "handler",
        handle(request) {
          const prompt = systemText(request);
          if (!resourceId || !prompt.includes(resourceId)) {
            throw new Error("Node B Turn context did not include the handed-off Resource.");
          }
          if (prompt.includes("handoff payload from Node A")) {
            throw new Error("Resource body leaked into Node B Turn context.");
          }
          return call(FETCH_RESOURCE_TOOL_NAME, {
            resource_id: resourceId,
          }, "node-b-fetch").events;
        },
      },
      {
        kind: "handler",
        handle(request) {
          if (!messageText(request).includes("handoff payload from Node A")) {
            throw new Error("Node B did not receive Resource content through fetch_resource.");
          }
          return modelResponse([
            { type: "text", text: "Node B consumed the handed-off Resource." },
          ]).events;
        },
      },
    ]);
    app.llm.registerAdapter("mock", adapter);

    const nodeATurn = await app.nodeSessions.start({
      nodeId: nodeA.node.id,
      text: "Publish your report and notify Main.",
    });
    expect(nodeATurn.turn).toMatchObject({ status: "completed", steps: 3 });
    expect(resourceId).not.toBe("");
    expect(app.mailbox.getHistory(project.id)).toEqual([
      expect.objectContaining({
        sender: { kind: "node", nodeId: nodeA.node.id },
        recipient: { kind: "main" },
        body: expect.stringContaining(resourceId),
      }),
    ]);

    expect(app.nodes.get(nodeB.node.id)?.status).toBe("idle");
    expect(app.nodes.get(nodeB.node.id)?.sessionId).toBeUndefined();
    const nodeBEventsBeforeMain = app.nodes.getEvents(nodeB.node.id).length;

    const mainTurn = await app.mainSessions.sendMessage({
      projectId: project.id,
      text: `Read Node reports and make the reported Resource available to Node B ${nodeB.node.id}.`,
    });
    expect(mainTurn.turn).toMatchObject({ status: "completed", steps: 3 });
    expect(app.nodes.getEvents(nodeB.node.id)).toHaveLength(nodeBEventsBeforeMain);
    expect(app.nodes.get(nodeB.node.id)?.status).toBe("idle");
    expect(app.nodes.get(nodeB.node.id)?.sessionId).toBeUndefined();

    const mainRequest = adapter.requests[3]!;
    expect(mainRequest.tools?.map(tool => tool.name))
      .toEqual(expect.arrayContaining([
        READ_MAILBOX_TOOL_NAME,
        SET_RESOURCE_ACCESS_TOOL_NAME,
      ]));
    expect(adapter.requests[0]?.tools?.map(tool => tool.name))
      .toContain(SEND_TO_MAIN_TOOL_NAME);
    expect(adapter.requests[0]?.tools?.map(tool => tool.name))
      .not.toContain(SET_RESOURCE_ACCESS_TOOL_NAME);
    expect(adapter.requests[0]?.tools?.map(tool => tool.name))
      .not.toContain(READ_MAILBOX_TOOL_NAME);

    const nodeBTurn = await app.nodeSessions.start({
      nodeId: nodeB.node.id,
      text: "Use the Resource Main made available.",
    });
    expect(nodeBTurn.turn).toMatchObject({ status: "completed", steps: 2 });
    expect(app.nodes.get(nodeB.node.id)?.status).toBe("idle");
    expect(adapter.remainingEntries).toBe(0);

    const resource = app.resources.listByProject(project.id).find(
      candidate => String(candidate.id) === resourceId,
    );
    expect(resource).toMatchObject({
      owner: { kind: "node", nodeId: nodeA.node.id },
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
      revision: 2,
    });
  });
});
