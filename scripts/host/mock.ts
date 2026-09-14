import {
  agentTurnMethod,
  agentTurnV2Method,
  sessionCommandMethod,
  StreamRpcRouter,
  StreamRpcServer,
} from "../../rpc/index.js";
import { createApp } from "../../src/app.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { ModelEvent } from "../../src/llm/types.js";
import { createSessionCommandHandler } from "../../src/host/command.js";
import {
  createMockAgentTurnHandler,
  resolveMockAgentTurnConfig,
} from "../../src/host/turn/mock.js";
import { createAgentTurnV2Handler } from "../../src/host/turn/v2.js";
import { StdioRpcServerTransport } from "../../src/host/stdio.js";

async function main(): Promise<void> {
  const config = resolveMockAgentTurnConfig(process.env, () => process.exit(23));
  const ctx = await createApp({
    node: { session: { model: { provider: "mock", model: "mock" } } },
  });
  const unregister = ctx.llm.registerAdapter("mock", createMockLlmAdapter(process.env));
  const transport = new StdioRpcServerTransport(process.stdin, process.stdout);
  const router = new StreamRpcRouter();
  router.register(agentTurnMethod, createMockAgentTurnHandler(config));
  router.register(agentTurnV2Method, createAgentTurnV2Handler(ctx, {
    model: { provider: "mock", model: "mock" },
  }));
  router.register(sessionCommandMethod, createSessionCommandHandler(ctx));
  const server = new StreamRpcServer(transport, router);
  const stop = (): void => { void server.dispose(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stderr.write("[mock-kernel-host] ready\n");
  try {
    await server.serve();
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    unregister();
    await ctx.fiber.dispose();
    await transport.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Mock Host failure";
  process.stderr.write(`[mock-kernel-host] fatal: ${message}\n`);
  process.exitCode = 1;
});

function createMockLlmAdapter(env: NodeJS.ProcessEnv): MockLLMAdapter {
  const mode = env.NAVO_MOCK_LLM_MODE ?? "completed";
  if (mode === "completed") {
    return new MockLLMAdapter([{
      kind: "handler",
      handle: () => completedEvents(),
    }]);
  }
  if (mode === "hang") {
    return new MockLLMAdapter([{
      kind: "hang",
      eventsBeforeHang: [
        { type: "content-started", contentIndex: 0, contentType: "text" },
        { type: "content-delta", contentIndex: 0, contentType: "text", delta: "mock" },
      ],
    }]);
  }
  if (mode === "failed") {
    return new MockLLMAdapter([{
      kind: "error",
      eventsBeforeError: [
        { type: "content-started", contentIndex: 0, contentType: "text" },
      ],
      error: new Error("Mock LLM failure."),
    }]);
  }
  throw new TypeError("NAVO_MOCK_LLM_MODE is invalid.");
}

function completedEvents(): readonly ModelEvent[] {
  return [
    { type: "content-started", contentIndex: 0, contentType: "text" },
    { type: "content-delta", contentIndex: 0, contentType: "text", delta: "mock" },
    { type: "content-completed", contentIndex: 0, contentType: "text" },
    { type: "finished", reason: { kind: "stop" } },
  ];
}
