import { describe, expect, it } from "vitest";

import { createSessionId } from "../../../../src/brand/ids.js";
import { createRoadmap, execute } from "./setup.js";

const node = { title: "Verify backend", goal: "Verify the integrated backend.", done_when: ["Integration tests pass"], required: true };

describe("add_node", () => {
  it("adds a Node with dependencies atomically and returns the key-to-NodeId receipt", async () => {
    const { ctx, project, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "add_node", {
      base_version: 1, reason: "Add verification", key: "verify", ...node, depends_on: [String(buildId)], index: null,
    });

    if (result.kind !== "success") throw new Error("add_node unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    const artifact = result.artifact as { created_nodes?: Record<string, string>; nodes?: Array<{ id: string }> };
    const createdId = artifact.created_nodes?.verify;
    expect(createdId).toBeTruthy();
    expect(artifact.nodes?.map((value) => value.id).at(-1)).toBe(createdId);
    const created = ctx.nodes.getByProject(project.id).find((value) => String(value.node.id) === createdId);
    expect(created?.status).toBe("locked");
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toContainEqual({ from: buildId, to: created?.node.id });
    expect(JSON.stringify(ctx.roadmaps.getEvents(project.id))).not.toContain("verify");
  });

  it("inserts at the given index", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "add_node", {
      base_version: 1, reason: "Research first", key: "research", ...node, depends_on: [], index: 0,
    });

    if (result.kind !== "success") throw new Error("add_node unexpectedly failed");
    const createdId = (result.artifact as { created_nodes: Record<string, string> }).created_nodes.research;
    expect(ctx.roadmaps.get(project.id)?.graph.definition.nodes.map(String)).toEqual([createdId, String(designId), String(buildId)]);
  });

  it("rejects missing, empty-placeholder and foreign fields through the published schema", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const { goal: _, ...missingGoal } = node;
    for (const arguments_ of [
      { base_version: 1, reason: "Add", key: "verify", ...missingGoal, depends_on: [], index: null },
      { base_version: 1, reason: "Add", key: "verify", ...node, depends_on: [] },
      { base_version: 1, reason: "Add", key: "verify", ...node, depends_on: [String(buildId)], index: null, kind: "work" },
      { base_version: 1, reason: "Add", key: "verify", ...node, depends_on: [], index: null, node_id: String(designId) },
    ]) {
      const result = await execute(ctx, project.mainSessionId, "add_node", arguments_);
      expect(result).toMatchObject({ kind: "failure", failure: { code: "invalid-arguments" } });
    }
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
    expect(ctx.nodes.getByProject(project.id)).toHaveLength(2);
  });

  it("rejects a Node Session even if dispatched directly", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const nodeSession = createSessionId("node-add-node");
    ctx.nodes.bindSession(designId, nodeSession);

    const result = await execute(ctx, nodeSession, "add_node", {
      base_version: 1, reason: "Attempt privilege bypass", key: "verify", ...node, depends_on: [], index: null,
    });

    if (result.kind !== "failure") throw new Error("Node Session unexpectedly modified the Roadmap");
    expect(JSON.stringify(result.block.content)).toContain("add_node is available only to the Main Agent");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
  });
});

describe("edit_node", () => {
  it("edits an idle work Node with exact Roadmap and Node versions in one Roadmap transaction", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const current = ctx.nodes.get(designId)!;
    expect(current.status).toBe("idle");

    const result = await execute(ctx, project.mainSessionId, "edit_node", {
      base_version: 1,
      reason: "Clarify design deliverable",
      node_id: String(designId),
      node_version: current.revision,
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
      requirement: "optional",
      objective: {
        title: "Design service architecture",
        description: "Define services, API boundaries and persistence responsibilities.",
        acceptanceCriteria: ["Service boundaries documented", "API contract documented"],
      },
    });
    expect(ctx.roadmaps.getEvents(project.id).at(-1)?.type).toBe("roadmap-changed");
  });

  it("rejects the fields gpt-6-sol sent from the combined modify_roadmap shape", async () => {
    const { ctx, project, designId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "edit_node", {
      base_version: 1, reason: "Edit", node_id: String(designId), node_version: ctx.nodes.get(designId)!.revision, ...node,
      key: "", depends_on: [], index: 0, from_node_id: "", to_node_id: "", node_ids: [],
    });

    expect(result).toMatchObject({ kind: "failure", failure: { code: "invalid-arguments" } });
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
  });

  it("rejects stale Node edits and preserves both Roadmap and Node revisions", async () => {
    const { ctx, project, designId } = await createRoadmap();
    const current = ctx.nodes.get(designId)!;
    ctx.nodes.setRequirement(designId, "optional", current.revision, "Independent Node update");
    const latest = ctx.nodes.get(designId)!;

    const result = await execute(ctx, project.mainSessionId, "edit_node", {
      base_version: 1,
      reason: "Edit from stale Node view",
      node_id: String(designId),
      node_version: current.revision,
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
    ctx.nodes.bindSession(designId, createSessionId("working-design"));
    ctx.nodes.beginWork(designId);
    const working = ctx.nodes.get(designId)!;

    const result = await execute(ctx, project.mainSessionId, "edit_node", {
      base_version: 1,
      reason: "Unsafe mid-flight edit",
      node_id: String(designId),
      node_version: working.revision,
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
});

describe("remove_node", () => {
  it("removes the Node from the plan without deleting the Node record", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "remove_node", {
      base_version: 1, reason: "Drop obsolete design stage", node_id: String(designId),
    });

    if (result.kind !== "success") throw new Error("remove_node unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    expect(ctx.roadmaps.get(project.id)?.graph.definition).toMatchObject({ nodes: [buildId], edges: [] });
    expect(ctx.nodes.get(designId)).toBeDefined();
  });
});
