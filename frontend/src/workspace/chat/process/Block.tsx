import { useId, useState } from "react";
import type { AssistantContentBlock } from "../conversation.js";
import { Icon } from "../../../ui/Icon.js";
import { toolPresentation } from "./tool.js";
import { Activity } from "./Activity.js";
import { Markdown } from "../Markdown.js";
import styles from "../../style.module.css";

export function AssistantBlock({ block, live }: {
  readonly block: AssistantContentBlock;
  readonly live: boolean;
}): React.JSX.Element | null {
  const streaming = live && block.status === "streaming";
  if (block.kind === "text") {
    if (block.text.length === 0 && block.status === "completed") return null;
    return (
      <div className={styles.textBlock}>
        <Markdown text={block.text} streaming={streaming} />
        {streaming && <span className={styles.streamCursor} aria-hidden="true" />}
      </div>
    );
  }
  if (block.kind === "reasoning") return <ReasoningBlock block={block} streaming={streaming} />;
  return <ToolBlock block={block} />;
}

function ReasoningBlock({ block, streaming }: {
  readonly block: Extract<AssistantContentBlock, { readonly kind: "reasoning" }>;
  readonly streaming: boolean;
}): React.JSX.Element {
  return (
    <section className={styles.reasoningBlock} aria-label="思考过程">
      <div className={styles.reasoningHeading}>
        <span className={styles.activityIcon} data-icon="brain"><Icon name="brain" active={streaming} /></span>
        <span className={styles.reasoningLabel} data-active={streaming}>{streaming ? "思考中" : "思考过程"}</span>
      </div>
      <div className={styles.reasoningText}>
        <Markdown text={block.text} streaming={streaming} />
        {streaming && <span className={styles.streamCursor} aria-hidden="true" />}
      </div>
    </section>
  );
}

function ToolBlock({ block }: {
  readonly block: Extract<AssistantContentBlock, { readonly kind: "tool-call" }>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const view = toolPresentation(block);
  return (
    <section className={styles.toolBlock} data-status={block.status} aria-label={`工具调用 ${block.toolName}`}>
      <Activity label={view.label} icon={view.icon} status={block.status}
        startedAt={block.startedAt} endedAt={block.endedAt}
        {...(view.result === null ? {} : { disclosure: { expanded, controls: bodyId, onToggle: () => setExpanded(!expanded) } })} />
      {view.result !== null && (
        <div id={bodyId} className={styles.processCollapse} data-expanded={expanded} aria-hidden={!expanded} inert={!expanded}>
          <div className={styles.processClip}>
            <section className={styles.toolResult} aria-label={view.result.title}>
              <header>{view.result.title}</header>
              {view.result.command !== null && <div className={styles.toolCommand}><code>$ {view.result.command}</code></div>}
              {view.result.text.length > 0 && <pre tabIndex={0} aria-label="工具输出">{view.result.text}</pre>}
              {block.failure !== null && block.failure.message !== view.result.text && <p className={styles.toolFailure}>{block.failure.message}</p>}
              {view.result.exitCode !== null && <footer>退出码 {view.result.exitCode}</footer>}
            </section>
          </div>
        </div>
      )}
      {view.result === null && block.failure !== null && <p className={styles.toolFailure}>{block.failure.message}</p>}
    </section>
  );
}
