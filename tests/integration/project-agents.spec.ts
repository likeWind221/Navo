import type { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { modelResponse } from "../helpers/runtime.js";

let app: Context | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  app = undefined;
});

describe("Project Agent application wiring", () => {
  it("runs Main and Node profiles through the same AgentRuntime", async () => {
    app = await createApp({
      node: { session: { model: { provider: "mock", model: "agent-test" } } },
      tools: { search: { adapter: new MockSearchAdapter([]) } },
    });
    const adapter = new MockLLMAdapter([
      modelResponse([{ type: "text", text: "main done" }]),
      modelResponse([{ type: "text", text: "node done" }]),
    ]);
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ goal: "Ship the Project" });
    const created = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Implement the Node",
        description: "Complete one isolated work unit",
        acceptanceCriteria: ["Node result is concrete"],
      },
    });
    const node = app.nodes.unlock(created.node.id, "Ready");

    await app.mainSessions.sendMessage({ projectId: project.id, text: "Plan globally" });
    await app.nodeSessions.start({ nodeId: node.node.id, text: "Execute locally" });

    expect(app.agentRuntime).toBeDefined();
    expect(adapter.requests).toHaveLength(2);
    expect(JSON.stringify(adapter.requests[0]?.messages[0])).toContain("Main Agent");
    expect(JSON.stringify(adapter.requests[0]?.messages[0])).toContain("Ship the Project");
    expect(JSON.stringify(adapter.requests[1]?.messages[0])).toContain("Node Agent");
    expect(JSON.stringify(adapter.requests[1]?.messages[0])).toContain("Implement the Node");
    expect(JSON.stringify(adapter.requests[1]?.messages[0])).toContain("Ship the Project");
  });
});
