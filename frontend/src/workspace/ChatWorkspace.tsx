import { useLayoutEffect, useRef, useState } from "react";
import type { UIEvent } from "react";
import { Composer } from "./Composer";
import styles from "./Workspace.module.css";

type LocalMessage = { id: number; text: string };

export function ChatWorkspace(): React.JSX.Element {
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const nextId = useRef(0);
  const historyRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessages = useRef(true);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history !== null && shouldFollowMessages.current) {
      history.scrollTop = history.scrollHeight;
    }
  }, [messages]);

  function addMessage(text: string): void {
    const message = { id: nextId.current++, text };
    setMessages((current) => [...current, message]);
  }

  function updateScrollPreference(event: UIEvent<HTMLDivElement>): void {
    const history = event.currentTarget;
    const distanceFromBottom = history.scrollHeight - history.clientHeight - history.scrollTop;
    shouldFollowMessages.current = distanceFromBottom <= 80;
  }

  return (
    <section className={styles.chat} aria-label="Agent 对话工作区">
      <div className={styles.history} ref={historyRef} onScroll={updateScrollPreference}>
        {messages.length === 0 ? (
          <div className={styles.welcome}>
            <p>从一个想法开始。</p>
            <h1>今天，想探索什么？</h1>
          </div>
        ) : (
          <div className={styles.messageColumn} role="log" aria-label="本地对话记录" aria-live="polite">
            {messages.map((message) => (
              <article className={styles.message} key={message.id}>
                <p>{message.text}</p>
              </article>
            ))}
          </div>
        )}
      </div>
      <div className={styles.inputArea}>
        <Composer onSubmit={addMessage} />
      </div>
    </section>
  );
}
