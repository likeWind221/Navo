import {
  agentTurnMethod,
  agentTurnV2Method,
  sessionCommandMethod,
  StreamRpcRouter,
  StreamRpcServer,
} from "../../rpc/index.js";
import { join } from "node:path";

import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { ModelEvent } from "../../src/llm/types.js";
import { createSessionCommandHandler } from "../../src/host/command.js";
import { registerProjectMethods } from "../../src/host/project.js";
import {
  createMockAgentTurnHandler,
  resolveMockAgentTurnConfig,
} from "../../src/host/turn/mock.js";
import { createAgentTurnV2Handler } from "../../src/host/turn/v2.js";
import { StdioRpcServerTransport } from "../../src/host/stdio.js";

async function main(): Promise<void> {
  const config = resolveMockAgentTurnConfig(process.env, () => process.exit(23));
  const home = process.env.NAVO_HOME?.trim();
  const ctx = await createApp({
    storage: { path: home ? join(home, "navo.db") : ":memory:" },
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
  registerProjectMethods(router, ctx);
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
  if (mode === "roadmap") {
    return new MockLLMAdapter([
      { kind: "events", events: createRoadmapEvents() },
      { kind: "handler", handle: () => completedEvents() },
    ]);
  }
  if (mode === "handoff") {
    return new MockLLMAdapter([
      { kind: "events", events: createRoadmapEvents() },
      { kind: "events", events: completedEvents() },
      { kind: "events", events: toolEvents("register_resource", { path: "report.md", name: "Report", description: "Findings", type: "text/markdown" }) },
      { kind: "events", events: toolEvents("send_to_main", { message: "Report ready" }) },
      { kind: "handler", handle: () => completedEvents() },
    ]);
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

function createRoadmapEvents(): readonly ModelEvent[] {
  const work = (key: string, dependsOn: readonly string[]) => ({
    key, title: `Step ${key}`, goal: `Finish step ${key}`,
    done_when: [`Step ${key} is reviewed`], required: true, depends_on: dependsOn,
  });
  const args = JSON.stringify({ reason: "Mock plan", nodes: [work("a", []), work("b", ["a"])] });
  const toolCallId = createToolCallId("mock-create-roadmap");
  return [
    { type: "content-started", contentIndex: 0, contentType: "tool-call", toolCallId },
    {
      type: "content-delta", contentIndex: 0, contentType: "tool-call",
      toolCallId, toolNameDelta: "create_roadmap", delta: args,
    },
    { type: "content-completed", contentIndex: 0, contentType: "tool-call" },
    { type: "finished", reason: { kind: "tool-calls" } },
  ];
}

function toolEvents(name: string, args: Record<string, string>): readonly ModelEvent[] {
  const toolCallId = createToolCallId(`mock-${name}`);
  return [
    { type: "content-started", contentIndex: 0, contentType: "tool-call", toolCallId },
    { type: "content-delta", contentIndex: 0, contentType: "tool-call", toolCallId, toolNameDelta: name, delta: JSON.stringify(args) },
    { type: "content-completed", contentIndex: 0, contentType: "tool-call" },
    { type: "finished", reason: { kind: "tool-calls" } },
  ];
}
