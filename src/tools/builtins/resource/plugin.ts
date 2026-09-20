import type { Context } from "cordis";

import { createDeleteResourceTool } from "./delete.js";
import { createFetchResourceTool } from "./fetch.js";
import { createRegisterResourceTool } from "./register.js";
import { createUpdateResourceTool } from "./update.js";

export const ResourceToolsPlugin = Object.assign(
  function registerResourceTools(ctx: Context): void {
    const definitions = [
      createRegisterResourceTool(ctx),
      createFetchResourceTool(ctx),
      createUpdateResourceTool(ctx),
      createDeleteResourceTool(ctx),
    ];
    ctx.effect(() => {
      const dispose = definitions.map(definition => ctx.tools.register(definition));
      return () => {
        for (const unregister of dispose.reverse()) unregister();
      };
    }, "resource.tools");
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);
