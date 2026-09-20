import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../../src/app.js";
import {
  createSessionId,
  createToolCallId,
} from "../../../src/brand/ids.js";
import type { SessionId } from "../../../src/brand/ids.js";
import { createFileEnvironment } from "../../../src/tools/builtins/file/path.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../../src/tools/builtins/resource/update.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../../src/tools/builtins/mailbox/send.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];
let callSequence = 0;

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  callSequence = 0;
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "navo-resource-tools-"));
  roots.push(root);
  const hostEnvironment = await createFileEnvironment(root);
  const app = await createApp({
    node: { session: { model: { provider: "mock", model: "test" } } },
    tools: {
      file: {
        resolveFileEnvironment: () => hostEnvironment,
      },
    },
  });
  apps.push(app);
  const project = app.projects.create({ goal: "Resource capabilities" });
  const workspace = await app.projectWorkspaces.create(project.id, root);
  return { app, project, workspace, root };
}

function bindNode(app: Awaited<ReturnType<typeof createApp>>, projectId: string) {
  const node = app.nodes.create({
    projectId: projectId as never,
    objective: {
      title: "Produce findings",
      description: "Produce reusable findings",
      acceptanceCriteria: ["Publish the result"],
    },
  });
  app.nodes.unlock(node.node.id, "test");
  const sessionId = createSessionId(`resource-node-${callSequence++}`);
  app.nodes.bindSession(node.node.id, sessionId);
  return { node, sessionId };
}

async function callTool(
  app: Awaited<ReturnType<typeof createApp>>,
  sessionId: SessionId,
  name: string,
  arguments_: Record<string, unknown>,
) {
  return app.tools.execute({
    type: "tool-call",
    id: createToolCallId(`resource-call-${callSequence++}`),
    name,
    arguments: JSON.stringify(arguments_),
  }, new AbortController().signal, {
    sessionId,
    allowedTools: [name],
  });
}

function artifactObject(result: Awaited<ReturnType<typeof callTool>>) {
  if (result.kind !== "success" || result.artifact === undefined
      || result.artifact === null || typeof result.artifact !== "object"
      || Array.isArray(result.artifact)) {
    throw new Error("Expected successful tool result with object artifact.");
  }
  return result.artifact as Record<string, unknown>;
}

describe("Project Resource Agent capabilities", () => {
  it("gives a Node owner register, fetch, metadata update and delete", async () => {
    const { app, project, workspace, root } = await fixture();
    await writeFile(join(root, "report.md"), "alpha\nbeta\ngamma\n", "utf8");
    const { node, sessionId } = bindNode(app, project.id);

    const registered = await callTool(app, sessionId, REGISTER_RESOURCE_TOOL_NAME, {
      path: "report.md",
      name: "Node report",
      description: "Node-owned result",
      type: "text/markdown",
    });
    expect(registered.kind).toBe("success");
    const registeredArtifact = artifactObject(registered);
    expect(registeredArtifact.owner).toEqual({
      kind: "node",
      node_id: String(node.node.id),
    });
    expect(registeredArtifact.revision).toBe(1);
    const resourceId = registeredArtifact.resource_id as string;

    const fetched = await callTool(app, sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: resourceId,
      max_lines: 2,
    });
    expect(fetched.kind).toBe("success");
    expect(fetched.block.content[0]?.text).toContain("1: alpha");
    expect(fetched.block.content[0]?.text).toContain("[Continue with start_line=3]");

    const updated = await callTool(app, sessionId, UPDATE_RESOURCE_TOOL_NAME, {
      resource_id: resourceId,
      expected_revision: 1,
      name: "Node report v2",
    });
    expect(updated.kind).toBe("success");
    expect(artifactObject(updated)).toMatchObject({
      name: "Node report v2",
      revision: 2,
    });

    const deleted = await callTool(app, sessionId, DELETE_RESOURCE_TOOL_NAME, {
      resource_id: resourceId,
      expected_revision: 2,
    });
    expect(deleted.kind).toBe("success");
    expect(app.resources.listByProject(project.id)).toEqual([]);
    expect(await readFile(
      join(workspace.assetsRoot, resourceId, "report.md"),
      "utf8",
    )).toBe("alpha\nbeta\ngamma\n");
  });

  it("allows Main to own and CRUD its own Resource", async () => {
    const { app, project, root } = await fixture();
    await writeFile(join(root, "synthesis.md"), "main synthesis\n", "utf8");

    const registered = await callTool(
      app,
      project.mainSessionId,
      REGISTER_RESOURCE_TOOL_NAME,
      {
        path: "synthesis.md",
        name: "Main synthesis",
        description: "Main-owned Project synthesis",
        type: "text/markdown",
      },
    );
    expect(registered.kind).toBe("success");
    const artifact = artifactObject(registered);
    expect(artifact.owner).toEqual({ kind: "main" });
    const resourceId = artifact.resource_id as string;

    const updated = await callTool(
      app,
      project.mainSessionId,
      UPDATE_RESOURCE_TOOL_NAME,
      {
        resource_id: resourceId,
        expected_revision: 1,
        description: "Updated Main synthesis",
      },
    );
    expect(updated.kind).toBe("success");
    expect(artifactObject(updated).revision).toBe(2);

    const deleted = await callTool(
      app,
      project.mainSessionId,
      DELETE_RESOURCE_TOOL_NAME,
      {
        resource_id: resourceId,
        expected_revision: 2,
      },
    );
    expect(deleted.kind).toBe("success");
  });

  it("keeps a shared Resource read-only for non-owners, including Main for Node-owned content", async () => {
    const { app, project, root } = await fixture();
    await writeFile(join(root, "owner.md"), "owner content\n", "utf8");
    const owner = bindNode(app, project.id);
    const reader = bindNode(app, project.id);

    const registered = await callTool(
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
    const id = artifactObject(registered).resource_id as string;
    app.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: id as never,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [reader.node.node.id] },
    });

    const fetched = await callTool(app, reader.sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: id,
    });
    expect(fetched.kind).toBe("success");

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
      const result = await callTool(app, sessionId, name, args);
      expect(result).toMatchObject({
        kind: "failure",
        failure: {
          code: "tool-failed",
          modelMessage: expect.stringContaining("owner"),
        },
      });
    }
  });

  it("blocks generic read from .navo Resource storage while fetch_resource remains authorized", async () => {
    const { app, project, root } = await fixture();
    await writeFile(join(root, "report.md"), "protected\n", "utf8");
    const owner = bindNode(app, project.id);

    const registered = await callTool(
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
    const id = artifactObject(registered).resource_id as string;

    const ordinarySource = await callTool(app, owner.sessionId, "read", {
      path: "report.md",
    });
    expect(ordinarySource.kind).toBe("success");

    const bypass = await callTool(app, owner.sessionId, "read", {
      path: `.navo/assets/${id}/report.md`,
    });
    expect(bypass).toMatchObject({
      kind: "failure",
      failure: {
        modelMessage: "The requested path is not available in the current file environment.",
      },
    });

    const fetched = await callTool(app, owner.sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: id,
    });
    expect(fetched.kind).toBe("success");
    expect(fetched.block.content[0]?.text).toContain("protected");
  });

  it("sends Node text to Main without changing routing or starting another Agent", async () => {
    const { app, project } = await fixture();
    const node = bindNode(app, project.id);
    const before = app.nodes.get(node.node.node.id);

    const sent = await callTool(app, node.sessionId, SEND_TO_MAIN_TOOL_NAME, {
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

    const mainAttempt = await callTool(
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
