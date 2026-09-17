import type { Context } from "cordis";

import { ReadNodeTool } from "./read-node.js";
import { ReadRoadmapTool } from "./read.js";

export async function RoadmapToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(ReadRoadmapTool);
  await ctx.plugin(ReadNodeTool);
}
