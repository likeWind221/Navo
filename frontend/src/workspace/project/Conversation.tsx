import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import { Composer } from "../chat/Composer";
import { MessageList } from "../chat/List";
import { ProjectRuntime } from "./runtime.js";
import type { ProjectChatTarget } from "./runtime/turns.js";
import styles from "../style.module.css";

export function ProjectConversation({ runtime, projectId, detail, target, disabled = false, disabledHint, children }: {
  readonly runtime: ProjectRuntime;
  readonly projectId: string;
  readonly detail: ProjectDetailV1;
  readonly target: ProjectChatTarget;
  readonly disabled?: boolean;
  readonly disabledHint?: string | undefined;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [snapshot, setSnapshot] = useState(() => runtime.targetSnapshot(projectId, target));
  const history = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(snapshot.conversation.messages.length === 0);

  useEffect(() => {
    setSnapshot(runtime.targetSnapshot(projectId, target));
    return runtime.subscribe(projectId, detailRef.current, () => setSnapshot(runtime.targetSnapshot(projectId, target)));
  }, [runtime, projectId, target]);
  useLayoutEffect(() => {
    const element = history.current;
    if (element !== null && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [snapshot.conversation.messages, snapshot.conversation.commands, snapshot.conversation.timeline]);

  function send(text: string): boolean {
    runtime.setDraft(projectId, target, text);
    return runtime.send(projectId, target);
  }

  return <section className={styles.chat} aria-label={target.kind === "main" ? "Main 项目对话" : "Node 项目对话"}>
    <div className={styles.history} ref={history} onScroll={(event) => {
      const element = event.currentTarget;
      stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
    }}>{children}{(snapshot.conversation.messages.length > 0 || snapshot.conversation.commands.length > 0) && <MessageList messages={snapshot.conversation.messages} commands={snapshot.conversation.commands} timeline={snapshot.conversation.timeline} />}</div>
    <div className={styles.inputArea}><Composer value={snapshot.draft} onChange={(value) => runtime.setDraft(projectId, target, value)} inputId={`project-${projectId}-${target.kind === "main" ? "main" : `node-${target.nodeId}`}-chat-input`} onSubmit={send} busy={snapshot.busy} disabled={disabled} disabledHint={disabledHint} onCancel={() => runtime.cancel(projectId, target)} /></div>
  </section>;
}
