import type { Message, MessageContent } from "../../llm/types.js";
import { estimateMessage } from "../meter.js";
import type { SurfaceSnapshotEntry } from "../../session/store.js";

export interface CompactionSelection {
  readonly coveredEntries: readonly SurfaceSnapshotEntry[];
  readonly messages: readonly Message[];
  readonly coveredStart: number;
  readonly coveredEnd: number;
  readonly estimatedTokens: number;
  readonly retainedTokens: number;
}

export function selectCompactablePrefix(
  entries: readonly SurfaceSnapshotEntry[],
  retainTokens: number,
  maxPrefixTokens: number,
  minimumSavingsTokens: number,
): CompactionSelection | undefined {
  if (entries.length < 3 || maxPrefixTokens <= 0) return undefined;

  const costs = entries.map(entry => entry.message === undefined ? 0 : estimateMessage(entry.message));
  let retainedTokens = 0;
  let keepFrom = entries.length;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    retainedTokens += costs[index]!;
    keepFrom = index;
    if (retainedTokens >= retainTokens) break;
  }

  const maxEnd = keepFrom - 1;
  if (maxEnd < 1) return undefined;

  const unresolved = new Set<string>();
  let estimatedTokens = 0;
  let bestEnd = -1;
  for (let index = 0; index <= maxEnd; index += 1) {
    estimatedTokens += costs[index]!;
    if (estimatedTokens > maxPrefixTokens) break;
    const message = entries[index]!.message;
    if (message !== undefined) updateToolPairs(unresolved, message.content);
    if (index >= 1 && unresolved.size === 0 && estimatedTokens >= minimumSavingsTokens) {
      bestEnd = index;
    }
  }
  if (bestEnd < 1) return undefined;

  const coveredEntries = Object.freeze(entries.slice(0, bestEnd + 1));
  const messages = Object.freeze(coveredEntries.flatMap(entry => entry.message === undefined ? [] : [entry.message]));
  const selectedTokens = costs.slice(0, bestEnd + 1).reduce((sum, tokens) => sum + tokens, 0);
  if (selectedTokens < minimumSavingsTokens) return undefined;
  return Object.freeze({
    coveredEntries,
    messages,
    coveredStart: coveredEntries[0]!.sequence,
    coveredEnd: coveredEntries[coveredEntries.length - 1]!.sequence,
    estimatedTokens: selectedTokens,
    retainedTokens: costs.slice(bestEnd + 1).reduce((sum, tokens) => sum + tokens, 0),
  });
}

function updateToolPairs(unresolved: Set<string>, content: readonly MessageContent[]): void {
  for (const block of content) {
    if (block.type === "tool-call") unresolved.add(block.id);
    else if (block.type === "tool-result") unresolved.delete(block.toolCallId);
  }
}
