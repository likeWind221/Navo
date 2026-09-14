import { useId, useState } from "react";

import type { AssistantContentBlock } from "../conversation.js";
import { Icon } from "../../../ui/Icon.js";
import styles from "../../style.module.css";
import { AssistantBlock } from "./Block.js";

export function ProcessRow({ blocks, folded, summary }: {
  readonly blocks: readonly AssistantContentBlock[];
  readonly folded: boolean;
  readonly summary: string;
}): React.JSX.Element {
  const [userExpanded, setUserExpanded] = useState(false);
  const expanded = !folded || userExpanded;
  const bodyId = useId();

  return (
    <section className={styles.processRow}>
      <div className={styles.processStatus} role="status">
        <span className={styles.processLabel}>{summary}</span>
      </div>
      <div id={bodyId} className={styles.processBody} hidden={!expanded}>
        {blocks.map((block) => (
          <AssistantBlock key={block.id} block={block} live={!folded} />
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
