import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "cordis";
import { afterEach, expect } from "vitest";

import {
  RpcError,
  StreamRpcClient,
  StreamRpcRouter,
  StreamRpcServer,
} from "../../../rpc/index.js";
import type { RpcMethod } from "../../../rpc/index.js";
import { createTransportPair } from "../../../rpc/tests/helpers/transport.js";
import { createApp } from "../../../src/app.js";
import { createNodeId, createProjectId } from "../../../src/brand/ids.js";
import { registerProjectMethods } from "../../../src/host/project.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export async function host(entries: ConstructorParameters<typeof MockLLMAdapter>[0] = []) {
  const ctx = await createApp({ node: { session: { model: { provider: "mock", model: "mock" } } } });
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  const pair = createTransportPair();
  const router = new StreamRpcRouter();
  registerProjectMethods(router, ctx);
  const server = new StreamRpcServer(pair.server, router);
  const serving = server.serve();
  const client = new StreamRpcClient(pair.client);
  cleanups.push(async () => {
    pair.close();
    await server.dispose();
    await serving;
    await ctx.fiber.dispose();
  });
  return { ctx, client, adapter };
}

export async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-host-project-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

export async function call<I, O>(client: StreamRpcClient, method: RpcMethod<I, O>, input: I): Promise<O> {
  const items: O[] = [];
  for await (const item of client.stream(method, input)) items.push(item);
  expect(items).toHaveLength(1);
  return items[0]!;
}

export async function failureOf<I, O>(client: StreamRpcClient, method: RpcMethod<I, O>, input: I) {
  const error = await call(client, method, input).then(() => undefined, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(RpcError);
  return (error as RpcError).failure;
}

export function seedRoadmap(ctx: Context, projectId: string) {
  const id = createProjectId(projectId);
  const first = createNodeId("node-first");
  const second = createNodeId("node-second");
  ctx.roadmaps.create({
    definition: { projectId: id, nodes: [first, second], edges: [{ from: first, to: second }] },
    reason: "Human-approved plan",
    newNodes: [first, second].map((nodeId, index) => ({
      nodeId,
      input: {
        projectId: id,
        objective: {
          title: index === 0 ? "Collect" : "Analyze",
          description: "Do the work",
          acceptanceCriteria: ["Done"],
        },
      },
    })),
  });
  return { first, second };
}
