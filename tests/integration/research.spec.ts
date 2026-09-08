import type { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { ToolCallContentBlock } from "../../src/llm/types.js";
import { NODE_AGENT_TOOL_NAMES } from "../../src/node/profile.js";
import { NODE_CONTENT_TOOL_NAMES } from "../../src/node/tools.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { WEB_FETCH_TOOL_NAME } from "../../src/tools/builtins/fetch/tool.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { WEB_SEARCH_TOOL_NAME } from "../../src/tools/builtins/search/tool.js";
import { modelResponse } from "../helpers/runtime.js";

let app: Context | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  app = undefined;
});

describe("Node research application", () => {
  it("runs Search to Fetch to bounded domain content and revision", async () => {
    const search = new MockSearchAdapter([
      searchResult("https://docs.test/v1", "Initial source summary"),
      searchResult("https://docs.test/v2", "Updated source summary"),
    ]);
    const fetch = new MockFetchCore([
      { kind: "result", result: {
        url: "https://docs.test/v1",
        statusCode: 200,
        body: {
          kind: "html",
          content: "<article><h1>Primary source</h1><p>Verified detail one.</p><script>ignore()</script></article>",
        },
      } },
      { kind: "result", result: {
        url: "https://docs.test/v2",
        statusCode: 200,
        body: {
          kind: "text",
          format: "markdown",
          content: "# Updated source\n\nVerified detail two.",
        },
      } },
    ]);
    const llm = new MockLLMAdapter([
      toolResponse(call("search-v1", WEB_SEARCH_TOOL_NAME, {
        query: "Research capability primary sources",
      })),
      toolResponse(call("fetch-v1", WEB_FETCH_TOOL_NAME, {
        url: "https://docs.test/v1",
      })),
      toolResponse(call("material-v1", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
        text: "Material synthesized from verified detail one.",
        sources: [{ reference: "https://docs.test/v1", label: "Primary source" }],
      })),
      toolResponse(call("exercises-v1", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
        exercises: [{
          prompt: "Explain verified detail one.",
          referenceAnswer: "A private expected explanation.",
        }],
      })),
      textResponse("Research-backed content is ready."),
      toolResponse(call("search-v2", WEB_SEARCH_TOOL_NAME, {
        query: "Research capability updated source",
      })),
      toolResponse(call("fetch-v2", WEB_FETCH_TOOL_NAME, {
        url: "https://docs.test/v2",
      })),
      toolResponse(call("material-v2", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
        text: "Revised material synthesized from verified detail two.",
        sources: [{ reference: "https://docs.test/v2", label: "Updated source" }],
      })),
      textResponse("The material was revised from the updated source."),
    ]);
    app = await createApp({
      node: { session: { model: { provider: "mock", model: "research-e2e" } } },
      tools: {
        search: { adapter: search },
        fetch: { core: fetch },
      },
    });
    app.llm.registerAdapter("mock", llm);
    const node = app.nodes.create({
      capability: {
        title: "Research capability",
        description: "Learn from primary text sources",
        successCriteria: ["Explain the verified details"],
      },
    });

    const created = await app.nodeSessions.startLearning({
      nodeId: node.node.id,
      text: "Research this capability and create my learning content.",
    });
    const revised = await app.nodeSessions.sendMessage({
      nodeId: node.node.id,
      text: "Research an updated source and revise the material.",
    });

    expect(created.turn).toMatchObject({ status: "completed", steps: 5 });
    expect(revised.turn).toMatchObject({ status: "completed", steps: 4 });
    expect(revised.sessionId).toBe(created.sessionId);
    expect(search.requests).toEqual([
      { query: "Research capability primary sources", maxResults: 8 },
      { query: "Research capability updated source", maxResults: 8 },
    ]);
    expect(fetch.requests).toEqual([
      { url: "https://docs.test/v1" },
      { url: "https://docs.test/v2" },
    ]);

    const afterFirstFetch = JSON.stringify(llm.requests[2]?.messages);
    expect(afterFirstFetch).toContain("# Primary source");
    expect(afterFirstFetch).toContain("Verified detail one");
    expect(afterFirstFetch).toContain("External web content follows");
    expect(afterFirstFetch).not.toContain("ignore()");
    const afterSecondFetch = JSON.stringify(llm.requests[7]?.messages);
    expect(afterSecondFetch).toContain("Verified detail two");

    const snapshot = app.nodes.get(node.node.id)!;
    expect(snapshot.content.material).toMatchObject({
      revision: 2,
      text: "Revised material synthesized from verified detail two.",
      sources: [{ reference: "https://docs.test/v2" }],
    });
    expect(snapshot.content.exerciseSet).toMatchObject({
      revision: 1,
      exercises: [{ prompt: "Explain verified detail one." }],
    });
    expect(app.nodes.getEvents(node.node.id).map((event) => event.type)).toEqual([
      "node-created",
      "session-bound",
      "material-replaced",
      "exercise-set-replaced",
      "material-replaced",
    ]);
    const conversation = JSON.stringify(app.sessions.deriveMessages(created.sessionId));
    expect(conversation).toContain("Verified detail one");
    expect(conversation).toContain("Verified detail two");
    expect(conversation.length).toBeLessThan(60_000);
    for (const request of llm.requests) {
      expect(request.tools?.map((tool) => tool.name).sort())
        .toEqual([...NODE_AGENT_TOOL_NAMES].sort());
    }
    expect(llm.remainingEntries).toBe(0);
    expect(search.remainingEntries).toBe(0);
    expect(fetch.remainingEntries).toBe(0);
  });
});

function searchResult(url: string, summary: string) {
  return {
    kind: "result" as const,
    result: {
      sources: [{ title: "Source", url, summary }],
      truncated: false,
    },
  };
}

function call(id: string, name: string, arguments_: unknown): ToolCallContentBlock {
  return {
    type: "tool-call",
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(arguments_),
  };
}

function toolResponse(block: ToolCallContentBlock) {
  return modelResponse([block], "tool-calls");
}

function textResponse(text: string) {
  return modelResponse([{ type: "text", text }], "stop");
}
