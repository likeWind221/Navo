import { afterEach, expect, it, vi } from "vitest";
import { OpenAIAdapter } from "../../../src/llm/adapters/openai.js";
import { cleanup, facts, fixture, publish } from "./fixture.js";

afterEach(cleanup);

it("builds persisted graph facts through the subscription adapter without injecting unsupported generation controls", async () => {
  const { ctx, project, workspace } = await fixture(undefined, {
    graph: { model: { provider: "openai", model: "gpt-6-luna" } },
  });
  const token = vi.fn(async () => "test-token");
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("max_output_tokens");
    expect(body).not.toHaveProperty("temperature");
    const chunks = JSON.parse(body.input[1].content);
    const output = [{ type: "function_call", id: "graph-call", call_id: "graph-call",
      name: "extract_graph", namespace: "navo", arguments: JSON.stringify(facts(chunks)), status: "completed" }];
    const events = [
      { type: "response.output_item.added", output_index: 0, item: { ...output[0], arguments: "" } },
      { type: "response.output_item.done", output_index: 0, item: output[0] },
      { type: "response.completed", response: { id: "graph-response", output } },
    ];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  ctx.llm.registerAdapter("openai", new OpenAIAdapter({ auth: { accessToken: token }, fetch: request }));
  const resource = await publish(ctx, project.id, workspace);
  expect(token).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  await request.mock.results[0]!.value;
  expect(ctx.resourceGraph.status(project.id, resource.id)?.status).toBe("active");
  const graph = ctx.resourceGraph.read(project.id, { kind: "main" });
  expect(graph.entities.map(entity => entity.name)).toEqual(expect.arrayContaining(["Alice", "Bob"]));
  expect(graph.relations).toHaveLength(1);
  expect(graph.relations[0]?.evidence[0]?.resourceId).toBe(resource.id);
});
