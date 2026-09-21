import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeAgentProfile } from "../../src/node/profile.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../src/tools/builtins/mailbox/send.js";
import { DELETE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/delete.js";
import { FETCH_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/fetch.js";
import { REGISTER_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/register.js";
import { UPDATE_RESOURCE_TOOL_NAME } from "../../src/tools/builtins/resource/update.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";
import { ProjectStore } from "../../src/project/store.js";
import { NodeStore } from "../../src/node/store.js";

let ctx: Context | undefined;
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
});

describe("NodeAgent file capability", () => {
  it("adds only read when the host file capability is available", async () => {
    ctx = new Context();
    await ctx.plugin(ProjectStore);
    await ctx.plugin(NodeStore);
    const project = ctx.projects.create({ goal: "Research" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Read long source",
        description: "Use fetched source material",
        acceptanceCriteria: ["Explain the source"],
      },
    });

    if (node.node.kind !== "work") throw new Error("Expected work Node.");
    const context = {
      projectGoal: project.goal,
      objective: node.node.objective,
      status: node.status,
      resources: [],
    } as const;
    const withoutFiles = createNodeAgentProfile(context);
    const withRead = createNodeAgentProfile(context, { allowFileRead: true });

    expect(withoutFiles.toolNames).not.toContain("read");
    expect(withRead.toolNames).toContain("read");
    expect(withRead.toolNames).toEqual(expect.arrayContaining([
      REGISTER_RESOURCE_TOOL_NAME,
      FETCH_RESOURCE_TOOL_NAME,
      UPDATE_RESOURCE_TOOL_NAME,
      DELETE_RESOURCE_TOOL_NAME,
      SEND_TO_MAIN_TOOL_NAME,
    ]));
    expect(withRead.toolNames).not.toContain(SET_RESOURCE_ACCESS_TOOL_NAME);
    expect(withRead.toolNames).not.toEqual(
      expect.arrayContaining(["shell", "edit", "write"]),
    );
    expect(withRead.systemPrompt).toContain("file_path");
    expect(withRead.systemPrompt).toContain("read");
  });
});
