import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.js";
import { OpenAIEmbeddingProvider } from "../../src/embedding/openai.js";
import { createAcceptanceAdapter, resolveAcceptanceHostConfig } from "../acceptance.js";
import { createGuardedAdapter, RequestLedger } from "../compaction/request.js";

export async function createRuntime(preflight: boolean) {
  const root = await mkdtemp(join(tmpdir(), "navo-f136-real-"));
  const workspace = join(root, "workspace");
  const intake = join(root, "intake");
  const evidence = join(root, "evidence");
  await Promise.all([workspace, intake, evidence].map(path => mkdir(path)));
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("Acceptance exceeded 20 minutes")), 20 * 60_000);
  const config = preflight ? undefined : resolveAcceptanceHostConfig();
  const graphRequests: number[] = [];
  const embeddingCalls: Array<{ inputs: number; status: number; elapsedMs: number }> = [];
  const ledger = new RequestLedger(48, (entry, used) => process.stdout.write(`${JSON.stringify({
    event: "model-request", index: entry.index, used, status: entry.status,
  })}\n`));
  const model = config?.agent.model ?? { provider: "unused", model: "preflight" };
  const embedding = config === undefined ? undefined : new OpenAIEmbeddingProvider({
    endpoint: process.env.EMBEDDING_BASE_URL?.trim() || "http://192.168.99.2:8081/v1",
    model: process.env.EMBEDDING_MODEL?.trim() || "Qwen3-Embedding-4B",
    ...(process.env.EMBEDDING_API_KEY ? { apiKey: process.env.EMBEDDING_API_KEY } : {}),
    policy: { maxAttempts: 1, timeoutMs: 15_000 },
    fetch: async (url, init) => {
      assertBudget(embeddingCalls.length < 20, controller);
      const call = { inputs: (JSON.parse(String(init?.body)) as { input: string[] }).input.length, status: 0, elapsedMs: 0 };
      embeddingCalls.push(call);
      const started = Date.now();
      try {
        const response = await fetch(url, { ...init, signal: init?.signal
          ? AbortSignal.any([controller.signal, init.signal]) : controller.signal });
        call.status = response.status;
        return response;
      } finally { call.elapsedMs = Date.now() - started; }
    },
  });
  const open = async () => {
    const app = await createApp({ storage: { path: join(root, "navo.db") },
      ...(embedding === undefined ? {} : { embedding }),
      ...(config === undefined ? {} : { graph: { model: { provider: model.provider, model: model.model } } }),
      runtime: { maxSteps: 16, maxModelRetries: 0 },
      node: { session: { model: { ...model, autoCompactLimit: 32_768 } } } });
    if (config !== undefined) {
      const inner = createAcceptanceAdapter(config);
      const guarded = createGuardedAdapter({ async *stream(request) {
        if (request.tools?.some(tool => tool.name === "extract_graph")) graphRequests.push(ledger.used);
        yield* inner.stream(request);
      } }, ledger,
        () => controller.abort(new Error("Generation request budget exhausted")));
      app.llm.registerAdapter(config.provider, { stream(request) {
        controller.signal.throwIfAborted();
        return guarded.stream({ ...request, signal: request.signal
          ? AbortSignal.any([request.signal, controller.signal]) : controller.signal });
      } });
    }
    return app;
  };
  let app;
  try { app = await open(); }
  catch (error) { clearTimeout(deadline); controller.abort(); throw error; }
  return {
    root, workspace, intake, evidence, model, ledger, graphRequests, embeddingCalls, signal: controller.signal,
    get app() { return app; },
    async settle() {
      await app.content.idle();
      await app.resourceIndex.idle();
      await app.resourceGraph.idle();
      controller.signal.throwIfAborted();
    },
    async restart() { await app.fiber.dispose(); app = await open(); },
    async close() { clearTimeout(deadline); controller.abort(); await app.fiber.dispose(); },
  };
}

function assertBudget(allowed: boolean, controller: AbortController): void {
  if (!allowed) controller.abort(new Error("Embedding request budget exhausted"));
  controller.signal.throwIfAborted();
}
