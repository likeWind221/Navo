import { afterEach, describe, expect, it } from "vitest";

import { createMessageId, createSessionId, createStepId, createTurnId } from "../../src/brand/ids.js";
import { createRuntime, disposeRuntimes, modelResponse, turnInput } from "../helpers/runtime.js";

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
});
