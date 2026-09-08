import {
  CONTENT_DELTA_MAX_CHARS,
  CONTENT_MAX_EVENTS,
  CONTENT_MAX_CHARS,
  CONTENT_MAX_COUNT,
  CONTENT_TURN_MAX_CHARS,
} from "../../../../rpc/content.js";
import type {
  StepScope as RpcStepScope,
  TurnEvent as RpcTurnEvent,
  TurnScope as RpcTurnScope,
} from "../../../../rpc/content.js";
import type { DisplayFailure } from "../../../../rpc/failure.js";
import type { TurnEvent } from "../../../agent/types.js";
import { splitDelta, truncateDelta } from "../split.js";
import { StreamEventQueue } from "../queue.js";
import { classifyTurnTerminal } from "../terminal.js";

interface LiveContent {
  readonly index: number;
  readonly contentType: "text" | "reasoning";
  chars: number;
  open: boolean;
}

/** Applies public output budgets while forwarding internal TurnEvents. */
export class V2Output {
  private scope: RpcTurnScope;
  private currentStep: RpcStepScope | undefined;
  private readonly contents = new Map<number, LiveContent>();
  private contentCount = 0;
  private eventCount = 0;
  private turnChars = 0;
  private outputExhausted = false;
  private resourceFailure = false;
  terminated = false;

  constructor(
    private readonly events: StreamEventQueue<RpcTurnEvent>,
    sessionId: string,
    requestId: string,
  ) {
    this.scope = { sessionId, requestId, turnId: "" };
  }

  write(event: TurnEvent): boolean {
    if (this.terminated) return false;
    switch (event.type) {
      case "turn-started":
        this.scope = { ...this.scope, turnId: event.turnId };
        this.pushEvent({ ...this.scope, type: "turn-started" });
        return true;
      case "step-started":
        if (this.scope.turnId !== event.turnId) return false;
        // New Step start + completion + Turn terminal must all fit before
        // Runtime starts its model request. Throwing stops the existing loop.
        if (this.eventCount + 3 > CONTENT_MAX_EVENTS) {
          this.resourceFailure = true;
          throw new Error("Turn output event limit exceeded before starting a Step.");
        }
        this.currentStep = { ...this.scope, stepId: event.stepId, messageId: event.messageId };
        this.contents.clear();
        this.pushEvent({ ...this.currentStep, type: "step-started" });
        return true;
      case "content-started":
        return this.startContent(event);
      case "content-delta":
        return this.writeDelta(event);
      case "content-completed":
        return this.completeContent(event.stepId, event.contentIndex);
      case "step-completed":
        if (this.currentStep?.stepId !== event.stepId) return false;
        this.closeStep();
        return true;
      case "turn-finished":
        if (this.terminated) return false;
        this.terminated = true;
        this.closeStep();
        this.pushEvent(this.terminalEvent(event.result));
        return true;
    }
  }

  fail(): void {
    if (this.terminated) return;
    this.terminated = true;
    this.closeStep();
    this.pushEvent({
      ...this.scope,
      turnId: this.scope.turnId || "unknown",
      type: "turn-failed",
      failure: {
        code: "runtime-failed",
        message: "Agent runtime failed.",
      } satisfies DisplayFailure,
    });
  }

  private startContent(
    event: Extract<TurnEvent, { readonly type: "content-started" }>,
  ): boolean {
    if (this.currentStep?.stepId !== event.stepId
      || this.outputExhausted
      || event.contentType === "tool-call"
      || this.contentCount >= CONTENT_MAX_COUNT
      || this.eventCount + this.openContentCount() + 4 > CONTENT_MAX_EVENTS) {
      if (this.eventCount + this.openContentCount() + 4 > CONTENT_MAX_EVENTS) {
        this.outputExhausted = true;
      }
      return false;
    }
    const content: LiveContent = {
      index: event.contentIndex,
      contentType: event.contentType,
      chars: 0,
      open: true,
    };
    this.contentCount += 1;
    this.contents.set(event.contentIndex, content);
    this.pushEvent({
      ...this.currentStep,
      contentIndex: event.contentIndex,
      type: "content-started",
      kind: event.contentType,
    });
    return true;
  }

  private writeDelta(
    event: Extract<TurnEvent, { readonly type: "content-delta" }>,
  ): boolean {
    if (this.currentStep?.stepId !== event.stepId
      || this.outputExhausted
      || event.contentType === "tool-call") {
      return false;
    }
    const content = this.contents.get(event.contentIndex);
    if (content === undefined || !content.open || content.contentType !== event.contentType) {
      return false;
    }
    const eventsBefore = this.eventCount;
    let payload = event.delta;
    const remaining = Math.min(
      CONTENT_MAX_CHARS - content.chars,
      CONTENT_TURN_MAX_CHARS - this.turnChars,
    );
    payload = truncateDelta(payload, Math.max(0, remaining));
    if (payload.length > 0) {
      for (const part of splitDelta(payload, CONTENT_DELTA_MAX_CHARS)) {
        if (this.eventCount + this.openContentCount() + 3 > CONTENT_MAX_EVENTS) {
          this.outputExhausted = true;
          break;
        }
        content.chars += part.length;
        this.turnChars += part.length;
        this.pushEvent({
          ...this.currentStep,
          contentIndex: event.contentIndex,
          type: "content-delta",
          delta: part,
        });
      }
    }
    if (this.outputExhausted || payload.length < event.delta.length
      || content.chars >= CONTENT_MAX_CHARS) {
      this.completeContent(event.stepId, event.contentIndex);
    }
    if (this.turnChars >= CONTENT_TURN_MAX_CHARS) {
      this.outputExhausted = true;
    }
    return this.eventCount > eventsBefore;
  }

  private completeContent(stepId: string, contentIndex: number): boolean {
    if (this.currentStep?.stepId !== stepId) return false;
    const content = this.contents.get(contentIndex);
    if (content === undefined || !content.open) return false;
    content.open = false;
    this.pushEvent({
      ...this.currentStep,
      contentIndex,
      type: "content-completed",
    });
    return true;
  }

  private closeOpenContent(): void {
    if (this.currentStep === undefined) return;
    for (const content of this.contents.values()) {
      if (content.open) this.completeContent(this.currentStep.stepId, content.index);
    }
  }

  private closeStep(): void {
    if (this.currentStep === undefined) return;
    this.closeOpenContent();
    this.pushEvent({ ...this.currentStep, type: "step-completed" });
    this.currentStep = undefined;
    this.contents.clear();
  }

  private openContentCount(): number {
    let count = 0;
    for (const content of this.contents.values()) {
      if (content.open) count += 1;
    }
    return count;
  }

  private pushEvent(event: RpcTurnEvent): void {
    this.eventCount += 1;
    this.events.push(event);
  }

  private terminalEvent(result: Extract<TurnEvent, { type: "turn-finished" }>["result"]): RpcTurnEvent {
    const scope = { ...this.scope, turnId: this.scope.turnId || "unknown" };
    const terminal = classifyTurnTerminal(result);
    if (terminal === "cancelled") return { ...scope, type: "turn-cancelled" };
    if (this.resourceFailure) return { ...scope, type: "turn-failed", failure: {
      code: "resource-limit-exceeded",
      message: "Turn output event limit exceeded before starting a Step.",
    } };
    if (terminal === "completed") return { ...scope, type: "turn-completed" };
    if (terminal === "truncated") return { ...scope, type: "turn-truncated" };
    const failure: DisplayFailure = "failure" in result
      ? { code: result.failure.code, message: result.failure.message }
      : { code: "runtime-failed", message: "Agent runtime failed." };
    return { ...scope, type: "turn-failed", failure };
  }
}
