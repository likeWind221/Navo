import type {
  ContentBlock,
  ContentBlockType,
  FinishReason,
  ModelEvent,
  ReplayEnvelope,
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
  private replayEnvelope: ReplayEnvelope | undefined;

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
        return;
      case "finished":
        this.replayEnvelope = event.replay;
        return;
    }
  }

  replay(finishReason?: FinishReason): ReplayEnvelope | undefined {
    if (this.replayEnvelope === undefined
      || finishReason?.kind === "error"
      || finishReason?.kind === "cancelled") return undefined;
    const included = this.includedContentIndices(finishReason);
    const indexMap = new Map(included.map((index, position) => [index, position]));
    const items = this.replayEnvelope.items.flatMap((item) => {
      if (item.contentIndex === null) return [item];
      const contentIndex = indexMap.get(item.contentIndex);
      return contentIndex === undefined ? [] : [{ ...item, contentIndex }];
    });
    return { ...this.replayEnvelope, items: Object.freeze(items) };
  }

  content(finishReason?: FinishReason): readonly ContentBlock[] {
    const content: ContentBlock[] = [];
    for (const contentIndex of this.includedContentIndices(finishReason)) {
      const partial = this.mustGet(contentIndex);
      content.push(this.complete(partial));
    }
    return Object.freeze(content);
  }

  private includedContentIndices(finishReason?: FinishReason): readonly number[] {
    return this.order.filter((contentIndex) => {
      const partial = this.mustGet(contentIndex);
      if (partial.contentType === "tool-call"
        && (finishReason?.kind === "content-filter"
          || finishReason?.kind === "error" || finishReason?.kind === "cancelled")) {
        return false;
      }
      if (finishReason?.kind === "max-tokens"
        && partial.contentType === "tool-call" && !partial.completed) return false;
      return partial.completed || finishReason !== undefined;
    });
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
