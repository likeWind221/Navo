import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createResourceId } from "../../../src/brand/ids.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../../src/tools/builtins/resource/access.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/register.js";
import {
  bindResourceNode,
  callResourceTool,
  cleanupResourceToolFixtures,
  resourceArtifact,
  resourceToolFixture,
} from "./helpers.js";

afterEach(cleanupResourceToolFixtures);

describe("Main Resource handoff capability", () => {
  it("moves a Resource through private, shared, project and private states", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "handoff.md"), "handoff\n", "utf8");
    const owner = bindResourceNode(app, project.id);
    const reader = bindResourceNode(app, project.id);

    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "handoff.md",
        name: "Handoff",
        description: "Resource to distribute",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;

    const shared = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 1,
        access: {
          kind: "shared",
          node_ids: [String(reader.node.node.id)],
        },
      },
    );
    expect(shared.kind).toBe("success");
    expect(resourceArtifact(shared)).toMatchObject({
      revision: 2,
      access: {
        kind: "shared",
        node_ids: [String(reader.node.node.id)],
      },
    });
    expect(app.resources.getVisible(
      project.id,
      createResourceId(id),
      { kind: "node", nodeId: reader.node.node.id },
    )).toBeDefined();

    const projectWide = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 2,
        access: { kind: "project" },
      },
    );
    expect(projectWide.kind).toBe("success");
    expect(resourceArtifact(projectWide)).toMatchObject({
      revision: 3,
      access: { kind: "project" },
    });

    const privateAgain = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 3,
        access: { kind: "private" },
      },
    );
    expect(privateAgain.kind).toBe("success");
    expect(resourceArtifact(privateAgain)).toMatchObject({
      revision: 4,
      access: { kind: "private" },
    });
    expect(app.resources.getVisible(
      project.id,
      createResourceId(id),
      { kind: "node", nodeId: reader.node.node.id },
    )).toBeUndefined();
  });

  it("requires Main binding even if a Node directly invokes the registered tool", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "owner.md"), "owner\n", "utf8");
    const owner = bindResourceNode(app, project.id);
    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "owner.md",
        name: "Owner",
        description: "Owner Resource",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;

    const result = await callResourceTool(
      app,
      owner.sessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 1,
        access: { kind: "project" },
      },
    );

    expect(result).toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        modelMessage: expect.stringContaining("Main Agent"),
      },
    });
    expect(app.resources.get(project.id, createResourceId(id))?.access)
      .toEqual({ kind: "private" });
  });

  it("rejects stale revisions and invalid access shapes without changing Resource state", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "state.md"), "state\n", "utf8");
    const owner = bindResourceNode(app, project.id);
    const reader = bindResourceNode(app, project.id);
    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "state.md",
        name: "State",
        description: "State checks",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;

    const shared = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 1,
        access: {
          kind: "shared",
          node_ids: [String(reader.node.node.id)],
        },
      },
    );
    expect(shared.kind).toBe("success");

    const stale = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 1,
        access: { kind: "private" },
      },
    );
    expect(stale).toMatchObject({
      kind: "failure",
      failure: {
        modelMessage: expect.stringContaining("changed"),
      },
    });

    const invalid = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 2,
        access: {
          kind: "private",
          node_ids: [String(reader.node.node.id)],
        },
      },
    );
    expect(invalid).toMatchObject({
      kind: "failure",
      failure: {
        modelMessage: expect.stringContaining("node_ids"),
      },
    });
    expect(app.resources.get(project.id, createResourceId(id))).toMatchObject({
      revision: 2,
      access: {
        kind: "shared",
        nodeIds: [reader.node.node.id],
      },
    });
  });

  it("rejects control or cross-Project Nodes and never starts the target Node", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "target.md"), "target\n", "utf8");
    const owner = bindResourceNode(app, project.id);
    const target = bindResourceNode(app, project.id);
    const control = app.nodes.create({
      projectId: project.id,
      kind: "control",
      purpose: "checkpoint",
      title: "review",
    });
    const otherProject = app.projects.create({ goal: "Other Project" });
    const otherNode = app.nodes.create({
      projectId: otherProject.id,
      objective: {
        title: "Other",
        description: "Other",
        acceptanceCriteria: ["Other"],
      },
    });
    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "target.md",
        name: "Target",
        description: "Target checks",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;
    const before = app.nodes.getEvents(target.node.node.id).length;

    for (const nodeId of [control.node.id, otherNode.node.id]) {
      const rejected = await callResourceTool(
        app,
        project.mainSessionId,
        SET_RESOURCE_ACCESS_TOOL_NAME,
        {
          resource_id: id,
          expected_revision: 1,
          access: {
            kind: "shared",
            node_ids: [String(nodeId)],
          },
        },
      );
      expect(rejected).toMatchObject({
        kind: "failure",
        failure: {
          code: "tool-failed",
        },
      });
    }

    const handedOff = await callResourceTool(
      app,
      project.mainSessionId,
      SET_RESOURCE_ACCESS_TOOL_NAME,
      {
        resource_id: id,
        expected_revision: 1,
        access: {
          kind: "shared",
          node_ids: [String(target.node.node.id)],
        },
      },
    );
    expect(handedOff.kind).toBe("success");
    expect(app.nodes.getEvents(target.node.node.id)).toHaveLength(before);
  });
});
