import { Service } from "cordis";
import type { Context } from "cordis";

import { createGenerateRequest } from "../agent/request.js";
import type { SessionId } from "../brand/ids.js";
import { resolveContextBudget } from "../context/budget.js";
import { compactSession } from "../context/compaction/compact.js";
import { measureContext } from "../context/meter.js";
import { CommandError } from "./errors.js";

export class CompactCommand extends Service {
  static inject = ["commands", "agentRuntime", "sessions", "sessionContexts", "tools", "llm"];

  constructor(ctx: Context) {
    super(ctx, "compactCommand");
    this.ctx.effect(() => this.ctx.commands.register({
      name: "compact",
      mode: "queued",
      parseArgs: args => {
        if (args.trim() !== "") throw new CommandError("invalid-args", "compact does not accept arguments.");
      },
      execute: ({ sessionId, signal }) => this.compact(sessionId, signal),
    }), "compact.command");
  }

  private async compact(sessionId: SessionId, signal: AbortSignal): Promise<string> {
    const context = this.ctx.sessionContexts.resolve(sessionId);
    const budget = resolveContextBudget(context.model);
    if (budget.kind === "disabled") {
      return budget.reason === "missing-capacity"
        ? "No compaction performed: the model has no context capacity or auto-compact limit configured."
        : "No compaction performed: the configured model window leaves no room for context.";
    }
    const request = createGenerateRequest(this.ctx, {
      sessionId,
      model: context.model,
      systemPrompt: context.systemPrompt,
      ...(context.buildTurnContext === undefined ? {} : { buildTurnContext: context.buildTurnContext }),
      toolNames: context.toolNames,
    }, signal);
    const before = measureContext(this.ctx.sessions.getEvents(sessionId), request);
    const outcome = await compactSession(this.ctx, {
      sessionId,
      model: context.model,
      request,
      thresholdTokens: budget.thresholdTokens,
      retainTokens: budget.retainTokens,
      trigger: "manual",
      signal,
      cancelSignal: signal,
      maxRetries: this.ctx.agentRuntime.limits.maxModelRetries,
    });
    if (outcome.kind === "compacted") {
      const reclaimed = Math.max(0, outcome.beforeTokens - outcome.afterTokens);
      return `Compacted context for ${context.model.provider}/${context.model.model}: `
        + `${outcome.beforeTokens} -> ${outcome.afterTokens} tokens, ${reclaimed} reclaimed `
        + `(summary ${outcome.summaryTokens} tokens).`;
    }
    if (outcome.kind === "no-progress") {
      return outcome.reason === "no-safe-selection"
        ? `No compaction performed: no safe history prefix can be compacted (approximately ${before.usedTokens} tokens measured).`
        : "No compaction performed: context compaction is unavailable for this model.";
    }
    if (outcome.kind === "cancelled") return "Compaction was cancelled.";
    if (isNoProgressCode(outcome.code)) {
      return `No compaction performed: ${outcome.message} (${outcome.code}).`;
    }
    throw new Error(`${outcome.message} (${outcome.code})`);
  }
}

function isNoProgressCode(code: string): boolean {
  return code === "context-compaction-not-shrinking" || code === "context-compaction-no-progress";
}
