import type { Context } from "cordis";

import { ReadNodeTool } from "./read-node.js";
import { ReadRoadmapTool } from "./read.js";
import { WriteRoadmapTool } from "./write-roadmap.js";

export async function RoadmapToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(ReadRoadmapTool);
  await ctx.plugin(ReadNodeTool);
  await ctx.plugin(WriteRoadmapTool);
}
