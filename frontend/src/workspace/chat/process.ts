import type {
  AssistantContentBlock,
  AssistantConversationMessage,
  AssistantMessageStatus,
  AssistantTextBlock,
} from "./conversation.js";

export interface TurnContent {
  readonly process: readonly AssistantContentBlock[];
  readonly final: AssistantTextBlock | null;
}

export function isTurnLive(status: AssistantMessageStatus): boolean {
  return status === "waiting" || status === "streaming";
}

export function splitTurnContent(blocks: readonly AssistantContentBlock[]): TurnContent {
  const last = blocks.at(-1);
  if (last === undefined || last.kind !== "text" || last.text.trim().length === 0) {
    return { process: blocks, final: null };
  }
  return { process: blocks.slice(0, -1), final: last };
}

export function shouldFoldProcess(content: TurnContent, status: AssistantMessageStatus): boolean {
  return content.final !== null && content.process.length > 0 && !isTurnLive(status);
}

export function processSummary(message: AssistantConversationMessage): string {
  return message.endedAt === null
    ? "处理中"
    : `已处理 ${formatDuration(message.endedAt - message.startedAt)}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
