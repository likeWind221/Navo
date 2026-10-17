import { Service } from "cordis";
import type { Context } from "cordis";

import type { SessionAgentContext, TurnModelConfig } from "../agent/types.js";
import type { SessionId } from "../brand/ids.js";
import { resolveAgentBinding } from "../project/binding.js";
import { CommandError } from "./errors.js";

export interface SessionContextResolverConfig {
  readonly agent?: {
    readonly model: TurnModelConfig;
    readonly systemPrompt?: string;
    readonly toolNames?: readonly string[];
  };
}

declare module "cordis" {
  interface Context {
    sessionContexts: SessionContextResolver;
  }
}

/** Resolves the execution context a Session would use without starting any work. */
export class SessionContextResolver extends Service {
  static inject = ["projects", "nodes", "mainSessions", "nodeSessions"];

  private readonly agent: SessionAgentContext | undefined;

  constructor(ctx: Context, config: SessionContextResolverConfig = {}) {
    super(ctx, "sessionContexts");
    this.agent = config.agent === undefined ? undefined : Object.freeze({
      model: snapshotModel(config.agent.model),
      systemPrompt: config.agent.systemPrompt ?? "",
      toolNames: Object.freeze([...(config.agent.toolNames ?? [])]),
    });
  }

  resolve(sessionId: SessionId): SessionAgentContext {
    const binding = resolveAgentBinding(this.ctx, sessionId);
    if (binding?.kind === "main") return this.ctx.mainSessions.resolveContext(sessionId);
    if (binding?.kind === "node") return this.ctx.nodeSessions.resolveContext(sessionId);
    if (this.agent === undefined) {
      throw new CommandError(
        "command-failed",
        `Session '${sessionId}' has no resolvable agent context.`,
      );
    }
    return this.agent;
  }
}

function snapshotModel(value: TurnModelConfig): TurnModelConfig {
  if (typeof value.provider !== "string" || !value.provider.trim()
      || typeof value.model !== "string" || !value.model.trim()) {
    throw new TypeError("Session context requires a non-empty model provider and name.");
  }
  return Object.freeze(structuredClone(value));
}
