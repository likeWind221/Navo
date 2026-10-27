import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import { Composer } from "../chat/Composer";
import { MessageList } from "../chat/List";
import { ProjectRuntime } from "./runtime.js";
import styles from "../style.module.css";

export function ProjectConversation({ runtime, projectId, detail, children }: { readonly runtime: ProjectRuntime; readonly projectId: string; readonly detail: ProjectDetailV1; readonly children?: ReactNode }): React.JSX.Element {
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [snapshot, setSnapshot] = useState(() => runtime.snapshot(projectId, detail));
  const history = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(snapshot.conversation.messages.length === 0);

  useEffect(() => runtime.subscribe(projectId, detailRef.current, () => setSnapshot(runtime.snapshot(projectId, detailRef.current))), [runtime, projectId]);
  useLayoutEffect(() => {
    const element = history.current;
    if (element !== null && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [snapshot.conversation.messages, snapshot.conversation.commands, snapshot.conversation.timeline]);

  function send(text: string): boolean {
    runtime.setDraft(projectId, detailRef.current, text);
    return runtime.send(projectId, detailRef.current);
  }

  return <section className={styles.chat} aria-label="Main 项目对话">
    <div className={styles.history} ref={history} onScroll={(event) => {
      const element = event.currentTarget;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
    }}>{children}{snapshot.followFailure !== null && <p role="alert">{snapshot.followFailure.message} <button type="button" onClick={() => runtime.reconnect(projectId, detailRef.current)}>重新连接</button></p>}{(snapshot.conversation.messages.length > 0 || snapshot.conversation.commands.length > 0) && <MessageList messages={snapshot.conversation.messages} commands={snapshot.conversation.commands} timeline={snapshot.conversation.timeline} />}</div>
    <div className={styles.inputArea}><Composer value={snapshot.draft} onChange={(value) => runtime.setDraft(projectId, detailRef.current, value)} inputId={`project-${projectId}-chat-input`} onSubmit={send} busy={snapshot.busy} onCancel={() => runtime.cancel(projectId, detailRef.current)} /></div>
  </section>;
}
