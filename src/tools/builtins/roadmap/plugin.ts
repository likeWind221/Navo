import type { Context } from "cordis";

import { createRoadmapMutationTool } from "./modify.js";
import { reorderNodesTool, setDependencyTool } from "./modify/graph.js";
import { addNodeTool, editNodeTool, removeNodeTool } from "./modify/node.js";
import { ReadNodeTool } from "./read-node.js";
import { ReadRoadmapTool } from "./read.js";
import { CreateRoadmapTool } from "./create-roadmap.js";

const MODIFY_TOOLS = [addNodeTool, editNodeTool, removeNodeTool, setDependencyTool, reorderNodesTool];

const ModifyRoadmapTools = Object.assign(
  function registerModifyRoadmapTools(ctx: Context): () => void {
    const disposers = MODIFY_TOOLS.map(spec =>
      ctx.effect(() => ctx.tools.register(createRoadmapMutationTool(ctx, spec)), `roadmap.${spec.name}-tool`));
    return () => { for (const dispose of disposers) void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "roadmaps"] },
);

export async function RoadmapToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(ReadRoadmapTool);
  await ctx.plugin(ReadNodeTool);
  await ctx.plugin(CreateRoadmapTool);
  await ctx.plugin(ModifyRoadmapTools);
}
