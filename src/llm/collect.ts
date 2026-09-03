import type {
  FinishReason,
  StreamChunk,
  StreamContentBlock,
  TokenUsage,
} from "./types.js";

/** Complete provider-neutral facts collected from one LLM stream. */
export interface CollectedStream {
  readonly content: readonly StreamContentBlock[];
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
}

/** Folds chunks without creating messages or assigning Agent lifecycle meaning. */
export async function collectStream(
  stream: AsyncIterable<StreamChunk>,
): Promise<CollectedStream> {
  const content: StreamContentBlock[] = [];
  let finishReason: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  for await (const chunk of stream) {
    if (chunk.type === "block-end") content.push(chunk.block);
    if (chunk.type === "finish") finishReason = chunk.reason;
    if (chunk.type === "usage") usage = chunk.usage;
  }
  return Object.freeze({
    content: Object.freeze(content),
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
  });
}
