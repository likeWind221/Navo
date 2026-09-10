import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createMessageId, createStepId, createTurnId } from "../brand/ids.js";
import type { SessionId, StepId, TurnId } from "../brand/ids.js";
import type { CommandAnchor } from "../../shared/content.js";
import type { ErrorSource, Failure, TurnEndStatus } from "../session/types.js";
import { resolveAgentRuntimeLimits, runWithModelRetries } from "./limits.js";
import { AgentInbox } from "./inbox.js";
import { TurnOutput } from "./output.js";
import { requestModel } from "./request.js";
import { acceptResponse } from "./response.js";
import { runtimeFailure, turnResult } from "./result.js";
import type { StepOutcome } from "./result.js";
import type {
  AgentRuntimeLimits,
  ResolvedRunTurnInput,
  RunTurnInput,
  TurnResult,
  TurnScope,
} from "./types.js";

declare module "cordis" {
  interface Context {
    agentRuntime: AgentRuntime;
  }
}

export class AgentRuntime extends Service {
  static inject = ["sessions", "llm", "tools"];

  private readonly defaultLimits: AgentRuntimeLimits;
  private readonly inbox: AgentInbox;
  private readonly turns = new Map<SessionId, TurnState>();

  constructor(ctx: Context, limits: Partial<AgentRuntimeLimits> = {}) {
    super(ctx, "agentRuntime");
    this.defaultLimits = resolveAgentRuntimeLimits(limits);
    this.inbox = new AgentInbox();
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    return this.inbox.send(input, () => this.executeTurn(input));
  }

  enqueueCommand(
    sessionId: SessionId,
    handle: () => Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.inbox.sendCommand(sessionId, handle, signal);
  }

  commandAnchor(sessionId: SessionId): CommandAnchor {
    const state = this.turns.get(sessionId);
    if (state?.activeTurnId !== undefined) return { kind: "turn", turnId: state.activeTurnId };
    if (state?.lastTurnId !== undefined) return { kind: "turn", turnId: state.lastTurnId };
    return { kind: "session" };
  }

  private async executeTurn(input: RunTurnInput): Promise<TurnResult> {
    const limits = resolveAgentRuntimeLimits(this.defaultLimits, input.limits);
    const turnId = createTurnId(randomUUID());
    const signal = input.signal ?? new AbortController().signal;
    const scopedInput: ResolvedRunTurnInput = {
      ...input,
      toolNames: Object.freeze([...(input.toolNames ?? [])]),
    };
    const output = new TurnOutput({
      sessionId: input.sessionId,
      requestId: input.requestId ?? input.userMessage.id,
      turnId,
    }, input.onEvent);
    const turn: TurnScope = { input: scopedInput, output, turnId, signal, limits };
    let steps = 0;
    let result: TurnResult;
    this.beginTurn(input.sessionId, turnId);
    try {
      this.ctx.sessions.append({
        type: "turn-started",
        sessionId: input.sessionId,
        data: { turnId },
      });
      try {
        await output.start();
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
      await output.finish(result);
      return result;
    } finally {
      this.endTurn(input.sessionId, turnId);
    }
  }

  private beginTurn(sessionId: SessionId, turnId: TurnId): void {
    const state = this.turns.get(sessionId) ?? { activeTurnId: undefined, lastTurnId: undefined };
    state.activeTurnId = turnId;
    this.turns.set(sessionId, state);
  }

  private endTurn(sessionId: SessionId, turnId: TurnId): void {
    const state = this.turns.get(sessionId);
    if (!state || state.activeTurnId !== turnId) return;
    state.activeTurnId = undefined;
    state.lastTurnId = turnId;
  }

  private async runStep(turn: TurnScope): Promise<StepOutcome> {
    const { input, turnId, signal, limits } = turn;
    const stepId = createStepId(randomUUID());
    const messageId = createMessageId(randomUUID());
    this.ctx.sessions.append({
      type: "step-started",
      sessionId: input.sessionId,
      data: { turnId, stepId },
    });
    let outcome: StepOutcome;
    try {
      await turn.output.startStep(stepId, messageId);
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
    await turn.output.endStep();
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

interface TurnState {
  activeTurnId: TurnId | undefined;
  lastTurnId: TurnId | undefined;
}
