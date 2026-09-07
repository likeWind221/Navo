import { agentTurnMethod, StreamRpcRouter, StreamRpcServer } from "../../rpc/index.js";
import {
  createMockAgentTurnHandler,
  resolveMockAgentTurnConfig,
} from "../../src/host/turn/mock.js";
import { StdioRpcServerTransport } from "../../src/host/stdio.js";

async function main(): Promise<void> {
  const transport = new StdioRpcServerTransport(process.stdin, process.stdout);
  const router = new StreamRpcRouter();
  const config = resolveMockAgentTurnConfig(process.env, () => process.exit(23));
  router.register(agentTurnMethod, createMockAgentTurnHandler(config));
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
    await transport.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown Mock Host failure";
  process.stderr.write(`[mock-kernel-host] fatal: ${message}\n`);
  process.exitCode = 1;
});
