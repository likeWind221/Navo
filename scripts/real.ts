import { Context } from "cordis";

import {
  createMessageId,
  createSessionId,
} from "../src/brand/ids.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { resolveKernelHostConfig } from "../src/host/config.js";
import { QwenChatCompletionsAdapter } from "../src/llm/adapters/qwen.js";
import { LLMService } from "../src/llm/service.js";
import { SessionStore } from "../src/session/store.js";
import { ToolService } from "../src/tools/service.js";

async function main(): Promise<void> {
  const config = resolveKernelHostConfig();
  const ctx = new Context();
  try {
    await ctx.plugin(SessionStore);
    await ctx.plugin(LLMService);
    await ctx.plugin(ToolService);
    await ctx.plugin(AgentRuntime);
    ctx.llm.registerAdapter(config.provider, new QwenChatCompletionsAdapter(config.adapter));
    ctx.tools.register({
      name: "echo_for_real_test",
      description: "Returns its text argument unchanged.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (arguments_) => String(arguments_.text),
    });

    const sessionId = createSessionId("real-agent-step");
    const result = await ctx.agentRuntime.runTurn({
      sessionId,
      userMessage: {
        id: createMessageId("real-agent-user"),
        role: "user",
        content: [{
          type: "text",
          text: "Call echo_for_real_test exactly once with text 'real-loop', then use its result to answer exactly: FINAL: real-loop",
        }],
      },
      model: config.agent.model,
      toolNames: ["echo_for_real_test"],
    });
    if (result.status !== "completed" || result.steps !== 2) {
      throw new Error(`Expected a completed two-Step Turn; received ${JSON.stringify(result)}.`);
    }
    const text = ctx.sessions.getEvents(sessionId).flatMap((event) =>
      event.type === "assistant-message"
        ? event.data.message.content.filter((block) => block.type === "text")
        : [],
    ).at(-1)?.text ?? "";
    if (text.trim() !== "FINAL: real-loop") {
      throw new Error(`Unexpected final answer: ${JSON.stringify(text)}`);
    }
    process.stdout.write("Real two-Step AgentRuntime Turn passed.\n");
  } finally {
    await ctx.fiber.dispose();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
