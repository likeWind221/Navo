import type {
  ContentBlock,
  FinishReason,
  ModelEvent,
  ReplayEnvelope,
  TokenUsage,
} from "./types.js";
import { StepAccumulator } from "./accumulator.js";

/** Complete provider-neutral facts collected from one LLM stream. */
export interface CollectedStream {
  readonly content: readonly ContentBlock[];
  readonly finishReason?: FinishReason;
  readonly usage?: TokenUsage;
  readonly replay?: ReplayEnvelope;
}

/** Folds chunks without creating messages or assigning Agent lifecycle meaning. */
export async function collectStream(
  stream: AsyncIterable<ModelEvent>,
  onEvent?: (event: ModelEvent) => void | Promise<void>,
): Promise<CollectedStream> {
  const accumulator = new StepAccumulator();
  let finishReason: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  let replay: ReplayEnvelope | undefined;
  for await (const event of stream) {
    accumulator.push(event);
    await onEvent?.(event);
    if (event.type === "finished") {
      finishReason = event.reason;
      replay = accumulator.replay(finishReason);
      break;
    }
    if (event.type === "usage") usage = event.usage;
  }
  const content = accumulator.content(finishReason);
  return Object.freeze({
    content,
    ...(finishReason === undefined ? {} : { finishReason }),
    ...(usage === undefined ? {} : { usage }),
    ...(replay === undefined ? {} : { replay }),
  });
}
