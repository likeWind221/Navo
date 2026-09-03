import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createStepId, createTurnId } from "../brand/ids.js";
import type { Failure, TurnEndStatus } from "../session/types.js";
import { resolveAgentRuntimeLimits, runWithModelRetries } from "./limits.js";
import { requestModel } from "./request.js";
import { acceptResponse } from "./response.js";
import { runtimeFailure, turnResult } from "./result.js";
import type { StepOutcome } from "./result.js";
import type { AgentRuntimeLimits, RunTurnInput, TurnResult, TurnScope } from "./types.js";

declare module "cordis" {
  interface Context {
    agentRuntime: AgentRuntime;
  }
}

/** The sole owner of Turn/Step lifecycle, Session writes, and tool dispatch. */
export class AgentRuntime extends Service {
  private readonly defaultLimits: AgentRuntimeLimits;

  constructor(ctx: Context, limits: Partial<AgentRuntimeLimits> = {}) {
    super(ctx, "agentRuntime");
    this.defaultLimits = resolveAgentRuntimeLimits(limits);
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    const limits = resolveAgentRuntimeLimits(this.defaultLimits, input.limits);
    const turnId = createTurnId(randomUUID());
    const signal = input.signal ?? new AbortController().signal;
    const turn: TurnScope = { input, turnId, signal, limits };
    let steps = 0;
    let status: TurnEndStatus = "failed";
    let failure: Failure | undefined;
    this.ctx.sessions.append({
      type: "turn-started",
      sessionId: input.sessionId,
      data: { turnId },
    });
    try {
      this.ctx.sessions.append({
        type: "user-message",
        sessionId: input.sessionId,
        data: { message: input.userMessage },
      });
      while (true) {
        if (signal.aborted) {
          status = "cancelled";
          return turnResult(status, turnId, steps, undefined);
        }
        if (steps >= limits.maxSteps) {
          status = "blocked";
          failure = {
            code: "max-steps-exceeded",
            message: `Turn reached its ${limits.maxSteps}-step limit.`,
          };
          return turnResult(status, turnId, steps, failure);
        }
        steps += 1;
        const step = await this.runStep(turn);
        if (step.status === "continue") {
          continue;
        }
        status = step.turnStatus ?? step.status;
        failure = step.failure;
        return turnResult(status, turnId, steps, failure);
      }
    } catch (error: unknown) {
      status = signal.aborted ? "cancelled" : "failed";
      failure = signal.aborted ? undefined : runtimeFailure(error);
      return turnResult(status, turnId, steps, failure);
    } finally {
      this.ctx.sessions.append({
        type: "turn-ended",
        sessionId: input.sessionId,
        data: { turnId, status },
      });
    }
  }

  private async runStep(turn: TurnScope): Promise<StepOutcome> {
    const { input, turnId, signal, limits } = turn;
    const stepId = createStepId(randomUUID());
    this.ctx.sessions.append({
      type: "step-started",
      sessionId: input.sessionId,
      data: { turnId, stepId },
    });
    let outcome: StepOutcome;
    try {
      const response = await runWithModelRetries(
        signal,
        limits.maxModelRetries,
        () => requestModel(this.ctx, turn, stepId),
      );
      outcome = response.kind === "completed"
        ? await acceptResponse(this.ctx, turn, stepId, response.value)
        : response.kind === "cancelled"
          ? { status: "cancelled", stepId }
          : { status: "failed", stepId, failure: response.failure };
    } catch (error: unknown) {
      outcome = signal.aborted
        ? { status: "cancelled", stepId }
        : { status: "failed", stepId, failure: runtimeFailure(error) };
    }
    this.ctx.sessions.append({
      type: "step-ended",
      sessionId: input.sessionId,
      data: { turnId, stepId, status: outcome.status },
    });
    return outcome;
  }
}
