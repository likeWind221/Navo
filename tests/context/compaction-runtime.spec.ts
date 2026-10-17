import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createMessageId, createSessionId, createStepId, createTurnId } from "../../src/brand/ids.js";
import { createRuntime, disposeRuntimes, eventTypes, modelError, modelResponse, turnInput } from "../helpers/runtime.js";
import { SessionStore } from "../../src/session/store.js";
import { summarize } from "../../src/context/compaction/summarizer.js";

afterEach(async () => {
  await disposeRuntimes();
});

describe("pressure-triggered context compaction", () => {
  it("installs a checkpoint before the next request and continues the Turn", async () => {
    const kit = await createRuntime([
      modelResponse([{ type: "text", text: "## Goal and User Constraints\n- Preserve the requested work." }]),
      modelResponse([{ type: "text", text: "answer after compaction" }]),
    ]);
    const sessionId = createSessionId("pressure-compaction-session");
    const turnId = createTurnId("seed-turn");
    const stepId = createStepId("seed-step");

    for (let index = 0; index < 3; index += 1) {
      kit.ctx.sessions.append({
        type: "user-message",
        sessionId,
        data: { message: { id: createMessageId("seed-user-" + index), role: "user",
          content: [{ type: "text", text: "u".repeat(3_000) }] } },
      });
      if (index < 2) {
        kit.ctx.sessions.append({
          type: "assistant-message",
          sessionId,
          data: {
            turnId,
            stepId,
            message: { id: createMessageId("seed-assistant-" + index), role: "assistant",
              content: [{ type: "text", text: "a".repeat(3_000) }] },
            finishReason: { kind: "stop" },
          },
        });
      }
    }

    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("pressure-compaction"),
      sessionId,
      model: { provider: "mock", model: "test", contextWindow: 20_000, maxTokens: 500 },
    });

    expect(result.status).toBe("completed");
    expect(kit.adapter.requests).toHaveLength(2);
    expect(kit.adapter.requests[0]?.messages.some(message => message.content.some(
      block => block.type === "text" && block.text.includes("Compress the conversation above"),
    ))).toBe(true);
    expect(kit.adapter.requests[1]?.messages.some(message => message.content.some(
      block => block.type === "text" && block.text.includes("<compacted-summary>"),
    ))).toBe(true);
    const events = kit.ctx.sessions.getEvents(sessionId);
    expect(events.some(event => event.type === "compaction-started")).toBe(true);
    expect(events.some(event => event.type === "compaction-checkpoint")).toBe(true);
    expect(events.some(event => event.type === "compaction-ended" && event.data.status === "completed")).toBe(true);
    expect(kit.ctx.sessions.deriveMessages(sessionId).some(message => message.content.some(
      block => block.type === "text" && block.text.includes("answer after compaction"),
    ))).toBe(true);
  });

  it("omits unsupported output token limits from OpenAI summary requests", async () => {
    const kit = await createRuntime([
      modelResponse([{ type: "text", text: "## Goal and User Constraints\n- Continue the task." }]),
    ]);
    kit.ctx.llm.registerAdapter("openai", kit.adapter);
    await summarize(kit.ctx, "openai", "gpt-6-luna", [{
      id: createMessageId("openai-summary-source"),
      role: "user",
      content: [{ type: "text", text: "Earlier context." }],
    }], 512, new AbortController().signal, 0);

    expect(kit.adapter.requests).toHaveLength(1);
    expect(kit.adapter.requests[0]).not.toHaveProperty("maxTokens");
  });

  it("recovers from provider overflow without configured context capacity", async () => {
    const kit = await createRuntime([
      modelError("CONTEXT_WINDOW_EXCEEDED"),
      modelResponse([{ type: "text", text: "## Goal and User Constraints\n- Preserve the task and key decisions." }]),
      modelResponse([{ type: "text", text: "recovered after overflow" }]),
    ]);
    const sessionId = createSessionId("overflow-compaction-session");
    const turnId = createTurnId("overflow-seed-turn");
    const stepId = createStepId("overflow-seed-step");

    for (let index = 0; index < 2; index += 1) {
      kit.ctx.sessions.append({
        type: "user-message",
        sessionId,
        data: { message: { id: createMessageId("overflow-user-" + index), role: "user",
          content: [{ type: "text", text: "u".repeat(3_000) }] } },
      });
      kit.ctx.sessions.append({
        type: "assistant-message",
        sessionId,
        data: {
          turnId,
          stepId,
          message: { id: createMessageId("overflow-assistant-" + index), role: "assistant",
            content: [{ type: "text", text: "a".repeat(3_000) }] },
          finishReason: { kind: "stop" },
        },
      });
    }

    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("overflow-compaction"),
      sessionId,
      model: { provider: "mock", model: "test" },
    });

    expect(result.status).toBe("completed");
    expect(kit.adapter.requests).toHaveLength(3);
    expect(kit.ctx.sessions.getEvents(sessionId).some(event =>
      event.type === "compaction-started" && event.data.trigger === "overflow",
    )).toBe(true);
    expect(kit.ctx.sessions.getEvents(sessionId).some(event =>
      event.type === "compaction-ended" && event.data.status === "completed",
    )).toBe(true);
    expect(kit.ctx.sessions.deriveMessages(sessionId).some(message => message.content.some(
      block => block.type === "text" && block.text.includes("recovered after overflow"),
    ))).toBe(true);
  });

  it("fails closed when overflow cannot compact any safe history", async () => {
    const kit = await createRuntime([modelError("CONTEXT_WINDOW_EXCEEDED")]);
    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("overflow-no-progress"),
      model: { provider: "mock", model: "test" },
    });

    expect(result).toMatchObject({ status: "failed", failure: { code: "context-window-exceeded" } });
    expect(kit.adapter.requests).toHaveLength(1);
    expect(eventTypes(kit, "overflow-no-progress")).toContain("turn-ended");
  });

  it("folds an earlier checkpoint into a later summary across repeated compactions", async () => {
    const kit = await createRuntime([
      modelResponse([{ type: "text", text: "## Goal and User Constraints\n- First cumulative checkpoint." }]),
      modelResponse([{ type: "text", text: "## Goal and User Constraints\n- Updated cumulative checkpoint." }]),
      modelResponse([{ type: "text", text: "answer after repeated compaction" }]),
    ]);
    const sessionId = createSessionId("repeated-compaction-session");
    const turnId = createTurnId("repeated-seed-turn");
    const stepId = createStepId("repeated-seed-step");

    for (let index = 0; index < 5; index += 1) {
      kit.ctx.sessions.append({
        type: "user-message",
        sessionId,
        data: { message: { id: createMessageId("repeated-user-" + index), role: "user",
          content: [{ type: "text", text: "u".repeat(3_000) }] } },
      });
      if (index < 4) {
        kit.ctx.sessions.append({
          type: "assistant-message",
          sessionId,
          data: {
            turnId,
            stepId,
            message: { id: createMessageId("repeated-assistant-" + index), role: "assistant",
              content: [{ type: "text", text: "a".repeat(3_000) }] },
            finishReason: { kind: "stop" },
          },
        });
      }
    }

    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("repeated-pressure-compaction"),
      sessionId,
      model: { provider: "mock", model: "test", contextWindow: 20_000, maxTokens: 500 },
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(kit.adapter.requests).toHaveLength(3);
    expect(kit.adapter.requests[1]?.messages.some(message => message.content.some(
      block => block.type === "text" && block.text.includes("<compacted-summary>"),
    ))).toBe(true);
    const events = kit.ctx.sessions.getEvents(sessionId);
    expect(events.filter(event => event.type === "compaction-started")).toHaveLength(2);
    expect(events.filter(event => event.type === "compaction-checkpoint")).toHaveLength(2);
    expect(events.filter(event => event.type === "compaction-ended" && event.data.status === "completed")).toHaveLength(2);
    const recovery = new Context();
    await recovery.plugin(SessionStore);
    recovery.sessions.restore(sessionId, events);
    expect(recovery.sessions.deriveMessages(sessionId).map(message => message.id))
      .toEqual(kit.ctx.sessions.deriveMessages(sessionId).map(message => message.id));
    await recovery.fiber.dispose();
  });

  it("keeps the original surface when summary generation fails", async () => {
    const kit = await createRuntime([modelError("INVALID_REQUEST")]);
    const sessionId = createSessionId("failed-compaction-session");
    const turnId = createTurnId("failed-seed-turn");
    const stepId = createStepId("failed-seed-step");

    for (let index = 0; index < 3; index += 1) {
      kit.ctx.sessions.append({
        type: "user-message",
        sessionId,
        data: { message: { id: createMessageId("failed-user-" + index), role: "user",
          content: [{ type: "text", text: "u".repeat(3_000) }] } },
      });
      if (index < 2) {
        kit.ctx.sessions.append({
          type: "assistant-message",
          sessionId,
          data: {
            turnId,
            stepId,
            message: { id: createMessageId("failed-assistant-" + index), role: "assistant",
              content: [{ type: "text", text: "a".repeat(3_000) }] },
            finishReason: { kind: "stop" },
          },
        });
      }
    }

    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("failed-pressure-compaction"),
      sessionId,
      model: { provider: "mock", model: "test", contextWindow: 20_000, maxTokens: 500 },
    });

    expect(result.status).toBe("failed");
    expect(kit.adapter.requests).toHaveLength(1);
    expect(kit.ctx.sessions.deriveMessages(sessionId).some(message => message.content.some(
      block => block.type === "text" && block.text.includes("<compacted-summary>"),
    ))).toBe(false);
    expect(kit.ctx.sessions.getEvents(sessionId).some(
      event => event.type === "compaction-ended" && event.data.status === "failed",
    )).toBe(true);
  });
});
