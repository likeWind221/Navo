import { useEffect, useState } from "react";
import type { SessionHistoryContentV1, SessionHistoryEntryV1 } from "../../../../rpc/session.js";
import { Markdown } from "../chat/Markdown";
import type { ProjectRuntime } from "./runtime.js";
import type { ProjectChatTarget } from "./runtime/turns.js";
import styles from "../style.module.css";

type HistoryState = { readonly status: "loading" } | { readonly status: "ready"; readonly entries: readonly SessionHistoryEntryV1[]; readonly established: boolean } | { readonly status: "failed"; readonly message: string };

export function ProjectHistory({ runtime, projectId, target, mainSessionId, hasLiveMessages, onReady }: { readonly runtime: ProjectRuntime; readonly projectId: string; readonly target: ProjectChatTarget; readonly mainSessionId: string; readonly hasLiveMessages: boolean; readonly onReady: (ready: boolean) => void }): React.JSX.Element {
  const [state, setState] = useState<HistoryState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    onReady(false);
    setState({ status: "loading" });
    const request = target.kind === "main" ? runtime.mainHistory(mainSessionId).then(entries => ({ established: true, entries }))
      : target.kind === "node" ? runtime.nodeHistory(projectId, target.nodeId)
      : Promise.resolve({ established: false, entries: [] });
    void request.then(result => {
      if (!active) return;
      setState({ status: "ready", ...result });
      onReady(true);
    }, (error: unknown) => {
      if (!active) return;
      setState({ status: "failed", message: error instanceof Error ? error.message : "无法读取已保存的对话，请重试" });
    });
    return () => { active = false; };
  }, [runtime, projectId, target, mainSessionId, attempt, onReady]);

  if (state.status === "loading") return <p className={styles.connection} role="status">正在读取已保存的对话…</p>;
  if (state.status === "failed") return <div className={styles.connection} role="alert">{state.message} <button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>;
  if (state.entries.length === 0) return !state.established && !hasLiveMessages ? <p className={styles.connection}>此节点尚未开始会话。</p> : <></>;
  return <div className={styles.messageColumn} role="log" aria-label="已保存的有效历史">
    {state.entries.map(entry => <article key={`${entry.sequence}-${entry.message.id}`} className={`${styles.message} ${entry.message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
      {entry.kind === "summary-checkpoint" && <small>历史摘要</small>}
      {entry.message.content.map((block, index) => <HistoryBlock key={index} block={block} />)}
    </article>)}
  </div>;
}

function HistoryBlock({ block }: { readonly block: SessionHistoryContentV1 }): React.JSX.Element {
  if (block.type === "text") return <Markdown text={block.text} />;
  if (block.type === "reasoning") return <details><summary>思考过程</summary><Markdown text={block.text} /></details>;
  if (block.type === "tool-call") return <details><summary>工具调用：{block.name}</summary><pre>{block.arguments}</pre></details>;
  return <details><summary>工具结果{block.isError ? "（失败）" : ""}</summary>{block.content.map((item, index) => <HistoryBlock key={index} block={item} />)}</details>;
}
