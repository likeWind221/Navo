import type { Context } from "cordis";

import type { NodeSessionServiceConfig } from "./session.js";
import { NodeSessionService } from "./session.js";
import { NodeStore } from "./store.js";
import { NodeContentTools } from "./tools.js";

/** Configuration owned by the Node domain root. */
export interface NodePluginConfig {
  readonly session: NodeSessionServiceConfig;
}

/** Mounts every Store, Service, and tool whose semantics belong to Node. */
export const NodePlugin = Object.assign(
  async function mountNode(
    ctx: Context,
    config: NodePluginConfig,
  ): Promise<void> {
    await ctx.plugin(NodeStore);
    await ctx.plugin(NodeContentTools);
    await ctx.plugin(NodeSessionService, config.session);
  },
  { inject: ["agentRuntime", "tools"] },
);
