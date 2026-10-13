import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAIAdapter } from "../../../src/llm/adapters/openai.js";
import { ChatGPTAuthError } from "../../../src/llm/auth/chatgpt.js";
import { collectStream } from "../../../src/llm/collect.js";
import type { GenerateRequest } from "../../../src/llm/types.js";
import { createRuntime, disposeRuntimes, turnInput } from "../../helpers/runtime.js";

afterEach(disposeRuntimes);

const request: GenerateRequest = { provider: "openai", model: "gpt-6-luna", messages: [] };
const auth = { accessToken: vi.fn(async () => "test-credential") };

describe("OpenAI subscription adapter", () => {
  it("uses the subscription token and public Responses endpoint, retaining replay", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => completed("hello"));
    const adapter = new OpenAIAdapter({ auth, accountId: "selected", fetch: fetchImpl });
    const result = await collectStream(adapter.stream(request));
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
    expect(result.replay?.source).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(auth.accessToken).toHaveBeenLastCalledWith("selected", expect.any(AbortSignal));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-credential" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "gpt-6-luna", input: [], stream: true, store: false });
  });

  it("rejects unsupported output controls before authentication or HTTP", async () => {
    const token = vi.fn(async () => "token");
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new OpenAIAdapter({ auth: { accessToken: token }, fetch: fetchImpl });
    for (const override of [{ maxTokens: 10 }, { temperature: 0 }]) {
      await expect(collectStream(adapter.stream({ ...request, ...override })))
        .rejects.toMatchObject({ code: "UNSUPPORTED_PARAMETER" });
    }
    expect(token).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not make an HTTP request when login is required", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const adapter = new OpenAIAdapter({ auth: { accessToken: async () => {
      throw new ChatGPTAuthError("login-required", "private diagnostic");
    } }, fetch: fetchImpl });
    await expect(collectStream(adapter.stream(request))).rejects.toMatchObject({ code: "AUTH" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("releases an unfinished response and aborts its HTTP lifecycle on consumer return", async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const adapter = new OpenAIAdapter({ auth, fetch: async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(sse({ type: "response.output_text.delta", output_index: 0, delta: "partial" })));
      }, cancel }));
    } });
    const iterator = adapter.stream(request);
    await iterator.next();
    await iterator.return(undefined);
    expect(cancel).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });

  it.each([false, true])("stops once on subscription quota failure, published=%s", async (published) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => published
      ? new Response(sse({ type: "response.output_text.delta", output_index: 0, delta: "prefix" })
        + sse({ type: "response.failed", response: { error: {
          code: "subscription_sharing_usage_limit_exceeded", message: "Check ChatGPT Settings > Usage.",
        } } }))
      : Response.json({ error: { code: "subscription_sharing_usage_limit_exceeded" } }, { status: 429 }));
    const kit = await createRuntime([]);
    kit.ctx.llm.registerAdapter("openai", new OpenAIAdapter({ auth, fetch: fetchImpl }));
    const result = await kit.ctx.agentRuntime.runTurn({ ...turnInput(`quota-${published}`),
      model: { provider: "openai", model: "gpt-6-luna" } });
    expect(result).toMatchObject({ status: "failed", failure: { code: "subscription_sharing_usage_limit_exceeded" } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(kit.adapter.requests).toHaveLength(0);
  });
});

function sse(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function completed(text: string): Response {
  return new Response(sse({ type: "response.completed", response: { output: [
    { type: "message", id: "msg_test", role: "assistant", phase: "final_answer",
      content: [{ type: "output_text", text }] },
  ] } }));
}
