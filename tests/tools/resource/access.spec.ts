import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createResourceId } from "../../../src/brand/ids.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/update.js";
import {
  bindResourceNode,
  callResourceTool,
  cleanupResourceToolFixtures,
  resourceArtifact,
  resourceResultText,
  resourceToolFixture,
} from "./helpers.js";

afterEach(cleanupResourceToolFixtures);

describe("Resource access and Project reporting capabilities", () => {
  it("keeps shared Resources read-only for non-owners, including Main for Node-owned content", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "owner.md"), "owner content\n", "utf8");
    const owner = bindResourceNode(app, project.id);
    const reader = bindResourceNode(app, project.id);

    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "owner.md",
        name: "Owner result",
        description: "Shared later",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;
    app.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: createResourceId(id),
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [reader.node.node.id] },
    });

    expect((await callResourceTool(app, reader.sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: id,
    })).kind).toBe("success");

    for (const [sessionId, name, args] of [
      [
        reader.sessionId,
        UPDATE_RESOURCE_TOOL_NAME,
        { resource_id: id, expected_revision: 2, name: "Reader edit" },
      ],
      [
        reader.sessionId,
        DELETE_RESOURCE_TOOL_NAME,
        { resource_id: id, expected_revision: 2 },
      ],
      [
        project.mainSessionId,
        UPDATE_RESOURCE_TOOL_NAME,
        { resource_id: id, expected_revision: 2, name: "Main edit" },
      ],
    ] as const) {
      const result = await callResourceTool(app, sessionId, name, args);
      expect(result).toMatchObject({
        kind: "failure",
        failure: {
          code: "tool-failed",
          modelMessage: expect.stringContaining("owner"),
        },
      });
    }
  });

  it("blocks generic read from .navo while fetch_resource remains authorized", async () => {
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "report.md"), "protected\n", "utf8");
    const owner = bindResourceNode(app, project.id);

    const registered = await callResourceTool(
      app,
      owner.sessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "report.md",
        name: "Protected",
        description: "Protected Resource",
        type: "text/markdown",
      },
    );
    const id = resourceArtifact(registered).resource_id as string;

    expect((await callResourceTool(app, owner.sessionId, "read", {
      path: "report.md",
    })).kind).toBe("success");

    const bypass = await callResourceTool(app, owner.sessionId, "read", {
      path: `.navo/assets/${id}/report.md`,
    });
    expect(bypass).toMatchObject({
      kind: "failure",
      failure: {
        modelMessage: "The requested path is not available in the current file environment.",
      },
    });

    const fetched = await callResourceTool(app, owner.sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: id,
    });
    expect(fetched.kind).toBe("success");
    expect(resourceResultText(fetched)).toContain("protected");
  });

  it("sends Node text to Main without changing routing or starting another Agent", async () => {
    const { app, project } = await resourceToolFixture();
    const node = bindResourceNode(app, project.id);
    const before = app.nodes.get(node.node.node.id);

    const sent = await callResourceTool(app, node.sessionId, SEND_TO_MAIN_TOOL_NAME, {
      message: "Resource is ready; please coordinate downstream use.",
    });
    expect(sent.kind).toBe("success");
    expect(app.mailbox.getHistory(project.id)).toEqual([
      expect.objectContaining({
        sender: { kind: "node", nodeId: node.node.node.id },
        recipient: { kind: "main" },
        body: "Resource is ready; please coordinate downstream use.",
      }),
    ]);
    expect(app.nodes.get(node.node.node.id)?.status).toBe(before?.status);

    const mainAttempt = await callResourceTool(
      app,
      project.mainSessionId,
      SEND_TO_MAIN_TOOL_NAME,
      { message: "not a Node" },
    );
    expect(mainAttempt).toMatchObject({
      kind: "failure",
      failure: {
        modelMessage: expect.stringContaining("Node Agent"),
      },
    });
  });
});
