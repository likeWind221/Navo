import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createMessageId, createSessionId } from "../../src/brand/ids.js";
import { SessionStore } from "../../src/session/store.js";

const contexts = new Set<Context>();

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("SessionStore.deriveMessages", () => {
  it("derives only model-visible events and extends its cached surface", async () => {
    const ctx = await session();
    const id = createSessionId("derived-history");
    appendText(ctx, id, "user", "first");
    ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId: "turn" as never } });

    expect(ctx.sessions.deriveMessages(id).map(text)).toEqual(["first"]);
    appendText(ctx, id, "assistant", "second");
    expect(ctx.sessions.deriveMessages(id).map(text)).toEqual(["first", "second"]);
  });

  it("prepends an explicit system prompt without adding it to the surface", async () => {
    const ctx = await session();
    const id = createSessionId("system-prefix");
    appendText(ctx, id, "user", "question");

    const messages = ctx.sessions.deriveMessages(id, "follow the rules");
    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(ctx.sessions.deriveMessages(id).map(text)).toEqual(["question"]);
  });

  it("replaces a current surface range without deleting raw log events", async () => {
    const ctx = await session();
    const id = createSessionId("summary-surface");
    const first = appendText(ctx, id, "user", "A");
    const second = appendText(ctx, id, "assistant", "B");
    const third = appendText(ctx, id, "user", "C");
    appendText(ctx, id, "user", "D", { op: "replace", start: first.sequence, end: third.sequence });

    expect(ctx.sessions.getEvents(id)).toHaveLength(4);
    expect(ctx.sessions.deriveMessages(id).map(text)).toEqual(["D"]);
    expect(second.type).toBe("assistant-message");
  });

  it("rejects an invalid replacement while keeping the current surface", async () => {
    const ctx = await session();
    const id = createSessionId("invalid-surface");
    appendText(ctx, id, "user", "A");

    expect(() => appendText(ctx, id, "user", "bad", { op: "replace", start: 99, end: 100 }))
      .toThrow(RangeError);
    expect(ctx.sessions.deriveMessages(id).map(text)).toEqual(["A"]);
  });
});

async function session(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);
  return ctx;
}

function appendText(
  ctx: Context,
  sessionId: ReturnType<typeof createSessionId>,
  role: "user" | "assistant",
  value: string,
  surfaceOp?: "append" | { readonly op: "replace"; readonly start: number; readonly end: number },
) {
  const message = {
    id: createMessageId(`message-${value}`),
    content: [{ type: "text" as const, text: value }],
  };
  if (role === "user") {
    return ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { ...message, role: "user" } },
    }, surfaceOp);
  }
  return ctx.sessions.append({
    type: "assistant-message",
    sessionId,
    data: {
      turnId: "turn" as never,
      stepId: "step" as never,
      message: { ...message, role: "assistant" },
      finishReason: { kind: "stop" },
    },
  }, surfaceOp);
}

function text(message: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
  return message.content.find((block) => block.type === "text")?.text ?? "";
}
