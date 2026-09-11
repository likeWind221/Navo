import type { AssistantContentBlock } from "../conversation.js";
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
    <details className={styles.reasoningBlock}>
      <summary>{streaming ? "思考中" : "思考过程"}</summary>
      <div className={styles.reasoningText}>
        <Markdown text={block.text} streaming={streaming} />
        {streaming && <span className={styles.streamCursor} aria-hidden="true" />}
      </div>
    </details>
  );
}

function ToolBlock({ block }: {
  readonly block: Extract<AssistantContentBlock, { readonly kind: "tool-call" }>;
}): React.JSX.Element {
  const hasResult = block.summary.length > 0 || block.detail.length > 0 || block.failure !== null;
  return (
    <section className={styles.toolBlock} data-status={block.status} aria-label={`工具调用 ${block.toolName}`}>
      <header className={styles.toolHeader}>
        <span className={styles.toolLabel}>工具调用</span>
        <strong className={styles.toolName}>{block.toolName}</strong>
        <span className={styles.toolStatus} data-status={block.status} role="status">
          {toolStatusText(block.status)}
        </span>
      </header>
      <details className={styles.toolDetails}>
        <summary>参数</summary>
        <pre>{block.arguments || "等待参数"}</pre>
      </details>
      {hasResult && (
        <details className={styles.toolDetails}>
          <summary>结果</summary>
          {block.summary.length > 0 && <p>{block.summary}</p>}
          {block.detail.length > 0 && <pre>{block.detail}</pre>}
          {block.failure !== null && <p className={styles.toolFailure}>{block.failure.message}</p>}
        </details>
      )}
    </section>
  );
}

function toolStatusText(status: Extract<AssistantContentBlock, { readonly kind: "tool-call" }>["status"]): string {
  if (status === "pending") return "等待执行";
  if (status === "running") return "执行中";
  if (status === "succeeded") return "已成功";
  if (status === "failed") return "失败";
  return "已取消";
}
