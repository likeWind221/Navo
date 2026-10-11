import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import {
  projectCreateMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectResourcesMethod,
  RpcError,
} from "../../rpc/index.js";
import { createProjectId } from "../../src/brand/ids.js";
import { call, failureOf, host, seedRoadmap, workspace } from "./project/helpers.js";

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

  it("saves a Project and its Workspace binding in one transaction", async () => {
    const path = join(await workspace(), "navo.db");
    const { client } = await host([], { path });
    const db = new DatabaseSync(path);
    db.exec("CREATE TRIGGER fail_bindings BEFORE INSERT ON workspace_bindings BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    expect(await failureOf(client, projectCreateMethod, { name: "Lost", goal: null, workspaceRoot: await workspace() }))
      .toMatchObject({ code: "internal" });
    expect((await call(client, projectListMethod, {})).projects).toEqual([]);
    expect(db.prepare("SELECT count(*) AS count FROM events").get()).toEqual({ count: 0 });

    db.exec("DROP TRIGGER fail_bindings");
    db.close();
    const saved = await call(client, projectCreateMethod, { name: "Saved", goal: null, workspaceRoot: await workspace() });
    expect((await call(client, projectListMethod, {})).projects).toEqual([saved]);
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
