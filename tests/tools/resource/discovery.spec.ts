import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../../src/app.js";
import { cleanup, close, contexts, fixture, open, adapter, publish, settle } from "../../resource/graph/fixture.js";
import { bindResourceNode, callResourceTool, resourceArtifact, resourceResultText } from "./helpers.js";

afterEach(cleanup);

describe("Resource discovery integration", () => {
  it("uses hybrid retrieval without leaking private Resources or relationship evidence and permits direct fetch", async () => {
    const { ctx, project, workspace } = await fixture(chunks => {
      const hidden = chunks[0]!.text.includes("secret");
      return { entities: [
        { id: "a", name: "Alice", type: "Person", chunkIds: [chunks[0]!.id] },
        { id: "b", name: hidden ? "SecretName" : "Bob", type: "Person", chunkIds: [chunks[0]!.id] },
      ], relations: [{ source: "a", target: "b", type: hidden ? "SECRET_EDGE" : "KNOWS", chunkId: chunks[0]!.id }] };
    });
    const visible = await publish(ctx, project.id, workspace, "visible.md", "# Evidence\nAlice knows Bob.");
    const secret = await publish(ctx, project.id, workspace, "secret.md", "secret Alice and SecretName.");
    ctx.resources.setAccess({ projectId: project.id, resourceId: visible.id, actor: { kind: "main" },
      expectedRevision: 1, access: { kind: "public" } });
    const node = bindResourceNode(ctx, project.id);
    const direct = await callResourceTool(ctx, node.sessionId, "fetch_resource", { resource_id: visible.id, max_lines: 1 });
    expect(direct.kind).toBe("success");
    expect(resourceResultText(direct)).toContain("Continue with start_line=2");

    const result = await callResourceTool(ctx, node.sessionId, "search_resources", { query: "Alice" });
    expect(resourceArtifact(result)).toMatchObject({ status: "found", resources: [{ resource_id: visible.id,
      snippets: [expect.objectContaining({ text: expect.stringContaining("Alice"), headingPath: ["Evidence"],
        matches: expect.arrayContaining(["vector", "entity", "graph"]),
        paths: expect.arrayContaining([expect.objectContaining({ relations: [expect.objectContaining({
          evidence: [expect.objectContaining({ resourceId: visible.id })],
        })] })]),
      })] }] });
    for (const value of [secret.id, "SecretName", "SECRET_EDGE"]) {
      expect(resourceResultText(result)).not.toContain(value);
      expect(resourceResultText(await callResourceTool(ctx, node.sessionId, "list_resources", {}))).not.toContain(value);
    }
    expect(resourceResultText(await callResourceTool(ctx, project.mainSessionId, "search_resources", { query: "Alice" }))).toContain(secret.id);

    for (const id of [secret.id, "../secret", "missing"]) {
      for (const [name, args] of [
        ["fetch_resource", {}], ["update_resource", { expected_revision: 1, name: "forged" }],
        ["delete_resource", { expected_revision: 1 }], ["set_resource_access", { expected_revision: 1, access: { kind: "public" } }],
      ] as const) expect((await callResourceTool(ctx, node.sessionId, name, { resource_id: id, ...args })).kind).toBe("failure");
    }
    expect(ctx.resources.get(project.id, secret.id)).toMatchObject({ name: "secret.md", access: { kind: "private" }, revision: 1 });
  });

  it("applies folder scope to results and paths, excludes other Projects, and rechecks a revoked grant", async () => {
    const { ctx, project, workspace, root } = await fixture();
    const first = await publish(ctx, project.id, workspace, "first.md");
    const second = await publish(ctx, project.id, workspace, "second.md");
    const other = ctx.projects.create({ name: "Other", goal: null });
    const otherRoot = join(root, "other");
    await mkdir(otherRoot);
    await ctx.projectWorkspaces.create(other.id, otherRoot);
    const foreign = await publish(ctx, other.id, otherRoot, "foreign.md", "Foreign Alice knows Bob.");
    ctx.resources.createUserFolder(project.id, "Papers");
    ctx.resources.organizeUserResource({ projectId: project.id, resourceId: first.id, expectedRevision: 1, folder: "Papers" });
    const result = await callResourceTool(ctx, project.mainSessionId, "search_resources", { query: "Alice", folder: "papers" });
    expect(resourceArtifact(result)).toMatchObject({ status: "found", resources: [{ resource_id: first.id }] });
    expect(resourceResultText(result)).not.toContain(second.id);
    expect(resourceResultText(result)).not.toContain(foreign.id);
    const listed = await callResourceTool(ctx, project.mainSessionId, "list_resources", {});
    expect(resourceResultText(listed)).not.toContain(foreign.id);

    const node = bindResourceNode(ctx, project.id);
    ctx.resources.setAccess({ projectId: project.id, resourceId: second.id, actor: { kind: "main" },
      expectedRevision: 1, access: { kind: "public" } });
    const original = ctx.indexSearch.search.bind(ctx.indexSearch);
    vi.spyOn(ctx.indexSearch, "search").mockImplementationOnce(async request => {
      const hits = await original(request);
      ctx.resources.setAccess({ projectId: project.id, resourceId: second.id, actor: { kind: "main" },
        expectedRevision: 2, access: { kind: "private" } });
      return hits;
    });
    expect(resourceArtifact(await callResourceTool(ctx, node.sessionId, "search_resources", { query: "Alice" })))
      .toEqual({ status: "empty", resources: [] });
  });

  it("reports a real missing Embedding configuration as failure, and a zero-visible scope as empty", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    await publish(ctx, project.id, workspace);
    const node = bindResourceNode(ctx, project.id);
    await close(ctx);
    const app = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(app);
    expect(await callResourceTool(app, project.mainSessionId, "search_resources", { query: "Alice" }))
      .toMatchObject({ kind: "failure", failure: { modelMessage: "Resource search failed (embedding-unconfigured)." } });
    expect(resourceArtifact(await callResourceTool(app, node.sessionId, "search_resources", { query: "Alice" })))
      .toEqual({ status: "empty", resources: [] });
  });

  it("restores trusted bindings, discovery and direct reading after restart and respects subsequent deletion", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    const resource = await publish(ctx, project.id, workspace);
    const node = bindResourceNode(ctx, project.id);
    ctx.resources.setAccess({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
      expectedRevision: 1, access: { kind: "shared", nodeIds: [node.node.node.id] } });
    await close(ctx);
    const app = await open(path, adapter());
    await settle(app);
    expect(resourceArtifact(await callResourceTool(app, node.sessionId, "list_resources", {})))
      .toMatchObject({ resources: [{ resource_id: resource.id, revision: 2 }] });
    expect(resourceArtifact(await callResourceTool(app, node.sessionId, "search_resources", { query: "Alice" })))
      .toMatchObject({ status: "found", resources: [{ resource_id: resource.id }] });
    expect(resourceResultText(await callResourceTool(app, node.sessionId, "fetch_resource", { resource_id: resource.id }))).toContain("Alice knows Bob.");
    expect((await callResourceTool(app, project.mainSessionId, "delete_resource", { resource_id: resource.id, expected_revision: 2 })).kind).toBe("success");
    expect(resourceArtifact(await callResourceTool(app, node.sessionId, "list_resources", {})).resources).toEqual([]);
    expect(resourceArtifact(await callResourceTool(app, node.sessionId, "search_resources", { query: "Alice" }))).toEqual({ status: "empty", resources: [] });
    expect((await callResourceTool(app, node.sessionId, "fetch_resource", { resource_id: resource.id })).kind).toBe("failure");
  });
});
