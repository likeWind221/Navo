import { afterEach, describe, expect, it } from "vitest";

import { createAgentTurnHandler } from "../../../src/host/turn.js";
import { createAgentTurnV2Handler } from "../../../src/host/turn/v2.js";
import { createApp } from "../../../src/app.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import type { Context } from "cordis";

const contexts: Context[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
});

describe("ordinary Session Host turn gates", () => {
  it("rejects archived Sessions before starting agent.turn.v1", async () => {
    await assertArchived(createAgentTurnHandler);
  });

  it("rejects archived Sessions before starting agent.turn.v2", async () => {
    await assertArchived(createAgentTurnV2Handler);
  });
});

async function assertArchived(createHandler: typeof createAgentTurnHandler | typeof createAgentTurnV2Handler): Promise<void> {
    const ctx = await createApp({
      storage: { path: ":memory:" },
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    contexts.push(ctx);
    ctx.llm.registerAdapter("mock", new MockLLMAdapter([]));
    const session = ctx.sessionDirectory.create("Archived");
    ctx.sessionDirectory.archive(session.sessionId, session.revision);
    const handler = createHandler(ctx, { model: { provider: "mock", model: "test" } });
    const iterator = handler({ sessionId: String(session.sessionId), requestId: "request", text: "hello" }, new AbortController().signal)
      [Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({
      code: "remote-error", failure: { code: "session-archived" },
    });
}
