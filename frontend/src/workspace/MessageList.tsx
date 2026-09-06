import type { ConversationMessage } from "./conversation-state.js";
import styles from "./Workspace.module.css";

export function MessageList({ messages }: {
  readonly messages: readonly ConversationMessage[];
}): React.JSX.Element {
  if (messages.length === 0) {
    return (
      <div className={styles.welcome}>
        <p>从一个想法开始。</p>
        <h1>今天，想探索什么？</h1>
      </div>
    );
  }

  return (
    <div className={styles.messageColumn} role="log" aria-label="对话记录" aria-live="polite">
      {messages.map((message) => <Message key={message.id} message={message} />)}
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
      {message.text.length > 0 && (
        <p>{message.text}{message.status === "streaming" && (
          <span className={styles.streamCursor} aria-hidden="true" />
        )}</p>
      )}
      {statusText !== null && (
        <div className={styles.messageStatus} role={message.status === "failed" ? "alert" : "status"}>
          {message.status === "waiting" && <span className={styles.waitingDot} aria-hidden="true" />}
          {statusText}
        </div>
      )}
    </article>
  );
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
