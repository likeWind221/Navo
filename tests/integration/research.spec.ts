import type { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/update.js";
import { MODIFY_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/modify-roadmap.js";
import { READ_NODE_TOOL_NAME } from "../../src/tools/builtins/roadmap/read-node.js";
import { READ_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/read.js";
import { WRITE_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/write-roadmap.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { modelResponse } from "../helpers/runtime.js";

let app: Context | undefined;
afterEach(async () => { await app?.fiber.dispose(); app = undefined; });

describe("generic Node research loop", () => {
  it("uses search and fetch but cannot confirm its own completion", async () => {
    const call = (name: string, args: unknown) => modelResponse([{
      type: "tool-call", id: createToolCallId(name), name, arguments: JSON.stringify(args),
    }], "tool-calls");
    const adapter = new MockLLMAdapter([
      call("web_search", { query: "Primary source" }),
      call("web_fetch", { url: "https://source.test/page" }),
      call("confirm_completion", { confirmedBy: "human", reason: "Pretend approval" }),
      modelResponse([{ type: "text", text: "All done. Sources reviewed." }]),
    ]);
    app = await createApp({
      node: { session: { model: { provider: "mock", model: "research" } } },
      tools: {
        search: { adapter: new MockSearchAdapter([{ kind: "result", result: {
          sources: [{ title: "Source", url: "https://source.test/page", summary: "Summary" }], truncated: false,
        } }]) },
        fetch: { core: new MockFetchCore([{ kind: "result", result: {
          url: "https://source.test/page", statusCode: 200,
          body: { kind: "text", format: "markdown", content: "Verified source details" },
        } }]) },
      },
    });
    app.llm.registerAdapter("mock", adapter);
    const project = app.projects.create({ goal: "Investigate sources" });
    const node = app.nodes.create({ projectId: project.id, objective: {
      title: "Inspect source", description: "Read primary material", acceptanceCriteria: ["Cite checked sources"],
    } });
    app.nodes.unlock(node.node.id, "Start research");
    const result = await app.nodeSessions.start({ nodeId: node.node.id, text: "Research the source" });
    expect(result.turn).toMatchObject({ status: "completed", steps: 4 });
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain("Verified source details");
    expect(JSON.stringify(adapter.requests[3]?.messages)).toContain("not allowed");
    expect(app.tools.schemas().map(tool => tool.name).sort())
      .toEqual([
        "web_fetch", "web_search",
        READ_ROADMAP_TOOL_NAME, READ_NODE_TOOL_NAME,
        WRITE_ROADMAP_TOOL_NAME, MODIFY_ROADMAP_TOOL_NAME,
        REGISTER_RESOURCE_TOOL_NAME, FETCH_RESOURCE_TOOL_NAME,
        UPDATE_RESOURCE_TOOL_NAME, DELETE_RESOURCE_TOOL_NAME,
        SEND_TO_MAIN_TOOL_NAME,
      ].sort());
    expect(adapter.requests[0]?.tools?.map(tool => tool.name).sort())
      .toEqual([
        "web_fetch", "web_search",
        REGISTER_RESOURCE_TOOL_NAME, FETCH_RESOURCE_TOOL_NAME,
        UPDATE_RESOURCE_TOOL_NAME, DELETE_RESOURCE_TOOL_NAME,
        SEND_TO_MAIN_TOOL_NAME,
      ].sort());
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(READ_ROADMAP_TOOL_NAME);
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(READ_NODE_TOOL_NAME);
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(WRITE_ROADMAP_TOOL_NAME);
    expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(MODIFY_ROADMAP_TOOL_NAME);
    const ready = app.nodes.get(node.node.id)!;
    expect(ready.status).toBe("idle");
    expect(ready.confirmation).toBeUndefined();
    expect(app.nodes.confirmCompletion(node.node.id, {
      confirmedBy: "reviewer", reason: "Manually checked sources", reviewedRevision: ready.revision,
    }).status).toBe("completing");
  });
});
