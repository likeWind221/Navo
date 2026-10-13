import { describe, expect, it } from "vitest";

import { createMessageId, createToolCallId } from "../../../src/brand/ids.js";
import {
  serializeResponsesRequest,
} from "../../../src/llm/protocols/responses/request.js";
import { translateResponsesSse } from "../../../src/llm/protocols/responses/stream.js";
import { createResponsesReplay } from "../../../src/llm/protocols/responses/replay.js";
import type { GenerateRequest, ModelEvent } from "../../../src/llm/types.js";

describe("Responses protocol", () => {
  it("keeps reasoning items and function calls in an opaque replay", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({
        type: "response.output_item.added",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" },
      }),
      event({
        type: "response.reasoning_summary_text.delta",
        output_index: 0,
        delta: "plan",
      }),
      event({
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "sealed" },
      }),
      event({
        type: "response.output_item.added",
        output_index: 1,
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", namespace: "navo", arguments: "" },
      }),
      event({
        type: "response.function_call_arguments.delta",
        output_index: 1,
        delta: "{}",
      }),
      event({
        type: "response.function_call_arguments.done",
        output_index: 1,
        arguments: "{}",
      }),
      event({
        type: "response.output_item.done",
        output_index: 1,
        item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", namespace: "navo", arguments: "{}", status: "completed" },
      }),
      event({
        type: "response.completed",
        response: {
          usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
          output: [
            { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "plan" }], encrypted_content: "sealed" },
            { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", namespace: "navo", arguments: "{}", status: "completed" },
          ],
        },
      }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));

    expect(events).toEqual([
      { type: "content-started", contentIndex: 0, contentType: "reasoning" },
      { type: "content-delta", contentIndex: 0, contentType: "reasoning", delta: "plan" },
      { type: "content-started", contentIndex: 1, contentType: "tool-call", toolCallId: createToolCallId("call_1") },
      { type: "content-delta", contentIndex: 1, contentType: "tool-call", toolCallId: createToolCallId("call_1"), toolNameDelta: "read", delta: "" },
      { type: "content-delta", contentIndex: 1, contentType: "tool-call", toolCallId: createToolCallId("call_1"), delta: "{}" },
      { type: "content-completed", contentIndex: 0, contentType: "reasoning" },
      { type: "content-completed", contentIndex: 1, contentType: "tool-call" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } },
      {
        type: "finished", reason: { kind: "tool-calls" }, replay: expect.objectContaining({
          version: 1,
          source: { provider: "openai", model: "gpt-test" },
          items: [
            { contentIndex: 0, payload: expect.objectContaining({ encrypted_content: "sealed" }) },
            { contentIndex: 1, payload: expect.objectContaining({ call_id: "call_1", namespace: "navo" }) },
          ],
        }),
      },
    ]);
  });

  it("restores replay items and links a tool result by native call_id", () => {
    const toolCallId = createToolCallId("call_1");
    const request: GenerateRequest = {
      provider: "openai",
      model: "gpt-test",
      messages: [
        {
          id: createMessageId("user"), role: "user",
          content: [{ type: "text", text: "read" }],
        },
        {
          id: createMessageId("assistant"), role: "assistant",
          content: [
            { type: "text", text: "visible" },
            { type: "tool-call", id: toolCallId, name: "read", arguments: "{}" },
          ],
          replay: createResponsesReplay("openai", "gpt-test", [
            { contentIndex: null, payload: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" } },
            { contentIndex: 0, payload: { type: "message", id: "msg_1", role: "assistant", phase: "commentary",
              content: [{ type: "output_text", text: "native" }] } },
            { contentIndex: 1, payload: { type: "function_call", id: "fc_1", call_id: "call_1", name: "read", namespace: "navo", arguments: "native", status: "completed" } },
          ]),
        },
        {
          id: createMessageId("result"), role: "user",
          content: [{ type: "tool-result", toolCallId, isError: false,
            content: [{ type: "text", text: "contents" }] }],
        },
      ],
    };

    expect(serializeResponsesRequest(request, {
      toolNamespace: "navo",
    })).toMatchObject({
      store: false,
      stream: true,
      input: expect.arrayContaining([
        expect.objectContaining({ type: "message", role: "user", content: "read" }),
        expect.objectContaining({ type: "reasoning", encrypted_content: "sealed" }),
        expect.objectContaining({ type: "message", phase: "commentary",
          content: [{ type: "output_text", text: "visible" }] }),
        expect.objectContaining({ type: "function_call", call_id: "call_1", namespace: "navo", arguments: "{}" }),
        expect.objectContaining({ type: "function_call_output", call_id: "call_1", namespace: "navo", output: "contents" }),
      ]),
    });
  });

  it("rejects a function call completed without output_item.done", async () => {
    await expect(collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.added", output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "read", namespace: "navo", arguments: "" } }),
      event({ type: "response.function_call_arguments.delta", output_index: 0, delta: "{}" }),
      event({ type: "response.completed", response: { output: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "read",
          namespace: "navo", arguments: "{}", status: "completed" },
      ] } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" })))
      .resolves.toContainEqual({ type: "finished", reason: {
        kind: "error", failure: { code: "INCOMPLETE_TOOL",
          message: "Responses function call was incomplete." },
      } });
  });

  it("fills final function arguments from output_item.done", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.added", output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "read", namespace: "navo", arguments: "" } }),
      event({ type: "response.output_item.done", output_index: 0,
        item: { type: "function_call", id: "fc_1", call_id: "call_1",
          name: "read", namespace: "navo", arguments: "{}", status: "completed" } }),
      event({ type: "response.completed", response: { output: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "read",
          namespace: "navo", arguments: "{}", status: "completed" },
      ] } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "content-delta", contentType: "tool-call", delta: "{}",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "finished", reason: { kind: "tool-calls" },
    }));
  });

  it("reconciles reasoning summary done events and retains their native shape", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.added", output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "sealed" } }),
      event({ type: "response.reasoning_summary_text.done", output_index: 0,
        summary_index: 0, text: "plan" }),
      event({ type: "response.reasoning_summary_text.done", output_index: 0,
        summary_index: 1, text: " then act" }),
      event({ type: "response.output_item.done", output_index: 0,
        item: { type: "reasoning", id: "rs_1", summary: [
          { type: "summary_text", text: "plan" },
          { type: "summary_text", text: " then act" },
        ], encrypted_content: "sealed" } }),
      event({ type: "response.completed", response: { output: [
        { type: "reasoning", id: "rs_1", summary: [
          { type: "summary_text", text: "plan" },
          { type: "summary_text", text: " then act" },
        ], encrypted_content: "sealed" },
      ] } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));
    expect(events).toContainEqual({ type: "content-delta", contentIndex: 0,
      contentType: "reasoning", delta: "plan" });
    expect(events).toContainEqual({ type: "content-delta", contentIndex: 0,
      contentType: "reasoning", delta: " then act" });
    const finished = events.find((value) => value.type === "finished");
    expect(finished?.type === "finished" ? finished.replay?.items[0]?.payload : undefined)
      .toMatchObject({ encrypted_content: "sealed", summary: [
        { type: "summary_text", text: "" },
        { type: "summary_text", text: "" },
      ] });
  });

  it("projects refusal deltas as visible text and replays refusal metadata", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.added", output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", phase: "final_answer", content: [] } }),
      event({ type: "response.refusal.delta", output_index: 0, content_index: 0, delta: "cannot" }),
      event({ type: "response.refusal.done", output_index: 0, content_index: 0, refusal: "cannot" }),
      event({ type: "response.output_item.done", output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", phase: "final_answer",
          content: [{ type: "refusal", refusal: "cannot" }] } }),
      event({ type: "response.completed", response: { output: [
        { type: "message", id: "msg_1", role: "assistant", phase: "final_answer",
          content: [{ type: "refusal", refusal: "cannot" }] },
      ] } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));
    expect(events).toContainEqual({ type: "content-delta", contentIndex: 0,
      contentType: "text", delta: "cannot" });
    const finished = events.find((value) => value.type === "finished");
    expect(finished?.type === "finished" ? finished.replay?.items[0]?.payload : undefined)
      .toMatchObject({ phase: "final_answer", content: [{ type: "refusal", refusal: "" }] });
  });

  it("projects multiple message content parts from a final item without deltas", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.done", output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [
          { type: "output_text", text: "a" }, { type: "output_text", text: "b" },
        ] } }),
      event({ type: "response.completed", response: { output: [
        { type: "message", id: "msg_1", role: "assistant", content: [
          { type: "output_text", text: "a" }, { type: "output_text", text: "b" },
        ] },
      ] } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));
    expect(events).toContainEqual({ type: "content-delta", contentIndex: 0,
      contentType: "text", delta: "a" });
    expect(events).toContainEqual({ type: "content-delta", contentIndex: 0,
      contentType: "text", delta: "b" });
    const finished = events.find((value) => value.type === "finished");
    expect(finished?.type === "finished" ? finished.replay?.items[0]?.payload : undefined)
      .toMatchObject({ type: "message", content: [
        { type: "output_text", text: "" }, { type: "output_text", text: "" },
      ] });
  });

  it("rejects final text that conflicts with streamed text", async () => {
    await expect(collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_item.added", output_index: 0,
        item: { type: "message", id: "msg_1", role: "assistant", content: [] } }),
      event({ type: "response.output_text.delta", output_index: 0, delta: "abc" }),
      event({ type: "response.output_text.done", output_index: 0, text: "abd" }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" })))
      .rejects.toThrow("output text changed its prefix");
  });

  it("stops after the first terminal event", async () => {
    const events = await collect(translateResponsesSse(sseResponse([
      event({ type: "response.completed", response: { output: [] } }),
      event({ type: "response.failed", response: { error: { code: "late" } } }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" }));
    expect(events.filter((value) => value.type === "finished")).toHaveLength(1);
    expect(events).toContainEqual(expect.objectContaining({
      type: "finished", reason: { kind: "stop" },
    }));
  });

  it.each([
    ["response.failed", { type: "response.failed", response: { error: { code: "quota", message: "limit" } } }, "quota"],
    ["response.incomplete", { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, "INCOMPLETE"],
  ] as const)("maps %s to a terminal failure", async (_name, failure, code) => {
    await expect(collect(translateResponsesSse(sseResponse([
      event(failure),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" })))
      .resolves.toContainEqual({ type: "finished", reason: { kind: "error", failure: expect.objectContaining({ code }) } });
  });

  it("rejects a stream without a terminal response event", async () => {
    await expect(collect(translateResponsesSse(sseResponse([
      event({ type: "response.output_text.delta", output_index: 0, delta: "partial" }),
    ]).body!, { provider: "openai", model: "gpt-test", toolNamespace: "navo" })))
      .rejects.toThrow("terminal response event");
  });
});

function event(value: Record<string, unknown>): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
