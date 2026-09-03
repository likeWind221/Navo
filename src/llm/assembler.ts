import type {
  FinishReason,
  StreamChunk,
  StreamContentBlock,
  StreamContentBlockType,
  ToolCallContentBlock,
} from "./types.js";

interface PartialBlock {
  readonly index: number;
  type: StreamContentBlockType;
  text: string;
  toolCallId?: ToolCallContentBlock["id"];
  toolCallName?: string;
  completed?: StreamContentBlock;
}

/** Canonical delta-to-block assembly shared by every provider adapter. */
export class BlockAssembler {
  private readonly partials = new Map<number, PartialBlock>();
  private readonly order: number[] = [];

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "block-start":
        this.ensure(chunk.index, chunk.blockType);
        return;
      case "text-delta":
      case "reasoning-delta": {
        const type = chunk.type === "text-delta" ? "text" : "reasoning";
        const partial = this.ensure(chunk.index, type);
        if (!partial.completed) partial.text += chunk.text;
        return;
      }
      case "tool-call-delta": {
        const partial = this.ensure(chunk.index, "tool-call");
        if (partial.completed) return;
        partial.toolCallId = chunk.id;
        if (chunk.name !== undefined) partial.toolCallName = chunk.name;
        partial.text += chunk.argumentsDelta;
        return;
      }
      case "block-end": {
        const partial = this.ensure(chunk.index, chunk.block.type);
        if (!partial.completed) partial.completed = chunk.block;
        return;
      }
      case "usage":
      case "finish":
        return;
    }
  }

  blocks(finishReason?: FinishReason): readonly StreamContentBlock[] {
    const blocks: StreamContentBlock[] = [];
    for (const index of this.order) {
      const partial = this.mustGet(index);
      if (finishReason?.kind === "content-filter" && partial.type === "tool-call") {
        continue;
      }
      if (finishReason?.kind === "max-tokens"
        && partial.type === "tool-call"
        && partial.completed === undefined) {
        continue;
      }
      const block = this.assemble(partial, finishReason !== undefined);
      if (block) blocks.push(block);
    }
    return Object.freeze(blocks);
  }

  private ensure(index: number, type: StreamContentBlockType): PartialBlock {
    const existing = this.partials.get(index);
    if (existing) {
      if (existing.type !== type) {
        throw new TypeError(
          `Stream block ${index} changed type from '${existing.type}' to '${type}'.`,
        );
      }
      return existing;
    }
    const partial: PartialBlock = { index, type, text: "" };
    this.partials.set(index, partial);
    this.order.push(index);
    return partial;
  }

  private mustGet(index: number): PartialBlock {
    const partial = this.partials.get(index);
    if (!partial) throw new Error(`Missing stream block ${index}.`);
    return partial;
  }

  private assemble(
    partial: PartialBlock,
    mayFinalizeDelta: boolean,
  ): StreamContentBlock | undefined {
    if (partial.completed) return partial.completed;
    if (!mayFinalizeDelta) return undefined;
    switch (partial.type) {
      case "text":
      case "reasoning":
        return { type: partial.type, text: partial.text };
      case "tool-call":
        if (!partial.toolCallId || !partial.toolCallName) {
          throw new TypeError(`Tool-call block ${partial.index} ended without an id or name.`);
        }
        return {
          type: "tool-call",
          id: partial.toolCallId,
          name: partial.toolCallName,
          arguments: partial.text,
        };
    }
  }
}
