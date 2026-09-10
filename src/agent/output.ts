import {
  CONTENT_DELTA_MAX_CHARS, CONTENT_MAX_EVENTS, CONTENT_MAX_CHARS,
  CONTENT_MAX_COUNT, CONTENT_TURN_MAX_CHARS, DISPLAY_SUMMARY_MAX_CHARS,
  TOOL_DETAIL_MAX_CHARS,
} from "../../shared/content.js";
import type { StepScope, TurnEvent, TurnScope } from "../../shared/content.js";
import type { ModelEvent } from "../llm/types.js";
import type { Failure } from "../session/types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { RunTurnInput, TurnResult } from "./types.js";
import { splitDelta, truncateDelta } from "./output/split.js";

export class TurnOutput {
  private step: StepScope | undefined;
  private readonly contents = new Map<number, LiveContent>();
  private readonly tools = new Map<string, LiveContent>();
  private contentCount = 0;
  private eventCount = 0;
  private reservedEvents = 0;
  private chars = 0;
  private reservedChars = 0;
  private exhausted = false;
  private resourceFailure = false;
  private terminated = false;

  constructor(
    private readonly scope: TurnScope,
    private readonly onEvent?: RunTurnInput["onEvent"],
  ) {}

  async start(): Promise<void> {
    await this.emit({ ...this.scope, type: "turn-started" });
  }

  async startStep(stepId: string, messageId: string): Promise<void> {
    if (this.eventCount + 3 > CONTENT_MAX_EVENTS) {
      this.resourceFailure = true;
      throw new Error("Turn output event limit exceeded before starting a Step.");
    }
    this.step = { ...this.scope, stepId, messageId };
    this.contents.clear();
    this.tools.clear();
    await this.emit({ ...this.step, type: "step-started" });
  }

  beginAttempt(): void {
    this.contents.clear();
    this.tools.clear();
    this.reservedEvents = 0;
    this.reservedChars = 0;
  }

  async model(event: ModelEvent): Promise<boolean> {
    if (this.terminated || this.step === undefined) return false;
    switch (event.type) {
      case "content-started":
        if (this.exhausted || this.contentCount >= CONTENT_MAX_COUNT) return false;
        if (this.eventCount + this.reservedEvents + this.openCount() + 4 > CONTENT_MAX_EVENTS) {
          this.exhausted = true;
          return false;
        }
        this.contentCount++;
        const content: LiveContent = {
          index: event.contentIndex,
          kind: event.contentType,
          chars: 0,
          open: true,
          published: event.contentType !== "tool-call",
          toolCallId: event.contentType === "tool-call" ? event.toolCallId : undefined,
          toolName: "",
          arguments: "",
          execution: "pending",
        };
        this.contents.set(event.contentIndex, content);
        if (event.contentType === "tool-call") {
          if (!this.tools.has(event.toolCallId)) this.tools.set(event.toolCallId, content);
          return false;
        }
        return this.emit({ ...this.step, type: "content-started",
          contentIndex: event.contentIndex, kind: event.contentType });
      case "content-delta":
        if (event.contentType === "tool-call") {
          const content = this.contents.get(event.contentIndex);
          if (content?.kind !== "tool-call" || !content.open
            || content.toolCallId !== event.toolCallId) return false;
          content.toolName += event.toolNameDelta ?? "";
          content.arguments += event.delta;
          return false;
        }
        return this.delta(event.contentIndex, event.delta);
      case "content-completed":
        if (event.contentType === "tool-call") {
          const content = this.contents.get(event.contentIndex);
          if (content?.kind !== "tool-call" || !content.open) return false;
          content.open = false;
          return false;
        }
        return this.completeContent(event.contentIndex);
      case "usage":
        return false;
      case "finished":
        if (event.reason.kind === "content-filter" || event.reason.kind === "error"
          || event.reason.kind === "cancelled") return false;
        return this.publishTools();
    }
  }

  async toolStarted(toolCallId: string): Promise<boolean> {
    const content = this.tools.get(toolCallId);
    if (this.step === undefined || !content?.published || content.execution !== "pending") {
      return false;
    }
    content.execution = "running";
    this.reservedEvents--;
    return this.emit({ ...this.step, contentIndex: content.index,
      type: "tool-started", toolCallId });
  }

  async toolResult(result: ToolExecutionResult): Promise<boolean> {
    const text = result.block.content
      .filter(block => block.type === "text" || block.type === "reasoning")
      .map(block => block.text)
      .join("\n");
    if (result.kind === "success") {
      return this.settleTool(result.block.toolCallId, "succeeded", text || "Completed.");
    }
    const status = result.failure.code === "cancelled" ? "cancelled" : "failed";
    return this.settleTool(result.block.toolCallId, status, text || "Tool execution failed.", {
      code: result.failure.code,
      message: text || "Tool execution failed.",
    });
  }

  async rejectTool(toolCallId: string, failure: Failure): Promise<boolean> {
    return this.settleTool(toolCallId, "failed", failure.message, failure);
  }

  async endStep(): Promise<void> {
    if (this.step === undefined) return;
    for (const index of this.contents.keys()) await this.completeContent(index);
    const step = this.step;
    if ([...this.contents.values()].some(content => content.published
      && content.kind === "tool-call" && content.execution !== "settled")) return;
    this.step = undefined;
    this.contents.clear();
    this.tools.clear();
    await this.emit({ ...step, type: "step-completed" });
  }

  async finish(result: TurnResult): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    await this.endStep();
    if (result.status === "cancelled") {
      await this.emit({ ...this.scope, type: "turn-cancelled" });
    } else if (this.resourceFailure) {
      await this.emit({ ...this.scope, type: "turn-failed", failure: {
        code: "resource-limit-exceeded",
        message: "Turn output event limit exceeded before starting a Step.",
      } });
    } else if (result.status === "completed") {
      await this.emit({ ...this.scope, type: "turn-completed" });
    } else if (result.status === "blocked" && result.failure.code === "max-tokens") {
      await this.emit({ ...this.scope, type: "turn-truncated" });
    } else {
      await this.emit({ ...this.scope, type: "turn-failed", failure: {
        code: truncateDelta(result.failure.code, 128) || "runtime-failed",
        message: truncateDelta(result.failure.message, DISPLAY_SUMMARY_MAX_CHARS)
          || "Agent runtime failed.",
      } });
    }
  }

  private async delta(index: number, value: string): Promise<boolean> {
    const content = this.contents.get(index);
    if (this.step === undefined || this.exhausted || !content?.open) return false;
    const remaining = Math.min(CONTENT_MAX_CHARS - content.chars,
      CONTENT_TURN_MAX_CHARS - this.chars - this.reservedChars);
    const payload = truncateDelta(value, Math.max(0, remaining));
    let published = false;
    if (payload.length > 0) {
      for (const part of splitDelta(payload, CONTENT_DELTA_MAX_CHARS)) {
        if (this.eventCount + this.reservedEvents + this.openCount() + 3 > CONTENT_MAX_EVENTS) {
          this.exhausted = true;
          break;
        }
        content.chars += part.length;
        this.chars += part.length;
        const visible = await this.emit({ ...this.step, contentIndex: index,
          type: "content-delta", delta: part });
        published = visible || published;
      }
    }
    if (this.exhausted || payload.length < value.length || content.chars >= CONTENT_MAX_CHARS) {
      const visible = await this.completeContent(index);
      published = visible || published;
    }
    if (this.chars >= CONTENT_TURN_MAX_CHARS) this.exhausted = true;
    return published;
  }

  private async completeContent(index: number): Promise<boolean> {
    const content = this.contents.get(index);
    if (this.step === undefined || !content?.open) return false;
    content.open = false;
    if (!content.published) return false;
    return this.emit({ ...this.step, contentIndex: index, type: "content-completed" });
  }

  private async publishTools(): Promise<boolean> {
    let published = false;
    for (const content of this.contents.values()) {
      if (content.kind !== "tool-call" || content.open || content.published
        || content.toolName.length === 0 || this.tools.get(content.toolCallId ?? "") !== content) {
        continue;
      }
      const visible = await this.publishTool(content);
      published = visible || published;
    }
    return published;
  }

  private async publishTool(content: LiveContent): Promise<boolean> {
    if (this.step === undefined || content.toolCallId === undefined) return false;
    const remaining = Math.min(CONTENT_MAX_CHARS,
      CONTENT_TURN_MAX_CHARS - this.chars - this.reservedChars - 1);
    const payload = truncateDelta(content.arguments, Math.max(0, remaining));
    const parts = payload.length === 0 ? [] : splitDelta(payload, CONTENT_DELTA_MAX_CHARS);
    const required = parts.length + 2;
    if (this.eventCount + this.reservedEvents + this.openCount() + required + 4
      > CONTENT_MAX_EVENTS || remaining < 0) {
      this.exhausted = true;
      return false;
    }
    content.published = true;
    content.chars = payload.length;
    this.chars += payload.length;
    this.reservedEvents += 2;
    this.reservedChars += 1;
    let published = await this.emit({ ...this.step, contentIndex: content.index,
      type: "content-started", kind: "tool-call", toolCallId: content.toolCallId,
      toolName: truncateDelta(content.toolName, 128) });
    for (const delta of parts) {
      const visible = await this.emit({ ...this.step, contentIndex: content.index,
        type: "content-delta", delta });
      published = visible || published;
    }
    const visible = await this.emit({ ...this.step, contentIndex: content.index,
      type: "content-completed" });
    return visible || published;
  }

  private async settleTool(
    toolCallId: string,
    status: "succeeded" | "failed" | "cancelled",
    text: string,
    failure?: Failure,
  ): Promise<boolean> {
    const content = this.tools.get(toolCallId);
    if (this.step === undefined || !content?.published || content.execution === "settled") {
      return false;
    }
    const reserved = content.execution === "running" ? 1 : 2;
    this.reservedEvents -= reserved;
    this.reservedChars--;
    content.execution = "settled";
    const available = Math.max(1,
      CONTENT_TURN_MAX_CHARS - this.chars - this.reservedChars);
    const summary = truncateDelta(text || "Result.", Math.min(DISPLAY_SUMMARY_MAX_CHARS, available));
    const detail = truncateDelta(text, Math.min(TOOL_DETAIL_MAX_CHARS, available - summary.length));
    this.chars += summary.length + detail.length;
    const scope = { ...this.step, contentIndex: content.index,
      type: "tool-result" as const, toolCallId, summary, detail };
    if (status === "succeeded") return this.emit({ ...scope, status });
    return this.emit({ ...scope, status, failure: {
      code: truncateDelta(failure?.code ?? "tool-failed", 128) || "tool-failed",
      message: truncateDelta(failure?.message ?? summary, DISPLAY_SUMMARY_MAX_CHARS)
        || "Tool execution failed.",
    } });
  }

  private openCount(): number {
    return [...this.contents.values()].filter(content => content.open).length;
  }

  private async emit(event: TurnEvent): Promise<boolean> {
    if (this.onEvent === undefined) return false;
    this.eventCount++;
    return await this.onEvent(event) !== false;
  }
}

interface LiveContent {
  readonly index: number;
  readonly kind: "text" | "reasoning" | "tool-call";
  chars: number;
  open: boolean;
  published: boolean;
  readonly toolCallId: string | undefined;
  toolName: string;
  arguments: string;
  execution: "pending" | "running" | "settled";
}
