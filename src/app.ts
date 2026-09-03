import { Context } from "cordis";

import { AgentRuntime } from "./agent/runtime.js";
import type { AgentRuntimeLimits } from "./agent/types.js";
import { LLMService } from "./llm/service.js";
import { SessionStore } from "./session/store.js";
import { ToolService } from "./tools/service.js";

/** Configuration owned by the minimal SkillWorld application composition. */
export interface SkillWorldAppConfig {
  readonly runtime?: Partial<AgentRuntimeLimits>;
}

/** Mounts the core services and activates the runtime once its dependencies exist. */
export function SkillWorldApp(
  ctx: Context,
  config: SkillWorldAppConfig = {},
): void {
  ctx.inject(["sessions", "llm", "tools"], (runtimeContext) => {
    new AgentRuntime(runtimeContext, config.runtime);
  });

  ctx.plugin(SessionStore);
  ctx.plugin(LLMService);
  ctx.plugin(ToolService);
}

/** Creates a ready-to-use application context owned by the caller. */
export async function createApp(
  config: SkillWorldAppConfig = {},
): Promise<Context> {
  const ctx = new Context();
  try {
    await ctx.plugin(SkillWorldApp, config);
    return ctx;
  } catch (error: unknown) {
    await ctx.fiber.dispose();
    throw error;
  }
}
