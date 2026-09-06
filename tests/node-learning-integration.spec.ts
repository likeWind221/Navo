import type { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createToolCallId } from "../src/brand/ids.js";
import { MockLLMAdapter } from "../src/llm/mock.js";
import type {
  GenerateRequest,
  StreamContentBlock,
  ToolCallContentBlock,
} from "../src/llm/types.js";
import { toLearnerExerciseSet } from "../src/node/model.js";
import { NODE_AGENT_TOOL_NAMES } from "../src/node/profile.js";
import { projectNode } from "../src/node/projector.js";
import { NODE_CONTENT_TOOL_NAMES } from "../src/node/tools.js";
import { MockSearchAdapter } from "../src/tools/builtins/search/adapters/mock.js";
import { WEB_SEARCH_TOOL_NAME } from "../src/tools/builtins/search/tool.js";

let app: Context | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  app = undefined;
});

describe("Node learning application", () => {
  it("generates, revises, rebuilds, and isolates Node content", async () => {
    const search = new MockSearchAdapter([
      searchResult("Alpha source", "https://alpha.test/v1", "Alpha facts v1"),
      searchResult("Alpha revision", "https://alpha.test/v2", "Alpha facts v2"),
      searchResult("Beta source", "https://beta.test/v1", "Beta-only facts"),
    ]);
    const llm = new MockLLMAdapter([
      toolResponse(call("alpha-search-1", WEB_SEARCH_TOOL_NAME, {
        query: "Alpha capability fundamentals",
      })),
      toolResponse(call("alpha-material-1", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
        text: "Alpha material version one",
        sources: [{ reference: "https://alpha.test/v1", label: "Alpha source" }],
      })),
      toolResponse(call("alpha-exercises-1", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
        exercises: [{ prompt: "Alpha question one", referenceAnswer: "Alpha secret one" }],
      })),
      textResponse("Alpha content is ready."),
      toolResponse(call("alpha-search-2", WEB_SEARCH_TOOL_NAME, {
        query: "Alpha capability revised explanation",
      })),
      toolResponse(call("alpha-material-2", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
        text: "Alpha material version two",
        sources: [{ reference: "https://alpha.test/v2", label: "Alpha revision" }],
      })),
      toolResponse(call("alpha-exercises-2", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
        exercises: [{ prompt: "Alpha question two", referenceAnswer: "Alpha secret two" }],
      })),
      textResponse("Alpha content was revised."),
      toolResponse(call("beta-search-1", WEB_SEARCH_TOOL_NAME, {
        query: "Beta capability fundamentals",
      })),
      toolResponse(call("beta-material-1", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
        text: "Beta material",
        sources: [{ reference: "https://beta.test/v1", label: "Beta source" }],
      })),
      toolResponse(call("beta-exercises-1", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
        exercises: [{ prompt: "Beta question", referenceAnswer: "Beta secret" }],
      })),
      textResponse("Beta content is ready."),
    ]);
    app = await createApp({
      node: { session: { model: { provider: "mock", model: "learning-e2e" } } },
      tools: { search: { adapter: search } },
    });
    app.llm.registerAdapter("mock", llm);

    const alpha = app.nodes.create({ capability: capability("Alpha") });
    const beta = app.nodes.create({ capability: capability("Beta") });
    const created = await app.nodeSessions.startLearning({
      nodeId: alpha.node.id,
      text: "Create my Alpha learning material and exercises.",
    });
    const revised = await app.nodeSessions.sendMessage({
      nodeId: alpha.node.id,
      text: "Revise both panels with a clearer explanation and a new question.",
    });

    expect(created.turn).toMatchObject({ status: "completed", steps: 4 });
    expect(revised.turn).toMatchObject({ status: "completed", steps: 4 });
    expect(revised.sessionId).toBe(created.sessionId);
    expect(search.requests.slice(0, 2)).toEqual([
      { query: "Alpha capability fundamentals", maxResults: 8 },
      { query: "Alpha capability revised explanation", maxResults: 8 },
    ]);
    expect(JSON.stringify(llm.requests[1]?.messages))
      .toContain("https://alpha.test/v1");

    const alphaSnapshot = app.nodes.get(alpha.node.id)!;
    expect(alphaSnapshot.content.material).toMatchObject({
      revision: 2,
      text: "Alpha material version two",
      sources: [{ reference: "https://alpha.test/v2", label: "Alpha revision" }],
    });
    expect(alphaSnapshot.content.exerciseSet).toMatchObject({
      revision: 2,
      exercises: [{ prompt: "Alpha question two", referenceAnswer: "Alpha secret two" }],
    });
    expect(toLearnerExerciseSet(alphaSnapshot.content.exerciseSet!))
      .toEqual({
        revision: 2,
        exercises: [{
          id: alphaSnapshot.content.exerciseSet!.exercises[0]!.id,
          prompt: "Alpha question two",
        }],
      });

    const alphaEvents = app.nodes.getEvents(alpha.node.id);
    expect(alphaEvents.map((event) => event.type)).toEqual([
      "node-created",
      "session-bound",
      "material-replaced",
      "exercise-set-replaced",
      "material-replaced",
      "exercise-set-replaced",
    ]);
    expect(projectNode(alpha.node.id, alphaEvents)).toEqual(alphaSnapshot);
    const alphaConversation = JSON.stringify(
      app.sessions.deriveMessages(created.sessionId),
    );
    expect(alphaConversation).toContain("Create my Alpha learning material");
    expect(alphaConversation).toContain("Alpha content is ready");
    expect(alphaConversation).toContain("Revise both panels");
    expect(alphaConversation).toContain("Alpha content was revised");

    const betaResult = await app.nodeSessions.startLearning({
      nodeId: beta.node.id,
      text: "Create my Beta learning material and exercises.",
    });
    expect(betaResult.turn).toMatchObject({ status: "completed", steps: 4 });
    expect(betaResult.sessionId).not.toBe(created.sessionId);
    expect(systemText(llm.requests[8]!)).toContain('"title": "Beta"');
    expect(systemText(llm.requests[8]!)).not.toContain("Alpha material version two");
    expect(systemText(llm.requests[8]!)).not.toContain("Alpha secret two");

    expect(app.nodes.get(alpha.node.id)).toEqual(alphaSnapshot);
    expect(app.nodes.get(beta.node.id)?.content).toMatchObject({
      material: { revision: 1, text: "Beta material" },
      exerciseSet: {
        revision: 1,
        exercises: [{ prompt: "Beta question", referenceAnswer: "Beta secret" }],
      },
    });
    expect(JSON.stringify(app.sessions.deriveMessages(created.sessionId)))
      .not.toContain("Beta material");
    expect(JSON.stringify(app.sessions.deriveMessages(betaResult.sessionId)))
      .not.toContain("Alpha material version two");
    expect(llm.requests).toHaveLength(12);
    expect(llm.remainingEntries).toBe(0);
    expect(search.remainingEntries).toBe(0);
    for (const request of llm.requests) {
      expect(request.tools?.map((tool) => tool.name).sort())
        .toEqual([...NODE_AGENT_TOOL_NAMES].sort());
    }
  });
});

function capability(title: string) {
  return {
    title,
    description: `Learn ${title} safely`,
    successCriteria: [`Explain ${title}`],
  };
}

function searchResult(title: string, url: string, summary: string) {
  return {
    kind: "result" as const,
    result: { sources: [{ title, url, summary }], truncated: false },
  };
}

function call(
  id: string,
  name: string,
  arguments_: unknown,
): ToolCallContentBlock {
  return {
    type: "tool-call",
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(arguments_),
  };
}

function toolResponse(block: ToolCallContentBlock) {
  return response(block, "tool-calls");
}

function textResponse(text: string) {
  return response({ type: "text", text }, "stop");
}

function response(block: StreamContentBlock, finish: "stop" | "tool-calls") {
  return {
    kind: "chunks" as const,
    chunks: [
      { type: "block-end" as const, index: 0, block },
      { type: "finish" as const, reason: { kind: finish } },
    ],
  };
}

function systemText(request: GenerateRequest): string {
  const block = request.messages[0]?.content[0];
  if (request.messages[0]?.role !== "system" || block?.type !== "text") {
    throw new Error("request omitted NodeAgent system profile");
  }
  return block.text;
}
