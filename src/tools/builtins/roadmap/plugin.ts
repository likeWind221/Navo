import type { Context } from "cordis";

import { ModifyRoadmapTool } from "./modify-roadmap.js";
import { ReadNodeTool } from "./read-node.js";
import { ReadRoadmapTool } from "./read.js";
import { CreateRoadmapTool } from "./create-roadmap.js";

export async function RoadmapToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(ReadRoadmapTool);
  await ctx.plugin(ReadNodeTool);
  await ctx.plugin(CreateRoadmapTool);
  await ctx.plugin(ModifyRoadmapTool);
}
