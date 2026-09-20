import type { Context } from "cordis";

import { DeleteResourceTool } from "./delete.js";
import { FetchResourceTool } from "./fetch.js";
import { RegisterResourceTool } from "./register.js";
import { UpdateResourceTool } from "./update.js";

export async function ResourceToolsPlugin(ctx: Context): Promise<void> {
  await ctx.plugin(RegisterResourceTool);
  await ctx.plugin(FetchResourceTool);
  await ctx.plugin(UpdateResourceTool);
  await ctx.plugin(DeleteResourceTool);
}
