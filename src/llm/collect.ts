import type {
  FinishReason,
  StreamChunk,
  StreamContentBlock,
  TokenUsage,
} from "./types.js";
import { BlockAssembler } from "./assembler.js";

/** Complete provider-neutral facts collected from one LLM stream. */
export interface CollectedStream {
  readonly content: readonly StreamContentBlock[];
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
}

/** Folds chunks without creating messages or assigning Agent lifecycle meaning. */
export async function collectStream(
  stream: AsyncIterable<StreamChunk>,
  onChunk?: (chunk: StreamChunk) => void | Promise<void>,
): Promise<CollectedStream> {
  const assembler = new BlockAssembler();
  let finishReason: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  for await (const chunk of stream) {
    await onChunk?.(chunk);
    assembler.push(chunk);
    if (chunk.type === "finish") {
      finishReason = chunk.reason;
      break;
    }
    if (chunk.type === "usage") usage = chunk.usage;
  }
  const content = assembler.blocks(finishReason);
  return Object.freeze({
    content,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
  });
}
