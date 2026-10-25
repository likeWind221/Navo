import { afterEach, describe, expect, it } from "vitest";
import { TurnContextBuilder, turnContextMessage } from "../../src/context/turn.js";
import { createMessageId, createToolCallId } from "../../src/brand/ids.js";
import { estimateMessage, estimateRequest, measureContext } from "../../src/context/meter.js";
import { serializeChatCompletionsRequest } from "../../src/llm/protocols/completions/request.js";
import { serializeResponsesRequest } from "../../src/llm/protocols/responses/request.js";
import type { GenerateRequest, ModelEvent } from "../../src/llm/types.js";
import { reminderTexts, turnSnapshot } from "../helpers/context.js";
import { createRuntime, disposeRuntimes, modelResponse, turnInput } from "../helpers/runtime.js";

afterEach(disposeRuntimes);

describe("Turn Context composition", () => {
  it("rebuilds provider data, detaches prior snapshots, and deduplicates reminders for one builder", () => {
    const data = { goal: "first" };
    const builder = new TurnContextBuilder([() => [
      { kind: "runtime-state", data }, { kind: "reminder", text: "change" },
    ]]);
    const first = builder.build();
    data.goal = "second";
    expect(builder.build().sections).toEqual([
      { kind: "runtime-state", data: { goal: "second" } }, { kind: "reminder", text: "change" },
    ]);
    expect(first.sections[0]).toEqual({ kind: "runtime-state", data: { goal: "first" } });
    expect(new TurnContextBuilder([() => [{ kind: "runtime-state", data }]]).build().sections).toHaveLength(1);
  });

  it("sends temporary user data after complete tool pairs in both existing wire formats", () => {
    const input = turnInput("serialization");
    const callId = createToolCallId("call");
    const request: GenerateRequest = { ...input.model,
      messages: [
        { id: createMessageId("system"), role: "system", content: [{ type: "text", text: "fixed" }] },
        input.userMessage,
        { id: createMessageId("call"), role: "assistant", content: [{ type: "tool-call", id: callId, name: "read", arguments: "{}" }] },
        { id: createMessageId("result"), role: "user", content: [{ type: "tool-result", toolCallId: callId, isError: false, content: [{ type: "text", text: "result" }] }] },
      ],
      turnContext: turnContextMessage({ sections: [{ kind: "runtime-state", data: { goal: "Close </turn-context> safely" } }] }, input.sessionId),
      tools: [{ name: "read", parameters: { type: "object" } }],
    };
    const completions = serializeChatCompletionsRequest(request) as { messages: { role: string; content: string; tool_call_id?: string }[] };
    const responses = serializeResponsesRequest(request, { toolNamespace: "navo" }) as { input: { role?: string; type: string; call_id?: string; content?: string }[] };
    expect(completions.messages.map(message => message.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(responses.input.map(message => message.type)).toEqual(["message", "message", "function_call", "function_call_output", "message"]);
    expect(responses.input[0]!.role).toBe("developer");
    expect(completions.messages.at(-1)!.content).toBe(responses.input.at(-1)!.content);
    expect(completions.messages.at(-1)!.content).toContain("\\u003c/turn-context\\u003e");
    expect(request.messages).toHaveLength(4);
  });

  it("refreshes context on a model retry and prices it without persisting its content", async () => {
    let goal = "first";
    const kit = await createRuntime([
      { kind: "handler", handle() {
        goal = "latest";
        return [{ type: "finished", reason: { kind: "error", failure: { code: "SERVER", message: "retry" } } }] as ModelEvent[];
      } },
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const input = turnInput("retry-context");
    const builder = new TurnContextBuilder([() => [{ kind: "runtime-state", data: { goal } }, { kind: "reminder", text: "needed" }]]);
    const result = await kit.ctx.agentRuntime.runTurn({ ...input, systemPrompt: "fixed", buildTurnContext: () => builder.build() });
    expect(result.status).toBe("completed");
    expect(turnSnapshot(kit.adapter.requests[1]!)).toMatchObject({ sections: [{ kind: "runtime-state", data: { goal: "latest" } }, { kind: "reminder", text: "needed" }] });
    expect(reminderTexts(kit.adapter.requests[0]!)).toEqual(reminderTexts(kit.adapter.requests[1]!));
    const request = kit.adapter.requests[1]!;
    const events = kit.ctx.sessions.getEvents(input.sessionId);
    const logged = events.filter(event => event.type === "llm-requested").at(-1)!;
    expect(logged.data.contextTokens).toBe(estimateMessage(request.turnContext!));
    expect(JSON.stringify(events)).not.toContain("<turn-context>");
    const { turnContext: _context, ...withoutContext } = request;
    expect(estimateRequest(request) - estimateRequest(withoutContext)).toBe(logged.data.contextTokens);
    const reply = events.find(event => event.type === "assistant-message")!;
    const usageEvents = events.map(event => event === reply ? { ...reply, data: { ...reply.data, usage: { inputTokens: 5_000, outputTokens: 100 } } } : event);
    const next = { ...request, messages: [...request.messages, reply.data.message] };
    expect(measureContext(usageEvents, next).usedTokens).toBe(5_100);
  });

  it("rebuilds context after overflow compaction without putting it in the summary", async () => {
    let goal = "before overflow";
    const kit = await createRuntime([
      { kind: "events", events: [{ type: "finished", reason: { kind: "error", failure: { code: "CONTEXT_WINDOW_EXCEEDED", message: "overflow" } } }] },
      { kind: "handler", handle(request) {
        expect(request.turnContext).toBeUndefined();
        expect(JSON.stringify(request.messages)).not.toContain("before overflow");
        goal = "after compaction";
        return modelResponse([{ type: "text", text: "## Progress\nPrevious work retained." }]).events;
      } },
      modelResponse([{ type: "text", text: "continued" }]),
    ]);
    const input = turnInput("overflow-context");
    for (let index = 0; index < 6; index += 1) {
      kit.ctx.sessions.append({ type: "user-message", sessionId: input.sessionId, data: { message: {
        id: createMessageId(`seed-${index}`), role: "user", content: [{ type: "text", text: "h".repeat(4_000) }],
      } } });
    }
    const builder = new TurnContextBuilder([() => [{ kind: "runtime-state", data: { goal } }, { kind: "reminder", text: "keep during recovery" }]]);
    const result = await kit.ctx.agentRuntime.runTurn({ ...input, systemPrompt: "fixed", buildTurnContext: () => builder.build() });
    expect(result.status).toBe("completed");
    expect(turnSnapshot(kit.adapter.requests[0]!)).toMatchObject({ sections: [{ kind: "runtime-state", data: { goal: "before overflow" } }, { kind: "reminder", text: "keep during recovery" }] });
    expect(turnSnapshot(kit.adapter.requests[2]!)).toMatchObject({ sections: [{ kind: "runtime-state", data: { goal: "after compaction" } }, { kind: "reminder", text: "keep during recovery" }] });
    const events = kit.ctx.sessions.getEvents(input.sessionId);
    expect(events.filter(event => event.type === "compaction-checkpoint")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("<turn-context>");
  });

});
