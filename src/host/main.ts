import { agentTurnMethod, StreamRpcRouter, StreamRpcServer } from "../../rpc/index.js";
import { createApp } from "../app.js";
import { QwenChatCompletionsAdapter } from "../llm/adapters/qwen.js";
import { createAgentTurnHandler } from "./turn.js";
import { resolveKernelHostConfig } from "./config.js";
import { StdioRpcServerTransport } from "./stdio.js";

export async function runKernelHost(): Promise<void> {
  const config = resolveKernelHostConfig();
  const ctx = await createApp({
    node: { session: { model: config.agent.model } },
  });
  const unregister = ctx.llm.registerAdapter(
    config.provider,
    new QwenChatCompletionsAdapter(config.adapter),
  );
  const transport = new StdioRpcServerTransport(process.stdin, process.stdout);
  const router = new StreamRpcRouter();
  router.register(agentTurnMethod, createAgentTurnHandler(ctx, config.agent));
  const server = new StreamRpcServer(transport, router);
  const stop = (): void => { void server.dispose(); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stderr.write("[kernel-host] ready\n");
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

if (isDirectExecution(import.meta.url)) {
  void runKernelHost().catch((error: unknown) => {
    process.stderr.write(`[kernel-host] fatal: ${safeErrorMessage(error)}\n`);
    process.exitCode = 1;
  });
}

function isDirectExecution(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && new URL(moduleUrl).pathname.toLowerCase()
    .endsWith(entry.replace(/\\/g, "/").toLowerCase());
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown Host failure";
}
