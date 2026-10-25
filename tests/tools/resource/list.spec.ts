import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
import { bindResourceNode, callResourceTool, cleanupResourceToolFixtures, resourceArtifact, resourceResultText, resourceToolFixture } from "./helpers.js";

afterEach(cleanupResourceToolFixtures);

async function fixture() {
  const kit = await resourceToolFixture();
  const { app, project, root } = kit;
  const owner = bindResourceNode(app, project.id);
  const reader = bindResourceNode(app, project.id);
  await writeFile(join(root, "source.md"), "BODY MUST NOT BE READ");
  const publish = (name: string, description: string, principal = { kind: "main" } as const) =>
    app.resources.publish({ projectId: project.id, owner: principal, sourceRef: "source.md", name, description, type: "text/markdown" });
  const hidden = await publish("Hidden", "private evidence");
  const shared = await publish("Report", "MiXeD evidence");
  app.resources.setAccess({ projectId: project.id, actor: { kind: "main" }, resourceId: shared.id,
    expectedRevision: shared.revision, access: { kind: "shared", nodeIds: [reader.node.node.id] } });
  const own = await app.resources.publish({ projectId: project.id, owner: { kind: "node", nodeId: reader.node.node.id },
    sourceRef: "source.md", name: "Own report", description: "own evidence", type: "text/markdown" });
  const sibling = await app.resources.publish({ projectId: project.id, owner: { kind: "node", nodeId: owner.node.node.id },
    sourceRef: "source.md", name: "Sibling", description: "private sibling", type: "text/markdown" });
  app.resources.createUserFolder(project.id, "Papers");
  app.resources.createUserFolder(project.id, "Papers/Sub");
  app.resources.organizeUserResource({ projectId: project.id, resourceId: shared.id, expectedRevision: 2, folder: "Papers/Sub" });
  const list = (args = {}, sessionId = reader.sessionId) => callResourceTool(app, sessionId, "list_resources", args);
  return { ...kit, owner, reader, hidden, shared, own, sibling, list };
}

describe("list_resources", () => {
  it("filters by trusted Main/Node visibility before pagination and returns only metadata", async () => {
    const { app, project, reader, hidden, shared, own, sibling, list } = await fixture();
    const read = vi.spyOn(app.resources, "withEntry");
    const result = await list();
    const data = resourceArtifact(result);
    expect(data).toMatchObject({ has_more: false, next_offset: null });
    expect(data.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ resource_id: own.id, ownedByCurrentAgent: true, revision: 1 }),
      expect.objectContaining({ resource_id: shared.id, name: "Report", description: "MiXeD evidence",
        type: "text/markdown", libraryPath: expect.stringContaining("Papers/Sub/"), revision: 3, ownedByCurrentAgent: false }),
    ]));
    expect(data.resources).toHaveLength(2);
    expect(resourceResultText(result)).not.toContain(hidden.id);
    expect(resourceResultText(result)).not.toContain(sibling.id);
    expect(resourceResultText(result)).not.toContain("BODY");
    expect(resourceResultText(result)).not.toContain("entryRef");
    expect(read).not.toHaveBeenCalled();
    expect((resourceArtifact(await list({}, project.mainSessionId)).resources as unknown[])).toHaveLength(4);

    const first = resourceArtifact(await list({ limit: 1 }));
    const second = resourceArtifact(await list({ limit: 1, offset: first.next_offset }));
    expect(first).toMatchObject({ has_more: true, next_offset: 1 });
    expect(second).toMatchObject({ has_more: false, next_offset: null });
    expect(first.resources).not.toEqual(second.resources);
    expect(resourceArtifact(await list({ offset: 2 }))).toEqual({ resources: [], has_more: false, next_offset: null });
    expect(resourceArtifact(await list({ offset: Number.MAX_SAFE_INTEGER }))).toEqual({ resources: [], has_more: false, next_offset: null });
    app.resources.setAccess({ projectId: project.id, actor: { kind: "main" }, resourceId: shared.id,
      expectedRevision: 3, access: { kind: "public" } });
    expect(resourceArtifact(await list({}, reader.sessionId)).resources).toHaveLength(2);
  });

  it("matches names and descriptions case-insensitively and includes descendant folders", async () => {
    const { shared, own, list } = await fixture();
    for (const args of [{ query: "rEpOrT" }, { query: "mixed" }, { folder: "papers" }, { folder: "Papers/Sub", query: "evidence" }]) {
      const data = resourceArtifact(await list(args));
      expect(data.resources).toEqual(expect.arrayContaining([expect.objectContaining({ resource_id: shared.id })]));
      if (args.query !== "rEpOrT") expect(data.resources).toHaveLength(1);
    }
    expect(resourceArtifact(await list({ folder: "Paper" })).resources).toEqual([]);
    expect(resourceArtifact(await list({ folder: "Missing" })).resources).toEqual([]);
    expect(resourceArtifact(await list({ folder: "", query: "" })).resources).toHaveLength(2);
    expect(resourceArtifact(await list({ query: "own" })).resources).toEqual([expect.objectContaining({ resource_id: own.id })]);
    expect(resourceArtifact(await list({ query: "hidden" })).resources).toEqual([]);
  });

  it("defaults to 30 items and allows the full 1–100 page range", async () => {
    const { app, own, list } = await fixture();
    vi.spyOn(app.resources, "listVisible").mockReturnValue(Array.from({ length: 31 }, () => own));
    expect(resourceArtifact(await list())).toMatchObject({ resources: expect.any(Array), has_more: true, next_offset: 30 });
    expect(resourceArtifact(await list()).resources).toHaveLength(30);
    expect(resourceArtifact(await list({ limit: 100 })).resources).toHaveLength(31);
  });

  it.each([{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 }, { folder: "../secret" }, { folder: "C:/secret" },
    { query: 1 }, { folder: null }, { project_id: "forged" }, { viewer: { kind: "main" } }])("rejects invalid arguments %j", async args => {
    const { app, project } = await resourceToolFixture();
    expect((await callResourceTool(app, project.mainSessionId, "list_resources", args)).kind).toBe("failure");
  });

  it("rejects an unbound Session", async () => {
    const { app } = await resourceToolFixture();
    expect(await callResourceTool(app, createSessionId("unbound"), "list_resources", {})).toMatchObject({
      kind: "failure", failure: { modelMessage: expect.stringContaining("Session") },
    });
  });
});
