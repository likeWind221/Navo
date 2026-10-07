import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  projectCreateMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectResourcesMethod,
  RpcError,
  StreamRpcClient,
  StreamRpcRouter,
  StreamRpcServer,
} from "../../rpc/index.js";
import type { RpcMethod } from "../../rpc/index.js";
import { createTransportPair } from "../../rpc/tests/helpers/transport.js";
import { createApp } from "../../src/app.js";
import { createNodeId, createProjectId } from "../../src/brand/ids.js";
import { registerProjectMethods } from "../../src/host/project.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function host() {
  const ctx = await createApp({ node: { session: { model: { provider: "mock", model: "mock" } } } });
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
  return { ctx, client };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-host-project-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function call<I, O>(client: StreamRpcClient, method: RpcMethod<I, O>, input: I): Promise<O> {
  const items: O[] = [];
  for await (const item of client.stream(method, input)) items.push(item);
  expect(items).toHaveLength(1);
  return items[0]!;
}

async function failureOf<I, O>(client: StreamRpcClient, method: RpcMethod<I, O>, input: I) {
  const error = await call(client, method, input).then(() => undefined, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(RpcError);
  return (error as RpcError).failure;
}

function seedRoadmap(ctx: Context, projectId: string) {
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

describe("Kernel Host project methods", () => {
  it("creates a named Project bound to its Workspace and lists it newest first", async () => {
    const { client } = await host();
    const root = await workspace();
    const otherRoot = await workspace();

    const created = await call(client, projectCreateMethod, {
      name: "Agent paper", goal: "Survey long-horizon agents", workspaceRoot: root,
    });
    expect(created).toMatchObject({
      name: "Agent paper", goal: "Survey long-horizon agents", status: "active", revision: 1,
    });
    expect(created.workspaceRoot).toContain("navo-host-project-");
    await new Promise(resolve => setTimeout(resolve, 2));
    const second = await call(client, projectCreateMethod, {
      name: "Second", goal: "Another goal", workspaceRoot: otherRoot,
    });

    const list = await call(client, projectListMethod, {});
    expect(list.projects.map(project => project.projectId)).toEqual([second.projectId, created.projectId]);
  });

  it("rejects a conflicting Workspace without leaving a Project behind", async () => {
    const { client } = await host();
    const root = await workspace();
    await call(client, projectCreateMethod, { name: "First", goal: "Goal", workspaceRoot: root });

    expect(await failureOf(client, projectCreateMethod, { name: "Clash", goal: "Goal", workspaceRoot: root }))
      .toMatchObject({ code: "workspace-conflict" });
    expect(await failureOf(client, projectCreateMethod, {
      name: "Missing", goal: "Goal", workspaceRoot: join(root, "does-not-exist"),
    })).toMatchObject({ code: "workspace-invalid" });
    expect((await call(client, projectListMethod, {})).projects.map(project => project.name)).toEqual(["First"]);
  });

  it("returns Project detail without a Roadmap, then a Roadmap with node actions", async () => {
    const { ctx, client } = await host();
    const created = await call(client, projectCreateMethod, {
      name: "Plan", goal: "Goal", workspaceRoot: await workspace(),
    });

    const empty = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(empty).toMatchObject({ project: created, main: { turnActive: false }, roadmap: null });

    const { first, second } = seedRoadmap(ctx, created.projectId);
    const detail = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(detail.roadmap?.edges).toEqual([{ from: first, to: second }]);
    expect(detail.roadmap?.nodes).toEqual([
      expect.objectContaining({
        nodeId: first, kind: "work", status: "idle", title: "Collect", controlPurpose: null,
        hasSession: false, turnActive: false, confirmation: null,
        actions: { run: true, complete: true, skip: true },
      }),
      expect.objectContaining({
        nodeId: second, status: "locked", actions: { run: false, complete: false, skip: true },
      }),
    ]);

    ctx.projects.archive(createProjectId(created.projectId), "Paused");
    const archived = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(archived.project.status).toBe("archived");
    expect(archived.roadmap?.nodes.map(node => node.actions))
      .toEqual([0, 1].map(() => ({ run: false, complete: false, skip: false })));
  });

  it("pages the Mailbox by sequence and lists Resource metadata only", async () => {
    const { ctx, client } = await host();
    const root = await workspace();
    const created = await call(client, projectCreateMethod, { name: "Mail", goal: "Goal", workspaceRoot: root });
    const projectId = createProjectId(created.projectId);
    const { first } = seedRoadmap(ctx, created.projectId);
    for (const body of ["one", "two", "three"]) ctx.mailbox.postFromNode({ projectId, nodeId: first, body });
    ctx.mailbox.postFromMain({ projectId, nodeId: first, body: "reply" });

    const page = await call(client, projectMailboxMethod, { projectId: created.projectId, afterSequence: null, limit: 2 });
    expect(page.messages.map(message => message.body)).toEqual(["one", "two"]);
    expect(page.messages[0]).toMatchObject({ sequence: 1, sender: { kind: "node", nodeId: first }, recipient: { kind: "main" } });
    expect(page.nextSequence).toBe(2);
    const rest = await call(client, projectMailboxMethod, { projectId: created.projectId, afterSequence: 2, limit: 50 });
    expect(rest.messages.map(message => message.body)).toEqual(["three", "reply"]);
    expect(rest.nextSequence).toBeNull();

    await mkdir(join(root, "sources"));
    await writeFile(join(root, "sources", "report.md"), "secret body\n", "utf8");
    await ctx.resources.publish({
      projectId, owner: { kind: "node", nodeId: first }, sourceRef: "sources/report.md",
      name: "Report", description: "Findings", type: "text/markdown",
    });
    const { resources } = await call(client, projectResourcesMethod, { projectId: created.projectId });
    expect(resources).toEqual([expect.objectContaining({
      owner: { kind: "node", nodeId: first }, name: "Report", access: { kind: "private" }, revision: 1,
    })]);
    expect(JSON.stringify(resources)).not.toContain("secret body");
  });

  it("maps unknown Projects and invalid input to stable failures", async () => {
    const { client } = await host();
    expect(await failureOf(client, projectGetMethod, { projectId: "missing" }))
      .toMatchObject({ code: "project-not-found" });
    expect(await failureOf(client, projectResourcesMethod, { projectId: "missing" }))
      .toMatchObject({ code: "project-not-found" });
    expect(await failureOf(client, projectMailboxMethod, { projectId: "missing", afterSequence: null, limit: 10 }))
      .toMatchObject({ code: "project-not-found" });
    await expect(call(client, projectCreateMethod, { name: " ", goal: "Goal", workspaceRoot: "x" }))
      .rejects.toBeInstanceOf(RpcError);
  });
});
