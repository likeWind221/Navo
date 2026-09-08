import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createMessageId, createStepId, createTurnId } from "../brand/ids.js";
import type { StepId } from "../brand/ids.js";
import type { ErrorSource, Failure, TurnEndStatus } from "../session/types.js";
import { resolveAgentRuntimeLimits, runWithModelRetries } from "./limits.js";
import { AgentInbox } from "./inbox.js";
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
  static inject = ["sessions", "llm", "tools"];

  private readonly defaultLimits: AgentRuntimeLimits;
  private readonly inbox: AgentInbox;

  constructor(ctx: Context, limits: Partial<AgentRuntimeLimits> = {}) {
    super(ctx, "agentRuntime");
    this.defaultLimits = resolveAgentRuntimeLimits(limits);
    this.inbox = new AgentInbox();
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    return this.inbox.send(input, () => this.executeTurn(input));
  }

  /** Runs only after this Session's Actor has claimed the Turn from its Inbox. */
  private async executeTurn(input: RunTurnInput): Promise<TurnResult> {
    const limits = resolveAgentRuntimeLimits(this.defaultLimits, input.limits);
    const turnId = createTurnId(randomUUID());
    const signal = input.signal ?? new AbortController().signal;
    const scopedInput: RunTurnInput = input.toolNames === undefined
      ? input
      : { ...input, toolNames: Object.freeze([...input.toolNames]) };
    const turn: TurnScope = { input: scopedInput, turnId, signal, limits };
    let steps = 0;
    let result: TurnResult;
    this.ctx.sessions.append({
      type: "turn-started",
      sessionId: input.sessionId,
      data: { turnId },
    });
    try {
      await input.onEvent?.({ type: "turn-started", turnId });
      this.ctx.sessions.append({
        type: "user-message",
        sessionId: input.sessionId,
        data: { message: input.userMessage },
      });
      while (true) {
        if (signal.aborted) {
          result = turnResult("cancelled", turnId, steps, undefined);
          break;
        }
        if (steps >= limits.maxSteps) {
          const failure: Failure = {
            code: "max-steps-exceeded",
            message: `Turn reached its ${limits.maxSteps}-step limit.`,
          };
          this.appendError(input.sessionId, turnId, "runtime", failure);
          result = turnResult("blocked", turnId, steps, failure);
          break;
        }
        steps += 1;
        const step = await this.runStep(turn);
        if (step.status === "continue") continue;
        const failure = "failure" in step ? step.failure : undefined;
        result = turnResult(step.status, turnId, steps, failure);
        break;
      }
    } catch (error: unknown) {
      const status: TurnEndStatus = signal.aborted ? "cancelled" : "failed";
      const failure = signal.aborted ? undefined : runtimeFailure(error);
      if (failure) this.appendError(input.sessionId, turnId, "runtime", failure);
      result = turnResult(status, turnId, steps, failure);
    }
    this.ctx.sessions.append({
      type: "turn-ended",
      sessionId: input.sessionId,
      data: { turnId, status: result.status },
    });
    await input.onEvent?.({ type: "turn-finished", result });
    return result;
  }

  private async runStep(turn: TurnScope): Promise<StepOutcome> {
    const { input, turnId, signal, limits } = turn;
    const stepId = createStepId(randomUUID());
    // The assistant message id is fixed when the Step starts: the v2 stream
    // must announce it in step-started before any content arrives.
    const messageId = createMessageId(randomUUID());
    this.ctx.sessions.append({
      type: "step-started",
      sessionId: input.sessionId,
      data: { turnId, stepId },
    });
    let outcome: StepOutcome;
    try {
      await input.onEvent?.({ type: "step-started", turnId, stepId, messageId });
      const response = await runWithModelRetries(
        signal,
        limits.maxModelRetries,
        () => requestModel(this.ctx, turn, stepId, messageId),
      );
      outcome = response.kind === "completed"
        ? await acceptResponse(this.ctx, turn, stepId, response.value)
        : response.kind === "cancelled"
          ? { status: "cancelled", stepId }
          : {
              status: "failed",
              stepId,
              failure: response.failure,
              failureSource: "llm",
            };
    } catch (error: unknown) {
      outcome = signal.aborted
        ? { status: "cancelled", stepId }
        : {
            status: "failed",
            stepId,
            failure: runtimeFailure(error),
            failureSource: "runtime",
          };
    }
    if ("failure" in outcome) {
      this.appendError(
        input.sessionId,
        turnId,
        outcome.failureSource,
        outcome.failure,
        stepId,
      );
    }
    this.ctx.sessions.append({
      type: "step-ended",
      sessionId: input.sessionId,
      data: { turnId, stepId, status: outcome.status },
    });
    await input.onEvent?.({
      type: "step-completed",
      turnId,
      stepId,
      messageId,
      status: outcome.status,
    });
    return outcome;
  }

  private appendError(
    sessionId: RunTurnInput["sessionId"],
    turnId: TurnScope["turnId"],
    source: ErrorSource,
    failure: Failure,
    stepId?: StepId,
  ): void {
    this.ctx.sessions.append({
      type: "error",
      sessionId,
      data: {
        turnId,
        ...(stepId === undefined ? {} : { stepId }),
        source,
        failure,
      },
    });
  }
}
