import { useLayoutEffect, useRef } from "react";
import type { UIEvent } from "react";
import { Composer } from "./chat/Composer";
import { MessageList } from "./chat/List";
import { useAgentConversation } from "./chat/conversation/hook";
import styles from "./style.module.css";

export function ChatWorkspace(): React.JSX.Element {
  const { state, isBusy, send, cancel } = useAgentConversation();
  const historyRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessages = useRef(true);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (history !== null && shouldFollowMessages.current) {
      history.scrollTop = history.scrollHeight;
    }
  }, [state.messages]);

  function updateScrollPreference(event: UIEvent<HTMLDivElement>): void {
    const history = event.currentTarget;
    const distanceFromBottom = history.scrollHeight - history.clientHeight - history.scrollTop;
    shouldFollowMessages.current = distanceFromBottom <= 80;
  }

  return (
    <section className={styles.chat} aria-label="Agent 对话工作区">
      <div className={styles.history} ref={historyRef} onScroll={updateScrollPreference}>
        <MessageList messages={state.messages} />
      </div>
      <div className={styles.inputArea}>
        <Composer onSubmit={send} busy={isBusy} onCancel={cancel} />
      </div>
    </section>
  );
}
