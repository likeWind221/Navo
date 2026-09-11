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
      <button
        type="button"
        className={styles.processHeader}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setUserExpanded((current) => !current)}
      >
        <Icon name="chevron" />
        <span className={styles.processLabel}>{summary}</span>
      </button>
      <div id={bodyId} className={styles.processBody} hidden={!expanded}>
        {blocks.map((block) => (
          <AssistantBlock key={block.id} block={block} live={!folded} />
        ))}
      </div>
    </section>
  );
}
