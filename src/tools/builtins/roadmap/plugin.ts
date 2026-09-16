import type { Context } from "cordis";

import { ReadRoadmapTool } from "./read.js";

export async function RoadmapToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(ReadRoadmapTool);
}
