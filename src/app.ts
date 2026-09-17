import { Context } from "cordis";

import { AgentRuntime } from "./agent/runtime.js";
import type { AgentRuntimeLimits } from "./agent/types.js";
import { CommandService } from "./command/service.js";
import { LLMService } from "./llm/service.js";
import { MailboxStore } from "./mailbox/store.js";
import type { NodePluginConfig } from "./node/plugin.js";
import { NodePlugin } from "./node/plugin.js";
import { MainSessionService } from "./project/session.js";
import { SessionStore } from "./session/store.js";
import { ProjectStore } from "./project/store.js";
import { RoadmapStore } from "./roadmap/store.js";
import { RoadmapToolsPlugin } from "./tools/builtins/roadmap/plugin.js";
import type { ToolsPluginConfig } from "./tools/plugin.js";
import { ToolsPlugin } from "./tools/plugin.js";

export interface NavoAppConfig {
  readonly runtime?: Partial<AgentRuntimeLimits>;
  readonly tools?: ToolsPluginConfig;
  readonly node: NodePluginConfig;
}

export async function NavoApp(
  ctx: Context,
  config: NavoAppConfig,
): Promise<void> {
  await Promise.all([
    ctx.plugin(SessionStore),
    ctx.plugin(ProjectStore),
    ctx.plugin(LLMService),
    ctx.plugin(ToolsPlugin, config.tools),
  ]);
  await ctx.plugin(AgentRuntime, config.runtime);
  await ctx.plugin(CommandService);
  await ctx.plugin(NodePlugin, config.node);
  await ctx.plugin(MailboxStore);
  await ctx.plugin(MainSessionService, { model: config.node.session.model });
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
}

export async function createApp(
  config: NavoAppConfig,
): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(NavoApp, config);
    return ctx;
  } catch (error: unknown) {
    await ctx.fiber.dispose();
    throw error;
  }
}
