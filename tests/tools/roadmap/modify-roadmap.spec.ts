import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
import type { SessionId } from "../../../src/brand/ids.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectStore } from "../../../src/project/store.js";
import { RoadmapStore } from "../../../src/roadmap/store.js";
import { MODIFY_ROADMAP_TOOL_NAME } from "../../../src/tools/builtins/roadmap/modify-roadmap.js";
import { RoadmapToolsPlugin } from "../../../src/tools/builtins/roadmap/plugin.js";
import { ToolService } from "../../../src/tools/service.js";
import { toolCall } from "../../helpers/tools.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

async function createContext(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ToolService);
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
  return ctx;
}

async function createRoadmap() {
  const ctx = await createContext();
  const project = ctx.projects.create({ goal: "Ship a backend" });
  const design = ctx.nodes.create({
    projectId: project.id,
    objective: {
      title: "Design architecture",
      description: "Define the backend architecture.",
      acceptanceCriteria: ["Architecture documented"],
    },
  });
  const build = ctx.nodes.create({
    projectId: project.id,
    objective: {
      title: "Build backend",
      description: "Implement the backend.",
      acceptanceCriteria: ["Backend runs"],
    },
  });
  ctx.roadmaps.create({
    definition: {
      projectId: project.id,
      nodes: [design.node.id, build.node.id],
      edges: [{ from: design.node.id, to: build.node.id }],
    },
    reason: "Initial plan",
  });
  return { ctx, project, designId: design.node.id, buildId: build.node.id };
}

async function execute(ctx: Context, sessionId: SessionId, arguments_: Record<string, unknown>) {
  return ctx.tools.execute(
    toolCall("modify-roadmap", MODIFY_ROADMAP_TOOL_NAME, arguments_),
    signal,
    { sessionId, allowedTools: [MODIFY_ROADMAP_TOOL_NAME] },
  );
}

describe("modify_roadmap", () => {
  it("adds a Node with dependencies atomically and returns the key-to-NodeId receipt", async () => {
    const { ctx, project, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Add verification",
      action: "add_node",
      key: "verify",
      kind: "work",
      title: "Verify backend",
      goal: "Verify the integrated backend.",
      done_when: ["Integration tests pass"],
      required: true,
      depends_on: [String(buildId)],
    });

    if (result.kind !== "success") throw new Error("add_node unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    const artifact = result.artifact as { created_nodes?: Record<string, string>; nodes?: Array<{ id: string }> };
    const createdId = artifact.created_nodes?.verify;
    expect(createdId).toBeTruthy();
    expect(artifact.nodes?.map((node) => node.id)).toContain(createdId);
    const created = ctx.nodes.getByProject(project.id).find((node) => String(node.node.id) === createdId);
    expect(created?.node.kind).toBe("work");
    expect(created?.status).toBe("locked");
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toContainEqual({
      from: buildId,
      to: created?.node.id,
    });
    expect(JSON.stringify(ctx.roadmaps.getEvents(project.id))).not.toContain("verify");
  });

  it("rejects a stale Roadmap version without changing Roadmap or Node state", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const first = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Disconnect build",
      action: "disconnect",
      from_node_id: String(designId),
      to_node_id: String(buildId),
    });
    if (first.kind !== "success") throw new Error("first mutation unexpectedly failed");
    const beforeNodes = ctx.nodes.getByProject(project.id).map((node) => ({ id: node.node.id, revision: node.revision, status: node.status }));

    const stale = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Stale reconnect",
      action: "connect",
      from_node_id: String(designId),
      to_node_id: String(buildId),
    });

    if (stale.kind !== "failure") throw new Error("stale Roadmap mutation unexpectedly succeeded");
    expect(JSON.stringify(stale.block.content)).toContain("Call read_roadmap again");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([]);
    expect(ctx.nodes.getByProject(project.id).map((node) => ({ id: node.node.id, revision: node.revision, status: node.status })))
      .toEqual(beforeNodes);
  });

  it("edits an idle work Node with exact Roadmap and Node versions in one Roadmap transaction", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const current = ctx.nodes.get(designId)!;
    expect(current.status).toBe("idle");

    const result = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Clarify design deliverable",
      action: "edit_node",
      node_id: String(designId),
      node_version: current.revision,
      kind: "work",
      title: "Design service architecture",
      goal: "Define services, API boundaries and persistence responsibilities.",
      done_when: ["Service boundaries documented", "API contract documented"],
      required: false,
    });

    if (result.kind !== "success") throw new Error("edit_node unexpectedly failed");
    const edited = ctx.nodes.get(designId)!;
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    expect(edited.revision).toBe(current.revision + 1);
    expect(edited.node).toMatchObject({
      kind: "work",
      requirement: "optional",
      objective: {
        title: "Design service architecture",
        description: "Define services, API boundaries and persistence responsibilities.",
        acceptanceCriteria: ["Service boundaries documented", "API contract documented"],
      },
    });
    expect(ctx.roadmaps.getEvents(project.id).at(-1)?.type).toBe("roadmap-changed");
  });

  it("rejects stale Node edits and preserves both Roadmap and Node revisions", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const current = ctx.nodes.get(designId)!;
    ctx.nodes.setRequirement(designId, "optional", current.revision, "Independent Node update");
    const latest = ctx.nodes.get(designId)!;

    const result = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Edit from stale Node view",
      action: "edit_node",
      node_id: String(designId),
      node_version: current.revision,
      kind: "work",
      title: "Stale title",
      goal: "Stale goal",
      done_when: ["Stale criterion"],
      required: true,
    });

    if (result.kind !== "failure") throw new Error("stale Node edit unexpectedly succeeded");
    expect(JSON.stringify(result.block.content)).toContain("Call read_node again");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
    expect(ctx.nodes.get(designId)?.revision).toBe(latest.revision);
    expect(ctx.nodes.get(designId)?.node).toEqual(latest.node);
  });

  it("does not allow definition edits once a Node is working", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const nodeSession = createSessionId("working-design");
    ctx.nodes.bindSession(designId, nodeSession);
    ctx.nodes.beginWork(designId);
    const working = ctx.nodes.get(designId)!;

    const result = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Unsafe mid-flight edit",
      action: "edit_node",
      node_id: String(designId),
      node_version: working.revision,
      kind: "work",
      title: "Changed during work",
      goal: "Different goal",
      done_when: ["Different criterion"],
      required: true,
    });

    if (result.kind !== "failure") throw new Error("working Node edit unexpectedly succeeded");
    expect(JSON.stringify(result.block.content)).toContain("only while locked or idle");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
    expect(ctx.nodes.get(designId)?.revision).toBe(working.revision);
  });

  it("rejects a dependency cycle without committing the Roadmap change", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Bad reverse dependency",
      action: "connect",
      from_node_id: String(buildId),
      to_node_id: String(designId),
    });

    if (result.kind !== "failure") throw new Error("cyclic mutation unexpectedly succeeded");
    expect(JSON.stringify(result.block.content)).toContain("dependency cycle");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([{ from: designId, to: buildId }]);
  });

  it("supports reorder and remove while preserving a valid authoritative Roadmap", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const disconnect = await execute(ctx, project.mainSessionId, {
      base_version: 1,
      reason: "Make stages independent",
      action: "disconnect",
      from_node_id: String(designId),
      to_node_id: String(buildId),
    });
    if (disconnect.kind !== "success") throw new Error("disconnect unexpectedly failed");

    const reorder = await execute(ctx, project.mainSessionId, {
      base_version: 2,
      reason: "Present build first",
      action: "reorder",
      node_ids: [String(buildId), String(designId)],
    });
    if (reorder.kind !== "success") throw new Error("reorder unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.graph.definition.nodes).toEqual([buildId, designId]);

    const remove = await execute(ctx, project.mainSessionId, {
      base_version: 3,
      reason: "Drop obsolete design stage",
      action: "remove_node",
      node_id: String(designId),
    });
    if (remove.kind !== "success") throw new Error("remove unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(4);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.nodes).toEqual([buildId]);
    expect(ctx.nodes.get(designId)).toBeDefined();
  });

  it("rejects a Node Session even if modify_roadmap is dispatched directly", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const nodeSession = createSessionId("node-modify-roadmap");
    ctx.nodes.bindSession(designId, nodeSession);

    const result = await execute(ctx, nodeSession, {
      base_version: 1,
      reason: "Attempt privilege bypass",
      action: "disconnect",
      from_node_id: String(designId),
      to_node_id: String(buildId),
    });

    if (result.kind !== "failure") throw new Error("Node Session unexpectedly modified the Roadmap");
    expect(JSON.stringify(result.block.content)).toContain("available only to the Main Agent");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
  });
});
