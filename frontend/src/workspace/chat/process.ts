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

export function processSummary(message: AssistantConversationMessage, now = message.endedAt ?? Date.now()): string {
  const endedAt = message.endedAt ?? now;
  const prefix = message.endedAt === null ? "处理中" : "已处理";
  return `${prefix} ${formatDuration(endedAt - message.startedAt)}`;
}

export function reasoningSummary(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim().replace(/^#{1,6}\s*/, "");
  if (compact.length === 0) return "思考过程";
  const sentence = compact.match(/^.+?[。！？.!?](?:\s|$)/)?.[0] ?? compact;
  return truncateLabel(sentence.trim(), 36);
}

export function toolProcessLabel(toolName: string): string {
  const name = toolName.trim();
  if (name.toLowerCase() === "shell") return "执行 Shell";
  return `执行 ${name || "工具"}`;
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function truncateLabel(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
