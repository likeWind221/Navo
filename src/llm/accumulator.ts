import type {
  ContentBlock,
  ContentBlockType,
  FinishReason,
  ModelEvent,
  ToolCallContentBlock,
} from "./types.js";

interface PartialContent {
  readonly contentIndex: number;
  readonly contentType: ContentBlockType;
  text: string;
  toolCallId?: ToolCallContentBlock["id"];
  toolCallName: string;
  completed: boolean;
}

/** The sole owner of ModelEvent-to-ContentBlock assembly for one Step. */
export class StepAccumulator {
  private readonly partials = new Map<number, PartialContent>();
  private readonly order: number[] = [];

  push(event: ModelEvent): void {
    switch (event.type) {
      case "content-started": {
        if (this.partials.has(event.contentIndex)) {
          throw new TypeError(`Content ${event.contentIndex} started more than once.`);
        }
        const partial: PartialContent = {
          contentIndex: event.contentIndex,
          contentType: event.contentType,
          text: "",
          toolCallName: "",
          completed: false,
          ...(event.contentType === "tool-call"
            ? { toolCallId: event.toolCallId } : {}),
        };
        this.partials.set(event.contentIndex, partial);
        this.order.push(event.contentIndex);
        return;
      }
      case "content-delta": {
        const partial = this.open(event.contentIndex, event.contentType);
        if (event.contentType === "tool-call") {
          if (partial.toolCallId !== event.toolCallId) {
            throw new TypeError(`Tool-call content ${event.contentIndex} changed id.`);
          }
          partial.toolCallName += event.toolNameDelta ?? "";
        }
        partial.text += event.delta;
        return;
      }
      case "content-completed":
        this.open(event.contentIndex, event.contentType).completed = true;
        return;
      case "usage":
      case "finished":
        return;
    }
  }

  content(finishReason?: FinishReason): readonly ContentBlock[] {
    const content: ContentBlock[] = [];
    for (const contentIndex of this.order) {
      const partial = this.mustGet(contentIndex);
      if (partial.contentType === "tool-call"
        && (finishReason?.kind === "content-filter"
          || finishReason?.kind === "error" || finishReason?.kind === "cancelled")) {
        continue;
      }
      if (finishReason?.kind === "max-tokens"
        && partial.contentType === "tool-call"
        && !partial.completed) {
        continue;
      }
      if (!partial.completed && finishReason === undefined) continue;
      content.push(this.complete(partial));
    }
    return Object.freeze(content);
  }

  private open(contentIndex: number, contentType: ContentBlockType): PartialContent {
    const partial = this.mustGet(contentIndex);
    if (partial.contentType !== contentType) {
      throw new TypeError(
        `Content ${contentIndex} changed type from '${partial.contentType}' to '${contentType}'.`,
      );
    }
    if (partial.completed) throw new TypeError(`Content ${contentIndex} is already completed.`);
    return partial;
  }

  private mustGet(contentIndex: number): PartialContent {
    const partial = this.partials.get(contentIndex);
    if (partial === undefined) {
      throw new TypeError(`Content ${contentIndex} emitted data before it started.`);
    }
    return partial;
  }

  private complete(partial: PartialContent): ContentBlock {
    if (partial.contentType === "text" || partial.contentType === "reasoning") {
      return { type: partial.contentType, text: partial.text };
    }
    if (partial.toolCallId === undefined || partial.toolCallName.length === 0) {
      throw new TypeError(
        `Tool-call content ${partial.contentIndex} ended without an id or name.`,
      );
    }
    return {
      type: "tool-call",
      id: partial.toolCallId,
      name: partial.toolCallName,
      arguments: partial.text,
    };
  }
}
