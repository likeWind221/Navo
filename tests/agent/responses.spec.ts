import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../src/brand/ids.js";
import type { LLMAdapter } from "../../src/llm/adapter.js";
import { serializeResponsesRequest } from "../../src/llm/protocols/responses/request.js";
import { translateResponsesSse } from "../../src/llm/protocols/responses/stream.js";
import type { GenerateRequest, ModelEvent } from "../../src/llm/types.js";
import { createRuntime, disposeRuntimes, turnInput } from "../helpers/runtime.js";

afterEach(async () => {
  await disposeRuntimes();
});

describe("Responses protocol AgentRuntime integration", () => {
  it("keeps reasoning-only assistant history for the next Responses request", async () => {
    const first = turnInput("responses-reasoning-only");
    const adapter = new RotatingResponsesAdapter([
      fixture([
        responseEvent({ type: "response.output_item.added", output_index: 0,
          item: { type: "reasoning", id: "rs_only", summary: [], encrypted_content: "sealed" } }),
        responseEvent({ type: "response.output_item.done", output_index: 0,
          item: { type: "reasoning", id: "rs_only", summary: [], encrypted_content: "sealed" } }),
        responseEvent({ type: "response.completed", response: { output: [
          { type: "reasoning", id: "rs_only", summary: [], encrypted_content: "sealed" },
        ] } }),
      ]),
      fixture([
        responseEvent({ type: "response.output_item.done", output_index: 0,
          item: { type: "message", id: "msg_only_next", role: "assistant",
            phase: "final_answer", content: [{ type: "output_text", text: "done" }] } }),
        responseEvent({ type: "response.completed", response: { output: [
          { type: "message", id: "msg_only_next", role: "assistant",
            phase: "final_answer", content: [{ type: "output_text", text: "done" }] },
        ] } }),
      ]),
    ]);
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", adapter);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...first,
      model: { provider: "openai", model: "gpt-test" },
    })).resolves.toMatchObject({ status: "completed" });
    const history = kit.ctx.sessions.deriveMessages(first.sessionId);
    expect(history).toHaveLength(2);
    expect(history[1]?.content).toHaveLength(0);
    expect(history[1]?.replay?.items[0]?.payload).toMatchObject({
      type: "reasoning", encrypted_content: "sealed",
    });

    const next = turnInput("responses-reasoning-next");
    await expect(kit.ctx.agentRuntime.runTurn({
      ...next,
      sessionId: first.sessionId,
      model: { provider: "openai", model: "gpt-test" },
    })).resolves.toMatchObject({ status: "completed" });
    expect(adapter.requests[1]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reasoning", encrypted_content: "sealed" }),
    ]));
  });

  it("rebuilds the protocol adapter between tool steps and restores native history", async () => {
    const first = fixture([
      responseEvent({
        type: "response.output_item.added", output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
      }),
      responseEvent({
        type: "response.output_item.done", output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
      }),
      responseEvent({
        type: "response.output_item.added", output_index: 1,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] },
      }),
      responseEvent({ type: "response.output_text.delta", output_index: 1, delta: "Need read" }),
      responseEvent({ type: "response.output_text.done", output_index: 1, text: "Need read" }),
      responseEvent({
        type: "response.output_item.done", output_index: 1,
        item: { type: "message", id: "msg_1", role: "assistant",
          phase: "commentary", content: [{ type: "output_text", text: "Need read" }] },
      }),
      responseEvent({
        type: "response.output_item.added", output_index: 2,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "test_echo", namespace: "navo", arguments: "" },
      }),
      responseEvent({ type: "response.function_call_arguments.delta", output_index: 2, delta: "{\"text\":\"hello\"}" }),
      responseEvent({ type: "response.function_call_arguments.done", output_index: 2, arguments: "{\"text\":\"hello\"}" }),
      responseEvent({
        type: "response.output_item.done", output_index: 2,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "test_echo", namespace: "navo", arguments: "{\"text\":\"hello\"}", status: "completed" },
      }),
      responseEvent({
        type: "response.completed", response: {
          output: [
            { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
            { type: "message", id: "msg_1", role: "assistant",
              phase: "commentary", content: [{ type: "output_text", text: "Need read" }] },
            { type: "function_call", id: "fc_1", call_id: "call_1", name: "test_echo",
              namespace: "navo", arguments: "{\"text\":\"hello\"}", status: "completed" },
          ],
          usage: { input_tokens: 5, output_tokens: 8, total_tokens: 13 },
        },
      }),
    ]);
    const second = fixture([
      responseEvent({ type: "response.output_item.added", output_index: 0,
        item: { type: "message", id: "msg_2", role: "assistant", content: [] } }),
      responseEvent({ type: "response.output_text.delta", output_index: 0, delta: "done" }),
      responseEvent({ type: "response.output_text.done", output_index: 0, text: "done" }),
      responseEvent({ type: "response.output_item.done", output_index: 0,
        item: { type: "message", id: "msg_2", role: "assistant", phase: "final_answer",
          content: [{ type: "output_text", text: "done" }] } }),
      responseEvent({ type: "response.completed", response: { output: [
        { type: "message", id: "msg_2", role: "assistant", phase: "final_answer",
          content: [{ type: "output_text", text: "done" }] },
      ] } }),
    ]);
    const adapter = new RotatingResponsesAdapter([first, second]);
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", adapter);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...turnInput("responses-tool"),
      sessionId: createSessionId("responses-tool"),
      model: { provider: "openai", model: "gpt-test" },
      toolNames: ["test_echo"],
    })).resolves.toMatchObject({ status: "completed", steps: 2 });

    expect(adapter.instances).toBe(2);
    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[1]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "reasoning", encrypted_content: "sealed" }),
      expect.objectContaining({ type: "message", content: [
        { type: "output_text", text: "Need read" },
      ], phase: "commentary" }),
      expect.objectContaining({ type: "function_call", id: "fc_1", call_id: "call_1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_1", output: "hello" }),
    ]));
    const events = kit.ctx.sessions.getEvents(createSessionId("responses-tool"));
    expect(events.filter((event) => event.type === "tool-call-result")).toHaveLength(1);
    const assistant = events.find((event) => event.type === "assistant-message");
    expect(assistant?.type === "assistant-message" ? assistant.data.message.replay?.items : undefined)
      .toHaveLength(3);
  });

  it("does not execute a tool when Responses ends incomplete", async () => {
    const fixtureAdapter = new RotatingResponsesAdapter([fixture([
      responseEvent({ type: "response.output_item.added", output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "test_echo", namespace: "navo", arguments: "" } }),
      responseEvent({ type: "response.function_call_arguments.delta", output_index: 0, delta: "{}" }),
      responseEvent({ type: "response.completed", response: { output: [
        { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "test_echo", namespace: "navo", arguments: "{}", status: "completed" },
      ] } }),
    ])]);
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", fixtureAdapter);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...turnInput("responses-incomplete"),
      model: { provider: "openai", model: "gpt-test" },
      toolNames: ["test_echo"],
    })).resolves.toMatchObject({ status: "failed" });
    expect(kit.ctx.sessions.getEvents(turnInput("responses-incomplete").sessionId)
      .filter((event) => event.type === "tool-call-result")).toHaveLength(0);
  });

  it("does not execute a tool when the Responses stream is cancelled", async () => {
    const controller = new AbortController();
    const adapter = new PendingResponsesAdapter();
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", adapter);
    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("responses-cancel"),
      model: { provider: "openai", model: "gpt-test" },
      toolNames: ["test_echo"],
      signal: controller.signal,
    });

    await adapter.started.promise;
    controller.abort("cancelled");
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(kit.ctx.sessions.getEvents(turnInput("responses-cancel").sessionId)
      .filter((event) => event.type === "tool-call-result")).toHaveLength(0);
  });

  it("keeps a structured failure diagnostic after visible output", async () => {
    const adapter = new RotatingResponsesAdapter([fixture([
      responseEvent({ type: "response.output_item.added", output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] } }),
      responseEvent({ type: "response.output_text.delta", output_index: 0, delta: "partial" }),
      responseEvent({ type: "response.failed", response: {
        error: { code: "subscription_sharing_usage_limit_exceeded", message: "usage limit" },
      } }),
    ])]);
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", adapter);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...turnInput("responses-quota"),
      model: { provider: "openai", model: "gpt-test" },
      onEvent: () => true,
    })).resolves.toMatchObject({
      status: "failed",
      failure: {
        code: "stream-output-interrupted",
        message: expect.stringContaining("subscription_sharing_usage_limit_exceeded"),
      },
    });
  });
});

interface Fixture {
  readonly chunks: readonly string[];
}

class RotatingResponsesAdapter implements LLMAdapter {
  private readonly fixtures: Fixture[];
  readonly requests: Record<string, unknown>[] = [];
  instances = 0;

  constructor(fixtures: readonly Fixture[]) {
    this.fixtures = [...fixtures];
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
    const fixture = this.fixtures.shift();
    if (fixture === undefined) throw new Error("Missing Responses fixture.");
    this.instances++;
    yield* new FixtureResponsesAdapter(fixture, this.requests).stream(request);
  }
}

class FixtureResponsesAdapter implements LLMAdapter {
  constructor(
    private readonly fixture: Fixture,
    private readonly requests: Record<string, unknown>[],
  ) {}

  async *stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
    const payload = serializeResponsesRequest(request, {
      toolNamespace: "navo",
    });
    this.requests.push(payload);
    const body = new Response(this.fixture.chunks.join("")).body;
    if (body === null) throw new Error("Missing fixture body.");
    yield* translateResponsesSse(body, {
      provider: request.provider, model: request.model, toolNamespace: "navo",
    });
  }
}

class PendingResponsesAdapter implements LLMAdapter {
  readonly started = Promise.withResolvers<void>();

  async *stream(_request: GenerateRequest): AsyncIterable<ModelEvent> {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start: (stream) => {
        stream.enqueue(encoder.encode(responseEvent({
          type: "response.output_item.added", output_index: 0,
          item: { type: "function_call", id: "fc_1", call_id: "call_1",
            name: "test_echo", namespace: "navo", arguments: "" },
        })));
        this.started.resolve();
      },
    });
    yield* translateResponsesSse(body, {
      provider: "openai", model: "gpt-test", toolNamespace: "navo",
    });
  }
}

function fixture(chunks: readonly string[]): Fixture {
  return { chunks };
}

function responseEvent(value: Record<string, unknown>): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}
