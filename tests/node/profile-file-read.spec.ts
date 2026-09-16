import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeAgentProfile } from "../../src/node/profile.js";
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

    const withoutFiles = createNodeAgentProfile(node);
    const withRead = createNodeAgentProfile(node, { allowFileRead: true });

    expect(withoutFiles.toolNames).not.toContain("read");
    expect(withRead.toolNames).toContain("read");
    expect(withRead.toolNames).not.toEqual(
      expect.arrayContaining(["shell", "edit", "write"]),
    );
    expect(withRead.systemPrompt).toContain("file_path");
    expect(withRead.systemPrompt).toContain("read");
  });
});
