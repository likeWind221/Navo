import type {
  AssistantConversationMessage,
  CommandConversationMessage,
  ConversationMessage,
  ConversationTimelineEntry,
} from "./conversation.js";
import { isTurnLive, shouldFoldProcess, splitTurnContent } from "./process.js";
import { ProcessRow } from "./process/Row.js";
import styles from "../style.module.css";
import { Markdown } from "./Markdown.js";

export function MessageList({ messages, commands = [], timeline }: {
  readonly messages: readonly ConversationMessage[];
  readonly commands?: readonly CommandConversationMessage[];
  readonly timeline?: readonly ConversationTimelineEntry[];
}): React.JSX.Element {
  if (messages.length === 0 && commands.length === 0) {
    return (
      <div className={styles.welcome}>
        <p>从一个想法开始。</p>
        <h1>今天，想探索什么？</h1>
      </div>
    );
  }

  return (
    <div className={styles.messageColumn} role="log" aria-label="对话记录" aria-live="polite">
      {timeline === undefined
        ? <>
            {messages.map((message) => <Message key={message.id} message={message} />)}
            {commands.map((command) => <CommandMessage key={command.id} command={command} />)}
          </>
        : timeline.map((entry) => renderTimelineEntry(entry, messages, commands))}
    </div>
  );
}

function Message({ message }: { readonly message: ConversationMessage }): React.JSX.Element {
  if (message.role === "user") {
    return (
      <article className={`${styles.message} ${styles.userMessage}`} aria-label="你的消息">
        <p>{message.text}</p>
      </article>
    );
  }

  const isStreaming = message.status === "waiting" || message.status === "streaming";
  const statusText = assistantStatusText(message);
  return (
    <article className={`${styles.message} ${styles.assistantMessage}`}
      aria-label="Agent 回复" aria-busy={isStreaming}>
      {message.blocks === undefined
        ? <LegacyAssistantText message={message} />
        : <AssistantBlocks message={message} />}
      {statusText !== null && (
        <div className={styles.messageStatus} role={message.status === "failed" ? "alert" : "status"}>
          {message.status === "waiting" && <span className={styles.waitingDot} aria-hidden="true" />}
          {statusText}
        </div>
      )}
    </article>
  );
}

function AssistantBlocks({ message }: {
  readonly message: AssistantConversationMessage;
}): React.JSX.Element {
  const blocks = message.blocks ?? [];
  const content = splitTurnContent(blocks);
  const live = isTurnLive(message.status);
  const folded = shouldFoldProcess(content, message.status);
  return (
    <div className={styles.contentBlocks}>
      {content.process.length > 0 && (
        <ProcessRow blocks={content.process} folded={folded} message={message} />
      )}
      {content.final !== null && (
        <div className={styles.textBlock}>
          <Markdown text={content.final.text} streaming={live} />
          {live && <span className={styles.streamCursor} aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}

function renderTimelineEntry(
  entry: ConversationTimelineEntry,
  messages: readonly ConversationMessage[],
  commands: readonly CommandConversationMessage[],
): React.JSX.Element | null {
  if (entry.kind === "message") {
    const message = messages.find((item) => item.id === entry.id);
    return message === undefined ? null : <Message key={message.id} message={message} />;
  }
  const command = commands.find((item) => item.id === entry.id);
  return command === undefined ? null : <CommandMessage key={command.id} command={command} />;
}

function LegacyAssistantText({ message }: { readonly message: AssistantConversationMessage }): React.JSX.Element | null {
  if (message.text.length === 0) return null;
  return (
    <div><Markdown text={message.text} streaming={message.status === "streaming" || message.status === "waiting"} />{message.status === "streaming" && (
      <span className={styles.streamCursor} aria-hidden="true" />
    )}</div>
  );
}

function CommandMessage({ command }: { readonly command: CommandConversationMessage }): React.JSX.Element {
  const statusText = commandStatusText(command.status);
  const isRunning = command.status === "running";
  return (
    <article className={`${styles.message} ${styles.commandMessage}`}
      aria-label={`\u7cfb\u7edf\u63d0\u793a ${command.name}`} aria-busy={isRunning}>
      <div className={styles.commandHeader}>
        <span className={styles.commandLabel}>{"\u7cfb\u7edf\u63d0\u793a"}</span>
        <strong className={styles.commandName}>/{command.name}</strong>
        <span className={styles.commandStatus} data-status={command.status} role="status">{statusText}</span>
      </div>
      {command.summary.length > 0 && <p className={styles.commandSummary}>{command.summary}</p>}
      {command.failure !== null && <p className={styles.commandFailure}>{command.failure.message}</p>}
    </article>
  );
}

function commandStatusText(status: CommandConversationMessage["status"]): string {
  if (status === "running") return "\u6267\u884c\u4e2d";
  if (status === "succeeded") return "\u5df2\u5b8c\u6210";
  if (status === "failed") return "\u5931\u8d25";
  return "\u5df2\u53d6\u6d88";
}

function assistantStatusText(
  message: Extract<ConversationMessage, { readonly role: "assistant" }>,
): string | null {
  if (message.status === "waiting") return "正在等待 Agent…";
  if (message.status === "cancelled") return "已停止生成";
  if (message.status === "truncated") return "回答已达到长度上限";
  if (message.status === "failed") return message.failure?.message ?? "Agent 请求失败";
  return null;
}
