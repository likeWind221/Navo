import {
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

describe("Resource owner CRUD capabilities", () => {
  it("gives a Node owner register, fetch, metadata update and delete", async () => {
    const { app, project, workspace, root } = await resourceToolFixture();
    await writeFile(join(root, "report.md"), "alpha\nbeta\ngamma\n", "utf8");
    const { node, sessionId } = bindResourceNode(app, project.id);

    const registered = await callResourceTool(app, sessionId, REGISTER_RESOURCE_TOOL_NAME, {
      path: "report.md",
      name: "Node report",
      description: "Node-owned result",
      type: "text/markdown",
    });
    expect(registered.kind).toBe("success");
    const artifact = resourceArtifact(registered);
    expect(artifact.owner).toEqual({
      kind: "node",
      node_id: String(node.node.id),
    });
    expect(artifact.revision).toBe(1);
    const resourceId = artifact.resource_id as string;

    const fetched = await callResourceTool(app, sessionId, FETCH_RESOURCE_TOOL_NAME, {
      resource_id: resourceId,
      max_lines: 2,
    });
    expect(fetched.kind).toBe("success");
    expect(resourceResultText(fetched)).toContain("1: alpha");
    expect(resourceResultText(fetched)).toContain("[Continue with start_line=3]");

    const updated = await callResourceTool(app, sessionId, UPDATE_RESOURCE_TOOL_NAME, {
      resource_id: resourceId,
      expected_revision: 1,
      name: "Node report v2",
    });
    expect(updated.kind).toBe("success");
    expect(resourceArtifact(updated)).toMatchObject({
      name: "Node report v2",
      revision: 2,
    });

    const deleted = await callResourceTool(app, sessionId, DELETE_RESOURCE_TOOL_NAME, {
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
    const { app, project, root } = await resourceToolFixture();
    await writeFile(join(root, "synthesis.md"), "main synthesis\n", "utf8");

    const registered = await callResourceTool(
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
    const artifact = resourceArtifact(registered);
    expect(artifact.owner).toEqual({ kind: "main" });
    const resourceId = artifact.resource_id as string;

    const updated = await callResourceTool(
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
    expect(resourceArtifact(updated).revision).toBe(2);

    const deleted = await callResourceTool(
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
});
