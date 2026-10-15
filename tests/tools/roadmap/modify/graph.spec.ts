import { describe, expect, it } from "vitest";

import { createRoadmap, execute } from "./setup.js";

describe("set_dependency", () => {
  it("removes and re-adds an edge with the connected flag", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const edge = { from_node_id: String(designId), to_node_id: String(buildId) };

    const removed = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 1, reason: "Make stages independent", ...edge, connected: false,
    });
    if (removed.kind !== "success") throw new Error("disconnect unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([]);

    const added = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 2, reason: "Restore order", ...edge, connected: true,
    });
    if (added.kind !== "success") throw new Error("connect unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(3);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([{ from: designId, to: buildId }]);
  });

  it("rejects a stale Roadmap version without changing Roadmap or Node state", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();
    const edge = { from_node_id: String(designId), to_node_id: String(buildId) };
    const first = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 1, reason: "Disconnect build", ...edge, connected: false,
    });
    if (first.kind !== "success") throw new Error("first change unexpectedly failed");
    const beforeNodes = ctx.nodes.getByProject(project.id).map((node) => ({ id: node.node.id, revision: node.revision, status: node.status }));

    const stale = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 1, reason: "Stale reconnect", ...edge, connected: true,
    });

    if (stale.kind !== "failure") throw new Error("stale Roadmap change unexpectedly succeeded");
    expect(JSON.stringify(stale.block.content)).toContain("Call read_roadmap again");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(2);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([]);
    expect(ctx.nodes.getByProject(project.id).map((node) => ({ id: node.node.id, revision: node.revision, status: node.status })))
      .toEqual(beforeNodes);
  });

  it("rejects a dependency cycle without committing the Roadmap change", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 1, reason: "Bad reverse dependency", from_node_id: String(buildId), to_node_id: String(designId), connected: true,
    });

    if (result.kind !== "failure") throw new Error("cyclic change unexpectedly succeeded");
    expect(JSON.stringify(result.block.content)).toContain("dependency cycle");
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
    expect(ctx.roadmaps.get(project.id)?.graph.definition.edges).toEqual([{ from: designId, to: buildId }]);
  });

  it("requires the connected flag", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "set_dependency", {
      base_version: 1, reason: "Missing flag", from_node_id: String(designId), to_node_id: String(buildId),
    });

    expect(result).toMatchObject({ kind: "failure", failure: { code: "invalid-arguments" } });
    expect(ctx.roadmaps.get(project.id)?.revision).toBe(1);
  });
});

describe("reorder_nodes", () => {
  it("changes presentation order only", async () => {
    const { ctx, project, designId, buildId } = await createRoadmap();

    const result = await execute(ctx, project.mainSessionId, "reorder_nodes", {
      base_version: 1, reason: "Present build first", node_ids: [String(buildId), String(designId)],
    });

    if (result.kind !== "success") throw new Error("reorder unexpectedly failed");
    expect(ctx.roadmaps.get(project.id)?.graph.definition).toMatchObject({
      nodes: [buildId, designId],
      edges: [{ from: designId, to: buildId }],
    });
  });
});
