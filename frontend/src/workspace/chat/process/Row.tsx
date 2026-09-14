import { useEffect, useId, useState } from "react";

import type { AssistantContentBlock, AssistantConversationMessage } from "../conversation.js";
import { isTurnLive, processSummary } from "../process.js";
import { Icon } from "../../../ui/Icon.js";
import styles from "../../style.module.css";
import { AssistantBlock } from "./Block.js";

export function ProcessRow({ blocks, folded, message }: {
  readonly blocks: readonly AssistantContentBlock[];
  readonly folded: boolean;
  readonly message: AssistantConversationMessage;
}): React.JSX.Element {
  const [userExpanded, setUserExpanded] = useState(false);
  const [now, setNow] = useState(() => message.endedAt ?? Date.now());
  const live = isTurnLive(message.status);
  const expanded = !folded || userExpanded;
  const bodyId = useId();

  useEffect(() => {
    if (message.endedAt !== null) {
      setNow(message.endedAt);
      return undefined;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [message.endedAt, message.startedAt]);

  return (
    <section className={styles.processRow}>
      <div className={styles.processStatus} role="status">
        <span className={styles.processLabel}>{processSummary(message, now)}</span>
      </div>
      <div id={bodyId} className={styles.processBody} hidden={!expanded}>
        {blocks.map((block) => (
          <AssistantBlock key={block.id} block={block} live={live} />
        ))}
      </div>
      <button
        type="button"
        className={styles.processBoundary}
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={expanded ? "折叠处理过程" : "展开处理过程"}
        disabled={!folded}
        onClick={() => setUserExpanded((current) => !current)}
      >
        <Icon name="chevron" />
      </button>
    </section>
  );
}
